import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../../src/config';
import { runGateChunk } from '../sim/gate';

let saved: DriveModel;
beforeAll(() => {
  saved = CONFIG.DRIVE_MODEL;
  CONFIG.DRIVE_MODEL = 'grip';
});
afterAll(() => {
  CONFIG.DRIVE_MODEL = saved;
});

describe('grip model: 40-seed invariant gate, part 6/8', () => {
  it('every car finishes on fuel, skips a stop at most once, merges from the pits without long waits, never stops on the track for nothing', () => {
    const r = runGateChunk(5);
    console.log(r.log);
    expect(r.problems.slice(0, 20)).toEqual([]);
    expect(r.p95).toBeLessThanOrEqual(3.5);
    expect(r.max).toBeLessThanOrEqual(10);
  }, 600_000);
});
