import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import type { Car } from '../src/race/car';
import { Race } from '../src/race/race';
import { boxX, PIT_BOX_Y, PIT_DRIVE_Y } from '../src/track/oval';
import { DRIVE_WALLWARD } from '../src/track/pitAi';

// A car that has refuelled has right of way over a car still going to its box (track/pitAi.ts): the one
// coming down the pit lane stops for it if it can; only one too close to stop goes by first.

const BOX = 5;

function place(car: Car, x: number, y: number, mph: number): void {
  Object.assign(car, { x, y, prevX: x, prevY: y, heading: 0, moveAngle: 0, prevHeading: 0, speed: mph, pitSide: true, wasInPit: true });
}

/** Car 0 has just refuelled in box BOX; car 1 comes down the drive row `behind` px back at pit speed, for box 12. */
function scene(behind: number): { race: Race; out: Car; inn: Car } {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 2, laps: 5 }, 1, true);
  race.start();
  race.time = 30;
  const [out, inn] = race.cars as [Car, Car];
  place(out, boxX(BOX), PIT_BOX_Y, 0);
  out.fuel = 1;
  out.ai.box = BOX;
  out.ai.pitPhase = 'fueling';
  place(inn, boxX(BOX) - behind, PIT_DRIVE_Y + DRIVE_WALLWARD, CONFIG.AI_PIT_MPH);
  inn.fuel = 0.2;
  inn.ai.box = 12;
  inn.ai.pitPhase = 'entering';
  return { race, out, inn };
}

/** Steps until the car coming in is well past the box; when the one leaving first moved, and any contact. */
function run(behind: number): { outMoved: number; innPassed: number; contact: boolean; innStopped: boolean; innX: number } {
  const { race, out, inn } = scene(behind);
  const bx = boxX(BOX);
  let outMoved = -1;
  let innPassed = -1;
  let contact = false;
  let innStopped = false;
  let innX = 0;
  for (let i = 0; i < 6 * CONFIG.STEP_HZ && inn.x < bx + 200; i++) {
    race.step(1 / CONFIG.STEP_HZ, null);
    if (out.contactStrength > 0 || inn.contactStrength > 0) contact = true;
    if (outMoved < 0 && out.speed > 2) {
      outMoved = race.time;
      innX = inn.x;
    }
    if (innPassed < 0 && inn.x > bx) innPassed = race.time;
    if (inn.speed < 2) innStopped = true;
  }
  return { outMoved, innPassed, contact, innStopped, innX };
}

describe('leaving the pit box', () => {
  it('a car coming in that can stop gives way: the car in the box pulls out first', () => {
    const r = run(250);
    expect(r.contact).toBe(false);
    expect(r.outMoved).toBeGreaterThan(0);
    expect(r.outMoved).toBeLessThan(30.5);
    expect(r.innX).toBeLessThan(boxX(BOX) - 150);
    expect(r.innPassed).toBeGreaterThan(r.outMoved);
  });

  it('it also stops for a car still waiting in its box', () => {
    // (a car out of fuel stands on the drive row just past the box, so the car in the box has to wait)
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 3, laps: 5 }, 1, true);
    race.start();
    race.time = 30;
    const [out, inn, stuck] = race.cars as [Car, Car, Car];
    place(out, boxX(BOX), PIT_BOX_Y, 0);
    Object.assign(out, { fuel: 1 });
    Object.assign(out.ai, { box: BOX, pitPhase: 'fueling' });
    place(inn, boxX(BOX) - 400, PIT_DRIVE_Y + DRIVE_WALLWARD, CONFIG.AI_PIT_MPH);
    Object.assign(inn, { fuel: 0.2 });
    Object.assign(inn.ai, { box: 12, pitPhase: 'entering' });
    place(stuck, boxX(BOX) + 30, PIT_DRIVE_Y + DRIVE_WALLWARD, 0);
    Object.assign(stuck, { fuel: 0 });
    Object.assign(stuck.ai, { box: 19, pitPhase: 'entering' });
    for (let i = 0; i < 5 * CONFIG.STEP_HZ; i++) race.step(1 / CONFIG.STEP_HZ, null);
    expect(out.ai.pullOut).toBe(1);
    expect(inn.speed).toBeLessThan(2);
    expect(out.x - inn.x).toBeGreaterThan(40);
    expect(inn.contactStrength).toBe(0);
  });

  it('a car coming in too close to stop goes by first, then the car in the box pulls out', () => {
    const r = run(60);
    expect(r.contact).toBe(false);
    expect(r.innStopped).toBe(false);
    expect(r.innPassed).toBeGreaterThan(0);
    expect(r.outMoved).toBeGreaterThan(r.innPassed);
  });
});
