import { CONFIG } from '../config';
import { LANES, type Track, wrapAngle } from '../track/common';
import { PIT_FUEL_MARGIN_LAPS } from '../track/pitAi';
import { type Car, isServicing } from './car';
import { canSaveToFinish, lapsOfFuel, lapsToFinish } from './fuel';
import { type OilSlick, oilRadius } from './oil';
import { brakeAt, type DriveInput, gripAt, maxCurvature } from './physics';
import { gripFrac, planSpeed } from './planner';

export interface AiView {
  track: Track;
  cars: Car[];
  started: boolean;
  laps: number;
  time: number;
  oil?: readonly OilSlick[];
  /** The player's car is under the pit autopilot (it merges by hand after the hand-back). */
  pitAuto?: boolean;
}

function laneFree(track: Track, car: Car, lane: number, cars: Car[]): boolean {
  const lo = Math.min(car.d, lane) - 14;
  const hi = Math.max(car.d, lane) + 14;
  const back = car.speed < 30 ? -25 : -55;
  const front = car.speed < 30 ? 50 : 90;
  for (const o of cars) {
    if (o === car) continue;
    const ds = track.deltaS(car.s, o.s);
    if (ds > back && ds < front && o.d > lo && o.d < hi) return false;
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
  const plan: Plan = { target: pit.target, laneD: pit.laneD, oilLane: false };

  if (pit.lane !== null) {
    track.pit.follow(car, view, pit);
    plan.target = pit.target;
  } else {
    // A car already diving for the pit entry stays on its line (it only slows for oil and
    // hazards); a lane change there would make it miss the pit road.
    const diving = track.pit.diving(car);
    avoidOil(car, view, plan, dt, diving);
    avoidHazards(car, view, plan, dt, diving);
    followTraffic(car, view, plan);
  }
  if (pit.lane === null && ai.pitPhase === 'none' && !plan.oilLane) avoidSideRub(car, view, plan);
  paceTarget(car, view, plan, dt);
  steerAndPedals(car, track, pit.lane, plan, out);
  if (recover(car, view, out, dt)) return out;
  watchStuck(car, view, dt);
  return out;
}

/** What one step of the AI is aiming for: a speed and a line (d), and whether that line dodges oil. */
interface Plan {
  target: number;
  laneD: number;
  oilLane: boolean;
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
  // Lane changes wait until no curvature is close ahead.
  const laneChangeOk = !turnNow && curves.maxAbsAhead(car.s, LANE_CHANGE_CLEAR, 8) === 0;
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
  if (ahead && ahead.speed < plan.target) {
    let changed = false;
    const blockedHard = ahead.speed < 60 && car.speed - ahead.speed > 15;
    const canChange = ai.laneCooldown <= 0 && ai.pitPhase === 'none' && (blockedHard || (laneChangeOk && car.speed > 50));
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
      const room = Math.max(0, gap - 46);
      const v0 = Math.max(0, ahead.speed);
      const follow = Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm) - (gap < 42 ? 4 : 0);
      plan.target = Math.min(plan.target, Math.max(0, follow));
    }
  }
}

/** Rubbing side by side: move away from the other car and let it by if it is ahead. */
function avoidSideRub(car: Car, view: AiView, plan: Plan): void {
  const ai = car.ai;
  const track = view.track;
  const rub = sideRubber(track, car, view.cars);
  if (!rub) return;
  const away = Math.sign(car.d - rub.car.d) || (car.id < rub.car.id ? -1 : 1);
  const options = LANES.filter((l) => (l - car.d) * away > 3).sort((p, q) => Math.abs(p - car.d) - Math.abs(q - car.d));
  const free = options.find((l) => laneFree(track, car, l, view.cars)) ?? (car.contactPrev > 0 ? options[0] : undefined);
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
  plan.target = Math.min(plan.target, planSpeed(view.track.curves(), car.s, car.d, dPlan, gripFrac(car), car.speed));

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
  const look = 40 + Math.max(0, car.speed) * pxm * 0.22;
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
  out.steer = Math.max(-1, Math.min(1, diff * 5));
  out.gas = car.speed < plan.target - 0.5;
  out.brake = car.speed > plan.target + 1.5;
  if (car.speed > 0 && !car.reverse) {
    // A smooth driver never asks the tyres for more than they have left after braking.
    const v = car.speed * pxm;
    const G = CONFIG.GRIP;
    const fLong = out.brake ? brakeAt(car.speed) / CONFIG.BRAKE_MPH_S_HIGH : 0;
    const mu = gripAt(v) * Math.sqrt(1 - (G.FC_K * fLong) ** 2);
    const cap = Math.min(1, mu / (v * v * maxCurvature(v)));
    out.steer = Math.max(-cap, Math.min(cap, out.steer));
  }
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
    const blocked = noseBlocked(car, view.cars);
    if (ai.stuckTime > 0.8 && (misaligned || blocked)) {
      ai.lane = bestLane(track, car, view.cars);
      ai.laneCooldown = 2;
      if (!tailBlocked(car, view.cars)) ai.recoverTime = misaligned ? 1.1 : 0.7;
      ai.creepTime = 2.5;
      ai.stuckTime = 0;
    } else if (ai.stuckTime > 4 && ai.pitPhase !== 'exiting') {
      ai.creepTime = 2;
      ai.stuckTime = 0;
    }
  } else {
    ai.stuckTime = 0;
  }
}

function isHazard(track: Track, o: Car, me: Car): boolean {
  if (o.spinTime > 0) return true;
  if (isServicing(o)) return false;
  if (o.speed < 40 && me.speed - o.speed > 40) return true;
  return Math.abs(o.speed) < 60 && Math.abs(wrapAngle(track.headingAt(o.x, o.y) - o.heading)) > 0.6;
}

const AI_RECOVER_MPH = 10;

const LANE_CHANGE_CLEAR = 160;
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
