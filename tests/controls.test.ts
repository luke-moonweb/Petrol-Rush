import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { Input } from '../src/input';
import { Race } from '../src/race/race';
import { PlayerControls } from '../src/states/race/controls';
import { pointAt, S_BOTTOM } from '../src/track/oval';
import './sim/browser';

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
    // (a one-step tap: STEER_GAMMA keeps it small, 7 % of the cap)
    expect(controls.wheel).toBeGreaterThan(0.05);
  });
});

describe('player controls: the wheel let go (STEERING_PLAN B6)', () => {
  it('under the pit autopilot the keys do not turn the wheel; once it hands back, a key steers and the straight assist acts after it', () => {
    const { target, race, controls, step } = setup();
    race.pitAuto = true;
    key(target, 'keydown', 'ArrowRight');
    step(10);
    expect(controls.wheel).toBe(0);
    race.pitAuto = false;
    expect(step().steer).toBeGreaterThan(0);
    key(target, 'keyup', 'ArrowRight');
    const out = step(15);
    expect(out.steer).toBe(0);
    expect(out.straightTo).toBeDefined();
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
