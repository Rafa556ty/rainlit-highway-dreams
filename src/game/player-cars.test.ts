import { describe, it, expect } from 'vitest';
import { DEFAULT_GARAGE, choosePlayerCar, claimChiron, needsChironConfirmation } from './player-cars';
describe('Playable Chiron rules', () => {
  it('asks only while Chiron is not owned', () => {
    expect(needsChironConfirmation(DEFAULT_GARAGE)).toBe(true);
    expect(needsChironConfirmation(claimChiron(DEFAULT_GARAGE, true))).toBe(false);
  });
  it('does not unlock on cancellation', () => {
    expect(claimChiron(DEFAULT_GARAGE, false)).toEqual({ chironOwned: false, selectedCar: 'revuelto' });
  });
  it('confirmation unlocks and selects Chiron', () => {
    expect(claimChiron(DEFAULT_GARAGE, true)).toEqual({ chironOwned: true, selectedCar: 'chiron' });
  });
  it('cannot select Chiron before claiming', () => {
    expect(choosePlayerCar(DEFAULT_GARAGE, 'chiron').selectedCar).toBe('revuelto');
  });
  it('can return to Revuelto and select owned Chiron again', () => {
    const owned = claimChiron(DEFAULT_GARAGE, true);
    const back = choosePlayerCar(owned, 'revuelto');
    expect(back).toEqual({ chironOwned: true, selectedCar: 'revuelto' });
    expect(choosePlayerCar(back, 'chiron').selectedCar).toBe('chiron');
  });
});