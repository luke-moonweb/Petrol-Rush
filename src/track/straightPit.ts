import type { AiView } from '../race/ai';
import type { Car } from '../race/car';
import { CAR_R, type Constrainable, HALF_W, type PitLane, type PitPlan, type WallNormal } from './common';

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

/** A pit lane running alongside the main straight, entered from the left lane and rejoining before turn 1. */
export class StraightPit implements PitLane {
  constructor(readonly geo: PitGeo) {}

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

  /** Left (north) edge of the drivable area outside the walled section, for a car centre. */
  private taperEdge(u: number): number | null {
    const g = this.geo;
    const f = u < g.wall0 ? (u - g.entry0) / (g.wall0 - g.entry0) : (g.exit1 - u) / (g.exit1 - g.wall1);
    if (f <= 0) return null;
    return PIT_D.SEP + (PIT_D.BOX_TOP - PIT_D.SEP) * Math.min(1, f) + CAR_R;
  }

  /**
   * Walls of the pit lane for a car on the main straight's tarmac band (`d` = offset from the
   * straight's centre line). Returns undefined when the pit lane is not involved here.
   */
  constrain(p: Constrainable, leftEdge: number): WallNormal | null | undefined {
    const g = this.geo;
    const r = CAR_R;
    const u = this.u(p.x);
    const d = this.d(p.y);
    if (u < g.entry0 - r || u > g.exit1 + r) return undefined;
    const band = d > PIT_D.WALL_TOP - r && d < PIT_D.SEP + r;
    if (u >= g.wall0 && u <= g.wall1) {
      if (!p.wasInPit) {
        if (band) {
          if (u - g.wall0 < g.wall1 - u) {
            p.x = g.x0 + g.wall0 - r;
            return { nx: -1, ny: 0 };
          }
          p.x = g.x0 + g.wall1 + r;
          return { nx: 1, ny: 0 };
        }
        p.pitSide = d < (PIT_D.WALL_TOP + PIT_D.SEP) / 2;
        p.wasInPit = true;
      }
      if (p.pitSide) {
        if (d > PIT_D.WALL_TOP - r) {
          p.y = g.y0 + PIT_D.WALL_TOP - r;
          return { nx: 0, ny: -1 };
        }
        if (d < PIT_D.BOX_TOP + r) {
          p.y = g.y0 + PIT_D.BOX_TOP + r;
          return { nx: 0, ny: 1 };
        }
        return null;
      }
      if (d < PIT_D.SEP + r) {
        p.y = g.y0 + PIT_D.SEP + r;
        return { nx: 0, ny: 1 };
      }
      return undefined;
    }
    p.wasInPit = false;
    if (band) {
      if (u >= g.wall0 - r && u < g.wall0) {
        p.x = g.x0 + g.wall0 - r;
        return { nx: -1, ny: 0 };
      }
      if (u > g.wall1 && u <= g.wall1 + r) {
        p.x = g.x0 + g.wall1 + r;
        return { nx: 1, ny: 0 };
      }
    }
    const edge = Math.min(leftEdge, this.taperEdge(u) ?? leftEdge);
    if (d < edge) {
      p.y = g.y0 + edge;
      return { nx: 0, ny: 1 };
    }
    return d < PIT_D.SEP ? null : undefined;
  }

  decideAt(): boolean {
    return false;
  }

  autoIn(car: Car): boolean {
    const x = this.geo.x0 + this.geo.lineIn;
    return car.prevX < x && car.x >= x && car.pitSide && this.inLane(car.x, car.y);
  }

  autoOut(car: Car): boolean {
    return car.x >= this.geo.x0 + this.geo.lineOut || !car.pitSide;
  }

  plan(_car: Car, _view: AiView, target: number, laneD: number): PitPlan {
    return { target, laneD, lane: null };
  }

  follow(): void {}

  aim(car: Car, lane: number, look: number): { x: number; y: number } {
    return { x: car.x + look, y: lane };
  }
}
