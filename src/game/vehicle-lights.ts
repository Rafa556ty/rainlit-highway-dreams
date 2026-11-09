import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Per-model light signatures (front/rear) and windscreen wipers for traffic cars.
 * Coordinates: x in fractions of half-width (+ = right), y in fractions of height,
 * w/h in metres. Front is -z, rear is +z (see normalizeCar).
 */
type Shape = { x: number; y: number; w: number; h: number; round?: boolean; tilt?: number };
type Signature = { front: Shape[]; rear: Shape[] };

const mirror = (s: Shape[]): Shape[] =>
  s.flatMap((p) => [p, { ...p, x: -p.x }]);

export const SIGNATURES: Record<string, Signature> = {
  // Chiron: four LED projectors per side, single continuous C-shaped LED strip at the rear.
  bugatti: {
    front: mirror([0.42, 0.52, 0.62, 0.72].map((x, i) => ({ x, y: 0.5 + i * 0.012, w: 0.07, h: 0.06 }))),
    rear: [
      { x: 0, y: 0.66, w: 1.7, h: 0.035 },
      ...mirror([{ x: 0.85, y: 0.6, w: 0.035, h: 0.16 }]),
    ],
  },
  // SF90: slim slanted LED blade up front, two rectangular lights per side at the rear.
  ferrari: {
    front: mirror([{ x: 0.66, y: 0.52, w: 0.42, h: 0.035, tilt: 0.18 }]),
    rear: mirror([
      { x: 0.55, y: 0.6, w: 0.17, h: 0.06 },
      { x: 0.76, y: 0.6, w: 0.17, h: 0.06 },
    ]),
  },
  // 992 GT3: round headlamps with four-point LED, full-width rear light bar.
  porsche: {
    front: mirror([
      { x: 0.66, y: 0.58, w: 0.2, h: 0.2, round: true },
    ]),
    rear: [{ x: 0, y: 0.7, w: 1.6, h: 0.035 }],
  },
  // Mustang GT: tri-bar vertical LED taillights, three-slash DRL under each headlamp.
  mustang: {
    front: mirror([
      { x: 0.68, y: 0.6, w: 0.3, h: 0.05, tilt: 0.12 },
      ...[0.6, 0.68, 0.76].map((x) => ({ x, y: 0.52, w: 0.03, h: 0.07, tilt: 0.4 })),
    ]),
    rear: mirror([0.5, 0.6, 0.7].map((x) => ({ x, y: 0.6, w: 0.05, h: 0.14 }))),
  },
  // M4: angular twin-L LED headlights, L-shaped rear lamps.
  bmw: {
    front: mirror([
      { x: 0.66, y: 0.58, w: 0.28, h: 0.035 },
      { x: 0.66, y: 0.53, w: 0.24, h: 0.03 },
    ]),
    rear: mirror([
      { x: 0.7, y: 0.66, w: 0.32, h: 0.04 },
      { x: 0.84, y: 0.61, w: 0.04, h: 0.12 },
    ]),
  },
};

const GENERIC: Signature = {
  front: mirror([{ x: 0.7, y: 0.5, w: 0.3, h: 0.12 }]),
  rear: mirror([{ x: 0.75, y: 0.55, w: 0.22, h: 0.12 }]),
};

export const signatureFor = (key: string) => SIGNATURES[key] ?? GENERIC;

/** Lights on when it gets dark, in/near a tunnel or in rain; daytime keeps only a dim DRL. */
export function lightLevels(lightsOn: boolean) {
  return { front: lightsOn ? 1 : 0.18, rear: lightsOn ? 1 : 0, glow: lightsOn ? 1 : 0 };
}

/** Wiper sweep angle (radians) — runs whenever it's raining, faster in heavy rain. */
export function wiperAngle(time: number, rain: number, phase = 0) {
  if (rain < 0.08) return 0;
  const speed = rain > 0.55 ? 2.4 : 1.4;
  const t = (Math.sin((time + phase) * speed * Math.PI) + 1) / 2;
  return t * 1.75;
}

function buildGeo(shapes: Shape[], halfW: number, height: number, z: number, scale = 1) {
  const geos = shapes.map((s) => {
    const g = s.round
      ? new THREE.CircleGeometry((s.w / 2) * scale, 20)
      : new THREE.PlaneGeometry(s.w * scale, s.h * scale);
    if (s.tilt) g.rotateZ(s.tilt * Math.sign(s.x || 1));
    g.translate(s.x * halfW, s.y * height, 0);
    return g;
  });
  const merged = mergeGeometries(geos) ?? geos[0]!;
  merged.translate(0, 0, z);
  return merged;
}

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export type TrafficLightRig = {
  front: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  rear: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  frontGlow: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  rearGlow: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wipers: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Wiper pivots in car space (left, right) with windscreen tilt and blade length. */
  wiper: { pivots: THREE.Vector3[]; tilt: number; length: number };
  all: THREE.InstancedMesh[];
};

/** Find the windscreen: forward-most glass, falling back to body proportions. */
export function findWindscreen(template: THREE.Object3D, box: THREE.Box3) {
  template.updateMatrixWorld(true);
  const glass = new THREE.Box3();
  const tmp = new THREE.Box3();
  template.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const label = `${m.name} ${mats.map((x) => x.name).join(" ")}`.toLowerCase();
    if (!/window|windshield|windscreen|glass/.test(label) || /light|red|lamp|mirror/.test(label)) return;
    tmp.setFromObject(m);
    const c = tmp.getCenter(new THREE.Vector3());
    if (c.z < 0.4 && tmp.max.y > box.max.y * 0.6) glass.union(tmp);
  });
  const size = box.getSize(new THREE.Vector3());
  const valid = !glass.isEmpty() && glass.min.z > box.min.z && glass.min.z < 0.5;
  const baseZ = valid ? glass.min.z + 0.12 : box.min.z + size.z * 0.3;
  const baseY = valid ? Math.max(glass.min.y + 0.04, size.y * 0.55) : size.y * 0.66;
  // Snap onto the actual glass/body surface so blades sit on top of the windscreen.
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const surf = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, box.max.y + 1, z), down);
    const hit = ray.intersectObject(template, true)[0];
    return hit ? hit.point.y : null;
  };
  const x = size.x * 0.12;
  const y0 = surf(x, baseZ);
  const y1 = surf(x, baseZ + 0.3);
  let tilt = 1.05;
  let y = baseY;
  if (y0 !== null) {
    y = y0 + 0.025;
    if (y1 !== null && y1 > y0) tilt = Math.max(0.15, Math.min(1.35, Math.atan2(0.3, y1 - y0)));
  }
  return { baseZ, baseY: y, halfW: size.x / 2, tilt };
}

export function createTrafficLightRig(
  key: string,
  template: THREE.Object3D,
  max: number,
  tall: boolean,
): TrafficLightRig {
  const box = new THREE.Box3().setFromObject(template);
  { const out: string[] = []; template.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const b = new THREE.Box3().setFromObject(m); const mats = Array.isArray(m.material) ? m.material : [m.material]; out.push(`${m.name}|${mats.map((x) => x.name).join(',')}|${b.min.toArray().map((v) => v.toFixed(2))}|${b.max.toArray().map((v) => v.toFixed(2))}`); }); console.log('DUMP', key, JSON.stringify(box.min.toArray()), JSON.stringify(box.max.toArray()), out.join(' ;; ')); }
  const halfW = (box.max.x - box.min.x) / 2;
  const height = tall ? Math.min(box.max.y, 1.35) : box.max.y;
  const sig = signatureFor(key);
  const make = <M extends THREE.Material>(geo: THREE.BufferGeometry, mat: M, n = max) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    return mesh;
  };
  const front = make(
    buildGeo(sig.front, halfW, height, box.min.z - 0.02),
    new THREE.MeshBasicMaterial({ color: 0xf2f6ff, toneMapped: false, transparent: true, side: THREE.DoubleSide }),
  );
  const rear = make(
    buildGeo(sig.rear, halfW, height, box.max.z + 0.02),
    new THREE.MeshBasicMaterial({ color: 0xff1206, toneMapped: false, transparent: true, side: THREE.DoubleSide }),
  );
  const glowShapes = (s: Shape[]) => s.map((p) => ({ ...p, w: Math.max(p.w, 0.12) * 2.6 + 0.3, h: Math.max(p.h, 0.12) * 2.6 + 0.3, round: false, tilt: 0 }));
  const glowMat = (color: number) =>
    new THREE.MeshBasicMaterial({
      color,
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  const frontGlow = make(buildGeo(glowShapes(sig.front), halfW, height, box.min.z - 0.05), glowMat(0xdfe8ff));
  const rearGlow = make(buildGeo(glowShapes(sig.rear), halfW, height, box.max.z + 0.05), glowMat(0xff2010));

  const ws = findWindscreen(template, box);
  const length = Math.min(0.62, ws.halfW * 0.6) * (tall ? 1.4 : 1);
  // Blade lies along +x from its pivot; thin and dark.
  const bladeGeo = new THREE.BoxGeometry(length, 0.018, 0.025).translate(length / 2, 0.012, 0);
  const wipers = make(
    bladeGeo,
    new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.3 }),
    max * 2,
  );
  const pivots = [
    new THREE.Vector3(-ws.halfW * 0.62, ws.baseY, ws.baseZ),
    new THREE.Vector3(ws.halfW * 0.02, ws.baseY, ws.baseZ),
  ];
  const all = [front, rear, frontGlow, rearGlow, wipers];
  return { front, rear, frontGlow, rearGlow, wipers, wiper: { pivots, tilt: tall ? 0.15 : ws.tilt, length }, all };
}

const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const _out = new THREE.Matrix4();

/** Matrix for a wiper blade on a car (car-space pivot, windscreen tilt, sweep angle). */
export function wiperMatrix(
  carMatrix: THREE.Matrix4,
  pivot: THREE.Vector3,
  tilt: number,
  angle: number,
  target = _out,
) {
  // Lay blade onto the windscreen plane (tilted back around X), then sweep up around its normal.
  _e.set(tilt, 0, 0);
  _q.setFromEuler(_e);
  _qs.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle * 0.95);
  _q.multiply(_qs);
  _local.compose(pivot, _q, _one);
  return target.multiplyMatrices(carMatrix, _local);
}
