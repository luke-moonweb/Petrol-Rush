import { CONFIG } from '../config';
import { HALF_W, LANES, NUM_SECTORS, type Track, wrapAngle } from '../track/common';
import type { CurvatureTable } from '../track/curvature';
import { PIT_FUEL_MARGIN_LAPS } from '../track/pitAi';
import { racingLine } from '../track/racingLine';
import { type Car, isServicing } from './car';
import { canSaveToFinish, lapsOfFuel, lapsToFinish } from './fuel';
import { type OilSlick, oilRadius } from './oil';
import { hash01 } from './persona';
import { brakeAt, type DriveInput, gripAt, limitMph, maxCurvature } from './physics';
import { gripFrac, lineUse, planLineSpeed, planSpeed } from './planner';

export interface AiView {
  track: Track;
  cars: Car[];
  started: boolean;
  laps: number;
  time: number;
  oil?: readonly OilSlick[];
  /** The player's car is under the pit autopilot (it merges by hand after the hand-back). */
  pitAuto?: boolean;
  /** The player drives its car (not the AI): it may brake to a stop anywhere (standing). */
  playerDriving?: boolean;
}

function laneFree(track: Track, car: Car, lane: number, cars: Car[], backPx = 55, around: Car | null = null): boolean {
  const lo = Math.min(car.d, lane) - 14;
  const hi = Math.max(car.d, lane) + 14;
  const back = car.speed < 30 ? -25 : -backPx;
  const front = car.speed < 30 ? 50 : 90;
  for (const o of cars) {
    if (o === car || o === around) continue;
    const ds = track.deltaS(car.s, o.s);
    // (driving around a standing car from slow: a car coming up behind needs time to see us move out)
    const behind = around ? Math.min(back, -(o.speed - car.speed) * CONFIG.PX_PER_MPH * AROUND_BEHIND_S) : back;
    // (and a faster car ahead is pulling away from where it pulls out)
    const away = around !== null && ds > 0 && o.speed > car.speed + 10;
    if (ds > behind && ds < front && o.d > lo && o.d < hi && !away) return false;
    // (a car going to or from the pits also takes up the line it is moving to, and as it is slow
    // there, from as far ahead as it takes to slow down to its speed)
    const jd = track.pit.joiningD(o);
    if (jd !== o.d && jd > lo && jd < hi && ds > back && ds < Math.max(front, stopRoom(car.speed, o.speed))) return false;
    if (Math.abs(ds) < 60 && o.ai.lane === lane && !o.isPlayer && Math.abs(o.d - lane) < 25) return false;
  }
  return true;
}

/** Distance (px) to slow from `v` to `v0` mph at the follow-logic braking rate, plus a car length. */
function stopRoom(v: number, v0: number): number {
  const pxm = CONFIG.PX_PER_MPH;
  const dv2 = Math.max(0, v * v - Math.max(0, v0) ** 2);
  return (dv2 * pxm) / (2 * CONFIG.BRAKE_MPH_S * 0.7) + 46;
}

export function aiInput(car: Car, view: AiView, dt: number): DriveInput {
  const out: DriveInput = { steer: 0, gas: false, brake: false, toggleReverse: false };
  const ai = car.ai;
  if (car.reverse && ai.recoverTime <= 0) out.toggleReverse = Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH;
  ai.laneCooldown = Math.max(0, ai.laneCooldown - dt);

  const track = view.track;
  decidePitStop(car, view);
  if (ai.pitPhase !== 'exiting') {
    ai.merging = false;
    ai.mergeWait = 0;
  }
  const pit = track.pit.plan(car, view, ai.topMph, ai.lane, dt);
  const plan: Plan = {
    target: pit.target,
    laneD: pit.laneD,
    oilLane: false,
    line: false,
    lineShift: 0,
    look: null,
    held: false,
    free: false,
    steerShift: 0,
  };

  if (pit.lane !== null) {
    ai.onLine = false;
    track.pit.follow(car, view, pit);
    plan.target = pit.target;
  } else {
    // A car already diving for the pit entry stays on its line (it only slows for oil and
    // hazards); a lane change there would make it miss the pit road.
    const diving = track.pit.diving(car);
    const ok = !diving && pit.laneD === ai.lane && ai.blockLane === null;
    if (!(ai.level.freeLine && freeLine(car, view, plan, ok, dt))) takeLine(car, view, plan, ok);
    const laneD = plan.laneD;
    avoidOil(car, view, plan, dt, diving);
    avoidHazards(car, view, plan, dt, diving);
    // (on the free line, oil or a hazard that picked a lane takes the car off it)
    if (plan.free && plan.laneD !== laneD) leaveLine(car, plan);
    followTraffic(car, view, plan);
    blockInside(car, view, plan, diving);
    // (hard: a pair turning in side by side, on the free line or a lane, sorts out who goes first)
    if (ai.level.freeLine && ai.pitPhase === 'none') cornerPair(car, view, plan);
  }
  if (pit.lane === null && ai.pitPhase === 'none' && !plan.oilLane) avoidSideRub(car, view, plan);
  // (any of the above that picked a lane takes the car off the racing line)
  if (plan.line && ai.lane !== nearestLane(car.d)) leaveLine(car, plan);
  planSlide(car, track, plan, dt);
  paceTarget(car, view, plan, dt);
  steerAndPedals(car, track, pit.lane, plan, out);
  if (recover(car, view, out, dt)) return out;
  watchStuck(car, view, dt);
  return out;
}

/** What one step of the AI is aiming for: a speed and a line (d), whether that line dodges oil, and whether it is the racing line. */
interface Plan {
  target: number;
  laneD: number;
  oilLane: boolean;
  line: boolean;
  /** On the line: how far (px) it is moved across, to keep clear of a car alongside (holdOff) or, on the free line, to pass. */
  lineShift: number;
  /** A shorter look-ahead (px) for the steering: getting across quickly round a standing car (goAround). */
  look: number | null;
  /** On the line: holdOff moved it (on the free line: a car ahead of ours did). No gas meanwhile. */
  held: boolean;
  /** On the free line (hard, freeLine): moved across freely, no lanes. */
  free: boolean;
  /** On the line: lineShift as the steering takes it (where the car is). */
  steerShift: number;
}

/**
 * With no car alongside or just ahead, drive the racing line (outside, apex, outside) instead of a lane.
 * A car on a lane joins it where the line is close, or on a straight; one with a car alongside goes back
 * to the lane nearest to it. A car behind does not push a car off the line (it follows), but the line
 * keeps clear of any car still overlapping along the track (holdOff).
 */
function takeLine(car: Car, view: AiView, plan: Plan, ok: boolean): void {
  const ai = car.ai;
  const track = view.track;
  const line = racingLine(track);
  const use = lineUse(car);
  const dLine = line.d(car.s, use);
  const curves = track.curves();
  const quiet = ai.pitPhase === 'none' && ai.oilTime === 0 && ai.hazardTime === 0 && ai.laneCooldown <= 0 && ai.recoverTime <= 0;
  const room = ai.onLine ? LINE_KEEP : LINE_JOIN;
  const near = (o: Car) => {
    if (!onTrack(track, car, o)) return false;
    const ds = track.deltaS(car.s, o.s);
    // (a much slower car counts from as far ahead as it takes to slow down to it)
    const slower = o.speed < car.speed - LINE_SLOWER_MPH;
    return ds > -room.back && (ds < room.front || (slower && ds < stopRoom(car.speed, o.speed)));
  };
  const reach =
    ai.onLine ||
    Math.abs(dLine - car.d) < LINE_JOIN_PX ||
    (curves.at(car.s) === 0 && curves.maxAbsAhead(car.s, LANE_CHANGE_CLEAR, 8) === 0);
  if (ok && quiet && reach && !view.cars.some(near)) {
    ai.onLine = plan.line = true;
    // (the traffic checks look where the line is heading: a pursuit's aim point ahead)
    const dAhead = line.d(car.s + 40 + Math.max(0, car.speed) * CONFIG.PX_PER_MPH * 0.22, use);
    plan.lineShift = holdOff(track, car, view.cars, dAhead).d - dAhead;
    plan.held = plan.lineShift !== 0;
    plan.steerShift = plan.lineShift;
    plan.laneD = dAhead + plan.lineShift;
    ai.lane = nearestLane(car.d);
  } else if (ai.onLine) {
    ai.onLine = false;
    ai.lane = plan.laneD = laneOffLine(track, car, view.cars);
  }
}

/** Leaving the line: the nearest lane no car alongside is on (in a bend the nearest can be its lane). */
function laneOffLine(track: Track, car: Car, cars: Car[]): number {
  const taken = (lane: number) =>
    cars.some((o) => onTrack(track, car, o) && Math.abs(track.deltaS(car.s, o.s)) < LINE_OVERLAP_PX && Math.abs(o.d - lane) < LINE_GAP_PX);
  const lanes = [...LANES].sort((p, q) => Math.abs(p - car.d) - Math.abs(q - car.d));
  return lanes.find((l) => !taken(l)) ?? lanes[0]!;
}

/** Another car racing on the track (not in its box, not on the pit lane unless moving out of it). */
function onTrack(track: Track, car: Car, o: Car): boolean {
  if (o === car || isServicing(o)) return false;
  return !(track.pit.inLane(o.x, o.y) && track.pit.joiningD(o) === o.d);
}

/**
 * The line's d, kept LINE_GAP_PX across from every car still overlapping ours along the track, and whether
 * a car ahead of ours (more than FREE_LEVEL_PX: not one level or behind) is what moved it.
 */
function holdOff(track: Track, car: Car, cars: Car[], d: number): { d: number; ahead: boolean } {
  let lo = -Infinity;
  let hi = Infinity;
  let loAhead = false;
  let hiAhead = false;
  for (const o of cars) {
    if (!onTrack(track, car, o)) continue;
    const ds = track.deltaS(car.s, o.s);
    const dd = o.d - car.d;
    // (one in line with us, a car length or more ahead or behind, is followed or follows)
    if (Math.abs(ds) >= LINE_OVERLAP_PX || (Math.abs(dd) < LINE_INLINE_PX && Math.abs(ds) > CONFIG.CAR_LEN)) continue;
    if (dd > 0) {
      if (o.d - LINE_GAP_PX < hi) hiAhead = ds > FREE_LEVEL_PX;
      hi = Math.min(hi, o.d - LINE_GAP_PX);
    } else {
      if (o.d + LINE_GAP_PX > lo) loAhead = ds > FREE_LEVEL_PX;
      lo = Math.max(lo, o.d + LINE_GAP_PX);
    }
  }
  if (lo > hi) return { d: car.d, ahead: loAhead || hiAhead };
  const held = Math.max(lo, Math.min(hi, d));
  return { d: held, ahead: (held > d && loAhead) || (held < d && hiAhead) };
}

/**
 * Hard (level.freeLine): the racing line with no lanes. The car keeps to its own line, moved across
 * (ai.freeShift, so a car alongside follows the line's shape side by side) only to pass a slower car on a
 * straight (passTarget) and by holdOff to keep clear of a car alongside; it is back on the line before the
 * bend. False when it does not apply (the pits, oil, a hazard, backing out, a block, or a lane avoidSideRub
 * picked still cooling down): then takeLine runs.
 */
function freeLine(car: Car, view: AiView, plan: Plan, ok: boolean, dt: number): boolean {
  const ai = car.ai;
  const track = view.track;
  const quiet =
    ai.pitPhase === 'none' && ai.oilTime === 0 && ai.hazardTime === 0 && ai.recoverTime <= 0 && (ai.onLine || ai.laneCooldown <= 0);
  if (!ok || !quiet) {
    ai.passId = -1;
    return false;
  }
  const line = racingLine(track);
  const use = lineUse(car);
  const dNow = line.d(car.s, use);
  // (joining: from where the car is, moving onto the line at the shift rate)
  if (!ai.onLine) {
    ai.freeShift = car.d - dNow;
    ai.passId = -1;
  }
  ai.onLine = plan.line = plan.free = true;
  const dAhead = line.d(car.s + 40 + Math.max(0, car.speed) * CONFIG.PX_PER_MPH * 0.22, use);
  const pass = passTarget(car, view, plan, dAhead);
  const want = pass === null ? 0 : pass - dAhead;
  const step = FREE_SHIFT_PX_S * dt;
  ai.freeShift += Math.max(-step, Math.min(step, want - ai.freeShift));
  const edge = FREE_EDGE_D;
  const hold = holdOff(track, car, view.cars, Math.max(-edge, Math.min(edge, dAhead + ai.freeShift)));
  plan.lineShift = hold.d - dAhead;
  plan.steerShift = plan.lineShift;
  // (held off by a car ahead: drop back behind it; only at speed, or a crawling car would stand behind a
  // standing one for good)
  plan.held = car.speed > FREE_HELD_MPH && hold.ahead;
  plan.laneD = hold.d;
  ai.lane = nearestLane(car.d);
  return true;
}

/**
 * Hard, a pair in a corner: with a car alongside (overlapping along the track, not in line, within
 * FREE_PAIR_GAP_PX across) in a bend or one coming up within FREE_PAIR_S, the car ahead (when level, the one
 * on the inside of the bend) keeps its line and the other yields: no gas, and no faster than the leader less
 * FREE_YIELD_MPH, so it drops in behind it instead of turning in side by side.
 */
function cornerPair(car: Car, view: AiView, plan: Plan): void {
  const track = view.track;
  const k = nextCurve(track.curves(), car.s, 40 + Math.max(0, car.speed) * CONFIG.PX_PER_MPH * FREE_PAIR_S);
  if (k === 0) return;
  let lead: Car | null = null;
  for (const o of view.cars) {
    if (!onTrack(track, car, o)) continue;
    const ds = track.deltaS(car.s, o.s);
    const dd = o.d - car.d;
    if (Math.abs(ds) >= LINE_OVERLAP_PX || Math.abs(dd) < LINE_INLINE_PX || Math.abs(dd) > FREE_PAIR_GAP_PX) continue;
    const leads = ds > FREE_LEVEL_PX || (ds >= -FREE_LEVEL_PX && Math.sign(k) * dd > 0);
    if (leads && (!lead || o.speed < lead.speed)) lead = o;
  }
  if (!lead) return;
  plan.held = true;
  plan.target = Math.min(plan.target, Math.max(0, lead.speed - FREE_YIELD_MPH));
}

/** A lane pick takes the car off the line (and off a pass on the free line): the lane pursuit takes over. */
function leaveLine(car: Car, plan: Plan): void {
  plan.line = plan.free = car.ai.onLine = false;
  car.ai.passId = -1;
}

/**
 * Free line: the d to pass a slower car ahead on, or null to keep to the line. A pass starts only with a
 * straight ahead (the personality's passClearPx), on the side nearer to us whose way across is free; it
 * keeps its side until the car is behind us, but is dropped before a bend while not yet alongside.
 */
function passTarget(car: Car, view: AiView, plan: Plan, dAhead: number): number | null {
  const ai = car.ai;
  const track = view.track;
  const curves = track.curves();
  const v = Math.max(0, car.speed) * CONFIG.PX_PER_MPH;
  // (back on the line in time for a bend: moving across takes up to about FREE_BACK_S)
  const bend = curves.at(car.s) !== 0 || curves.maxAbsAhead(car.s, ai.persona.passClearPx + v * FREE_BACK_S, 8) !== 0;
  let o = ai.passId >= 0 ? view.cars.find((c) => c.id === ai.passId) : undefined;
  if (o) {
    const ds = track.deltaS(car.s, o.s);
    const gone = ds < -CONFIG.CAR_LEN - FREE_PASS_DONE_PX || ds > passRange(car, o) || !onTrack(track, car, o);
    if (gone || (bend && ds > CONFIG.CAR_LEN)) o = undefined;
  }
  if (!o && !bend && car.speed > 50) {
    o = slowerAhead(car, view, plan, dAhead);
    ai.passSide = o ? passSide(car, view, o) : 0;
    if (ai.passSide === 0) o = undefined;
  }
  ai.passId = o ? o.id : -1;
  if (!o) return null;
  const edge = FREE_EDGE_D;
  return Math.max(-edge, Math.min(edge, o.d + ai.passSide * FREE_PASS_GAP_PX));
}

/** How far ahead (px) a car is passed from: our braking distance to its speed, at least FREE_PASS_MIN_PX. */
function passRange(car: Car, o: Car): number {
  return Math.max(FREE_PASS_MIN_PX, stopRoom(car.speed, o.speed) + 40);
}

/** The nearest car ahead on our free line slower than we could go (by the personality's passMph). */
function slowerAhead(car: Car, view: AiView, plan: Plan, dAhead: number): Car | undefined {
  const track = view.track;
  let best: Car | undefined;
  let gap = Infinity;
  for (const o of view.cars) {
    if (!onTrack(track, car, o)) continue;
    const ds = track.deltaS(car.s, o.s);
    if (ds <= CONFIG.CAR_LEN * 0.5 || ds > passRange(car, o) || ds >= gap) continue;
    const inPath = Math.abs(o.d - car.d) < 17 || Math.abs(o.d - (dAhead + car.ai.freeShift)) < FREE_PATH_PX;
    if (inPath && o.speed < plan.target - car.ai.persona.passMph - 1) {
      best = o;
      gap = ds;
    }
  }
  return best;
}

/** The side (-1 / 1) to pass `o` on: the nearer one inside the road whose way across is free; 0 if none. */
function passSide(car: Car, view: AiView, o: Car): number {
  const edge = FREE_EDGE_D;
  let best = 0;
  let need = Infinity;
  for (const side of [-1, 1]) {
    const d = Math.max(-edge, Math.min(edge, o.d + side * FREE_PASS_GAP_PX));
    if (Math.abs(d - o.d) < LINE_GAP_PX || Math.abs(d - car.d) >= need) continue;
    if (!laneFree(view.track, car, d, view.cars, 55, o)) continue;
    best = side;
    need = Math.abs(d - car.d);
  }
  return best;
}

function nearestLane(d: number): number {
  return LANES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
}

function decidePitStop(car: Car, view: AiView): void {
  const ai = car.ai;
  const track = view.track;
  // Short of the finish by no more than lifting makes up: ease off instead of stopping.
  ai.economy = ai.pitPhase === 'none' && !car.finished && canSaveToFinish(car, track, view.laps);
  if (ai.pitPhase === 'none' && track.pit.decideAt(car.s)) {
    const fuelLaps = lapsOfFuel(car);
    const lapsLeft = lapsToFinish(car, track, view.laps);
    // The decision comes up to PIT_DECIDE_FROM before turn 2, so also stop when the fuel would not
    // reach the box from the next decision point a lap later.
    // (pitFuelLaps are laps of the oval: on a longer circuit the same share of the tank)
    const low = car.fuel < ai.pitFuelLaps / CONFIG.FUEL_RANGE_LAPS || fuelLaps < 1 + track.pit.reachLaps + PIT_FUEL_MARGIN_LAPS;
    if (car.finished || (low && fuelLaps < lapsLeft + 0.3 && !ai.economy)) ai.pitPhase = 'entering';
  }
}

/** Oil on the line ahead: after a reaction, move to a clean lane, or brake if there is none. */
function avoidOil(car: Car, view: AiView, plan: Plan, dt: number, diving: boolean): void {
  const ai = car.ai;
  const track = view.track;
  const pxm = CONFIG.PX_PER_MPH;
  const oil = view.oil ?? [];
  const slicks = oil.filter((o) => {
    const ds = track.deltaS(car.s, o.s);
    const r = oilRadius(o) + 12;
    return ds > -15 && ds < CONFIG.AI_HAZARD_RANGE && (Math.abs(o.d - plan.laneD) < r || Math.abs(o.d - car.d) < r);
  });
  if (slicks.length > 0) {
    ai.oilTime += dt;
    if (ai.oilTime >= ai.reaction * 0.7) {
      const ahead = oil.filter((o) => {
        const ds = track.deltaS(car.s, o.s);
        return ds > -25 && ds < CONFIG.AI_HAZARD_RANGE;
      });
      const options = LANES.filter((ln) => ahead.every((o) => Math.abs(o.d - ln) > CONFIG.OIL_RADIUS + 12)).sort(
        (p, q) => Math.abs(p - car.d) - Math.abs(q - car.d),
      );
      const free = options.find((ln) => sideClear(track, car, ln, view.cars)) ?? options[0];
      const nearest = Math.min(...slicks.map((o) => track.deltaS(car.s, o.s)));
      if (free !== undefined && !diving) {
        ai.lane = plan.laneD = free;
        ai.laneCooldown = 1.5;
        plan.oilLane = true;
        plan.target = Math.min(plan.target, 70 + Math.max(0, nearest) * 0.4);
      } else {
        plan.target = Math.min(plan.target, Math.sqrt((2 * CONFIG.BRAKE_MPH_S * 0.8 * Math.max(0, nearest - 30)) / pxm));
      }
    }
  } else {
    ai.oilTime = 0;
  }
}

/** Spun or crawling cars ahead: after a reaction, take a free lane or brake for them. */
function avoidHazards(car: Car, view: AiView, plan: Plan, dt: number, diving: boolean): void {
  const ai = car.ai;
  const track = view.track;
  const pxm = CONFIG.PX_PER_MPH;
  const hazards = view.cars.filter((o) => {
    if (o === car || !isHazard(track, o, car)) return false;
    const ds = track.deltaS(car.s, o.s);
    return ds > 0 && ds < CONFIG.AI_HAZARD_RANGE && (Math.abs(o.d - plan.laneD) < 22 || Math.abs(o.d - car.d) < 20);
  });
  if (hazards.length > 0) {
    ai.hazardTime += dt;
    if (ai.hazardTime >= ai.reaction) {
      const all = view.cars.filter((o) => {
        if (o === car || !isHazard(track, o, car)) return false;
        const ds = track.deltaS(car.s, o.s);
        return ds > -20 && ds < CONFIG.AI_HAZARD_RANGE;
      });
      const free = [...LANES]
        .sort((p, q) => Math.abs(p - car.d) - Math.abs(q - car.d))
        .find((ln) => all.every((h) => Math.abs(h.d - ln) > 21) && sideClear(track, car, ln, view.cars));
      if (free !== undefined && !plan.oilLane && !diving) {
        ai.lane = plan.laneD = free;
        ai.laneCooldown = 1.5;
        const nearest = Math.min(...hazards.map((h) => track.deltaS(car.s, h.s)));
        plan.target = Math.min(plan.target, 45 + nearest * 0.4);
      } else {
        const nearest = Math.min(...hazards.map((h) => track.deltaS(car.s, h.s)));
        if (ai.hazardTime > ai.reaction + 3 && !plan.oilLane) {
          ai.lane = plan.laneD = [...LANES].sort((p, q) => clearance(q, all) - clearance(p, all))[0]!;
          plan.target = Math.min(plan.target, 12);
        } else {
          plan.target = Math.min(plan.target, Math.sqrt((2 * CONFIG.BRAKE_MPH_S * 0.7 * Math.max(0, nearest - 45)) / pxm));
        }
      }
    }
  } else {
    ai.hazardTime = 0;
  }
}

/** A slower car ahead on our line: overtake on another lane when allowed, otherwise follow it. */
function followTraffic(car: Car, view: AiView, plan: Plan): void {
  const ai = car.ai;
  const track = view.track;
  const pxm = CONFIG.PX_PER_MPH;
  const curves = track.curves();
  const turnNow = curves.at(car.s) !== 0;
  // Lane changes wait until no curvature is close ahead (how close: the driver's personality).
  const laneChangeOk = !turnNow && curves.maxAbsAhead(car.s, ai.persona.passClearPx, 8) === 0;
  const vpx = Math.max(0, car.speed) * pxm;
  const range = Math.max(110, (vpx * vpx) / (2 * CONFIG.BRAKE_MPH_S * pxm * 0.8) + 60);
  let ahead: Car | null = null;
  let gap = Infinity;
  for (const o of view.cars) {
    if (o === car) continue;
    const ds = track.deltaS(car.s, o.s);
    if (ds <= 0 || ds > range) continue;
    // (a car going to or from the pits also counts on the line it is moving to)
    const jd = track.pit.joiningD(o);
    // (a much slower car counts from further across, as the pursuit line drifts into corners)
    const wide = Math.min(FOLLOW_WIDE_PX, Math.max(0, car.speed - o.speed - 20) / 5);
    const near = (d: number) => Math.abs(d - car.d) < 17 + wide || (ds > 40 && Math.abs(d - plan.laneD) < 16 + wide);
    // (counted on its new line only once clearly ahead: one level with us gives way to us instead,
    // except a car committed to merging from the pits, which no longer gives way)
    if (near(o.d) || (jd !== o.d && (ds > JOIN_AHEAD_PX || o.ai.merging) && near(jd))) {
      if (ds < gap) {
        gap = ds;
        ahead = o;
      }
    }
  }
  // (round a standing car only by goAround: a lane next to it can be too close to pass)
  const stop = ahead !== null && standing(view, car, ahead);
  if (ahead && stop && goAround(car, view, plan, ahead, gap)) return;
  if (ahead && ahead.speed < plan.target) {
    let changed = false;
    const blockedHard = !stop && ahead.speed < 60 && car.speed - ahead.speed > 15;
    const eager = ahead.speed < plan.target - ai.persona.passMph;
    // (on the free line a pass moves the line across instead: passTarget)
    const canChange =
      !plan.free && !stop && ai.laneCooldown <= 0 && ai.pitPhase === 'none' && (blockedHard || (eager && laneChangeOk && car.speed > 50));
    if (canChange) {
      const options = LANES.filter((l) => l !== plan.laneD && Math.abs(l - plan.laneD) < 25).sort(
        (p, q) => Math.abs(p - car.d) - Math.abs(q - car.d),
      );
      for (const ln of options) {
        if (laneFree(track, car, ln, view.cars)) {
          ai.lane = plan.laneD = ln;
          ai.laneCooldown = 1.2;
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      // (behind a standing car it stops where that one stops, further back: with room to steer round it
      // once a lane is free)
      const wait = stop ? (nearestPass(view, car, ahead)?.room ?? 0) + 6 : 0;
      const room = Math.max(0, gap + (stop ? stopDist(ahead) : 0) - Math.max(46 + ai.persona.gapPx, wait));
      const v0 = stop ? 0 : Math.max(0, ahead.speed);
      const follow = Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm) - (gap < 42 ? 4 : 0);
      plan.target = Math.min(plan.target, Math.max(0, follow));
    }
  }
}

/**
 * A car standing (or crawling) on the track, in line with it: one to drive around, never to queue behind.
 * Pit traffic is left to the pit logic, and a spun or crossways car to avoidHazards.
 */
function standing(view: AiView, car: Car, o: Car): boolean {
  if (view.time <= AROUND_GRACE_S || car.ai.pitPhase !== 'none' || o.ai.pitPhase !== 'none' || !onTrack(view.track, car, o)) return false;
  if (o.spinTime > 0 || Math.abs(wrapAngle(view.track.headingAt(o.x, o.y) - o.heading)) > AROUND_ALIGNED_RAD) return false;
  if (Math.abs(o.speed) < AROUND_STOPPED_MPH) return true;
  // (or braking towards a stop on a straight, with no bend it could be braking for; a car crawling round
  // another one is not braking, and is followed. A player at the wheel can stop anywhere: from higher up,
  // unless it is braking for a car ahead of it)
  const curves = view.track.curves();
  const human = o.isPlayer && view.playerDriving === true;
  if (!o.braking || o.speed >= (human ? AROUND_PLAYER_STOPPING_MPH : AROUND_STOPPING_MPH)) return false;
  if (curves.at(o.s) !== 0 || curves.maxAbsAhead(o.s, stopDist(o) + LANE_CHANGE_CLEAR, 8) !== 0) return false;
  return o.speed < AROUND_STOPPING_MPH || !view.cars.some((c) => c !== o && inWayAhead(view.track, o, c));
}

/** `c` is slower than `o` and ahead of it within its braking distance, near its line: something `o` may be braking for. */
function inWayAhead(track: Track, o: Car, c: Car): boolean {
  const ds = track.deltaS(o.s, c.s);
  return c.speed < o.speed && ds > 0 && ds < stopDist(o) + LANE_CHANGE_CLEAR && Math.abs(c.d - o.d) < AROUND_CLEAR_PX;
}

/** How far (px) a braking car still runs before it stops (at the hard braking rate). */
function stopDist(o: Car): number {
  return o.braking ? (Math.max(0, o.speed) ** 2 * CONFIG.PX_PER_MPH) / (2 * CONFIG.BRAKE_MPH_S_HIGH) : 0;
}

/**
 * A standing car ahead on our line: pass it AROUND_CLEAR_PX across from it, on the side the car is already
 * heading for, else the side it gets to soonest whose way across is free of moving cars, slow enough until
 * across to get there before reaching it. False when no side is free or there is no room left to get
 * across: then it follows (waits further back), and watchStuck backs it out if it is already too close.
 */
function goAround(car: Car, view: AiView, plan: Plan, o: Car, gap: number): boolean {
  const ai = car.ai;
  if (ai.pitPhase !== 'none') return false;
  const chosen = aroundSide(ai, o);
  // (where it will stand: a car braking to a stop still runs on)
  const reach = gap + stopDist(o) - CONFIG.CAR_LEN;
  // (a pass already under way carries on, slower, a little short of the room)
  const room = (p: { side: number; need: number }) => reach - p.need * AROUND_SLOPE + (p.side === chosen ? AROUND_COMMIT_PX : 0);
  const pass = passes(view, car, o)
    .filter((p) => room(p) >= 0)
    .sort((p, q) => Number(p.side !== chosen) - Number(q.side !== chosen) || p.need - q.need)
    .find((p) => p.side === chosen || laneFree(view.track, car, p.d, view.cars, 55, o));
  if (!pass) return false;
  if (pass.side !== chosen) ai.laneCooldown = Math.max(ai.laneCooldown, 1.2);
  ai.lane = sideLane(o, pass.side, pass.d);
  plan.laneD = pass.d;
  ai.blockLane = null;
  if (pass.need > 0) {
    plan.look = AROUND_LOOK_PX;
    const left = Math.max(0, reach - pass.need * AROUND_SLOPE);
    const v = left > 0 ? Math.sqrt(AROUND_MPH ** 2 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * left) / CONFIG.PX_PER_MPH) : AROUND_CRAWL_MPH;
    plan.target = Math.min(plan.target, v);
  }
  return true;
}

/**
 * The ways past a standing car `o`: per side, the d of the pass (AROUND_CLEAR_PX across, inside the road and
 * clear of every other standing car near it) and how far (px) across the car still has to move to get there.
 */
function passes(view: AiView, car: Car, o: Car): { side: number; d: number; need: number }[] {
  const edge = HALF_W - CONFIG.CAR_WID / 2 - AROUND_EDGE_PX;
  const clear = AROUND_CLEAR_PX - 2;
  const out: { side: number; d: number; need: number }[] = [];
  for (const side of [-1, 1]) {
    const d = Math.max(-edge, Math.min(edge, o.d + side * AROUND_CLEAR_PX));
    if (Math.abs(d - o.d) < clear || !aroundClear(view, car, o, d)) continue;
    out.push({ side, d, need: Math.max(0, clear - (car.d - o.d) * side) });
  }
  return out;
}

/** The side of `o` (-1 / 1) the car's lane is on, 0 if the lane is not clear of it. */
function aroundSide(ai: Car['ai'], o: Car): number {
  return Math.abs(ai.lane - o.d) >= AROUND_CLEAR_PX / 2 ? Math.sign(ai.lane - o.d) : 0;
}

/** ai.lane remembers the side of a pass: the lane on that side of `o` nearest to the pass. */
function sideLane(o: Car, side: number, d: number): number {
  return LANES.filter((l) => Math.sign(l - o.d) === side).sort((p, q) => Math.abs(p - d) - Math.abs(q - d))[0] ?? nearestLane(d);
}

/**
 * A pass at d is AROUND_CLEAR_PX across from every other car standing still ahead of us near `o` too (one
 * still moving, as a car slowing to pass it, is followed instead).
 */
function aroundClear(view: AiView, car: Car, o: Car, d: number): boolean {
  const track = view.track;
  return !view.cars.some(
    (c) =>
      c !== o &&
      Math.abs(c.speed) < AROUND_STOPPED_MPH &&
      track.deltaS(car.s, c.s) > 0 &&
      Math.abs(track.deltaS(o.s, c.s)) < AROUND_QUEUE_PX &&
      Math.abs(d - c.d) < AROUND_CLEAR_PX - 2 &&
      onTrack(track, car, c),
  );
}

/** The quickest pass round `o` (null if there is none), and the gap (px, centre to centre) it needs behind `o` to get across. */
function nearestPass(view: AiView, car: Car, o: Car): { side: number; d: number; room: number } | null {
  const best = passes(view, car, o).sort((p, q) => p.need - q.need)[0];
  return best ? { side: best.side, d: best.d, room: CONFIG.CAR_LEN + best.need * AROUND_SLOPE } : null;
}

/** Rubbing side by side: move away from the other car and let it by if it is ahead. */
function avoidSideRub(car: Car, view: AiView, plan: Plan): void {
  const ai = car.ai;
  const track = view.track;
  const rub = sideRubber(track, car, view.cars);
  if (!rub) return;
  const away = Math.sign(car.d - rub.car.d) || (car.id < rub.car.id ? -1 : 1);
  // (lanes beyond the one it is on: in a long bend the pursuit of a lane runs well inside it, so a lane
  // a little away from where the car is can still be the one the other car is on)
  const options = LANES.filter((l) => (l - car.d) * away > 3 && (l - ai.lane) * away > 3).sort(
    (p, q) => Math.abs(p - car.d) - Math.abs(q - car.d),
  );
  // (moving across in a bend can mean braking for a tighter lane: a car behind on it needs more room)
  const back = track.curves().at(car.s) !== 0 ? RUB_BACK_BEND_PX : 55;
  const free = options.find((l) => laneFree(track, car, l, view.cars, back)) ?? (car.contactPrev > 0 ? options[0] : undefined);
  if (free !== undefined) {
    ai.lane = plan.laneD = free;
    ai.laneCooldown = 1;
  }
  if (free === undefined || rub.ds > 0) {
    if (rub.ds >= 0) plan.target = Math.min(plan.target, Math.max(0, rub.car.speed - 6));
  }
}

/** The speed target: the corner plan on top of everything above, the start and the finish. */
function paceTarget(car: Car, view: AiView, plan: Plan, dt: number): void {
  const ai = car.ai;
  const dPlan = ai.pitPhase === 'none' ? plan.laneD : car.d;
  const slideGrip = ai.slide === 1 || ai.slide === 2 ? SLIDE_GRIP : 1;
  const lane = () => planSpeed(view.track.curves(), car.s, car.d, dPlan, gripFrac(car), car.speed, ai.persona.brake);
  let corner = plan.line
    ? planLineSpeed(racingLine(view.track), car.s, lineUse(car), gripFrac(car) * slideGrip, car.speed, ai.persona.brake)
    : lane();
  // (the free line moved across: no faster than on a lane there either)
  if (plan.free && Math.abs(plan.lineShift) > FREE_PLAN_PX) corner = Math.min(corner, lane());
  plan.target = Math.min(plan.target, corner);

  if (ai.creepTime > 0) {
    ai.creepTime -= dt;
    plan.target = Math.max(plan.target, 12);
  }

  if (ai.economy) plan.target = Math.min(plan.target, ai.topMph - CONFIG.AI_ECO.MPH);
  if (!view.started || view.time < ai.reaction) plan.target = 0;
  if (car.finished) plan.target = Math.min(plan.target, CONFIG.AI_FINISHED_MPH);
}

/** Steer for a point ahead on the planned line, gas / brake for the target, within the grip. */
function steerAndPedals(car: Car, track: Track, pitLane: number | null, plan: Plan, out: DriveInput): void {
  const pxm = CONFIG.PX_PER_MPH;
  const look = plan.look ?? 40 + Math.max(0, car.speed) * pxm * 0.22;
  let tx: number;
  let ty: number;
  if (pitLane !== null) {
    const a = track.pit.aim(car, pitLane, look);
    tx = a.x;
    ty = a.y;
  } else {
    const p = track.pointAt(car.s + look, plan.laneD);
    tx = p.x;
    ty = p.y;
  }
  const diff = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.heading);
  out.steer = plan.line ? lineSteer(car, track, plan.steerShift) : Math.max(-1, Math.min(1, diff * 5));
  // (off the line, wide or held off it by a car alongside: no gas until back on it)
  // (on the free line only at speed: a car stopped wide of its line, at the wall, drives back to it)
  const wide = (!plan.free || car.speed > FREE_HELD_MPH) && runningWide(car, track, plan.lineShift);
  out.gas = car.speed < plan.target - 0.5 && !(plan.line && (plan.held || wide));
  out.brake = car.speed > plan.target + 1.5;
  if (car.speed > 0 && !car.reverse) {
    // A smooth driver never asks the tyres for more than they have left after braking.
    const v = car.speed * pxm;
    const G = CONFIG.GRIP;
    const fLong = out.brake ? brakeAt(car.speed) / CONFIG.BRAKE_MPH_S_HIGH : 0;
    const ellipse = Math.sqrt(1 - (G.FC_K * fLong) ** 2);
    const faded = gripAt(v) * ellipse;
    // (in a turn-in slide it asks for more: over the faded grip, towards the full grip)
    const mu = car.ai.slide === 2 ? faded + SLIDE_REACH * (G.GRIP * ellipse - faded) : faded;
    const cap = Math.min(1, mu / (v * v * maxCurvature(v)));
    out.steer = catchSlide(car, cap) ?? Math.max(-cap, Math.min(cap, out.steer));
  }
}

/**
 * Turn-in slide. Now and then (the personality's chance, scaled by the difficulty; one decision per corner,
 * made on the straight before it, from a hash, not the race RNG) the driver plans the next corner at
 * SLIDE_GRIP x its grip fraction: it arrives faster than the faded grip allows, and on the line its
 * steering asks for more, up to SLIDE_REACH of the grip the fade took away (steerAndPedals). The car slides
 * in (physics.ts lateralBudget) and the rear steps out; at SLIDE_CATCH_RAD of slip the driver countersteers
 * until the rear is back in line. Only on the racing line with no car alongside.
 */
function planSlide(car: Car, track: Track, plan: Plan, dt: number): void {
  const ai = car.ai;
  const k = track.curves().at(car.s);
  ai.slideTime += dt;
  const slip = wrapAngle(car.heading - car.moveAngle) * ai.slideDir;
  if (ai.slide === 0 || ai.slide === 3) {
    if (ai.slide === 3 && (slip < SLIDE_DONE_RAD || ai.slideTime > SLIDE_CATCH_S)) ai.slide = 0;
    if (k !== 0) {
      ai.slideRun = -1;
      return;
    }
    if (ai.slideRun >= 0 || ai.slide !== 0) return;
    // (on the straight before a corner: one roll for it)
    ai.slideRun = car.s;
    const lap = Math.floor(car.sectorsPassed / NUM_SECTORS);
    const roll = hash01(Math.floor(ai.temper * 2 ** 30), lap, Math.floor(car.s / 64));
    // (only into a corner fast enough for the grip to have faded: under the knee there is nothing to slide on)
    if (roll < ai.persona.slide * ai.level.slide && nextLineCornerMph(car, track) > SLIDE_MIN_MPH) ai.slide = 1;
    return;
  }
  if (!plan.line || plan.held || Math.abs(plan.lineShift) > (plan.free ? FREE_PLAN_PX : 0)) {
    ai.slide = 0;
    return;
  }
  if (ai.slide === 1 && k !== 0) {
    ai.slide = 2;
    ai.slideDir = Math.sign(k);
    ai.slideTime = 0;
  } else if (ai.slide === 2 && (k === 0 || slip > SLIDE_CATCH_RAD)) {
    ai.slide = 3;
    ai.slideTime = 0;
  }
}

/** The racing line's grip-limited speed (mph) in the next corner ahead of the car, at its grip fraction. */
function nextLineCornerMph(car: Car, track: Track): number {
  const line = racingLine(track);
  let best: { ds: number; k: number } | null = null;
  for (const z of line.zones(lineUse(car))) {
    const ds = (((z.start - car.s) % line.len) + line.len) % line.len;
    if (!best || ds < best.ds) best = { ds, k: z.k };
  }
  return best ? limitMph(best.k, gripFrac(car)) : Infinity;
}

/** Catching a turn-in slide: a countersteer while the slip is over the physics' slide threshold, else null. */
function catchSlide(car: Car, cap: number): number | null {
  const ai = car.ai;
  if (ai.slide !== 3) return null;
  const slip = wrapAngle(car.heading - car.moveAngle) * ai.slideDir;
  return slip > SLIDE_COUNTER_RAD ? -ai.slideDir * Math.min(cap, (slip - SLIDE_DONE_RAD) * SLIDE_COUNTER_GAIN) : null;
}

/**
 * Blocker: with a car close behind before a corner, move to the inside lane once and hold it through the
 * corner (planned as a lane, so slower than the racing line). No weaving: one move, and no following the
 * attacker; anything else that picks a lane (traffic, oil, a hazard, the pits) ends the block.
 */
function blockInside(car: Car, view: AiView, plan: Plan, diving: boolean): void {
  const ai = car.ai;
  const track = view.track;
  const curves = track.curves();
  if (ai.blockLane !== null) {
    const inCorner = curves.at(car.s) !== 0;
    if (inCorner) ai.blockIn = true;
    const done = ai.blockIn && !inCorner;
    if (done || ai.lane !== ai.blockLane || ai.pitPhase !== 'none' || plan.oilLane || ai.hazardTime > 0) {
      ai.blockLane = null;
      ai.blockIn = false;
    } else plan.laneD = ai.blockLane;
    return;
  }
  if (!ai.persona.blocks || ai.pitPhase !== 'none' || diving || plan.oilLane || ai.hazardTime > 0 || ai.laneCooldown > 0) return;
  // (before the corner, with room to move across before the turn-in)
  const k = nextCurve(curves, car.s, BLOCK_LOOK_PX);
  if (k === 0 || curves.maxAbsAhead(car.s, BLOCK_MIN_PX, 8) !== 0) return;
  const attacker = view.cars.some((o) => {
    if (!onTrack(track, car, o)) return false;
    const ds = track.deltaS(car.s, o.s);
    return ds > -BLOCK_BEHIND_PX && ds < -CONFIG.CAR_LEN * 0.6 && o.speed > car.speed - BLOCK_CLOSING_MPH;
  });
  if (!attacker) return;
  const inside = k > 0 ? LANES[LANES.length - 1]! : LANES[0]!;
  // (the way across must be clear; the attacker, in line behind, is not in the way)
  const across = Math.sign(inside - car.d);
  const inWay = view.cars.some((o) => {
    if (!onTrack(track, car, o)) return false;
    const ds = track.deltaS(car.s, o.s);
    return ds > -BLOCK_SIDE_BACK_PX && ds < BLOCK_SIDE_FRONT_PX && (o.d - car.d) * across > LINE_INLINE_PX;
  });
  if (inWay) return;
  ai.lane = plan.laneD = ai.blockLane = inside;
  ai.blockIn = false;
  leaveLine(car, plan);
}

/** The signed curvature of the first bend within `look` px ahead of s (0 if none). */
function nextCurve(curves: CurvatureTable, s: number, look: number): number {
  for (let ds = 0; ds <= look; ds += 8) {
    const k = curves.at(s + ds);
    if (k !== 0) return k;
  }
  return 0;
}

/**
 * Steering on the racing line: its curvature ahead, plus feedback on the distance off it and the angle
 * to it (the pursuit of a lane would cut the corner by more than the line leaves to the inside wall).
 */
function lineSteer(car: Car, track: Track, shift: number): number {
  const line = racingLine(track);
  const use = lineUse(car);
  const v = Math.max(1, car.speed * CONFIG.PX_PER_MPH);
  const d = line.d(car.s, use);
  // (the line's heading from two of its points: inside a tight arc the road's frame is squeezed)
  const p = track.pointAt(car.s, d);
  const q = track.pointAt(car.s + LINE_SLOPE_PX, line.d(car.s + LINE_SLOPE_PX, use));
  const psi = wrapAngle(car.moveAngle - Math.atan2(q.y - p.y, q.x - p.x));
  const w = LINE_STEER_W;
  const kWant = line.k(car.s + v * 0.03, use) - (w / v) ** 2 * (car.d - d - shift) - ((2 * 0.8 * w) / v) * psi;
  return Math.max(-1, Math.min(1, kWant / maxCurvature(v)));
}

/** On the racing line in a corner, further out than the line: lift until the car is back on it. */
function runningWide(car: Car, track: Track, shift: number): boolean {
  const line = racingLine(track);
  const use = lineUse(car);
  const k = line.k(car.s, use);
  return k !== 0 && -Math.sign(k) * (car.d - line.d(car.s, use) - shift) > LINE_WIDE_PX;
}

/** Backing out after getting stuck (see watchStuck); true while recovering (the input is set). */
function recover(car: Car, view: AiView, out: DriveInput, dt: number): boolean {
  const ai = car.ai;
  const track = view.track;
  if (ai.recoverTime <= 0) return false;
  ai.recoverTime -= dt;
  const aim = Math.sign(ai.lane - car.d) * 0.35;
  const herr = wrapAngle(track.headingAt(car.x, car.y) + aim - car.heading);
  if (!car.reverse) out.toggleReverse = Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH;
  out.steer = -Math.max(-1, Math.min(1, herr * 3));
  const tailFree = !tailBlocked(car, view.cars);
  out.gas = tailFree && ai.recoverTime > 0.3 && car.speed > -AI_RECOVER_MPH;
  out.brake = !out.gas;
  if (!tailFree) ai.recoverTime = Math.min(ai.recoverTime, 0.3);
  return true;
}

/** A car standing still while racing: plan a reverse-out and a creep, or just a creep. */
function watchStuck(car: Car, view: AiView, dt: number): void {
  const ai = car.ai;
  const track = view.track;
  const servicing = ai.pitPhase === 'fueling' || ai.pitPhase === 'parked';
  const herr = wrapAngle(track.headingAt(car.x, car.y) - car.heading);
  const misaligned = Math.abs(herr) > (car.contactPrev > 0 ? 0.35 : 0.7);
  if (view.started && !servicing && car.spinTime <= 0 && Math.abs(car.speed) < 4 && !car.finished) {
    ai.stuckTime += dt;
    // (right behind a standing car, with no room to steer round it: back out first)
    const nose = noseBlocked(car, view.cars);
    const back = misaligned || nose ? null : backOut(car, view);
    if (ai.stuckTime > 0.8 && (misaligned || nose || back)) {
      // (backing out from a standing car keeps the side it will pass on)
      ai.lane = back ? back.lane : bestLane(track, car, view.cars);
      ai.laneCooldown = 2;
      if (!tailBlocked(car, view.cars)) ai.recoverTime = misaligned ? 1.1 : back ? back.time : 0.7;
      // (no creep into a standing car it is backing away from: goAround drives on once there is room)
      ai.creepTime = back ? 0 : 2.5;
      ai.stuckTime = 0;
    } else if (ai.stuckTime > 4 && ai.pitPhase !== 'exiting') {
      ai.creepTime = 2;
      ai.stuckTime = 0;
    }
  } else {
    ai.stuckTime = 0;
  }
}

/** Right behind a standing car with no room to get round it: how long (s) to back out, and the lane on the side to pass; null if not. */
function backOut(car: Car, view: AiView): { time: number; lane: number } | null {
  let worst: { short: number; lane: number } | null = null;
  for (const o of view.cars) {
    const ds = view.track.deltaS(car.s, o.s);
    if (o === car || ds <= 0 || !standing(view, car, o)) continue;
    const pass = nearestPass(view, car, o);
    if (pass && pass.room > ds && (!worst || pass.room - ds > worst.short))
      worst = { short: pass.room - ds, lane: sideLane(o, pass.side, pass.d) };
  }
  if (!worst) return null;
  // (reversing gets to AI_RECOVER_MPH in about half a second; it backs out AROUND_BACK_OUT_PX more than it needs)
  const time = Math.min(AROUND_BACK_OUT_MAX_S, 0.8 + (worst.short + AROUND_BACK_OUT_PX) / (AI_RECOVER_MPH * CONFIG.PX_PER_MPH));
  return { time, lane: worst.lane };
}

function isHazard(track: Track, o: Car, me: Car): boolean {
  if (o.spinTime > 0) return true;
  if (isServicing(o)) return false;
  if (o.speed < 40 && me.speed - o.speed > 40) return true;
  return Math.abs(o.speed) < 60 && Math.abs(wrapAngle(track.headingAt(o.x, o.y) - o.heading)) > 0.6;
}

const AI_RECOVER_MPH = 10;
/** avoidSideRub in a bend: the lane it moves to must be free this far behind (px). */
const RUB_BACK_BEND_PX = 100;

/** Turn-in slide (planSlide): the corner planned at SLIDE_GRIP x the grip fraction, the steering reaching SLIDE_REACH of the faded-away grip. */
const SLIDE_GRIP = 1.25;
const SLIDE_REACH = 0.6;
/** Only into a corner whose line the driver takes faster than this (mph). */
const SLIDE_MIN_MPH = 145;
/** Catches the slide at this slip (rad); countersteers over SLIDE_COUNTER_RAD; done under SLIDE_DONE_RAD or after SLIDE_CATCH_S. */
const SLIDE_CATCH_RAD = 0.12;
const SLIDE_COUNTER_RAD = 0.09;
const SLIDE_DONE_RAD = 0.04;
const SLIDE_COUNTER_GAIN = 6;
const SLIDE_CATCH_S = 1;
/** Blocker (blockInside): an attacker this close behind (px) and no more than BLOCK_CLOSING_MPH slower. */
const BLOCK_BEHIND_PX = 80;
const BLOCK_CLOSING_MPH = 5;
/** It moves for a bend this far ahead (px), but not once one is closer than BLOCK_MIN_PX. */
const BLOCK_LOOK_PX = 420;
const BLOCK_MIN_PX = 120;
/** A car this far behind / ahead (px), and across towards the inside, keeps it from moving. */
const BLOCK_SIDE_BACK_PX = 60;
const BLOCK_SIDE_FRONT_PX = 90;

/**
 * Driving around a standing car (goAround): a car under AROUND_STOPPED_MPH, or braking under AROUND_STOPPING_MPH,
 * once AROUND_GRACE_S into the race (not the grid).
 */
const AROUND_STOPPED_MPH = 10;
const AROUND_STOPPING_MPH = 60;
/** The player's car, at the wheel, counts as braking to a stop from under this (mph). */
const AROUND_PLAYER_STOPPING_MPH = 90;
const AROUND_GRACE_S = 5;
/** ...and heading along the track within this (rad). */
const AROUND_ALIGNED_RAD = 0.35;
/** The lane passes this far across (px) from it, and from any standing car within AROUND_QUEUE_PX along. */
const AROUND_CLEAR_PX = 22;
const AROUND_QUEUE_PX = 120;
/** Until across: px along per px across, at no more than AROUND_MPH when it gets there. */
const AROUND_SLOPE = 2;
const AROUND_MPH = 25;
/** A pass under way carries on up to this far (px) short of that room, at AROUND_CRAWL_MPH. */
const AROUND_COMMIT_PX = 14;
const AROUND_CRAWL_MPH = 10;
/** Until across, the steering looks this far ahead (px): a sharp move out, at the slow AROUND_MPH. */
const AROUND_LOOK_PX = 20;
/** A car coming up behind on the lane needs this long (s) at the closing speed. */
const AROUND_BEHIND_S = 0.8;
/** The pass keeps this far (px) off the edge of the road. */
const AROUND_EDGE_PX = 3;
/** Backing out from one: this far (px) beyond the room it needs, for no longer than AROUND_BACK_OUT_MAX_S. */
const AROUND_BACK_OUT_PX = 12;
const AROUND_BACK_OUT_MAX_S = 3;

const LANE_CHANGE_CLEAR = 160;
/**
 * Racing line: no other car this far behind / ahead (px) to stay on it, and to join it. A car behind does
 * not push a car off the line (it follows); one alongside or just ahead does.
 */
const LINE_KEEP = { back: 25, front: 70 };
const LINE_JOIN = { back: 60, front: 110 };
/** holdOff: cars closer than this along (px) overlap ours; it keeps LINE_GAP_PX across from them, but not from one in line (within LINE_INLINE_PX across). */
const LINE_OVERLAP_PX = 50;
/** A car this much slower (mph) takes us off the line from its braking distance away. */
const LINE_SLOWER_MPH = 20;
const LINE_GAP_PX = 22;
const LINE_INLINE_PX = 12;
/** A car on a lane joins the line where it is this close (px), or on a straight. */
const LINE_JOIN_PX = 6;
const LINE_SLOPE_PX = 6;
/** On the line in a corner, lift once this far (px) outside it. */
const LINE_WIDE_PX = 2;
/** rad/s: how fast the line steering pulls the car back onto the line. */
const LINE_STEER_W = 4;
/**
 * Free line (hard): moves across at FREE_SHIFT_PX_S and keeps FREE_EDGE_PX off the edge of the road. A pass
 * goes FREE_PASS_GAP_PX across from the car, of a car within FREE_PATH_PX of our line, at least
 * FREE_PASS_MIN_PX ahead; it is over FREE_PASS_DONE_PX past it, and needs FREE_BACK_S of straight ahead to
 * get back to the line. A car further than FREE_LEVEL_PX ahead holding us off cuts the gas; moved more than
 * FREE_PLAN_PX across, the corner is planned as on a lane too.
 */
const FREE_SHIFT_PX_S = 50;
const FREE_EDGE_PX = 3;
const FREE_EDGE_D = HALF_W - CONFIG.CAR_WID / 2 - FREE_EDGE_PX;
const FREE_PASS_GAP_PX = 24;
const FREE_PATH_PX = 18;
const FREE_PASS_MIN_PX = 110;
const FREE_PASS_DONE_PX = 10;
const FREE_BACK_S = 0.8;
const FREE_LEVEL_PX = 8;
const FREE_PLAN_PX = 3;
/** Under this speed (mph) a car held off by one ahead of it, or wide of its line, keeps the gas on. */
const FREE_HELD_MPH = 40;
/** A pair in a corner (cornerPair): a car alongside within FREE_PAIR_GAP_PX across, a bend within FREE_PAIR_S; the other yields by FREE_YIELD_MPH. */
const FREE_PAIR_GAP_PX = 40;
const FREE_PAIR_S = 1;
const FREE_YIELD_MPH = 4;
/** Extra lateral reach (px) of the follow logic for a car 60+ mph slower. */
const FOLLOW_WIDE_PX = 8;
/** A car moving to a new line (pit entry or exit) counts there for cars this far behind it or more. */
const JOIN_AHEAD_PX = 30;

function sideRubber(track: Track, car: Car, cars: Car[]): { car: Car; ds: number } | null {
  let best: { car: Car; ds: number } | null = null;
  for (const o of cars) {
    if (o === car || o.spinTime > 0) continue;
    const ds = track.deltaS(car.s, o.s);
    if (Math.abs(ds) > 40) continue;
    const dd = Math.abs(o.d - car.d);
    const touching = car.contactPrev > 0 && Math.hypot(o.x - car.contactX, o.y - car.contactY) < 30;
    if (dd < 16 || (touching && dd < 22)) {
      if (!best || Math.abs(ds) < Math.abs(best.ds)) best = { car: o, ds };
    }
  }
  return best;
}

function sideClear(track: Track, car: Car, lane: number, cars: Car[]): boolean {
  if (Math.abs(lane - car.d) < 8) return true;
  const lo = Math.min(car.d, lane) - 12;
  const hi = Math.max(car.d, lane) + 12;
  return cars.every((o) => {
    if (o === car) return true;
    const ds = track.deltaS(car.s, o.s);
    return !(ds > -40 && ds < 50 && o.d > lo && o.d < hi);
  });
}

function bestLane(track: Track, car: Car, cars: Car[]): number {
  const near = cars.filter((o) => {
    if (o === car) return false;
    const ds = track.deltaS(car.s, o.s);
    return ds > -10 && ds < 70;
  });
  if (near.length === 0) return car.ai.lane;
  return [...LANES].sort((p, q) => clearance(q, near) - clearance(p, near))[0]!;
}

function clearance(lane: number, hazards: Car[]): number {
  return Math.min(...hazards.map((h) => Math.abs(h.d - lane)));
}

function tailBlocked(car: Car, cars: Car[]): boolean {
  const bx = car.x - Math.cos(car.heading) * 24;
  const by = car.y - Math.sin(car.heading) * 24;
  return cars.some((o) => o !== car && Math.hypot(o.x - bx, o.y - by) < 18);
}

function noseBlocked(car: Car, cars: Car[]): boolean {
  const fx = car.x + Math.cos(car.heading) * 24;
  const fy = car.y + Math.sin(car.heading) * 24;
  return cars.some((o) => o !== car && Math.hypot(o.x - fx, o.y - fy) < 16);
}
