import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/config';
import { Particles } from '../src/gfx/particles';
import { Race } from '../src/race/race';

describe('particles', () => {
  it('fixed pool: even with constant crashes the particle count stays within the limit', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 20 }, 1);
    const p = new Particles();
    for (let i = 0; i < 600; i++) {
      for (const c of race.cars) {
        c.contactStrength = 80;
        c.spinTime = 1;
        c.speed = 120;
      }
      p.emit(race.cars, 1 / 60);
      p.update(1 / 60);
    }
    expect(p.aliveCount()).toBeLessThanOrEqual(700);
  });

  it('sparks on impact, all fade out after a moment', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 1);
    const car = race.player;
    const p = new Particles();
    p.emit([car], 1 / 60);
    car.contactStrength = 40;
    car.contactX = car.x;
    car.contactY = car.y;
    p.emit([car], 1 / 60);
    expect(p.aliveCount()).toBeGreaterThan(5);
    car.contactStrength = 0;
    for (let i = 0; i < 60 * 3; i++) p.update(1 / 60);
    expect(p.aliveCount()).toBe(0);
  });
});
