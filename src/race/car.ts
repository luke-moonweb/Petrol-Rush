import { NUM_SECTORS, SECTOR_LEN, TRACK_LEN } from '../track/track';

export type PitPhase = 'none' | 'entering' | 'fueling' | 'exiting' | 'parked';

export interface AiState {
  topMph: number;
  turnMph: number;
  lane: number;
  laneCooldown: number;
  pitPhase: PitPhase;
  boxX: number;
  pitFuelLaps: number;
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
  /** Grip model: the last pit stop was skipped (the next one may not be). */
  skipped: boolean;
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

export function progress(car: Car): number {
  if (car.finished) return car.finalProgress;
  let off = car.s - car.lastSector * SECTOR_LEN;
  if (off < -TRACK_LEN / 2) off += TRACK_LEN;
  if (off > TRACK_LEN / 2) off -= TRACK_LEN;
  off = Math.min(Math.max(off, 0), SECTOR_LEN);
  return car.sectorsPassed * SECTOR_LEN + off;
}

export function initProgress(car: Car): void {
  const sec = Math.floor(car.s / SECTOR_LEN) % NUM_SECTORS;
  car.lastSector = sec;
  car.sectorsPassed = car.s < TRACK_LEN / 2 ? sec : sec - NUM_SECTORS;
}

export function updateProgress(car: Car): boolean {
  const sec = Math.floor(car.s / SECTOR_LEN) % NUM_SECTORS;
  if (sec === (car.lastSector + 1) % NUM_SECTORS) {
    car.lastSector = sec;
    car.sectorsPassed++;
    return sec === 0;
  }
  return false;
}
