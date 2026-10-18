import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useFdlibm } from './sim/fdlibm';
import { hashState, runFor, runRace } from './sim/golden';

// The driving model is pinned bit for bit (re-recorded for the speed-dependent grip of the corner lab). If one
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
    expect(hashState(runFor(99, 20, 18, 20))).toBe('b13590c5');
  }, 30_000);

  it('full 18-lap races, seeds 1234 and 7', () => {
    const a = runRace(1234);
    expect([a.time.toFixed(4), a.cars.reduce((s, c) => s + c.crashes, 0), hashState(a)]).toEqual(['332.1333', 0, '6861c168']);
    const b = runRace(7);
    expect([b.time.toFixed(4), b.cars.reduce((s, c) => s + c.crashes, 0), hashState(b)]).toEqual(['338.3333', 0, '3e5ae114']);
  }, 60_000);
});
