import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { aiInput } from '../src/race/ai';
import { type Car, initProgress, lapsCompleted, updateProgress } from '../src/race/car';
import { NO_INPUT } from '../src/race/physics';
import { Race } from '../src/race/race';
import {
  CY,
  NUM_SECTORS,
  PIT_LINE_IN_X,
  PIT_LINE_OUT_X,
  pointAt as pointAtS,
  R_OUT,
  S_TURN2,
  SECTOR_LEN,
  TRACK_LEN,
  WORLD_W,
  wrapS,
} from '../src/track/track';

function fakeCar(s: number): Car {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 1);
  const car = race.player;
  car.s = s;
  initProgress(car);
  return car;
}

function drive(car: Car, from: number, to: number, step: number): void {
  for (let s = from; step > 0 ? s <= to : s >= to; s += step) {
    car.s = wrapS(s);
    updateProgress(car);
  }
}

describe('lap counting by sectors', () => {
  it('a full lap forwards adds a lap', () => {
    const car = fakeCar(wrapS(-100));
    drive(car, -100, 50, 5);
    expect(lapsCompleted(car)).toBe(0);
    drive(car, 50, TRACK_LEN + 50, 5);
    expect(lapsCompleted(car)).toBe(1);
  });

  it('crossing the finish line backwards does not add a lap', () => {
    const car = fakeCar(100);
    const before = car.sectorsPassed;
    drive(car, 100, -SECTOR_LEN * 0.5, -5);
    drive(car, -SECTOR_LEN * 0.5, 100, 5);
    expect(car.sectorsPassed).toBe(before);
    expect(lapsCompleted(car)).toBe(0);
  });
});

describe('shown position', () => {
  it('uses the classification once the car has finished and road order before', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 3 }, 1);
    const p = race.player;
    expect(race.shownPosition(p)).toBe(race.position(p));
    p.finished = true;
    p.finalSectors = race.laps * NUM_SECTORS;
    p.finalProgress = -1e9;
    expect(race.position(p)).toBe(3);
    expect(race.shownPosition(p)).toBe(1);
  });
});

describe('headless simulation', () => {
  it('20 AI cars finish 18 laps without getting stuck or leaving the walls', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, 1234, true);
    race.start();
    const dt = 1 / CONFIG.STEP_HZ;
    const maxTime = 18 * 40;
    let pitStops = 0;
    let violations = 0;
    const wasFueling = new Set<number>();
    while (!race.allFinished() && race.time < maxTime) {
      race.step(dt, null);
      for (const c of race.cars) {
        const ok =
          Number.isFinite(c.x) &&
          Number.isFinite(c.y) &&
          Number.isFinite(c.speed) &&
          c.x > 0 &&
          c.x < WORLD_W &&
          c.y > CY - R_OUT &&
          c.y < CY + R_OUT;
        if (!ok) violations++;
        const fueling = c.ai.pitPhase === 'fueling';
        if (fueling && !wasFueling.has(c.id)) {
          wasFueling.add(c.id);
          pitStops++;
        }
        if (!fueling) wasFueling.delete(c.id);
      }
    }
    expect(violations).toBe(0);
    const unfinished = race.cars.filter((c) => !c.finished).map((c) => c.id);
    expect(unfinished).toEqual([]);
    expect(race.cars.every((c) => c.fuel > 0 || c.finished)).toBe(true);
    expect(pitStops).toBeGreaterThanOrEqual(20);
    expect(pitStops).toBeLessThanOrEqual(40);
    console.log(`race: ${race.time.toFixed(1)} s, pit stops: ${pitStops}`);
  });

  it('simulation is deterministic for the same seed', () => {
    const run = () => {
      const r = new Race({ ...DEFAULT_OPTIONS, cars: 10, laps: 2 }, 99, true);
      r.start();
      for (let i = 0; i < 60 * 20; i++) r.step(1 / 60, null);
      return r.cars.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('traffic jam behind the stopped player car', () => {
  for (const qualifying of ['last', 'middle', 'pole'] as const) {
    it(`player out of fuel (start: ${qualifying}) – AI drives around and finishes the race`, () => {
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 10, qualifying }, 1234);
      race.start();
      race.player.fuel = 0;
      const idle = { steer: 0, gas: false, brake: false, toggleReverse: false };
      while (race.time < 10 * 40 && !race.cars.every((c) => c.isPlayer || c.finished)) race.step(1 / 60, idle);
      expect(race.cars.filter((c) => !c.isPlayer && !c.finished).map((c) => c.id)).toEqual([]);
    });
  }
});

describe('classification', () => {
  it("a lapped car that crossed the line ranks behind cars on the leader's lap", () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 3, laps: 5 }, 1);
    const [a, b, c] = race.cars as [Car, Car, Car];
    Object.assign(a, { finished: true, finishPos: 1, finalSectors: 40, finalProgress: 40 * SECTOR_LEN + 0.19 });
    Object.assign(c, { finished: true, finishPos: 2, finalSectors: 32, finalProgress: 32 * SECTOR_LEN + 0.18 });
    Object.assign(b, { finished: false, sectorsPassed: 39, lastSector: 7, s: 7.5 * SECTOR_LEN });
    expect(race.standings()).toEqual([a, b, c]);
    expect(lapsCompleted(c)).toBe(4);
  });

  it('after the winner finishes, everyone has 1 lap to go', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2, laps: 5 }, 1);
    race.leaderFinished = true;
    expect(race.lapsToGo(race.player)).toBe(1);
  });
});

describe('time gaps (measured at sector boundaries)', () => {
  it('no gap before the first measurement, then non-negative gaps to the car ahead', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 8, laps: 2 }, 7, true);
    const order0 = race.standings();
    expect(race.gap(order0[1]!, order0[0]!)).toBeNull();
    race.start();
    for (let i = 0; i < 60 * 30; i++) race.step(1 / 60, null);
    const order = race.standings();
    for (let i = 1; i < order.length; i++) {
      const gap = race.gap(order[i]!, order[i - 1]!);
      expect(gap).not.toBeNull();
      expect(gap!).toBeGreaterThanOrEqual(0);
      expect(gap!).toBeLessThan(15);
    }
  });
});

describe('player pit lane autopilot', () => {
  it('past the PIT LANE line the game drives the car to its box, refuels and returns control past PIT EXIT', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 5 }, 5);
    race.start();
    const p = race.player;
    p.fuel = 0.3;
    const dt = 1 / CONFIG.STEP_HZ;
    let on = -1;
    let off = -1;
    let wall = 0;
    while (race.time < 120 && off < 0) {
      if (p.ai.pitPhase === 'none' && !race.pitAuto && on < 0 && p.s > S_TURN2 && race.time > 5) p.ai.pitPhase = 'entering';
      const view = { cars: race.cars, started: true, laps: 5, time: race.time };
      race.step(dt, race.pitAuto ? NO_INPUT : aiInput(p, view, dt));
      if (race.pitAuto && on < 0) on = p.x;
      if (race.pitAuto && p.wallImpact > 0) wall++;
      if (on >= 0 && !race.pitAuto) off = p.x;
    }
    expect(on).toBeGreaterThanOrEqual(PIT_LINE_IN_X);
    expect(on).toBeLessThan(PIT_LINE_IN_X + 10);
    expect(off).toBeGreaterThanOrEqual(PIT_LINE_OUT_X);
    expect(off).toBeLessThan(PIT_LINE_OUT_X + 10);
    expect(p.fuel).toBeGreaterThan(0.95);
    expect(wall).toBe(0);
  });
});

describe('oil and crash penalties', () => {
  function twoCars(rules?: { penalties: boolean; collisions: 'realistic' | 'classic' }) {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5, true, rules);
    race.start();
    const [a, b] = race.cars as [Car, Car];
    const place = (c: Car, s: number, d: number, mph: number) => {
      const p = pointAtS(s, d);
      Object.assign(c, { x: p.x, y: p.y, prevX: p.x, prevY: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, spinTime: 0 });
    };
    return { race, a, b, place };
  }

  it('driving into oil causes a spin, a spinning car leaves a new slick, slicks disappear', () => {
    const { race, a, b, place } = twoCars();
    place(a, 300, 0, 120);
    place(b, 1200, 0, 0);
    race.oil.push({ x: a.x + 30, y: a.y, s: 330, d: 0, age: 1, owner: -1 });
    const dt = 1 / 60;
    for (let i = 0; i < 20; i++) race.step(dt, null);
    expect(a.spinTime).toBeGreaterThan(0);
    expect(race.oil.length).toBe(2);
    expect(b.spinTime).toBe(0);
    for (let i = 0; i < 60 * (CONFIG.OIL_LIFE_S + 1); i++) race.step(dt, null);
    expect(race.oil.length).toBe(0);
  });

  it("a car never spins on its own slick, only on other cars' oil", () => {
    const { race, a, b, place } = twoCars();
    place(a, 300, 0, 120);
    place(b, 1200, 0, 0);
    race.oil.push({ x: a.x + 30, y: a.y, s: 330, d: 0, age: 1, owner: a.id });
    for (let i = 0; i < 20; i++) race.step(1 / 60, null);
    expect(a.spinTime).toBe(0);
    race.oil.length = 0;
    place(a, 300, 0, 120);
    race.oil.push({ x: a.x + 30, y: a.y, s: 330, d: 0, age: 1, owner: b.id });
    for (let i = 0; i < 20; i++) race.step(1 / 60, null);
    expect(a.spinTime).toBeGreaterThan(0);
  });

  it('the rear-hit culprit gets a time penalty; none when penalties are off', () => {
    for (const penalties of [true, false]) {
      const { race, a, b, place } = twoCars({ penalties, collisions: 'realistic' });
      place(a, 200, 0, 170);
      place(b, 226, 0, 80);
      for (let i = 0; i < 30; i++) race.step(1 / 60, null);
      expect(b.crashes).toBeGreaterThan(0);
      expect(a.penalty).toBe(penalties ? CONFIG.PENALTY_S : 0);
      expect(b.penalty).toBe(0);
    }
  });
});

describe('projected position with penalty (HUD)', () => {
  it('the track leader with a big penalty drops in the projection; without it stays first', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 10, laps: 5 }, 11, true);
    race.start();
    for (let i = 0; i < 60 * 30; i++) race.step(1 / 60, null);
    const order = race.standings();
    const leader = order[0]!;
    expect(race.projectedPosition(leader)).toBe(1);
    leader.penalty = race.timeBehindLeader(order[order.length - 1]!) + 5;
    expect(race.projectedPosition(leader)).toBe(order.length);
    expect(race.standings()[0]).toBe(leader);
  });
});
