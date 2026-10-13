import { CONFIG } from '../config';
import type { AiView } from '../race/ai';
import { type Car, isServicing } from '../race/car';
import { type Constrainable, HALF_W, LANES, type PitLane, type PitPlan } from './common';
import {
  BOX_PITCH,
  boxX,
  CX_L,
  CY,
  deltaS,
  inPitBox,
  inPitLane,
  inWallRange,
  islandHullR,
  NUM_BOXES,
  PIT_BOX_Y,
  PIT_DRIVE_Y,
  PIT_LINE_IN_X,
  PIT_LINE_OUT_X,
  PIT_ROAD_Y,
  PIT_X0,
  PIT_X1,
  RC,
  S_BOTTOM,
  S_TURN2,
  TURN_LEN,
  WALL_X0,
  WALL_X1,
} from './oval';

const EXIT_D = -HALF_W + 13;
const CAR_CLEAR = 24;
const PIT_DIVE_AT = 0.6;

function pitPathR(phi: number): number {
  const r = islandHullR(phi) + CAR_CLEAR;
  return Math.max(PIT_ROAD_Y - CY, Math.min(RC - HALF_W + 9, r));
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

function freeBox(car: Car, cars: Car[]): number {
  const own = car.ai.box;
  const occupied = (bx: number) => cars.some((o) => o !== car && inPitBox(o.x, o.y) && Math.abs(o.x - bx) < BOX_PITCH * 0.5 + 8);
  for (let i = own; i < NUM_BOXES; i++) {
    const bx = boxX(i);
    if (bx - car.x > -8 && !occupied(bx)) return bx;
  }
  return boxX(own);
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

export const OVAL_PIT: PitLane = {
  inLane: inPitLane,
  inBox: inPitBox,

  walled(a: Constrainable, b: Constrainable): boolean {
    return inWallRange(a.x) && inWallRange(b.x) && a.wasInPit && b.wasInPit && a.pitSide !== b.pitSide;
  },

  decideAt(s: number): boolean {
    return s >= S_TURN2 && s < S_BOTTOM;
  },

  autoIn(car: Car): boolean {
    return car.prevX < PIT_LINE_IN_X && car.x >= PIT_LINE_IN_X && car.pitSide && inPitLane(car.x, car.y);
  },

  autoOut(car: Car): boolean {
    return car.x >= PIT_LINE_OUT_X || !car.pitSide;
  },

  plan(car: Car, view: AiView, target: number, laneD: number): PitPlan {
    const ai = car.ai;
    const pxm = CONFIG.PX_PER_MPH;
    let pitY: number | null = null;
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
          laneD = mergeClear(car, LANES[0]!, view.cars) ? LANES[0]! : EXIT_D;
          if (Math.abs(car.d - LANES[0]!) < 5 || car.y < CY) {
            ai.pitPhase = 'none';
            ai.lane = LANES[0]!;
          }
        }
        break;
      default:
        break;
    }
    return { target, laneD, lane: pitY };
  },

  follow(car: Car, view: AiView, plan: PitPlan): void {
    const pitY = plan.lane!;
    let ahead = pitCarAhead(car, pitY, view.cars);
    if (ahead && ahead.car.speed < 2 && ahead.gap < 80 && !isServicing(ahead.car)) {
      const other = pitY === PIT_DRIVE_Y ? PIT_BOX_Y : PIT_DRIVE_Y;
      if (!pitCarAhead(car, other, view.cars)) {
        plan.lane = other;
        ahead = null;
      }
    }
    if (ahead) {
      const pxm = CONFIG.PX_PER_MPH;
      const v0 = Math.max(0, ahead.car.speed);
      const room = Math.max(0, ahead.gap - 46);
      plan.target = Math.min(plan.target, Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm));
    }
  },

  aim(car: Car, lane: number, look: number): { x: number; y: number } {
    const nearBox = car.ai.pitPhase === 'entering' && boxX(car.ai.box) - car.x < 60;
    return { x: car.x + (nearBox ? 22 : Math.max(look, 50)), y: lane };
  },
};
