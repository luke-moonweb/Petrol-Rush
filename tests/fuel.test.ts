import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import type { Car } from '../src/race/car';
import { lapsCompleted } from '../src/race/car';
import { burnFuel, canSaveToFinish, draftOf, FUEL_RANGE_PX, fillTarget, fuelLaps, nominalLapFuel } from '../src/race/fuel';
import { Race } from '../src/race/race';
import { gpTracks } from '../src/track/gp';
import { OVAL } from '../src/track/ovalTrack';

function lone(): Car {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 3, true);
  return race.player;
}

/** Fuel burnt over `steps` steps at a steady `mph`, the gas on or off. */
function burnAt(mph: number, gas: boolean, steps = 60, draft = 0): number {
  const car = lone();
  Object.assign(car, { speed: mph, draft });
  const dt = 1 / CONFIG.STEP_HZ;
  for (let i = 0; i < steps; i++) burnFuel(car, mph * CONFIG.PX_PER_MPH * dt, mph, gas);
  return 1 - car.fuel;
}

describe('fuel', () => {
  it('a full tank covers FUEL_RANGE_LAPS of the oval at the normal pace, the same distance everywhere', () => {
    expect(FUEL_RANGE_PX / OVAL.len).toBeCloseTo(CONFIG.FUEL_RANGE_LAPS, 2);
    for (const t of gpTracks()) expect(fuelLaps(1, t)).toBeCloseTo(FUEL_RANGE_PX / t.len, 6);
    expect(fuelLaps(1, gpTracks().at(-1)!)).toBeLessThan(fuelLaps(1, OVAL));
  });

  it('an AI driver alone on the oval does about FUEL_RANGE_LAPS laps on a tank', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 1, laps: 5 }, 1, true);
    race.start();
    const car = race.player;
    let at1 = -1;
    while (lapsCompleted(car) < 4 && race.time < 200) {
      race.step(1 / CONFIG.STEP_HZ, null);
      if (lapsCompleted(car) === 1 && at1 < 0) at1 = car.fuel;
    }
    const laps = 3 / (at1 - car.fuel);
    expect(laps).toBeGreaterThan(CONFIG.FUEL_RANGE_LAPS * 0.97);
    expect(laps).toBeLessThan(CONFIG.FUEL_RANGE_LAPS * 1.03);
    // the running estimate has caught up with what the laps took
    expect(car.ai.fuelPerLap).toBeCloseTo((at1 - car.fuel) / 3, 2);
  });

  it('burns by the distance: a longer line costs more, coasting costs less than the gas but not nothing', () => {
    expect(burnAt(150, true, 120)).toBeCloseTo(2 * burnAt(150, true, 60), 9);
    expect(burnAt(150, false)).toBeLessThan(burnAt(150, true));
    expect(burnAt(150, false)).toBeGreaterThan(0);
  });

  it('every mph lost has to be bought back: getting going again after a crash costs fuel', () => {
    const car = lone();
    const dt = 1 / CONFIG.STEP_HZ;
    Object.assign(car, { speed: 0 });
    for (let v = 0; v < 150; v += 1) {
      car.speed = v + 1;
      burnFuel(car, (v + 0.5) * CONFIG.PX_PER_MPH * dt, v, true);
    }
    const fromStop = 1 - car.fuel;
    // half of 150^2 on top of the drag: more than a tenth of a lap of the oval
    const gain = (150 * 150) / 2 / (CONFIG.FUEL_RANGE_LAPS * CONFIG.FUEL.LAP_WORK);
    expect(fromStop).toBeGreaterThan(gain);
    expect(gain / nominalLapFuel(OVAL)).toBeGreaterThan(0.1);
  });

  it('pulsing the gas costs the same as holding the speed', () => {
    // coast for a step, then buy the lost speed back
    const car = lone();
    const dt = 1 / CONFIG.STEP_HZ;
    const v = 170;
    const lost = CONFIG.COAST_MPH_S * dt;
    car.speed = v - lost;
    burnFuel(car, v * CONFIG.PX_PER_MPH * dt, v, false);
    car.speed = v;
    burnFuel(car, v * CONFIG.PX_PER_MPH * dt, v - lost, true);
    const pulsed = 1 - car.fuel;
    expect(pulsed).toBeCloseTo(burnAt(v, true, 2), 6);
  });

  it('the slipstream saves fuel on the gas', () => {
    expect(burnAt(170, true, 60, 1)).toBeCloseTo(burnAt(170, true) * (1 - CONFIG.FUEL.DRAFT_CUT), 9);
  });

  it('a car right behind another is in its slipstream; alongside or far back it is not', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 3, true);
    const [a, b] = race.cars as [Car, Car];
    const put = (c: Car, s: number, d: number) => Object.assign(c, { s, d, speed: 160, pitSide: false });
    put(a, 1000, 0);
    put(b, 1040, 0);
    expect(draftOf(a, race.cars, OVAL)).toBeCloseTo(1 - 40 / CONFIG.FUEL.DRAFT_PX, 6);
    expect(draftOf(b, race.cars, OVAL)).toBe(0);
    put(b, 1040, 30);
    expect(draftOf(a, race.cars, OVAL)).toBe(0);
    put(b, 1000 + CONFIG.FUEL.DRAFT_PX + 5, 0);
    expect(draftOf(a, race.cars, OVAL)).toBe(0);
  });

  it('an AI driver fills up to the finish with a margin, at most full', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 1, laps: 18 }, 3, true);
    const car = race.player;
    car.ai.fuelPerLap = 1 / 12;
    expect(fillTarget(car, OVAL, 18)).toBeCloseTo(0.999, 6);
    expect(fillTarget(car, OVAL, 3)).toBeLessThan(0.4);
    expect(fillTarget(car, OVAL, 3)).toBeGreaterThan(3 / 12);
  });

  it('only a driver who saves, and only when lifting can make the finish, eases off', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 1, laps: 4 }, 3, true);
    const car = race.player;
    car.ai.fuelPerLap = 1 / 12;
    const toFinish = 4 - (car.sectorsPassed * OVAL.sectorLen) / OVAL.len;
    car.ai.fuelSave = 1;
    car.fuel = (toFinish + CONFIG.AI_ECO.MARGIN_LAPS) / 12 / 1.03;
    expect(canSaveToFinish(car, OVAL, 4)).toBe(true);
    car.fuel = (toFinish + CONFIG.AI_ECO.MARGIN_LAPS) / 12 / 1.2;
    expect(canSaveToFinish(car, OVAL, 4)).toBe(false);
    car.fuel = 1;
    expect(canSaveToFinish(car, OVAL, 4)).toBe(false);
    car.ai.fuelSave = 0;
    car.fuel = (toFinish + CONFIG.AI_ECO.MARGIN_LAPS) / 12 / 1.03;
    expect(canSaveToFinish(car, OVAL, 4)).toBe(false);
  });
});
