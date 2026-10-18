// AI speed planning from the curvature ahead (grip model). Track-shape independent: it only reads
// a CurvatureTable, which any track can build from its curvatureAt(s).
import { CONFIG } from '../config';
import { type CurvatureTable, laneCurvature } from '../track/curvature';
import type { Car } from './car';
import { limitMph } from './physics';

export const PLAN = {
  /** Planning deceleration as a share of BRAKE_MPH_S. */
  BRAKE_FRAC: 0.75,
  LOOK_MIN: 120,
  LOOK_MARGIN: 60,
  /** The pursuit steering cuts the chord: plan for a line this far further inside. */
  PATH_MARGIN: 12,
  /** Within this distance the car's own lateral offset counts, beyond it the lane it is heading for. */
  NEAR: 40,
};

/** Grip fraction an AI driver uses, from the existing turnMph draw (141..149), so the race RNG order is unchanged. */
export function gripFrac(car: Car): number {
  return (car.ai.turnMph / 150) ** 2;
}

/** Cornering speed (mph) on curvature k at lateral offset d, using grip fraction f. */
export function cornerMph(k: number, d: number, f: number): number {
  const inside = d + (k < 0 ? -PLAN.PATH_MARGIN : PLAN.PATH_MARGIN);
  return limitMph(laneCurvature(k, inside), f);
}

/**
 * Highest speed (mph) a car at s can carry and still slow down in time for every corner ahead,
 * on line dNow close by and dAhead further on, at grip fraction f.
 */
export function planSpeed(table: CurvatureTable, s: number, dNow: number, dAhead: number, f: number, mph: number): number {
  const pxm = CONFIG.PX_PER_MPH;
  const b = CONFIG.BRAKE_MPH_S * PLAN.BRAKE_FRAC;
  const v = Math.max(0, mph);
  const range = Math.max(PLAN.LOOK_MIN, (v * v * pxm) / (2 * b) + PLAN.LOOK_MARGIN);
  const len = table.len;
  let best = CONFIG.MAX_MPH;
  for (const run of table.runs()) {
    let ds = (((run.s0 - s) % len) + len) % len;
    // already inside this run: the part ahead starts here
    if (ds > len - run.len) ds = 0;
    if (ds > range) continue;
    const at = (dist: number, d: number) => {
      const vc = cornerMph(run.k, d, f);
      const vt = Math.sqrt(vc * vc + (2 * b * dist) / pxm);
      if (vt < best) best = vt;
    };
    at(ds, ds < PLAN.NEAR ? dNow : dAhead);
    if (ds < PLAN.NEAR && (ds === 0 || ds + run.len > PLAN.NEAR)) at(PLAN.NEAR, dAhead);
  }
  return best;
}
