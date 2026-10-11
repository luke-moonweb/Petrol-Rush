import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { Car } from '../src/race/car';
import { collideCars, cornerAssist, skidWarning, SteerRamp, stepCar } from '../src/race/physics';
import { Race } from '../src/race/race';
import { pointAt, project, S_BOTTOM, S_TURN1, trackHeadingAt, wrapAngle } from '../src/track/track';

function carAt(s: number, mph: number): Car {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 3);
  const car = race.player;
  const p = pointAt(s, 0);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph });
  return car;
}

function driveThroughTurn(car: Car, holdGas: boolean): boolean {
  let spun = false;
  for (let i = 0; i < 60 * 3; i++) {
    const st = project(car.x, car.y);
    const t = pointAt(st.s + 60, 0);
    const diff = wrapAngle(Math.atan2(t.y - car.y, t.x - car.x) - car.heading);
    stepCar(car, { steer: Math.max(-1, Math.min(1, diff * 5)), gas: holdGas, brake: false, toggleReverse: false }, 1 / 60);
    if (car.spinTime > 0) spun = true;
  }
  return spun;
}

describe('driving model', () => {
  it('slightly over 150 mph in a corner: slide (slows down, no spin)', () => {
    const car = carAt(S_TURN1 - 150, 156);
    let slid = false;
    for (let i = 0; i < 60 * 3; i++) {
      const st = project(car.x, car.y);
      const t = pointAt(st.s + 60, 0);
      const diff = wrapAngle(Math.atan2(t.y - car.y, t.x - car.x) - car.heading);
      stepCar(car, { steer: Math.max(-1, Math.min(1, diff * 5)), gas: false, brake: false, toggleReverse: false }, 1 / 60);
      if (car.slideTime > 0) slid = true;
      expect(car.spinTime).toBe(0);
    }
    expect(slid).toBe(true);
    expect(car.speed).toBeLessThanOrEqual(CONFIG.SPIN_MPH);
  });

  it('well over 150 mph in a corner: spin', () => {
    expect(driveThroughTurn(carAt(S_TURN1 - 150, 165), false)).toBe(true);
  });

  it('corner assist: guides the car in a corner, does nothing on a straight', () => {
    expect(cornerAssist(carAt(S_TURN1 + 100, 145))).toBeLessThan(0);
    expect(cornerAssist(carAt(S_TURN1 + 100, 145))).toBeGreaterThan(-0.5);
    expect(cornerAssist(carAt(S_BOTTOM + 100, 145))).toBe(0);
    expect(cornerAssist(carAt(S_TURN1 + 100, 20))).toBe(0);
  });

  it('no slide in a corner at 150 mph', () => {
    expect(driveThroughTurn(carAt(S_TURN1 - 150, 150), false)).toBe(false);
  });

  it('brake overrides throttle and never engages reverse', () => {
    const car = carAt(100, 120);
    for (let i = 0; i < 30; i++) stepCar(car, { steer: 0, gas: true, brake: true, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBeLessThan(120);
    for (let i = 0; i < 60 * 5; i++) stepCar(car, { steer: 0, gas: false, brake: true, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBe(0);
    expect(car.reverse).toBe(false);
  });

  it('braking from 180 to 150 mph takes less than 0.5 s', () => {
    const car = carAt(-2000, 180);
    let t = 0;
    while (car.speed > 150) {
      stepCar(car, { steer: 0, gas: false, brake: true, toggleReverse: false }, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(0.5);
  });

  it('skid lamp: red above 150 mph anywhere on track, blinks in a corner', () => {
    expect(skidWarning(carAt(S_BOTTOM + 50, 150))).toBe(0);
    expect(skidWarning(carAt(S_BOTTOM + 50, 155))).toBe(1);
    expect(skidWarning(carAt(S_TURN1 + 80, 160))).toBe(2);
    expect(skidWarning(carAt(S_TURN1 + 80, 140))).toBe(0);
  });

  it('keyboard: a short tap is a small correction, holding gives a full turn', () => {
    const r = new SteerRamp();
    expect(r.update(1, 1 / 60)).toBeLessThan(0.3);
    let v = 0;
    for (let i = 0; i < 30; i++) v = r.update(1, 1 / 60);
    expect(v).toBe(1);
    expect(r.update(0, 1 / 60)).toBe(0);
  });

  it('on a straight a small angle straightens out when not steering', () => {
    const car = carAt(S_BOTTOM + 100, 150);
    car.heading = car.moveAngle = 0.08;
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60);
    expect(Math.abs(wrapAngle(trackHeadingAt(car.x, car.y) - car.heading))).toBeLessThan(0.005);
  });

  it('cruise control: speed is kept after releasing the throttle', () => {
    const car = carAt(100, 120);
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBeCloseTo(120, 5);
  });

  it('top speed is 180 mph', () => {
    const car = carAt(-2000, 0);
    for (let i = 0; i < 60 * 20; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBeLessThanOrEqual(CONFIG.MAX_MPH);
  });

  it('reverse: engages only at low speed and drives backwards', () => {
    const car = carAt(100, 100);
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60);
    expect(car.reverse).toBe(false);
    car.speed = 0;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60);
    expect(car.reverse).toBe(true);
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBeLessThan(0);
    expect(car.speed).toBeGreaterThanOrEqual(-CONFIG.MAX_REVERSE_MPH);
  });

  it('reverse: second Shift immediately returns to forward even while reversing', () => {
    const car = carAt(100, 100);
    car.speed = 0;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60);
    expect(car.reverse).toBe(true);
    car.speed = -CONFIG.MAX_REVERSE_MPH;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60);
    expect(car.reverse).toBe(false);
  });

  it('a car out of fuel stops', () => {
    const car = carAt(100, 100);
    car.fuel = 0;
    for (let i = 0; i < 60 * 10; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60);
    expect(car.speed).toBe(0);
  });
});

describe('crashes', () => {
  function pair(rearMph: number, frontMph: number): [Car, Car] {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
    const [a, b] = race.cars;
    const pa = pointAt(200, 0);
    const pb = pointAt(233, 0);
    Object.assign(a, { x: pa.x, y: pa.y, heading: 0, moveAngle: 0, speed: rearMph, s: 200, d: 0 });
    Object.assign(b, { x: pb.x, y: pb.y, heading: 0, moveAngle: 0, speed: frontMph, s: 233, d: 0 });
    return [a, b];
  }

  it('classic mode: a hard rear hit spins both cars and they bounce apart', () => {
    const [a, b] = pair(170, 60);
    collideCars([a, b], 'classic');
    expect(a.spinTime).toBeGreaterThan(0);
    expect(b.spinTime).toBeGreaterThan(0);
    expect(b.speed).toBeGreaterThan(60);
    expect(a.speed).toBeLessThan(170);
  });

  it('light bumper-to-bumper contact does not cause a crash', () => {
    const [a, b] = pair(170, 160);
    collideCars([a, b]);
    expect(a.spinTime).toBe(0);
    expect(b.spinTime).toBe(0);
    expect(a.speed).toBeLessThanOrEqual(160);
  });

  it('a push never accelerates a car above 180 mph', () => {
    const [a, b] = pair(180, 179);
    for (let i = 0; i < 5; i++) {
      collideCars([a, b]);
      stepCar(b, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60);
    }
    expect(b.speed).toBeLessThanOrEqual(CONFIG.MAX_MPH);
  });

  it('after a crash the car stays turned (no automatic straightening)', () => {
    const [a, b] = pair(170, 40);
    collideCars([a, b]);
    for (let i = 0; i < 60 * 4; i++) stepCar(b, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60);
    expect(b.spinTime).toBe(0);
    expect(Math.abs(b.heading)).toBeGreaterThan(0.3);
  });

  it('realistic mode: the car hit in the rear spins, the hitter does not and is the culprit', () => {
    const [a, b] = pair(170, 60);
    let culprit: Car | null = null;
    let victims: Car[] = [];
    collideCars([a, b], 'realistic', (c, v) => {
      culprit = c;
      victims = v;
    });
    expect(b.spinTime).toBeGreaterThan(0);
    expect(a.spinTime).toBe(0);
    expect(a.speed).toBeLessThan(170);
    expect(culprit).toBe(a);
    expect(victims).toEqual([b]);
  });

  it('realistic mode: in a corner a weaker rear hit is enough to spin', () => {
    const at = (s: number, mph: number, c: Car) => {
      const p = pointAt(s, 0);
      Object.assign(c, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, s, d: 0 });
    };
    const [a, b] = pair(0, 0);
    at(S_TURN1 + 100, 150, a);
    at(S_TURN1 + 133, 132, b);
    collideCars([a, b], 'realistic');
    expect(b.spinTime).toBeGreaterThan(0);
    const [c, d] = pair(150, 132);
    collideCars([c, d], 'realistic');
    expect(d.spinTime).toBe(0);
  });

  it('penalty: car ahead changes lane in front of the car behind – the car behind is at fault (both modes)', () => {
    for (const mode of ['realistic', 'classic'] as const) {
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
      const [rear, front] = race.cars;
      const pr = pointAt(300, 0);
      const pf = pointAt(300 + 30, -16);
      Object.assign(rear, { x: pr.x, y: pr.y, heading: 0, moveAngle: 0, speed: 160, s: 300, d: 0 });
      Object.assign(front, { x: pf.x, y: pf.y, heading: 0, moveAngle: 0, speed: 120, s: 330, d: -16 });
      let culprit: Car | null | undefined;
      for (let i = 0; i < 90 && culprit === undefined; i++) {
        stepCar(rear, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60);
        stepCar(front, { steer: 1, gas: false, brake: false, toggleReverse: false }, 1 / 60);
        for (const c of [rear, front]) Object.assign(c, project(c.x, c.y));
        collideCars([rear, front], mode, (c) => (culprit = c));
      }
      expect(culprit, mode).toBe(rear);
    }
  });

  it('penalty: a car ahead reversing into the car behind is at fault', () => {
    const [a, b] = pair(0, 0);
    const pb = pointAt(228, 0);
    Object.assign(b, { x: pb.x, y: pb.y, s: 228, speed: -70, reverse: true });
    let culprit: Car | null | undefined;
    collideCars([a, b], 'classic', (c) => (culprit = c));
    expect(culprit).toBe(b);
  });

  it('realistic mode: side-by-side rubbing does not cause a spin', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
    const [a, b] = race.cars;
    const pa = pointAt(300, -8);
    const pb = pointAt(300, 6);
    Object.assign(a, { x: pa.x, y: pa.y, heading: 0.12, moveAngle: 0.12, speed: 170, s: 300, d: -8 });
    Object.assign(b, { x: pb.x, y: pb.y, heading: 0, moveAngle: 0, speed: 165, s: 300, d: 6 });
    collideCars([a, b], 'realistic');
    expect(a.spinTime).toBe(0);
    expect(b.spinTime).toBe(0);
  });
});
