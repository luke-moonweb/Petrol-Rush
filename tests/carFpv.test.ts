import { describe, expect, it } from 'vitest';
import {
  carFacesFpv,
  carLod,
  type FpvFace,
  type FpvPiece,
  fpvPieces,
  LOD_DETAIL_PX,
  LOD_HYSTERESIS,
  LOD_LIVERY_PX,
  PLATE_Z0,
} from '../src/gfx/carFpv';
import { carPaintOrder, pieceOrder } from '../src/gfx/fpv/cars';
import { EYE_Z as COCKPIT_EYE_Z, MIRROR_RISE, SHAKE_AMP } from '../src/gfx/fpv/view';
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

  it('drops small details first and the livery only when the car is tiny, with hysteresis', () => {
    expect(carLod(LOD_DETAIL_PX + 1)).toBe(0);
    expect(carLod(LOD_DETAIL_PX - 1)).toBe(1);
    expect(carLod(LOD_LIVERY_PX)).toBe(1);
    expect(carLod(LOD_LIVERY_PX - 1)).toBe(2);
    // At 720p (focal ~576 device px) a car 700 units away is still about 33 px long: wheels and livery stay.
    expect(carLod((576 * 4 * MODEL_SCALE) / 700)).toBe(1);
    // Near a threshold the previous tier holds until the size is a few percent past it.
    const h = LOD_HYSTERESIS / 2;
    expect(carLod(LOD_DETAIL_PX * (1 - h), 0)).toBe(0);
    expect(carLod(LOD_DETAIL_PX * (1 + h), 1)).toBe(1);
    expect(carLod(LOD_LIVERY_PX * (1 - h), 1)).toBe(1);
    expect(carLod(LOD_LIVERY_PX * (1 + h), 2)).toBe(2);
    expect(carLod(LOD_DETAIL_PX * (1 - 2 * LOD_HYSTERESIS), 0)).toBe(1);
    expect(carLod(LOD_LIVERY_PX * (1 + 2 * LOD_HYSTERESIS), 2)).toBe(1);
  });

  it('keeps every eye above the spoiler feet, which the piece order relies on', () => {
    expect((COCKPIT_EYE_Z - SHAKE_AMP) / MODEL_SCALE).toBeGreaterThan(PLATE_Z0);
    expect((COCKPIT_EYE_Z + MIRROR_RISE) / MODEL_SCALE).toBeGreaterThan(PLATE_Z0);
  });

  // Ray cast: for sample points on every visible face, the piece the eye sees first must be the last of the
  // pieces on that ray in the painter's order (each piece paints its front faces there).
  it('paints the pieces in an order that matches a ray cast, for cockpit and mirror eye heights', () => {
    const m = carFacesFpv(0);
    const hit = (p: FpvPiece, e: Vec3, d: Vec3): { t: number; hidden: boolean } | null => {
      let tin = -Infinity;
      let tout = Infinity;
      let hid = false;
      for (const f of p.faces) {
        const nd = dot(f.normal, d);
        const ne = dot(f.normal, e);
        if (Math.abs(nd) < 1e-12) {
          if (ne > f.d + 1e-9) return null;
          continue;
        }
        const t = (f.d - ne) / nd;
        if (nd < 0) {
          if (t > tin) {
            tin = t;
            hid = f.hidden;
          }
        } else if (t < tout) tout = t;
      }
      return tin < tout - 1e-6 && tin > 0 ? { t: tin, hidden: hid } : null;
    };
    for (const lod of [0, 2] as const) {
      const pieces = lod === 2 ? [m.skirt, m.body, m.cabin, m.wing, ...m.plates] : fpvPieces(m).filter((p) => p !== m.skirt);
      const targets: Vec3[] = [];
      for (const p of pieces) {
        for (const f of p.faces) {
          if (f.hidden) continue;
          const n = f.pts.length;
          for (let a = 0; a < 5; a++) {
            for (let b = 0; b < 5; b++) {
              const i = (a % (n - 2)) + 1;
              const u = (b + 0.5) / 5;
              const v = ((a + 0.5) / 5) * (1 - u);
              const p0 = f.pts[0]!;
              const p1 = f.pts[i]!;
              const p2 = f.pts[i + 1]!;
              targets.push([0, 1, 2].map((k) => p0[k]! + (p1[k]! - p0[k]!) * u + (p2[k]! - p0[k]!) * v) as Vec3);
            }
          }
        }
      }
      const out: FpvPiece[] = [];
      let rays = 0;
      let bad = 0;
      for (const ez of [(COCKPIT_EYE_Z - SHAKE_AMP) / MODEL_SCALE, (COCKPIT_EYE_Z + MIRROR_RISE) / MODEL_SCALE]) {
        for (const r of [2.6, 4, 10, 40]) {
          for (let ang = 0; ang < 360; ang += 10) {
            const e: Vec3 = [Math.cos((ang * Math.PI) / 180) * r, Math.sin((ang * Math.PI) / 180) * r * 0.6, ez];
            if (Math.abs(e[0]) < 2.05 && Math.abs(e[1]) < 0.95) continue;
            const n = pieceOrder(m, e[0], e[1], e[2], lod, out);
            for (const q of targets) {
              const d: Vec3 = [q[0] - e[0], q[1] - e[1], q[2] - e[2]];
              let best = Infinity;
              let first: FpvPiece | null = null;
              let firstHidden = false;
              let paint: FpvPiece | null = null;
              for (let i = 0; i < n; i++) {
                const h = hit(out[i]!, e, d);
                if (!h) continue;
                if (h.t <= best + 1e-6) {
                  best = h.t;
                  first = out[i]!;
                  firstHidden = h.hidden;
                }
                if (!h.hidden) paint = out[i]!;
              }
              if (!first || firstHidden) continue;
              rays++;
              if (paint !== first) bad++;
            }
          }
        }
      }
      expect(rays).toBeGreaterThan(50_000);
      expect(bad).toBe(0);
    }
  });
});

describe('cockpit car order between cars', () => {
  const K = MODEL_SCALE;
  it('draws the car nearer the camera side later when cars run side by side', () => {
    // Four cars in a row 90 u ahead, 26 u apart, all heading along +x; camera at the origin.
    const ys = [-39, -13, 13, 39];
    for (let i = 0; i < 3; i++) {
      const a = ys[i]!;
      const b = ys[i + 1]!;
      const o = carPaintOrder(90, a, 0, 90, b, 0, 0, 0);
      // The car closer to y = 0 is on the camera's side of the gap between them.
      expect(o).toBe(Math.abs(b) < Math.abs(a) ? 1 : -1);
    }
  });

  it('draws the nearer of two cars in one lane later, also for turned cars', () => {
    expect(carPaintOrder(140, 0, 0, 90, 0, 0, 0, 0)).toBe(1);
    expect(carPaintOrder(90, 0, 0.6, 150, 0, -0.4, 0, 0)).toBe(-1);
    // Seen from behind the pair: the rear car goes last.
    expect(carPaintOrder(140, 0, 0, 90, 0, 0, 300, 0)).toBe(-1);
  });

  it('gives no order when the footprints touch', () => {
    expect(carPaintOrder(90, 0, 0, 90 + 3 * K, 1.5 * K, 0, 0, 0)).toBe(0);
  });

  it('reorders draw items of side-by-side cars that centre depth gets wrong', async () => {
    const { orderCarsAgainstCars } = await import('../src/gfx/fpv/view');
    const { Camera } = await import('../src/gfx/fpv/engine');
    const c = new Camera();
    c.set(0, 0, 9.2, 0);
    // Equal centre depth: the outer car (y = 39) must still be drawn before the inner one (y = 13).
    const inner = { d: 90, car: {}, x: 90, y: 13, h: 0 };
    const outer = { d: 90, car: {}, x: 90, y: 39, h: 0 };
    const list = [inner, outer] as unknown as Parameters<typeof orderCarsAgainstCars>[1];
    orderCarsAgainstCars(c, list);
    expect(outer.d).toBeGreaterThan(inner.d);
  });
});
