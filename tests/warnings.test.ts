import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { limitMph, stepCar } from '../src/race/physics';
import { NO_WARN, nextCornerMph, warnings } from '../src/race/warnings';
import { laneCurvature } from '../src/track/curvature';
import { pointAt, project, RC, S_BOTTOM, S_TURN1 } from '../src/track/track';
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
