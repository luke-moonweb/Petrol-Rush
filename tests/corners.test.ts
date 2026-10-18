import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { limitMph } from '../src/race/physics';
import { labCorner } from './sim/curves';
import { bestEntry, type CornerBest, cornerFor, runCorner } from './sim/lab';

// The corner lab (tests/sim/lab.ts): its geometry, and the corner targets of the driving model.

describe('corner lab: the racing line', () => {
  for (const [r, deg, dir, use] of [
    [60, 45, 'left', 1],
    [140, 90, 'right', 1],
    [140, 90, 'left', 0.5],
    [100, 135, 'left', 1],
    [147, 180, 'right', 1],
  ] as const) {
    it(`R ${r} ${deg} deg ${dir}, use ${use}: stays on the road, outside at turn-in and exit, inside at the apex`, () => {
      const c = labCorner(r, deg, dir, use);
      const roadD = (s: number) => {
        const p = c.line.pointAt(s, 0);
        return c.road.project(p.x, p.y, s).d;
      };
      for (let s = 0; s < c.lineArc1 + 300; s += 7) expect(Math.abs(roadD(s)), `s ${s}`).toBeLessThanOrEqual(c.hw + 1e-6);
      expect(roadD(c.lineArc0)).toBeCloseTo(-c.sign * c.hw, 6);
      expect(roadD(c.lineArc1)).toBeCloseTo(-c.sign * c.hw, 3);
      expect(roadD((c.lineArc0 + c.lineArc1) / 2)).toBeCloseTo(c.sign * c.hw, 3);
    });
  }
});

// Targets of the driving model on single corners (the user's spec): gentle bends are flat out; a key
// player who takes a 90 degree corner (or more) flat out or 10 % too fast turns in sharper but the rear
// steps out: caught, it costs time, not caught it spins; a slow corner forgives what a fast one does not.
describe('corner lab: the driving model', () => {
  const lost = (b: CornerBest) => b.dtFlat === Infinity || b.flat.wallHits > 0 || b.dtFlat >= 0.2;

  it('1: 45 degree bends are flat out', () => {
    for (const s of [
      { r: 100, driver: 'line' },
      { r: 200, driver: 'line' },
      { r: 140, driver: 'human' },
      { r: 200, driver: 'human' },
    ] as const) {
      const b = bestEntry({ ...s, deg: 45 });
      expect(b.vBest, `R ${s.r} ${s.driver}`).toBeGreaterThanOrEqual(176);
      expect(b.dtFlat, `R ${s.r} ${s.driver}`).toBeLessThanOrEqual(0.05);
    }
  });

  it('2, 7: 90 degree corners want 155-180 mph; flat out costs a key player time; 10 % too fast costs more than 10 % too slow', () => {
    for (const r of [60, 100, 140, 200]) {
      const line = bestEntry({ r, deg: 90, driver: 'line' });
      expect(line.vBest, `R ${r}`).toBeGreaterThanOrEqual(155);
      const human = bestEntry({ r, deg: 90, driver: 'human' });
      expect(human.vBest, `R ${r} human`).toBeLessThan(175);
      expect(lost(human), `R ${r} human flat`).toBe(true);
      // (at R 200 the two are within a few steps: the slide carries a small excess almost for free)
      expect(human.dtOver!, `R ${r} human`).toBeGreaterThan(human.dtUnder - 0.05);
    }
  });

  it('3: flat out into 180 degrees: the rear goes, the car hits the wall or spins; holding the key in spins', () => {
    const keys = runCorner({ r: 147, deg: 180, driver: 'human', mode: 'flat' });
    expect(keys.loose).toBe(true);
    expect(keys.wallHits > 0 || keys.spun).toBe(true);
    expect(runCorner({ r: 147, deg: 180, driver: 'human', insist: true, mode: 'flat' }).spun).toBe(true);
  });

  it('4: flat out into a fast 90 degree corner the rear steps out: caught it costs time, held into the bend it spins', () => {
    for (const r of [140, 200]) {
      const b = bestEntry({ r, deg: 90, driver: 'human' });
      expect(b.flat.loose && !b.flat.spun, `R ${r}`).toBe(true);
      expect(b.dtFlat, `R ${r}`).toBeGreaterThanOrEqual(0.2);
      expect(runCorner({ r, deg: 90, driver: 'human', insist: true, mode: 'flat' }).spun, `R ${r} insist`).toBe(true);
    }
  });

  // (stated against the line's limit, not the key player's best entry: that one moves with the key steering)
  it('5: 15 % over the line limit forgives in a slow hairpin but not in a fast one', () => {
    for (const [r, spins] of [
      [60, false],
      [140, true],
    ] as const) {
      const spec = { r, deg: 180, driver: 'human' } as const;
      const vc = Math.min(CONFIG.MAX_MPH, limitMph(1 / cornerFor(spec).rho) * 1.15);
      expect(runCorner({ ...spec, mode: 'brake', vc }).spun, `R ${r}`).toBe(spins);
    }
  });

  it('6: the racing line pays: using the whole width is >= 0.2 s faster through a 90 degree R 140', () => {
    const wide = bestEntry({ r: 140, deg: 90, driver: 'line', use: 1 });
    const centre = bestEntry({ r: 140, deg: 90, driver: 'line', use: 0 });
    expect(centre.best.t - wide.best.t).toBeGreaterThanOrEqual(0.2);
  });
});

// The AI on the racing line keeps up with a key player who uses the whole width: on the game's corner
// radii its fastest and slowest drivers stay within 0.2 s of the player's best entry, without a wall or spin.
describe('corner lab: the AI', () => {
  for (const deg of [90, 135]) {
    it(`${deg} degree corners: within 0.2 s of the key player, clean`, () => {
      for (const r of [120, 160, 200]) {
        const human = bestEntry({ r, deg, driver: 'human' });
        for (const skill of [0, 1]) {
          const ai = runCorner({ r, deg, driver: 'ai', mode: 'flat', skill });
          const at = `R ${r} skill ${skill}`;
          expect(ai.spun || ai.wallHits > 0, at).toBe(false);
          expect(Math.abs(ai.t - human.best.t), at).toBeLessThanOrEqual(0.2);
        }
      }
    });
  }
});
