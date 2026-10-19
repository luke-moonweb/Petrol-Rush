import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import type { Car } from '../src/race/car';
import { collideCars, limitMph, stepCar } from '../src/race/physics';
import { Race } from '../src/race/race';
import { wrapAngle } from '../src/track/common';
import { laneCurvature } from '../src/track/curvature';
import { gpTracks } from '../src/track/gp';
import { pointAt, project, S_TURN1 } from '../src/track/oval';
import { OVAL } from '../src/track/ovalTrack';
import { CurveTrack } from './sim/curves';
import { runCurve, SteerRamp } from './sim/drivers';

function carAt(s: number, mph: number): Car {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 3);
  const car = race.player;
  const p = pointAt(s, 0);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph });
  return car;
}

function crashPair(rearMph: number, frontMph: number): [Car, Car] {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
  const [a, b] = race.cars as [Car, Car];
  const pa = pointAt(200, 0);
  const pb = pointAt(233, 0);
  Object.assign(a, { x: pa.x, y: pa.y, heading: 0, moveAngle: 0, speed: rearMph, s: 200, d: 0 });
  Object.assign(b, { x: pb.x, y: pb.y, heading: 0, moveAngle: 0, speed: frontMph, s: 233, d: 0 });
  return [a, b];
}

function driveThroughTurn(car: Car, holdGas: boolean): boolean {
  let spun = false;
  for (let i = 0; i < 60 * 3; i++) {
    const st = project(car.x, car.y);
    const t = pointAt(st.s + 60, 0);
    const diff = wrapAngle(Math.atan2(t.y - car.y, t.x - car.x) - car.heading);
    stepCar(car, { steer: Math.max(-1, Math.min(1, diff * 5)), gas: holdGas, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    if (car.spinTime > 0) spun = true;
  }
  return spun;
}

describe('driving model', () => {
  it('no slide in a corner at 150 mph', () => {
    expect(driveThroughTurn(carAt(S_TURN1 - 150, 150), false)).toBe(false);
  });

  it('brake overrides throttle and never engages reverse', () => {
    const car = carAt(100, 120);
    for (let i = 0; i < 30; i++) stepCar(car, { steer: 0, gas: true, brake: true, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBeLessThan(120);
    for (let i = 0; i < 60 * 5; i++) stepCar(car, { steer: 0, gas: false, brake: true, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBe(0);
    expect(car.reverse).toBe(false);
  });

  it('braking from 180 to 150 mph takes less than 0.5 s', () => {
    const car = carAt(-2000, 180);
    let t = 0;
    while (car.speed > 150) {
      stepCar(car, { steer: 0, gas: false, brake: true, toggleReverse: false }, 1 / 60, OVAL);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(0.5);
  });

  it('the stress drivers key ramp: a short tap is a small correction, holding gives a full turn', () => {
    const r = new SteerRamp();
    expect(r.update(1, 1 / 60)).toBeLessThan(0.3);
    let v = 0;
    for (let i = 0; i < 30; i++) v = r.update(1, 1 / 60);
    expect(v).toBe(1);
    expect(r.update(0, 1 / 60)).toBe(0);
  });

  it('off the throttle the car coasts down slowly, much gentler than braking', () => {
    const car = carAt(100, 120);
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBeCloseTo(120 - CONFIG.COAST_MPH_S, 5);
    expect(CONFIG.COAST_MPH_S).toBeLessThan(CONFIG.BRAKE_MPH_S / 4);
  });

  it('top speed is 180 mph', () => {
    const car = carAt(-2000, 0);
    for (let i = 0; i < 60 * 20; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBeLessThanOrEqual(CONFIG.MAX_MPH);
  });

  it('reverse: engages only at low speed and drives backwards', () => {
    const car = carAt(100, 100);
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60, OVAL);
    expect(car.reverse).toBe(false);
    car.speed = 0;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60, OVAL);
    expect(car.reverse).toBe(true);
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBeLessThan(0);
    expect(car.speed).toBeGreaterThanOrEqual(-CONFIG.MAX_REVERSE_MPH);
  });

  it('reverse: second Shift immediately returns to forward even while reversing', () => {
    const car = carAt(100, 100);
    car.speed = 0;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60, OVAL);
    expect(car.reverse).toBe(true);
    car.speed = -CONFIG.MAX_REVERSE_MPH;
    stepCar(car, { steer: 0, gas: false, brake: false, toggleReverse: true }, 1 / 60, OVAL);
    expect(car.reverse).toBe(false);
  });

  it('a car out of fuel stops', () => {
    const car = carAt(100, 100);
    car.fuel = 0;
    for (let i = 0; i < 60 * 10; i++) stepCar(car, { steer: 0, gas: true, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    expect(car.speed).toBe(0);
  });
});

describe('crashes', () => {
  const pair = crashPair;

  it('classic mode: a hard rear hit spins both cars and they bounce apart', () => {
    const [a, b] = pair(170, 60);
    collideCars([a, b], OVAL, 'classic');
    expect(a.spinTime).toBeGreaterThan(0);
    expect(b.spinTime).toBeGreaterThan(0);
    expect(b.speed).toBeGreaterThan(60);
    expect(a.speed).toBeLessThan(170);
  });

  it('light bumper-to-bumper contact does not cause a crash', () => {
    const [a, b] = pair(170, 160);
    collideCars([a, b], OVAL);
    expect(a.spinTime).toBe(0);
    expect(b.spinTime).toBe(0);
    expect(a.speed).toBeLessThanOrEqual(160);
  });

  it('a push never accelerates a car above 180 mph', () => {
    const [a, b] = pair(180, 179);
    for (let i = 0; i < 5; i++) {
      collideCars([a, b], OVAL);
      stepCar(b, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    }
    expect(b.speed).toBeLessThanOrEqual(CONFIG.MAX_MPH);
  });

  it('after a crash the car stays turned (no automatic straightening)', () => {
    const [a, b] = pair(170, 40);
    collideCars([a, b], OVAL);
    for (let i = 0; i < 60 * 4; i++) stepCar(b, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60, OVAL);
    expect(b.spinTime).toBe(0);
    expect(Math.abs(b.heading)).toBeGreaterThan(0.3);
  });

  it('realistic mode: the car hit in the rear spins, the hitter does not and is the culprit', () => {
    const [a, b] = pair(170, 60);
    let culprit: Car | null = null;
    let victims: Car[] = [];
    collideCars([a, b], OVAL, 'realistic', (c, v) => {
      culprit = c;
      victims = v;
    });
    expect(b.spinTime).toBeGreaterThan(0);
    expect(a.spinTime).toBe(0);
    expect(a.speed).toBeLessThan(170);
    expect(culprit).toBe(a);
    expect(victims).toEqual([b]);
  });

  it('penalty: car ahead changes lane in front of the car behind – the car behind is at fault (both modes)', () => {
    for (const mode of ['realistic', 'classic'] as const) {
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
      const [rear, front] = race.cars as [Car, Car];
      const pr = pointAt(300, 0);
      const pf = pointAt(300 + 30, -16);
      Object.assign(rear, { x: pr.x, y: pr.y, heading: 0, moveAngle: 0, speed: 160, s: 300, d: 0 });
      Object.assign(front, { x: pf.x, y: pf.y, heading: 0, moveAngle: 0, speed: 120, s: 330, d: -16 });
      let culprit: Car | null | undefined;
      for (let i = 0; i < 90 && culprit === undefined; i++) {
        stepCar(rear, { steer: 0, gas: false, brake: false, toggleReverse: false }, 1 / 60, OVAL);
        stepCar(front, { steer: 1, gas: false, brake: false, toggleReverse: false }, 1 / 60, OVAL);
        for (const c of [rear, front]) Object.assign(c, project(c.x, c.y));
        collideCars([rear, front], OVAL, mode, (c) => (culprit = c));
      }
      expect(culprit, mode).toBe(rear);
    }
  });

  it('penalty: a car ahead reversing into the car behind is at fault', () => {
    const [a, b] = pair(0, 0);
    const pb = pointAt(228, 0);
    Object.assign(b, { x: pb.x, y: pb.y, s: 228, speed: -70, reverse: true });
    let culprit: Car | null | undefined;
    collideCars([a, b], OVAL, 'classic', (c) => (culprit = c));
    expect(culprit).toBe(b);
  });

  it('realistic mode: a rear hit spins a car with loaded tyres (cornering) at a lower closing speed', () => {
    // closing at 24 mph, square on the middle: above REAR_SPIN_TURN_MPH, below REAR_SPIN_MPH (both x REAR_CENTRE_X)
    const [a, b] = crashPair(150, 126);
    b.gripUse = CONFIG.GRIP.LOADED_USE;
    collideCars([a, b], OVAL, 'realistic');
    expect(b.spinTime).toBeGreaterThan(0);
    const [c, d] = crashPair(150, 126);
    collideCars([c, d], OVAL, 'realistic');
    expect(d.spinTime).toBe(0);
  });

  it('realistic mode: a rear hit square on the middle spins only at REAR_CENTRE_X x the speed, on the corner as before', () => {
    // 30 mph faster: over REAR_SPIN_MPH, under REAR_CENTRE_X x it
    const [a, b] = crashPair(150, 120);
    collideCars([a, b], OVAL, 'realistic');
    expect(b.spinTime).toBe(0);
    // 8 px across (over half a car's width): about 23 mph of it closes along the contact
    const [c, d] = crashPair(150, 120);
    const pd = pointAt(230, 8);
    Object.assign(d, { x: pd.x, y: pd.y, s: 230, d: 8 });
    collideCars([c, d], OVAL, 'realistic');
    expect(d.spinTime).toBeGreaterThan(0);
  });

  it('realistic mode: side-by-side rubbing does not cause a spin', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5);
    const [a, b] = race.cars as [Car, Car];
    const pa = pointAt(300, -8);
    const pb = pointAt(300, 6);
    Object.assign(a, { x: pa.x, y: pa.y, heading: 0.12, moveAngle: 0.12, speed: 170, s: 300, d: -8 });
    Object.assign(b, { x: pb.x, y: pb.y, heading: 0, moveAngle: 0, speed: 165, s: 300, d: 6 });
    collideCars([a, b], OVAL, 'realistic');
    expect(a.spinTime).toBe(0);
    expect(b.spinTime).toBe(0);
  });
});

describe('driving model on Grand Prix circuits', () => {
  const tracks = gpTracks();

  // Grip model: the limit comes from the radius, so there is no single corner speed any more. Each
  // corner (its own radius and length, open plane) is driven by the realistic key driver.
  it('grip model: every corner is drivable at its lane limit on all lanes; 40 % over, insisting, runs well wide', () => {
    const seen = new Set<string>();
    for (const track of tracks) {
      for (const g of track.segments) {
        if (g.kind !== 'arc') continue;
        const key = `${g.r}/${g.len.toFixed(0)}/${g.corner.dir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const k = g.corner.dir / g.r;
        const t = new CurveTrack([
          { len: 700, k: 0 },
          { len: g.len, k },
          { len: 700, k: 0 },
        ]);
        for (const d of [-28.5, 0, 28.5]) {
          const lim = limitMph(laneCurvature(k, d));
          // (at 0.97 x: over KNEE_MPH a few % of speed is many % of grip, and the key player weaves)
          const at = runCurve(t, { d, mph: Math.min(CONFIG.MAX_MPH, lim) * 0.97, driver: 'human', gas: 'hold', T: 5, runUp: 300 });
          expect(at.spun, `${track.id} ${key} d ${d}`).toBe(false);
          // stays on the tarmac (the outer edge is HALF_W - CAR_R from the centre line)
          expect(at.wide, `${track.id} ${key} d ${d}`).toBeLessThan(40 + 28.5 * Math.sign(d) * Math.sign(k));
        }
        const inside = 28.5 * Math.sign(k);
        const lim = limitMph(laneCurvature(k, inside));
        if (lim * 1.4 > CONFIG.MAX_MPH || g.len < 160) continue;
        const over = runCurve(t, {
          d: inside,
          mph: lim * 1.4,
          driver: 'human',
          gas: 'hold',
          insist: true,
          noCatch: true,
          T: 5,
          runUp: 300,
        });
        expect(over.spun || over.wide > 20, `${track.id} ${key} x1.4`).toBe(true);
      }
    }
  });
});
