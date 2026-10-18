import { describe, expect, test } from 'vitest';
import type { Difficulty } from '../src/config';
import { runStopEvent } from './sim/stopped';

// The player stops on a straight (tests/sim/stopped.ts): on every difficulty the AI drives round it instead
// of queuing behind it, and touches it in no more than 1 of 10 passes. The full picture over many seeds and
// tracks: npx vitest run --project lab tests/lab/stopped.lab.ts.

const CASES: [string, number, Difficulty][] = [
  ['oval', 1, 'easy'],
  ['city', 2, 'normal'],
  ['forest', 6, 'hard'],
];

describe('a player stopped on a straight', () => {
  for (const [track, seed, level] of CASES) {
    test(`${track} seed ${seed} (${level}): the cars behind pass it`, () => {
      const e = runStopEvent(track, seed, level);
      expect(e).not.toBeNull();
      const cars = e!.outcomes;
      expect(cars.length).toBeGreaterThan(8);
      const passed = cars.filter((w) => w.passed).length;
      const touched = cars.filter((w) => w.contact).length;
      const stood = cars.filter((w) => w.still > 1 && !w.late).length;
      expect(passed / cars.length).toBeGreaterThanOrEqual(0.9);
      expect(touched / cars.length).toBeLessThanOrEqual(0.1);
      expect(stood).toBeLessThanOrEqual(1);
    });
  }
});
