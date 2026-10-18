// AI speed planning from the curvature ahead (grip model). Track-shape independent: it only reads
// a CurvatureTable, which any track can build from its curvatureAt(s).
import { CONFIG } from '../config';
import { type CurvatureTable, laneCurvature } from '../track/curvature';
import type { RacingLine } from '../track/racingLine';
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
  /** On the racing line: plan for a line this much tighter (px off its radius), for tracking errors. */
  LINE_MARGIN: 6,
  /** Share of the width the racing line uses: the slowest reaction draw to the fastest. */
  LINE_USE: [0.75, 1] as [number, number],
  /** The difficulty never takes a driver's grip fraction over this (over the faded grip the car slides). */
  GRIP_FRAC_MAX: 0.985,
};

/**
 * Share of the width an AI driver's racing line uses, from the existing reaction draw (no new RNG draw),
 * times the difficulty's factor.
 */
export function lineUse(car: Car): number {
  const [r0, r1] = CONFIG.AI_REACTION_S;
  // (ai.reaction carries the difficulty's factor: the drawn reaction sets the precision)
  const drawn = car.ai.reaction / car.ai.level.reaction;
  const t = Math.max(0, Math.min(1, (drawn - r0) / (r1 - r0)));
  const [u0, u1] = PLAN.LINE_USE;
  return Math.min(1, (u1 - (u1 - u0) * t) * car.ai.level.line);
}

/**
 * Grip fraction an AI driver uses, from the existing turnMph draw (141..149), so the race RNG order is
 * unchanged, times the difficulty's factor.
 */
export function gripFrac(car: Car): number {
  const f = (car.ai.turnMph / 150) ** 2;
  return car.ai.level.grip === 1 ? f : Math.min(PLAN.GRIP_FRAC_MAX, f * car.ai.level.grip);
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
export function planSpeed(table: CurvatureTable, s: number, dNow: number, dAhead: number, f: number, mph: number, brake = 1): number {
  const pxm = CONFIG.PX_PER_MPH;
  const b = CONFIG.BRAKE_MPH_S * PLAN.BRAKE_FRAC * brake;
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

/** planSpeed on the racing line: every corner's line arc ahead, for a driver using `use` of the width. */
export function planLineSpeed(line: RacingLine, s: number, use: number, f: number, mph: number, brake = 1): number {
  const pxm = CONFIG.PX_PER_MPH;
  const b = CONFIG.BRAKE_MPH_S * PLAN.BRAKE_FRAC * brake;
  const v = Math.max(0, mph);
  const range = Math.max(PLAN.LOOK_MIN, (v * v * pxm) / (2 * b) + PLAN.LOOK_MARGIN);
  const len = line.len;
  let best = CONFIG.MAX_MPH;
  for (const z of line.zones(use)) {
    let ds = (((z.start - s) % len) + len) % len;
    if (ds > len - z.len) ds = 0;
    if (ds > range) continue;
    const vc = limitMph(1 / Math.max(1, 1 / Math.abs(z.k) - PLAN.LINE_MARGIN), f);
    const vt = Math.sqrt(vc * vc + (2 * b * ds) / pxm);
    if (vt < best) best = vt;
  }
  return best;
}
