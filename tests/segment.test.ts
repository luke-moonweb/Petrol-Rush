import { describe, expect, it } from 'vitest';
import { createRng } from '../src/sim/rng';
import { CAR_R, HALF_W } from '../src/track/common';
import { GP_DEFS, gpTracks } from '../src/track/gp';
import { CX_L, CX_R, CY, FINISH_X, RC, STRAIGHT } from '../src/track/oval';
import { OVAL } from '../src/track/ovalTrack';
import { compileShape, R_MIN, SegmentTrack, WORLD_MARGIN } from '../src/track/segment';

const OVAL_DEF = {
  id: 'oval-seg',
  name: 'OVAL FROM SEGMENTS',
  corners: [
    [CX_L - RC, CY + RC, RC],
    [CX_R + RC, CY + RC, RC],
    [CX_R + RC, CY - RC, RC],
    [CX_L - RC, CY - RC, RC],
  ] as const,
  finish: (FINISH_X - CX_L) / STRAIGHT,
};

describe('segment track built from the oval', () => {
  const seg = new SegmentTrack(OVAL_DEF);
  const ox = WORLD_MARGIN - (CX_L - RC);
  const oy = WORLD_MARGIN - (CY - RC);

  it('has the oval length', () => {
    expect(seg.problems).toEqual([]);
    expect(seg.len).toBeCloseTo(OVAL.len, 9);
  });

  it('pointAt and project match the analytic oval', () => {
    const rng = createRng(3);
    for (let i = 0; i < 3000; i++) {
      const s = rng() * OVAL.len;
      const d = (rng() * 2 - 1) * HALF_W;
      const a = OVAL.pointAt(s, d);
      const b = seg.pointAt(s, d);
      expect(b.x - ox).toBeCloseTo(a.x, 6);
      expect(b.y - oy).toBeCloseTo(a.y, 6);
      expect(Math.cos(b.heading - a.heading)).toBeCloseTo(1, 9);
      const pa = OVAL.project(a.x, a.y);
      const pb = seg.project(b.x, b.y);
      expect(Math.abs(seg.deltaS(pa.s, pb.s))).toBeLessThan(1e-6);
      expect(pb.d).toBeCloseTo(pa.d, 6);
    }
  });

  it('corners and grid match the oval', () => {
    for (const s of [100, 1000, 1300, 2500, 3500, 4400]) {
      const a = OVAL.pointAt(s, 10);
      const b = seg.pointAt(s, 10);
      expect(seg.cornerAt(b.x, b.y) !== null).toBe(OVAL.cornerAt(a.x, a.y) !== null);
    }
    // On straights (the only place the AI asks), the distance to the next corner matches.
    for (const s of [100, 2500, 4400]) expect(seg.distToCorner(s)).toBeCloseTo(OVAL.distToCorner(s), 6);
    for (let slot = 0; slot < 20; slot++) expect(seg.gridSlot(slot)).toEqual(OVAL.gridSlot(slot));
  });
});

describe('shape compiler', () => {
  it('rejects shapes that do not work', () => {
    expect(
      compileShape([
        [0, 0, 150],
        [1000, 0, 150],
        [1000, 1000, 150],
      ]).problems,
    ).toEqual([]);
    expect(
      compileShape([
        [0, 0, 100],
        [1000, 0, 150],
        [1000, 1000, 150],
      ]).problems.join(),
    ).toMatch(/radius 100/);
    expect(
      compileShape([
        [0, 0, 150],
        [250, 0, 150],
        [250, 250, 150],
        [0, 250, 150],
      ]).problems.join(),
    ).toMatch(/too short/);
    expect(
      compileShape([
        [0, 0, 150],
        [1000, 0, 150],
        [0, 1000, 150],
        [1000, 1000, 150],
      ]).problems.join(),
    ).toMatch(/not 360/);
  });
});

for (const track of gpTracks()) {
  describe(`GP track ${track.name}`, () => {
    it('compiles cleanly', () => {
      expect(track.problems).toEqual([]);
    });

    it('fits the world and is different from the oval', () => {
      // One pre-rendered canvas per track: keep it well inside mobile canvas limits.
      expect(Math.max(track.worldW, track.worldH)).toBeLessThanOrEqual(3200);
      expect(track.worldW * track.worldH).toBeLessThanOrEqual(6e6);
      expect(Math.abs(track.len - OVAL.len)).toBeGreaterThan(200);
      for (const g of track.segments) if (g.kind === 'arc') expect(g.r).toBeGreaterThanOrEqual(R_MIN);
    });

    it('project(pointAt(s, d)) returns s and d, including on kerbs and just past the walls', () => {
      const rng = createRng(11);
      for (let i = 0; i < 3000; i++) {
        const s = rng() * track.len;
        const d = (rng() * 2 - 1) * (HALF_W + 22);
        const back = track.project(track.pointAt(s, d).x, track.pointAt(s, d).y);
        expect(Math.abs(track.deltaS(s, back.s))).toBeLessThan(1e-6);
        expect(back.d).toBeCloseTo(d, 6);
      }
    });

    it('the centre line is continuous', () => {
      let prev = track.pointAt(0, 0);
      for (let s = 1; s <= track.len; s += 1) {
        const p = track.pointAt(s, 0);
        expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(1.001);
        expect(Math.cos(p.heading - prev.heading)).toBeGreaterThan(0.999);
        prev = p;
      }
    });

    it('distant parts of the lap keep 180 px apart', () => {
      const pts: { s: number; x: number; y: number }[] = [];
      for (let s = 0; s < track.len; s += 8) pts.push({ s, ...track.pointAt(s, 0) });
      let worst = Infinity;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (Math.abs(track.deltaS(pts[i]!.s, pts[j]!.s)) <= 450) continue;
          worst = Math.min(worst, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
        }
      }
      expect(worst).toBeGreaterThanOrEqual(180);
    });

    it('main straight: east-bound, room for the grid behind the line and a run to turn 1', () => {
      const main = track.segments[0]!;
      expect(main.kind).toBe('line');
      expect(track.finishAt).toBeGreaterThan(-track.gridSlot(19).s + CAR_R + 40);
      expect(track.mainLen - track.finishAt).toBeGreaterThan(400);
      expect(track.pointAt(0, 0).heading).toBeCloseTo(0, 9);
    });

    it('pole position is on the inside of turn 1', () => {
      const first = track.segments.find((g) => g.kind === 'arc')!;
      expect(first.kind === 'arc' && Math.sign(track.gridSlot(0).d)).toBe(first.kind === 'arc' ? first.corner.dir : 0);
    });

    it('walls keep a car on the tarmac or the inside kerbs', () => {
      const rng = createRng(5);
      for (let i = 0; i < 2000; i++) {
        const s = rng() * track.len;
        const d = (rng() * 2 - 1) * (HALF_W + 40);
        const p = { ...track.pointAt(s, d), pitSide: false, wasInPit: false };
        track.constrain(p);
        const after = track.project(p.x, p.y);
        const [kl, kr] = track.kerbs(after.s);
        expect(after.d).toBeGreaterThanOrEqual(-(HALF_W + kl) + CAR_R - 0.5);
        expect(after.d).toBeLessThanOrEqual(HALF_W + kr - CAR_R + 0.5);
      }
    });
  });
}

describe('GP calendar', () => {
  it('has five distinct circuits', () => {
    expect(GP_DEFS.length).toBe(5);
    expect(new Set(GP_DEFS.map((d) => d.id)).size).toBe(5);
    const lens = gpTracks().map((t) => Math.round(t.len));
    expect(new Set(lens).size).toBe(5);
  });
});
