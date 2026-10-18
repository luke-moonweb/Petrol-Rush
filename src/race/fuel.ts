import { CONFIG } from '../config';
import type { Track } from '../track/common';
import { type Car, progress } from './car';

// Fuel pays for the work the engine does, in the game's own terms (speeds in mph, so work in mph^2):
// - on the gas: the speed gained (half the gain in v^2) plus DRAG times the distance; less drag in
//   another car's slipstream;
// - off the gas: DRAG less the coasting deceleration, times the distance (what coasting loses is
//   bought back on the gas later).
// So holding a speed costs the same as pulsing the gas around it, a longer line costs more, and every
// mph scrubbed off by the brakes, a slide or a crash has to be bought back. A full tank lasts
// FUEL_RANGE_LAPS of the oval at the normal pace (LAP_WORK a lap): the same distance on every track,
// and fewer laps on a longer circuit.

/** Pixels a full tank lasts at the normal pace. */
export const FUEL_RANGE_PX = CONFIG.FUEL.RANGE_PX;

const F = CONFIG.FUEL;
const TANK_WORK = CONFIG.FUEL_RANGE_LAPS * F.LAP_WORK;

/** Burns the fuel for one step: `dist` px driven, `v0` the speed (mph) before the step, `gas` the engine pulling. */
export function burnFuel(car: Car, dist: number, v0: number, gas: boolean): void {
  if (car.finished) return;
  const run = Math.abs(dist) / CONFIG.PX_PER_MPH;
  let work = run * (F.DRAG - CONFIG.COAST_MPH_S);
  if (gas) {
    work = run * F.DRAG * (1 - F.DRAFT_CUT * car.draft);
    work += Math.max(0, car.speed * car.speed - v0 * v0) / 2;
  }
  car.fuel = Math.max(0, car.fuel - work / TANK_WORK);
}

/** How far into another car's slipstream `car` is: 1 right behind it, 0 out of it. */
export function draftOf(car: Car, cars: readonly Car[], track: Track): number {
  if (car.speed < F.DRAFT_MIN_MPH || car.pitSide) return 0;
  let best = 0;
  for (const o of cars) {
    if (o === car || o.pitSide || o.speed < F.DRAFT_MIN_MPH) continue;
    const ds = track.deltaS(car.s, o.s);
    if (ds <= 0 || ds > F.DRAFT_PX || Math.abs(o.d - car.d) > F.DRAFT_HALF_W) continue;
    best = Math.max(best, 1 - ds / F.DRAFT_PX);
  }
  return best;
}

/** Fuel one lap of `track` takes at the normal pace. */
export function nominalLapFuel(track: Pick<Track, 'len'>): number {
  return track.len / FUEL_RANGE_PX;
}

/** Laps of `track` the fuel in the tank lasts at the normal pace. */
export function fuelLaps(fuel: number, track: Pick<Track, 'len'>): number {
  return fuel / nominalLapFuel(track);
}

/**
 * At the start/finish line: logs what the last lap took (a lap with a refuel or the first, partial
 * lap from the grid does not count) into the car's running estimate.
 */
export function logLapFuel(car: Car): void {
  const log = car.ai;
  if (log.lapFuel >= 0 && !log.refuelledThisLap && car.fuel < log.lapFuel) {
    log.fuelPerLap += (log.lapFuel - car.fuel - log.fuelPerLap) * F.LAP_LOG_GAIN;
  }
  log.lapFuel = car.fuel;
  log.refuelledThisLap = false;
}

/** Laps the fuel in the tank lasts at the car's own recent rate. */
export function lapsOfFuel(car: Car): number {
  return car.fuel / car.ai.fuelPerLap;
}

/** Laps (fractional) from where the car is to the finish. */
export function lapsToFinish(car: Car, track: Track, laps: number): number {
  return Math.max(0, laps - progress(car, track) / track.len);
}

/** What an AI driver fills the tank to: enough to finish with a margin, at most full. */
export function fillTarget(car: Car, track: Track, laps: number): number {
  const need = (lapsToFinish(car, track, laps) + CONFIG.AI_FILL_MARGIN_LAPS) * car.ai.fuelPerLap * (1 + F.EST_MARGIN);
  return Math.min(0.999, need);
}

/**
 * An AI driver short of fuel for the finish by no more than lifting can make up (its `fuelSave`
 * share of AI_ECO.GAIN) eases off instead of stopping.
 */
export function canSaveToFinish(car: Car, track: Track, laps: number): boolean {
  const need = lapsToFinish(car, track, laps) + CONFIG.AI_ECO.MARGIN_LAPS;
  const have = lapsOfFuel(car);
  return have < need && have * (1 + CONFIG.AI_ECO.GAIN * car.ai.fuelSave) >= need;
}
