// The player's steering: keyboard / touch keys go through the ramp, plus the corner assist, plus
// (grip model) the straight assist target and the key cap. Shared by the race state and the tests.
import { CONFIG } from '../config';
import { type CurvatureTable, laneCurvature } from '../track/curvature';
import { inTurn, trackCurves, trackHeadingAt } from '../track/track';
import type { Car } from './car';
import { brakeAt, cornerAssist, curvatureAssist, maxCurvature, SteerRamp } from './physics';

export interface PlayerSteer {
  steer: number;
  /** Grip model: track heading for the straight assist (undefined in corners). */
  straightTo?: number;
}

/** What the player steering reads from a track (grip model): the curvature table and the road heading. */
export interface SteerTrack {
  readonly table: CurvatureTable;
  /** Road heading at the car (for the straight assist). */
  headingAt(car: Car): number;
}

export const OVAL_STEER: SteerTrack = {
  get table() {
    return trackCurves();
  },
  headingAt: (car) => trackHeadingAt(car.x, car.y),
};

/**
 * Grip model: the largest steer (0..1) a held key asks for, so that it uses KEY_CAP of the grip the
 * tyres have left after braking. 1 where full lock is within that (low speed).
 */
export function keyCap(car: Car, brake: boolean): number {
  const C = CONFIG;
  const G = C.GRIP;
  if (car.speed <= 0 || car.reverse) return 1;
  const v = car.speed * C.PX_PER_MPH;
  if (v < G.MIN_V) return 1;
  return Math.min(1, (G.KEY_CAP * gripLeft(car, brake)) / (v * v * maxCurvature(v)));
}

/** Lateral grip (px/s^2) left after braking, as the physics will see it. */
function gripLeft(car: Car, brake: boolean): number {
  const C = CONFIG;
  const G = C.GRIP;
  const fLong = brake ? brakeAt(car.speed) / C.BRAKE_MPH_S_HIGH : 0;
  return G.GRIP * Math.sqrt(1 - (G.FC_K * fLong) ** 2);
}

export class PlayerSteering {
  private readonly ramp = new SteerRamp();
  private assistLevel = 0;
  /** Grip model: how long the key has been held against the cap (s). */
  private pushTime = 0;
  private pushDir = 0;
  /** 0..1: how far towards full lock this push may open (from the largest excess seen). */
  private pushDepth = 0;

  constructor(private readonly track: SteerTrack = OVAL_STEER) {}

  /** New race: the assist blend starts from zero (the ramp keeps its state, as before). */
  resetAssist(): void {
    this.assistLevel = 0;
    this.pushTime = 0;
    this.pushDir = 0;
    this.pushDepth = 0;
  }

  /** Grip model: 0..1, how far a key held past the cap has opened the steering towards full lock. */
  get overdrive(): number {
    const G = CONFIG.GRIP;
    return Math.max(0, Math.min(1, (this.pushTime - G.OVERDRIVE_S) / G.OVERDRIVE_RAMP_S));
  }

  /** key: -1 left, 0 none, 1 right. brake: the brake pedal (grip model: braking leaves less grip to steer with). */
  update(car: Car, key: number, dt: number, brake = false): PlayerSteer {
    const C = CONFIG;
    const grip = C.DRIVE_MODEL === 'grip';
    let assist: number;
    let turn: boolean;
    let straightTo: number | undefined;
    let kLane = 0;
    if (grip) {
      const k = this.track.table.at(car.s);
      turn = k !== 0;
      kLane = laneCurvature(k, car.d);
      assist = curvatureAssist(car, kLane);
      if (!turn) straightTo = this.track.headingAt(car);
    } else {
      assist = cornerAssist(car);
      turn = inTurn(car.x);
    }
    const step = dt / C.CORNER_ASSIST_IN_S;
    this.assistLevel = assist !== 0 ? Math.min(1, this.assistLevel + step) : Math.max(0, this.assistLevel - step);
    const keySteer = this.ramp.update(key, dt, turn);
    const steer = Math.max(-1, Math.min(1, keySteer + assist * this.assistLevel));
    if (!grip) return { steer, straightTo };
    return { steer: this.capped(car, key, steer, dt, brake, kLane), straightTo };
  }

  // A held key asks for about the grip there is (KEY_CAP), like the AI's smooth driver, so a key or
  // touch player can drive at the limit. Holding the key into a corner the car is too fast for (its
  // line needs more than OVERDRIVE_OVER over the grip) opens the steering towards full lock: after
  // OVERDRIVE_S, over OVERDRIVE_RAMP_S, both shorter the further over the car is (up to
  // OVERDRIVE_RATE_MAX x), and only all the way at OVERDRIVE_OVER + OVERDRIVE_FULL over. A little
  // too fast and insisting stays understeer; far too fast and insisting lets the rear go. At the
  // limit it never overdrives.
  private capped(car: Car, key: number, steer: number, dt: number, brake: boolean, kLane: number): number {
    const G = CONFIG.GRIP;
    const cap = keyCap(car, brake);
    const v = car.speed * CONFIG.PX_PER_MPH;
    // how far the car's line needs more than the grip (0 = at the limit); only into the bend
    const need = kLane * key > 0 ? (v * v * Math.abs(kLane)) / gripLeft(car, brake) - 1 : 0;
    const pushing = key !== 0 && Math.sign(steer) === key && Math.abs(steer) > cap;
    if (!pushing || key !== this.pushDir) {
      this.pushTime = 0;
      this.pushDepth = 0;
      this.pushDir = pushing ? key : 0;
    }
    // The further over, the sooner and the deeper (towards full lock): the consequence grows with the excess.
    if (pushing && need > G.OVERDRIVE_OVER) {
      this.pushTime += dt * Math.min(G.OVERDRIVE_RATE_MAX, need / G.OVERDRIVE_OVER);
      this.pushDepth = Math.max(this.pushDepth, Math.min(1, (need - G.OVERDRIVE_OVER) / G.OVERDRIVE_FULL));
    }
    const lim = cap + (1 - cap) * this.overdrive * this.pushDepth;
    return Math.max(-lim, Math.min(lim, steer));
  }
}
