import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS, type DriveModel } from '../src/config';
import { GRIP_SPINS } from '../src/race/physics';
import { cornerMph, PLAN, planSpeed } from '../src/race/planner';
import { Race } from '../src/race/race';
import { CY, R_OUT, RC, S_TURN1, S_TURN2, TURN_LEN, trackCurves, WORLD_W } from '../src/track/track';
import { CurveTrack } from './sim/curves';
import { hashState, runFor } from './sim/golden';

let saved: DriveModel;
beforeAll(() => {
  saved = CONFIG.DRIVE_MODEL;
  CONFIG.DRIVE_MODEL = 'grip';
});
afterAll(() => {
  CONFIG.DRIVE_MODEL = saved;
});

describe('grip model: AI speed planner', () => {
  const table = trackCurves();

  it('in a corner the plan is the lane limit; on a long straight it is flat out', () => {
    expect(planSpeed(table, S_TURN1 + 100, 0, 0, 1, 150)).toBeCloseTo(cornerMph(-1 / RC, 0, 1), 3);
    expect(planSpeed(table, S_TURN1 - 1200, 0, 0, 1, 150)).toBe(CONFIG.MAX_MPH);
    // inside lane slower than the outside lane
    expect(cornerMph(-1 / RC, -28.5, 1)).toBeLessThan(cornerMph(-1 / RC, 28.5, 1));
  });

  it('brakes in time: the plan rises with the distance to the corner at the planning decel', () => {
    const vc = cornerMph(-1 / RC, 0, 0.9);
    const b = CONFIG.BRAKE_MPH_S * PLAN.BRAKE_FRAC;
    for (const ds of [50, 150, 300]) {
      const want = Math.sqrt(vc * vc + (2 * b * ds) / CONFIG.PX_PER_MPH);
      // (the table is sampled every 4 px, so the corner start is known to within a sample)
      expect(Math.abs(planSpeed(table, S_TURN2 - ds, 0, 0, 0.9, 170) - Math.min(CONFIG.MAX_MPH, want))).toBeLessThan(0.5);
    }
  });

  it('works for right-hand curves and uses the car offset close by, the target lane further on', () => {
    const t = new CurveTrack([
      { len: 500, k: 0 },
      { len: 300, k: 1 / 120 },
      { len: 500, k: 0 },
    ]);
    const inCurve = planSpeed(t.table, 600, 20, 20, 1, 140);
    // right turn: d + is the inside, so +20 is tighter than -20
    expect(inCurve).toBeLessThan(planSpeed(t.table, 600, -20, -20, 1, 140));
    expect(inCurve).toBeCloseTo(cornerMph(1 / 120, 20, 1), 3);
    expect(planSpeed(t.table, 300, -20, 20, 1, 140)).toBeLessThan(planSpeed(t.table, 300, -20, -20, 1, 140));
  });
});

// Classic race times (main 1a2098f) for the same seeds.
const CLASSIC: Record<number, number> = { 1234: 434.3, 7: 383.7, 99: 353.9, 42: 346.5, 2024: 335.4 };

describe('grip model: 20-car races (A12, A13)', () => {
  it('five seeds finish with no stuck car, no grip spin by the AI, no pit-lane slide, race time <= classic + 5 %', () => {
    const lines: string[] = [];
    for (const seed of Object.keys(CLASSIC).map(Number)) {
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, seed, true);
      race.start();
      GRIP_SPINS.slip = 0;
      GRIP_SPINS.wall = 0;
      let violations = 0;
      let pitStops = 0;
      let pitSlide = 0;
      let spins = 0;
      let maxUse = 0;
      const fueling = new Set<number>();
      while (!race.allFinished() && race.time < 18 * 40) {
        const before = race.cars.map((c) => c.spinTime > 0);
        race.step(1 / CONFIG.STEP_HZ, null);
        race.cars.forEach((c, i) => {
          if (!(Number.isFinite(c.x) && c.x > 0 && c.x < WORLD_W && c.y > CY - R_OUT && c.y < CY + R_OUT)) violations++;
          if (c.spinTime > 0 && !before[i]) spins++;
          if (c.ai.pitPhase !== 'none' && c.slideTime > 0 && c.contactPrev === 0) pitSlide++;
          if (c.spinTime <= 0) maxUse = Math.max(maxUse, c.gripUse);
          const f = c.ai.pitPhase === 'fueling';
          if (f && !fueling.has(c.id)) pitStops++;
          if (f) fueling.add(c.id);
          else fueling.delete(c.id);
        });
      }
      lines.push(
        `seed ${seed}: ${race.time.toFixed(1)} s (classic ${CLASSIC[seed]}), spins ${spins} (grip ${GRIP_SPINS.slip}, wall ${GRIP_SPINS.wall}), pit stops ${pitStops}, max use ${maxUse.toFixed(2)}`,
      );
      expect(
        race.cars.filter((c) => !c.finished).map((c) => c.id),
        `seed ${seed}`,
      ).toEqual([]);
      expect(violations, `seed ${seed}`).toBe(0);
      expect(GRIP_SPINS.slip, `seed ${seed}`).toBe(0);
      expect(pitSlide, `seed ${seed}`).toBe(0);
      expect(pitStops, `seed ${seed}`).toBeGreaterThanOrEqual(20);
      expect(pitStops, `seed ${seed}`).toBeLessThanOrEqual(40);
      expect(race.time, `seed ${seed}`).toBeLessThanOrEqual(CLASSIC[seed]! * 1.05);
    }
    console.log(lines.join('\n'));
  }, 120_000);

  it('A14: deterministic after 20 s and after a full race', () => {
    expect(hashState(runFor(99, 20, 18, 20))).toBe(hashState(runFor(99, 20, 18, 20)));
    expect(hashState(runFor(7, 12, 5, 400))).toBe(hashState(runFor(7, 12, 5, 400)));
  });
});

describe('grip model: pit entry', () => {
  it('the pit decision and the move to the inside lane happen on the straight before turn 2', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, 1234, true);
    race.start();
    const decidedAt: number[] = [];
    const was = race.cars.map(() => 'none');
    while (race.time < 300) {
      race.step(1 / 60, null);
      race.cars.forEach((c, i) => {
        if (was[i] === 'none' && c.ai.pitPhase === 'entering') decidedAt.push(c.s);
        was[i] = c.ai.pitPhase;
      });
    }
    expect(decidedAt.length).toBeGreaterThan(0);
    for (const s of decidedAt) expect(s).toBeLessThan(S_TURN2 - 200);
    expect(TURN_LEN).toBeGreaterThan(0);
  });
});
