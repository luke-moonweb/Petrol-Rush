// The player's steering: keyboard / touch keys turn a virtual wheel (w, the share of the steering range a
// held key may use, so the same press is the same share of the grip at any speed), plus the corner assist,
// plus (grip model) the straight assist target and the key cap. Shared by the race state and the tests.
import { CONFIG } from '../config';
import { type Track, wrapAngle } from '../track/common';
import { laneCurvature } from '../track/curvature';
import { OVAL } from '../track/ovalTrack';
import type { Car } from './car';
import { brakeAt, curvatureAssist, gripAt, maxCurvature } from './physics';
import { OldSteering } from './steeringOld';

/** What the player steering reads from a track: curvature and the road heading. */
export type SteerTrack = Pick<Track, 'curves' | 'headingAt'>;

export interface PlayerSteer {
  steer: number;
  /** Grip model: track heading for the straight assist (undefined in corners). */
  straightTo?: number;
}

/** The wheel's constants: B (CONFIG), E (a softer attack) or the old ramp. PLAYTEST ONLY (debug flag steer). */
export type SteerSet = 'B' | 'E' | 'old';

/** PLAYTEST ONLY (debug flags steer, assist; STEERING_PLAN B7): removed before merge. */
export interface SteerOptions {
  set: SteerSet;
  /** Corner assist strength (CONFIG.CORNER_ASSIST when undefined). */
  assist?: number;
}

/** Set E: the wheel's attack, softer at first (gamma) and quicker overall. */
const SET_E = { inS: 0.1, overshoot: 0.2, gamma: 1.5 };

function wheelConsts(set: SteerSet): { inS: number; overshoot: number; gamma: number } {
  const C = CONFIG;
  return set === 'E' ? SET_E : { inS: C.STEER_IN_S, overshoot: C.STEER_OVERSHOOT, gamma: C.STEER_GAMMA };
}

const assistScale = (o: SteerOptions) => (o.assist === undefined ? 1 : o.assist / CONFIG.CORNER_ASSIST);

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
export function gripLeft(car: Car, brake: boolean): number {
  const C = CONFIG;
  const G = C.GRIP;
  const fLong = brake ? brakeAt(car.speed) / C.BRAKE_MPH_S_HIGH : 0;
  return gripAt(car.speed * C.PX_PER_MPH) * Math.sqrt(1 - (G.FC_K * fLong) ** 2);
}

export class PlayerSteering {
  private assistLevel = 0;
  /** The lane curvature of the last bend (the assist fades out from it). */
  private bendK = 0;
  /** The virtual wheel, -1..1 (+ = right): ±1 asks for the key cap, 0 for the corner assist alone. */
  private w = 0;
  /** Grip model: how long the key has been held against the cap (s). */
  private pushTime = 0;
  private pushDir = 0;
  /** 0..1: how far towards full lock this push may open (from the largest excess seen). */
  private pushDepth = 0;
  /** The straight assist acts until a fresh key press on a straight; `carried` is a key held since the bend. */
  private straightOn = true;
  private carried = 0;
  /** The steering limit of the last step: the key cap, opened by the overdrive. */
  private lim = 1;
  private readonly old: OldSteering | null;

  /** The track raced on (the race state sets it for each race). */
  constructor(
    public track: SteerTrack = OVAL,
    readonly opts: SteerOptions = { set: 'B' },
  ) {
    this.old = opts.set === 'old' ? new OldSteering(assistScale(opts)) : null;
  }

  /** New race: the wheel, the assist blend and the overdrive start from zero, and the straight assist is on. */
  resetAssist(): void {
    this.old?.resetAssist();
    this.assistLevel = 0;
    this.bendK = 0;
    this.w = 0;
    this.pushTime = 0;
    this.pushDir = 0;
    this.pushDepth = 0;
    this.rearm(0);
  }

  /** The keys let go without a release (pause, lost focus): the wheel is centred, the assist blend kept. */
  release(): void {
    this.w = 0;
  }

  /** The straight assist is back on (a bend, a new race, the pit autopilot handing back); `key` is held now and does not count as fresh. */
  rearm(key: number): void {
    this.straightOn = true;
    this.carried = key;
  }

  /** The wheel (-1..1); the old ramp's steer for set old. */
  get wheel(): number {
    return this.old ? this.old.keySteer : this.w;
  }

  /** The steering limit of the last step (the key cap opened by the overdrive). */
  get limit(): number {
    return this.old ? this.old.lim : this.lim;
  }

  /** 0..1, how far a key held past the cap has opened the steering towards full lock. */
  get overdrive(): number {
    if (this.old) return this.old.overdrive;
    const G = CONFIG.GRIP;
    return Math.max(0, Math.min(1, (this.pushTime - G.OVERDRIVE_S) / G.OVERDRIVE_RAMP_S));
  }

  /**
   * key: -1 left, 0 none, 1 right. brake: the brake pedal (braking leaves less grip to steer with).
   * fine: the precision key (PLAYTEST ONLY): the wheel aims at STEER_FINE instead of its stop.
   */
  update(car: Car, key: number, dt: number, brake = false, fine = false): PlayerSteer {
    if (this.old) return this.old.update(this.track, car, key, dt, brake);
    const k = this.track.curves().at(car.s);
    const kLane = laneCurvature(k, car.d);
    const a = this.assist(car, kLane, dt);
    const straightTo = this.straightAssist(k !== 0, key) ? this.track.headingAt(car.x, car.y) : undefined;
    const slip = wrapAngle(car.heading - car.moveAngle);
    const catching = key !== 0 && Math.abs(slip) > CONFIG.GRIP.SLIDE_SLIP_MIN && key === -Math.sign(slip);
    this.turnWheel(car, key, dt, fine, catching);
    return { steer: this.capped(car, key, a, dt, brake, kLane, catching), straightTo };
  }

  // The corner assist, blended in over CORNER_ASSIST_IN_S, and out over the same time where the bend ends
  // (as for the bend's last curvature: still cut at once by a slide, a spin or reverse, never fighting a
  // countersteer). Without the fade-out the car's turn dropped in one step, with no key.
  private assist(car: Car, kLane: number, dt: number): number {
    const assist = curvatureAssist(car, kLane) * assistScale(this.opts);
    const step = dt / CONFIG.CORNER_ASSIST_IN_S;
    this.assistLevel = assist !== 0 ? Math.min(1, this.assistLevel + step) : Math.max(0, this.assistLevel - step);
    if (kLane !== 0) this.bendK = kLane;
    else if (this.assistLevel > 0) return curvatureAssist(car, this.bendK) * assistScale(this.opts) * this.assistLevel;
    return assist * this.assistLevel;
  }

  // The straight assist only straightens after a bend: a fresh key press on the straight (also a switch
  // from the key held out of the bend to the other one) turns it off until the next bend, so a heading
  // the player set stays. A key still held from the bend is not fresh: the car straightens once it is let go.
  private straightAssist(turn: boolean, key: number): boolean {
    if (turn) {
      this.rearm(key);
      return false;
    }
    if (key !== this.carried) this.carried = 0;
    if (key !== 0 && this.carried === 0) this.straightOn = false;
    return this.straightOn;
  }

  // The wheel. A held key turns it towards its stop (±1) along a first-order curve aimed STEER_OVERSHOOT
  // past it, so it gets there (in about 2 time constants): STEER_IN_SLOW_S at 40 mph and under, STEER_IN_S
  // from 100 mph. Turning it the other way, or countersteering a slide, goes at STEER_FAST_S. A released
  // key lets it back to the centre at STEER_OUT_S (0 under STEER_SNAP, where the straight assist acts).
  // STEER_GAMMA over 1 softens the start of a press (only the press: the release is the same).
  private turnWheel(car: Car, key: number, dt: number, fine: boolean, catching: boolean): void {
    const C = CONFIG;
    if (car.spinTime > 0) {
      this.w = 0;
      return;
    }
    if (key === 0) {
      this.w *= Math.exp(-dt / C.STEER_OUT_S);
      if (Math.abs(this.w) < C.STEER_SNAP) this.w = 0;
      return;
    }
    const p = wheelConsts(this.opts.set);
    const against = this.w !== 0 && Math.sign(this.w) !== key;
    const fast = Math.max(0, Math.min(1, (Math.abs(car.speed) - 40) / 60));
    const t = against || catching ? C.STEER_FAST_S : C.STEER_IN_SLOW_S + (p.inS - C.STEER_IN_SLOW_S) * fast;
    const follow = 1 - Math.exp(-dt / t);
    const top = fine ? C.STEER_FINE ** (1 / p.gamma) : 1;
    let u = Math.sign(this.w) * Math.abs(this.w) ** (1 / p.gamma);
    if (key * u > top) u += (key * top - u) * follow;
    else u = key * Math.min(top, key * (u + (key * top * (1 + p.overshoot) - u) * follow));
    this.w = Math.sign(u) * Math.abs(u) ** p.gamma;
  }

  // The wheel spans the key cap without braking, and braking only clips it (so touching the brake mid-corner
  // does not change the line until the steer is at the braked cap). A held key asks for about the grip there
  // is (KEY_CAP), like the AI's smooth driver, so a key or touch player can drive at the limit. Holding the
  // key into a corner the car is too fast for (its line needs more than OVERDRIVE_OVER over the grip) opens
  // the steering towards full lock: after OVERDRIVE_S, over OVERDRIVE_RAMP_S, both shorter the further over
  // the car is (up to OVERDRIVE_RATE_MAX x), and only all the way at OVERDRIVE_OVER + OVERDRIVE_FULL over. A
  // little too fast and insisting stays understeer; far too fast and insisting lets the rear go. At the
  // limit it never overdrives.
  private capped(car: Car, key: number, a: number, dt: number, brake: boolean, kLane: number, catching: boolean): number {
    const free = keyCap(car, false);
    const cap = brake ? keyCap(car, true) : free;
    const v = car.speed * CONFIG.PX_PER_MPH;
    // how far the car's line needs more than the grip (0 = at the limit); only into the bend
    const need = kLane * key > 0 ? (v * v * Math.abs(kLane)) / gripLeft(car, brake) - 1 : 0;
    this.push(key, this.steerAt(a, free), need, dt);
    const open = this.overdrive * this.pushDepth;
    this.lim = cap + (1 - cap) * open;
    // a countersteer starts with at least STEER_MIN_TURN of full lock (at high speed, all the limit at once)
    if (catching) this.w = key * Math.max(key * this.w, Math.min(1, CONFIG.STEER_MIN_TURN / this.lim));
    return Math.max(-this.lim, Math.min(this.lim, this.steerAt(a, free + (1 - free) * open)));
  }

  /** The steer for the wheel over a range: the assist a at w = 0, ±range at w = ±1 (no dead zone round a). */
  private steerAt(a: number, range: number): number {
    return a + this.w * (range - Math.sign(this.w) * a);
  }

  // The push: how long the key has been held into the bend (whatever the wheel: tapping insists like
  // holding), against the cap or short of it. Letting go winds it down (OVERDRIVE_DECAY), and a push the
  // other way starts afresh.
  private push(key: number, steer: number, need: number, dt: number): void {
    const G = CONFIG.GRIP;
    const pushing = key !== 0 && Math.sign(steer) === key;
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
    // The further over, the sooner and the deeper (towards full lock): the consequence grows with the excess.
    if (pushing && need > G.OVERDRIVE_OVER) {
      // (saturates at full overdrive, so letting go winds it down in a bounded time)
      this.pushTime = Math.min(
        G.OVERDRIVE_S + G.OVERDRIVE_RAMP_S,
        this.pushTime + dt * Math.min(G.OVERDRIVE_RATE_MAX, need / G.OVERDRIVE_OVER),
      );
      this.pushDepth = Math.max(this.pushDepth, Math.min(1, (need - G.OVERDRIVE_OVER) / G.OVERDRIVE_FULL));
    }
  }
}
