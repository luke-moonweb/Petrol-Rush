// PLAYTEST ONLY (STEERING_PLAN B7, B10), removed before merge: the debug URL flags for the key steering
// (steer=old|B|E|ab, assist=0..0.3, fine=1) and what the debug overlay shows of the player's driving
// (lap times, key changes per second, yaw jitter, wall contacts, spins).
import { type Car, lapsCompleted } from '../../race/car';
import type { SteerOptions, SteerSet } from '../../race/steering';
import { wrapAngle } from '../../track/common';

export interface SteerFlags {
  /** The steering set; ab: each race B or E at random, shown as X / Y until the results. */
  steer: SteerSet | 'ab' | null;
  /** Corner assist strength (CONFIG.CORNER_ASSIST when null). */
  assist: number | null;
  /** The precision key (left Shift): the wheel aims at STEER_FINE of the cap. */
  fine: boolean;
}

export const NO_STEER_FLAGS: SteerFlags = { steer: null, assist: null, fine: false };

/** The flags from the URL (only with debug). */
export function readSteerFlags(p: URLSearchParams): SteerFlags {
  if (!p.has('debug')) return NO_STEER_FLAGS;
  const steer = p.get('steer');
  const assist = Number(p.get('assist'));
  return {
    steer: steer === 'old' || steer === 'B' || steer === 'E' || steer === 'ab' ? steer : null,
    assist: p.has('assist') && Number.isFinite(assist) ? Math.max(0, Math.min(1, assist)) : null,
    fine: p.get('fine') === '1',
  };
}

/** steer=ab: the set behind X for this page load (Y is the other one). */
const X_IS: SteerSet = Math.random() < 0.5 ? 'B' : 'E';

/** Yaw jitter as in the steering lab: rms deviation of the yaw rate from its centred 15-step mean. */
const HALF = 7;

/** One race's numbers. */
function freshStats() {
  return {
    keyChanges: 0,
    lastKey: 0,
    driven: 0,
    yaw: [] as number[],
    jitterSum: 0,
    jitterN: 0,
    lastHeading: Number.NaN,
    walls: 0,
    wallFree: 99,
    spins0: -1,
    spins: 0,
    laps: 0,
    lapStart: 0,
    lastLap: 0,
    bestLap: Infinity,
  };
}

export class SteerPlaytest {
  private set: SteerSet = 'B';
  private label: 'X' | 'Y' | null = null;
  private s = freshStats();

  constructor(readonly flags: SteerFlags) {}

  /** A new race: its steering options (ab: X or Y at random) and fresh numbers. */
  options(): SteerOptions {
    const f = this.flags;
    if (f.steer === 'ab') {
      this.label = Math.random() < 0.5 ? 'X' : 'Y';
      this.set = this.label === 'X' ? X_IS : X_IS === 'B' ? 'E' : 'B';
    } else this.set = f.steer ?? 'B';
    this.s = freshStats();
    return { set: this.set, assist: f.assist ?? undefined };
  }

  /** One step of the player driving (race started, no pit autopilot). */
  step(car: Car, key: number, dt: number, time: number): void {
    const s = this.s;
    s.driven += dt;
    if (key !== s.lastKey) s.keyChanges++;
    s.lastKey = key;
    if (!Number.isNaN(s.lastHeading)) s.yaw.push(wrapAngle(car.heading - s.lastHeading) / dt);
    s.lastHeading = car.heading;
    if (s.yaw.length > 2 * HALF + 1) s.yaw.shift();
    if (s.yaw.length === 2 * HALF + 1) {
      const mean = s.yaw.reduce((a, b) => a + b, 0) / s.yaw.length;
      s.jitterSum += (s.yaw[HALF]! - mean) ** 2;
      s.jitterN++;
    }
    if (car.wallImpact > 2 && s.wallFree > 0.3) s.walls++;
    s.wallFree = car.wallImpact > 0 ? 0 : s.wallFree + dt;
    if (s.spins0 < 0) s.spins0 = car.crashes;
    s.spins = car.crashes - s.spins0;
    // (the first lap starts from the grid: timed from the second on)
    const laps = lapsCompleted(car);
    if (laps > s.laps) {
      if (s.laps > 0) {
        s.lastLap = time - s.lapStart;
        s.bestLap = Math.min(s.bestLap, s.lastLap);
      }
      s.laps = laps;
      s.lapStart = time;
    }
  }

  /** The debug overlay's lines; reveal: the race is over (ab shows which set X or Y was). */
  lines(reveal: boolean): string[] {
    const f = this.flags;
    const set = this.label ? (reveal ? `${this.label} = ${this.set}` : this.label) : this.set;
    const lap = (t: number) => (t > 0 && t < Infinity ? t.toFixed(2) : '-');
    const s = this.s;
    const perS = s.driven > 0 ? s.keyChanges / s.driven : 0;
    const jitter = s.jitterN > 0 ? Math.sqrt(s.jitterSum / s.jitterN) : 0;
    return [
      `steer ${set}  assist ${f.assist ?? 'default'}  fine ${f.fine ? 'SHIFT' : 'off'}`,
      `lap ${lap(s.lastLap)} best ${lap(s.bestLap)}  keys ${perS.toFixed(1)}/s  yaw jitter ${jitter.toFixed(3)}  walls ${s.walls}  spins ${s.spins}`,
    ];
  }
}
