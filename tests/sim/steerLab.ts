// The steering lab: the numbers that judge the player's key steering (src/race/steering.ts), not the
// driving model. Probes of the input layer (tapping on an arc and on a straight, single taps, the time to
// the stop, the countersteer, the overdrive under tapping), the tapper on six corners, and the oval and
// corner-lab numbers the key tests pin. The command line is tests/lab/steering.lab.ts.
import { CONFIG } from '../../src/config';
import type { Car } from '../../src/race/car';
import { gripAt, limitMph, stepCar } from '../../src/race/physics';
import { keyCap, PlayerSteering, type SteerOptions } from '../../src/race/steering';
import { laneCurvature } from '../../src/track/curvature';
import { pointAt, RC, S_TOP, S_TURN1, TRACK_LEN, wrapAngle } from '../../src/track/oval';
import { OVAL } from '../../src/track/ovalTrack';
import { CurveTrack } from './curves';
import { DT, freshCar, OVAL_TRACK, placeCar, type RunOpts, runCurve, steerTrack, TAPPER, type TapperHabits, withWalls } from './drivers';
import { bestEntry, type CornerSpec, cornerFor, runCorner } from './lab';

const PXM = CONFIG.PX_PER_MPH;
const B: SteerOptions = { set: 'B' };
const noWalls = withWalls(() => null);
const DEG = 180 / Math.PI;

/** Tapping `on` steps down and `off` up at mph, into an arc that needs `arc` x the grip (0: a straight). */
export function tapping(mph: number, on: number, off: number, arc: number, steer = B): { use: number; sway: number } {
  const v0 = mph * PXM;
  const kc = -(arc * gripAt(v0)) / (v0 * v0);
  const t = new CurveTrack([
    { len: 200, k: 0 },
    { len: 60000, k: kc },
  ]);
  const car = freshCar();
  // (the steering reads the curve at car.s = 300 all along: an endless arc, the car stays on it)
  placeCar(car, t, arc > 0 ? 300 : 100, 0, mph);
  const ps = new PlayerSteering(steerTrack(t), steer);
  const yaws: number[] = [];
  const dir = arc > 0 ? -1 : 1;
  for (let i = 0; i < 300; i++) {
    const st = ps.update(car, i % (on + off) < on ? dir : 0, DT);
    const h0 = car.heading;
    stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: car.speed < mph, brake: false, toggleReverse: false }, DT, noWalls);
    if (i >= 120) yaws.push(Math.abs(wrapAngle(car.heading - h0)) / DT);
  }
  const v = car.speed * PXM;
  const mean = yaws.reduce((a, b) => a + b, 0) / yaws.length;
  // the heading's sway (peak to peak, deg) around its mean turn
  let h = 0;
  let lo = 0;
  let hi = 0;
  for (const y of yaws) {
    h += (y - mean) * DT;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { use: (mean * v) / gripAt(v), sway: (hi - lo) * DEG };
}

/** Heading (deg) 1.5 s after a tap of n steps on a straight at mph (the straight assist acting). */
export function tapAngle(mph: number, n: number, steer = B): number {
  const t = new CurveTrack([{ len: 3000, k: 0 }]);
  const car = freshCar();
  placeCar(car, t, 100, 0, mph);
  const ps = new PlayerSteering(steerTrack(t), steer);
  for (let i = 0; i < 90; i++) {
    const st = ps.update(car, i < n ? 1 : 0, DT);
    stepCar(car, { steer: st.steer, straightTo: st.straightTo, gas: car.speed < mph, brake: false, toggleReverse: false }, DT, noWalls);
  }
  return car.heading * DEG;
}

/** A standing car on the oval at s, d, mph (the probes below step only the steering, not the car). */
function ovalCar(s: number, d: number, mph: number): Car {
  const car = freshCar();
  const p = pointAt(s, d);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, s, d });
  return car;
}

/** Milliseconds from a key press to 98 % of the key cap at mph: on the bottom straight, or in turn 1 on the centre lane. */
export function toStop(mph: number, corner: boolean, steer = B): number {
  const car = corner ? ovalCar(S_TURN1 + 50, 0, mph) : ovalCar(200, 0, mph);
  const ps = new PlayerSteering(OVAL, steer);
  for (let i = 0; i < 30; i++) ps.update(car, 0, DT);
  const cap = keyCap(car, false);
  for (let i = 1; i <= 90; i++) if (Math.abs(ps.update(car, -1, DT).steer) >= cap * 0.98) return i * DT * 1000;
  return Infinity;
}

/**
 * Steps from the first countersteer step to 98 % of the cap against a slide (slip 0.15 rad) in turn 1 at
 * mph, after the key was held into the bend (the wheel starts on the other side).
 */
export function catchSteps(mph: number, steer = B): number {
  const car = ovalCar(S_TURN1 + 50, 0, mph);
  const ps = new PlayerSteering(OVAL, steer);
  for (let i = 0; i < 30; i++) ps.update(car, -1, DT);
  // the rear steps out of the left bend: the nose turns further left than the travel direction
  car.heading = car.moveAngle - 0.15;
  const cap = keyCap(car, false);
  for (let i = 1; i <= 60; i++) if (ps.update(car, 1, DT).steer >= cap * 0.98) return i;
  return Infinity;
}

/**
 * Overdrive (0..1, the most in the last 0.4 s) after 2 s of tapping `on` / `off` steps into turn 1 on
 * the centre lane at f x its limit (speed). off 0: holding.
 */
export function tapOverdrive(f: number, on: number, off: number, steer = B): number {
  const car = ovalCar(S_TURN1 + 50, 0, limitMph(laneCurvature(-1 / RC, 0)) * f);
  const ps = new PlayerSteering(OVAL, steer);
  let most = 0;
  for (let i = 0; i < 120; i++) {
    ps.update(car, i % (on + off) < on ? -1 : 0, DT);
    if (i >= 96) most = Math.max(most, ps.overdrive);
  }
  return most;
}

/** The six corners and three corner speeds the tapper drives, as in the plan's comparison. */
export const TAPPER_CORNERS: [number, number][] = [
  [100, 90],
  [140, 90],
  [200, 90],
  [140, 135],
  [200, 45],
  [300, 60],
];
const TAPPER_FRACS = [0.85, 0.95, 1.0];

export interface TapperScore {
  /** Runs with a spin, a wall hit or no finish (of 18). */
  bad: number;
  /** Means over the runs: line error (rms px), yaw jitter (rad/s), key changes per second. */
  rms: number;
  jitter: number;
  keyChg: number;
  /** Total time of the clean runs (s). */
  t: number;
}

/** The tapper on the six corners, braking to 0.85, 0.95 and 1.0 x the line's limit. */
export function tapperScore(habits: TapperHabits = TAPPER, steer = B): TapperScore {
  const s: TapperScore = { bad: 0, rms: 0, jitter: 0, keyChg: 0, t: 0 };
  for (const [r, deg] of TAPPER_CORNERS) {
    const spec: CornerSpec = { r, deg, driver: 'tapper', habits, steer };
    const lim = Math.min(CONFIG.MAX_MPH, limitMph(1 / cornerFor(spec).rho));
    for (const f of TAPPER_FRACS) {
      const x = runCorner({ ...spec, mode: 'brake', vc: lim * f });
      if (x.spun || x.wallHits > 0 || x.t === Infinity) s.bad++;
      else s.t += x.t;
      s.rms += x.rms;
      s.jitter += x.jitter;
      s.keyChg += x.keyChg;
    }
  }
  const n = TAPPER_CORNERS.length * TAPPER_FRACS.length;
  return { ...s, rms: s.rms / n, jitter: s.jitter / n, keyChg: s.keyChg / n };
}

/** The tapper's best habits for the steering under test: of 24 sets, the fewest bad runs, then the least line error. */
export function bestTapper(steer = B): { habits: TapperHabits; score: TapperScore } {
  let best: { habits: TapperHabits; score: TapperScore } | null = null;
  for (const ANT of [1, 1.5, 2])
    for (const W of [3, 4])
      for (const TH of [0.002, 0.004])
        for (const DWELL of [0.05, 0.08]) {
          const habits = { ...TAPPER, ANT, W, TH, DWELL };
          const score = tapperScore(habits, steer);
          if (!best || score.bad < best.score.bad || (score.bad === best.score.bad && score.rms < best.score.rms)) best = { habits, score };
        }
  return best!;
}

/**
 * The speed (mph, capped at 180) on lane d of turn 1 whose demand is f^2 x the grip, i.e. f x the limit
 * if the grip did not fade with speed (as in tests/keys.test.ts).
 */
export function overMph(d: number, f: number): number {
  const k = Math.abs(laneCurvature(-1 / RC, d));
  let lo = limitMph(k);
  let hi = lo * f + 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const v = m * PXM;
    if ((v * v * k) / gripAt(v) < f * f) lo = m;
    else hi = m;
  }
  return Math.min(CONFIG.MAX_MPH, lo);
}

/** The human key player from 700 px before turn 1 to `after` px after it, entering at f x the lane limit (as in tests/keys.test.ts). */
export function ovalEntry(d: number, f: number, opts: Partial<RunOpts> = {}, after = 500) {
  return runCurve(
    OVAL_TRACK,
    { mph: 180, approachMph: overMph(d, f), driver: 'human', d, walls: 'oval', T: 16, gas: 'exit', stopAtFinish: true, ...opts },
    S_TOP + after,
    S_TURN1 - 700,
  );
}

/** The human key player's best flying lap (mean of two) on lane d of the oval, over four braking plans (as in tests/keys.test.ts). */
export function ovalKeyLap(d: number, steer = B): number {
  const lap = (planFrac: number) => {
    const r = runCurve(
      OVAL_TRACK,
      { mph: 160, driver: 'human', d, walls: 'oval', T: 60, splits: [TRACK_LEN, 3 * TRACK_LEN], planFrac, steer },
      3 * TRACK_LEN,
      200,
    );
    return r.spun ? Infinity : (r.splitT[1]! - r.splitT[0]!) / 2;
  };
  return Math.min(...[0.95, 1.0, 1.05, 1.1].map(lap));
}

/** Two flying laps of the human key player on lane d of the oval, braking like the AI planner at planFrac (tests/keys.test.ts test 1). */
export function ovalLaps(d: number, planFrac: number, steer = B) {
  return runCurve(
    OVAL_TRACK,
    { mph: 160, driver: 'human', d, walls: 'oval', T: 60, splits: [TRACK_LEN, 3 * TRACK_LEN], planFrac, steer },
    3 * TRACK_LEN,
    200,
  );
}

/** The largest |AI - human| (s) of tests/corners.test.ts ("the AI keeps up"), and any AI wall or spin. */
export function aiGap(steer = B): { worst: number; dirty: number } {
  let worst = 0;
  let dirty = 0;
  for (const deg of [90, 135])
    for (const r of [120, 160, 200]) {
      const human = bestEntry({ r, deg, driver: 'human', steer });
      for (const skill of [0, 1]) {
        const ai = runCorner({ r, deg, driver: 'ai', mode: 'flat', skill });
        if (ai.spun || ai.wallHits > 0) dirty++;
        worst = Math.max(worst, Math.abs(ai.t - human.best.t));
      }
    }
  return { worst, dirty };
}
