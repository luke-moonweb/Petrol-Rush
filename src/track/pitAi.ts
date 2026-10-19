import { CONFIG } from '../config';
import type { Car } from '../race/car';
import { isServicing } from '../race/car';
import type { PitPlan, Track } from './common';

/** Grip model: fuel margin (laps) on top of the reach to the pit lane before a stop may be skipped. */
export const PIT_FUEL_MARGIN_LAPS = 0.35;

/** The AI drives the drive row this far (px) towards the pit wall from its middle: more room past the boxes. */
export const DRIVE_WALLWARD = 3;

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
  /** Anywhere on the pit side from the entry to the exit: where a car pulling out of its box looks for traffic. */
  onRoad(x: number, y: number): boolean;
}

/** A car's body reaches into a row on the pit lane (either of its two collision circles within LANE_BODY_PX of it). */
function inRow(o: Car, laneY: number): boolean {
  const off = Math.abs(Math.sin(o.heading)) * 10;
  return Math.abs(o.y - laneY) - off < LANE_BODY_PX;
}

/**
 * The nearest pit car more than `from` px ahead (up to 150 px) whose body reaches into the row at `laneY`. With
 * `from` 0, a car alongside (under AHEAD_PX ahead) counts only if it overlaps this car side by side (this car
 * may be turning into the other row past it).
 */
export function pitCarAhead(
  road: PitRoad,
  car: Car,
  laneY: number,
  cars: Car[],
  exitRoad = false,
  from = 0,
): { car: Car; gap: number } | null {
  let best: { car: Car; gap: number } | null = null;
  for (const o of cars) {
    const onRoad = road.inLane(o.x, o.y) || (exitRoad && (road.onExitRoad?.(o.x, o.y) ?? false));
    // (a car on its way in may not be past the pit wall's start yet, which is where pitSide is set)
    if (o === car || !(o.pitSide || o.ai.pitPhase === 'entering') || !onRoad) continue;
    const dx = o.x - car.x;
    if (dx <= from || dx > 150) continue;
    const alongside = from === 0 && dx < AHEAD_PX;
    // (a car pulling out of its box clears the car in the next one: it only looks along the drive row)
    if (alongside ? car.ai.pullOut === 2 || Math.abs(o.y - car.y) > SIDE_BY_SIDE_PX : !inRow(o, laneY)) continue;
    if (!best || dx < best.gap) best = { car: o, gap: dx };
  }
  return best;
}

/** Rows: a car is in one if a collision circle (radius 7) is this close (px) to its centre line. */
const LANE_BODY_PX = 15;
/** A car less than this far ahead (px, centre to centre) is alongside, not in front... */
const AHEAD_PX = 24;
/** ...and in the way only this close across (px): touching side by side, on a single-file road. */
const SIDE_BY_SIDE_PX = 11;
/** A car moving over to the other row holds its line while a moving car alongside is this close across (px). */
const ACROSS_PX = 22;

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
 * Can a car leaving the pits take `lane`? Nobody alongside and nobody closing in within `closeS`;
 * with `brakeRoom`, a car coming up behind must also have room to slow to the merging
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
    // (not one still waiting in its box: a car crossing over in front of it drives on)
    if (o === car || !o.pitSide || o.ai.pitPhase !== 'exiting' || o.ai.pullOut === 1) continue;
    const dx = o.x - car.x;
    if (dx <= 0 || dx > 150 || Math.abs(o.y - car.y) > 16) continue;
    if (!best || dx < best.gap) best = { car: o, gap: dx };
  }
  return best;
}

/** Parking: the turn into the box row starts this far before the box (px)... */
const PARK_TURN_PX = 60;
/** ...at this speed (mph), braking at this share of the full rate on the way. */
const PARK_MPH = 14;
const PARK_BRAKE = 0.5;
/** A car this close (px) to the box row's centre line is in it. */
const PARK_IN_PX = 5;
/** A car still out of its box row next to the box rolls on into it at this speed (mph). */
const PARK_CREEP_MPH = 6;

/** A car entering the pits this far past its box gives up on it. */
const PAST_BOX_PX = 20;

/** Drives to the box: slows down with the distance left and stops in it. */
export function driveToBox(road: PitRoad, car: Car, cars: Car[], target: number): { target: number; lane: number } {
  const pxm = CONFIG.PX_PER_MPH;
  const bx = freeBox(road, car, cars);
  const dist = bx - car.x;
  const turnIn = dist < PARK_TURN_PX;
  const lane = turnIn ? road.boxY : road.driveY;
  // slow to PARK_MPH for the turn in, then to a stop at the box
  const b = (CONFIG.BRAKE_MPH_S * PARK_BRAKE) / pxm;
  const toTurn = Math.max(0, dist - PARK_TURN_PX);
  target = Math.min(target, Math.sqrt(PARK_MPH ** 2 + 2 * b * toTurn), Math.sqrt(2 * b * Math.max(0, dist - 2)));
  const parked = Math.abs(car.y - road.boxY) < PARK_IN_PX;
  // (held up next to the box, still out on the drive row: roll on into it)
  if (turnIn && !parked) target = Math.max(target, PARK_CREEP_MPH);
  if (dist < 6 && Math.abs(car.speed) < CONFIG.PIT_STOP_MPH && road.inBox(car.x, car.y) && (parked || dist < -6)) {
    car.ai.pitPhase = car.finished ? 'parked' : 'fueling';
  } else if (dist < -PAST_BOX_PX) {
    // Pushed past every free box (round a queue): drive out and try again next lap, as it cannot back up.
    car.ai.pitPhase = 'exiting';
  }
  return { target, lane };
}

/** A car leaving its box needs the drive row free this far ahead of it (px)... */
const PULL_ROOM_PX = 70;
/** ...though of a car driving away at PULL_AWAY_MPH or more only this far. */
const PULL_NEAR_PX = 45;
const PULL_AWAY_MPH = 8;
/** Cars queue this far apart, centre to centre (px). */
const QUEUE_GAP_PX = 46;
/** A car closer than this (px, centre to centre) is alongside a box: it drives on, the car in the box waits. */
const PULL_SIDE_PX = 40;
/** A car standing behind a box blocks the pull-out only this close (px, centre to centre). */
const PULL_LEVEL_PX = 16;
/** Under this (mph) a car counts as stopped. */
const STOPPED_MPH = 2;
/** A car pulling out waits for one that could not stop behind it braking at this share of the full rate... */
const PULL_BRAKE = 0.6;
/** ...while a car yields to it if it can stop at this share (with a little slack: it yields more readily). */
const YIELD_BRAKE = 0.7;
const YIELD_SLACK_PX = 12;
/** A car looks out for cars waiting to pull out this far ahead (px): further than it needs to stop from pit speed. */
const YIELD_LOOK_PX = 250;
/** A car waiting to pull out lets a car that does not give way go first if it gets there within this time (s). */
const PULL_EXIT_S = 1;
/** Crossing over to the drive row at no more than this (mph) until this close to it (px)... */
const PULL_MPH = 20;
const PULL_SLOW_PX = 12;
/** ...and crossing until this close (px). */
const PULL_ON_PX = 5;
/** Steering look-ahead (px) while crossing over: about full lock, so it clears the car in the next box. */
export const PULL_LOOK_PX = 25;

/** Distance (px) to stop from `mph` braking at `share` of the full rate. */
function stopPx(mph: number, share: number): number {
  const v = Math.max(0, mph) * CONFIG.PX_PER_MPH;
  return (v * v) / (2 * CONFIG.BRAKE_MPH_S * share * CONFIG.PX_PER_MPH);
}

/** A car on the pit road on its way in or out (the player's at any time: the pit autopilot only starts at the line). */
function pitTraffic(road: PitRoad, o: Car): boolean {
  return (o.ai.pitPhase === 'entering' || o.ai.pitPhase === 'exiting' || o.isPlayer) && road.onRoad(o.x, o.y);
}

/**
 * Gives way to a car waiting to pull out of its box: a car on its way in (the player's car too, under the
 * pit autopilot) once it is past the start of the pit wall, so that no queue backs up out of the pit road.
 * A car on its way out, or one still on the entry road, goes first.
 */
function yields(o: Car): boolean {
  return o.ai.pitPhase === 'entering' && o.pitSide && o.wasInPit;
}

/** Has to drive past x on the pit lane (a car going to a box further back turns in before). */
function passes(road: PitRoad, o: Car, x: number, cars: Car[]): boolean {
  return o.ai.pitPhase !== 'entering' || freeBox(road, o, cars) >= x - 20;
}

/**
 * Can a car waiting to pull out of its box (right of way over cars on their way in: `ai.pullOut` 1) go now? It
 * waits for a car that gives way to it (`yields`) only if that one could not stop behind it any more (or is
 * alongside: the others stop for it, `yieldToPullers`), for any other car that is about to come by, for a car
 * pulling out just ahead of it, and for room ahead on the drive row.
 */
export function canPullOut(road: PitRoad, car: Car, cars: Car[]): boolean {
  for (const o of cars) {
    if (o === car || !pitTraffic(road, o)) continue;
    const dx = o.x - car.x;
    if (o.ai.pullOut === 1) {
      // (of two waiting next to each other, the one further down the lane goes first)
      if (dx > 0 && dx < PULL_ROOM_PX) return false;
      continue;
    }
    // (a car turning into its box is not on the drive row)
    if (o.ai.pullOut === 0 && Math.abs(o.y - road.boxY) < 10) continue;
    if (dx >= 0) {
      if (dx < PULL_NEAR_PX || (dx < PULL_ROOM_PX && o.speed < PULL_AWAY_MPH)) return false;
      continue;
    }
    if (!passes(road, o, car.x, cars)) continue;
    // (it drives away from a car standing behind it, though not from one level with it)
    if (o.speed < STOPPED_MPH) {
      if (-dx < PULL_LEVEL_PX) return false;
      continue;
    }
    if (-dx < PULL_SIDE_PX) return false;
    const v = o.speed * CONFIG.PX_PER_MPH;
    // (a car on its way in that gives way goes first only if it cannot stop; any other if it is coming)
    if (yields(o) ? -dx - QUEUE_GAP_PX < stopPx(o.speed, PULL_BRAKE) + v * 0.15 : -dx - QUEUE_GAP_PX < v * PULL_EXIT_S) return false;
  }
  return true;
}

/**
 * Leaving the box. The car has right of way over cars on their way in at once (`ai.pullOut` 1: those that can
 * stop do so), waits in the box until `canPullOut`, then crosses over to the drive row (2), turning out at
 * no more than PULL_MPH.
 */
export function leaveBox(road: PitRoad, car: Car, cars: Car[], target: number): { target: number; lane: number } {
  const ai = car.ai;
  if (Math.abs(car.y - road.driveY) <= PULL_ON_PX) {
    ai.pullOut = 0;
    return { target, lane: road.driveY };
  }
  if (ai.pullOut < 2) {
    ai.pullOut = 1;
    if (!canPullOut(road, car, cars)) return { target: 0, lane: road.boxY };
    ai.pullOut = 2;
  }
  // (slow only while it turns out past the car in the next box)
  return { target: Math.abs(car.y - road.driveY) > PULL_SLOW_PX ? Math.min(target, PULL_MPH) : target, lane: road.driveY };
}

/**
 * Stops for a car pulling out of its box ahead, past which this car has to drive: once it is crossing, or
 * while it waits if this car gives way (`yields`) and can still stop for it. One that cannot (or is alongside)
 * drives on: the car in the box waits for it.
 */
export function yieldToPullers(road: PitRoad, car: Car, cars: Car[], plan: PitPlan): void {
  if (car.ai.pullOut > 0) return;
  let gap = Infinity;
  let v0 = 0;
  for (const o of cars) {
    if (o === car || o.ai.pullOut === 0) continue;
    const dx = o.x - car.x;
    if (dx <= 0 || dx > YIELD_LOOK_PX || dx >= gap || !passes(road, car, o.x, cars)) continue;
    if (o.ai.pullOut === 1) {
      if (!yields(car)) continue;
      const room = dx - QUEUE_GAP_PX;
      if (dx < PULL_SIDE_PX || (car.speed >= STOPPED_MPH && room + YIELD_SLACK_PX < stopPx(car.speed, YIELD_BRAKE))) continue;
    }
    gap = dx;
    v0 = Math.max(0, o.speed);
  }
  if (gap !== Infinity) plan.target = Math.min(plan.target, queueMph(v0, gap));
}

/**
 * The speed (mph) to follow a car doing `v0` mph `gap` px ahead at: it can still stop QUEUE_GAP_PX behind it if
 * that car stops (braking at YIELD_BRAKE); closer than that it drops back.
 */
export function queueMph(v0: number, gap: number): number {
  const v = Math.max(0, v0);
  return Math.sqrt(Math.max(0, v * v + (2 * CONFIG.BRAKE_MPH_S * YIELD_BRAKE * (gap - QUEUE_GAP_PX)) / CONFIG.PX_PER_MPH));
}

/**
 * Queues behind a car ahead on the pit lane, or passes a parked one on the other row, and stops for a car
 * pulling out of its box ahead (`yieldToPullers`).
 */
export function followInPits(road: PitRoad, car: Car, cars: Car[], plan: PitPlan, exitRoad = false): void {
  const pitY = plan.lane!;
  let ahead = pitCarAhead(road, car, pitY, cars, exitRoad);
  if (ahead && ahead.car.speed < 2 && ahead.gap < 80 && !isServicing(ahead.car) && ahead.car.ai.pullOut === 0) {
    // (round a car standing on the box row; on the drive row only round one that is not just waiting its turn)
    const other = pitY === road.driveY ? road.boxY : road.driveY;
    const phase = ahead.car.ai.pitPhase;
    const waiting = (phase === 'entering' || phase === 'exiting') && ahead.car.fuel > 0;
    if ((pitY === road.boxY || !waiting) && !pitCarAhead(road, car, other, cars, exitRoad, -PULL_SIDE_PX)) {
      plan.lane = other;
      ahead = null;
    }
  }
  if (ahead) plan.target = Math.min(plan.target, queueMph(ahead.car.speed, ahead.gap));
  giveWayAcross(car, cars, plan);
  yieldToPullers(road, car, cars, plan);
}

/**
 * Moving over to the other row, never into a moving car alongside in the way: hold the line until it is by
 * (dropping back behind one that is ahead; one level or behind is left behind).
 */
function giveWayAcross(car: Car, cars: Car[], plan: PitPlan): void {
  const to = plan.lane!;
  if (car.ai.pullOut === 2 || Math.abs(to - car.y) < 4) return;
  const dir = Math.sign(to - car.y);
  for (const o of cars) {
    if (o === car || o.speed < STOPPED_MPH || isServicing(o)) continue;
    const dx = o.x - car.x;
    const across = (o.y - car.y) * dir;
    if (Math.abs(dx) >= AHEAD_PX || across <= 0 || across >= ACROSS_PX) continue;
    plan.lane = car.y;
    if (dx > 0) plan.target = Math.min(plan.target, Math.max(0, o.speed - 5));
  }
}
