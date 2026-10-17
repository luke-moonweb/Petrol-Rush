import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../src/track/oval';
import { chicane, circle, hairpin, sBend } from './sim/curves';

describe('open-plane curve fixtures', () => {
  for (const [name, t] of [
    ['circle 100', circle(100)],
    ['hairpin', hairpin()],
    ['chicane', chicane()],
    ['s-bend', sBend()],
  ] as const) {
    it(`${name}: project(pointAt(s, d)) round-trips and the curvature matches the heading`, () => {
      for (let s = 0; s < t.len; s += 13.7) {
        for (const d of [-20, 0, 25]) {
          const p = t.pointAt(s, d);
          const back = t.project(p.x, p.y, s);
          expect(back.s).toBeCloseTo(s, 4);
          expect(back.d).toBeCloseTo(d, 4);
        }
        if (t.curvatureAt(s - 1) === t.curvatureAt(s + 1)) {
          const dh = wrapAngle(t.pointAt(s + 1, 0).heading - t.pointAt(s - 1, 0).heading) / 2;
          expect(dh).toBeCloseTo(t.curvatureAt(s), 6);
        }
      }
    });
  }
});
