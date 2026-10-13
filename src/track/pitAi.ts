import { CONFIG } from '../config';
import type { Car } from '../race/car';
import { isServicing } from '../race/car';
import type { PitPlan, Track } from './common';

/** An east-bound pit road: boxes along x, a box row and a drive row at fixed y. */
export interface PitRoad {
  inLane(x: number, y: number): boolean;
  inBox(x: number, y: number): boolean;
  boxX(i: number): number;
  numBoxes: number;
  boxPitch: number;
  boxY: number;
  driveY: number;
}

export function pitCarAhead(road: PitRoad, car: Car, laneY: number, cars: Car[]): { car: Car; gap: number } | null {
  let best: { car: Car; gap: number } | null = null;
  for (const o of cars) {
    if (o === car || !o.pitSide || !road.inLane(o.x, o.y)) continue;
    const dx = o.x - car.x;
    if (dx <= 0 || dx > 150 || Math.abs(o.y - laneY) > 13) continue;
    if (!best || dx < best.gap) best = { car: o, gap: dx };
  }
  return best;
}

export function pitDriveLaneBusy(road: PitRoad, car: Car, cars: Car[]): boolean {
  for (const o of cars) {
    if (o === car || !o.pitSide) continue;
    const dx = o.x - car.x;
    if (dx > -80 && dx < 10 && o.speed > 5 && Math.abs(o.y - road.driveY) < 8) return true;
  }
  return false;
}

/** The car's own box, or the next free one further down the pit lane. */
export function freeBox(road: PitRoad, car: Car, cars: Car[]): number {
  const own = car.ai.box;
  const occupied = (bx: number) => cars.some((o) => o !== car && road.inBox(o.x, o.y) && Math.abs(o.x - bx) < road.boxPitch * 0.5 + 8);
  for (let i = own; i < road.numBoxes; i++) {
    const bx = road.boxX(i);
    if (bx - car.x > -8 && !occupied(bx)) return bx;
  }
  return road.boxX(own);
}

export function mergeClear(track: Track, car: Car, lane: number, cars: Car[]): boolean {
  const pxm = CONFIG.PX_PER_MPH;
  return cars.every((o) => {
    if (o === car || Math.abs(o.d - lane) > 17) return true;
    const ds = track.deltaS(car.s, o.s);
    if (ds > -30 && ds < 50) return false;
    if (ds <= -30 && ds > -300) {
      const closing = (o.speed - car.speed) * pxm;
      if (closing > 0 && (-ds - 40) / closing < 1.5) return false;
    }
    return true;
  });
}

/** Drives to the box: slows down with the distance left and stops in it. */
export function driveToBox(road: PitRoad, car: Car, cars: Car[], target: number): { target: number; lane: number } {
  const pxm = CONFIG.PX_PER_MPH;
  const bx = freeBox(road, car, cars);
  const dist = bx - car.x;
  const lane = dist < 40 ? road.boxY : road.driveY;
  target = Math.min(target, Math.sqrt(Math.max(0, CONFIG.BRAKE_MPH_S * dist) / pxm) * 1.2);
  if (dist < 8 && Math.abs(car.speed) < CONFIG.PIT_STOP_MPH && road.inBox(car.x, car.y)) {
    car.ai.pitPhase = car.finished ? 'parked' : 'fueling';
  }
  return { target, lane };
}

/** Queues behind a car ahead on the pit lane, or passes a parked one on the other row. */
export function followInPits(road: PitRoad, car: Car, cars: Car[], plan: PitPlan): void {
  const pitY = plan.lane!;
  let ahead = pitCarAhead(road, car, pitY, cars);
  if (ahead && ahead.car.speed < 2 && ahead.gap < 80 && !isServicing(ahead.car)) {
    const other = pitY === road.driveY ? road.boxY : road.driveY;
    if (!pitCarAhead(road, car, other, cars)) {
      plan.lane = other;
      ahead = null;
    }
  }
  if (ahead) {
    const pxm = CONFIG.PX_PER_MPH;
    const v0 = Math.max(0, ahead.car.speed);
    const room = Math.max(0, ahead.gap - 46);
    plan.target = Math.min(plan.target, Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm));
  }
}
