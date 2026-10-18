import { describe, expect, it } from 'vitest';
import { CAR_R, HALF_W } from '../src/track/common';
import { RacingLine } from '../src/track/racingLine';
import { allTracks } from '../src/track/tracks';
import { labCorner } from './sim/curves';

// The racing line (src/track/racingLine.ts): on a single corner it is the corner lab's line, and on
// every track it stays on the road.

describe('racing line', () => {
  for (const [r, deg, dir, use] of [
    [140, 90, 'left', 1],
    [100, 135, 'right', 1],
    [147, 180, 'left', 0.6],
    [200, 45, 'right', 1],
  ] as const) {
    it(`R ${r} ${deg} deg ${dir}, use ${use}: the lab's line`, () => {
      const c = labCorner(r, deg, dir, use);
      const road = c.road;
      const line = new RacingLine({
        len: road.len,
        curves: () => road.table,
        curvatureAt: (s) => road.curvatureAt(s),
        pointAt: (s, d) => road.pointAt(s, d),
      });
      for (let s = c.arc0 - 500; s < c.arc1 + 400; s += 5) {
        const p = road.pointAt(s, line.d(s, use));
        const want = c.line.project(p.x, p.y, s).d;
        expect(Math.abs(want), `s ${s}`).toBeLessThan(0.5);
      }
      expect(Math.abs(line.k(c.arc0, use))).toBeCloseTo(1 / c.rho, 6);
    });
  }

  for (const t of allTracks()) {
    it(`${t.id}: on the road, and continuous`, () => {
      const line = new RacingLine(t);
      let prev = line.d(0, 1);
      for (let s = 0; s < t.len; s += 2) {
        const d = line.d(s, 1);
        expect(Math.abs(d), `s ${s}`).toBeLessThanOrEqual(HALF_W - CAR_R);
        expect(Math.abs(d - prev), `s ${s}`).toBeLessThan(2.5);
        prev = d;
      }
    });
  }
});
