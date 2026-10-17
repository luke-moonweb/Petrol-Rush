// What the HUD, the cockpit and the sound tell the player about grip.
//
// Grip model: the cockpit LEDs show grip use, the SKID lamp shows real slip (blinking faster as the
// slip angle grows), and the speed bar / speedo red arc show the limit speed of the next corner.
// Classic model: today's 150 mph rule (SKID above 150, blinking in a turn; LEDs ramp up to 150).
import { CONFIG } from '../config';
import { laneCurvature } from '../track/curvature';
import { trackCurves, wrapAngle } from '../track/track';
import type { Car } from './car';
import { limitMph, skidWarning } from './physics';

export interface Warn {
  /** SKID lamp blink rate in Hz: 0 = off, Infinity = steady. */
  skidHz: number;
  /** Speed (mph) above which the car is too fast for the next corner: speed bar and speedo red arc. */
  vRef: number;
  /** Width (mph) of the orange "recoverable" band of the speed bar above vRef. */
  band: number;
  /** Grip model: grip use for the cockpit LED strip; null = classic speed ramp. */
  use: number | null;
  /** Grip model: flash the whole LED strip red (over the limit or the rear stepping out). */
  flash: boolean;
}

export const NO_WARN: Warn = { skidHz: 0, vRef: CONFIG.SPIN_MPH, band: CONFIG.SLIDE_SPIN_OVER, use: null, flash: false };

export const WARN = {
  /** Slip angle (rad) at which the SKID lamp comes on, and where it blinks fastest. */
  SKID_SLIP: 0.08,
  SKID_SLIP_MAX: 0.45,
  SKID_HZ_MIN: 2,
  SKID_HZ_MAX: 9,
  /** LED strip: grip use of the first and the last LED (nothing lit below LED_USE_MIN). */
  LED_USE_MIN: 0.3,
  LED_USE_MAX: 1.1,
  /** Grip use above which the whole strip flashes. */
  FLASH_USE: 1.1,
  /** Orange band of the speed bar as a share of vRef. */
  BAND: 0.05,
};

/** Is a lamp blinking at hz lit at this time? (Same phase as the classic 3 Hz SKID blink.) */
export function skidOn(hz: number, time: number): boolean {
  if (hz <= 0) return false;
  if (hz === Infinity) return true;
  return Math.floor(time * hz * 2) % 2 === 0;
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
  let best = C.MAX_MPH;
  for (const run of table.runs()) {
    let ds = (((run.s0 - car.s) % len) + len) % len;
    if (ds > len - run.len) ds = 0;
    if (ds > range) continue;
    // the car's own line at full grip: the honest limit
    const lim = limitMph(laneCurvature(run.k, car.d));
    if (lim < best) best = lim;
  }
  return best;
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
    return { ...NO_WARN, skidHz: level === 1 ? Infinity : level === 2 ? 3 : 0 };
  }
  const slip = Math.abs(wrapAngle(car.heading - car.moveAngle));
  let skidHz = 0;
  if (car.spinTime <= 0 && car.speed > 0 && (slip > WARN.SKID_SLIP || car.rearLoose)) {
    const k = Math.min(1, Math.max(0, (slip - WARN.SKID_SLIP) / (WARN.SKID_SLIP_MAX - WARN.SKID_SLIP)));
    skidHz = WARN.SKID_HZ_MIN + (WARN.SKID_HZ_MAX - WARN.SKID_HZ_MIN) * k;
  }
  const vRef = nextCornerMph(car);
  return {
    skidHz,
    vRef,
    band: WARN.BAND * vRef,
    use: car.spinTime > 0 ? 0 : car.gripUse,
    flash: car.spinTime <= 0 && (car.gripUse > WARN.FLASH_USE || car.rearLoose),
  };
}
