import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { limitMph, stepCar } from '../src/race/physics';
import { NO_WARN, nextCornerMph, WARN, type Warn, WarnDisplay, warnings } from '../src/race/warnings';
import { laneCurvature } from '../src/track/curvature';
import { CAR_R, HALF_W, PIT_DRIVE_Y, pointAt, project, RC, S_BOTTOM, S_TURN1 } from '../src/track/track';
import { freshCar } from './sim/drivers';

const saved = CONFIG.DRIVE_MODEL;
afterEach(() => {
  CONFIG.DRIVE_MODEL = saved;
});

function carAt(s: number, d: number, mph: number) {
  const car = freshCar();
  const p = pointAt(s, d);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, s, d });
  return car;
}

describe('warnings: classic model keeps the 150 mph semantics', () => {
  it('SKID steady above 150 on a straight, 3 Hz blink in a turn; arc and bar at 150', () => {
    CONFIG.DRIVE_MODEL = 'classic';
    expect(warnings(carAt(S_BOTTOM + 50, 0, 150)).skidHz).toBe(0);
    expect(warnings(carAt(S_BOTTOM + 50, 0, 155)).skidHz).toBe(Infinity);
    expect(warnings(carAt(S_TURN1 + 80, 0, 160)).skidHz).toBe(3);
    const w = warnings(carAt(S_TURN1 + 80, 0, 140));
    expect([w.vRef, w.band, w.use]).toEqual([CONFIG.SPIN_MPH, CONFIG.SLIDE_SPIN_OVER, null]);
  });
});

describe('warnings: grip model', () => {
  it('the speed bar / arc limit is the next corner on the car line, flat out with no corner in range', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    expect(nextCornerMph(carAt(S_TURN1 + 100, 0, 150))).toBeCloseTo(limitMph(-1 / RC), 2);
    expect(nextCornerMph(carAt(S_TURN1 + 100, 28.5, 150))).toBeCloseTo(limitMph(laneCurvature(-1 / RC, 28.5)), 2);
    expect(nextCornerMph(carAt(S_TURN1 - 300, -28.5, 180))).toBeCloseTo(limitMph(laneCurvature(-1 / RC, -28.5)), 2);
    expect(nextCornerMph(carAt(S_BOTTOM + 50, 0, 150))).toBe(CONFIG.MAX_MPH);
    expect(warnings(carAt(S_TURN1 + 100, 0, 150)).band).toBeCloseTo(0.05 * limitMph(-1 / RC), 2);
  });

  it('SKID only for real slip (not for speed alone), blinking faster as the slip angle grows', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    expect(warnings(carAt(S_TURN1 + 80, 0, 175)).skidHz).toBe(0);
    const slip = (rad: number) => {
      const c = carAt(S_TURN1 + 80, 0, 150);
      c.heading = c.moveAngle - rad;
      return warnings(c).skidHz;
    };
    expect(slip(0.05)).toBe(0);
    expect(slip(0.1)).toBeGreaterThan(0);
    expect(slip(0.4)).toBeGreaterThan(slip(0.1));
    const loose = carAt(S_TURN1 + 80, 0, 150);
    loose.rearLoose = true;
    expect(warnings(loose).skidHz).toBeGreaterThan(0);
    expect(warnings(loose).flash).toBe(true);
    expect(NO_WARN.skidHz).toBe(0);
  });

  it('LEDs read grip use: nothing on a straight at full throttle, lit in a corner at the limit', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const car = carAt(S_BOTTOM + 50, 0, 120);
    for (let i = 0; i < 30; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60);
    expect(warnings(car).use!).toBeLessThan(0.3);
    const c2 = carAt(S_TURN1 + 20, 0, limitMph(-1 / RC) * 0.97);
    for (let i = 0; i < 30; i++) {
      const st = project(c2.x, c2.y);
      const t = pointAt(st.s + 60, 0);
      const diff = Math.atan2(t.y - c2.y, t.x - c2.x) - c2.heading;
      stepCar(
        c2,
        { steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(diff), Math.cos(diff)) * 5)), gas: true, brake: false, toggleReverse: false },
        1 / 60,
      );
    }
    expect(warnings(c2).use!).toBeGreaterThan(0.85);
  });
});

describe('warnings: what the HUD and the cockpit show (critic r1)', () => {
  const w = (extra: Partial<Warn>): Warn => ({ ...NO_WARN, use: 0.5, vRef: 150, band: 7.5, ...extra });

  it('the SKID blink keeps its phase while its rate changes: no flicker', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const d = new WarnDisplay();
    // a rate that changes every frame (a slide growing and shrinking) at a large race time
    let toggles = 0;
    let prev = true;
    let runs = 0;
    let run = 0;
    for (let i = 0; i < 600; i++) {
      const hz = 4 + 3 * Math.sin(i / 7);
      d.update(w({ skidHz: hz }), 1 / 60);
      const lit = d.shown(w({ skidHz: hz })).skidLit;
      if (lit !== prev) {
        toggles++;
        runs = Math.max(runs, run);
        // every lit or dark spell lasts at least half a period at the fastest rate (no 1-frame flicker)
        if (i > 0) expect(run, `frame ${i}`).toBeGreaterThanOrEqual(Math.floor(60 / (2 * 7)));
        run = 0;
      }
      run++;
      prev = lit;
    }
    // 10 s at 1-7 Hz: about 2 x 4 x 10 changes
    expect(toggles).toBeGreaterThan(50);
    expect(toggles).toBeLessThan(110);
  });

  it('each SKID onset starts lit; off when the warning is off; steady at Infinity', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const d = new WarnDisplay();
    for (let i = 0; i < 7; i++) d.update(w({ skidHz: 5 }), 1 / 60);
    d.update(w({ skidHz: 0 }), 1 / 60);
    expect(d.shown(w({ skidHz: 0 })).skidLit).toBe(false);
    d.update(w({ skidHz: 5 }), 1 / 60);
    expect(d.shown(w({ skidHz: 5 })).skidLit).toBe(true);
    expect(d.shown(w({ skidHz: Infinity })).skidLit).toBe(true);
  });

  it('grip: SKID is lit through a spin on the HUD too, as the cockpit tell-tale', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const c = carAt(S_TURN1 + 80, 0, 120);
    c.spinTime = 2;
    expect(warnings(c).skidHz).toBe(Infinity);
    expect(new WarnDisplay().shown(warnings(c)).skidLit).toBe(true);
  });

  it('the speed bar and the red arc share one eased limit; the paused fallback keeps the grip band', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const d = new WarnDisplay();
    for (let i = 0; i < 6; i++) d.update(w({ vRef: 140 }), 1 / 60);
    const shown = d.shown(w({ vRef: 140 }));
    expect(shown.vRef).toBe(d.arcFrom);
    expect(shown.vRef).toBeGreaterThan(140);
    expect(shown.band).toBeCloseTo(WARN.BAND * d.arcFrom, 9);
    const paused = d.shown(null);
    expect(paused.vRef).toBe(d.arcFrom);
    expect(paused.band).toBeCloseTo(WARN.BAND * d.arcFrom, 9);
    expect(paused.use).not.toBeNull();
    expect(paused.skidLit).toBe(false);
  });

  it('the LED strip reads the grip use averaged over a quarter second: a short key press does not light red', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const d = new WarnDisplay();
    for (let i = 0; i < 60; i++) d.update(w({ use: 0.6 }), 1 / 60);
    for (let i = 0; i < 6; i++) d.update(w({ use: 1.05 }), 1 / 60);
    expect(d.shown(w({ use: 1.05 })).use!).toBeLessThan(0.95);
    for (let i = 0; i < 60; i++) d.update(w({ use: 1.05 }), 1 / 60);
    expect(d.shown(w({ use: 1.05 })).use!).toBeGreaterThan(1.0);
  });

  it('in the pit lane the next-corner limit uses the inside edge of the track, not the pit-lane offset', () => {
    CONFIG.DRIVE_MODEL = 'grip';
    const car = carAt(S_TURN1 - 150, 0, 70);
    car.y = PIT_DRIVE_Y;
    Object.assign(car, project(car.x, car.y));
    expect(car.d).toBeLessThan(-60);
    expect(nextCornerMph(car)).toBeCloseTo(limitMph(laneCurvature(-1 / RC, -(HALF_W - CAR_R))), 2);
  });
});
