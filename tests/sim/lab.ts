// Corner lab: one corner on its own, for tuning the driving model fast (no race, no AI, no track).
// A corner is a radius and an angle; the car drives the widest line through it that uses a share of
// the track width, entering at a chosen speed. Walls are those of the game tracks. The command line
// is tests/lab/corner.lab.ts (`npm run lab`); tests/corners.test.ts pins the targets.
import { CONFIG } from '../../src/config';
import { aiInput } from '../../src/race/ai';
import type { Car } from '../../src/race/car';
import { type DriveInput, limitMph, maxCurvature, stepCar } from '../../src/race/physics';
import { PlayerSteering } from '../../src/race/steering';
import { LANES, type PitLane, type Track, type WallNormal, wrapAngle } from '../../src/track/common';
import { HUMAN_MARGIN, LAB_HW, type LabCorner, LINE_MARGIN, labCorner } from './curves';
import { corridor, DT, freshCar, HUMAN, HumanKeys, placeCar, steerTrack, withWalls } from './drivers';

/**
 * line: analog, tracks the line exactly (insists at full lock when over the limit). human: keys through the game's PlayerSteering.
 * ai: the game's aiInput, alone on the corner (it plans its own speed and line: mode, v and use only set the start).
 */
export type LabDriver = 'line' | 'human' | 'ai';
/** flat: full throttle. brake: brake late to vc for the turn-in, hold it to the apex, then full throttle. hold: start just before the turn-in at v and hold it to the apex. */
export type LabMode = 'flat' | 'brake' | 'hold';

export interface CornerSpec {
  r: number;
  deg: number;
  dir?: 'left' | 'right';
  /** Share of the track width the line uses: 1 the full racing line (default), 0 the centre line. */
  use?: number;
  driver?: LabDriver;
  /** line: countersteer once the slip has been over 0.1 rad for this many seconds (never when omitted). */
  react?: number;
  /** human: holds the key into the bend while the road's arc is under the car, whatever happens. */
  insist?: boolean;
  mode?: LabMode;
  /** Start speed (mph): the approach for flat / brake (default MAX_MPH), the corner speed for hold. */
  v?: number;
  /** brake: the speed to brake to for the turn-in. */
  vc?: number;
  /** ai: the driver's skill, 0 (the slowest draw of turnMph and reaction) to 1 (the fastest, default). */
  skill?: number;
  /** ai: its lane (default: the outside lane of the corner). */
  lane?: number;
}

export interface CornerRun {
  /** Seconds from the start to the finish gate (FINISH_AFTER px after the corner); Infinity if never reached. */
  t: number;
  /** Lowest speed from the turn-in on, and the speed at the finish gate (mph). */
  vMin: number;
  vExit: number;
  /** Largest distance outside the line (px), from the turn-in to the finish gate. */
  wide: number;
  /** Fresh wall hits (none in the 0.3 s before) at more than WALL_HIT_MPH into the wall; brushes do not count. */
  wallHits: number;
  spun: boolean;
  /** The rear let go (Car.rearLoose) at some point. */
  loose: boolean;
  maxSlipDeg: number;
}

const FINISH_AFTER = 400;
const WALL_HIT_MPH = 2;
const HOLD_BEFORE = 60;
const T_MAX = 15;

interface Ctx {
  spec: CornerSpec;
  c: LabCorner;
  car: Car;
  v0: number;
  time: number;
  roadS: number;
  lineS: number;
  slipSince: number;
  human: HumanKeys;
  player: PlayerSteering;
  /** ai: the road as a game track (no pits), built on the first step. */
  track?: Track;
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

/** Frenet tracking of the line (feed-forward curvature, lateral and course-angle feedback), plus the optional catch. */
function lineSteer(x: Ctx): number {
  const { car, c } = x;
  const st = c.line.project(car.x, car.y, x.lineS);
  const v = Math.max(1, car.speed * CONFIG.PX_PER_MPH);
  const w = 4;
  const psi = wrapAngle(car.moveAngle - c.line.pointAt(st.s, 0).heading);
  const kWant = c.line.table.at(st.s + v * 0.03) - (w / v) ** 2 * st.d - ((2 * 0.8 * w) / v) * psi;
  const slip = wrapAngle(car.heading - car.moveAngle);
  if (Math.abs(slip) > 0.1) {
    if (x.slipSince < 0) x.slipSince = x.time;
  } else x.slipSince = -1;
  const react = x.spec.react;
  if (react !== undefined && x.slipSince >= 0 && x.time - x.slipSince >= react) return -Math.sign(slip) * Math.min(1, Math.abs(slip) * 4);
  return clamp1(kWant / maxCurvature(v));
}

/** The realistic key player (tests/sim/drivers.ts HumanKeys) aiming at a point ahead on the line. */
function humanKey(x: Ctx): number {
  const { car, c } = x;
  const v = Math.max(1, car.speed * CONFIG.PX_PER_MPH);
  const look = Math.max(HUMAN.LOOK_MIN, v * HUMAN.LOOK_S);
  const q = c.line.pointAt(x.lineS + look, 0);
  const err = wrapAngle(Math.atan2(q.y - car.y, q.x - car.x) - car.heading);
  const kHere = c.road.table.at(car.s);
  const key = x.human.step(x.time, err, Math.sign(kHere || c.road.table.at(car.s + look)));
  return x.spec.insist && kHere !== 0 ? Math.sign(kHere) : key;
}

function pedals(x: Ctx): { gas: boolean; brake: boolean } {
  const { spec, car, c } = x;
  const mode = spec.mode ?? 'brake';
  if (mode === 'flat' || x.lineS >= (c.lineArc0 + c.lineArc1) / 2) return { gas: true, brake: false };
  const vc = mode === 'hold' ? x.v0 : (spec.vc ?? x.v0);
  const left = c.lineArc0 - x.lineS;
  if (mode === 'brake' && left > 0) {
    // late braking at the lowest braking rate, so the car is at vc by the turn-in
    const vt = Math.sqrt(vc * vc + (2 * CONFIG.BRAKE_MPH_S * left) / CONFIG.PX_PER_MPH);
    const brake = car.speed > vt + 0.5;
    return { brake, gas: !brake && car.speed < Math.min(vt, x.v0) - 0.5 };
  }
  return { gas: car.speed < vc, brake: false };
}

const NO_PIT: PitLane = {
  inLane: () => false,
  inBox: () => false,
  walled: () => false,
  decideAt: () => false,
  autoIn: () => false,
  autoOut: () => false,
  reachLaps: 0,
  joiningD: (o) => o.d,
  diving: () => false,
  plan: (_car, _view, target, laneD) => ({ target, laneD, lane: null }),
  follow: () => {},
  aim: () => ({ x: 0, y: 0 }),
};

/** The lab road as a game track for aiInput: open (s does not wrap), no pits. */
function labTrack(x: Ctx, constrain: (c: Car) => WallNormal | null): Track {
  const road = x.c.road;
  return {
    id: 'lab',
    name: 'LAB',
    len: road.len,
    sectorLen: road.len / 8,
    worldW: 0,
    worldH: 0,
    pit: NO_PIT,
    wrapS: (s) => s,
    deltaS: (a, b) => b - a,
    pointAt: (s, d) => road.pointAt(s, d),
    project: (px, py) => road.project(px, py, x.roadS),
    headingAt: (px, py) => road.pointAt(road.project(px, py, x.roadS).s, 0).heading,
    constrain: (p) => constrain(p as Car),
    gridSlot: () => ({ s: 0, d: 0 }),
    curvatureAt: (s) => road.curvatureAt(s),
    curves: () => road.table,
  };
}

function aiDrive(x: Ctx, constrain: (c: Car) => WallNormal | null): DriveInput {
  x.track ??= labTrack(x, constrain);
  return aiInput(x.car, { track: x.track, cars: [x.car], started: true, laps: 99, time: 99 + x.time }, DT);
}

function drive(x: Ctx, constrain: (c: Car) => WallNormal | null): DriveInput {
  if (x.spec.driver === 'ai') return aiDrive(x, constrain);
  const p = pedals(x);
  if (x.spec.driver === 'human') {
    const ps = x.player.update(x.car, humanKey(x), DT, p.brake);
    return { steer: ps.steer, gas: p.gas, brake: p.brake, toggleReverse: false, straightTo: ps.straightTo };
  }
  return { steer: lineSteer(x), gas: p.gas, brake: p.brake, toggleReverse: false };
}

/** The corner as a driver sees it (a key player keeps further off the walls). */
export function cornerFor(spec: CornerSpec): LabCorner {
  return labCorner(spec.r, spec.deg, spec.dir, spec.use ?? 1, spec.driver === 'human' ? HUMAN_MARGIN : LINE_MARGIN);
}

function setup(spec: CornerSpec): Ctx {
  const c = cornerFor(spec);
  const car = freshCar();
  const v0 = spec.v ?? CONFIG.MAX_MPH;
  const s0 = spec.mode === 'hold' ? Math.max(0, c.lineArc0 - HOLD_BEFORE) : 0;
  placeCar(car, c.road, s0, -c.sign * c.hw, v0);
  if (spec.driver === 'ai') {
    const k = spec.skill ?? 1;
    car.isPlayer = false;
    car.ai.turnMph = CONFIG.AI_TURN_MPH[0] + (CONFIG.AI_TURN_MPH[1] - CONFIG.AI_TURN_MPH[0]) * k;
    car.ai.reaction = CONFIG.AI_REACTION_S[1] + (CONFIG.AI_REACTION_S[0] - CONFIG.AI_REACTION_S[1]) * k;
    car.ai.topMph = CONFIG.MAX_MPH;
    car.ai.lane = spec.lane ?? -c.sign * LANES[LANES.length - 1]!;
    car.d = -c.sign * c.hw;
  }
  return {
    spec,
    c,
    car,
    v0,
    time: 0,
    roadS: s0,
    lineS: s0,
    slipSince: -1,
    human: new HumanKeys(HUMAN.REACT),
    player: new PlayerSteering(steerTrack(c.road)),
  };
}

/** One step of a run, for tracing (LAB trace=1). */
export interface TraceRow {
  t: number;
  s: number;
  /** Lateral offsets (px) from the road's centre line and from the line driven (+ = right of travel). */
  d: number;
  dLine: number;
  mph: number;
  input: DriveInput;
  slipDeg: number;
  wall: number;
  loose: boolean;
}

/** Drive one corner. */
export function runCorner(spec: CornerSpec, trace?: (row: TraceRow) => void): CornerRun {
  const x = setup(spec);
  const { car, c } = x;
  const constrain = corridor(c.road, LAB_HW, -LAB_HW, () => x.roadS);
  const walls = withWalls(constrain);
  const res: CornerRun = { t: Infinity, vMin: Infinity, vExit: 0, wide: 0, wallHits: 0, spun: false, loose: false, maxSlipDeg: 0 };
  const finish = c.arc1 + FINISH_AFTER;
  let wallAgo = 99;
  for (x.time = 0; x.time < T_MAX; x.time += DT) {
    const st = c.road.project(car.x, car.y, x.roadS);
    x.roadS = car.s = st.s;
    car.d = st.d;
    const ln = c.line.project(car.x, car.y, x.lineS);
    x.lineS = ln.s;
    if (st.s >= finish) {
      res.t = x.time;
      break;
    }
    if (x.lineS >= c.lineArc0) {
      res.vMin = Math.min(res.vMin, car.speed);
      res.wide = Math.max(res.wide, -c.sign * ln.d);
    }
    const input = drive(x, constrain);
    stepCar(car, input, DT, walls);
    const slipDeg = (wrapAngle(car.heading - car.moveAngle) * 180) / Math.PI;
    trace?.({ t: x.time, s: st.s, d: st.d, dLine: ln.d, mph: car.speed, input, slipDeg, wall: car.wallImpact, loose: car.rearLoose });
    if (car.wallImpact > WALL_HIT_MPH && wallAgo > 0.3) res.wallHits++;
    wallAgo = car.wallImpact > 0 ? 0 : wallAgo + DT;
    res.loose ||= car.rearLoose;
    res.maxSlipDeg = Math.max(res.maxSlipDeg, Math.abs(slipDeg));
    if (car.spinTime > 0) {
      res.spun = true;
      break;
    }
  }
  res.vExit = car.speed;
  return res;
}

export interface CornerBest {
  spec: CornerSpec;
  /** Radius of the line and the model's limit on it (mph, capped at MAX_MPH). */
  rho: number;
  vLimit: number;
  /** The corner speed (brake mode) with the fastest clean run (no wall, no spin), and its time. */
  vBest: number;
  best: CornerRun;
  /** Full throttle from the same start: time lost against the best (Infinity: spun). */
  flat: CornerRun;
  dtFlat: number;
  /** Braking to 1.1 x / 0.9 x vBest: time lost (undefined when vBest is already flat out). */
  over?: CornerRun;
  dtOver?: number;
  under: CornerRun;
  dtUnder: number;
  /** Fastest run with wall contact minus the best clean time: < 0 means riding the wall pays. */
  wallGain: number;
}

const clean = (r: CornerRun) => !r.spun && r.wallHits === 0 && r.t < Infinity;

/** Search the corner speed with the fastest clean run (every 4 mph, then every 0.5 around the best). */
export function bestEntry(spec: CornerSpec): CornerBest {
  const vTop = spec.v ?? CONFIG.MAX_MPH;
  const at = (vc: number) => runCorner({ ...spec, mode: 'brake', v: vTop, vc: Math.min(vc, vTop) });
  let vBest = 0;
  let best: CornerRun | null = null;
  let dirty = Infinity;
  const consider = (vc: number) => {
    const r = at(vc);
    if (clean(r) && (!best || r.t < best.t)) {
      vBest = Math.min(vc, vTop);
      best = r;
    } else if (!clean(r)) dirty = Math.min(dirty, r.t);
  };
  for (let vc = 40; vc < vTop; vc += 4) consider(vc);
  consider(vTop);
  const coarse = vBest;
  for (let vc = coarse - 3.5; vc <= coarse + 3.5; vc += 0.5) if (vc > 0 && vc < vTop && vc !== coarse) consider(vc);
  const b: CornerRun = best ?? at(40);
  const c = cornerFor(spec);
  const flat = runCorner({ ...spec, mode: 'flat', v: vTop });
  const over = vBest < vTop ? at(vBest * 1.1) : undefined;
  const under = at(vBest * 0.9);
  return {
    spec,
    rho: c.rho,
    vLimit: Math.min(CONFIG.MAX_MPH, limitMph(1 / c.rho)),
    vBest,
    best: b,
    flat,
    dtFlat: flat.t - b.t,
    over,
    dtOver: over && over.t - b.t,
    under,
    dtUnder: under.t - b.t,
    wallGain: dirty - b.t,
  };
}

/** What happened in a run, in a few letters. */
export function outcome(r: CornerRun): string {
  if (r.spun) return 'SPIN';
  if (r.t === Infinity) return 'stuck';
  if (r.wallHits > 0) return `wall${r.wallHits}`;
  if (r.loose) return 'loose';
  if (r.wide > 8) return `wide${r.wide.toFixed(0)}`;
  return 'ok';
}

const f = (x: number | undefined, w: number, p = 0) => (x === undefined ? '-' : x === Infinity ? 'inf' : x.toFixed(p)).padStart(w);
const dt = (x: number | undefined) => (x === undefined ? '-' : x === Infinity ? 'inf' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`).padStart(6);

export function formatBest(rows: CornerBest[]): string {
  const head = '    R deg driver use   rho  vLim | vBest  tBest | flat: dt   what | +10%: dt   what | -10%: dt | wall pays';
  const lines = rows.map((b) => {
    const s = b.spec;
    const drv = `${s.driver ?? 'line'}${s.insist ? '!' : ''}`;
    return [
      `${f(s.r, 5)} ${f(s.deg, 3)} ${drv.padEnd(6)} ${f(s.use ?? 1, 3, 1)} ${f(b.rho, 5)} ${f(b.vLimit, 5)} |`,
      `${f(b.vBest, 5, 1)} ${f(b.best.t, 6, 2)} |`,
      `${dt(b.dtFlat)} ${outcome(b.flat).padStart(6)} |`,
      `${dt(b.dtOver)} ${(b.over ? outcome(b.over) : '-').padStart(6)} |`,
      `${dt(b.dtUnder)} |`,
      `${dt(b.wallGain)}`,
    ].join(' ');
  });
  return [head, ...lines].join('\n');
}

export function formatRuns(spec: CornerSpec, speeds: number[], runs: CornerRun[]): string {
  const s = spec;
  const title = `R ${s.r} deg ${s.deg} ${s.driver ?? 'line'}${s.insist ? ' insist' : ''} use ${s.use ?? 1} mode ${s.mode ?? 'hold'}${s.react !== undefined ? ` react ${s.react}` : ''}`;
  const head = '    v      t  vMin vExit  wide wall loose slip  what';
  const lines = runs.map(
    (r, i) =>
      `${f(speeds[i], 5, 1)} ${f(r.t, 6, 2)} ${f(r.vMin, 5)} ${f(r.vExit, 5)} ${f(r.wide, 5)} ${f(r.wallHits, 4)} ${(r.loose ? 'yes' : '-').padStart(5)} ${f(r.maxSlipDeg, 4)} ${outcome(r).padStart(6)}`,
  );
  return [title, head, ...lines].join('\n');
}

/** A run's trace every `every` s (and on every wall contact). */
export function formatTrace(rows: TraceRow[], every = 0.1): string {
  const head = '     t      s     d  dLine  mph  steer pedal  slip wall';
  const out: string[] = [head];
  let next = 0;
  for (const r of rows) {
    if (r.t + 1e-9 < next && r.wall === 0) continue;
    next = r.t + every;
    const pedal = r.input.brake ? 'brake' : r.input.gas ? 'gas' : '-';
    out.push(
      `${f(r.t, 6, 2)} ${f(r.s, 6)} ${f(r.d, 5, 1)} ${f(r.dLine, 6, 1)} ${f(r.mph, 4)} ${f(r.input.steer, 6, 2)} ${pedal.padStart(5)} ${f(r.slipDeg, 5, 1)} ${r.wall > 0 ? r.wall.toFixed(1) : ''}${r.loose ? ' loose' : ''}`,
    );
  }
  return out.join('\n');
}
