import { describe, expect, it, vi } from 'vitest';
import './sim/browser';
import { GameAudio } from '../src/audio/audio';
import { CONFIG } from '../src/config';
import { tyreLoad } from '../src/states/race/sound';
import { freshCar } from './sim/drivers';

// The tyre hiss: a key player hears how close the tyres are to their limit (the audio itself is not heard in tests).

function carUsing(gripUse: number) {
  return Object.assign(freshCar(), { speed: 150, gripUse });
}

describe('tyre hiss', () => {
  it('is silent well below the limit and full at the key cap, rising smoothly between', () => {
    expect(tyreLoad(carUsing(0))).toBe(0);
    expect(tyreLoad(carUsing(0.6))).toBe(0);
    expect(tyreLoad(carUsing(0.85))).toBe(0);
    expect(tyreLoad(carUsing(CONFIG.GRIP.KEY_CAP))).toBe(1);
    expect(tyreLoad(carUsing(1.4))).toBe(1);
    let last = 0;
    for (let u = 0.86; u < CONFIG.GRIP.KEY_CAP; u += 0.02) {
      const l = tyreLoad(carUsing(u));
      expect(l).toBeGreaterThan(last);
      last = l;
    }
  });

  it('is silent in a spin, in reverse and while refuelling', () => {
    expect(tyreLoad(Object.assign(carUsing(1), { spinTime: 1 }))).toBe(0);
    expect(tyreLoad(Object.assign(carUsing(1), { reverse: true }))).toBe(0);
    expect(tyreLoad(Object.assign(carUsing(1), { refueling: true }))).toBe(0);
  });

  it('stops with the other race sounds (pause, menus)', () => {
    const audio = new GameAudio();
    const hiss = vi.spyOn(audio, 'setTyreLoad');
    audio.silence();
    expect(hiss).toHaveBeenCalledWith(0);
  });
});
