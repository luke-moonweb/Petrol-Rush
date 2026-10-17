// What the HUD, the cockpit and the sound tell the player about grip.
//
// Grip model: the SKID lamp shows real slip (blinking faster as the slip angle grows, steady in a
// spin), and the speed bar / speedo red arc show the limit speed of the next corner. (The cockpit
// LED strip only shows the start lights and how close the car is to top speed, see cabin.ts.)
// Classic model: today's 150 mph rule (SKID above 150, blinking in a turn; LEDs ramp up to 150).
import { CONFIG } from '../config';
import { laneCurvature } from '../track/curvature';
import { CAR_R, HALF_W, trackCurves, wrapAngle } from '../track/track';
import type { Car } from './car';
import { limitMph, skidWarning } from './physics';

export interface Warn {
  /** SKID lamp blink rate in Hz: 0 = off, Infinity = steady. */
  skidHz: number;
  /** Is the SKID lamp lit right now (the blink phase comes from WarnDisplay; on at the onset otherwise). */
  skidLit: boolean;
  /** Speed (mph) above which the car is too fast for the next corner: speed bar and speedo red arc. */
  vRef: number;
  /** Width (mph) of the orange "recoverable" band of the speed bar above vRef. */
  band: number;
}

export const NO_WARN: Warn = { skidHz: 0, skidLit: false, vRef: CONFIG.SPIN_MPH, band: CONFIG.SLIDE_SPIN_OVER };

export const WARN = {
  /** Slip angle (rad) at which the SKID lamp comes on, and where it blinks fastest. */
  SKID_SLIP: 0.08,
  SKID_SLIP_MAX: 0.45,
  SKID_HZ_MIN: 2,
  SKID_HZ_MAX: 9,
  /** Orange band of the speed bar as a share of vRef. */
  BAND: 0.05,
  /** Easing (s) of the speedo red arc / speed bar limit. */
  ARC_EASE_S: 0.3,
};

/**
 * What the HUD and the cockpit show, smoothed over frames: the SKID blink keeps its phase while
 * its rate changes (no flicker), and the red arc and the speed bar share one eased limit. The
 * classic model keeps its old time-locked blink (floor(time x hz x 2), as on main).
 */
export class WarnDisplay {
  private phase = 0;
  arcFrom: number = CONFIG.SPIN_MPH;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.phase = 0;
    this.arcFrom = CONFIG.DRIVE_MODEL === 'grip' ? CONFIG.MAX_MPH : CONFIG.SPIN_MPH;
  }

  /** Advance by dt with the player's warning this step. */
  update(w: Warn, dt: number): void {
    // the phase (in cycles) restarts lit at each onset
    this.phase = w.skidHz > 0 && w.skidHz !== Infinity ? (this.phase + w.skidHz * dt) % 1 : 0;
    if (CONFIG.DRIVE_MODEL !== 'grip') return;
    this.arcFrom += (w.vRef - this.arcFrom) * Math.min(1, dt / WARN.ARC_EASE_S);
  }

  /** The warning as shown for the player's warning w, or with the race not running (null), at race time. */
  shown(w: Warn | null, time: number): Warn {
    const base = w ?? NO_WARN;
    if (CONFIG.DRIVE_MODEL !== 'grip') {
      const hz = base.skidHz;
      return { ...base, vRef: this.arcFrom, skidLit: hz === Infinity || (hz > 0 && Math.floor(time * hz * 2) % 2 === 0) };
    }
    const skidLit = base.skidHz === Infinity || (base.skidHz > 0 && this.phase < 0.5);
    return { ...base, skidLit, vRef: this.arcFrom, band: WARN.BAND * this.arcFrom };
  }
}

/** Limit speed (mph) of the tightest corner on the car's line within braking range; MAX_MPH if none. */
export function nextCornerMph(car: Car): number {
  const C = CONFIG;
  const pxm = C.PX_PER_MPH;
  const table = trackCurves();
  const v = Math.max(0, car.speed);
  const b = C.BRAKE_MPH_S * 0.75;
  const range = Math.max(300, (v * v * pxm) / (2 * b) + 60);
  const len = table.len;
  // the car's own line, kept on the track
  const d = onTrackD(car.d);
  let best = C.MAX_MPH;
  for (const run of table.runs()) {
    let ds = (((run.s0 - car.s) % len) + len) % len;
    if (ds > len - run.len) ds = 0;
    if (ds > range) continue;
    // the car's own line at full grip: the honest limit
    const lim = limitMph(laneCurvature(run.k, d));
    if (lim < best) best = lim;
  }
  return best;
}

/** A lateral offset kept on the track (in the pit lane d is far inside the inner kerb). */
function onTrackD(d: number): number {
  const edge = HALF_W - CAR_R;
  return Math.max(-edge, Math.min(edge, d));
}

/** 0..1: how hard the tyres are sliding (slip angle, or ploughing over the limit), for sound and smoke. */
export function slideAmount(car: Car): number {
  if (car.spinTime > 0) return 1;
  const slip = Math.abs(wrapAngle(car.heading - car.moveAngle));
  const rear = Math.min(1, Math.max(0, (slip - 0.04) / 0.3));
  const plough = Math.min(1, Math.max(0, (car.gripOver - 0.05) / 0.45)) * 0.6;
  return Math.max(rear, plough);
}

export function warnings(car: Car): Warn {
  if (CONFIG.DRIVE_MODEL !== 'grip') {
    const level = skidWarning(car);
    const skidHz = level === 1 ? Infinity : level === 2 ? 3 : 0;
    return { ...NO_WARN, skidHz, skidLit: skidHz > 0 };
  }
  const slip = Math.abs(wrapAngle(car.heading - car.moveAngle));
  // spinning: steady, as the cockpit tell-tale
  let skidHz = car.spinTime > 0 ? Infinity : 0;
  if (car.spinTime <= 0 && car.speed > 0 && (slip > WARN.SKID_SLIP || car.rearLoose)) {
    const k = Math.min(1, Math.max(0, (slip - WARN.SKID_SLIP) / (WARN.SKID_SLIP_MAX - WARN.SKID_SLIP)));
    skidHz = WARN.SKID_HZ_MIN + (WARN.SKID_HZ_MAX - WARN.SKID_HZ_MIN) * k;
  }
  const vRef = nextCornerMph(car);
  return {
    skidHz,
    skidLit: skidHz > 0,
    vRef,
    band: WARN.BAND * vRef,
  };
}
