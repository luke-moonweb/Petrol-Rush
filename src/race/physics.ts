import { CollisionMode, CONFIG } from '../config';
import { CAR_R, constrainPos, CX_L, CX_R, CY, deltaS, inPitLane, inTurn, inWallRange, project, trackHeadingAt, TRACK_LEN, WallNormal, wrapAngle } from '../track/track';
import { Car } from './car';

export interface DriveInput {
  steer: number;
  gas: boolean;
  brake: boolean;
  toggleReverse: boolean;
}

export const NO_INPUT: DriveInput = { steer: 0, gas: false, brake: false, toggleReverse: false };

function towards(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

export function brakeAt(mph: number): number {
  const t = Math.min(Math.max(Math.abs(mph) / CONFIG.MAX_MPH, 0), 1);
  return CONFIG.BRAKE_MPH_S + (CONFIG.BRAKE_MPH_S_HIGH - CONFIG.BRAKE_MPH_S) * t;
}

export class SteerRamp {
  private dir = 0;
  private level = 0;

  update(dir: number, dt: number, turn = false): number {
    const C = CONFIG;
    const min = turn ? C.STEER_MIN_TURN : C.STEER_MIN;
    const ramp = turn ? C.STEER_RAMP_TURN_S : C.STEER_RAMP_S;
    if (dir === 0) {
      this.level = Math.max(0, this.level - dt / C.STEER_RELEASE_S);
      return 0;
    }
    if (dir !== this.dir) {
      this.dir = dir;
      this.level = 0;
    }
    this.level = Math.min(1, Math.max(this.level, min) + ((1 - min) * dt) / ramp);
    return dir * this.level;
  }

  reset(): void {
    this.dir = 0;
    this.level = 0;
  }
}

export function cornerAssist(car: Car): number {
  const C = CONFIG;
  if (!inTurn(car.x) || car.reverse || car.spinTime > 0 || car.speed < C.CORNER_ASSIST_MIN_MPH) return 0;
  if (car.pitSide && car.wasInPit) return 0;
  const vpx = car.speed * C.PX_PER_MPH;
  const rate = Math.min(C.MAX_TURN_RATE, vpx / C.MIN_TURN_RADIUS);
  const r = Math.max(60, Math.hypot(car.x - (car.x < CX_L ? CX_L : CX_R), car.y - CY));
  return -Math.min(1, (C.CORNER_ASSIST * vpx) / r / rate);
}

export function skidWarning(car: Car): 0 | 1 | 2 {
  if (car.spinTime > 0 || Math.round(Math.abs(car.speed)) <= CONFIG.SPIN_MPH) return 0;
  return inTurn(car.x) ? 2 : 1;
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

export function stepCar(car: Car, input: DriveInput, dt: number): void {
  const C = CONFIG;
  const pxm = C.PX_PER_MPH;
  car.wallImpact = 0;

  if (input.toggleReverse && car.spinTime <= 0) {
    // Engaging reverse still needs a near-stop; leaving reverse is always instant.
    if (car.reverse) car.reverse = false;
    else if (Math.abs(car.speed) <= C.REVERSE_TOGGLE_MAX_MPH) car.reverse = true;
  }

  const hasFuel = car.fuel > 0;

  if (car.spinTime > 0) {
    const k = 0.25 + 0.75 * Math.min(1, car.speed / 120);
    car.spinTime -= dt;
    car.heading += car.spinDir * car.spinRate * k * dt;
    car.speed = towards(car.speed, 0, C.SPIN_DECEL_MPH_S * dt);
    if (car.spinTime <= 0 || car.speed < C.SPIN_END_MPH) endSpin(car);
  } else {
    if (input.brake) {
      car.speed = towards(car.speed, 0, brakeAt(car.speed) * dt);
    } else if (input.gas && hasFuel) {
      if (car.reverse) {
        car.speed =
          car.speed > 0
            ? towards(car.speed, 0, C.BRAKE_MPH_S * dt)
            : Math.max(car.speed - C.ACCEL_MPH_S_LOW * dt, -C.MAX_REVERSE_MPH);
      } else {
        car.speed =
          car.speed < 0
            ? towards(car.speed, 0, C.BRAKE_MPH_S * dt)
            : Math.min(car.speed + accelAt(car.speed) * dt, C.MAX_MPH);
      }
    } else if (C.THROTTLE_MODE === 'hold') {
      car.speed = towards(car.speed, 0, C.COAST_MPH_S * dt);
    }
    if (!hasFuel && Math.abs(car.speed) > C.OUT_OF_FUEL_CRAWL_MPH) {
      car.speed = towards(car.speed, 0, C.COAST_MPH_S * 2 * dt);
    }
    car.speed = Math.min(car.speed, C.MAX_MPH);

    const vpx = Math.abs(car.speed) * pxm;
    const rate = Math.min(C.MAX_TURN_RATE, vpx / C.MIN_TURN_RADIUS);
    const over = Math.round(car.speed) - C.SPIN_MPH;
    const sliding = inTurn(car.x) && over > 0 && over < C.SLIDE_SPIN_OVER;
    car.slideTime = sliding ? car.slideTime + dt : 0;
    const grip = sliding ? C.SLIDE_GRIP : 1;
    if (sliding) car.speed = Math.max(C.SPIN_MPH - 4, car.speed - C.SLIDE_DECEL_MPH_S * dt);
    car.heading += input.steer * rate * grip * dt * (car.speed >= 0 ? 1 : -1);
    if (input.steer === 0 && car.speed > 20 && !inTurn(car.x)) {
      const err = wrapAngle(trackHeadingAt(car.x, car.y) - car.heading);
      if (Math.abs(err) < (C.STRAIGHT_ASSIST_DEG * Math.PI) / 180) {
        const step = C.STRAIGHT_ASSIST_RATE * dt;
        car.heading += Math.max(-step, Math.min(step, err));
      }
    }
    car.moveAngle = car.heading;

    if (sliding) {
      car.overTime = 0;
      if (car.slideTime > C.SLIDE_MAX_S) startSpin(car, C.SPIN_RATE, input.steer > 0 ? 1 : -1);
    } else if (inTurn(car.x) && over > 0) {
      car.overTime += dt;
      if (car.overTime > C.SPIN_GRACE_S) startSpin(car, C.SPIN_RATE, input.steer > 0 ? 1 : -1);
    } else {
      car.overTime = 0;
    }
  }

  const dist = car.speed * pxm * dt;
  car.x += Math.cos(car.moveAngle) * dist;
  car.y += Math.sin(car.moveAngle) * dist;
  if (!car.finished) car.fuel = Math.max(0, car.fuel - Math.abs(dist) / (C.FUEL_RANGE_LAPS * TRACK_LEN));

  const hit = constrainPos(car);
  if (hit) applyWall(car, hit);
  car.heading = wrapAngle(car.heading);
  car.moveAngle = wrapAngle(car.moveAngle);
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

function applyWall(car: Car, n: WallNormal): void {
  const C = CONFIG;
  const vx = Math.cos(car.moveAngle) * car.speed;
  const vy = Math.sin(car.moveAngle) * car.speed;
  const vn = vx * n.nx + vy * n.ny;
  if (vn >= 0) return;
  const mag0 = Math.hypot(vx, vy) || 1e-6;
  const impact = -vn / mag0;
  car.wallImpact = -vn;
  markContact(car, car.x - n.nx * CAR_R, car.y - n.ny * CAR_R, -vn);

  if (car.spinTime <= 0 && -vn > C.WALL_CRASH_MPH) {
    const cross = Math.cos(car.heading) * n.ny - Math.sin(car.heading) * n.nx;
    startSpin(car, C.SPIN_RATE * 0.8, cross >= 0 ? 1 : -1);
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
    car.speed *= 0.2;
    return;
  }
  const ang = Math.atan2(ty, tx);
  const newMag = tmag * (1 - C.WALL_SCRUB) * (1 - 0.3 * impact);
  if (impact > C.WALL_GLANCE) {
    car.speed = Math.sign(car.speed) * newMag;
    return;
  }
  if (car.speed >= 0) {
    car.heading = car.moveAngle = ang;
    car.speed = newMag;
  } else {
    car.heading = car.moveAngle = ang + Math.PI;
    car.speed = -newMag;
  }
}

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

export type CrashHandler = (culprit: Car | null, victims: Car[]) => void;

function blameFor(a: Car, b: Car, before: { aSpun: boolean; bSpun: boolean; aMph: number; bMph: number }, sideBySide: Car | null): Car | null {
  const { aSpun, bSpun } = before;
  if (Math.cos(a.heading - b.heading) < -0.5) return null;
  const ds = deltaS(project(a.x, a.y).s, project(b.x, b.y).s);
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

export function collideCars(cars: Car[], mode: CollisionMode = 'realistic', onCrash?: CrashHandler): void {
  const C = CONFIG;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (Math.abs(b.x - a.x) > 44 || Math.abs(b.y - a.y) > 44) continue;
      if (inWallRange(a.x) && inWallRange(b.x) && a.wasInPit && b.wasInPit && a.pitSide !== b.pitSide) continue;

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

      const inPits = inPitLane(a.x, a.y) && inPitLane(b.x, b.y);
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
          if (zv === 'rear') return closing > (inTurn(v.x) ? C.REAR_SPIN_TURN_MPH : C.REAR_SPIN_MPH);
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
        if (victims.length > 0) onCrash?.(blameFor(a, b, before, culprit), victims);
      } else if (closing > 0) {
        const ds = deltaS(a.s, b.s);
        if (Math.abs(ds) > 10) {
          const front = ds > 0 ? b : a;
          const rear = ds > 0 ? a : b;
          const along = front.speed * Math.cos(front.moveAngle - rear.moveAngle);
          if (rear.speed > along) {
            const lost = rear.speed - along;
            const sgn = rear === a ? 1 : -1;
            const [rvx, rvy] = velocity(rear);
            const vn = rvx * nx * sgn + rvy * ny * sgn;
            const slide =
              (rvx - vn * nx * sgn) * Math.cos(rear.moveAngle) + (rvy - vn * ny * sgn) * Math.sin(rear.moveAngle);
            rear.speed = Math.max(rear.reverse ? -C.MAX_REVERSE_MPH : 0, slide, along - 2);
            front.speed = Math.min(C.MAX_MPH, front.speed + lost * 0.3);
          }
        }
      }
      constrainPos(a);
      constrainPos(b);
    }
  }
}
