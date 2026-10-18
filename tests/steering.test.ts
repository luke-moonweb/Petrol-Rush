import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { curvatureAssist, gripAt, limitMph, maxCurvature, stepCar } from '../src/race/physics';
import { keyCap, PlayerSteering } from '../src/race/steering';
import { laneCurvature } from '../src/track/curvature';
import { CAR_R, HALF_W, pointAt, project, RC, S_BOTTOM, S_TURN1, S_TURN2, trackHeadingAt, wrapAngle } from '../src/track/oval';
import { OVAL } from '../src/track/ovalTrack';
import { freshCar } from './sim/drivers';

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
    car.heading = 0.08;
    car.moveAngle = 0.06;
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
    const rates = [3, 6, 8, 10, 12, 14, 20].map(turned);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThanOrEqual(rates[i - 1]! + 1e-9);
    expect(rates[0]).toBeCloseTo(CONFIG.STRAIGHT_ASSIST_RATE, 6);
    expect(rates[2]).toBeGreaterThan(0.2);
    expect(Math.abs(rates[6]!)).toBeLessThan(1e-9);
  });

  it('a 100 ms tap at 180 mph is a small correction that stays (a few px), not undone', () => {
    const car = carAt(S_BOTTOM + 50, 0, 180);
    const ps = new PlayerSteering();
    for (let t = 0; t < 2; t += 1 / 60) {
      const st = ps.update(car, t < 0.1 ? 1 : 0, 1 / 60);
      stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
      Object.assign(car, project(car.x, car.y));
    }
    // (under 1 px since the grip fades above KNEE_MPH: at top speed the car steers about 4 x less sharply)
    expect(car.d).toBeGreaterThan(0.3);
    expect(car.d).toBeLessThan(10);
  });

  it('a 200 ms press at 180 mph from the centre line is caught by the assist before the wall (designer L5)', () => {
    const car = carAt(S_BOTTOM + 50, 0, 180);
    const ps = new PlayerSteering();
    let maxD = 0;
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const st = ps.update(car, t < 0.2 ? 1 : 0, 1 / 60);
      stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
      Object.assign(car, project(car.x, car.y));
      maxD = Math.max(maxD, car.d);
    }
    // (a few px since the grip fades above KNEE_MPH)
    expect(maxD).toBeGreaterThan(2);
    expect(maxD).toBeLessThan(HALF_W - CAR_R - 2);
    expect(car.spinTime).toBe(0);
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
    expect(opened(overBy(0.44, -28.5), 0.5, -28.5)).toBeCloseTo(G.STEER_CAP, 6);
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
