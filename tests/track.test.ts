import { describe, expect, it } from 'vitest';
import { createRng } from '../src/sim/rng';
import { deltaS, HALF_W, pointAt, project, TRACK_LEN, wrapS } from '../src/track/oval';

describe('track geometry (Frenet)', () => {
  it('project(pointAt(s, d)) returns the same s and d', () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const s = rng() * TRACK_LEN;
      const d = (rng() * 2 - 1) * HALF_W;
      const p = pointAt(s, d);
      const back = project(p.x, p.y);
      expect(Math.abs(deltaS(s, back.s))).toBeLessThan(1e-6);
      expect(back.d).toBeCloseTo(d, 6);
    }
  });

  it('track heading is continuous (no jumps between segments)', () => {
    let prev = pointAt(0, 0);
    for (let s = 1; s <= TRACK_LEN; s += 1) {
      const p = pointAt(s, 0);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(1.01);
      prev = p;
    }
  });

  it('wrapS i deltaS', () => {
    expect(wrapS(-1)).toBeCloseTo(TRACK_LEN - 1);
    expect(deltaS(TRACK_LEN - 10, 10)).toBeCloseTo(20);
    expect(deltaS(10, TRACK_LEN - 10)).toBeCloseTo(-20);
  });
});
