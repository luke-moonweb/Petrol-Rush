import { CONFIG } from '../config';
import type { Track } from '../track/common';
import type { Car } from './car';

export function updatePit(car: Car, dt: number, track: Track): void {
  const stopped = Math.abs(car.speed) < CONFIG.PIT_STOP_MPH;
  if (stopped && car.pitSide && track.pit.inBox(car.x, car.y) && car.fuel < 1) {
    car.fuel = Math.min(1, car.fuel + dt / CONFIG.REFUEL_TIME_S);
    car.refueling = true;
    car.ai.refuelledThisLap = true;
  } else {
    car.refueling = false;
  }
}
