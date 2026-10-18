import { CONFIG, DEFAULT_OPTIONS, type Difficulty } from '../../src/config';
import { aiInput } from '../../src/race/ai';
import type { Car } from '../../src/race/car';
import type { DriveInput } from '../../src/race/physics';
import { Race } from '../../src/race/race';
import { getTrack } from '../../src/track/tracks';

// The player stops on a straight: it races under the AI (through the human input path) until it is on a
// long straight with cars close behind, then brakes hard to a stop and stands there for `hold` s. For every
// AI car that comes up behind it, the outcome: a pass, a contact near the player, a stall (standing behind
// it), a spin. Cars already too close to stop behind it when the braking began are "late".

export interface StopOutcome {
  car: Car;
  passed: boolean;
  /** Seconds it stood still (under 5 mph) up to 140 px behind the player. */
  still: number;
  contact: boolean;
  spun: boolean;
  late: boolean;
}

export interface StopEvent {
  /** The cars that came up behind the player (passed, stood or touched). */
  outcomes: StopOutcome[];
  /** No AI car spun: no pile-up behind the player. */
  clean: boolean;
  /** The player's d where it stood. */
  playerD: number;
}

export interface StopOptions {
  hold?: number;
  /** A d the player steers to while braking (default: where it is). */
  playerD?: number;
  /** Called every step once the player brakes (for a trace). */
  onStep?: (race: Race, phase: 'brake' | 'hold') => void;
}

/** One stop event (null if the player never got to a straight with cars behind it). */
export function runStopEvent(trackId: string, seed: number, difficulty: Difficulty, o: StopOptions = {}): StopEvent | null {
  const track = getTrack(trackId);
  const race = new Race(
    { ...DEFAULT_OPTIONS, difficulty, track: trackId, cars: 20, laps: 6, qualifying: 'middle' },
    seed,
    false,
    undefined,
    track,
  );
  race.start();
  const dt = 1 / CONFIG.STEP_HZ;
  const p = race.player;
  const view = () => ({ track, cars: race.cars, started: true, laps: race.laps, time: race.time, oil: race.oil });
  let phase: 'race' | 'brake' | 'hold' = 'race';
  let held = 0;
  const watched = new Map<Car, StopOutcome>();
  while (race.time < 400 && held <= (o.hold ?? 10)) {
    let input: DriveInput | null = race.pitAuto ? null : aiInput(p, view(), dt);
    if (phase === 'race' && readyToStop(race)) {
      phase = 'brake';
      for (const c of race.cars)
        if (c !== p) watched.set(c, { car: c, passed: false, still: 0, contact: false, spun: false, late: late(race, c) });
    }
    if (phase !== 'race') {
      const steer = o.playerD !== undefined && phase === 'brake' ? Math.max(-1, Math.min(1, (p.d - o.playerD) * 0.02)) : 0;
      input = { steer, gas: false, brake: true, toggleReverse: false };
      if (phase === 'brake' && Math.abs(p.speed) < 1) phase = 'hold';
      if (phase === 'hold') held += dt;
    }
    race.step(dt, input);
    if (phase === 'race') continue;
    o.onStep?.(race, phase);
    for (const w of watched.values()) watch(race, w, dt);
  }
  if (phase === 'race') return null;
  const outcomes = [...watched.values()].filter((w) => w.passed || w.still > 0 || w.contact);
  return { outcomes, clean: ![...watched.values()].some((w) => w.spun), playerD: p.d };
}

/** On a long straight, at speed, with AI cars close behind. */
function readyToStop(race: Race): boolean {
  const p = race.player;
  const track = race.track;
  const curves = track.curves();
  const straight = curves.at(p.s) === 0 && curves.maxAbsAhead(p.s, 520, 8) === 0;
  const behind = race.cars.some((c) => c !== p && track.deltaS(p.s, c.s) < -40 && track.deltaS(p.s, c.s) > -260);
  return race.time > 25 && !race.pitAuto && p.ai.pitPhase === 'none' && p.speed > 100 && straight && behind && p.spinTime <= 0;
}

/** Too close to stop behind the player braking from here: its braking distance plus a reaction, against the player's. */
function late(race: Race, c: Car): boolean {
  const pxm = CONFIG.PX_PER_MPH;
  const ds = -race.track.deltaS(race.player.s, c.s);
  const need = (c.speed * c.speed * pxm) / (2 * CONFIG.BRAKE_MPH_S) + c.speed * pxm * 0.3;
  const playerStop = (race.player.speed ** 2 * pxm) / (2 * CONFIG.BRAKE_MPH_S_HIGH);
  return ds > 0 && ds < 400 && ds + playerStop < need;
}

function watch(race: Race, w: StopOutcome, dt: number): void {
  const p = race.player;
  const c = w.car;
  const ds = race.track.deltaS(p.s, c.s);
  if (ds < -600 || (ds > 200 && !w.passed)) return;
  if (ds > 30 && ds < 200) w.passed = true;
  if (c.spinTime > 0) w.spun = true;
  if (c.contactStrength > 0 && Math.hypot(c.x - p.x, c.y - p.y) < 46) w.contact = true;
  if (ds < 0 && ds > -140 && Math.abs(c.speed) < 5 && c.spinTime <= 0) w.still += dt;
}
