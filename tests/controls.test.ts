import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { Input } from '../src/input';
import { Race } from '../src/race/race';
import { PlayerSteering } from '../src/race/steering';
import { PlayerControls } from '../src/states/race/controls';
import { NO_STEER_FLAGS, readSteerFlags } from '../src/states/race/steerPlaytest';
import { pointAt, S_BOTTOM, S_TURN1 } from '../src/track/oval';
import './sim/browser';
import { freshCar } from './sim/drivers';

// The player's keys turned into the drive input (src/states/race/controls.ts) and the key order (src/input.ts).

const STEP = 1 / CONFIG.STEP_HZ;
const key = (target: EventTarget, type: 'keydown' | 'keyup', code: string) =>
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false, metaKey: false }));

/** A started race with the player at 120 mph on the bottom straight. */
function setup() {
  const target = new EventTarget();
  const input = new Input(target as unknown as Window);
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 1, false);
  race.start();
  const p = pointAt(S_BOTTOM + 100, 0);
  Object.assign(race.player, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: 120, s: S_BOTTOM + 100, d: 0 });
  const controls = new PlayerControls();
  const step = (n = 1) => {
    let d = controls.update(input, race, STEP);
    input.endStep();
    for (let i = 1; i < n; i++) {
      d = controls.update(input, race, STEP);
      input.endStep();
    }
    return d;
  };
  return { target, input, race, controls, step };
}

describe('player controls: keys (STEERING_PLAN B5)', () => {
  it('with both arrows held the one pressed last steers; letting it go gives the other back', () => {
    const { target, step } = setup();
    key(target, 'keydown', 'ArrowRight');
    expect(step(10).steer).toBeGreaterThan(0);
    key(target, 'keydown', 'ArrowLeft');
    expect(step(10).steer).toBeLessThan(0);
    key(target, 'keyup', 'ArrowLeft');
    expect(step(10).steer).toBeGreaterThan(0);
  });

  it('touch buttons follow the same order', () => {
    const { input, step } = setup();
    input.setVirtual('left', true);
    input.setVirtual('right', true);
    expect(step(10).steer).toBeGreaterThan(0);
  });

  it('a tap shorter than a step still steers for one step', () => {
    const { target, controls, step } = setup();
    key(target, 'keydown', 'ArrowRight');
    key(target, 'keyup', 'ArrowRight');
    expect(step().steer).toBeGreaterThan(0);
    expect(controls.wheel).toBeGreaterThan(0.1);
  });
});

describe('player controls: the wheel let go (STEERING_PLAN B6)', () => {
  it('under the pit autopilot the keys do not turn the wheel; a key held as it hands back is not a fresh press', () => {
    const { target, race, controls, step } = setup();
    race.pitAuto = true;
    key(target, 'keydown', 'ArrowRight');
    step(10);
    expect(controls.wheel).toBe(0);
    race.pitAuto = false;
    expect(step().steer).toBeGreaterThan(0);
    key(target, 'keyup', 'ArrowRight');
    // the held key was carried: once let go, the straight assist is still on
    expect(step(15).straightTo).toBeDefined();
    // a fresh press on the straight turns it off
    key(target, 'keydown', 'ArrowRight');
    step(2);
    key(target, 'keyup', 'ArrowRight');
    expect(step(15).straightTo).toBeUndefined();
  });

  it('a pause or a lost focus centres the wheel', () => {
    const { target, controls, step } = setup();
    key(target, 'keydown', 'ArrowLeft');
    step(10);
    expect(controls.wheel).toBeLessThan(0);
    controls.release();
    expect(controls.wheel).toBe(0);
  });
});

describe('playtest flags (STEERING_PLAN B7, removed before merge)', () => {
  it('are read only with debug', () => {
    expect(readSteerFlags(new URLSearchParams('steer=E&assist=0.15&fine=1'))).toEqual(NO_STEER_FLAGS);
    expect(readSteerFlags(new URLSearchParams('debug&steer=E&assist=0.15&fine=1'))).toEqual({ steer: 'E', assist: 0.15, fine: true });
    expect(readSteerFlags(new URLSearchParams('debug&steer=x&assist=y'))).toEqual(NO_STEER_FLAGS);
  });

  it('steer=old drives the old ramp (a press starts at 0.3 of full lock in a bend)', () => {
    const car = freshCar();
    const p = pointAt(S_TURN1 + 100, 0);
    Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: 60, s: S_TURN1 + 100, d: 0 });
    expect(Math.abs(new PlayerSteering(undefined, { set: 'old' }).update(car, -1, STEP).steer)).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(new PlayerSteering(undefined, { set: 'B' }).update(car, -1, STEP).steer)).toBeLessThan(0.3);
  });

  it('assist=0 takes the corner assist away', () => {
    const car = freshCar();
    const p = pointAt(S_TURN1 + 100, 0);
    Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: 150, s: S_TURN1 + 100, d: 0 });
    const steerAfter = (ps: PlayerSteering) => {
      let st = 0;
      for (let i = 0; i < 30; i++) st = ps.update(car, 0, STEP).steer;
      return st;
    };
    expect(steerAfter(new PlayerSteering())).toBeLessThan(0);
    expect(steerAfter(new PlayerSteering(undefined, { set: 'B', assist: 0 }))).toBe(0);
  });

  it('the precision key holds the wheel at STEER_FINE, and lets it back there from the stop', () => {
    const car = freshCar();
    const p = pointAt(S_BOTTOM + 100, 0);
    Object.assign(car, { x: p.x, y: p.y, heading: p.heading, moveAngle: p.heading, speed: 150, s: S_BOTTOM + 100, d: 0 });
    for (const set of ['B', 'E'] as const) {
      const ps = new PlayerSteering(undefined, { set });
      for (let i = 0; i < 40; i++) ps.update(car, 1, STEP, false, true);
      expect(ps.wheel, set).toBeCloseTo(CONFIG.STEER_FINE, 2);
      for (let i = 0; i < 40; i++) ps.update(car, 1, STEP);
      expect(ps.wheel, set).toBe(1);
      for (let i = 0; i < 60; i++) ps.update(car, 1, STEP, false, true);
      expect(ps.wheel, set).toBeCloseTo(CONFIG.STEER_FINE, 2);
    }
  });
});
