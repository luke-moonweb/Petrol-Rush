import { CONFIG } from '../config';
import type { AiView } from '../race/ai';
import type { Car } from '../race/car';
import { type Constrainable, HALF_W, LANES, type PitLane, type PitPlan } from './common';
import {
  BOX_PITCH,
  boxX,
  CX_L,
  CY,
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
import { driveToBox, followInPits, mergeClear, type PitRoad, pitDriveLaneBusy } from './pitAi';

const EXIT_D = -HALF_W + 13;
const CAR_CLEAR = 24;
const PIT_DIVE_AT = 0.6;

function pitPathR(phi: number): number {
  const r = islandHullR(phi) + CAR_CLEAR;
  return Math.max(PIT_ROAD_Y - CY, Math.min(RC - HALF_W + 9, r));
}

const ROAD: PitRoad = {
  inLane: inPitLane,
  inBox: inPitBox,
  boxX,
  numBoxes: NUM_BOXES,
  boxPitch: BOX_PITCH,
  boxY: PIT_BOX_Y,
  driveY: PIT_DRIVE_Y,
};

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
            const box = driveToBox(ROAD, car, view.cars, target);
            target = box.target;
            pitY = box.lane;
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
          if (car.y < PIT_DRIVE_Y - 8 && pitDriveLaneBusy(ROAD, car, view.cars)) {
            pitY = PIT_BOX_Y;
            target = 0;
          }
        } else {
          laneD = mergeClear(view.track, car, LANES[0]!, view.cars) ? LANES[0]! : EXIT_D;
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
    followInPits(ROAD, car, view.cars, plan);
  },

  aim(car: Car, lane: number, look: number): { x: number; y: number } {
    const nearBox = car.ai.pitPhase === 'entering' && boxX(car.ai.box) - car.x < 60;
    return { x: car.x + (nearBox ? 22 : Math.max(look, 50)), y: lane };
  },
};
