import { CONFIG } from '../config';
import type { Car } from '../race/car';
import { isServicing } from '../race/car';
import type { PitPlan, Track } from './common';

/** Grip model: fuel margin (laps) on top of the reach to the pit lane before a stop may be skipped. */
export const PIT_FUEL_MARGIN_LAPS = 0.15;

/** An east-bound pit road: boxes along x, a box row and a drive row at fixed y. */
export interface PitRoad {
  inLane(x: number, y: number): boolean;
  inBox(x: number, y: number): boolean;
  boxX(i: number): number;
  numBoxes: number;
  boxPitch: number;
  boxY: number;
  driveY: number;
  /** Grip model: the stretch of pit road after the pit lane, where a car may wait to merge. */
  onExitRoad?(x: number, y: number): boolean;
}

export function pitCarAhead(road: PitRoad, car: Car, laneY: number, cars: Car[], exitRoad = false): { car: Car; gap: number } | null {
  let best: { car: Car; gap: number } | null = null;
  for (const o of cars) {
    const onRoad = road.inLane(o.x, o.y) || (exitRoad && (road.onExitRoad?.(o.x, o.y) ?? false));
    if (o === car || !o.pitSide || !onRoad) continue;
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

/**
 * Can a car leaving the pits take `lane`? Classic: nobody alongside and nobody closing in within
 * `closeS`. Grip (`brakeRoom`): a car coming up behind must also have room to slow to the merging
 * car's speed after a reaction, at the follow-logic braking rate (it may be carrying more speed
 * into turn 1 than the merging car will have).
 */
export function mergeClear(track: Track, car: Car, lane: number, cars: Car[], brakeRoom = false, closeS = 1.5): boolean {
  const pxm = CONFIG.PX_PER_MPH;
  return cars.every((o) => {
    if (o === car || Math.abs(o.d - lane) > 17) return true;
    const ds = track.deltaS(car.s, o.s);
    if (ds > -30 && ds < 50) return false;
    if (brakeRoom && ds <= -30 && ds > -MERGE_BACK_PX && o.speed > car.speed) {
      const vo = o.speed * pxm;
      // the merging car keeps accelerating out of the pit road
      const vc = Math.min(vo, (Math.max(0, car.speed) + MERGE_GAIN_MPH) * pxm);
      const b = CONFIG.BRAKE_MPH_S * 0.7 * pxm;
      if (-ds < (vo * vo - vc * vc) / (2 * b) + vo * MERGE_REACT_S + 46) return false;
    }
    if (ds <= -30 && ds > -300) {
      const closing = (o.speed - car.speed) * pxm;
      if (closing > 0 && (-ds - 40) / closing < closeS) return false;
    }
    return true;
  });
}

// Grip model merge check: racing cars up to MERGE_BACK_PX behind count, with a reaction of MERGE_REACT_S.
const MERGE_BACK_PX = 450;
const MERGE_REACT_S = 0.25;
const MERGE_GAIN_MPH = 20;

/** Grip model: the nearest car straight ahead of a car at the end of the pit road, also leaving the pits. */
export function exitRoadAhead(car: Car, cars: Car[]): { car: Car; gap: number } | null {
  let best: { car: Car; gap: number } | null = null;
  for (const o of cars) {
    if (o === car || !o.pitSide || o.ai.pitPhase !== 'exiting') continue;
    const dx = o.x - car.x;
    if (dx <= 0 || dx > 150 || Math.abs(o.y - car.y) > 16) continue;
    if (!best || dx < best.gap) best = { car: o, gap: dx };
  }
  return best;
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
export function followInPits(road: PitRoad, car: Car, cars: Car[], plan: PitPlan, exitRoad = false): void {
  const pitY = plan.lane!;
  let ahead = pitCarAhead(road, car, pitY, cars, exitRoad);
  if (ahead && ahead.car.speed < 2 && ahead.gap < 80 && !isServicing(ahead.car)) {
    const other = pitY === road.driveY ? road.boxY : road.driveY;
    if (!pitCarAhead(road, car, other, cars, exitRoad)) {
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
