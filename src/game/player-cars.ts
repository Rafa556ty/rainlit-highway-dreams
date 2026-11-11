export type PlayerCar = 'revuelto' | 'chiron';
export type GarageState = { chironOwned: boolean; selectedCar: PlayerCar };
export const DEFAULT_GARAGE: GarageState = { chironOwned: false, selectedCar: 'revuelto' };
export function choosePlayerCar(state: GarageState, car: PlayerCar): GarageState {
  return car === 'chiron' && !state.chironOwned ? state : { ...state, selectedCar: car };
}
export function claimChiron(state: GarageState, confirmed: boolean): GarageState {
  return confirmed ? { chironOwned: true, selectedCar: 'chiron' } : state;
}
export function needsChironConfirmation(state: GarageState) { return !state.chironOwned; }