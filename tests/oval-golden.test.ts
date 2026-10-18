import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS, type DriveModel, type RaceRules } from '../src/config';
import { aiInput } from '../src/race/ai';
import type { Car } from '../src/race/car';
import { NO_INPUT } from '../src/race/physics';
import { Race } from '../src/race/race';
import { useFdlibm } from './sim/fdlibm';

// Golden master for the oval: bit-exact fingerprints of whole races. Refactors of the track,
// physics or AI that must not change behaviour on the oval must keep these snapshots unchanged.
// sin/cos/atan2 come from a JS port of fdlibm so the snapshots match on every platform.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Fnv {
  h = 0x811c9dc5;
  int(v: number): void {
    this.h ^= v >>> 0;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }
  num(v: number): void {
    f64[0] = v;
    this.int(u32[0]!);
    this.int(u32[1]!);
  }
}

function hashCars(h: Fnv, cars: Car[]): void {
  for (const c of cars) {
    for (const v of [c.x, c.y, c.heading, c.moveAngle, c.speed, c.s, c.d, c.fuel, c.penalty]) h.num(v);
    h.int(c.sectorsPassed);
    h.int(['none', 'entering', 'fueling', 'exiting', 'parked'].indexOf(c.ai.pitPhase));
    h.int((c.pitSide ? 1 : 0) | (c.wasInPit ? 2 : 0) | (c.finished ? 4 : 0));
  }
}

interface Scenario {
  cars: number;
  laps: number;
  seed: number;
  fuel0?: number;
  rules?: RaceRules;
  /** The player drives with AI inputs through the human input path (pit autopilot included). */
  humanPlayer?: boolean;
  maxTime: number;
}

function run(sc: Scenario) {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: sc.cars, laps: sc.laps, qualifying: 'middle' }, sc.seed, !sc.humanPlayer, sc.rules);
  if (sc.fuel0 !== undefined) for (const c of race.cars) c.fuel = sc.fuel0;
  race.start();
  const dt = 1 / CONFIG.STEP_HZ;
  const h = new Fnv();
  let step = 0;
  let pitAutoSteps = 0;
  while (!race.allFinished() && race.time < sc.maxTime) {
    let input = null;
    if (sc.humanPlayer) {
      const view = { track: race.track, cars: race.cars, started: true, laps: race.laps, time: race.time, oil: race.oil };
      input = race.pitAuto ? NO_INPUT : aiInput(race.player, view, dt);
    }
    race.step(dt, input);
    if (race.pitAuto) pitAutoSteps++;
    if (++step % 30 === 0) hashCars(h, race.cars);
  }
  hashCars(h, race.cars);
  return {
    hash: h.h.toString(16).padStart(8, '0'),
    steps: step,
    finished: race.cars.filter((c) => c.finished).length,
    order: race.classification().map((c) => c.colorIdx),
    times: race.classification().map((c) => race.resultTime(c)?.toFixed(3) ?? 'DNF'),
    penalties: race.cars.reduce((a, c) => a + c.penalty, 0),
    crashes: race.cars.reduce((a, c) => a + c.crashes, 0),
    oilLeft: race.oil.length,
    pitAutoSteps,
  };
}

describe('oval golden master', () => {
  let saved: DriveModel;
  let restoreMath: () => void;
  beforeAll(() => {
    saved = CONFIG.DRIVE_MODEL;
    CONFIG.DRIVE_MODEL = 'classic';
    restoreMath = useFdlibm();
  });
  afterAll(() => {
    CONFIG.DRIVE_MODEL = saved;
    restoreMath();
  });

  it('20 AI cars, 3 laps', () => {
    expect(run({ cars: 20, laps: 3, seed: 1, maxTime: 200 })).toMatchSnapshot();
  });

  it('20 AI cars, low fuel – everybody pits', () => {
    expect(run({ cars: 20, laps: 4, seed: 2, fuel0: 0.2, maxTime: 300 })).toMatchSnapshot();
  });

  it('player driven through the human path, with pit autopilot', () => {
    expect(run({ cars: 12, laps: 4, seed: 3, fuel0: 0.15, humanPlayer: true, maxTime: 300 })).toMatchSnapshot();
  });

  it('classic collisions, penalties on', () => {
    expect(run({ cars: 20, laps: 3, seed: 4, rules: { penalties: true, collisions: 'classic' }, maxTime: 200 })).toMatchSnapshot();
  });

  it('realistic collisions, penalties off', () => {
    expect(run({ cars: 20, laps: 2, seed: 5, rules: { penalties: false, collisions: 'realistic' }, maxTime: 200 })).toMatchSnapshot();
  });
});
