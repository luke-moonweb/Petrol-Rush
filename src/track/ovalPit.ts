import { CONFIG } from '../config';
import type { AiView } from '../race/ai';
import type { Car } from '../race/car';
import { fillTarget, lapsOfFuel } from '../race/fuel';
import { PLAN } from '../race/planner';
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
  PIT_WALL_TOP,
  PIT_X0,
  PIT_X1,
  RC,
  S_TURN2,
  TRACK_LEN,
  TURN_LEN,
  WALL_X0,
  WALL_X1,
} from './oval';
import {
  DRIVE_WALLWARD,
  driveToBox,
  exitRoadAhead,
  followInPits,
  leaveBox,
  mergeClear,
  PIT_FUEL_MARGIN_LAPS,
  type PitRoad,
  PULL_LOOK_PX,
} from './pitAi';

const EXIT_D = -HALF_W + 13;
/** Grip model: the innermost line a merging car keeps to while the lane is not clear (clear of the island). */
const EXIT_D_MIN = -HALF_W + 9;
/** Line of a car heading for the pit entry, before it dives off turn 2. */
const PIT_APPROACH_D = -HALF_W + 9;
// Grip model: a car more than PIT_GIVE_UP_D px out from that line PIT_GIVE_UP_PX before turn 2 gives the stop up.
const PIT_GIVE_UP_PX = 40;
const PIT_GIVE_UP_D = 15;
// Grip model: a car that must stop holds its line for traffic until this far before turn 2 (px).
const PIT_FORCE_PX = 120;
/** ...and drops back this much slower than a car alongside on the inside (mph). */
const PIT_DROP_MPH = 12;
/** A car up to this far behind (px) is alongside: dropping back lets it by... */
const PIT_SIDE_PX = 40;
/** ...though not below this speed (mph). */
const PIT_HELD_MPH = 100;
/** A car coming up from behind counts as alongside if it would close the gap within this time (s). */
const PIT_LOOK_BACK_S = 0.8;
const CAR_CLEAR = 24;
const PIT_DIVE_AT = 0.6;
// Grip model: the pit decision window ends this far before turn 2 (px), and starts PIT_DECIDE_FROM before it.
const PIT_DECIDE_FROM = 700;
const PIT_DECIDE_TO = 250;
// Grip model pit exit: give way from this far before the end of the pit road, stopping this far before it.
const MERGE_YIELD_PX = 260;
/** A merging car is counted by racing cars once it does more than this. */
const MERGE_SEEN_MPH = 15;
/** Stopped this long at the end of the pit road, a car merges as soon as nobody is alongside. */
const MERGE_MAX_WAIT_S = 2.5;
/** ...and after this long it goes regardless (racing cars allow for it once it moves). */
const MERGE_FORCE_S = 4;
const MERGE_STOP_PX = 12;

/** The cars in the way of a move over to `lane`: alongside, or coming up fast from behind. */
function approachBlockers(car: Car, lane: number, cars: Car[]): Car[] {
  if (Math.abs(lane - car.d) < 8) return [];
  const lo = Math.min(car.d, lane) - 12;
  const hi = Math.max(car.d, lane) + 12;
  return cars.filter((o) => {
    if (o === car || o.d <= lo || o.d >= hi) return false;
    const ds = deltaS(car.s, o.s);
    const back = PIT_SIDE_PX + Math.max(0, o.speed - car.speed) * CONFIG.PX_PER_MPH * PIT_LOOK_BACK_S;
    return ds > -back && ds < 50;
  });
}

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
  driveY: PIT_DRIVE_Y + DRIVE_WALLWARD,
  onExitRoad: (x, y) => y > CY && x < WALL_X1 + 20,
  onRoad: (x, y) => y > CY && y < PIT_WALL_TOP + 4 && x >= CX_L && x < WALL_X1 + 20,
};

export const OVAL_PIT: PitLane = {
  inLane: inPitLane,
  inBox: inPitBox,
  onRoad: ROAD.onRoad,

  walled(a: Constrainable, b: Constrainable): boolean {
    return inWallRange(a.x) && inWallRange(b.x) && a.wasInPit && b.wasInPit && a.pitSide !== b.pitSide;
  },

  // Decide on the straight before turn 2, so the move to the inside lane is done before the corner
  // (a lane change inside a corner adds curvature the speed plan does not see).
  decideAt(s: number): boolean {
    return s >= S_TURN2 - PIT_DECIDE_FROM && s < S_TURN2 - PIT_DECIDE_TO;
  },

  reachLaps: (PIT_DECIDE_FROM + TURN_LEN + (PIT_X1 - CX_L)) / TRACK_LEN,

  joiningD(o: Car): number {
    // (only a merging car on the move: racing cars never stop on the track for a car still on the pit road)
    if (o.ai.pitPhase === 'exiting' && o.ai.merging && o.speed > MERGE_SEEN_MPH) return Math.max(o.d, EXIT_D);
    if (o.ai.pitPhase === 'entering' && !o.ai.pitHeld && o.y < CY + 40 && o.s >= S_TURN2 - PIT_DECIDE_FROM)
      return Math.min(o.d, PIT_APPROACH_D);
    return o.d;
  },

  diving(car: Car): boolean {
    return car.ai.pitPhase === 'entering' && car.s > S_TURN2 + TURN_LEN * PIT_DIVE_AT;
  },

  autoIn(car: Car): boolean {
    return car.prevX < PIT_LINE_IN_X && car.x >= PIT_LINE_IN_X && car.pitSide && inPitLane(car.x, car.y);
  },

  autoOut(car: Car): boolean {
    return car.x >= PIT_LINE_OUT_X || !car.pitSide;
  },

  plan(car: Car, view: AiView, target: number, laneD: number, dt: number): PitPlan {
    const ai = car.ai;
    const pxm = CONFIG.PX_PER_MPH;
    let pitY: number | null = null;
    ai.pitHeld = false;
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
          laneD = PIT_APPROACH_D;
          if (Math.abs(car.d - laneD) > 6) {
            // A car may skip the stop for a lap only if its fuel surely lasts another lap to the box,
            // and never twice running.
            const fuelLaps = lapsOfFuel(car);
            const canSkip = !ai.skipped && fuelLaps > 1 + this.reachLaps + PIT_FUEL_MARGIN_LAPS;
            // Someone alongside on the inside, or closing in fast from behind: hold the line (racing cars
            // then count it there) and drop in behind a car that is level or ahead, and back from one
            // alongside just behind so that it goes by (but not down to a crawl on the straight); one
            // further back but closing in fast is only waited for. Only a car that must stop and is
            // nearly at turn 2 moves over anyway (racing cars allow for a car heading for the pit entry
            // once it is clearly ahead of them).
            const block = approachBlockers(car, laneD, view.cars);
            if (block.length > 0) {
              if (canSkip || car.s < S_TURN2 - PIT_FORCE_PX) {
                laneD = car.d;
                ai.pitHeld = true;
              }
              for (const o of block) {
                const ds = deltaS(car.s, o.s);
                if (ds > -10) target = Math.min(target, Math.max(0, o.speed - PIT_DROP_MPH));
                else if (ds > -PIT_SIDE_PX) target = Math.min(target, Math.max(PIT_HELD_MPH, Math.min(o.speed, car.speed) - PIT_DROP_MPH));
              }
            }
            // Still held out wide as turn 2 arrives: skip the pits this lap rather than dive across the corner.
            if (car.s > S_TURN2 - PIT_GIVE_UP_PX && car.s < S_TURN2 && car.d > PIT_APPROACH_D + PIT_GIVE_UP_D && canSkip) {
              ai.pitPhase = 'none';
              ai.skipped = true;
              break;
            }
          }
          // brake smoothly for the dive
          const toDive = car.s < S_TURN2 - PIT_DECIDE_FROM ? Infinity : S_TURN2 + TURN_LEN * PIT_DIVE_AT - car.s;
          const vDive = CONFIG.AI_PIT_MPH + 5;
          const b = CONFIG.BRAKE_MPH_S * PLAN.BRAKE_FRAC;
          target = Math.min(target, Math.sqrt(vDive * vDive + (2 * b * Math.max(0, toDive)) / pxm));
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
        else if (car.fuel >= (car.isPlayer ? 0.999 : fillTarget(car, view.track, view.laps))) ai.pitPhase = 'exiting';
        break;
      case 'parked':
        pitY = PIT_BOX_Y;
        target = 0;
        break;
      case 'exiting':
        if (car.x < WALL_X1 && car.y > CY) {
          ({ target, lane: pitY } = leaveBox(ROAD, car, view.cars, CONFIG.AI_PIT_MPH));
          // Give way at the end of the pit road until the inside lane is clear, instead
          // of merging into turn 1 alongside (or just ahead of) a car that cannot slow down in time.
          // After MERGE_MAX_WAIT_S stopped it goes as soon as nobody is alongside, after MERGE_FORCE_S
          // in any case; once it goes it is committed (racing cars allow for it and it no longer gives
          // way). Not for the player under the pit autopilot, who merges by hand after the hand-back
          // (a player's car the AI drives all race long gives way like any other).
          if (car.x > WALL_X1 - MERGE_YIELD_PX) {
            if (!ai.merging && !(car.isPlayer && view.pitAuto)) {
              const clear =
                ai.mergeWait >= MERGE_FORCE_S ||
                (ai.mergeWait >= MERGE_MAX_WAIT_S
                  ? mergeClear(view.track, car, LANES[0]!, view.cars, false, 0)
                  : mergeClear(view.track, car, LANES[0]!, view.cars, true));
              if (clear) ai.merging = true;
              else {
                const room = Math.max(0, WALL_X1 - MERGE_STOP_PX - car.x);
                target = Math.min(target, Math.sqrt((2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm));
                if (Math.abs(car.speed) < 3) ai.mergeWait += dt;
              }
            }
            // and do not run into a car that has just merged (it is no longer in the pit lane)
            const ahead = exitRoadAhead(car, view.cars);
            if (ahead) {
              const room = Math.max(0, ahead.gap - 46);
              const v0 = Math.max(0, ahead.car.speed);
              target = Math.min(target, Math.sqrt(v0 * v0 + (2 * CONFIG.BRAKE_MPH_S * 0.7 * room) / pxm));
            }
          }
        } else {
          // (while the lane is not clear it keeps to the inside rather than easing out to EXIT_D,
          // which overlaps a car on the inside lane)
          const clear = mergeClear(view.track, car, LANES[0]!, view.cars);
          laneD = clear ? LANES[0]! : Math.max(EXIT_D_MIN, Math.min(car.d, EXIT_D));
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
    followInPits(ROAD, car, view.cars, plan, true);
  },

  aim(car: Car, lane: number, look: number): { x: number; y: number } {
    const nearBox = car.ai.pitPhase === 'entering' && boxX(car.ai.box) - car.x < 60;
    return { x: car.x + (nearBox ? 22 : car.ai.pullOut === 2 ? PULL_LOOK_PX : Math.max(look, 50)), y: lane };
  },
};
