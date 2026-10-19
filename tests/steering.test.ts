import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { curvatureAssist, gripAt, limitMph, maxCurvature, stepCar } from '../src/race/physics';
import { keyCap, PlayerSteering } from '../src/race/steering';
import { laneCurvature } from '../src/track/curvature';
import { CAR_R, HALF_W, pointAt, project, RC, S_BOTTOM, S_TURN1, S_TURN2, trackHeadingAt, wrapAngle } from '../src/track/oval';
import { OVAL } from '../src/track/ovalTrack';
import { CurveTrack } from './sim/curves';
import { freshCar, placeCar, steerTrack, withWalls } from './sim/drivers';
import { catchSteps, tapAcross, tapAngle, tapOverdrive, tapping, toStop } from './sim/steerLab';

const OVAL_NO_WALLS = withWalls(() => null);

function carAt(s: number, d: number, mph: number) {
  const car = freshCar();
  const p = pointAt(s, d);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, s, d });
  return car;
}

describe('grip model: corner assist from curvature', () => {
  it('follows the sign of the curvature, is 0 on straights and below 40 mph', () => {
    const left = curvatureAssist(carAt(S_TURN1 + 100, 0, 145), -1 / RC);
    expect(left).toBeLessThan(0);
    expect(left).toBeGreaterThan(-0.5);
    expect(curvatureAssist(carAt(S_TURN1 + 100, 0, 145), 1 / RC)).toBeCloseTo(-left, 9);
    expect(curvatureAssist(carAt(S_BOTTOM + 100, 0, 145), 0)).toBe(0);
    expect(curvatureAssist(carAt(S_TURN1 + 100, 0, 30), -1 / RC)).toBe(0);
  });

  it('is CORNER_ASSIST of the lane curvature, so the outside lane gets less', () => {
    const car = carAt(S_TURN1 + 100, 0, 150);
    const v = 150 * CONFIG.PX_PER_MPH;
    expect(curvatureAssist(car, -1 / RC)).toBeCloseTo((CONFIG.CORNER_ASSIST * (-1 / RC)) / maxCurvature(v), 9);
    expect(Math.abs(curvatureAssist(car, laneCurvature(-1 / RC, 28.5)))).toBeLessThan(Math.abs(curvatureAssist(car, -1 / RC)));
  });

  it('fades out while the car slips, so it never fights a countersteer', () => {
    const car = carAt(S_TURN1 + 100, 0, 150);
    car.heading = car.moveAngle - 0.2;
    expect(Math.abs(curvatureAssist(car, -1 / RC))).toBe(0);
  });

  it('player steering: assist in both oval turns, straight-assist target only on straights', () => {
    for (const s of [S_TURN1 + 100, S_TURN2 + 100]) {
      const ps = new PlayerSteering();
      const car = carAt(s, 0, 150);
      let st = ps.update(car, 0, 1 / 60);
      for (let i = 0; i < 20; i++) st = ps.update(car, 0, 1 / 60);
      expect(st.steer).toBeLessThan(0);
      expect(st.straightTo).toBeUndefined();
    }
    const ps = new PlayerSteering();
    const st = ps.update(carAt(S_BOTTOM + 100, 0, 150), 0, 1 / 60);
    expect(st.steer).toBe(0);
    expect(st.straightTo).toBeCloseTo(0, 9);
  });
});

describe('grip model: straight assist', () => {
  it('straightens a small angle when not steering, turning nose and travel direction together', () => {
    const car = carAt(S_BOTTOM + 100, 0, 150);
    // (within STRAIGHT_FULL_DEG)
    car.heading = 0.015;
    car.moveAngle = 0.012;
    for (let i = 0; i < 60; i++) {
      stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false, straightTo: trackHeadingAt(car.x, car.y) }, 1 / 60, OVAL);
    }
    expect(Math.abs(wrapAngle(trackHeadingAt(car.x, car.y) - car.heading))).toBeLessThan(0.005);
  });

  it('fades out smoothly with the angle instead of a cliff, and leaves large angles alone', () => {
    const turned = (deg: number) => {
      const car = carAt(S_BOTTOM + 100, 0, 150);
      car.heading = car.moveAngle = (deg * Math.PI) / 180;
      stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false, straightTo: 0 }, 1 / 60, OVAL);
      return ((deg * Math.PI) / 180 - car.heading) * 60;
    };
    const { STRAIGHT_FULL_DEG: full, STRAIGHT_OFF_DEG: off } = CONFIG.GRIP;
    const fade = (x: number) => full + (off - full) * x;
    const rates = [full / 2, full, fade(0.25), fade(0.5), fade(0.75), off, off + 1].map(turned);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThanOrEqual(rates[i - 1]! + 1e-9);
    expect(rates[0]).toBeCloseTo(CONFIG.STRAIGHT_ASSIST_RATE, 6);
    expect(rates[2]).toBeGreaterThan(0.2);
    expect(Math.abs(rates[6]!)).toBeLessThan(1e-9);
  });

  /** A press of `press` s on the bottom straight from the centre line, 2.5 s on: px across, the most of it, heading off the road (deg). */
  const pressOn = (mph: number, press: number) => {
    const car = carAt(S_BOTTOM + 50, 0, mph);
    const ps = new PlayerSteering();
    let maxD = 0;
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const st = ps.update(car, t < press ? 1 : 0, 1 / 60);
      stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
      Object.assign(car, project(car.x, car.y));
      maxD = Math.max(maxD, car.d);
    }
    const deg = (wrapAngle(car.heading - trackHeadingAt(car.x, car.y)) * 180) / Math.PI;
    return { d: car.d, maxD, deg, spin: car.spinTime > 0 };
  };

  it('a 100 or 200 ms press at 180 mph moves the car across, the longer one further, then the assist straightens it', () => {
    const short = pressOn(180, 0.1);
    const long = pressOn(180, 0.2);
    expect(short.d).toBeGreaterThan(1);
    expect(long.d).toBeGreaterThan(short.d * 2);
    expect(long.maxD).toBeLessThan(HALF_W - CAR_R);
    for (const r of [short, long]) {
      expect(Math.abs(r.deg)).toBeLessThan(0.01);
      expect(r.spin).toBe(false);
    }
  });

  it('a press that turns the car past STRAIGHT_OFF_DEG is left alone: at 120 mph 150 ms runs on to the wall without a spin', () => {
    const r = pressOn(120, 0.15);
    expect(r.maxD).toBeGreaterThan(HALF_W - CAR_R - 1);
    expect(r.spin).toBe(false);
  });
});

describe('grip model: key and touch steering cap (designer H2)', () => {
  const demand = (car: { speed: number }, steer: number) => {
    const v = car.speed * CONFIG.PX_PER_MPH;
    return (Math.abs(steer) * maxCurvature(v) * v * v) / gripAt(v);
  };
  const hold = (ps: PlayerSteering, car: ReturnType<typeof carAt>, key: number, s: number, brake = false) => {
    let st = ps.update(car, key, 1 / 60, brake);
    for (let t = 1 / 60; t < s; t += 1 / 60) st = ps.update(car, key, 1 / 60, brake);
    return st.steer;
  };

  it('a held key asks for KEY_CAP x the grip at speed, on straights and in corners; full lock at low speed', () => {
    for (const [s, mph] of [
      [S_BOTTOM + 100, 180],
      [S_BOTTOM + 100, 140],
      [S_TURN1 + 100, 150],
    ] as const) {
      const car = carAt(s, 0, mph);
      expect(demand(car, hold(new PlayerSteering(), car, -1, 1)), `${s} ${mph}`).toBeCloseTo(CONFIG.GRIP.KEY_CAP, 6);
    }
    expect(hold(new PlayerSteering(), carAt(S_BOTTOM + 100, 0, 60), 1, 1)).toBe(1);
  });

  it('braking leaves less grip to steer with, so the cap drops', () => {
    const car = carAt(S_BOTTOM + 100, 0, 170);
    expect(keyCap(car, true)).toBeLessThan(keyCap(car, false));
    expect(Math.abs(hold(new PlayerSteering(), car, 1, 0.5, true))).toBeCloseTo(keyCap(car, true), 9);
  });

  /**
   * Speed factor over the lane limit at which the line needs 1 + over x the grip. (Above KNEE_MPH the grip
   * fades with speed, so a few % of speed is many % of grip: the tests below are stated in grip.)
   */
  const overBy = (over: number, d = 0) => {
    const k = Math.abs(laneCurvature(-1 / RC, d));
    const lim = limitMph(k);
    const need = (f: number) => {
      const v = lim * f * CONFIG.PX_PER_MPH;
      return (v * v * k) / gripAt(v) - 1;
    };
    let lo = 1;
    let hi = 1.5;
    for (let i = 0; i < 40; i++) [lo, hi] = need((lo + hi) / 2) < over ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return lo;
  };

  it('at or under the limit a key held for the whole corner never goes past the cap (no overdrive)', () => {
    const lim = limitMph(laneCurvature(-1 / RC, 0));
    for (const f of [0.9, 1.0, overBy(0.08)]) {
      const ps = new PlayerSteering();
      const car = carAt(S_TURN1 + 50, 0, lim * f);
      expect(demand(car, hold(ps, car, -1, 3)), `x${f}`).toBeLessThanOrEqual(CONFIG.GRIP.KEY_CAP + 1e-9);
      expect(ps.overdrive).toBe(0);
    }
  });

  it('insisting into a corner the car is too fast for opens the steering: later and less for a small excess', () => {
    const opened = (f: number, s: number, d = 0) => {
      const car = carAt(S_TURN1 + 50, d, limitMph(laneCurvature(-1 / RC, d)) * f);
      return demand(car, hold(new PlayerSteering(), car, -1, s));
    };
    const G = CONFIG.GRIP;
    const small = overBy(0.14);
    const more = overBy(0.28);
    // 14 % over the grip: opens a little, after OVERDRIVE_S / 1.4
    expect(opened(small, 0.3)).toBeCloseTo(G.KEY_CAP, 6);
    expect(opened(small, 2)).toBeGreaterThan(G.KEY_CAP + 0.02);
    expect(opened(small, 2)).toBeLessThan(1.3);
    // 28 % over: further, sooner
    expect(opened(more, 1)).toBeGreaterThan(1.25);
    expect(opened(more, 0.4)).toBeGreaterThan(opened(small, 0.4));
    // 44 % over the grip: full lock (STEER_CAP x the grip) within half a second
    // (full lock asks STEER_CAP x the full grip, more than STEER_CAP x the faded grip)
    expect(opened(overBy(0.44, -28.5), 0.5, -28.5)).toBeGreaterThanOrEqual(G.STEER_CAP);
  });

  it('a key out of the bend (countersteer) or a released key never overdrives', () => {
    const lim = limitMph(laneCurvature(-1 / RC, 0));
    const car = carAt(S_TURN1 + 50, 0, lim * 1.2);
    const ps = new PlayerSteering();
    expect(demand(car, hold(ps, car, 1, 2))).toBeLessThanOrEqual(CONFIG.GRIP.KEY_CAP + 1e-9);
    hold(ps, car, -1, 2);
    expect(ps.overdrive).toBe(1);
    // letting go winds it down: a short release keeps some (pulsing still insists), a longer one clears it
    hold(ps, car, 0, 0.1);
    expect(ps.overdrive).toBeGreaterThan(0);
    hold(ps, car, 0, 1.2);
    expect(ps.overdrive).toBe(0);
  });
});

describe('key wheel (STEERING_PLAN B1, B2, B6)', () => {
  const STEP = 1 / 60;
  const run = (ps: PlayerSteering, car: ReturnType<typeof carAt>, key: number, steps: number) => {
    let st = ps.update(car, key, STEP);
    for (let i = 1; i < steps; i++) st = ps.update(car, key, STEP);
    return st.steer;
  };

  it('a longer tap moves the car further across (no all or nothing), and the straight assist straightens it after', () => {
    for (const mph of [140, 180]) {
      const across = [1, 2, 3, 4, 6].map((n) => tapAcross(mph, n));
      expect(across[0], `${mph} mph`).toBeGreaterThan(0);
      for (let i = 1; i < across.length; i++) expect(across[i]!, `${mph} mph`).toBeGreaterThan(across[i - 1]! * 1.3);
      expect(Math.abs(tapAngle(mph, 6)), `${mph} mph`).toBeLessThan(0.01);
    }
  });

  it('the stop (the key cap) comes after the same time at any speed, on a straight and in a corner', () => {
    const times = [toStop(100, false), toStop(100, true), toStop(140, false), toStop(140, true)];
    for (const t of times) expect(t).toBeCloseTo(times[0]!, 6);
    expect(times[0]).toBeGreaterThan(150);
    expect(times[0]).toBeLessThan(300);
  });

  it('tapping is about proportional: at 50 % duty the grip used hardly depends on the tapping rate', () => {
    const use = [12, 8, 5, 4].map((n) => tapping(140, n, n, 0).use);
    // (the old ramp: 0.19 to 0.34)
    expect(Math.max(...use) - Math.min(...use)).toBeLessThan(0.13);
  });

  it('tapping at 5 Hz on an arc sways the heading by under 2.5 degrees (the old ramp: 4.7)', () => {
    for (const arc of [0.5, 0.65]) expect(tapping(140, 6, 6, arc).sway, `arc ${arc}`).toBeLessThan(2.5);
  });

  it('a released key centres the wheel within about 0.2 s, to exactly 0 (where the straight assist can act)', () => {
    const car = carAt(S_BOTTOM + 100, 0, 150);
    const ps = new PlayerSteering();
    expect(run(ps, car, 1, 30)).toBeGreaterThan(0);
    const released = (steps: number) => run(ps, car, 0, steps);
    expect(released(1)).toBeGreaterThan(0);
    released(12);
    expect(ps.wheel).toBe(0);
    expect(ps.update(car, 0, STEP).steer).toBe(0);
  });

  it('turning the other way crosses the centre fast but not in one step', () => {
    const car = carAt(S_BOTTOM + 100, 0, 150);
    const ps = new PlayerSteering();
    run(ps, car, 1, 30);
    expect(ps.wheel).toBe(1);
    ps.update(car, -1, STEP);
    expect(ps.wheel).toBeGreaterThan(0);
    expect(ps.wheel).toBeLessThan(0.5);
    run(ps, car, -1, 2);
    expect(ps.wheel).toBeLessThan(0);
  });

  it('a countersteer at 170 mph reaches the cap within 2 steps (the old ramp: 1)', () => {
    expect(catchSteps(170)).toBeLessThanOrEqual(2);
  });

  it('nearly stopped (and in reverse) the wheel turns to full lock in under 0.2 s', () => {
    const car = carAt(S_BOTTOM + 100, 0, 5);
    const ps = new PlayerSteering();
    expect(run(ps, car, 1, 12)).toBe(1);
    car.reverse = true;
    expect(run(ps, car, -1, 12)).toBe(-1);
  });

  it('a spin centres the wheel; a lost focus centres it but keeps the corner assist blended in', () => {
    const car = carAt(S_TURN1 + 100, 0, 150);
    const ps = new PlayerSteering();
    run(ps, car, -1, 30);
    car.spinTime = 0.5;
    ps.update(car, -1, STEP);
    expect(ps.wheel).toBe(0);
    car.spinTime = 0;
    const assistOnly = run(new PlayerSteering(), car, 0, 30);
    run(ps, car, -1, 30);
    ps.release();
    expect(ps.wheel).toBe(0);
    expect(ps.update(car, 0, STEP).steer).toBeCloseTo(assistOnly, 9);
  });

  it('braking clips the steer to the braked cap without rescaling the wheel', () => {
    const car = carAt(S_BOTTOM + 100, 0, 170);
    const ps = new PlayerSteering();
    // half way to the stop: under the braked cap, the brake changes nothing
    const half = run(ps, car, 1, 5);
    expect(half).toBeLessThan(keyCap(car, true));
    const ps2 = new PlayerSteering();
    let braked = 0;
    for (let i = 0; i < 5; i++) braked = ps2.update(car, 1, STEP, i === 4).steer;
    expect(braked).toBeCloseTo(half, 9);
  });

  it('tapping into a corner far too fast opens the steering as holding does', () => {
    for (const f of [1.15, 1.25]) {
      const held = tapOverdrive(f, 60, 0);
      expect(held, `x${f}`).toBe(1);
      for (const [on, off] of [
        [4, 4],
        [6, 6],
        [3, 3],
      ] as const)
        expect(Math.abs(tapOverdrive(f, on, off) - held), `x${f} ${on}/${off}`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('straight assist after a key (no latch since 2026-10-19)', () => {
  /**
   * A left bend onto a long straight at 120 mph. The key is held into the bend; on the straight it is still
   * held for 6 steps (carried) or let go there and tapped once 15 steps later (fresh). 40 steps after the
   * straight starts the heading is set 1 deg off the road: the error 1 s later (deg).
   */
  function errorAfter(fresh: boolean): number {
    const mph = 120;
    const v = mph * CONFIG.PX_PER_MPH;
    const t = new CurveTrack([
      { len: 200, k: 0 },
      { len: 600, k: -(0.8 * gripAt(v)) / (v * v) },
      { len: 4000, k: 0 },
    ]);
    const car = freshCar();
    placeCar(car, t, 700, 0, mph);
    const ps = new PlayerSteering(steerTrack(t));
    const road = (s: number) => t.pointAt(s, 0).heading;
    let s = 700;
    let straightAt = -1;
    for (let i = 0; i < 200; i++) {
      const st = t.project(car.x, car.y, s);
      s = car.s = st.s;
      car.d = st.d;
      if (straightAt < 0 && s > 800) straightAt = i;
      const k = i - straightAt;
      let key = straightAt < 0 ? -1 : 0;
      if (straightAt >= 0 && !fresh && k < 6) key = -1;
      if (straightAt >= 0 && fresh && k >= 15 && k < 20) key = -1;
      if (straightAt >= 0 && k === 40) car.heading = car.moveAngle = road(s) + Math.PI / 180;
      const out = ps.update(car, key, 1 / 60);
      stepCar(
        car,
        { steer: out.steer, straightTo: out.straightTo, gas: car.speed < mph, brake: false, toggleReverse: false },
        1 / 60,
        OVAL_NO_WALLS,
      );
      if (straightAt >= 0 && k === 100) return (wrapAngle(car.heading - road(t.project(car.x, car.y, s).s)) * 180) / Math.PI;
    }
    return Number.NaN;
  }

  it('a key held out of the bend: once let go, the car straightens', () => {
    expect(Math.abs(errorAfter(false))).toBeLessThan(0.1);
  });

  it('a fresh tap on the straight does not turn the assist off: once let go, the car straightens', () => {
    expect(Math.abs(errorAfter(true))).toBeLessThan(0.1);
  });
});

describe('corner assist at the end of a bend (STEERING_PLAN B6)', () => {
  it('fades out over CORNER_ASSIST_IN_S instead of dropping in one step, and a slide still cuts it at once', () => {
    const exitTo = (slip: number) => {
      const car = carAt(S_TURN1 + 100, 0, 150);
      const ps = new PlayerSteering();
      for (let i = 0; i < 30; i++) ps.update(car, 0, 1 / 60);
      const inBend = ps.update(car, 0, 1 / 60).steer;
      const p = pointAt(S_BOTTOM + 100, 0);
      Object.assign(car, { x: p.x, y: p.y, heading: p.heading + slip, moveAngle: p.heading, s: S_BOTTOM + 100 });
      return { inBend, out: ps.update(car, 0, 1 / 60).steer, ps, car };
    };
    const { inBend, out, ps, car } = exitTo(0);
    expect(inBend).toBeLessThan(0);
    expect(out / inBend).toBeCloseTo(1 - 1 / 60 / CONFIG.CORNER_ASSIST_IN_S, 6);
    for (let i = 0; i < 10; i++) ps.update(car, 0, 1 / 60);
    expect(ps.update(car, 0, 1 / 60).steer).toBe(0);
    expect(exitTo(0.2).out).toBe(0);
  });
});
