import { DEFAULT_OPTIONS } from '../../src/config';
import { Race } from '../../src/race/race';
import { inPitLane } from '../../src/track/oval';

// Invariant gate over 40 fresh seeds (review r2, critic #3): not tuned on, so it catches pit-logic
// cliffs that a curated handful of seeds hides. Seeds 107 and 135 are left out: the classic model on
// main does not finish them either (a car runs dry). The seeds are split over tests/gate/*.test.ts
// (vitest runs files in parallel, the tests inside one file one after another).
export const GATE_SEEDS = Array.from({ length: 42 }, (_, i) => 100 + i).filter((s) => s !== 107 && s !== 135);
export const GATE_CHUNKS = 8;

export interface GateResult {
  waits: number[];
  problems: string[];
  time: number;
  spins: number;
}

/** One 20-car, 18-lap grip race; call with CONFIG.DRIVE_MODEL = 'grip'. */
export function runGateSeed(seed: number): GateResult {
  const waits: number[] = [];
  const problems: string[] = [];
  let spins = 0;
  const r = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 18 }, seed, true);
  r.start();
  const phase = r.cars.map(() => 'none');
  const wait = r.cars.map(() => 0);
  const skips = r.cars.map(() => 0);
  const stopped = r.cars.map(() => 0);
  const lastContact = r.cars.map(() => -99);
  const incidents: { t: number; x: number; y: number }[] = [];
  while (!r.allFinished() && r.time < 18 * 40) {
    const before = r.cars.map((c) => c.spinTime > 0);
    r.step(1 / 60, null);
    r.cars.forEach((c, i) => {
      if (c.spinTime > 0 && !before[i]) {
        spins++;
        incidents.push({ t: r.time, x: c.x, y: c.y });
      }
      if (c.contactStrength > 0 || c.spinTime > 0 || c.ai.recoverTime > 0) lastContact[i] = r.time;
      if (phase[i] === 'entering' && c.ai.pitPhase === 'none' && !c.finished) skips[i]!++;
      if (phase[i] === 'exiting' && c.ai.pitPhase !== 'exiting') {
        waits.push(wait[i]!);
        wait[i] = 0;
      }
      if (c.ai.pitPhase === 'exiting' && Math.abs(c.speed) < 1) wait[i]! += 1 / 60;
      phase[i] = c.ai.pitPhase;
      if (c.fuel <= 0 && !c.finished) problems.push(`seed ${seed}: car ${c.id} ran dry at ${r.time.toFixed(0)} s`);
      // a racing car standing still on the track, with no crash or oil anywhere near in the last 20 s
      const excused =
        r.time - lastContact[i]! < 3 ||
        incidents.some((e) => r.time - e.t < 20 && Math.hypot(e.x - c.x, e.y - c.y) < 500) ||
        r.oil.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 200);
      const still = c.ai.pitPhase === 'none' && !c.finished && r.time > 3 && Math.abs(c.speed) < 1 && !inPitLane(c.x, c.y);
      stopped[i] = still && !excused ? stopped[i]! + 1 / 60 : 0;
      if (stopped[i]! >= 0.5 && stopped[i]! < 0.5 + 1 / 60)
        problems.push(`seed ${seed}: car ${c.id} stopped on the track at ${r.time.toFixed(1)} s`);
    });
    if (problems.length > 20) break;
  }
  for (const c of r.cars) if (!c.finished) problems.push(`seed ${seed}: car ${c.id} did not finish`);
  skips.forEach((n, i) => {
    if (n > 1) problems.push(`seed ${seed}: car ${i} skipped ${n} stops`);
  });
  return { waits, problems, time: r.time, spins };
}

/** Runs chunk `i` of GATE_CHUNKS and summarises it like the whole gate did. */
export function runGateChunk(i: number): { problems: string[]; p95: number; max: number; log: string } {
  const seeds = GATE_SEEDS.filter((_, k) => k % GATE_CHUNKS === i);
  const runs = seeds.map(runGateSeed);
  const waits = runs.flatMap((r) => r.waits).sort((a, b) => a - b);
  const q = (p: number) => waits[Math.floor((waits.length - 1) * p)]!;
  const times = runs.map((r) => r.time.toFixed(1)).join(' / ');
  const spins = runs.reduce((s, r) => s + r.spins, 0);
  return {
    problems: runs.flatMap((r) => r.problems),
    p95: q(0.95),
    max: q(1),
    log: `seeds ${seeds.join(' ')}: spins ${spins}, pit-exit wait p50 ${q(0.5).toFixed(2)} / p95 ${q(0.95).toFixed(2)} / max ${q(1).toFixed(2)} s over ${waits.length} stops, race times ${times} s`,
  };
}
