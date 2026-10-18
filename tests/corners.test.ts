import { describe, expect, it } from 'vitest';
import { labCorner } from './sim/curves';
import { bestEntry, type CornerBest, runCorner } from './sim/lab';

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

// Targets of the driving model on single corners (the user's spec): gentle bends are flat out, 90 degree
// corners need a lift, too fast costs more than too slow, a key player who runs wide ploughs along the
// wall without spinning, and a slow corner forgives what a fast one does not.
describe('corner lab: the driving model', () => {
  const lostMore = (b: CornerBest) => b.dtFlat === Infinity || b.flat.wallHits > 0 || b.dtFlat >= 0.25;

  it('1: 45 degree bends are flat out on the line', () => {
    for (const s of [
      { r: 100, driver: 'line' },
      { r: 200, driver: 'line' },
      { r: 140, driver: 'human' },
      { r: 200, driver: 'human' },
    ] as const) {
      const b = bestEntry({ ...s, deg: 45 });
      expect(b.vBest, `R ${s.r} ${s.driver}`).toBe(180);
      expect(b.dtFlat, `R ${s.r} ${s.driver}`).toBeLessThanOrEqual(0.02);
    }
  });

  it('2, 7: 90 degree corners need 155-175 mph; flat out, or 10 % too fast, costs more than 10 % too slow', () => {
    for (const r of [100, 140, 200]) {
      const line = bestEntry({ r, deg: 90, driver: 'line' });
      expect(line.vBest, `R ${r}`).toBeGreaterThanOrEqual(155);
      expect(line.vBest, `R ${r}`).toBeLessThanOrEqual(175);
      expect(lostMore(line), `R ${r} flat`).toBe(true);
      const human = bestEntry({ r, deg: 90, driver: 'human' });
      expect(human.dtFlat, `R ${r} human flat`).toBeGreaterThan(0.25);
      expect(human.dtOver!, `R ${r} human`).toBeGreaterThan(human.dtUnder);
    }
  });

  it('3: 180 degrees at full speed: the rear goes and the car hits the wall; holding the key in spins', () => {
    const keys = runCorner({ r: 147, deg: 180, driver: 'human', mode: 'flat' });
    expect(keys.loose).toBe(true);
    expect(keys.wallHits > 0 || keys.spun).toBe(true);
    expect(runCorner({ r: 147, deg: 180, driver: 'human', insist: true, mode: 'flat' }).spun).toBe(true);
  });

  it('4: 10 % too fast in a 90 degree corner, a key player ploughs along the wall (no spin) and loses over 1 s', () => {
    for (const r of [100, 140]) {
      const b = bestEntry({ r, deg: 90, driver: 'human' });
      expect(b.over!.spun, `R ${r}`).toBe(false);
      expect(b.dtOver!, `R ${r}`).toBeGreaterThan(1);
    }
  });

  it('5: 10 % too fast forgives in a slow hairpin but not in a fast 90 degree corner (analog, insisting)', () => {
    expect(bestEntry({ r: 60, deg: 180, driver: 'line' }).over!.spun).toBe(false);
    expect(bestEntry({ r: 140, deg: 90, driver: 'line' }).over!.spun).toBe(true);
  });

  it('6: the racing line pays: using the whole width is >= 0.2 s faster through a 90 degree R 140', () => {
    const wide = bestEntry({ r: 140, deg: 90, driver: 'line', use: 1 });
    const centre = bestEntry({ r: 140, deg: 90, driver: 'line', use: 0 });
    expect(centre.best.t - wide.best.t).toBeGreaterThanOrEqual(0.2);
  });
});
