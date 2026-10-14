import { describe, expect, it } from 'vitest';
import { carFacesFpv, carLod, type FpvFace, type FpvPiece, fpvPieces, LOD_DETAIL_PX, LOD_LIVERY_PX } from '../src/gfx/carFpv';
import { renderModel, type Vec3 } from '../src/gfx/model3d';
import { CAR_ANCHOR_X, CAR_ANCHOR_Y, CAR_DIRECTIONS, CAR_SCHEMES, carFaces, FLAME_OUT, LIVERIES, MODEL_SCALE } from '../src/gfx/vehicles';

// Records every drawing call a sprite render makes, so the top-down output can be fingerprinted without a canvas.
function recorder(): { g: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const r = (n: number) => n.toFixed(4);
  const g = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    translate: (x: number, y: number) => log.push(`t${r(x)},${r(y)}`),
    beginPath: () => log.push('b'),
    moveTo: (x: number, y: number) => log.push(`m${r(x)},${r(y)}`),
    lineTo: (x: number, y: number) => log.push(`l${r(x)},${r(y)}`),
    closePath: () => log.push('z'),
    fill() {
      log.push(`f${this.fillStyle}`);
    },
    stroke() {
      log.push(`s${this.strokeStyle}/${this.lineWidth}`);
    },
  };
  return { g: g as unknown as CanvasRenderingContext2D, log };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

describe('top-down car sprites', () => {
  it('draw exactly as before the cockpit model was added (all 20 cars x 32 directions)', () => {
    const { g, log } = recorder();
    for (let c = 0; c < CAR_SCHEMES.length; c++) {
      for (let d = 0; d < CAR_DIRECTIONS; d++) {
        renderModel(g, carFaces(c), (d / CAR_DIRECTIONS) * Math.PI * 2, MODEL_SCALE, CAR_ANCHOR_X, CAR_ANCHOR_Y);
      }
    }
    expect(log.length).toBeGreaterThan(100_000);
    expect(fnv(log.join(';'))).toBe('add37640');
  });
});

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const centroid = (pts: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k]! += p[k]! / pts.length;
  return c;
};
const key = (p: Vec3) => p.map((v) => v.toFixed(5)).join(',');
const EYE_Z = 0.92;
const facing = (f: FpvFace, eye: Vec3) => dot(f.normal, eye) > f.d;
const allColors = Array.from({ length: CAR_SCHEMES.length }, (_, i) => i);

function decalsOf(f: FpvFace): FpvFace[] {
  return f.decals.flatMap((d) => [d, ...decalsOf(d)]);
}

describe('cockpit car model', () => {
  it('is built from closed pieces: every edge is shared with one face that runs it the other way', () => {
    for (const c of allColors) {
      for (const p of fpvPieces(carFacesFpv(c))) {
        const edges = new Map<string, number>();
        for (const f of p.faces) {
          for (let i = 0; i < f.pts.length; i++) {
            const e = `${key(f.pts[i]!)}>${key(f.pts[(i + 1) % f.pts.length]!)}`;
            edges.set(e, (edges.get(e) ?? 0) + 1);
          }
        }
        for (const [e, n] of edges) {
          const [a, b] = e.split('>');
          expect(n).toBe(1);
          expect(edges.get(`${b}>${a}`)).toBe(1);
        }
      }
    }
  });

  it('has planar faces whose winding normal points out of their piece', () => {
    const check = (p: FpvPiece) => {
      for (const f of p.faces) {
        const out = centroid(f.pts).map((v, k) => v - p.center[k]!) as Vec3;
        expect(dot(f.normal, out)).toBeGreaterThan(0);
        expect(Math.hypot(...f.normal)).toBeCloseTo(1, 6);
        for (const q of f.pts) expect(Math.abs(dot(f.normal, q) - f.d)).toBeLessThan(1e-3);
        for (const d of decalsOf(f)) {
          expect(dot(d.normal, f.normal)).toBeGreaterThan(0.99);
          for (const q of d.pts) expect(Math.abs(dot(f.normal, q) - f.d)).toBeLessThan(1e-3);
        }
      }
    };
    for (const c of allColors) for (const p of fpvPieces(carFacesFpv(c))) check(p);
  });

  it('puts each livery on the rear and the nose, where a driver sees it from behind and ahead', () => {
    for (let c = 0; c < LIVERIES.length; c++) {
      const sc = CAR_SCHEMES[c]!;
      const ink = LIVERIES[c] === 'flames' ? FLAME_OUT : sc.roof;
      const m = carFacesFpv(c);
      for (const [eye, dir] of [
        [[-8, 0, EYE_Z], -1],
        [[8, 0, EYE_Z], 1],
      ] as [Vec3, number][]) {
        const face = m.body.faces.find((f) => f.normal[0] * dir > 0.99)!;
        expect(facing(face, eye)).toBe(true);
        // The roof-colour lip on the rear is the same for every livery, so it does not count.
        const livery = face.decals.filter((d) => d.color === ink && Math.min(...d.pts.map((p) => p[2])) < 0.8);
        expect(livery.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks stripes and arrow on the sides and frames the glass with roof-colour pillars', () => {
    for (let c = 0; c < LIVERIES.length; c++) {
      const sc = CAR_SCHEMES[c]!;
      const m = carFacesFpv(c);
      const sides = m.body.faces.filter((f) => Math.abs(f.normal[1]) > 0.99);
      expect(sides).toHaveLength(2);
      for (const side of sides) {
        const roofInk = side.decals.filter((d) => d.color === sc.roof).length;
        if (LIVERIES[c] === 'stripes' || LIVERIES[c] === 'arrow' || LIVERIES[c] === 'band') expect(roofInk).toBeGreaterThan(0);
        expect(side.decals.some((d) => d.color === sc.number)).toBe(true);
      }
      const glass = m.cabin.faces.filter((f) => !f.hidden && f.normal[2] < 0.99);
      expect(glass).toHaveLength(4);
      for (const f of glass) expect(f.decals.filter((d) => d.color === sc.roof)).toHaveLength(2);
      expect(m.wing.faces.every((f) => f.color === sc.roof)).toBe(true);
    }
  });

  it('shows the tyres under the body from behind', () => {
    const m = carFacesFpv(0);
    const eye: Vec3 = [-8, 0, EYE_Z];
    for (const t of m.tyres.slice(0, 2)) {
      const seen = t.faces.filter((f) => !f.hidden && facing(f, eye));
      expect(seen.some((f) => Math.min(...f.pts.map((p) => p[2])) < 0.15)).toBe(true);
    }
  });

  it('drops small details first and the livery only when the car is tiny', () => {
    expect(carLod(LOD_DETAIL_PX + 1)).toBe(0);
    expect(carLod(LOD_DETAIL_PX - 1)).toBe(1);
    expect(carLod(LOD_LIVERY_PX)).toBe(1);
    expect(carLod(LOD_LIVERY_PX - 1)).toBe(2);
    // At 720p (focal ~576) a car 700 units away is still about 33 px long, so it keeps wheels and livery.
    expect(carLod((576 * 4 * MODEL_SCALE) / 700)).toBe(1);
  });
});
