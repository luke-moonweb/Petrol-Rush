import type { AiView } from '../race/ai';
import type { Car } from '../race/car';
import type { CurvatureTable } from './curvature';

/** Half the width of the tarmac – the same on every track, so the four AI lanes fit everywhere. */
export const HALF_W = 47;
export const LANES = [-28.5, -9.5, 9.5, 28.5];
export const CAR_R = 7;
export const NUM_SECTORS = 8;

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export interface TrackPoint {
  x: number;
  y: number;
  heading: number;
}

export interface Frenet {
  s: number;
  d: number;
}

export interface WallNormal {
  nx: number;
  ny: number;
}

export interface Constrainable {
  x: number;
  y: number;
  pitSide: boolean;
  wasInPit: boolean;
}

/** The arc a car is in: its centre and the turn direction (-1 = left, i.e. heading decreases). */
export interface Corner {
  cx: number;
  cy: number;
  dir: 1 | -1;
}

/** How the pit driver wants to move the car this step; `lane` is null when the car races normally. */
export interface PitPlan {
  target: number;
  laneD: number;
  lane: number | null;
}

export interface PitLane {
  /** On pit lane tarmac: no crashes and no oil here. */
  inLane(x: number, y: number): boolean;
  inBox(x: number, y: number): boolean;
  /** Two cars on opposite sides of the pit wall cannot touch. */
  walled(a: Constrainable, b: Constrainable): boolean;
  /** The stretch of track on which AI drivers decide whether to pit this lap. */
  decideAt(s: number): boolean;
  /** The player crossed the PIT LANE line – the pit autopilot takes over. */
  autoIn(car: Car): boolean;
  /** The player is past PIT EXIT (or left the pit side) – control goes back. */
  autoOut(car: Car): boolean;
  /** Grip model: fuel (laps) from the start of the decision window to the far end of the pit lane. */
  readonly reachLaps: number;
  /** Grip model: the line a car going to or from the pits is moving to (its own d otherwise). */
  joiningD(o: Car): number;
  /** A car committed to the pit entry: it holds its line (no lane changes for oil or hazards). */
  diving(car: Car): boolean;
  /** AI pit driving: entry, box, refuelling and exit. */
  plan(car: Car, view: AiView, target: number, laneD: number, dt: number): PitPlan;
  /** Queueing behind other cars on the pit lane. */
  follow(car: Car, view: AiView, plan: PitPlan): void;
  /** Steering aim on the pit lane. */
  aim(car: Car, lane: number, look: number): { x: number; y: number };
}

export interface Track {
  readonly id: string;
  readonly name: string;
  readonly len: number;
  readonly sectorLen: number;
  readonly worldW: number;
  readonly worldH: number;
  readonly pit: PitLane;
  wrapS(s: number): number;
  deltaS(a: number, b: number): number;
  pointAt(s: number, d: number): TrackPoint;
  project(x: number, y: number): Frenet;
  headingAt(x: number, y: number): number;
  /** Keeps a car inside the walls; returns the wall normal on contact. */
  constrain(p: Constrainable): WallNormal | null;
  gridSlot(slot: number): Frenet;
  /** Signed centre-line curvature (1/px) at s: + = heading increases, 0 on straights. */
  curvatureAt(s: number): number;
  /** The track's curvature table (built once), read by the AI planner, assist and warnings. */
  curves(): CurvatureTable;
}
