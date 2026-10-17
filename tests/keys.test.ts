import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../src/config';
import { TRACK_LEN } from '../src/track/track';
import { OVAL_TRACK, runCurve } from './sim/drivers';

// Keyboard / touch player on the oval with the realistic key driver ('human': holds the key while
// the aim point is off the nose, 0.18 s reaction), through the game's own PlayerSteering.
let saved: DriveModel;
beforeAll(() => {
  saved = CONFIG.DRIVE_MODEL;
  CONFIG.DRIVE_MODEL = 'grip';
});
afterAll(() => {
  CONFIG.DRIVE_MODEL = saved;
});

const LANES = [-28.5, -9.5, 9.5, 28.5];

/** Mean of two flying laps (s) on lane d, braking for the corners like the AI planner (grip) or to turnMph (classic). */
function lap(model: DriveModel, d: number, plan: { planFrac?: number; classicTurnMph?: number }) {
  CONFIG.DRIVE_MODEL = model;
  try {
    const r = runCurve(
      OVAL_TRACK,
      { mph: 160, driver: 'human', d, walls: 'oval', T: 60, splits: [TRACK_LEN, 3 * TRACK_LEN], ...plan },
      3 * TRACK_LEN,
      200,
    );
    return { ...r, lap: r.spun ? Infinity : (r.splitT[1]! - r.splitT[0]!) / 2 };
  } finally {
    CONFIG.DRIVE_MODEL = 'grip';
  }
}

describe('keys: driving at the limit (designer H2)', () => {
  it('a key held through an ordinary corner keeps grip use <= 1.1: no rear step-out, no spin, no wall', () => {
    for (const d of LANES)
      for (const f of [0.9, 1.0]) {
        const r = lap('grip', d, { planFrac: f });
        expect(r.spun, `d ${d} f ${f}`).toBe(false);
        expect(r.maxUse, `d ${d} f ${f}`).toBeLessThanOrEqual(1.1);
        expect(r.looseAt, `d ${d} f ${f}`).toBe(-1);
        // (the outside lane is 11 px from the wall: the driver's weave brushes it, as in classic)
        if (d < 28.5) expect(r.wallHits, `d ${d} f ${f}`).toBe(0);
      }
  });

  it('best key laps per lane are within 3 % of the classic model on average (decision: about +1 %)', () => {
    const lines: string[] = [];
    let grip = 0;
    let classic = 0;
    for (const d of LANES) {
      const g = Math.min(...[0.95, 1.0, 1.05, 1.1].map((f) => lap('grip', d, { planFrac: f }).lap));
      const c = Math.min(...[150, 152, 154, 156].map((t) => lap('classic', d, { classicTurnMph: t }).lap));
      lines.push(`d ${d}: grip ${g.toFixed(2)} s, classic ${c.toFixed(2)} s (${((g / c - 1) * 100).toFixed(1)} %)`);
      expect(g, `d ${d}`).toBeLessThan(Infinity);
      grip += g / LANES.length;
      classic += c / LANES.length;
    }
    lines.push(`mean: grip ${grip.toFixed(2)} s, classic ${classic.toFixed(2)} s (${((grip / classic - 1) * 100).toFixed(1)} %)`);
    console.log(lines.join('\n'));
    expect(grip / classic - 1).toBeLessThanOrEqual(0.03);
    expect(grip / classic - 1).toBeGreaterThanOrEqual(-0.03);
  });
});
