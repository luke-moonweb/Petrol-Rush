import { CONFIG, type CollisionMode } from '../config';
import { CAR_R, type Track, type WallNormal, wrapAngle } from '../track/common';
import type { Car } from './car';
import { burnFuel } from './fuel';

export interface DriveInput {
  steer: number;
  gas: boolean;
  brake: boolean;
  toggleReverse: boolean;
  /**
   * The track heading to straighten towards when the car is on a straight and the
   * driver is not steering (the caller knows the track; the physics does not query it).
   */
  straightTo?: number;
}

/** Diagnostics: spins started by the grip step (slip) and by walls, for tests and labs. */
export const GRIP_SPINS = { slip: 0, wall: 0 };

export const NO_INPUT: DriveInput = { steer: 0, gas: false, brake: false, toggleReverse: false };

function towards(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

export function brakeAt(mph: number): number {
  const t = Math.min(Math.max(Math.abs(mph) / CONFIG.MAX_MPH, 0), 1);
  return CONFIG.BRAKE_MPH_S + (CONFIG.BRAKE_MPH_S_HIGH - CONFIG.BRAKE_MPH_S) * t;
}

/**
 * Corner assist: a feed-forward share of the curvature of the car's line (kLane, from the
 * track's curvature table), so it works on any track and in both directions. It fades out while the
 * car slips, so it never fights a countersteer.
 */
export function curvatureAssist(car: Car, kLane: number): number {
  const C = CONFIG;
  if (kLane === 0 || car.reverse || car.spinTime > 0 || car.speed < C.CORNER_ASSIST_MIN_MPH) return 0;
  if (car.pitSide && car.wasInPit) return 0;
  const slip = Math.abs(wrapAngle(car.heading - car.moveAngle));
  const fade = car.rearLoose ? 0 : Math.max(0, 1 - slip / (2 * C.GRIP.SLIDE_SLIP_MIN));
  const a = (C.CORNER_ASSIST * kLane) / maxCurvature(car.speed * C.PX_PER_MPH);
  return Math.max(-1, Math.min(1, a)) * fade;
}

function accelAt(mph: number): number {
  const t = Math.min(Math.max(mph / CONFIG.MAX_MPH, 0), 1);
  return CONFIG.ACCEL_MPH_S_LOW + (CONFIG.ACCEL_MPH_S_HIGH - CONFIG.ACCEL_MPH_S_LOW) * t;
}

export function startSpin(car: Car, rate: number, dir: number): boolean {
  if (car.spinTime > 0) {
    car.spinRate = Math.max(car.spinRate, rate);
    return false;
  }
  car.slideTime = 0;
  car.overTime = 0;
  resetGrip(car);
  if (car.speed < 0) {
    car.moveAngle = wrapAngle(car.heading + Math.PI);
    car.speed = -car.speed;
  }
  car.spinTime = CONFIG.SPIN_MAX_S;
  car.spinDir = dir >= 0 ? 1 : -1;
  car.spinRate = rate;
  car.reverse = false;
  car.crashes++;
  return true;
}

/** What the physics step needs from a track (tests may pass a stand-in without walls). */
export type StepTrack = Pick<Track, 'len' | 'constrain'>;

function resetGrip(car: Car): void {
  car.weightFwd = 0;
  car.slipPeak = 0;
  car.gripUse = 0;
  car.gripOver = 0;
  car.rearLoose = false;
  car.rearStress = 0;
  car.wallYaw = 0;
}

/** Lateral grip (px/s^2) at v px/s: GRIP up to KNEE_MPH, then fading linearly to TOP at MAX_MPH (and TOP beyond). */
export function gripAt(v: number): number {
  const C = CONFIG;
  const G = C.GRIP;
  const vk = G.KNEE_MPH * C.PX_PER_MPH;
  const a = Math.abs(v);
  if (a <= vk || G.KNEE_MPH >= C.MAX_MPH) return G.GRIP;
  const fade = (G.GRIP - G.TOP) / ((C.MAX_MPH - G.KNEE_MPH) * C.PX_PER_MPH);
  return Math.max(G.TOP, G.GRIP - fade * (a - vk));
}

/** How hard a loose rear swings, as a share of OS_KICK / LOOSE_GAIN: a slow slide is easier to catch. */
function slideScale(v: number): number {
  const G = CONFIG.GRIP;
  const t = (v / CONFIG.PX_PER_MPH - G.SLIDE_SOFT_MPH) / Math.max(1, G.KNEE_MPH - G.SLIDE_SOFT_MPH);
  return G.SLIDE_SOFT + (1 - G.SLIDE_SOFT) * Math.max(0, Math.min(1, t));
}

/** Highest curvature (1/px) the steering can ask for at v px/s: the full-lock envelope. */
export function maxCurvature(v: number): number {
  const C = CONFIG;
  const a = Math.max(Math.abs(v), 1);
  // (of the full grip: over the faded grip the car slides, see lateralBudget)
  return Math.min(1 / C.MIN_TURN_RADIUS, C.MAX_TURN_RATE / a, (C.GRIP.STEER_CAP * C.GRIP.GRIP) / (a * a));
}

/** Grip-limited cornering speed (mph) on a line of curvature k (1/px), at grip fraction f: v^2 |k| = f gripAt(v). */
export function limitMph(k: number, f = 1): number {
  const C = CONFIG;
  const G = C.GRIP;
  const pxm = C.PX_PER_MPH;
  const a = Math.abs(k);
  if (a < 1e-9) return Infinity;
  const below = Math.sqrt((G.GRIP * f) / a);
  const vk = G.KNEE_MPH * pxm;
  const vMax = C.MAX_MPH * pxm;
  if (below <= vk || vk >= vMax) return below / pxm;
  // over the knee: a v^2 = f (GRIP - m (v - vk)), a quadratic in v
  const m = (G.GRIP - G.TOP) / (vMax - vk);
  const v = (-f * m + Math.sqrt(f * f * m * m + 4 * a * f * (G.GRIP + m * vk))) / (2 * a);
  // past top speed the grip stays at TOP
  return (v > vMax ? Math.sqrt((G.TOP * f) / a) : v) / pxm;
}

function longitudinal(car: Car, input: DriveInput, dt: number, hasFuel: boolean): void {
  const C = CONFIG;
  if (input.brake) {
    car.speed = towards(car.speed, 0, brakeAt(car.speed) * dt);
  } else if (input.gas && hasFuel) {
    if (car.reverse) {
      car.speed =
        car.speed > 0 ? towards(car.speed, 0, C.BRAKE_MPH_S * dt) : Math.max(car.speed - C.ACCEL_MPH_S_LOW * dt, -C.MAX_REVERSE_MPH);
    } else {
      car.speed = car.speed < 0 ? towards(car.speed, 0, C.BRAKE_MPH_S * dt) : Math.min(car.speed + accelAt(car.speed) * dt, C.MAX_MPH);
    }
  } else if (C.THROTTLE_MODE === 'hold') {
    car.speed = towards(car.speed, 0, C.COAST_MPH_S * dt);
  }
  if (!hasFuel && Math.abs(car.speed) > C.OUT_OF_FUEL_CRAWL_MPH) {
    car.speed = towards(car.speed, 0, C.COAST_MPH_S * 2 * dt);
  }
  car.speed = Math.min(car.speed, C.MAX_MPH);
}

// The driving model. The car has a nose (heading) and a direction of travel (moveAngle); the slip angle is
// their difference. The tyres turn the travel direction with at most the grip left after braking or
// accelerating, so the cornering limit is sqrt(GRIP * r) on any radius without asking the track.
// Over the limit the car first understeers (runs wide, scrubs speed); sustained or provoked excess
// lets the rear go (oversteer), which countersteer catches; only a slip beyond SPIN_SLIP spins.
export function stepCar(car: Car, input: DriveInput, dt: number, track: StepTrack): void {
  // a zero (or broken) step changes nothing; the grip budget below divides by dt
  if (!(dt > 0)) return;
  const C = CONFIG;
  const G = C.GRIP;
  const pxm = C.PX_PER_MPH;
  car.wallImpact = 0;
  car.wallAgo += dt;

  if (input.toggleReverse && car.spinTime <= 0) {
    if (car.reverse) car.reverse = false;
    else if (Math.abs(car.speed) <= C.REVERSE_TOGGLE_MAX_MPH) car.reverse = true;
  }

  const hasFuel = car.fuel > 0;
  const v0 = car.speed;
  const pulling = input.gas && hasFuel && car.spinTime <= 0 && !input.brake;

  if (car.spinTime > 0) {
    const k = 0.25 + 0.75 * Math.min(1, car.speed / 120);
    car.spinTime -= dt;
    car.heading += car.spinDir * car.spinRate * k * dt;
    car.speed = towards(car.speed, 0, C.SPIN_DECEL_MPH_S * dt);
    if (car.spinTime <= 0 || car.speed < C.SPIN_END_MPH) endSpin(car);
    resetGrip(car);
    car.slideTime = 0;
  } else {
    const before = car.speed;
    longitudinal(car, input, dt, hasFuel);
    const aLong = (Math.abs(car.speed - before) / dt) * pxm;
    const v = car.speed * pxm;
    if (car.speed <= 0 || car.reverse || v < G.MIN_V) {
      // Reverse, the pit box and nearly stopped cars: kinematic steering.
      const rate = Math.min(C.MAX_TURN_RATE, (Math.abs(car.speed) * pxm) / C.MIN_TURN_RADIUS);
      car.heading += input.steer * rate * dt * (car.speed >= 0 ? 1 : -1);
      car.moveAngle = car.heading;
      resetGrip(car);
      car.slideTime = 0;
      car.overTime = 0;
    } else {
      gripStep(car, input, dt, v, aLong);
      turnFromWall(car, dt);
    }
  }

  const dist = car.speed * pxm * dt;
  car.x += Math.cos(car.moveAngle) * dist;
  car.y += Math.sin(car.moveAngle) * dist;
  burnFuel(car, dist, v0, pulling);

  const hit = track.constrain(car);
  if (hit) applyWallGrip(car, hit, dt);
  car.heading = wrapAngle(car.heading);
  car.moveAngle = wrapAngle(car.moveAngle);
}

/**
 * Lateral budget for a demand aWant (px/s^2) with muAv of grip left and muFull the unfaded grip. Over the
 * faded grip, up to the full grip, the car slides into the corner on a line DRIFT_SHARE as curved as asked
 * (that part of the demand is absorbed); the demand beyond counts as over the limit (u > 1) against muAv.
 */
function lateralBudget(aWant: number, muAv: number, muFull: number): { muLat: number; u: number } {
  const T = CONFIG.GRIP.DRIFT_SHARE;
  const absorbed = Math.max(0, Math.min(aWant - muAv, (CONFIG.GRIP.DRIFT_MAX * (muFull - muAv)) / T));
  return { muLat: muAv + T * absorbed, u: (aWant - absorbed) / muAv };
}

function gripStep(car: Car, input: DriveInput, dt: number, v: number, aLong: number): void {
  const C = CONFIG;
  const G = C.GRIP;
  const pxm = C.PX_PER_MPH;
  const fLong = Math.min(1, aLong / (C.BRAKE_MPH_S_HIGH * pxm));
  const grip = gripAt(v);
  // the yaw rates below (rad/s) were set for the full grip: they scale with it, so a slide keeps its
  // proportion to how fast the tyres can turn the course
  const share = grip / G.GRIP;
  const ellipse = Math.sqrt(Math.max(0, 1 - (G.FC_K * fLong) ** 2));
  const muAv = grip * ellipse;
  const kCmd = input.steer * maxCurvature(v);
  const aCmd = v * v * kCmd;
  const { muLat, u } = lateralBudget(Math.abs(aCmd), muAv, G.GRIP * ellipse);
  const over = Math.max(0, u - 1);
  let slip = wrapAngle(car.heading - car.moveAngle);

  // Course: the tyres turn the velocity by at most muAv; a slipping car's velocity is pulled to the nose.
  // A countersteer points the front wheels along the travel direction, so it mostly turns the nose
  // back and only a share of it bends the course outwards.
  const counter = slip !== 0 && Math.sign(kCmd) === -Math.sign(slip) && Math.abs(slip) > G.SLIDE_SLIP_MIN;
  const aSteer = counter ? aCmd * G.COUNTER_COURSE : aCmd;
  const aLat = Math.max(-muLat, Math.min(muLat, aSteer + G.ALIGN * v * slip));
  const drift = Math.max(0, Math.abs(aLat) - muAv);
  car.moveAngle += (aLat / v) * dt;

  // Weight transfer: lifting or braking moves load to the front over WEIGHT_S (smoothed, so a
  // flicker of the throttle does nothing). The front gains grip and the rear loses some.
  const wTarget = input.brake ? 0.5 + 0.5 * fLong : !input.gas ? G.LIFT_WEIGHT : 0;
  car.weightFwd += (wTarget - car.weightFwd) * Math.min(1, dt / G.WEIGHT_S);
  // Rear: stress builds while the demand stays well over the limit (sustained understeer means the
  // car is far too fast), faster with load on the front; it fades when the demand drops.
  if (u > G.U_REAR && !counter) {
    const rate = ((u - G.U_REAR) / (G.STEER_CAP - G.U_REAR)) * (1 + G.WEIGHT_STRESS * car.weightFwd);
    car.rearStress = Math.min(G.STRESS_MAX, car.rearStress + (rate * dt) / G.STRESS_S);
  } else car.rearStress = Math.max(0, car.rearStress - dt / G.STRESS_DECAY_S);
  // A caught slide (the slip came back under the slide threshold after a real slide) re-grips the rear.
  if (car.slipPeak > G.LOOSE_SLIP && Math.abs(slip) < G.SLIDE_SLIP_MIN) {
    car.rearStress = Math.min(car.rearStress, G.CAUGHT_STRESS);
    car.slipPeak = 0;
  }
  car.overTime = u > G.U_REAR ? car.overTime + dt : 0;
  car.rearLoose = Math.abs(slip) > G.LOOSE_SLIP || car.rearStress >= 1;
  car.slipPeak = car.rearLoose ? Math.max(car.slipPeak, Math.abs(slip)) : 0;

  // Nose: the front is grip-limited, so the nose never out-turns the front tyres. With weight on the
  // front it can turn a little more than the travel direction: lift-off tightens the line.
  const dir = Math.sign(kCmd);
  // Lift-off / brake tuck-in: with load on the front the rear gives a little and the car rotates
  // into the corner. Below the limit the travel direction follows (the line tightens); at the limit
  // it shows as a small step-out of the tail. That step-out is bounded (TUCK_SLIP) unless the
  // driver asks for far more than the grip (demand over TUCK_FREE_U, or held over U_REAR long enough
  // to stress the rear, i.e. an overdriven key far too fast): a
  // lift at a small excess tucks the nose in and settles instead of feeding a spin (T1).
  const tuckRoom =
    u > G.TUCK_FREE_U || car.rearStress > G.TUCK_FREE_STRESS || car.rearLoose
      ? 1
      : Math.max(0, Math.min(1, (G.TUCK_SLIP - slip * dir) / G.TUCK_FADE));
  const muFront = muAv * (1 + G.FRONT_GAIN * car.weightFwd * tuckRoom) + (muLat - muAv);
  let yaw = dir * Math.min(Math.abs(v * kCmd), muFront / v);
  const load = Math.min(1, Math.abs(aLat) / grip);
  if (load > 0.5) yaw += Math.sign(aLat) * G.LIFT_YAW * share * car.weightFwd * ((load - 0.5) / 0.5) * tuckRoom;
  // turn-in slide: the rear steps out in proportion to how much of the turn the slide carries
  const slide = Math.max(0, Math.min(1, (drift / (G.GRIP * ellipse) - G.DRIFT_FREE) / (G.DRIFT_FULL - G.DRIFT_FREE)));
  if (slide > 0 && !counter) yaw += dir * G.DRIFT_YAW * slide;
  if (car.rearLoose) {
    const swing = slideScale(v) * share;
    yaw += dir * G.OS_KICK * swing * Math.min(over, 0.5);
    if (Math.abs(slip) > G.LOOSE_SLIP) yaw += Math.sign(slip) * G.LOOSE_GAIN * swing * (Math.abs(slip) - G.LOOSE_SLIP);
  }
  car.heading += yaw * dt;
  slip = wrapAngle(car.heading - car.moveAngle);

  // Scrub: sliding tyres cost speed.
  // (a loose rear slides on the full tyre force, so a caught slide still costs time at speed)
  const slideMu = car.rearLoose ? G.GRIP : muAv;
  const drag = muAv * G.SCRUB * Math.min(over, 1) + slideMu * G.SLIP_DRAG * Math.abs(Math.sin(slip)) + G.DRIFT_COST * drift;
  car.speed = Math.max(0, car.speed - (drag / pxm) * dt);

  car.gripOver = over;
  car.turnDir = dir;
  car.gripUse = Math.max(u, Math.hypot(Math.abs(aLat) / grip, G.FC_K * fLong));
  const sliding = over > G.SLIDE_OVER_MIN || Math.abs(slip) > G.SLIDE_SLIP_MIN;
  car.slideTime = sliding ? car.slideTime + dt : 0;

  // Straight assist: on a straight with no steering, ease small angles out. Both the nose and the
  // travel direction turn, so a slip in progress is kept; the strength fades out with the error.
  if (input.straightTo !== undefined && input.steer === 0) {
    const err = wrapAngle(input.straightTo - car.heading);
    const full = (G.STRAIGHT_FULL_DEG * Math.PI) / 180;
    const off = (G.STRAIGHT_OFF_DEG * Math.PI) / 180;
    const a = Math.abs(err);
    const k = a <= full ? 1 : a >= off ? 0 : (off - a) / (off - full);
    if (k > 0) {
      const step = C.STRAIGHT_ASSIST_RATE * k * dt;
      const turn = Math.max(-step, Math.min(step, err));
      car.heading += turn;
      car.moveAngle += turn;
    }
  }

  if (Math.abs(slip) > G.SPIN_SLIP && startSpin(car, C.SPIN_RATE, slip > 0 ? 1 : -1)) GRIP_SPINS.slip++;
}

function markContact(car: Car, x: number, y: number, strength: number): void {
  if (strength <= car.contactStrength) return;
  car.contactX = x;
  car.contactY = y;
  car.contactStrength = strength;
}

function endSpin(car: Car): void {
  car.spinTime = 0;
  car.overTime = 0;
  car.speed = Math.max(0, car.speed * Math.cos(car.moveAngle - car.heading));
  car.moveAngle = car.heading;
}

// Walls: graded by the impact angle. Glancing hits redirect the car along the wall and
// cost friction proportional to the normal speed (so riding a curved wall does not glue the car);
// medium hits leave part of the angle as a slip the tyres must recover; steep, fast hits spin.
/** Turn the nose by what is left of a wall contact's rotation, at WALL_TURN_RATE at most. */
function turnFromWall(car: Car, dt: number): void {
  if (car.wallYaw === 0) return;
  const step = Math.max(-WALL_TURN_RATE * dt, Math.min(WALL_TURN_RATE * dt, car.wallYaw));
  car.heading += step;
  car.wallYaw -= step;
}

function applyWallGrip(car: Car, n: WallNormal, dt: number): void {
  const C = CONFIG;
  const G = C.GRIP;
  const vx = Math.cos(car.moveAngle) * car.speed;
  const vy = Math.sin(car.moveAngle) * car.speed;
  const vn = vx * n.nx + vy * n.ny;
  if (vn >= 0) return;
  const mag0 = Math.hypot(vx, vy) || 1e-6;
  const impact = -vn / mag0;
  car.wallImpact = -vn;
  markContact(car, car.x - n.nx * CAR_R, car.y - n.ny * CAR_R, -vn);
  const angle = Math.asin(Math.min(1, impact));
  const g0 = (G.WALL_GLANCE_DEG * Math.PI) / 180;
  const g1 = (G.WALL_SPIN_DEG * Math.PI) / 180;

  // A car that ran wide onto the outer wall because it was too fast for the corner (tyres over their
  // grip, rear still holding, steering away from that wall) ploughs along it and loses a lot of speed
  // instead of spinning; with the rear loose (e.g. a key held into the bend) a steep hit still spins.
  // (the wall normal points into the track: along the turn means the wall is on the outside)
  const outside = car.turnDir * (Math.cos(car.heading) * n.ny - Math.sin(car.heading) * n.nx) > 0;
  const ploughing = car.gripOver > G.SLIDE_OVER_MIN && !car.rearLoose && outside;
  if (car.spinTime <= 0 && car.speed > 0 && angle > g1 && -vn > G.WALL_SPIN_MPH && !ploughing) {
    const cross = Math.cos(car.heading) * n.ny - Math.sin(car.heading) * n.nx;
    if (startSpin(car, C.SPIN_RATE * 0.8, cross >= 0 ? 1 : -1)) GRIP_SPINS.wall++;
  }

  if (car.spinTime > 0) {
    const nvx = vx - (1 + C.WALL_BOUNCE) * vn * n.nx;
    const nvy = vy - (1 + C.WALL_BOUNCE) * vn * n.ny;
    car.moveAngle = Math.atan2(nvy, nvx);
    car.speed = Math.hypot(nvx, nvy) * (1 - C.WALL_SCRUB - 0.35 * impact);
    return;
  }

  const tx = vx - vn * n.nx;
  const ty = vy - vn * n.ny;
  const tmag = Math.hypot(tx, ty);
  if (tmag < 1) {
    // Creeping along the wall from (nearly) rest: keep the part along the wall, so a car with its
    // nose a little into the wall can still drive away.
    if (angle <= g1 && tmag > 0) {
      const sgn = car.speed < 0 ? -1 : 1;
      car.moveAngle = Math.atan2(ty, tx) + (sgn < 0 ? Math.PI : 0);
      car.speed = sgn * tmag;
    } else car.speed *= 0.2;
    return;
  }
  const ang = Math.atan2(ty, tx);
  // A fresh hit costs a fixed share on top of the friction; continuous contact only costs friction.
  const isFresh = car.wallAgo > G.WALL_FRESH_S;
  // A car that ran wide onto the wall because it was too fast for the corner (the tyres over their
  // grip, understeering) loses more on the hit, so the outer wall is not a free guide rail (T4).
  const plough = Math.min(1, car.gripOver / G.SLIDE_OVER_MIN) * G.WALL_PLOUGH_SCRUB;
  const fresh = isFresh ? 1 - G.WALL_HIT_SCRUB * (Math.min(1, angle / (3 * DEG)) + Math.min(1, angle / g0)) - plough : 1;
  car.wallAgo = 0;
  const newMag = Math.max(0, tmag * fresh - G.WALL_FRICTION * -vn);
  const back = car.speed < 0;
  if (angle > g1 && !ploughing) {
    // Steep but too slow to spin: the car stops against the wall (it keeps
    // its heading and loses the speed into the wall) instead of being turned along it.
    car.speed = Math.sign(car.speed) * newMag;
    return;
  }
  const along = back ? wrapAngle(ang + Math.PI) : ang;
  // Above the glancing range the nose is kicked off the wall (turned from the wall line towards
  // the track) by a share of the impact angle, which the tyres then recover as slip. Below it the
  // nose is straightened along the wall. The nose turns there at WALL_TURN_RATE at most, so the
  // cockpit view never jumps.
  const kick = back ? 0 : Math.max(0, Math.min(1, (angle - g0) / (g1 - g0))) * WALL_KICK * (angle > g1 ? g1 / angle : 1);
  const away = Math.cos(along) * n.ny - Math.sin(along) * n.nx >= 0 ? 1 : -1;
  car.wallYaw = wrapAngle(along + away * kick * angle - car.heading);
  turnFromWall(car, dt);
  car.moveAngle = along;
  car.speed = back ? -newMag : newMag;
}

const DEG = Math.PI / 180;
/** Share of the impact angle the nose is kicked off the wall at WALL_SPIN_DEG. */
const WALL_KICK = 0.5;
/** rad/s: how fast a wall contact may turn the nose (no instant heading change). */
const WALL_TURN_RATE = 4;
const CIRCLE_OFFSETS = [-10, 10];
const CIRCLE_R = 7;

function velocity(car: Car): [number, number] {
  return [Math.cos(car.moveAngle) * car.speed, Math.sin(car.moveAngle) * car.speed];
}

function setVelocity(car: Car, vx: number, vy: number): void {
  if (car.spinTime > 0) {
    car.moveAngle = Math.atan2(vy, vx);
    car.speed = Math.min(Math.hypot(vx, vy), CONFIG.MAX_MPH);
  } else {
    const v = vx * Math.cos(car.moveAngle) + vy * Math.sin(car.moveAngle);
    car.speed = Math.max(car.reverse ? -CONFIG.MAX_REVERSE_MPH : 0, Math.min(v, CONFIG.MAX_MPH));
  }
}

/** A car hit from behind spins more easily while cornering, i.e. with its tyres loaded. */
function rearLoaded(car: Car): boolean {
  return car.gripUse >= CONFIG.GRIP.LOADED_USE;
}

export type CrashHandler = (culprit: Car | null, victims: Car[]) => void;

function blameFor(
  track: Track,
  a: Car,
  b: Car,
  before: { aSpun: boolean; bSpun: boolean; aMph: number; bMph: number },
  sideBySide: Car | null,
): Car | null {
  const { aSpun, bSpun } = before;
  if (Math.cos(a.heading - b.heading) < -0.5) return null;
  const ds = track.deltaS(track.project(a.x, a.y).s, track.project(b.x, b.y).s);
  let culprit = sideBySide;
  if (Math.abs(ds) >= CONFIG.BLAME_AHEAD_PX) {
    const frontReversing = (ds > 0 ? before.bMph : before.aMph) < -2;
    culprit = ds > 0 === frontReversing ? b : a;
  }
  if ((culprit === a && aSpun) || (culprit === b && bSpun)) return null;
  return culprit;
}

type Zone = 'front' | 'rear' | 'sideFront' | 'sideRear';

function zoneOf(car: Car, towardX: number, towardY: number, px: number, py: number): Zone {
  const hx = Math.cos(car.heading);
  const hy = Math.sin(car.heading);
  const f = towardX * hx + towardY * hy;
  if (f > 0.6) return 'front';
  if (f < -0.6) return 'rear';
  return (px - car.x) * hx + (py - car.y) * hy >= 0 ? 'sideFront' : 'sideRear';
}

export function collideCars(cars: Car[], track: Track, mode: CollisionMode = 'realistic', onCrash?: CrashHandler): void {
  const C = CONFIG;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]!;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j]!;
      if (Math.abs(b.x - a.x) > 44 || Math.abs(b.y - a.y) > 44) continue;
      if (track.pit.walled(a, b)) continue;

      let best: { nx: number; ny: number; pen: number; px: number; py: number } | null = null;
      for (const oa of CIRCLE_OFFSETS) {
        const ax = a.x + Math.cos(a.heading) * oa;
        const ay = a.y + Math.sin(a.heading) * oa;
        for (const ob of CIRCLE_OFFSETS) {
          const bx = b.x + Math.cos(b.heading) * ob;
          const by = b.y + Math.sin(b.heading) * ob;
          const dx = bx - ax;
          const dy = by - ay;
          const dist = Math.hypot(dx, dy);
          const pen = 2 * CIRCLE_R - dist;
          if (pen > 0 && (!best || pen > best.pen)) {
            const n = dist > 1e-6 ? { nx: dx / dist, ny: dy / dist } : { nx: 1, ny: 0 };
            best = { ...n, pen, px: (ax + bx) / 2, py: (ay + by) / 2 };
          }
        }
      }
      if (!best) continue;
      const { nx, ny, pen, px, py } = best;
      a.x -= (nx * pen) / 2;
      a.y -= (ny * pen) / 2;
      b.x += (nx * pen) / 2;
      b.y += (ny * pen) / 2;

      const [avx, avy] = velocity(a);
      const [bvx, bvy] = velocity(b);
      const closing = -((bvx - avx) * nx + (bvy - avy) * ny);
      if (closing > 0) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        markContact(a, mx, my, closing);
        markContact(b, mx, my, closing);
      }

      const inPits = track.pit.inLane(a.x, a.y) && track.pit.inLane(b.x, b.y);
      const fast = Math.max(Math.abs(a.speed), Math.abs(b.speed)) > C.CRASH_MIN_SPEED_MPH;
      const before = { aSpun: a.spinTime > 0, bSpun: b.spinTime > 0, aMph: a.speed, bMph: b.speed };
      const spinningBefore = before.aSpun || before.bSpun;
      const rate = C.SPIN_RATE * Math.min(1.4, 0.5 + closing / 60);
      const ta = Math.cos(a.heading) * ny - Math.sin(a.heading) * nx;
      const tb = Math.cos(b.heading) * ny - Math.sin(b.heading) * nx;
      const spinA = () => startSpin(a, rate, ta >= 0 ? -1 : 1);
      const spinB = () => startSpin(b, rate, tb >= 0 ? 1 : -1);

      let isCrash = false;
      const victims: Car[] = [];
      let culprit: Car | null = null;
      if (mode === 'classic') {
        const along = Math.abs(nx * Math.cos(a.heading) + ny * Math.sin(a.heading));
        const crashAt = along > 0.6 ? C.CRASH_IMPACT_MPH : C.CRASH_SIDE_MPH;
        isCrash = !inPits && fast && closing > crashAt;
        if (isCrash) {
          if (spinA()) victims.push(a);
          if (spinB()) victims.push(b);
          const va = avx * nx + avy * ny;
          const vb = -(bvx * nx + bvy * ny);
          const hitter = va >= vb ? a : b;
          culprit = spinningBefore ? null : hitter;
        }
      } else if (!inPits && fast && closing > 0) {
        const za = zoneOf(a, nx, ny, px, py);
        const zb = zoneOf(b, -nx, -ny, px, py);
        const hitSpins = (v: Car, zv: Zone): boolean => {
          if (zv === 'rear') return closing > (rearLoaded(v) ? C.REAR_SPIN_TURN_MPH : C.REAR_SPIN_MPH);
          if (zv === 'sideRear') return closing > C.SIDE_REAR_SPIN_MPH;
          return false;
        };
        if (za === 'front' && zb === 'front') {
          isCrash = closing > C.CRASH_IMPACT_MPH;
          if (isCrash) {
            if (spinA()) victims.push(a);
            if (spinB()) victims.push(b);
          }
        } else if (za === 'front' || (a.spinTime > 0 && zb !== 'front')) {
          if (hitSpins(b, zb)) {
            isCrash = true;
            if (spinB()) victims.push(b);
            culprit = a.spinTime > 0 ? null : a;
          }
        } else if (zb === 'front' || b.spinTime > 0) {
          if (hitSpins(a, za)) {
            isCrash = true;
            if (spinA()) victims.push(a);
            culprit = b.spinTime > 0 ? null : b;
          }
        } else if (closing > C.CRASH_SIDE_MPH) {
          isCrash = true;
          if (za === 'sideRear' && spinA()) victims.push(a);
          if (zb === 'sideRear' && spinB()) victims.push(b);
        }
      }

      if (isCrash || (spinningBefore && closing > 3)) {
        const jImp = ((1 + C.CRASH_RESTITUTION) * closing) / 2;
        setVelocity(a, avx - jImp * nx, avy - jImp * ny);
        setVelocity(b, bvx + jImp * nx, bvy + jImp * ny);
        if (victims.length > 0) onCrash?.(blameFor(track, a, b, before, culprit), victims);
      } else if (closing > 0) {
        const ds = track.deltaS(a.s, b.s);
        if (Math.abs(ds) > 10) {
          const front = ds > 0 ? b : a;
          const rear = ds > 0 ? a : b;
          const along = front.speed * Math.cos(front.moveAngle - rear.moveAngle);
          if (rear.speed > along) {
            const lost = rear.speed - along;
            const sgn = rear === a ? 1 : -1;
            const [rvx, rvy] = velocity(rear);
            const vn = rvx * nx * sgn + rvy * ny * sgn;
            const slide = (rvx - vn * nx * sgn) * Math.cos(rear.moveAngle) + (rvy - vn * ny * sgn) * Math.sin(rear.moveAngle);
            rear.speed = Math.max(rear.reverse ? -C.MAX_REVERSE_MPH : 0, slide, along - 2);
            front.speed = Math.min(C.MAX_MPH, front.speed + lost * 0.3);
          }
        }
      }
      track.constrain(a);
      track.constrain(b);
    }
  }
}
