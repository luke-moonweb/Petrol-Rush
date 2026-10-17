import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../src/config';
import { hashState, runFor, runRace } from './sim/golden';

// The classic driving model is pinned bit for bit to main 1a2098f (recorded before the grip model
// existed). If one of these changes, the classic model is no longer the old game. The hashes are
// recorded on CI (Linux x64); macOS arm64 rounds differently, so these tests fail locally there.
describe('classic driving model golden master (main 1a2098f)', () => {
  let saved: DriveModel;
  beforeAll(() => {
    saved = CONFIG.DRIVE_MODEL;
    CONFIG.DRIVE_MODEL = 'classic';
  });
  afterAll(() => {
    CONFIG.DRIVE_MODEL = saved;
  });

  it('20 cars, seed 99, after 20 s', () => {
    expect(hashState(runFor(99, 20, 18, 20))).toBe('49afcf8b');
  }, 30_000);

  it('full 18-lap races, seeds 1234 and 7', () => {
    const a = runRace(1234);
    expect([a.time.toFixed(4), a.cars.reduce((s, c) => s + c.crashes, 0), hashState(a)]).toEqual(['434.3167', 126, '457cbe35']);
    const b = runRace(7);
    expect([b.time.toFixed(4), b.cars.reduce((s, c) => s + c.crashes, 0), hashState(b)]).toEqual(['383.7000', 99, '4737d18e']);
  }, 60_000);
});
