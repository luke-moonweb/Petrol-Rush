import { describe, expect, it } from 'vitest';
import { createRng } from '../src/sim/rng';
import { laneCurvature } from '../src/track/curvature';
import {
  CX_R,
  CY,
  curvatureAt,
  deltaS,
  HALF_W,
  pointAt,
  project,
  RC,
  S_BOTTOM,
  S_TOP,
  S_TURN1,
  S_TURN2,
  TRACK_LEN,
  TURN_LEN,
  trackCurves,
  wrapAngle,
  wrapS,
} from '../src/track/track';

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

describe('track curvature contract', () => {
  it('oval: -1/RC in both turns (left turns), 0 on the straights', () => {
    expect(curvatureAt(S_TURN1 + 10)).toBeCloseTo(-1 / RC, 12);
    expect(curvatureAt(S_TURN2 + TURN_LEN - 1)).toBeCloseTo(-1 / RC, 12);
    expect(curvatureAt(10)).toBe(0);
    expect(curvatureAt(S_TOP + 100)).toBe(0);
    expect(curvatureAt(S_BOTTOM + 1)).toBe(0);
    expect(curvatureAt(S_TURN1 + TRACK_LEN)).toBeCloseTo(-1 / RC, 12);
  });

  it('sign matches the heading: + curvature = heading increases along s', () => {
    for (const s of [S_TURN1 + 50, S_TURN2 + 200, 300]) {
      const dh = wrapAngle(pointAt(s + 1, 0).heading - pointAt(s - 1, 0).heading) / 2;
      expect(dh).toBeCloseTo(curvatureAt(s), 4);
    }
  });

  it('lane curvature: d + is right of travel, the outside of a left turn is wider', () => {
    const k = -1 / RC;
    expect(1 / Math.abs(laneCurvature(k, 28.5))).toBeCloseTo(RC + 28.5, 9);
    expect(1 / Math.abs(laneCurvature(k, -28.5))).toBeCloseTo(RC - 28.5, 9);
    expect(1 / laneCurvature(1 / 120, 20)).toBeCloseTo(100, 9);
    expect(laneCurvature(0, 30)).toBe(0);
    // measured from the geometry: the d = +28.5 line has radius RC + 28.5
    const a = pointAt(S_TURN1 + 100, 28.5);
    expect(Math.hypot(a.x - CX_R, a.y - CY)).toBeCloseTo(RC + 28.5, 9);
  });

  it('curvature table matches curvatureAt and wraps', () => {
    const t = trackCurves();
    for (let s = -500; s < TRACK_LEN + 500; s += 7.3) {
      const exact = curvatureAt(s);
      const near = curvatureAt(s - 4) === curvatureAt(s + 4);
      if (near) expect(t.at(s)).toBeCloseTo(exact, 6);
    }
    expect(t.maxAbsAhead(S_TURN1 - 100, 99)).toBe(0);
    expect(t.maxAbsAhead(S_TURN1 - 100, 120)).toBeCloseTo(1 / RC, 6);
  });
});
