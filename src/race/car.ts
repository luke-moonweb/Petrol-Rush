import { NUM_SECTORS, type Track } from '../track/common';
import type { Level, Persona } from './persona';

export type PitPhase = 'none' | 'entering' | 'fueling' | 'exiting' | 'parked';

export interface AiState {
  topMph: number;
  turnMph: number;
  lane: number;
  laneCooldown: number;
  pitPhase: PitPhase;
  /** Index of the car's own pit box. */
  box: number;
  /** The driver stops once the tank is down to this many laps of the oval (if it cannot finish). */
  pitFuelLaps: number;
  /** 0..1: how readily the driver lifts to stretch the fuel to the finish (race/fuel.ts). */
  fuelSave: number;
  /** Saving fuel this step: a lower top speed. */
  economy: boolean;
  stuckTime: number;
  reaction: number;
  hazardTime: number;
  recoverTime: number;
  creepTime: number;
  oilTime: number;
  /** Grip model: seconds stopped at the end of the pit road waiting to merge. */
  mergeWait: number;
  /** Grip model: the car leaving the pits has committed to merging (racing cars allow for it). */
  merging: boolean;
  /** Grip model: heading for the pit entry but held on its line by traffic (counted there, not on the pit approach line). */
  pitHeld: boolean;
  /** Grip model: the last pit stop was skipped (the next one may not be). */
  skipped: boolean;
  /** Running estimate of the fuel one lap takes, from the laps driven (race/fuel.ts). */
  fuelPerLap: number;
  /** Fuel at the last start/finish crossing; -1 before the first. */
  lapFuel: number;
  refuelledThisLap: boolean;
  /** On the racing line (no car alongside), not on a lane. */
  onLine: boolean;
  /** The driver's personality draw (0..1) and the personality it gives (race/persona.ts). */
  temper: number;
  persona: Persona;
  /** The difficulty level the driver races at. */
  level: Level;
  /** Blocker: the inside lane held through the next corner (null when not blocking). */
  blockLane: number | null;
  /** Blocker: the held corner has started (the block ends where it does). */
  blockIn: boolean;
  /** Turn-in slide (ai.ts planSlide): 0 none, 1 planned for the next corner, 2 sliding in, 3 catching the rear. */
  slide: 0 | 1 | 2 | 3;
  /** Seconds into the current slide phase. */
  slideTime: number;
  /** The way the slid corner turns (+1 / -1). */
  slideDir: number;
  /** Start (s) of the corner the slide was decided for (one decision per corner). */
  slideRun: number;
}

export interface Car {
  id: number;
  colorIdx: number;
  isPlayer: boolean;

  x: number;
  y: number;
  prevX: number;
  prevY: number;
  prevHeading: number;
  heading: number;
  moveAngle: number;
  speed: number;
  reverse: boolean;
  fuel: number;
  /** 0..1: how far into another car's slipstream (less fuel on the gas). */
  draft: number;

  spinTime: number;
  spinDir: number;
  spinRate: number;
  crashes: number;
  overTime: number;
  slideTime: number;
  /** Grip model: last step's combined grip use (0 = free rolling, 1 = at the limit). */
  gripUse: number;
  /** Grip model: demand above the limit (0 when within grip). */
  gripOver: number;
  /** Grip model: the way the driver steers (+1 = heading increasing, -1, 0 straight), for wall contacts. */
  turnDir: number;
  /** Grip model: the rear has let go (oversteer). */
  rearLoose: boolean;
  /** Grip model: 0..1 build-up towards the rear letting go. */
  rearStress: number;
  /** Grip model: smoothed load on the front from lifting or braking (0..1). */
  weightFwd: number;
  /** Grip model: largest slip angle of the current rear slide (rad), 0 when the rear holds. */
  slipPeak: number;
  /** Grip model: nose rotation (rad) a wall contact still has to apply, a little per step. */
  wallYaw: number;
  /** Grip model: seconds since the last wall contact. */
  wallAgo: number;
  penalty: number;
  penaltyAt: number;
  oilImmune: number;
  braking: boolean;
  brakeHold: number;

  s: number;
  d: number;
  lastSector: number;
  sectorsPassed: number;

  finished: boolean;
  finishPos: number;
  finalProgress: number;
  finalSectors: number;

  pitSide: boolean;
  wasInPit: boolean;
  refueling: boolean;
  wallImpact: number;
  contactX: number;
  contactY: number;
  contactStrength: number;
  contactPrev: number;

  ai: AiState;
}

export function lapsCompleted(car: Car): number {
  const sectors = car.finished ? car.finalSectors : car.sectorsPassed;
  return Math.max(0, Math.floor(sectors / NUM_SECTORS));
}

export function progress(car: Car, track: Track): number {
  if (car.finished) return car.finalProgress;
  const len = track.len;
  const sectorLen = track.sectorLen;
  let off = car.s - car.lastSector * sectorLen;
  if (off < -len / 2) off += len;
  if (off > len / 2) off -= len;
  off = Math.min(Math.max(off, 0), sectorLen);
  return car.sectorsPassed * sectorLen + off;
}

export function initProgress(car: Car, track: Track): void {
  const sec = Math.floor(car.s / track.sectorLen) % NUM_SECTORS;
  car.lastSector = sec;
  car.sectorsPassed = car.s < track.len / 2 ? sec : sec - NUM_SECTORS;
}

export function updateProgress(car: Car, track: Track): boolean {
  const sec = Math.floor(car.s / track.sectorLen) % NUM_SECTORS;
  if (sec === (car.lastSector + 1) % NUM_SECTORS) {
    car.lastSector = sec;
    car.sectorsPassed++;
    return sec === 0;
  }
  return false;
}

export function isServicing(o: Car): boolean {
  return o.ai.pitPhase === 'fueling' || o.ai.pitPhase === 'parked' || o.refueling;
}
