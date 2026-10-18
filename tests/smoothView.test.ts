import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { CAR_DIRECTIONS, carDirIndex, carGlowSprite, PLAYER_DIRECTIONS, playerCarSprite, prewarmPlayerCar } from '../src/gfx/vehicles';
import { clampCamera } from '../src/gfx/world';
import { Input } from '../src/input';
import { computeLayout, layout, setLayout } from '../src/layout';
import type { Car } from '../src/race/car';
import { Race } from '../src/race/race';
import { RaceCamera } from '../src/states/race/camera';
import { PlayerControls } from '../src/states/race/controls';
import type { Track } from '../src/track/common';
import { drawing, resetDrawing } from './sim/browser';

// The player's turn as shown on screen: the top-down sprite at fine headings, the top-down camera and
// the cockpit wheel drawn between simulation steps.

const STEP = 1 / CONFIG.STEP_HZ;
const TURN = Math.PI * 2;

describe('the player car at fine headings', () => {
  it('picks the nearest of n directions, wrapping both ways', () => {
    const step = TURN / PLAYER_DIRECTIONS;
    expect(carDirIndex(0, PLAYER_DIRECTIONS)).toBe(0);
    expect(carDirIndex(step * 0.49, PLAYER_DIRECTIONS)).toBe(0);
    expect(carDirIndex(step * 0.51, PLAYER_DIRECTIONS)).toBe(1);
    expect(carDirIndex(-step, PLAYER_DIRECTIONS)).toBe(PLAYER_DIRECTIONS - 1);
    expect(carDirIndex(TURN - step * 0.4, PLAYER_DIRECTIONS)).toBe(0);
    expect(carDirIndex(2 * TURN + 3 * step, PLAYER_DIRECTIONS)).toBe(3);
    expect(carDirIndex(Math.PI / 2)).toBe(CAR_DIRECTIONS / 4);
  });

  it('a 3° turn shows on the player car, not on an AI car', () => {
    const h = (3 * Math.PI) / 180;
    expect(carDirIndex(h, PLAYER_DIRECTIONS)).toBe(1);
    expect(carDirIndex(h)).toBe(0);
  });

  it('every fourth direction is the shared sprite at the same angle; the rest are the player colour only', () => {
    const ratio = PLAYER_DIRECTIONS / CAR_DIRECTIONS;
    for (let d = 0; d < PLAYER_DIRECTIONS; d += ratio) {
      expect(carDirIndex((d / PLAYER_DIRECTIONS) * TURN)).toBe(d / ratio);
      expect(playerCarSprite(3, d)).toBe(carGlowSprite(3, d / ratio));
    }
    const fine = playerCarSprite(3, 5);
    expect(playerCarSprite(3, 5)).toBe(fine);
    // the AI cache keys `colour:direction` count in 32 directions: its 3:5 and 3:1 are other sprites
    expect(carGlowSprite(3, 5)).not.toBe(fine);
    expect(carGlowSprite(3, 1)).not.toBe(fine);
    // one colour at a time: a race with another player colour drops these sprites
    expect(playerCarSprite(4, 5)).not.toBe(fine);
    expect(playerCarSprite(3, 5)).not.toBe(fine);
  });

  it('the start lights draw all of them, a few per step', () => {
    prewarmPlayerCar(6, 8);
    resetDrawing();
    playerCarSprite(6, 7);
    expect(drawing.calls).toBe(0);
    playerCarSprite(6, 9);
    expect(drawing.calls).toBeGreaterThan(0);
    for (let i = 0; i < PLAYER_DIRECTIONS / 8; i++) prewarmPlayerCar(6, 8);
    resetDrawing();
    for (let d = 0; d < PLAYER_DIRECTIONS; d++) playerCarSprite(6, d);
    expect(drawing.calls).toBe(0);
  });
});

describe('drawn between steps', () => {
  it('the top-down camera leads from its last step to this one by the frame alpha', () => {
    setLayout(computeLayout(640, 480));
    let heading = 0;
    const track = { worldW: 4000, worldH: 4000, headingAt: () => heading } as unknown as Track;
    const car = { x: 2000, y: 2000 } as Car;
    const v = layout.view;
    const camFor = (ox: number, oy: number) => clampCamera(Math.round(2000 + ox), Math.round(2000 + oy), v.w, v.h, 4000, 4000);
    const L = CONFIG.CAMERA_LEAD_2D;
    const cam = new RaceCamera();
    cam.update(track, car, STEP);
    expect(cam.at(track, car, 2000, 2000, 0.3)).toEqual(camFor(L, 0));
    heading = Math.PI / 2;
    // half way to the new lead in one step
    cam.update(track, car, CONFIG.CAMERA_LEAD_S / 2);
    expect(cam.at(track, car, 2000, 2000, 0)).toEqual(camFor(L, 0));
    expect(cam.at(track, car, 2000, 2000, 0.5)).toEqual(camFor((L * 3) / 4, L / 4));
    expect(cam.at(track, car, 2000, 2000, 1)).toEqual(camFor(L / 2, L / 2));
  });

  it('the cockpit wheel shows the player steering at once, from the last step to this one', () => {
    const input = new Input(new EventTarget() as unknown as Window);
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 1, false);
    race.start();
    race.player.speed = 80;
    const controls = new PlayerControls();
    controls.update(input, race, STEP);
    expect(controls.steerShown(1)).toBe(0);
    input.setVirtual('right', true);
    const drive = controls.update(input, race, STEP);
    expect(drive.steer).toBeGreaterThan(0);
    expect(controls.steerShown(0)).toBe(0);
    expect(controls.steerShown(0.5)).toBeCloseTo(drive.steer / 2, 10);
    expect(controls.steerShown(1)).toBe(drive.steer);
  });
});
