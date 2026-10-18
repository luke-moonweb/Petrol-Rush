import { describe, expect, it } from 'vitest';
import { runGateChunk } from '../sim/gate';

describe('grip model: 40-seed invariant gate, part 3/8', () => {
  it('every car finishes on fuel, skips a stop at most once, merges from the pits without long waits, never stops on the track for nothing', () => {
    const r = runGateChunk(2);
    console.log(r.log);
    expect(r.problems.slice(0, 20)).toEqual([]);
    expect(r.p95).toBeLessThanOrEqual(3.5);
    expect(r.max).toBeLessThanOrEqual(10);
  }, 600_000);
});
