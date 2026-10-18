import { describe, expect, it } from 'vitest';
import { labCorner } from './sim/curves';

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
