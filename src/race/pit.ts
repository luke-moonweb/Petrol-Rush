import { CONFIG } from '../config';
import { inPitBox } from '../track/track';
import { Car } from './car';

export { boxX, NUM_BOXES as MAX_BOXES } from '../track/track';

export function updatePit(car: Car, dt: number): void {
  const stopped = Math.abs(car.speed) < CONFIG.PIT_STOP_MPH;
  if (stopped && car.pitSide && inPitBox(car.x, car.y) && car.fuel < 1) {
    car.fuel = Math.min(1, car.fuel + dt / CONFIG.REFUEL_TIME_S);
    car.refueling = true;
  } else {
    car.refueling = false;
  }
}
