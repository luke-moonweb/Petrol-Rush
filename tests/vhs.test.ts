import { describe, expect, it } from 'vitest';
import { GameAudio } from '../src/audio/audio';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { VHS_CUT_S, VHS_S, VhsGlitch, vhsRoll, vhsStrength } from '../src/gfx/vhs';
import { Input } from '../src/input';
import { computeLayout, setLayout } from '../src/layout';
import type { Race } from '../src/race/race';
import { Game, readParams } from '../src/states/game';
import { RaceState } from '../src/states/race/state';
import { TitleState } from '../src/states/title';
import { drawing, resetDrawing, StubCanvas } from './sim/browser';

// The tape glitch that covers the switch from the top-down view to the cockpit (src/gfx/vhs.ts): its
// timeline, its drawing, and the race screen holding the top-down view until the cut.

const STEP = 1 / CONFIG.STEP_HZ;

function stubCanvas(): CanvasRenderingContext2D {
  const canvas = new StubCanvas();
  canvas.width = 1280;
  canvas.height = 960;
  return canvas.getContext();
}

describe('the VHS glitch timeline', () => {
  it('strikes at once, peaks at the cut and settles to nothing', () => {
    expect(vhsStrength(0)).toBeGreaterThan(0.3);
    expect(vhsStrength(VHS_CUT_S / 2)).toBeLessThan(vhsStrength(VHS_CUT_S));
    expect(vhsStrength(VHS_CUT_S)).toBe(1);
    let last = 1;
    for (let t = VHS_CUT_S; t < VHS_S; t += STEP) {
      expect(vhsStrength(t)).toBeLessThanOrEqual(last);
      last = vhsStrength(t);
    }
    expect(vhsStrength(VHS_S - STEP)).toBeLessThan(0.02);
    expect(vhsStrength(VHS_S)).toBe(0);
  });

  it('rolls the picture through the cut and locks it well before the end', () => {
    expect(vhsRoll(0)).toBe(0);
    expect(vhsRoll(VHS_CUT_S)).toBeGreaterThan(0);
    expect(vhsRoll(VHS_S / 2)).toBe(0);
  });

  it('keeps the top-down view until the cut, then shows the cockpit', () => {
    const glitch = new VhsGlitch();
    expect(glitch.active).toBe(false);
    expect(glitch.cockpitShown(true)).toBe(true);
    glitch.start();
    expect(glitch.cockpitShown(true)).toBe(false);
    glitch.update(VHS_CUT_S - STEP / 2);
    expect(glitch.cockpitShown(true)).toBe(false);
    glitch.update(STEP);
    expect(glitch.active).toBe(true);
    expect(glitch.cockpitShown(true)).toBe(true);
    expect(glitch.cockpitShown(false)).toBe(false);
    glitch.update(VHS_S);
    expect(glitch.active).toBe(false);
  });
});

describe('drawing the glitch', () => {
  it('draws while active, the same field the same way, and nothing once over', () => {
    const g = stubCanvas();
    const box = { x: 160, y: 30, w: 480, h: 360 };
    const glitch = new VhsGlitch();
    glitch.start();
    glitch.update(VHS_CUT_S);
    glitch.draw(g, box, 2); // the first one also makes the snow
    resetDrawing();
    glitch.draw(g, box, 2);
    const peak = { ...drawing };
    expect(peak.calls).toBeGreaterThan(200);
    resetDrawing();
    glitch.draw(g, box, 2);
    expect(drawing.hash).toBe(peak.hash);
    glitch.update(VHS_S);
    resetDrawing();
    glitch.draw(g, box, 2);
    expect(drawing.calls).toBe(0);
  });
});

describe('the camera switch on the race screen', () => {
  it('glitches only on the way into the cockpit, keeping the top-down view until the cut', () => {
    setLayout(computeLayout(640, 480));
    const input = new Input(new EventTarget() as unknown as Window);
    const game = new Game(input, new GameAudio(), readParams('?seed=7'), (g) => new TitleState(g));
    game.set(new RaceState(game, { ...DEFAULT_OPTIONS, track: 'oval', laps: 1 }, 'running'));
    const state = game.state as unknown as { race: Race; glitch: VhsGlitch };
    const run = (seconds: number) => {
      for (let i = Math.round(seconds * CONFIG.STEP_HZ); i > 0; i--) {
        game.state.update(STEP);
        input.endStep();
      }
    };
    const frame = () => {
      const g = stubCanvas();
      resetDrawing();
      g.setTransform(2, 0, 0, 2, 0, 0);
      game.state.render(g, 1);
      return drawing.calls;
    };
    run(9);
    expect(state.race.started).toBe(true);
    frame();
    const topDown = frame();

    input.tapVirtual('camera');
    run(STEP);
    expect(game.prefs.camera).toBe('cockpit');
    expect(state.glitch.active).toBe(true);
    expect(state.glitch.cockpitShown(true)).toBe(false);
    expect(frame()).toBeGreaterThan(topDown + 150);
    run(VHS_CUT_S + STEP);
    expect(state.glitch.cockpitShown(true)).toBe(true);
    frame();
    run(VHS_S);
    expect(state.glitch.active).toBe(false);

    // back to the top-down view: a plain cut, also in the middle of a glitch
    input.tapVirtual('camera');
    run(STEP);
    expect(game.prefs.camera).toBe('top');
    expect(state.glitch.active).toBe(false);
    input.tapVirtual('camera');
    run(STEP * 3);
    expect(state.glitch.active).toBe(true);
    input.tapVirtual('camera');
    run(STEP);
    expect(game.prefs.camera).toBe('top');
    expect(state.glitch.active).toBe(false);
  });
});
