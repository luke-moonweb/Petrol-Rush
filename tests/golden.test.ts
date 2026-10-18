import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useFdlibm } from './sim/fdlibm';
import { hashState, runFor, runRace } from './sim/golden';

// The driving model is pinned bit for bit (recorded on main 9135adf + the agent-speed branch). If one
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
    expect(hashState(runFor(99, 20, 18, 20))).toBe('e2630b26');
  }, 30_000);

  it('full 18-lap races, seeds 1234 and 7', () => {
    const a = runRace(1234);
    expect([a.time.toFixed(4), a.cars.reduce((s, c) => s + c.crashes, 0), hashState(a)]).toEqual(['334.3833', 3, 'b13c5d14']);
    const b = runRace(7);
    expect([b.time.toFixed(4), b.cars.reduce((s, c) => s + c.crashes, 0), hashState(b)]).toEqual(['335.3833', 0, '665d946c']);
  }, 60_000);
});
