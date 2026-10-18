import { CONFIG } from '../config';
import type { AiView } from '../race/ai';
import type { Car } from '../race/car';
import { fillTarget } from '../race/fuel';
import { CAR_R, type Constrainable, HALF_W, LANES, type PitLane, type PitPlan, type WallNormal } from './common';
import { driveToBox, followInPits, mergeClear, type PitRoad, pitDriveLaneBusy } from './pitAi';

/**
 * Cross-section of a pit lane north of an east-bound straight, as offsets from the straight's
 * centre line (negative = north). The same profile as the oval's pit road.
 */
export const PIT_D = {
  LABEL_TOP: -119,
  BOX_TOP: -104,
  LANE_TOP: -83,
  WALL_TOP: -55,
  SEP: -HALF_W,
  BOX: -93.5,
  DRIVE: -68,
};

export const NUM_BOXES = 20;
const TAPER = 180;
const ENTRY0 = 30;
const BOX_GAP = 50;
/** AI drivers look at the fuel gauge this far before the main straight. */
const DECIDE_FROM = 900;
const DECIDE_TO = 300;
const EXIT_D = -HALF_W + 13;
const ENTRY_LOOK = 70;
/** Right of this near the pit wall's end, a car still has the track lane to itself and can stay out. */
const STILL_ON_TRACK_D = -44;
const JAM_S = 6;
/** The pit wall: centre line, half thickness and the length of its pointed ends. */
export const SEP_MID = (PIT_D.WALL_TOP + PIT_D.SEP) / 2;
const SEP_HALF = (PIT_D.SEP - PIT_D.WALL_TOP) / 2;
export const NOSE = 30;

/** Where the pit lane sits along the main straight (u = distance from the straight's start). */
export interface PitGeo {
  /** World position of the start of the main straight's centre line. */
  x0: number;
  y0: number;
  entry0: number;
  wall0: number;
  box0: number;
  boxPitch: number;
  box1: number;
  wall1: number;
  exit1: number;
  lineIn: number;
  lineOut: number;
}

export function pitGeo(x0: number, y0: number, straightLen: number): PitGeo {
  const wall0 = ENTRY0 + TAPER;
  const exit1 = straightLen - ENTRY0;
  const wall1 = exit1 - TAPER;
  const boxPitch = Math.floor((wall1 - wall0 - 2 * BOX_GAP) / NUM_BOXES);
  const box0 = wall0 + BOX_GAP;
  const box1 = box0 + NUM_BOXES * boxPitch;
  return { x0, y0, entry0: ENTRY0, wall0, box0, boxPitch, box1, wall1, exit1, lineIn: box0 + 14, lineOut: box1 - 22 };
}

/** The lap, as far as the pit lane needs it: s at the start of the main straight. */
export interface PitTrackRef {
  readonly startS: number;
  readonly len: number;
  deltaS(a: number, b: number): number;
}

/** A pit lane running alongside the main straight, entered from the left lane and rejoining before turn 1. */
export class StraightPit implements PitLane {
  private readonly road: PitRoad;

  constructor(
    readonly geo: PitGeo,
    private readonly lap: PitTrackRef,
  ) {
    this.road = {
      // Queueing also sees cars still on the entry road.
      inLane: (x, y) => this.inQueue(x, y),
      inBox: (x, y) => this.inBox(x, y),
      boxX: (i) => this.boxX(i),
      numBoxes: NUM_BOXES,
      boxPitch: geo.boxPitch,
      boxY: geo.y0 + PIT_D.BOX,
      driveY: geo.y0 + PIT_D.DRIVE,
    };
  }

  /** Distance past the start of the main straight (negative before it). */
  private along(s: number): number {
    return this.lap.deltaS(this.lap.startS, s);
  }

  boxX(i: number): number {
    return this.geo.x0 + this.geo.box0 + this.geo.boxPitch * (i + 0.5);
  }

  private u(x: number): number {
    return x - this.geo.x0;
  }

  private d(y: number): number {
    return y - this.geo.y0;
  }

  inLane(x: number, y: number): boolean {
    const u = this.u(x);
    const d = this.d(y);
    return u >= this.geo.box0 && u <= this.geo.box1 && d > PIT_D.BOX_TOP - 4 && d < PIT_D.WALL_TOP + 4;
  }

  private inQueue(x: number, y: number): boolean {
    const u = this.u(x);
    const d = this.d(y);
    return u >= this.geo.entry0 && u <= this.geo.box1 && d > PIT_D.BOX_TOP - 4 && d < PIT_D.SEP - 4;
  }

  inBox(x: number, y: number): boolean {
    const u = this.u(x);
    const d = this.d(y);
    return u >= this.geo.box0 && u <= this.geo.box1 && d > PIT_D.BOX_TOP - 4 && d < PIT_D.LANE_TOP + 6;
  }

  private inWallRange(x: number): boolean {
    const u = this.u(x);
    return u >= this.geo.wall0 && u <= this.geo.wall1;
  }

  walled(a: Constrainable, b: Constrainable): boolean {
    return this.inWallRange(a.x) && this.inWallRange(b.x) && a.wasInPit && b.wasInPit && a.pitSide !== b.pitSide;
  }

  /** Left (north) edge of the entry and exit roads at u, for a car centre; null away from them. */
  taperEdge(u: number): number | null {
    const g = this.geo;
    if (u < g.entry0 || u > g.exit1) return null;
    const f = u < g.wall0 ? (u - g.entry0) / (g.wall0 - g.entry0) : (g.exit1 - u) / (g.exit1 - g.wall1);
    return PIT_D.SEP + (PIT_D.BOX_TOP - PIT_D.SEP) * Math.min(1, f) + CAR_R;
  }

  /**
   * Walls of the pit lane for a car on the main straight's tarmac band (`d` = offset from the
   * straight's centre line). Returns undefined when the pit lane is not involved here.
   */
  /**
   * Walls of the pit lane for a car on the main straight. The pit wall starts and ends in a
   * pointed nose, so a car that meets it is steered to one side instead of stopping dead.
   * Returns undefined when the pit lane is not involved here.
   */
  constrain(p: Constrainable): WallNormal | null | undefined {
    const g = this.geo;
    const r = CAR_R;
    const u = this.u(p.x);
    const d = this.d(p.y);
    if (u < g.wall0 || u > g.wall1) {
      p.wasInPit = false;
      return undefined;
    }
    if (!p.wasInPit) {
      p.pitSide = d < SEP_MID;
      p.wasInPit = true;
    }
    const w = SEP_HALF * Math.min(1, (u - g.wall0) / NOSE, (g.wall1 - u) / NOSE);
    if (p.pitSide) {
      if (d > SEP_MID - w - r) {
        p.y = g.y0 + SEP_MID - w - r;
        return { nx: 0, ny: -1 };
      }
      if (d < PIT_D.BOX_TOP + r) {
        p.y = g.y0 + PIT_D.BOX_TOP + r;
        return { nx: 0, ny: 1 };
      }
      return null;
    }
    if (d < SEP_MID + w + r) {
      p.y = g.y0 + SEP_MID + w + r;
      return { nx: 0, ny: 1 };
    }
    return undefined;
  }

  decideAt(s: number): boolean {
    const du = this.along(s);
    return du > -DECIDE_FROM && du < -DECIDE_TO;
  }

  get reachLaps(): number {
    return (DECIDE_FROM + this.geo.box1) / this.lap.len;
  }

  joiningD(o: Car): number {
    const du = this.along(o.s);
    if (o.ai.pitPhase === 'exiting' && !o.pitSide && o.speed > 15 && du > 0) return Math.max(o.d, EXIT_D);
    if (o.ai.pitPhase === 'entering' && du > -DECIDE_FROM && du < this.geo.entry0) return Math.min(o.d, -HALF_W + 9);
    return o.d;
  }

  diving(car: Car): boolean {
    const du = this.along(car.s);
    return car.ai.pitPhase === 'entering' && du > -120 && du < this.geo.exit1;
  }

  autoIn(car: Car): boolean {
    const x = this.geo.x0 + this.geo.lineIn;
    return car.prevX < x && car.x >= x && car.pitSide && this.inLane(car.x, car.y);
  }

  autoOut(car: Car): boolean {
    return car.x >= this.geo.x0 + this.geo.lineOut || !car.pitSide;
  }

  plan(car: Car, view: AiView, target: number, laneD: number, _dt: number): PitPlan {
    const ai = car.ai;
    const g = this.geo;
    const road = this.road;
    const pxm = CONFIG.PX_PER_MPH;
    const du = this.along(car.s);
    let lane: number | null = null;
    if (ai.pitPhase === 'none' && car.pitSide && car.wasInPit && du > g.wall0 && du < g.wall1) ai.pitPhase = 'exiting';
    const dy = car.y - g.y0;

    switch (ai.pitPhase) {
      case 'entering':
        if (du >= g.entry0 - 20 && du <= g.exit1) {
          target = Math.min(target, CONFIG.AI_PIT_MPH);
          // Not heading over to the pit side in time, or stuck in a jam at the entry: stay out
          // and try again next lap.
          const late = du > g.wall0 - 40 && du < g.wall0 && dy > STILL_ON_TRACK_D && car.speed > 15;
          const jammed = du < g.wall0 && ai.stuckTime > JAM_S;
          if ((du >= g.wall0 && !car.pitSide) || late || jammed) {
            ai.pitPhase = 'none';
            break;
          }
          if (du < g.wall0) {
            // Follow the entry road's diagonal wall instead of cutting into its corner.
            const f = Math.max(0, Math.min(1, (du + ENTRY_LOOK - g.entry0) / (g.wall0 - g.entry0)));
            lane = g.y0 + Math.max(PIT_D.DRIVE, PIT_D.SEP + (PIT_D.BOX_TOP - PIT_D.SEP) * f + CAR_R + 6);
          } else {
            const box = driveToBox(road, car, view.cars, target);
            target = box.target;
            lane = box.lane;
          }
        } else {
          // Move over to the pit side on the straight and brake for the entry.
          laneD = du > -120 ? -HALF_W + 9 : LANES[0]!;
          const dist = Math.max(0, g.entry0 - du);
          target = Math.min(target, Math.sqrt(CONFIG.AI_PIT_MPH ** 2 + (2 * CONFIG.BRAKE_MPH_S * 0.75 * dist) / pxm));
        }
        break;
      case 'fueling':
        lane = road.boxY;
        target = 0;
        if (!this.inLane(car.x, car.y)) ai.pitPhase = car.fuel > 0.6 ? 'exiting' : 'none';
        else if (car.fuel >= (car.isPlayer ? 0.999 : fillTarget(car, view.track, view.laps))) ai.pitPhase = 'exiting';
        break;
      case 'parked':
        lane = road.boxY;
        target = 0;
        break;
      case 'exiting':
        if (car.pitSide && du < g.wall1) {
          lane = road.driveY;
          target = CONFIG.AI_PIT_MPH;
          if (car.y < road.driveY - 8 && pitDriveLaneBusy(road, car, view.cars)) {
            lane = road.boxY;
            target = 0;
          }
        } else {
          laneD = mergeClear(view.track, car, LANES[0]!, view.cars) ? LANES[0]! : EXIT_D;
          target = Math.min(target, CONFIG.AI_PIT_MPH + 30);
          if (Math.abs(car.d - LANES[0]!) < 5 || du > g.exit1 + 60 || du < 0) {
            ai.pitPhase = 'none';
            ai.lane = LANES[0]!;
          }
        }
        break;
      default:
        break;
    }
    return { target, laneD, lane };
  }

  follow(car: Car, view: AiView, plan: PitPlan): void {
    if (car.x - this.geo.x0 >= this.geo.wall0) {
      followInPits(this.road, car, view.cars, plan);
      return;
    }
    // Single file on the entry road: queue behind whoever is ahead, never swap rows here.
    let gap = Infinity;
    let ahead: Car | null = null;
    for (const o of view.cars) {
      const dx = o.x - car.x;
      if (o === car || dx <= 0 || dx > 150 || Math.abs(o.y - car.y) > 16) continue;
      if (dx < gap) {
        gap = dx;
        ahead = o;
      }
    }
    if (ahead) {
      const v0 = Math.max(0, ahead.speed);
      const room = Math.max(0, gap - 46);
      plan.target = Math.min(plan.target, Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / CONFIG.PX_PER_MPH));
    }
  }

  aim(car: Car, lane: number, look: number): { x: number; y: number } {
    const nearBox = car.ai.pitPhase === 'entering' && this.boxX(car.ai.box) - car.x < 60;
    return { x: car.x + (nearBox ? 22 : Math.max(look, 50)), y: lane };
  }
}
