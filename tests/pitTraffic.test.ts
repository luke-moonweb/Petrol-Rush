import { expect, test } from 'vitest';
import { runPitRace } from './sim/pits';

// The whole field pits within a few laps (every car starts with a fifth of a tank, tests/sim/pits.ts): no more
// than 1 stop in 20 has a contact in the pits, no car stands for good on the pit road, and no car waits long
// in its box after refuelling. The full picture over many seeds and tracks: npx vitest run --project lab
// tests/lab/pits.lab.ts (PL_LAPS=18 PL_FUEL=1 for ordinary races).

const CASES: [string, number][] = [
  ['oval', 1],
  ['oval', 2],
  ['harbour', 1],
  ['harbour', 2],
  ['desert', 1],
  ['forest', 1],
  ['finale', 1],
];

test('a busy pit lane: few contacts, no jams', () => {
  let stops = 0;
  let hit = 0;
  for (const [track, seed] of CASES) {
    const s = runPitRace({ track, seed, laps: 4, fuel0: 0.2 });
    stops += s.stops;
    hit += s.hitStops;
    expect(s.stops, `${track} ${seed}`).toBeGreaterThanOrEqual(20);
    expect(s.maxStand, `${track} ${seed}: a car stood on the pit road`).toBeLessThan(15);
    expect(Math.max(...s.waits), `${track} ${seed}: a car waited in its box`).toBeLessThan(15);
    expect(
      s.unfinished.map((c) => c.id),
      `${track} ${seed}`,
    ).toEqual([]);
  }
  expect(hit / stops).toBeLessThanOrEqual(0.05);
}, 60_000);
