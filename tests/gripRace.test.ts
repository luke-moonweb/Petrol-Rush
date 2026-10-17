import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS, type DriveModel } from '../src/config';
import { lapsCompleted } from '../src/race/car';
import { oilRadius } from '../src/race/oil';
import { GRIP_SPINS, stepCar } from '../src/race/physics';
import { cornerMph, PLAN, planSpeed } from '../src/race/planner';
import { Race } from '../src/race/race';
import { CY, HALF_W, R_OUT, RC, S_TURN1, S_TURN2, trackCurves, WORLD_W } from '../src/track/track';
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

// Classic model on the same seeds (bit-identical to main 1a2098f, see golden.test.ts): race time,
// spins, and spins near the pit exit / turn 1 entry (x 1900-2160, y > 290). Seed 300 is left out:
// its classic race does not finish within 18 x 40 s.
const CLASSIC: Record<number, { time: number; spins: number; pitExit: number }> = {
  1234: { time: 434.3, spins: 126, pitExit: 28 },
  7: { time: 383.7, spins: 99, pitExit: 8 },
  99: { time: 353.9, spins: 32, pitExit: 0 },
  42: { time: 346.5, spins: 44, pitExit: 0 },
  2024: { time: 335.4, spins: 25, pitExit: 0 },
  5: { time: 321.6, spins: 11, pitExit: 0 },
  11: { time: 335.2, spins: 37, pitExit: 1 },
  3: { time: 346.8, spins: 50, pitExit: 0 },
  21: { time: 345.1, spins: 29, pitExit: 6 },
  64: { time: 343.6, spins: 43, pitExit: 16 },
};

const nearPitExit = (c: { x: number; y: number }) => c.x > 1900 && c.x < 2160 && c.y > 290;

describe('grip model: 20-car races (A12, A13)', () => {
  it('ten seeds: all finish, no AI grip spin, pit-phase spins only from contact or oil, spins and times bounded, no pit-exit pile-ups', () => {
    const lines: string[] = [];
    let sum = 0;
    let spinsAll = 0;
    let pitExitAll = 0;
    for (const seed of Object.keys(CLASSIC).map(Number)) {
      const ref = CLASSIC[seed]!;
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, seed, true);
      race.start();
      GRIP_SPINS.slip = 0;
      GRIP_SPINS.wall = 0;
      let violations = 0;
      let pitStops = 0;
      let pitSlide = 0;
      let spins = 0;
      let pitExit = 0;
      let pitSpins = 0;
      let pitSpinsOwn = 0;
      let maxUse = 0;
      const fueling = new Set<number>();
      const lastContact: number[] = [];
      const lastCarNear: number[] = [];
      const lastSpin: number[] = [];
      while (!race.allFinished() && race.time < 18 * 40) {
        const before = race.cars.map((c) => c.spinTime > 0);
        const phase = race.cars.map((c) => c.ai.pitPhase);
        race.step(1 / CONFIG.STEP_HZ, null);
        // (two cars can touch with their centres up to 2 x 10 + 2 x 7 px apart, nose to tail)
        for (const a of race.cars) {
          for (const b of race.cars) {
            if (a.id < b.id && Math.abs(a.x - b.x) < 34 && Math.abs(a.y - b.y) < 34 && Math.hypot(a.x - b.x, a.y - b.y) < 34) {
              lastCarNear[a.id] = race.time;
              lastCarNear[b.id] = race.time;
            }
          }
        }
        race.cars.forEach((c, i) => {
          if (!(Number.isFinite(c.x) && c.x > 0 && c.x < WORLD_W && c.y > CY - R_OUT && c.y < CY + R_OUT)) violations++;
          if (c.contactPrev > 0 || c.contactStrength > 0) lastContact[c.id] = race.time;
          if (c.spinTime > 0 && !before[i]) {
            spins++;
            const prevSpin = lastSpin[c.id];
            lastSpin[c.id] = race.time;
            if (nearPitExit(c)) pitExit++;
            if (phase[i] !== 'none') {
              pitSpins++;
              // the cause: another car touching (now or in the last second; a bump into the wall counts) or oil; anything else is the AI's own driving
              // (or the aftermath of the car's own earlier spin: recovering into a wall)
              const bump = race.time - (lastCarNear[c.id] ?? -9) <= 1 || race.time - (prevSpin ?? -99) < 6;
              const oil = race.oil.some((o) => o.owner !== c.id && Math.hypot(c.x - o.x, c.y - o.y) < oilRadius(o) + 2);
              if (!bump && !oil) pitSpinsOwn++;
            }
          }
          // pit-lane slides from the plan itself (the aftermath of a bump does not count)
          if (c.ai.pitPhase !== 'none' && c.slideTime > 0 && race.time - (lastContact[c.id] ?? -9) > 1) pitSlide++;
          if (c.spinTime <= 0) maxUse = Math.max(maxUse, c.gripUse);
          const f = c.ai.pitPhase === 'fueling';
          if (f && !fueling.has(c.id)) pitStops++;
          if (f) fueling.add(c.id);
          else fueling.delete(c.id);
        });
      }
      lines.push(
        `seed ${seed}: ${race.time.toFixed(1)} s (classic ${ref.time}, ${((race.time / ref.time - 1) * 100).toFixed(1)} %), ` +
          `spins ${spins} (classic ${ref.spins}; grip ${GRIP_SPINS.slip}, wall ${GRIP_SPINS.wall}), near the pit exit ${pitExit} (classic ${ref.pitExit}), ` +
          `in pit phases ${pitSpins} (own ${pitSpinsOwn}), pit stops ${pitStops}, max use ${maxUse.toFixed(2)}`,
      );
      expect(
        race.cars.filter((c) => !c.finished).map((c) => c.id),
        `seed ${seed}`,
      ).toEqual([]);
      expect(violations, `seed ${seed}`).toBe(0);
      expect(GRIP_SPINS.slip, `seed ${seed}`).toBe(0);
      expect(pitSlide, `seed ${seed}`).toBe(0);
      expect(pitSpinsOwn, `seed ${seed}: pit-phase spins not caused by contact or oil`).toBe(0);
      expect(pitStops, `seed ${seed}`).toBeGreaterThanOrEqual(20);
      expect(pitStops, `seed ${seed}`).toBeLessThanOrEqual(40);
      // a single pile-up must not hide behind the mean: per-seed spin count and race time
      expect(spins, `seed ${seed}`).toBeLessThanOrEqual(Math.max(15, ref.spins));
      expect(race.time, `seed ${seed}`).toBeLessThanOrEqual(ref.time * 1.12);
      sum += race.time;
      spinsAll += spins;
      pitExitAll += pitExit;
    }
    const seeds = Object.values(CLASSIC);
    const classicMean = seeds.reduce((a, b) => a + b.time, 0) / seeds.length;
    const classicShare = seeds.reduce((a, b) => a + b.pitExit, 0) / seeds.reduce((a, b) => a + b.spins, 0);
    const share = pitExitAll / Math.max(1, spinsAll);
    lines.push(
      `mean ${(sum / seeds.length).toFixed(1)} s (classic ${classicMean.toFixed(1)} s); spins ${spinsAll}, near the pit exit ${(share * 100).toFixed(1)} % (classic ${(classicShare * 100).toFixed(1)} %)`,
    );
    console.log(lines.join('\n'));
    expect(sum / seeds.length).toBeLessThanOrEqual(classicMean * 1.05);
    // No pile-up concentration at the pit exit. The grip field spins far less than classic, so a
    // single incident moves the share a lot; with few spins the bound is on the count instead.
    const classicPitExit = seeds.reduce((a, b) => a + b.pitExit, 0);
    if (spinsAll >= 100) expect(share).toBeLessThanOrEqual(classicShare * 1.5);
    else expect(pitExitAll).toBeLessThanOrEqual(classicPitExit * 0.5);
  }, 240_000);

  it('A14: deterministic after 20 s and after a full race', () => {
    expect(hashState(runFor(99, 20, 18, 20))).toBe(hashState(runFor(99, 20, 18, 20)));
    expect(hashState(runFor(7, 12, 5, 400))).toBe(hashState(runFor(7, 12, 5, 400)));
  }, 60_000);
});

describe('grip model: solo pace (A10)', () => {
  /** A lone AI car (turnMph 145, top 180) on lane d: mean of laps 2 and 3 (s). */
  function soloLap(model: DriveModel, d: number): { lap: number; crashes: number } {
    CONFIG.DRIVE_MODEL = model;
    try {
      const r = new Race({ ...DEFAULT_OPTIONS, cars: 1, laps: 4 }, 1, true);
      const c = r.cars[0]!;
      Object.assign(c.ai, { turnMph: 145, topMph: 180, lane: d, pitFuelLaps: 0 });
      r.start();
      const at: number[] = [];
      let last = lapsCompleted(c);
      while (r.time < 120 && at.length < 3) {
        r.step(1 / 60, null);
        const l = lapsCompleted(c);
        if (l !== last) at.push(r.time);
        last = l;
      }
      return { lap: (at[2]! - at[0]!) / 2, crashes: c.crashes };
    } finally {
      CONFIG.DRIVE_MODEL = 'grip';
    }
  }

  it('a lone AI car laps within 3 % of the classic model over the four lanes; the inside is the slow line', () => {
    const lanes = [-28.5, -9.5, 9.5, 28.5];
    const grip = lanes.map((d) => soloLap('grip', d));
    const classic = lanes.map((d) => soloLap('classic', d));
    const mean = (a: { lap: number }[]) => a.reduce((x, y) => x + y.lap, 0) / a.length;
    console.log(
      `solo laps by lane ${lanes.join(' / ')}: grip ${grip.map((g) => g.lap.toFixed(2)).join(' / ')} (mean ${mean(grip).toFixed(2)}), ` +
        `classic ${classic.map((g) => g.lap.toFixed(2)).join(' / ')} (mean ${mean(classic).toFixed(2)})`,
    );
    for (const g of grip) expect(g.crashes).toBe(0);
    expect(Math.abs(mean(grip) / mean(classic) - 1)).toBeLessThanOrEqual(0.03);
    // the limit comes from the radius: inside slowest, outside fastest, within a second of each other
    for (let i = 1; i < lanes.length; i++) expect(grip[i]!.lap).toBeLessThan(grip[i - 1]!.lap);
    expect(grip[0]!.lap - grip[3]!.lap).toBeLessThan(1);
  }, 60_000);
});

describe('grip model: pit entry', () => {
  it('the pit decision and the move to the inside lane happen on the straight, done before turn 2', () => {
    const decidedAt: number[] = [];
    const atTurn: number[] = [];
    for (const seed of [1234, 42]) {
      const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, seed, true);
      race.start();
      const was = race.cars.map(() => 'none');
      const lastS = race.cars.map((c) => c.s);
      while (race.time < 300) {
        race.step(1 / 60, null);
        race.cars.forEach((c, i) => {
          if (was[i] === 'none' && c.ai.pitPhase === 'entering') decidedAt.push(c.s);
          // where across the track an entering car is as it reaches turn 2
          if (c.ai.pitPhase === 'entering' && lastS[i]! < S_TURN2 && c.s >= S_TURN2 && c.spinTime <= 0) atTurn.push(c.d);
          was[i] = c.ai.pitPhase;
          lastS[i] = c.s;
        });
      }
    }
    expect(decidedAt.length).toBeGreaterThan(10);
    for (const s of decidedAt) {
      expect(s).toBeGreaterThanOrEqual(S_TURN2 - 700);
      expect(s).toBeLessThan(S_TURN2 - 200);
    }
    // On (or inside) the pit approach line (-HALF_W + 9 = -38) as it reaches the turn: a car held
    // out by traffic gives the stop up for a lap instead of diving across turn 2.
    expect(atTurn.length).toBeGreaterThan(10);
    console.log(`pit entry: d at turn 2 ${atTurn.map((d) => d.toFixed(0)).join(' ')}`);
    for (const d of atTurn) expect(d).toBeLessThanOrEqual(-HALF_W + 9 + 15);
  }, 60_000);
});

describe('grip model: performance guard (A15, logged)', () => {
  it('stepCar for 20 cars stays well under 50 us, the planner for 20 cars under 30 us', () => {
    const r = runFor(99, 20, 6, 15);
    const snap = r.cars.map((c) => ({ ...c }));
    const inputs = r.cars.map((_, i) => ({ steer: i % 3 === 0 ? -0.6 : 0.2, gas: true, brake: i % 5 === 0, toggleReverse: false }));
    const N = 5000;
    const t0 = performance.now();
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < 20; j++) stepCar(r.cars[j]!, inputs[j]!, 1 / 60);
      if (k % 30 === 0) {
        for (let j = 0; j < 20; j++) Object.assign(r.cars[j]!, snap[j]);
      }
    }
    const step = ((performance.now() - t0) * 1000) / N;
    const table = trackCurves();
    const t1 = performance.now();
    let acc = 0;
    for (let k = 0; k < N; k++) for (const c of r.cars) acc += planSpeed(table, c.s, c.d, c.ai.lane, 0.9, 170);
    const plan = ((performance.now() - t1) * 1000) / N;
    console.log(`stepCar x20: ${step.toFixed(1)} us, planSpeed x20: ${plan.toFixed(1)} us`);
    expect(acc).toBeGreaterThan(0);
    expect(step).toBeLessThan(50);
    expect(plan).toBeLessThan(30);
  });
});
