// PLAYTEST ONLY (STEERING_PLAN B7), removed before merge: the key steering before the wheel (the ramp,
// instant release, the straight assist on every straight), behind the debug flag steer=old, so the
// playtest compares both in one build. A copy of src/race/steering.ts as it was on main (bb07060).
import { CONFIG } from '../config';
import { laneCurvature } from '../track/curvature';
import type { Car } from './car';
import { curvatureAssist } from './physics';
import type { PlayerSteer, SteerTrack } from './steering';
import { gripLeft, keyCap } from './steering';

/** The old SteerRamp with its constants (STEER_MIN, STEER_RAMP_S, STEER_MIN_TURN, STEER_RAMP_TURN_S, STEER_RELEASE_S). */
class OldRamp {
  private dir = 0;
  private level = 0;

  update(dir: number, dt: number, turn: boolean): number {
    const min = turn ? 0.3 : 0.15;
    const ramp = turn ? 0.15 : 0.3;
    if (dir === 0) {
      this.level = Math.max(0, this.level - dt / 0.2);
      return 0;
    }
    if (dir !== this.dir) {
      this.dir = dir;
      this.level = 0;
    }
    this.level = Math.min(1, Math.max(this.level, min) + ((1 - min) * dt) / ramp);
    return dir * this.level;
  }
}

export class OldSteering {
  private readonly ramp = new OldRamp();
  private assistLevel = 0;
  private pushTime = 0;
  private pushDir = 0;
  private pushDepth = 0;
  /** Debug: the last limit (with the overdrive) and the ramp's steer. */
  lim = 1;
  keySteer = 0;

  constructor(private readonly assistScale: number) {}

  resetAssist(): void {
    this.assistLevel = 0;
    this.pushTime = 0;
    this.pushDir = 0;
    this.pushDepth = 0;
  }

  get overdrive(): number {
    const G = CONFIG.GRIP;
    return Math.max(0, Math.min(1, (this.pushTime - G.OVERDRIVE_S) / G.OVERDRIVE_RAMP_S));
  }

  update(track: SteerTrack, car: Car, key: number, dt: number, brake: boolean): PlayerSteer {
    const C = CONFIG;
    const k = track.curves().at(car.s);
    const turn = k !== 0;
    const kLane = laneCurvature(k, car.d);
    const assist = curvatureAssist(car, kLane) * this.assistScale;
    const straightTo = turn ? undefined : track.headingAt(car.x, car.y);
    const step = dt / C.CORNER_ASSIST_IN_S;
    this.assistLevel = assist !== 0 ? Math.min(1, this.assistLevel + step) : Math.max(0, this.assistLevel - step);
    this.keySteer = this.ramp.update(key, dt, turn);
    const steer = Math.max(-1, Math.min(1, this.keySteer + assist * this.assistLevel));
    return { steer: this.capped(car, key, steer, dt, brake, kLane), straightTo };
  }

  private capped(car: Car, key: number, steer: number, dt: number, brake: boolean, kLane: number): number {
    const G = CONFIG.GRIP;
    const cap = keyCap(car, brake);
    const v = car.speed * CONFIG.PX_PER_MPH;
    const need = kLane * key > 0 ? (v * v * Math.abs(kLane)) / gripLeft(car, brake) - 1 : 0;
    const pushing = key !== 0 && Math.sign(steer) === key && Math.abs(steer) > cap;
    if (pushing && key !== this.pushDir) {
      this.pushTime = 0;
      this.pushDepth = 0;
      this.pushDir = key;
    } else if (!pushing) {
      this.pushTime = Math.max(0, this.pushTime - dt * G.OVERDRIVE_DECAY);
      if (this.pushTime === 0) {
        this.pushDepth = 0;
        this.pushDir = 0;
      }
    }
    if (pushing && need > G.OVERDRIVE_OVER) {
      this.pushTime = Math.min(
        G.OVERDRIVE_S + G.OVERDRIVE_RAMP_S,
        this.pushTime + dt * Math.min(G.OVERDRIVE_RATE_MAX, need / G.OVERDRIVE_OVER),
      );
      this.pushDepth = Math.max(this.pushDepth, Math.min(1, (need - G.OVERDRIVE_OVER) / G.OVERDRIVE_FULL));
    }
    this.lim = cap + (1 - cap) * this.overdrive * this.pushDepth;
    return Math.max(-this.lim, Math.min(this.lim, steer));
  }
}
