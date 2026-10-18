import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useFdlibm } from './sim/fdlibm';
import { hashState, runFor, runRace } from './sim/golden';

// The driving model is pinned bit for bit (re-recorded for the turn-in slide). If one
// of these changes, cars drive differently: only update the values for an intended change.
// sin/cos/asin/atan2 come from a JS port of fdlibm so the hashes match on every platform.
describe('driving model golden master', () => {
  let restoreMath: () => void;
  beforeAll(() => {
    restoreMath = useFdlibm();
  });
  afterAll(() => {
    restoreMath();
  });

  it('20 cars, seed 99, after 20 s', () => {
    expect(hashState(runFor(99, 20, 18, 20))).toBe('f617bae1');
  }, 30_000);

  it('full 18-lap races, seeds 1234 and 7', () => {
    const a = runRace(1234);
    expect([a.time.toFixed(4), a.cars.reduce((s, c) => s + c.crashes, 0), hashState(a)]).toEqual(['329.5333', 0, '2d1b7ea4']);
    const b = runRace(7);
    expect([b.time.toFixed(4), b.cars.reduce((s, c) => s + c.crashes, 0), hashState(b)]).toEqual(['328.0167', 0, 'ce109616']);
  }, 60_000);
});
