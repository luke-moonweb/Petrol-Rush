import { CONFIG } from '../config';
import {
  CX_L,
  CY,
  deltaS,
  HALF_W,
  inPitLane,
  inTurn,
  LANES,
  PIT_BOX_Y,
  PIT_DRIVE_Y,
  BOX_PITCH,
  boxX,
  inPitBox,
  NUM_BOXES,
  TURN_LEN,
  PIT_X0,
  PIT_X1,
  pointAt,
  islandHullR,
  PIT_ROAD_Y,
  RC,
  WALL_X0,
  WALL_X1,
  S_BOTTOM,
  S_TURN1,
  S_TURN2,
  trackHeadingAt,
  wrapAngle,
  wrapS,
} from '../track/track';
import { Car, lapsCompleted } from './car';
import { OilSlick, oilRadius } from './oil';
import { DriveInput } from './physics';

export interface AiView {
  cars: Car[];
  started: boolean;
  laps: number;
  time: number;
  oil?: readonly OilSlick[];
}

function laneFree(car: Car, lane: number, cars: Car[]): boolean {
  const lo = Math.min(car.d, lane) - 14;
  const hi = Math.max(car.d, lane) + 14;
  const back = car.speed < 30 ? -25 : -55;
  const front = car.speed < 30 ? 50 : 90;
  for (const o of cars) {
    if (o === car) continue;
    const ds = deltaS(car.s, o.s);
    if (ds > back && ds < front && o.d > lo && o.d < hi) return false;
    if (Math.abs(ds) < 60 && o.ai.lane === lane && !o.isPlayer && Math.abs(o.d - lane) < 25) return false;
  }
  return true;
}

function pitCarAhead(car: Car, laneY: number, cars: Car[]): { car: Car; gap: number } | null {
  let best: { car: Car; gap: number } | null = null;
  for (const o of cars) {
    if (o === car || !o.pitSide || !inPitLane(o.x, o.y)) continue;
    const dx = o.x - car.x;
    if (dx <= 0 || dx > 150 || Math.abs(o.y - laneY) > 13) continue;
    if (!best || dx < best.gap) best = { car: o, gap: dx };
  }
  return best;
}

function pitDriveLaneBusy(car: Car, cars: Car[]): boolean {
  for (const o of cars) {
    if (o === car || !o.pitSide) continue;
    const dx = o.x - car.x;
    if (dx > -80 && dx < 10 && o.speed > 5 && Math.abs(o.y - PIT_DRIVE_Y) < 8) return true;
  }
  return false;
}

export function aiInput(car: Car, view: AiView, dt: number): DriveInput {
  const out: DriveInput = { steer: 0, gas: false, brake: false, toggleReverse: false };
  const ai = car.ai;
  const pxm = CONFIG.PX_PER_MPH;
  if (car.reverse && ai.recoverTime <= 0) out.toggleReverse = Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH;
  ai.laneCooldown = Math.max(0, ai.laneCooldown - dt);

  const turnNow = inTurn(car.x);
  const distToTurn = turnNow ? 0 : Math.min(wrapS(S_TURN1 - car.s), wrapS(S_TURN2 - car.s));
  let target = ai.topMph;
  let laneD = ai.lane;
  let pitY: number | null = null;
  let oilLane = false;

  if (ai.pitPhase === 'none' && car.s >= S_TURN2 && car.s < S_BOTTOM) {
    const fuelLaps = car.fuel * CONFIG.FUEL_RANGE_LAPS;
    const lapsLeft = view.laps - lapsCompleted(car);
    if (car.finished || (fuelLaps < ai.pitFuelLaps && fuelLaps < lapsLeft + 0.3)) ai.pitPhase = 'entering';
  }

  if (ai.pitPhase === 'none' && car.pitSide && car.wasInPit && car.y > CY && car.x < WALL_X1) ai.pitPhase = 'exiting';

  switch (ai.pitPhase) {
    case 'entering': {
      const onBottom = car.y > CY && car.x >= CX_L && car.x < PIT_X1;
      if (onBottom) {
        target = Math.min(target, CONFIG.AI_PIT_MPH);
        if (car.x >= WALL_X0 && !car.pitSide) {
          ai.pitPhase = 'none';
          break;
        }
        if (car.x < PIT_X0) {
          pitY = PIT_ROAD_Y;
        } else {
          const bx = freeBox(car, view.cars);
          const dist = bx - car.x;
          pitY = dist < 40 ? PIT_BOX_Y : PIT_DRIVE_Y;
          target = Math.min(target, Math.sqrt(Math.max(0, CONFIG.BRAKE_MPH_S * dist) / pxm) * 1.2);
          if (dist < 8 && Math.abs(car.speed) < CONFIG.PIT_STOP_MPH && inPitBox(car.x, car.y)) {
            ai.pitPhase = car.finished ? 'parked' : 'fueling';
          }
        }
      } else {
        laneD = -HALF_W + 9;
        if (car.s > S_TURN2 + TURN_LEN * 0.5) target = Math.min(target, 100);
        if (car.s > S_TURN2 + TURN_LEN * PIT_DIVE_AT) {
          const phi = (Math.atan2(car.y - CY, CX_L - car.x) * 180) / Math.PI;
          laneD = pitPathR(phi + 12) - RC;
          target = Math.min(target, CONFIG.AI_PIT_MPH + 5);
        }
      }
      break;
    }
    case 'fueling':
      pitY = PIT_BOX_Y;
      target = 0;
      if (!inPitLane(car.x, car.y)) ai.pitPhase = car.fuel > 0.6 ? 'exiting' : 'none';
      else if (car.fuel >= 0.999) ai.pitPhase = 'exiting';
      break;
    case 'parked':
      pitY = PIT_BOX_Y;
      target = 0;
      break;
    case 'exiting':
      if (car.x < WALL_X1 && car.y > CY) {
        pitY = PIT_DRIVE_Y;
        target = CONFIG.AI_PIT_MPH;
        if (car.y < PIT_DRIVE_Y - 8 && pitDriveLaneBusy(car, view.cars)) {
          pitY = PIT_BOX_Y;
          target = 0;
        }
      } else {
        laneD = mergeClear(car, LANES[0], view.cars) ? LANES[0] : EXIT_D;
        if (Math.abs(car.d - LANES[0]) < 5 || car.y < CY) {
          ai.pitPhase = 'none';
          ai.lane = LANES[0];
        }
      }
      break;
    default:
      break;
  }

  if (pitY !== null) {
    let ahead = pitCarAhead(car, pitY, view.cars);
    if (ahead && ahead.car.speed < 2 && ahead.gap < 80 && !isServicing(ahead.car)) {
      const other = pitY === PIT_DRIVE_Y ? PIT_BOX_Y : PIT_DRIVE_Y;
      if (!pitCarAhead(car, other, view.cars)) {
        pitY = other;
        ahead = null;
      }
    }
    if (ahead) {
      const v0 = Math.max(0, ahead.car.speed);
      const room = Math.max(0, ahead.gap - 46);
      target = Math.min(target, Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm));
    }
  } else {
    const oil = view.oil ?? [];
    const slicks = oil.filter((o) => {
      const ds = deltaS(car.s, o.s);
      const r = oilRadius(o) + 12;
      return ds > -15 && ds < CONFIG.AI_HAZARD_RANGE && (Math.abs(o.d - laneD) < r || Math.abs(o.d - car.d) < r);
    });
    if (slicks.length > 0) {
      ai.oilTime += dt;
      if (ai.oilTime >= ai.reaction * 0.7) {
        const ahead = oil.filter((o) => {
          const ds = deltaS(car.s, o.s);
          return ds > -25 && ds < CONFIG.AI_HAZARD_RANGE;
        });
        const options = LANES.filter((ln) => ahead.every((o) => Math.abs(o.d - ln) > CONFIG.OIL_RADIUS + 12)).sort(
          (p, q) => Math.abs(p - car.d) - Math.abs(q - car.d),
        );
        const free = options.find((ln) => sideClear(car, ln, view.cars)) ?? options[0];
        const nearest = Math.min(...slicks.map((o) => deltaS(car.s, o.s)));
        if (free !== undefined) {
          ai.lane = laneD = free;
          ai.laneCooldown = 1.5;
          oilLane = true;
          target = Math.min(target, 70 + Math.max(0, nearest) * 0.4);
        } else {
          target = Math.min(target, Math.sqrt((2 * CONFIG.BRAKE_MPH_S * 0.8 * Math.max(0, nearest - 30)) / pxm));
        }
      }
    } else {
      ai.oilTime = 0;
    }

    const hazards = view.cars.filter((o) => {
      if (o === car || !isHazard(o, car)) return false;
      const ds = deltaS(car.s, o.s);
      return ds > 0 && ds < CONFIG.AI_HAZARD_RANGE && (Math.abs(o.d - laneD) < 22 || Math.abs(o.d - car.d) < 20);
    });
    if (hazards.length > 0) {
      ai.hazardTime += dt;
      if (ai.hazardTime >= ai.reaction) {
        const all = view.cars.filter((o) => {
          if (o === car || !isHazard(o, car)) return false;
          const ds = deltaS(car.s, o.s);
          return ds > -20 && ds < CONFIG.AI_HAZARD_RANGE;
        });
        const free = [...LANES]
          .sort((p, q) => Math.abs(p - car.d) - Math.abs(q - car.d))
          .find((ln) => all.every((h) => Math.abs(h.d - ln) > 21) && sideClear(car, ln, view.cars));
        if (free !== undefined && !oilLane) {
          ai.lane = laneD = free;
          ai.laneCooldown = 1.5;
          const nearest = Math.min(...hazards.map((h) => deltaS(car.s, h.s)));
          target = Math.min(target, 45 + nearest * 0.4);
        } else {
          const nearest = Math.min(...hazards.map((h) => deltaS(car.s, h.s)));
          if (ai.hazardTime > ai.reaction + 3 && !oilLane) {
            ai.lane = laneD = [...LANES].sort((p, q) => clearance(q, all) - clearance(p, all))[0];
            target = Math.min(target, 12);
          } else {
            target = Math.min(target, Math.sqrt((2 * CONFIG.BRAKE_MPH_S * 0.7 * Math.max(0, nearest - 45)) / pxm));
          }
        }
      }
    } else {
      ai.hazardTime = 0;
    }

    const vpx = Math.max(0, car.speed) * pxm;
    const range = Math.max(110, (vpx * vpx) / (2 * CONFIG.BRAKE_MPH_S * pxm * 0.8) + 60);
    let ahead: Car | null = null;
    let gap = Infinity;
    for (const o of view.cars) {
      if (o === car) continue;
      const ds = deltaS(car.s, o.s);
      if (ds <= 0 || ds > range) continue;
      if (Math.abs(o.d - car.d) < 17 || (ds > 40 && Math.abs(o.d - laneD) < 16)) {
        if (ds < gap) {
          gap = ds;
          ahead = o;
        }
      }
    }
    if (ahead && ahead.speed < target) {
      let changed = false;
      const blockedHard = ahead.speed < 60 && car.speed - ahead.speed > 15;
      const canChange =
        ai.laneCooldown <= 0 &&
        ai.pitPhase === 'none' &&
        (blockedHard || (!turnNow && car.speed > 50 && distToTurn > 160));
      if (canChange) {
        const options = LANES.filter((l) => l !== laneD && Math.abs(l - laneD) < 25).sort(
          (p, q) => Math.abs(p - car.d) - Math.abs(q - car.d),
        );
        for (const ln of options) {
          if (laneFree(car, ln, view.cars)) {
            ai.lane = laneD = ln;
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
        target = Math.min(target, Math.max(0, follow));
      }
    }
  }

  if (pitY === null && ai.pitPhase === 'none' && !oilLane) {
    const rub = sideRubber(car, view.cars);
    if (rub) {
      const away = Math.sign(car.d - rub.car.d) || (car.id < rub.car.id ? -1 : 1);
      const options = LANES.filter((l) => (l - car.d) * away > 3).sort((p, q) => Math.abs(p - car.d) - Math.abs(q - car.d));
      const free = options.find((l) => laneFree(car, l, view.cars)) ?? (car.contactPrev > 0 ? options[0] : undefined);
      if (free !== undefined) {
        ai.lane = laneD = free;
        ai.laneCooldown = 1;
      }
      if (free === undefined || rub.ds > 0) {
        if (rub.ds >= 0) target = Math.min(target, Math.max(0, rub.car.speed - 6));
      }
    }
  }

  const turnV = ai.turnMph;
  if (turnNow) target = Math.min(target, turnV);
  else target = Math.min(target, Math.sqrt(turnV * turnV + (2 * CONFIG.BRAKE_MPH_S * 0.75 * distToTurn) / pxm));

  if (ai.creepTime > 0) {
    ai.creepTime -= dt;
    target = Math.max(target, 12);
  }

  if (!view.started || view.time < ai.reaction) target = 0;
  if (car.finished) target = Math.min(target, CONFIG.AI_FINISHED_MPH);

  const look = 40 + Math.max(0, car.speed) * pxm * 0.22;
  let tx: number;
  let ty: number;
  if (pitY !== null) {
    const nearBox = ai.pitPhase === 'entering' && ai.boxX - car.x < 60;
    tx = car.x + (nearBox ? 22 : Math.max(look, 50));
    ty = pitY;
  } else {
    const p = pointAt(car.s + look, laneD);
    tx = p.x;
    ty = p.y;
  }
  const diff = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.heading);
  out.steer = Math.max(-1, Math.min(1, diff * 5));
  out.gas = car.speed < target - 0.5;
  out.brake = car.speed > target + 1.5;

  const servicing = ai.pitPhase === 'fueling' || ai.pitPhase === 'parked';
  if (ai.recoverTime > 0) {
    ai.recoverTime -= dt;
    const aim = Math.sign(ai.lane - car.d) * 0.35;
    const herr = wrapAngle(trackHeadingAt(car.x, car.y) + aim - car.heading);
    if (!car.reverse) out.toggleReverse = Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH;
    out.steer = -Math.max(-1, Math.min(1, herr * 3));
    const tailFree = !tailBlocked(car, view.cars);
    out.gas = tailFree && ai.recoverTime > 0.3 && car.speed > -AI_RECOVER_MPH;
    out.brake = !out.gas;
    if (!tailFree) ai.recoverTime = Math.min(ai.recoverTime, 0.3);
    return out;
  }
  const herr = wrapAngle(trackHeadingAt(car.x, car.y) - car.heading);
  const misaligned = Math.abs(herr) > (car.contactPrev > 0 ? 0.35 : 0.7);
  if (
    view.started &&
    !servicing &&
    car.spinTime <= 0 &&
    Math.abs(car.speed) < 4 &&
    !car.finished
  ) {
    ai.stuckTime += dt;
    const blocked = noseBlocked(car, view.cars);
    if (ai.stuckTime > 0.8 && (misaligned || blocked)) {
      ai.lane = bestLane(car, view.cars);
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
  return out;
}

function isHazard(o: Car, me: Car): boolean {
  if (o.spinTime > 0) return true;
  if (isServicing(o)) return false;
  if (o.speed < 40 && me.speed - o.speed > 40) return true;
  return Math.abs(o.speed) < 60 && Math.abs(wrapAngle(trackHeadingAt(o.x, o.y) - o.heading)) > 0.6;
}

function isServicing(o: Car): boolean {
  return o.ai.pitPhase === 'fueling' || o.ai.pitPhase === 'parked' || o.refueling;
}

const AI_RECOVER_MPH = 10;

const EXIT_D = -HALF_W + 13;

function pitPathR(phi: number): number {
  const r = islandHullR(phi) + CAR_CLEAR;
  return Math.max(PIT_ROAD_Y - CY, Math.min(RC - HALF_W + 9, r));
}
const CAR_CLEAR = 24;
const PIT_DIVE_AT = 0.6;

function freeBox(car: Car, cars: Car[]): number {
  const own = Math.round((car.ai.boxX - PIT_X0 - BOX_PITCH / 2) / BOX_PITCH);
  const occupied = (bx: number) =>
    cars.some((o) => o !== car && inPitBox(o.x, o.y) && Math.abs(o.x - bx) < BOX_PITCH * 0.5 + 8);
  for (let i = own; i < NUM_BOXES; i++) {
    const bx = boxX(i);
    if (bx - car.x > -8 && !occupied(bx)) return bx;
  }
  return car.ai.boxX;
}

function mergeClear(car: Car, lane: number, cars: Car[]): boolean {
  const pxm = CONFIG.PX_PER_MPH;
  return cars.every((o) => {
    if (o === car || Math.abs(o.d - lane) > 17) return true;
    const ds = deltaS(car.s, o.s);
    if (ds > -30 && ds < 50) return false;
    if (ds <= -30 && ds > -300) {
      const closing = (o.speed - car.speed) * pxm;
      if (closing > 0 && (-ds - 40) / closing < 1.5) return false;
    }
    return true;
  });
}

function sideRubber(car: Car, cars: Car[]): { car: Car; ds: number } | null {
  let best: { car: Car; ds: number } | null = null;
  for (const o of cars) {
    if (o === car || o.spinTime > 0) continue;
    const ds = deltaS(car.s, o.s);
    if (Math.abs(ds) > 40) continue;
    const dd = Math.abs(o.d - car.d);
    const touching = car.contactPrev > 0 && Math.hypot(o.x - car.contactX, o.y - car.contactY) < 30;
    if (dd < 16 || (touching && dd < 22)) {
      if (!best || Math.abs(ds) < Math.abs(best.ds)) best = { car: o, ds };
    }
  }
  return best;
}

function sideClear(car: Car, lane: number, cars: Car[]): boolean {
  if (Math.abs(lane - car.d) < 8) return true;
  const lo = Math.min(car.d, lane) - 12;
  const hi = Math.max(car.d, lane) + 12;
  return cars.every((o) => {
    if (o === car) return true;
    const ds = deltaS(car.s, o.s);
    return !(ds > -40 && ds < 50 && o.d > lo && o.d < hi);
  });
}

function bestLane(car: Car, cars: Car[]): number {
  const near = cars.filter((o) => {
    if (o === car) return false;
    const ds = deltaS(car.s, o.s);
    return ds > -10 && ds < 70;
  });
  if (near.length === 0) return car.ai.lane;
  return [...LANES].sort((p, q) => clearance(q, near) - clearance(p, near))[0];
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
