import { CONFIG, DEFAULT_OPTIONS, type Difficulty } from '../../src/config';
import type { Car, PitPhase } from '../../src/race/car';
import { Race } from '../../src/race/race';
import { getTrack } from '../../src/track/tracks';

// A pit-lane race: 20 cars, every one starting with `fuel0` of a tank, so with a low tank the whole field pits
// within a few laps (the busy case). Counted per race: the stops (refuelling starts), the stops with a contact
// in the pits (either car on the pit side of the wall or on pit tarmac, while on its way in or out), the
// contacts by the phases of the two cars, the merge contacts (a car that has left the pit side, with a racing
// car), how long each car waited in its box after refuelling (until it rolled 15 px), the longest a car stood
// on the pit road outside its box, and the cars that did not finish.

/** A pair's contact is a new one once the two cars have been apart this long (s). */
const APART_S = 1;

export interface PitRaceOptions {
  track: string;
  seed: number;
  laps: number;
  fuel0: number;
  difficulty?: Difficulty;
  /** Called after every step (for a trace). */
  onStep?: (race: Race) => void;
  /** Called for every new pit contact (`merge`: a car that has left the pit side, with a racing car). */
  onContact?: (race: Race, a: Car, b: Car, merge: boolean) => void;
}

export interface PitRaceStats {
  race: Race;
  stops: number;
  /** Stops in which the car touched another car in the pits (on its way in, in the box or on its way out). */
  hitStops: number;
  /** Pit contacts by the phases of the two cars: e entering, f refuelling or parked, x exiting, n racing. */
  kinds: Map<string, number>;
  merge: number;
  /** Per stop, seconds from the end of refuelling until the car rolled out of its box. */
  waits: number[];
  /** The longest a car on its way in or out stood (under 2 mph) on the pit road outside its box (s). */
  maxStand: number;
  /** Mean heading (rad, unsigned) of the cars as they stop in their boxes. */
  parkHeading: number;
  unfinished: Car[];
  /** Spins in the race (anywhere). */
  spins: number;
  /** Cars that gave a stop up on the way in (back to racing without refuelling). */
  gaveUp: number;
}

export const phaseCode = (p: PitPhase): string => ({ none: 'n', entering: 'e', fueling: 'f', parked: 'f', exiting: 'x' })[p];

export function runPitRace(o: PitRaceOptions): PitRaceStats {
  const track = getTrack(o.track);
  const pit = track.pit;
  const opts = { ...DEFAULT_OPTIONS, track: o.track, cars: 20, laps: o.laps, qualifying: 'middle' as const };
  if (o.difficulty) opts.difficulty = o.difficulty;
  const r = new Race(opts, o.seed, true, undefined, track);
  for (const c of r.cars) c.fuel = o.fuel0;
  r.start();
  const n = r.cars.length;
  const inPits = (c: Car) => c.ai.pitPhase !== 'none' && ((c.pitSide && c.wasInPit) || pit.inLane(c.x, c.y));
  const s: PitRaceStats = {
    race: r,
    stops: 0,
    hitStops: 0,
    kinds: new Map(),
    merge: 0,
    waits: [],
    maxStand: 0,
    parkHeading: 0,
    unfinished: [],
    spins: 0,
    gaveUp: 0,
  };
  const lastTouch = new Map<number, number>();
  const visitHit = r.cars.map(() => false);
  const wasFueling = r.cars.map(() => false);
  const waitFrom = r.cars.map(() => -1);
  const waitAt = r.cars.map(() => ({ x: 0, y: 0 }));
  const stand = r.cars.map(() => 0);
  const dt = 1 / CONFIG.STEP_HZ;
  while (!r.allFinished() && r.time < o.laps * 90 + 60) {
    const before = r.cars.map((c) => c.ai.pitPhase);
    r.step(dt, null);
    o.onStep?.(r);
    for (let i = 0; i < n; i++) {
      const a = r.cars[i]!;
      if (a.contactStrength <= 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = r.cars[j]!;
        if (b.contactStrength <= 0 || Math.hypot(a.x - b.x, a.y - b.y) > 44) continue;
        const key = i * n + j;
        const seen = lastTouch.get(key) ?? -99;
        lastTouch.set(key, r.time);
        if (r.time - seen < APART_S) continue;
        const pa = inPits(a);
        const pb = inPits(b);
        if (pa || pb) {
          const k = [phaseCode(a.ai.pitPhase), phaseCode(b.ai.pitPhase)].sort().join('');
          s.kinds.set(k, (s.kinds.get(k) ?? 0) + 1);
          if (pa) visitHit[i] = true;
          if (pb) visitHit[j] = true;
          o.onContact?.(r, a, b, false);
        } else if (a.ai.pitPhase === 'exiting' || b.ai.pitPhase === 'exiting') {
          s.merge++;
          o.onContact?.(r, a, b, true);
        }
      }
    }
    r.cars.forEach((c, i) => {
      const moving = c.ai.pitPhase === 'entering' || (c.ai.pitPhase === 'exiting' && c.ai.pullOut !== 1);
      stand[i] = moving && Math.abs(c.speed) < 2 && inPits(c) ? stand[i]! + dt : 0;
      s.maxStand = Math.max(s.maxStand, stand[i]!);
      const f = c.ai.pitPhase === 'fueling' || c.ai.pitPhase === 'parked';
      if (f && !wasFueling[i]) {
        s.stops++;
        s.parkHeading += Math.abs(Math.atan2(Math.sin(c.heading), Math.cos(c.heading)));
      }
      wasFueling[i] = f;
      if (before[i] === 'fueling' && c.ai.pitPhase === 'exiting') {
        waitFrom[i] = r.time;
        waitAt[i] = { x: c.x, y: c.y };
      }
      if (waitFrom[i]! >= 0 && Math.hypot(c.x - waitAt[i]!.x, c.y - waitAt[i]!.y) > 15) {
        s.waits.push(r.time - waitFrom[i]!);
        waitFrom[i] = -1;
      }
      if (before[i] === 'entering' && c.ai.pitPhase === 'none') s.gaveUp++;
      // (a visit ends when the car is back racing)
      if (before[i] !== 'none' && c.ai.pitPhase === 'none') {
        if (visitHit[i]) s.hitStops++;
        visitHit[i] = false;
      }
    });
  }
  s.hitStops += visitHit.filter(Boolean).length;
  s.parkHeading /= Math.max(1, s.stops);
  s.unfinished = r.cars.filter((c) => !c.finished);
  s.spins = r.cars.reduce((a, c) => a + c.crashes, 0);
  return s;
}
