import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type DriveModel } from '../src/config';
import { limitMph } from '../src/race/physics';
import { laneCurvature } from '../src/track/curvature';
import { RC, S_TOP, S_TURN1, TRACK_LEN } from '../src/track/track';
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

/** Turn 1 from 700 px before it to 500 px after it, entering at f x the lane limit (capped at 180). */
function entry(d: number, f: number, opts: { noCatch?: boolean; insist?: boolean } = {}) {
  const mph = Math.min(CONFIG.MAX_MPH, limitMph(laneCurvature(-1 / RC, d)) * f);
  return runCurve(
    OVAL_TRACK,
    { mph: 180, approachMph: mph, driver: 'human', d, walls: 'oval', T: 12, gas: 'exit', stopAtFinish: true, ...opts },
    S_TOP + 500,
    S_TURN1 - 700,
  );
}

describe('keys: braking matters (designer H1, M3)', () => {
  it('braking to the limit beats a flat-out entry by a clear margin on the centre and inside lanes', () => {
    const lines: string[] = [];
    for (const d of [-9.5, 0]) {
      const braked = entry(d, 1);
      const flat = entry(d, 2);
      lines.push(`d ${d}: braked ${braked.time.toFixed(2)} s, flat out ${flat.time.toFixed(2)} s (slip ${flat.maxSlipDeg.toFixed(0)} deg)`);
      expect(braked.spun || flat.spun, `d ${d}`).toBe(false);
      expect(flat.time - braked.time, `d ${d}`).toBeGreaterThanOrEqual(0.35);
    }
    console.log(lines.join('\n'));
  });

  it('the cost grows with the excess: understeer, then a step-out that costs more the further over', () => {
    for (const d of [-9.5, 0]) {
      const t = [1, 1.1, 1.15, 2].map((f) => entry(d, f));
      for (const r of t) expect(r.spun, `d ${d}`).toBe(false);
      expect(t[1]!.time - t[0]!.time, `d ${d} x1.1`).toBeLessThan(0.2);
      expect(t[1]!.looseAt, `d ${d} x1.1: understeer only`).toBe(-1);
      expect(t[2]!.looseAt, `d ${d} x1.15: the rear steps out`).toBeGreaterThan(0);
      expect(t[2]!.time, `d ${d}`).toBeGreaterThan(t[1]!.time + 0.15);
      expect(t[3]!.time, `d ${d}`).toBeGreaterThanOrEqual(t[2]!.time - 0.02);
    }
  });

  it('a player who insists through the slide (no countersteer) spins only when clearly too fast', () => {
    for (const d of [-28.5, -9.5, 0]) {
      expect(entry(d, 1.05, { insist: true }).spun, `d ${d} x1.05`).toBe(false);
      expect(entry(d, 1.1, { insist: true }).spun, `d ${d} x1.1`).toBe(false);
    }
    for (const d of [-28.5, -9.5]) expect(entry(d, 1.2, { insist: true }).spun, `d ${d} x1.2`).toBe(true);
    // one who lets go of the key without countersteering survives a moderate step-out
    expect(entry(0, 1.15, { noCatch: true }).spun).toBe(false);
  });
});
