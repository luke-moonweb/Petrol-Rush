import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { gripAt, limitMph } from '../src/race/physics';
import { laneCurvature } from '../src/track/curvature';
import { RC, S_TOP, S_TURN1, TRACK_LEN } from '../src/track/oval';
import { OVAL_TRACK, type RunOpts, runCurve } from './sim/drivers';

// Keyboard / touch player on the oval with the realistic key driver ('human': holds the key while
// the aim point is off the nose, 0.18 s reaction), through the game's own PlayerSteering.

const LANES = [-28.5, -9.5, 9.5, 28.5];

/**
 * Mean best key lap over the four lanes of the old classic driving model (removed after the grip
 * model shipped), as measured by this driver on 9135adf: the pace the grip model was tuned to.
 */
const CLASSIC_KEY_LAP_S = 16.36;

/** Mean of two flying laps (s) on lane d, braking for the corners like the AI planner. */
function lap(d: number, plan: { planFrac: number }) {
  const r = runCurve(
    OVAL_TRACK,
    { mph: 160, driver: 'human', d, walls: 'oval', T: 60, splits: [TRACK_LEN, 3 * TRACK_LEN], ...plan },
    3 * TRACK_LEN,
    200,
  );
  return { ...r, lap: r.spun ? Infinity : (r.splitT[1]! - r.splitT[0]!) / 2 };
}

describe('keys: driving at the limit (designer H2)', () => {
  it('a key held through an ordinary corner keeps grip use <= 1.1: no rear step-out, no spin, no wall', () => {
    // (not the inside lane: the test driver does not steer out of a bend before its end, and with the
    // straight assist down to micro-drift it can clip the pit wall's nose on the exit; a player sees it)
    for (const d of LANES.filter((l) => l > -28.5))
      for (const f of [0.9, 1.0]) {
        const r = lap(d, { planFrac: f });
        expect(r.spun, `d ${d} f ${f}`).toBe(false);
        expect(r.maxUse, `d ${d} f ${f}`).toBeLessThanOrEqual(1.1);
        expect(r.looseAt, `d ${d} f ${f}`).toBe(-1);
        // (the outside lane is 11 px from the wall: the driver's weave brushes it)
        if (d < 28.5) expect(r.wallHits, `d ${d} f ${f}`).toBe(0);
      }
  });

  it('best key laps per lane are within 3 % of the old classic pace on average (decision: about +1 %)', () => {
    const lines: string[] = [];
    let grip = 0;
    for (const d of LANES) {
      const g = Math.min(...[0.95, 1.0, 1.05, 1.1].map((f) => lap(d, { planFrac: f }).lap));
      lines.push(`d ${d}: ${g.toFixed(2)} s`);
      expect(g, `d ${d}`).toBeLessThan(Infinity);
      grip += g / LANES.length;
    }
    lines.push(`mean ${grip.toFixed(2)} s (classic ${CLASSIC_KEY_LAP_S} s, ${((grip / CLASSIC_KEY_LAP_S - 1) * 100).toFixed(1)} %)`);
    console.log(lines.join('\n'));
    expect(grip / CLASSIC_KEY_LAP_S - 1).toBeLessThanOrEqual(0.03);
    expect(grip / CLASSIC_KEY_LAP_S - 1).toBeGreaterThanOrEqual(-0.03);
  });
});

/**
 * Turn 1 from 700 px before it to `after` px after it (default 500; the end of the next straight
 * is 1600), entering at f x the lane limit (capped at 180).
 */
/**
 * The speed (mph, capped at 180) on lane d of turn 1 whose demand is f^2 x the grip, i.e. f x the limit
 * if the grip did not fade with speed. (Above KNEE_MPH it does: a few % of speed is many % of grip, so
 * the excess is stated in grip.)
 */
function overMph(d: number, f: number): number {
  const k = Math.abs(laneCurvature(-1 / RC, d));
  const lim = limitMph(k);
  let lo = lim;
  let hi = lim * f + 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const v = m * CONFIG.PX_PER_MPH;
    if ((v * v * k) / gripAt(v) < f * f) lo = m;
    else hi = m;
  }
  return Math.min(CONFIG.MAX_MPH, lo);
}

function entry(d: number, f: number, opts: Partial<RunOpts> = {}, after = 500) {
  const mph = overMph(d, f);
  return runCurve(
    OVAL_TRACK,
    { mph: 180, approachMph: mph, driver: 'human', d, walls: 'oval', T: 16, gas: 'exit', stopAtFinish: true, ...opts },
    S_TOP + after,
    S_TURN1 - 700,
  );
}

describe('keys: braking matters (designer H1, M3)', () => {
  it('braking to the limit beats a flat-out entry by a clear margin on the centre and inside lanes', () => {
    const lines: string[] = [];
    // over the corner and the whole straight after it, where a slower exit keeps costing
    for (const d of [-9.5, 0]) {
      const braked = entry(d, 1, {}, 1600);
      const flat = entry(d, 2, {}, 1600);
      lines.push(`d ${d}: braked ${braked.time.toFixed(2)} s, flat out ${flat.time.toFixed(2)} s (slip ${flat.maxSlipDeg.toFixed(0)} deg)`);
      // (flat out into the turn the rear steps out at 176 mph and the key player cannot catch it: a spin)
      expect(braked.spun, `d ${d}`).toBe(false);
      expect(flat.spun || flat.time - braked.time >= 0.5, `d ${d}`).toBe(true);
    }
    console.log(lines.join('\n'));
  });

  // (since the turn-in slide: a little too fast, a catching key player slides in and stays on the road
  // for about the same time; flat out the rear steps out beyond catching)
  it('the cost grows with the excess: a small excess slides in, flat out spins', () => {
    for (const d of [-9.5, 0]) {
      const t = [1, 1.1, 1.15, 2].map((f) => entry(d, f));
      for (const r of t.slice(0, 3)) expect(r.spun, `d ${d}`).toBe(false);
      expect(t[1]!.time - t[0]!.time, `d ${d} x1.1`).toBeLessThan(0.6);
      expect(t[3]!.spun, `d ${d} flat out`).toBe(true);
    }
  });

  it('a small excess does not pay: 10 % too fast into turn 1 is no faster to the end of the top straight than braking to the limit', () => {
    // (the key wheel reaches the cap later than the old ramp did; the overdrive counts the key held into the
    // bend, so insisting a little too fast still slides wide and costs time)
    for (const d of [-9.5, 0]) {
      const braked = entry(d, 1, {}, 1600);
      const over = entry(d, 1.1, {}, 1600);
      expect(over.spun, `d ${d}`).toBe(false);
      expect(over.time - braked.time, `d ${d}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('a player who insists through the slide (no countersteer) spins only when clearly too fast', () => {
    for (const d of [-28.5, -9.5, 0]) {
      expect(entry(d, 1.05, { insist: true }).spun, `d ${d} x1.05`).toBe(false);
      expect(entry(d, 1.1, { insist: true }).spun, `d ${d} x1.1`).toBe(false);
    }
    // (at 1.2 x the insisting car slides out (over 20 deg) onto the wall rather than spinning)
    for (const d of [-9.5, 0]) {
      const r = entry(d, 1.2, { insist: true });
      expect(r.spun || r.maxSlipDeg > 20, `d ${d} x1.2`).toBe(true);
    }
    // one who lets go of the key without countersteering survives a moderate step-out
    expect(entry(0, 1.15, { noCatch: true }).spun).toBe(false);
  });
});

describe('keys: lifting off at a small excess (T1)', () => {
  /** Turn 1 entered at f x the lane limit, lifting `lift` s after turn-in; key held into the bend or line tracking. */
  function lift(d: number, f: number, at: number, insist: boolean) {
    const mph = overMph(d, f);
    return runCurve(
      OVAL_TRACK,
      { mph: 180, approachMph: mph, driver: 'human', d, walls: 'oval', T: 12, gas: 'hold', liftAfter: at, insist, stopAtFinish: true },
      S_TOP + 300,
      S_TURN1 - 700,
    );
  }

  it('at 1.0-1.10 x, lifting at turn-in or mid-corner: no spin, slip under 5 deg by the exit', () => {
    // (a key held through the lift tightens the line into the inner wall from every lane: under KNEE_MPH
    // the grip comes back as the car slows, so a held key bites harder; a wall hit, not T1)
    for (const insist of [false])
      for (const d of [-28.5, -9.5, 0, 9.5, 28.5])
        for (const at of [0, 0.5])
          for (const f of [1, 1.05, 1.1]) {
            const r = lift(d, f, at, insist);
            const tag = `${insist ? 'key held' : 'tracking'} d ${d} lift ${at} s x${f}`;
            expect(r.spun, tag).toBe(false);
            expect(r.exitSlipDeg, tag).toBeGreaterThanOrEqual(0);
            expect(r.exitSlipDeg, tag).toBeLessThan(5);
          }
  });

  // (above KNEE_MPH a loose rear swings with the grip, so the car may slide out the corner instead of spinning)
  it('at 1.25 x or more while insisting it spins or slides (over 20 deg)', () => {
    for (const d of [-28.5, -9.5, 0])
      for (const at of [0, 0.5])
        for (const f of [1.25, 1.3]) {
          const r = lift(d, f, at, true);
          expect(r.spun || r.maxSlipDeg > 20, `d ${d} lift ${at} s x${f}`).toBe(true);
        }
  });
});

describe('keys: flat out is not free along the wall (T4)', () => {
  it('a driver who only asks what a held key asks (no overdrive) and rides the outer wall loses at least 0.5 s on turn 1 and the top straight', () => {
    const lines: string[] = [];
    for (const d of [-28.5, -9.5, 0]) {
      const braked = entry(d, 1, { driver: 'capped' }, 1600);
      const flat = entry(d, 2, { driver: 'capped' }, 1600);
      lines.push(`d ${d}: braked ${braked.time.toFixed(2)} s, flat out ${flat.time.toFixed(2)} s (wall hits ${flat.wallHits})`);
      expect(flat.time - braked.time, `d ${d}`).toBeGreaterThanOrEqual(0.5);
    }
    console.log(lines.join('\n'));
  });
});
