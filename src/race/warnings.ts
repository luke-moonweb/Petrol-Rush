// What the HUD, the cockpit and the sound tell the player about grip.
//
// Grip model: the cockpit LEDs show the grip use of the car's line at its speed (flashing when the
// tyres are overdriven or the rear steps out), the SKID lamp shows real slip (blinking faster as
// the slip angle grows, steady in a spin), and the speed bar / speedo red arc show the limit speed
// of the next corner.
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
  /** Grip model: grip use for the cockpit LED strip (lineUse); null = classic speed ramp. */
  use: number | null;
  /** Grip model: flash the whole LED strip red (over the limit or the rear stepping out). */
  flash: boolean;
}

export const NO_WARN: Warn = { skidHz: 0, skidLit: false, vRef: CONFIG.SPIN_MPH, band: CONFIG.SLIDE_SPIN_OVER, use: null, flash: false };

export const WARN = {
  /** Slip angle (rad) at which the SKID lamp comes on, and where it blinks fastest. */
  SKID_SLIP: 0.08,
  SKID_SLIP_MAX: 0.45,
  SKID_HZ_MIN: 2,
  SKID_HZ_MAX: 9,
  /**
   * LED strip: the grip use that lights each LED (nothing below 30 %, straights). Teal up to 70 %,
   * amber from 70 %, red from 95 %, the last at 103 %; over FLASH_USE the whole strip flashes.
   */
  LED_USE: [0.3, 0.4, 0.5, 0.6, 0.7, 0.785, 0.87, 0.95, 1.025] as readonly number[],
  /** Grip use above which the whole strip flashes. */
  FLASH_USE: 1.1,
  /** Orange band of the speed bar as a share of vRef. */
  BAND: 0.05,
  /** Easing (s) of the speedo red arc / speed bar limit, and of the LED strip's grip use. */
  ARC_EASE_S: 0.3,
  LED_EASE_S: 0.25,
};

/**
 * What the HUD and the cockpit show, smoothed over frames: the SKID blink keeps its phase while
 * its rate changes (no flicker), the red arc and the speed bar share one eased limit, and the LED
 * strip reads the grip use averaged over LED_EASE_S (a key held for a moment does not light red).
 */
export class WarnDisplay {
  private phase = 0;
  private use = 0;
  arcFrom: number = CONFIG.SPIN_MPH;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.phase = 0;
    this.use = 0;
    this.arcFrom = CONFIG.DRIVE_MODEL === 'grip' ? CONFIG.MAX_MPH : CONFIG.SPIN_MPH;
  }

  /** Advance by dt with the player's warning this step. */
  update(w: Warn, dt: number): void {
    // the phase (in cycles) restarts lit at each onset
    this.phase = w.skidHz > 0 && w.skidHz !== Infinity ? (this.phase + w.skidHz * dt) % 1 : 0;
    if (CONFIG.DRIVE_MODEL !== 'grip') return;
    this.arcFrom += (w.vRef - this.arcFrom) * Math.min(1, dt / WARN.ARC_EASE_S);
    this.use += ((w.use ?? 0) - this.use) * Math.min(1, dt / WARN.LED_EASE_S);
  }

  /** The warning as shown for the player's warning w, or with the race not running (null). */
  shown(w: Warn | null): Warn {
    const grip = CONFIG.DRIVE_MODEL === 'grip';
    const base = w ?? { ...NO_WARN, use: grip ? this.use : null };
    const skidLit = base.skidHz === Infinity || (base.skidHz > 0 && this.phase < 0.5);
    if (!grip) return { ...base, vRef: this.arcFrom, skidLit };
    return { ...base, skidLit, vRef: this.arcFrom, band: WARN.BAND * this.arcFrom, use: base.use === null ? null : this.use };
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

/**
 * Grip use for the LED strip: what the car's line at this speed asks of the tyres (v^2 x the line's
 * curvature / GRIP), combined with what the brakes or the throttle take. It reads the corner, not
 * the key: a key or touch player's on/off steering does not flash the strip, while a car at the
 * limit of its line shows red whatever the input.
 */
export function lineUse(car: Car): number {
  const v = Math.max(0, car.speed) * CONFIG.PX_PER_MPH;
  const k = laneCurvature(trackCurves().at(car.s), onTrackD(car.d));
  return Math.hypot((v * v * Math.abs(k)) / CONFIG.GRIP.GRIP, car.gripLong);
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
    use: car.spinTime > 0 ? 0 : lineUse(car),
    flash: car.spinTime <= 0 && (car.gripUse > WARN.FLASH_USE || car.rearLoose),
  };
}
