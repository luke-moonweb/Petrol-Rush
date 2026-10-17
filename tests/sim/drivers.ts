// Test drivers for the open-plane fixtures and the oval. They only see what a player sees (pose,
// speed, the road ahead); the physics under test never reads the track.
import { CONFIG, DEFAULT_OPTIONS } from '../../src/config';
import type { Car } from '../../src/race/car';
import { brakeAt, curvatureAssist, type DriveInput, maxCurvature, SteerRamp, type StepTrack, stepCar } from '../../src/race/physics';
import { planSpeed } from '../../src/race/planner';
import { Race } from '../../src/race/race';
import { PlayerSteering, type SteerTrack } from '../../src/race/steering';
import type { CurvatureTable } from '../../src/track/curvature';
import { laneCurvature } from '../../src/track/curvature';
import { curvatureAt, pointAt, project, TRACK_LEN, trackCurves, type WallNormal, wrapAngle } from '../../src/track/oval';
import { OVAL } from '../../src/track/ovalTrack';

/** What the test drivers need from a track (CurveTrack fixtures and the oval both provide it). */
export interface DriveTrack {
  readonly len: number;
  readonly table: CurvatureTable;
  curvatureAt(s: number): number;
  pointAt(s: number, d: number): { x: number; y: number; heading: number };
  project(x: number, y: number, sHint?: number): { s: number; d: number };
}

/** The game oval, unwrapped along s so a run can pass the finish line. */
export const OVAL_TRACK: DriveTrack = {
  len: TRACK_LEN,
  table: trackCurves(),
  curvatureAt,
  pointAt,
  project(x, y, hint) {
    const st = project(x, y);
    if (hint === undefined) return st;
    const laps = Math.round((hint - st.s) / TRACK_LEN);
    return { s: st.s + laps * TRACK_LEN, d: st.d };
  },
};

/** Walls along a fixture at lateral offsets dMax (right) and dMin (left) of the centre line, for car centres. */
export function corridor(t: DriveTrack, dMax: number, dMin: number, hint: () => number): (c: Car) => WallNormal | null {
  return (c) => {
    const st = t.project(c.x, c.y, hint());
    if (st.d <= dMax && st.d >= dMin) return null;
    const dd = st.d > dMax ? dMax : dMin;
    const p = t.pointAt(st.s, dd);
    c.x = p.x;
    c.y = p.y;
    // inward normal: towards the centre line
    const sgn = st.d > dMax ? -1 : 1;
    return { nx: -Math.sin(p.heading) * sgn, ny: Math.cos(p.heading) * sgn };
  };
}

export const DT = 1 / 60;
const PXM = CONFIG.PX_PER_MPH;

export function freshCar(): Car {
  const r = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 3);
  const c = r.player;
  c.fuel = 1;
  return c;
}

export function placeCar(car: Car, t: DriveTrack, s: number, d: number, mph: number): void {
  const p = t.pointAt(s, d);
  Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: mph, reverse: false, s, d });
}

/** exit: hold the entry speed while the curve is under the car, full throttle once it is behind. */
export type Gas = 'hold' | 'full' | 'lift' | 'brake' | 'exit';
/**
 * ideal: analog, tracks the line (insists when over the limit). lock: full lock or nothing.
 * catch: ideal, countersteers once the slip passes 0.1 rad for `react` s.
 * keys: physics stress driver, not a realistic player: a 70 ms delta-sigma key modulator straight
 *   to the physics (no key cap), so the average steer follows the line.
 * keysHold: keys straight to the physics, held whenever the car is off line (panics).
 * keysCatch: keys, plus one countersteer tap of `tap` s after `react` s of slip.
 * human: a realistic keyboard / touch player through the game's PlayerSteering (ramp, assist, key
 *   cap): looks at a point ahead on the line and holds the key while the angle to it is above a
 *   threshold, with a reaction delay (see HumanKeys). Countersteers a slide the same way.
 * ai: the game AI's speed planner and pursuit steering (gas mode ignored).
 */
export type DriverKind = 'ideal' | 'keys' | 'keysHold' | 'catch' | 'keysCatch' | 'lock' | 'ai' | 'human';

/** The realistic key driver's habits. */
export const HUMAN = {
  /** Reaction delay between seeing the error and the key going down / up (s). */
  REACT: 0.18,
  /** Press when the aim point is this far off the nose (deg); release when it is back within OFF_DEG. */
  ON_DEG: 2.5,
  OFF_DEG: 0.5,
  /** In a bend, pressing the key out of the bend needs this much error (deg). */
  OPP_DEG: 8,
  /** Looks this far ahead (s of travel, at least LOOK_MIN px). */
  LOOK_S: 0.4,
  LOOK_MIN: 60,
  /** Share of the reaction delay the driver anticipates from how fast the error changes. */
  ANTICIPATE: 1,
};

/** Bang-bang key with hysteresis and a pure reaction delay: no modulation finer than the delay. */
export class HumanKeys {
  private want = 0;
  private out = 0;
  private readonly queue: { t: number; key: number }[] = [];

  constructor(
    readonly react = HUMAN.REACT,
    /** Never steers out of a bend (does not countersteer a slide). */
    readonly noCatch = false,
  ) {}

  private last = Number.NaN;

  /**
   * err: angle from the nose to the aim point (rad, + = to the right). bend: sign of the road's
   * curvature under or just ahead of the car (0 on a straight). Returns the key held now.
   */
  step(time: number, errNow: number, bend = 0): number {
    // Like a person, judge where the error is heading: act on the error expected one reaction later.
    const rate = Number.isNaN(this.last) ? 0 : wrapAngle(errNow - this.last) / DT;
    this.last = errNow;
    const err = errNow + rate * this.react * HUMAN.ANTICIPATE;
    const deg = Math.PI / 180;
    // In a bend, steering out of it takes a clearly larger error (a slide): otherwise one lets go.
    const on = (dir: number) => (bend !== 0 && dir !== bend ? (this.noCatch ? Infinity : HUMAN.OPP_DEG) : HUMAN.ON_DEG) * deg;
    const off = HUMAN.OFF_DEG * deg;
    const press = Math.abs(err) > on(Math.sign(err)) ? Math.sign(err) : 0;
    if (this.want === 0) this.want = press;
    else if (err * this.want < off) this.want = press;
    this.queue.push({ t: time + this.react, key: this.want });
    while (this.queue.length > 0 && this.queue[0]!.t <= time + 1e-9) this.out = this.queue.shift()!.key;
    return this.out;
  }
}

/** The oval with other walls (or none): for physics runs on test tracks. */
export function withWalls(constrain: (c: Car) => WallNormal | null): StepTrack {
  return { ...OVAL, constrain };
}

/** The game's player steering on a test track. */
export function steerTrack(t: DriveTrack): SteerTrack {
  return {
    curves: () => t.table,
    headingAt: (x, y) => t.pointAt(t.project(x, y).s, 0).heading,
    cornerAt: () => null,
  };
}

export interface RunOpts {
  d?: number;
  mph: number;
  driver: DriverKind;
  gas?: Gas;
  /** Seconds to simulate. */
  T?: number;
  /** Start this far before the first curve (px). */
  runUp?: number;
  /** Reaction time before a catch driver countersteers (s). */
  react?: number;
  /** Tap length of the keyboard catch (s). */
  tap?: number;
  /** Speed the 'hold' throttle keeps (default: entry speed). */
  holdMph?: number;
  /** Walls at these lateral offsets (right, left of the centre line), or 'oval' for the game walls; none when omitted. */
  walls?: [number, number] | 'oval';
  /** Grip fraction for the 'ai' driver (default 0.987, the fastest AI). */
  gripFrac?: number;
  /** Only measure wide / inside after this many seconds (skips the entry transient). */
  settle?: number;
  /** Brake to this speed before the first curve (planned at the given decel), instead of entering at `mph`. */
  approachMph?: number;
  /**
   * Speed by plan instead of `gas`: brake for every corner like the AI planner at this grip fraction
   * (grip model), or for the classic model to `classicTurnMph` in the corners.
   */
  planFrac?: number;
  classicTurnMph?: number;
  /** human: holds the key into the bend for the whole bend, whatever happens (a panicking player). */
  insist?: boolean;
  /** human: never countersteers (holds into the bend or lets go). */
  noCatch?: boolean;
  /** End the run when the car reaches finishS. */
  stopAtFinish?: boolean;
  /** Record the time the car passes each of these s values (unwrapped). */
  splits?: number[];
}

export interface RunResult {
  spun: boolean;
  spinAt: number;
  maxSlipDeg: number;
  maxUse: number;
  /** Largest distance outside the target line (px). */
  wide: number;
  /** Largest distance inside the target line (px). */
  inside: number;
  slideT: number;
  endMph: number;
  /** Time to reach `finishS` (s), Infinity if not reached. */
  time: number;
  looseAt: number;
  /** Times at `splits` (Infinity if not reached). */
  splitT: number[];
  /** Fresh wall contacts (no contact in the 0.3 s before). */
  wallHits: number;
  /** Steps with grip use above 1.1, and all steps, while a curve is under the car. */
  overSteps: number;
  cornerSteps: number;
  /** Grip use samples while cornering (for percentiles). */
  cornerUse: number[];
}

/** Drive a fixture from just before its first curve. */
export function runCurve(
  t: DriveTrack,
  o: RunOpts,
  finishS = t.len - 300,
  startS?: number,
  trace?: (time: number, car: Car, input: DriveInput) => void,
): RunResult {
  const car = freshCar();
  const d = o.d ?? 0;
  const s0 = startS ?? firstCurveS(t) - (o.runUp ?? 30);
  placeCar(car, t, s0, d, o.mph);
  const ramp = new SteerRamp();
  let level = 0;
  let sHint = s0;
  const res: RunResult = {
    spun: false,
    spinAt: 0,
    maxSlipDeg: 0,
    maxUse: 0,
    wide: 0,
    inside: 0,
    slideT: 0,
    endMph: 0,
    time: Infinity,
    looseAt: -1,
    splitT: (o.splits ?? []).map(() => Infinity),
    wallHits: 0,
    overSteps: 0,
    cornerSteps: 0,
    cornerUse: [],
  };
  const human = new HumanKeys(o.react ?? HUMAN.REACT, o.noCatch);
  const player = new PlayerSteering(steerTrack(t));
  let wallAgo = 99;
  let prevWallAgo = 99;
  const T = o.T ?? 5;
  let slipSince = -1;
  let tapUntil = -1;
  let tapDir = 0;
  let owed = 0;
  let lastSteer = 0;
  let lastKey = 0;
  let keyUntil = 0;
  const hold = o.holdMph ?? o.approachMph ?? o.mph;
  const sCurve = o.approachMph !== undefined ? nextCurveS(t, s0) : 0;
  let entered = o.approachMph === undefined;
  let curveDone = false;
  let tIn = 0;
  for (let time = 0; time < T; time += DT) {
    const st = t.project(car.x, car.y, sHint);
    sHint = st.s;
    car.s = st.s;
    car.d = st.d;
    const v = Math.max(1, car.speed * PXM);
    const kRoad = t.table.at(st.s + v * 0.03);
    const kLane = laneCurvature(kRoad, d);
    // Frenet tracking: feed-forward lane curvature plus lateral and course-angle feedback.
    const e = st.d - d;
    const psi = wrapAngle(car.moveAngle - t.pointAt(st.s, d).heading);
    const w = 4;
    const kWant = kLane - (w / v) ** 2 * e - ((2 * 0.8 * w) / v) * psi;
    const want = Math.max(-1, Math.min(1, kWant / maxCurvature(v)));
    const slip = wrapAngle(car.heading - car.moveAngle);
    if (Math.abs(slip) > 0.1) {
      if (slipSince < 0) slipSince = time;
    } else slipSince = -1;
    const reacting = slipSince >= 0 && time - slipSince >= (o.react ?? 0.3);
    let steer: number;
    let humanKey = 0;
    let aiGas: boolean | null = null;
    let aiBrake = false;
    switch (o.driver) {
      case 'ai': {
        // Same planner, pursuit and grip cap as src/race/ai.ts.
        const target = planSpeed(t.table, st.s, st.d, d, o.gripFrac ?? 0.987, car.speed);
        aiGas = car.speed < target - 0.5;
        aiBrake = car.speed > target + 1.5;
        const lookAi = 40 + Math.max(0, car.speed) * PXM * 0.22;
        const q = t.pointAt(st.s + lookAi, d);
        const diff = wrapAngle(Math.atan2(q.y - car.y, q.x - car.x) - car.heading);
        const G = CONFIG.GRIP;
        const fLong = aiBrake ? brakeAt(car.speed) / CONFIG.BRAKE_MPH_S_HIGH : 0;
        const cap = Math.min(1, (G.GRIP * Math.sqrt(1 - (G.FC_K * fLong) ** 2)) / (v * v * maxCurvature(v)));
        steer = Math.max(-cap, Math.min(cap, diff * 5));
        break;
      }
      case 'human': {
        const look = Math.max(HUMAN.LOOK_MIN, v * HUMAN.LOOK_S);
        const q = t.pointAt(st.s + look, d);
        const err = wrapAngle(Math.atan2(q.y - car.y, q.x - car.x) - car.heading);
        steer = Number.NaN; // set below, once the pedals are known
        const bendK = t.table.at(st.s) || t.table.at(st.s + look);
        humanKey = human.step(time, err, Math.sign(bendK));
        // an insisting player holds the key into the bend from turn-in until the bend is behind
        if (o.insist && t.table.at(st.s) !== 0) humanKey = Math.sign(t.table.at(st.s));
        break;
      }
      case 'ideal':
        steer = want;
        break;
      case 'lock':
        steer = Math.abs(want) > 0.05 ? Math.sign(want) : 0;
        break;
      case 'catch':
        steer = reacting ? -Math.sign(slip) * Math.min(1, Math.abs(slip) * 4) : want;
        break;
      default: {
        const assist = curvatureAssist(car, kLane);
        level = assist !== 0 ? Math.min(1, level + DT / CONFIG.CORNER_ASSIST_IN_S) : Math.max(0, level - DT / CONFIG.CORNER_ASSIST_IN_S);
        const a = assist * level;
        let key: number;
        if (o.driver === 'keysHold') key = want - a > 0.3 ? 1 : want - a < -0.3 ? -1 : 0;
        else {
          // delta-sigma: integrate the steer still missing; press while it is owed, hold each press >= 70 ms
          owed += (want - lastSteer) * DT;
          if (time >= keyUntil) {
            key = owed > 0.012 ? 1 : owed < -0.012 ? -1 : 0;
            if (key !== 0 && key !== lastKey) keyUntil = time + 0.07;
            lastKey = key;
          } else key = lastKey;
        }
        if (o.driver === 'keysCatch') {
          if (reacting && tapUntil < 0) {
            tapUntil = time + (o.tap ?? 0.1);
            tapDir = -Math.sign(slip);
          }
          if (time < tapUntil) key = tapDir;
          else if (tapUntil >= 0 && Math.abs(slip) < 0.1) tapUntil = -1;
        }
        steer = Math.max(-1, Math.min(1, ramp.update(key, DT, kRoad !== 0) + a));
        lastSteer = steer;
      }
    }
    const g = o.gas ?? 'hold';
    if (entered && !curveDone && kRoad === 0 && st.s > sCurve + 50 && t.table.at(st.s - 50) !== 0) curveDone = true;
    const input: DriveInput = {
      steer,
      gas: g === 'full' || ((g === 'hold' || (g === 'exit' && !curveDone)) && car.speed < hold) || (g === 'exit' && curveDone),
      brake: g === 'brake' && time - tIn < 0.4,
      toggleReverse: false,
    };
    if (aiGas !== null) {
      input.gas = aiGas;
      input.brake = aiBrake;
    }
    if (o.planFrac !== undefined || o.classicTurnMph !== undefined) {
      const target = planTarget(t, st.s, st.d, d, car.speed, o);
      input.gas = car.speed < target - 0.5;
      input.brake = car.speed > target + 1.5;
    }
    if (!entered && aiGas === null) {
      // Approach: brake late (at 0.75 x the braking rate) to reach approachMph at the curve.
      const left = sCurve - st.s;
      if (left <= 0) {
        entered = true;
        tIn = time;
      } else {
        const vt = Math.sqrt(o.approachMph! ** 2 + (2 * CONFIG.BRAKE_MPH_S * 0.75 * left) / PXM);
        input.brake = car.speed > vt + 0.5;
        input.gas = !input.brake && car.speed < Math.min(vt, CONFIG.MAX_MPH) - 0.5;
      }
    }
    if (o.driver === 'human') {
      const ps = player.update(car, humanKey, DT, input.brake);
      input.steer = ps.steer;
      input.straightTo = ps.straightTo;
    }
    const walls = o.walls;
    stepCar(car, input, DT, walls === 'oval' ? OVAL : withWalls(walls ? corridor(t, walls[0], walls[1], () => sHint) : () => null));
    if (trace) trace(time, car, input);
    wallAgo = car.wallImpact > 0 ? 0 : wallAgo + DT;
    if (car.wallImpact > 0 && wallAgo === 0 && prevWallAgo > 0.3) res.wallHits++;
    prevWallAgo = wallAgo;
    if (car.rearLoose && res.looseAt < 0) res.looseAt = time;
    if (car.spinTime > 0) {
      res.spun = true;
      res.spinAt = time;
      break;
    }
    const sl = Math.abs(wrapAngle(car.heading - car.moveAngle));
    res.maxSlipDeg = Math.max(res.maxSlipDeg, (sl * 180) / Math.PI);
    res.maxUse = Math.max(res.maxUse, car.gripUse);
    const st2 = t.project(car.x, car.y, sHint);
    const kHere = t.curvatureAt(st2.s);
    const out = (st2.d - d) * (kHere < 0 ? 1 : kHere > 0 ? -1 : 0);
    if (st2.s > s0 + 30 && time >= (o.settle ?? 0)) {
      res.wide = Math.max(res.wide, out);
      res.inside = Math.max(res.inside, -out);
    }
    if (car.slideTime > 0) res.slideT += DT;
    if (kHere !== 0) {
      res.cornerSteps++;
      res.cornerUse.push(car.gripUse);
      if (car.gripUse > 1.1) res.overSteps++;
    }
    (o.splits ?? []).forEach((sp, i) => {
      if (st2.s >= sp && res.splitT[i] === Infinity) res.splitT[i] = time;
    });
    if (st2.s >= finishS && res.time === Infinity) {
      res.time = time;
      if (o.stopAtFinish) break;
    }
  }
  res.endMph = car.speed;
  return res;
}

/** Speed a planning driver aims for at s: the AI planner (grip) or a fixed corner speed (classic). */
function planTarget(t: DriveTrack, s: number, dNow: number, d: number, mph: number, o: RunOpts): number {
  if (CONFIG.DRIVE_MODEL === 'grip') return planSpeed(t.table, s, dNow, d, o.planFrac ?? 1, mph);
  const turnV = o.classicTurnMph ?? 150;
  if (t.table.at(s) !== 0) return turnV;
  let dist = 0;
  while (dist < 2000 && t.table.at(s + dist) === 0) dist += t.table.step;
  return Math.min(CONFIG.MAX_MPH, Math.sqrt(turnV * turnV + (2 * CONFIG.BRAKE_MPH_S * 0.75 * dist) / PXM));
}

export function nextCurveS(t: DriveTrack, from: number): number {
  for (let s = from; s < from + t.len; s += 1) if (t.curvatureAt(s) !== 0) return s;
  return from;
}

export function firstCurveS(t: DriveTrack): number {
  for (let s = 0; s < t.len; s += 1) if (t.curvatureAt(s) !== 0) return s;
  return 0;
}
