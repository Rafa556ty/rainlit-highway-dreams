import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { X } from "lucide-react";
import revueltoPhoto from "@/assets/revuelto.png";
import chironPhoto from "@/assets/store/chiron-road.jpg.asset.json";
import type { PlayerCar } from "@/game/player-cars";
import { Button } from "@/components/ui/button";

export type GarageLabels = {
  title: string;
  hint: string;
  loading: string;
  error: string;
  close: string;
};

export function GarageViewer({ labels, onClose, selectedCar, chironOwned, onSelect, busy }: { labels: GarageLabels; onClose: () => void; selectedCar: PlayerCar; chironOwned: boolean; onSelect: (car: PlayerCar) => void; busy: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setStatus("loading"); setProgress(0);
    let disposed = false;
    let raf = 0;
    let teardown: (() => void) | null = null;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      if (disposed) return;

      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      const canvas = renderer.domElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.touchAction = "none";
      container.appendChild(canvas);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x303a40);
      scene.fog = new THREE.Fog(0x303a40, 20, 45);

      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 120);

      // Studio-style reflections so the paint, glass and chrome read properly.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      scene.environmentIntensity = 0.6;

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 40;
      keyLight.shadow.bias = -0.0006;
      scene.add(keyLight);
      scene.add(keyLight.target);

      const rimWarm = new THREE.DirectionalLight(0xffb347, 1.5);
      rimWarm.position.set(-6, 3, -5);
      scene.add(rimWarm);

      const rimCool = new THREE.DirectionalLight(0x7fb2ff, 0.8);
      rimCool.position.set(5, 2, -6);
      scene.add(rimCool);

      scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1208, 0.55));

      const { loadCar } = await import("@/game/models3d");
      const template = await loadCar(selectedCar);
      if (disposed) return;
      const car = template.clone(true);
      // Cached model geometry/materials belong to the shared loader, not this view.
      car.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry = o.geometry.clone(); o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); } });
      setProgress(1);
      const pivot = new THREE.Group();
      pivot.add(car);
      scene.add(pivot);

      car.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });

      pivot.rotation.y = -Math.PI / 2;

      // Rest the car on the floor and spin it around its own centre.
      pivot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(pivot);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      pivot.position.set(-center.x, -bounds.min.y, -center.z);
      pivot.updateMatrixWorld(true);

      const carLength = Math.max(size.x, size.z);
      const carHeight = Math.max(0.4, size.y);

      const { addGarageEnvironment } = await import("@/game/garage-environment");
      addGarageEnvironment(scene);
      keyLight.position.set(carLength * 0.9, carHeight * 6, carLength * 1.1);
      keyLight.target.position.set(0, carHeight * 0.4, 0);
      const shadowSpan = carLength * 0.9;
      keyLight.shadow.camera.left = -shadowSpan;
      keyLight.shadow.camera.right = shadowSpan;
      keyLight.shadow.camera.top = shadowSpan;
      keyLight.shadow.camera.bottom = -shadowSpan;
      keyLight.shadow.camera.updateProjectionMatrix();

      const target = new THREE.Vector3(0, carHeight * 0.45, 0);
      const viewDirection = new THREE.Vector3(0.68, 0.34, 0.65).normalize();

      /**
       * Distance that keeps the whole car inside the frame. A phone held
       * upright is tall and narrow, so the horizontal field of view is the one
       * that clips the car: it is derived from the FOV and the current aspect.
       */
      const frameDistance = () => {
        const halfVertical = Math.tan((camera.fov * Math.PI) / 360);
        const halfHorizontal = halfVertical * camera.aspect;
        return Math.max(carLength / 2 / halfHorizontal, carHeight / 2 / halfVertical) * 1.12;
      };

      let baseDistance = frameDistance();
      camera.position.copy(target).addScaledVector(viewDirection, baseDistance);
      camera.lookAt(target);

      const controls = new OrbitControls(camera, canvas);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.enablePan = false;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.85;
      controls.minDistance = baseDistance * 0.4;
      controls.maxDistance = baseDistance * 2.4;
      controls.minPolarAngle = Math.PI * 0.12;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.update();

      // Hand the turntable back a moment after the player lets go.
      let resumeTimer: ReturnType<typeof setTimeout> | undefined;
      const onStart = () => {
        if (resumeTimer) clearTimeout(resumeTimer);
        controls.autoRotate = false;
      };
      const onEnd = () => {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
          controls.autoRotate = true;
        }, 2200);
      };
      controls.addEventListener("start", onStart);
      controls.addEventListener("end", onEnd);

      const resize = () => {
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);

        // Keep the whole car framed through a rotation, but leave a zoom the
        // player already made alone.
        const next = frameDistance();
        const current = camera.position.distanceTo(controls.target);
        if (Math.abs(current - baseDistance) < 0.01) {
          const dir = camera.position.clone().sub(controls.target).normalize();
          camera.position.copy(controls.target).addScaledVector(dir, next);
        }
        baseDistance = next;
        controls.minDistance = baseDistance * 0.4;
        controls.maxDistance = baseDistance * 2.4;
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);

      const frame = () => {
        raf = requestAnimationFrame(frame);
        controls.update();
        renderer.render(scene, camera);
      };
      frame();

      container.dataset.sceneReady = "true";
      container.dataset.car = selectedCar;
      setStatus("ready");

      teardown = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        controls.removeEventListener("start", onStart);
        controls.removeEventListener("end", onEnd);
        if (resumeTimer) clearTimeout(resumeTimer);
        controls.dispose();
        scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material as unknown as Record<string, unknown>)) {
              // Textures remain owned by the shared model cache.
            }
            material.dispose();
          }
        });
        scene.environment = null;
        envTexture.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentNode === container) container.removeChild(canvas);
      };
    })().catch((err: unknown) => {
      if (disposed) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    });

    return () => {
      disposed = true;
      if (teardown) teardown();
    };
  }, [selectedCar]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-hud-border bg-scrim-top px-5 pb-3 pt-[max(env(safe-area-inset-top),18px)]">
        <div>
          <h2 className="font-display text-2xl leading-none tracking-[0.25em] text-primary">
            {labels.title}
          </h2>
          <p className="mt-1 font-display text-[11px] tracking-[0.3em] text-muted-foreground">
            {selectedCar === "chiron" ? "BUGATTI CHIRON" : "LAMBORGHINI REVUELTO"}
          </p>
        </div>
        <Button
          variant="ghost" size="icon"
          onClick={onClose}
          aria-label={labels.close}
          className="corner-cut border border-hud-border bg-hud p-2 text-foreground transition-colors hover:bg-secondary"
        >
          <X className="size-5" />
        </Button>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 touch-none">
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95">
            <div className="h-1 w-40 overflow-hidden bg-secondary">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="animate-pulse-soft font-display text-sm tracking-[0.25em] text-primary">
              {labels.loading} {Math.round(progress * 100)}%
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-display text-lg tracking-[0.2em] text-brake">{labels.error}</p>
            <p className="text-xs text-muted-foreground">{errorMsg}</p>
            <Button
              variant="outline"
              size="sm"
              className="border-hud-border bg-hud text-xs"
              onClick={onClose}
            >
              {labels.close}
            </Button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-center gap-3 border-t border-hud-border bg-hud px-3 py-3">
        {([{ id: 'revuelto' as const, name: 'Lamborghini Revuelto', image: revueltoPhoto }, { id: 'chiron' as const, name: 'Bugatti Chiron', image: chironPhoto.url }]).map(c => (
          <Button key={c.id} variant="outline" disabled={busy} aria-pressed={selectedCar === c.id} aria-label={`Selecionar ${c.name}`} onClick={() => onSelect(c.id)} className={`h-auto w-40 max-w-[44%] flex-col gap-1 overflow-hidden p-0 pb-2 ${selectedCar === c.id ? 'border-primary bg-primary/10' : 'border-hud-border bg-card'}`}>
            <img src={c.image} alt={c.name} className="h-16 w-full object-cover" />
            <span className="text-xs">{c.name}</span>
            <span className="text-[10px] text-primary">{c.id === selectedCar ? 'SELECIONADO' : c.id === 'chiron' && !chironOwned ? 'RESGATAR GRÁTIS' : 'DISPONÍVEL'}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
