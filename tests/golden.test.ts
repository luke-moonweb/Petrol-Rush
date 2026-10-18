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
    expect(hashState(runFor(99, 20, 18, 20))).toBe('37e06561');
  }, 30_000);

  it('full 18-lap races, seeds 1234 and 7', () => {
    const a = runRace(1234);
    expect([a.time.toFixed(4), a.cars.reduce((s, c) => s + c.crashes, 0), hashState(a)]).toEqual(['332.2833', 0, '8bd9f7b2']);
    const b = runRace(7);
    expect([b.time.toFixed(4), b.cars.reduce((s, c) => s + c.crashes, 0), hashState(b)]).toEqual(['328.9500', 0, '4420090e']);
  }, 60_000);
});
