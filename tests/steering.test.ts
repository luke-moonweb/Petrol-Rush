import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../src/config';
import { curvatureAssist, maxCurvature, stepCar } from '../src/race/physics';
import { PlayerSteering } from '../src/race/steering';
import { laneCurvature } from '../src/track/curvature';
import { pointAt, project, RC, S_BOTTOM, S_TURN1, S_TURN2, trackHeadingAt, wrapAngle } from '../src/track/track';
import { freshCar } from './sim/drivers';

let saved: DriveModel;
beforeAll(() => {
  saved = CONFIG.DRIVE_MODEL;
  CONFIG.DRIVE_MODEL = 'grip';
});
afterAll(() => {
  CONFIG.DRIVE_MODEL = saved;
});

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
      stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false, straightTo: trackHeadingAt(car.x, car.y) }, 1 / 60);
    }
    expect(Math.abs(wrapAngle(trackHeadingAt(car.x, car.y) - car.heading))).toBeLessThan(0.005);
  });

  it('fades out smoothly with the angle instead of a cliff, and leaves large angles alone', () => {
    const turned = (deg: number) => {
      const car = carAt(S_BOTTOM + 100, 0, 150);
      car.heading = car.moveAngle = (deg * Math.PI) / 180;
      stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false, straightTo: 0 }, 1 / 60);
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
      stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: true, brake: false, toggleReverse: false }, 1 / 60);
      Object.assign(car, project(car.x, car.y));
    }
    expect(car.d).toBeGreaterThan(2.5);
    expect(car.d).toBeLessThan(10);
  });
});
