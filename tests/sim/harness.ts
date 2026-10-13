import { CONFIG, DEFAULT_OPTIONS, type Qualifying } from '../../src/config';
import { aiInput } from '../../src/race/ai';
import { NO_INPUT } from '../../src/race/physics';
import { Race } from '../../src/race/race';
import type { Track } from '../../src/track/common';

export interface RunOptions {
  track: Track;
  seed: number;
  cars?: number;
  laps: number;
  fuel0?: number;
  qualifying?: Qualifying;
  /** Drive the player through the human input path (pit autopilot included). */
  humanPlayer?: boolean;
  maxTime?: number;
}

export interface RunStats {
  race: Race;
  finished: number;
  pitStops: Map<number, number>;
  /** Longest time any car stood still outside the pits, in seconds. */
  maxStill: number;
  wallHits: number;
  spins: number;
  offWorld: number;
  pitAutoSteps: number;
}

export function runRace(o: RunOptions): RunStats {
  const race = new Race(
    { ...DEFAULT_OPTIONS, track: o.track.id, cars: o.cars ?? 20, laps: o.laps, qualifying: o.qualifying ?? 'middle' },
    o.seed,
    !o.humanPlayer,
    undefined,
    o.track,
  );
  if (o.fuel0 !== undefined) for (const c of race.cars) c.fuel = o.fuel0;
  race.start();
  const dt = 1 / CONFIG.STEP_HZ;
  const pitStops = new Map<number, number>();
  const fueling = new Set<number>();
  const still = new Map<number, number>();
  let maxStill = 0;
  let wallHits = 0;
  let offWorld = 0;
  let pitAutoSteps = 0;
  const maxTime = o.maxTime ?? o.laps * 60 + 60;
  while (!race.allFinished() && race.time < maxTime) {
    let input = null;
    if (o.humanPlayer) {
      const view = { track: o.track, cars: race.cars, started: true, laps: race.laps, time: race.time, oil: race.oil };
      input = race.pitAuto ? NO_INPUT : aiInput(race.player, view, dt);
    }
    race.step(dt, input);
    if (race.pitAuto) pitAutoSteps++;
    for (const c of race.cars) {
      if (c.wallImpact > 0) wallHits++;
      const ok =
        [c.x, c.y, c.speed, c.heading].every(Number.isFinite) && c.x > 0 && c.y > 0 && c.x < o.track.worldW && c.y < o.track.worldH;
      if (!ok) offWorld++;
      if (c.refueling && !fueling.has(c.id)) {
        fueling.add(c.id);
        pitStops.set(c.id, (pitStops.get(c.id) ?? 0) + 1);
      }
      if (!c.refueling) fueling.delete(c.id);
      const parked = c.finished || c.ai.pitPhase === 'fueling' || c.ai.pitPhase === 'parked' || c.refueling;
      const t = Math.abs(c.speed) < 2 && !parked && race.time > 3 ? (still.get(c.id) ?? 0) + dt : 0;
      still.set(c.id, t);
      maxStill = Math.max(maxStill, t);
    }
  }
  return {
    race,
    finished: race.cars.filter((c) => c.finished).length,
    pitStops,
    maxStill,
    wallHits,
    spins: race.cars.reduce((a, c) => a + c.crashes, 0),
    offWorld,
    pitAutoSteps,
  };
}
