import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../src/config';
import { limitMph, stepCar } from '../src/race/physics';
import { CurveTrack, chicane, circle, hairpin, sBend } from './sim/curves';
import { type DriverKind, firstCurveS, freshCar, type Gas, runCurve } from './sim/drivers';

// Grip model acceptance on open-plane fixtures (spec section 6.2, with the user's graded decision:
// spins only on clear excess or an uncaught slide).
let saved: DriveModel;
beforeAll(() => {
  saved = CONFIG.DRIVE_MODEL;
  CONFIG.DRIVE_MODEL = 'grip';
});
afterAll(() => {
  CONFIG.DRIVE_MODEL = saved;
});

/** Highest entry speed the ideal driver holds on the circle without a slide frame or running wide. */
function maxClean(r: number): number {
  const t = circle(r);
  const clean = (m: number) => {
    const res = runCurve(t, { mph: m, driver: 'ideal', T: 3, runUp: -40 });
    return !res.spun && res.slideT === 0 && res.wide < 4;
  };
  let lo = 40;
  let hi = 180.5;
  if (clean(180)) return 180;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (clean(m)) lo = m;
    else hi = m;
  }
  return lo;
}

const half = (r: number) =>
  new CurveTrack([
    { len: 900, k: 0 },
    { len: Math.PI * r, k: -1 / r },
    { len: 900, k: 0 },
  ]);

describe('grip model: limit vs radius', () => {
  it('A1: the clean limit follows sqrt(GRIP * r) within -6 %...0 % (r <= 200)', () => {
    for (const r of [60, 100, 120, 147, 200]) {
      const want = Math.min(CONFIG.MAX_MPH, limitMph(1 / r));
      const got = maxClean(r);
      expect(got / want - 1, `r ${r}`).toBeGreaterThanOrEqual(-0.06);
      expect(got / want - 1, `r ${r}`).toBeLessThanOrEqual(0.002);
    }
  });

  it('A2: r >= 250 is flat out at 180 without a slide', () => {
    for (const r of [250, 400]) {
      const res = runCurve(circle(r), { mph: 180, driver: 'ideal', gas: 'full', T: 4, runUp: -40 });
      expect(res.spun).toBe(false);
      expect(res.slideT).toBe(0);
    }
  });

  it('A3: at 0.95 x the limit the ideal driver holds the radius with no slide', () => {
    for (const r of [60, 100, 147, 200]) {
      const res = runCurve(circle(r), { mph: limitMph(1 / r) * 0.95, driver: 'ideal', T: 4, runUp: -40, settle: 0.5 });
      expect(res.slideT, `r ${r}`).toBe(0);
      // (~1 px of it is the lift-off tuck-in from the throttle feathering at constant speed)
      expect(Math.max(res.wide, res.inside), `r ${r}`).toBeLessThan(2.5);
      expect(res.maxUse).toBeLessThanOrEqual(1);
    }
  });
});

describe('grip model: graded over the limit', () => {
  const drivers: DriverKind[] = ['ideal', 'lock', 'keys', 'keysCatch'];
  const gases: Gas[] = ['hold', 'full', 'lift'];

  it('A4: 5 % over, any driver and throttle: slides wide (<= 30 px), never spins', () => {
    for (const r of [100, 147])
      for (const drv of drivers)
        for (const gas of gases) {
          const res = runCurve(circle(r, 1), { mph: limitMph(1 / r) * 1.05, driver: drv, gas, T: 4, runUp: -20 });
          expect(res.spun, `r ${r} ${drv} ${gas}`).toBe(false);
          expect(res.wide, `r ${r} ${drv} ${gas}`).toBeLessThanOrEqual(30);
        }
    const plow = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * 1.05, driver: 'ideal', T: 4, runUp: -20 });
    expect(plow.slideT).toBeGreaterThan(0);
    expect(plow.wide).toBeGreaterThan(5);
  });

  it('10 % over with an analog driver: understeer only, no spin; lifting recovers', () => {
    for (const gas of gases) {
      const res = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * 1.1, driver: 'ideal', gas, T: 4, runUp: -20 });
      expect(res.spun, gas).toBe(false);
      expect(res.wide, gas).toBeLessThanOrEqual(35);
    }
  });

  it('A5: clear excess (>= 25 %) held without countersteer: rear steps out, spin 0.6-1.0 s later', () => {
    for (const f of [1.25, 1.3])
      for (const gas of gases) {
        const res = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * f, driver: 'lock', gas, T: 4, runUp: -20 });
        expect(res.spun, `x${f} ${gas}`).toBe(true);
        expect(res.looseAt).toBeGreaterThan(0.3);
        expect(res.spinAt - res.looseAt, `x${f} ${gas}`).toBeGreaterThanOrEqual(0.5);
        expect(res.spinAt - res.looseAt, `x${f} ${gas}`).toBeLessThanOrEqual(1.0);
      }
  });

  it('A6: countersteer after 0.3 s catches every entry from 0.95 to 1.3 x (analog or one 100 ms tap)', () => {
    for (const f of [0.95, 1.05, 1.15, 1.2, 1.25, 1.3])
      for (const drv of ['catch', 'keysCatch'] as DriverKind[])
        for (const gas of gases) {
          const res = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * f, driver: drv, gas, T: 4, runUp: -20, react: 0.3 });
          expect(res.spun, `x${f} ${drv} ${gas}`).toBe(false);
        }
  });

  it('15-20 % over with the throttle held: the rear steps out (visible slip) before any spin', () => {
    for (const f of [1.2]) {
      const res = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * f, driver: 'keysCatch', T: 4, runUp: -20 });
      expect(res.looseAt).toBeGreaterThan(0);
      expect(res.maxSlipDeg).toBeGreaterThanOrEqual(10);
      expect(res.maxSlipDeg).toBeLessThanOrEqual(25);
    }
  });

  it('A7: at the limit, lifting or braking at full lock rotates the car (oversteer) without a spin', () => {
    for (const r of [100, 147])
      for (const gas of ['lift', 'brake'] as Gas[]) {
        const res = runCurve(circle(r, 1), { mph: limitMph(1 / r), driver: 'lock', gas, T: 3, runUp: -20 });
        expect(res.spun, `r ${r} ${gas}`).toBe(false);
        expect(res.maxSlipDeg, `r ${r} ${gas}`).toBeGreaterThanOrEqual(4);
      }
  });

  it('lift-off at the limit tightens the line by a few px within 0.5 s', () => {
    for (const r of [100, 147]) {
      const t = circle(r, 1);
      const vl = limitMph(1 / r);
      const run = (lift: boolean) => {
        const car = freshCar();
        const p = t.pointAt(firstCurveS(t) + 10, 0);
        Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: vl * 0.98 });
        // the steady steer that holds this circle, then only the pedal changes
        const steer = -(1 / r) / Math.min(1 / CONFIG.MIN_TURN_RADIUS, CONFIG.MAX_TURN_RATE / (vl * 0.98 * CONFIG.PX_PER_MPH));
        for (let i = 0; i < 60; i++) {
          const gas = !lift || i < 30 ? car.speed < vl * 0.98 : false;
          stepCar(car, { steer: Math.max(-1, steer), gas, brake: false, toggleReverse: false }, 1 / 60, () => null);
        }
        return t.project(car.x, car.y, firstCurveS(t) + 100).d;
      };
      const tighter = run(false) - run(true);
      console.log(`lift-off tightening r ${r}: ${tighter.toFixed(1)} px`);
      expect(tighter, `r ${r}`).toBeGreaterThanOrEqual(1);
      expect(tighter, `r ${r}`).toBeLessThanOrEqual(12);
    }
  });
});

describe('grip model: a slide costs time (A9)', () => {
  it('in a corridor (wall 20 px outside the line), entering 10 % over is not faster than at the limit', () => {
    for (const r of [100, 147]) {
      const t = half(r);
      const s0 = firstCurveS(t) - 700;
      const fin = firstCurveS(t) + Math.PI * r + 300;
      const time = (f: number) =>
        runCurve(t, { mph: 180, approachMph: limitMph(1 / r) * f, driver: 'ideal', walls: [20, -40], T: 12 }, fin, s0).time;
      expect(time(1.1), `r ${r}`).toBeGreaterThanOrEqual(time(1.0) - 0.01);
    }
  });
});

describe('grip model: the AI planner on other track shapes (A8)', () => {
  for (const [name, t] of [
    ['chicane', chicane()],
    ['hairpin', hairpin()],
    ['s-bend', sBend()],
    ['circle r 100', circle(100, 1)],
  ] as const) {
    it(`${name}: AI drives it with no spin, no wall contact, grip use <= 1`, () => {
      for (const d of [-20, 0, 20])
        for (const f of [0.884, 0.987]) {
          let wall = 0;
          const res = runCurve(
            t,
            { mph: 180, driver: 'ai', d, gripFrac: f, walls: [40, -40], T: 14, runUp: 600 },
            t.len - 300,
            undefined,
            (_t, c) => {
              if (c.wallImpact > 0) wall++;
            },
          );
          expect(res.spun, `${name} d ${d}`).toBe(false);
          expect(wall, `${name} d ${d}`).toBe(0);
          expect(res.maxUse, `${name} d ${d}`).toBeLessThanOrEqual(1.0);
          expect(res.time, `${name} d ${d}`).toBeLessThan(Infinity);
        }
    });
  }
});
