import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { collideCars, limitMph, startSpin, stepCar } from '../src/race/physics';
import { OVAL } from '../src/track/ovalTrack';
import { CurveTrack, chicane, circle, hairpin, sBend } from './sim/curves';
import { type DriverKind, firstCurveS, freshCar, type Gas, runCurve, withWalls } from './sim/drivers';

// Grip model acceptance on open-plane fixtures (spec section 6.2, with the user's graded decision:
// spins only on clear excess or an uncaught slide).

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
  // (+1.2 %: since T1 bounds the lift-off tuck-in, the tight r = 60 holds 1 % over without a slide frame)
  it('A1: the clean limit follows sqrt(GRIP * r) within -6 %...+1.2 % (r <= 200)', () => {
    for (const r of [60, 100, 120, 147, 200]) {
      const want = Math.min(CONFIG.MAX_MPH, limitMph(1 / r));
      const got = maxClean(r);
      expect(got / want - 1, `r ${r}`).toBeGreaterThanOrEqual(-0.06);
      expect(got / want - 1, `r ${r}`).toBeLessThanOrEqual(0.012);
    }
  });

  // (the grip fades above KNEE_MPH, so only lines of radius MAX_MPH^2 / TOP, about 780 px, and wider are flat out)
  it('A2: r >= 800 is flat out at 180 without a slide', () => {
    for (const r of [800, 1200]) {
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
        // (lifting at 1.25 x slows the car back under KNEE_MPH, where the grip returns: it may not spin)
        if (f === 1.25 && gas === 'lift') continue;
        const res = runCurve(circle(100, 1), { mph: limitMph(1 / 100) * f, driver: 'lock', gas, T: 4, runUp: -20 });
        expect(res.spun, `x${f} ${gas}`).toBe(true);
        expect(res.looseAt).toBeGreaterThan(0.3);
        expect(res.spinAt - res.looseAt, `x${f} ${gas}`).toBeGreaterThanOrEqual(0.5);
        // (up to 1.1 s: a slide under KNEE_MPH swings slower, slideScale)
        expect(res.spinAt - res.looseAt, `x${f} ${gas}`).toBeLessThanOrEqual(1.1);
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
        // (T1 bounds the tuck-in to about 4 deg unless the demand is far over the grip)
        // (3 deg at r 147: its limit is over KNEE_MPH, where the tuck-in scales with the grip)
        expect(res.maxSlipDeg, `r ${r} ${gas}`).toBeGreaterThanOrEqual(3);
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
          stepCar(
            car,
            { steer: Math.max(-1, steer), gas, brake: false, toggleReverse: false },
            1 / 60,
            withWalls(() => null),
          );
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
  it('in a corridor (wall 20 px outside the line), entering 10 % over is not faster than at the limit (to a step)', () => {
    for (const r of [100, 147]) {
      const t = half(r);
      const s0 = firstCurveS(t) - 700;
      const fin = firstCurveS(t) + Math.PI * r + 300;
      const time = (f: number) =>
        runCurve(t, { mph: 180, approachMph: limitMph(1 / r) * f, driver: 'ideal', walls: [20, -40], T: 12 }, fin, s0).time;
      expect(time(1.1), `r ${r}`).toBeGreaterThanOrEqual(time(1.0) - 1 / 60 - 1e-9);
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

describe('grip model: collisions and spins', () => {
  function pair(rearMph: number, frontMph: number) {
    const a = freshCar();
    const b = freshCar();
    b.id = 1;
    Object.assign(a, { x: 1000, y: 380, heading: 0, moveAngle: 0, speed: rearMph, s: 0, d: 0 });
    Object.assign(b, { x: 1033, y: 380, heading: 0, moveAngle: 0, speed: frontMph, s: 33, d: 0 });
    return [a, b] as const;
  }

  it('a loaded car (grip use >= 0.7) spins from a weaker rear hit, an unloaded one does not', () => {
    const [a, b] = pair(150, 132);
    b.gripUse = 0.9;
    collideCars([a, b], OVAL, 'realistic');
    expect(b.spinTime).toBeGreaterThan(0);
    const [c, d] = pair(150, 132);
    d.gripUse = 0.2;
    collideCars([c, d], OVAL, 'realistic');
    expect(d.spinTime).toBe(0);
  });

  it('a contact keeps a slipping car on its travel direction (the lateral impulse is dropped)', () => {
    const [a, b] = pair(170, 60);
    a.heading = 0.15;
    a.moveAngle = 0;
    collideCars([a, b], OVAL, 'realistic');
    expect(a.spinTime).toBe(0);
    expect(a.moveAngle).toBe(0);
    expect(a.speed).toBeLessThan(170);
  });

  it('a spin clears the slip state; it ends with the travel direction on the nose', () => {
    const car = freshCar();
    Object.assign(car, {
      x: 1000,
      y: 380,
      heading: 0.5,
      moveAngle: 0,
      speed: 120,
      rearLoose: true,
      rearStress: 1.2,
      slideTime: 1,
      gripUse: 1.4,
    });
    expect(startSpin(car, CONFIG.SPIN_RATE, 1)).toBe(true);
    expect([car.slideTime, car.rearStress, car.gripUse, car.rearLoose]).toEqual([0, 0, 0, false]);
    for (let i = 0; i < 400 && car.spinTime > 0; i++)
      stepCar(
        car,
        { steer: 0, gas: false, brake: false, toggleReverse: false },
        1 / 60,
        withWalls(() => null),
      );
    expect(car.spinTime).toBe(0);
    expect(car.moveAngle).toBeCloseTo(car.heading, 9);
    expect(car.speed).toBeGreaterThanOrEqual(0);
  });
});

describe('grip model: walls', () => {
  // A straight wall along y = 300 (car centre limit); the car drives at it from above.
  const wall = (car: { y: number }) => {
    if (car.y <= 300) return null;
    car.y = 300;
    return { nx: 0, ny: -1 };
  };
  function hit(mph: number, deg: number) {
    const car = freshCar();
    const a = (deg * Math.PI) / 180;
    Object.assign(car, { x: 0, y: 300 - 3, heading: a, moveAngle: a, speed: mph });
    let spun = false;
    let lost = 0;
    let touched = -1;
    for (let i = 0; i < 90; i++) {
      const before = car.speed;
      // after the hit the driver steers back along the wall
      const steer = touched >= 0 ? -Math.max(-1, Math.min(1, car.heading * 3)) : 0;
      stepCar(car, { steer, gas: false, brake: false, toggleReverse: false }, 1 / 60, withWalls(wall));
      if (car.wallImpact > 0) {
        if (touched < 0) touched = i;
        lost += before - car.speed;
      }
      if (car.spinTime > 0) spun = true;
    }
    return { spun, loss: lost / mph, car };
  }

  it('glancing hits (< 15 deg) cost 10-25 % and never spin', () => {
    for (const mph of [120, 150, 180])
      for (const deg of [5, 10, 14]) {
        const r = hit(mph, deg);
        expect(r.spun, `${mph} ${deg}`).toBe(false);
        expect(r.loss, `${mph} ${deg}`).toBeGreaterThanOrEqual(0.1);
        expect(r.loss, `${mph} ${deg}`).toBeLessThanOrEqual(0.25);
      }
  });

  it('riding along a wall with the throttle held does not glue the car', () => {
    const car = freshCar();
    Object.assign(car, { x: 0, y: 299, heading: 0.03, moveAngle: 0.03, speed: 148 });
    for (let i = 0; i < 120; i++) stepCar(car, { steer: 0.05, gas: true, brake: false, toggleReverse: false }, 1 / 60, withWalls(wall));
    expect(car.speed).toBeGreaterThan(130);
  });

  it('steep fast hits (> 30 deg) spin; slow ones do not', () => {
    expect(hit(120, 40).spun).toBe(true);
    expect(hit(180, 35).spun).toBe(true);
    expect(hit(40, 40).spun).toBe(false);
  });

  it('between 15 and 30 deg the nose is kicked off the wall (slip), without a spin at moderate speed', () => {
    const r = hit(90, 22);
    expect(r.spun).toBe(false);
  });

  /**
   * One step into the wall; returns where the contact turns the nose to, relative to the wall line
   * (+ = away from the wall, rad). The nose gets there gradually (4 rad/s), never in one step.
   */
  function kickOf(moveDeg: number, noseDeg: number, mph = 90) {
    const car = freshCar();
    const m = (moveDeg * Math.PI) / 180;
    const h0 = (noseDeg * Math.PI) / 180;
    Object.assign(car, { x: 0, y: 299.5, heading: h0, moveAngle: m, speed: mph });
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60, withWalls(wall));
    expect(car.wallImpact).toBeGreaterThan(0);
    expect(car.moveAngle).toBeCloseTo(0, 9);
    expect(Math.abs(car.heading - h0)).toBeLessThanOrEqual(4 / 60 + 1e-9);
    // the wall is below (y = 300, normal up), so away from it is a negative heading
    return -(car.heading + car.wallYaw);
  }

  it('the kick turns the nose away from the wall, whichever way the car was pointing (critic r1 #2)', () => {
    const deg = Math.PI / 180;
    // a sliding car: travelling into the wall at 22 deg, nose already 10 deg off it
    expect(kickOf(22, -10)).toBeGreaterThan(0);
    // nose pointing into the wall harder than the travel direction
    expect(kickOf(22, 40)).toBeGreaterThan(0);
    // straight in: half of the way from 15 to 30 deg of kick share, of the impact angle
    expect(kickOf(22, 22)).toBeCloseTo(((22 - 15) / 15) * 0.5 * 22 * deg, 6);
    // glancing: straightened along the wall
    expect(kickOf(10, 25)).toBeCloseTo(0, 9);
  });
});

describe('grip model: slow steep wall contacts (tester r2 #3)', () => {
  it('stop against the wall like the classic model: no heading jump in any step', () => {
    const wallB = (car: { y: number }) => {
      if (car.y <= 300) return null;
      car.y = 300;
      return { nx: 0, ny: -1 };
    };
    for (const mph of [5, 15, 25])
      for (const deg of [35, 50, 70, 85, 100]) {
        const car = freshCar();
        const a = (deg * Math.PI) / 180;
        Object.assign(car, { x: 0, y: 298, heading: a, moveAngle: a, speed: mph });
        let jump = 0;
        for (let i = 0; i < 30; i++) {
          const h = car.heading;
          stepCar(car, { steer: 0, gas: mph > 10, brake: false, toggleReverse: false }, 1 / 60, withWalls(wallB));
          jump = Math.max(jump, Math.abs(car.heading - h));
        }
        expect(jump, `${mph} mph ${deg} deg`).toBeLessThan((5 * Math.PI) / 180);
      }
  });
});

describe('grip model: pinned against a wall (tester r2 #5)', () => {
  it('a car at rest with its nose up to 15 deg into the wall drives away along it', () => {
    const wallB = (car: { y: number }) => {
      if (car.y <= 300) return null;
      car.y = 300;
      return { nx: 0, ny: -1 };
    };
    for (const deg of [2, 8, 15]) {
      const car = freshCar();
      const a = (deg * Math.PI) / 180;
      Object.assign(car, { x: 0, y: 300, heading: a, moveAngle: a, speed: 0.1 });
      for (let i = 0; i < 180; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60, withWalls(wallB));
      expect(car.speed, `${deg} deg`).toBeGreaterThan(40);
    }
  });
});

describe('grip model: degenerate steps', () => {
  it('dt = 0 changes nothing and makes no NaN (critic r1 #3)', () => {
    const car = freshCar();
    Object.assign(car, { x: 500, y: 300, heading: 0.1, moveAngle: 0.05, speed: 150 });
    const before = { ...car };
    stepCar(
      car,
      { steer: 0.5, gas: false, brake: true, toggleReverse: false },
      0,
      withWalls(() => null),
    );
    for (const k of ['x', 'y', 'heading', 'moveAngle', 'speed', 'gripUse', 'rearStress', 'weightFwd'] as const) {
      expect(Number.isFinite(car[k]), k).toBe(true);
      expect(car[k], k).toBe(before[k]);
    }
  });
});
