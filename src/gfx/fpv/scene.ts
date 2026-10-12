import {
  CURB_H,
  CX_L,
  CX_R,
  CY,
  FINISH_X,
  HALF_W,
  islandHull,
  PIT_BOX_TOP,
  PIT_LABEL_TOP,
  PIT_WALL_TOP,
  PIT_X0,
  PIT_X1,
  pointAt,
  R_IN,
  R_OUT,
  SEP_BOTTOM,
  STANDS_BOTTOM,
  TRACK_LEN,
  WALL_X0,
  WALL_X1,
} from '../../track/track';
import { PAD_L0, PAD_TOP, RC_TOP, RC_X0, RC_X1, STAND_TOP, STAND_X0, STAND_X1, TEAMS, UNIT_TOP, UNIT_W, unitXs } from '../track/paddock';
import { COL } from '../track/style';
import { hexRgb, makePoly, type Poly, type RGB, scaleRgb } from './engine';
import { type P3, rect, wall } from './geom';
import { buildLandmarks, type Glow, type Pool, RC_FRONT } from './landmarks';
import { type Billboard, subQuad, type TexQuad } from './texture';

export type { Glow } from './landmarks';

export interface Scene {
  ground: Poly[];
  decals: Poly[];
  island: Poly[];
  solids: Poly[];
  glows: Glow[];
  signs: TexQuad[];
  groundSigns: TexQuad[];
  billboards: Billboard[];
  pools: Pool[];
}

export const ISLAND_H = 6;
const WALL_H = 10;
const SEG = 24;
const NIGHT: RGB = [0.62, 0.62, 0.8];

export function night(hex: string, k = 1): RGB {
  const c = hexRgb(hex);
  return [c[0] * NIGHT[0] * k, c[1] * NIGHT[1] * k, c[2] * NIGHT[2] * k];
}

function stadium(r: number, z: number): P3[] {
  const pts: P3[] = [];
  for (let a = -90; a <= 90; a += 6) {
    const t = (a * Math.PI) / 180;
    pts.push([CX_R + r * Math.cos(t), CY + r * Math.sin(t), z]);
  }
  for (let a = 90; a <= 270; a += 6) {
    const t = (a * Math.PI) / 180;
    pts.push([CX_L + r * Math.cos(t), CY + r * Math.sin(t), z]);
  }
  return pts;
}

function strip(s0: number, s1: number, d0: number, d1: number, z: number): P3[] {
  const a = pointAt(s0, d0);
  const b = pointAt(s1, d0);
  const c = pointAt(s1, d1);
  const d = pointAt(s0, d1);
  return [
    [a.x, a.y, z],
    [b.x, b.y, z],
    [c.x, c.y, z],
    [d.x, d.y, z],
  ];
}

function ground(pts: P3[], rgb: RGB): Poly {
  const p = makePoly(pts, rgb);
  p.noFog = true;
  return p;
}

function pieces(ax: number, ay: number, bx: number, by: number, fn: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SEG));
  for (let i = 0; i < n; i++) {
    fn(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n);
  }
}

// Box walls wind so that their plane normals point outwards.
function box(out: Poly[], x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, side: RGB, top: RGB, front?: RGB): void {
  const face = (ax: number, ay: number, bx: number, by: number, c: RGB) =>
    pieces(ax, ay, bx, by, (a, b, c2, d) => out.push(makePoly(wall(a, b, c2, d, z0, z1), c)));
  face(x1, y0, x0, y0, scaleRgb(side, 0.8));
  face(x1, y1, x1, y0, side);
  face(x0, y1, x1, y1, front ?? side);
  face(x0, y0, x0, y1, side);
  const long = x1 - x0 >= y1 - y0;
  pieces(long ? x0 : x0, y0, long ? x1 : x0, long ? y0 : y1, (a, b, c, d) => {
    out.push(makePoly(long ? rect(a, y0, c, y1, z1) : rect(x0, b, x1, d, z1), top));
  });
}

function insideHull(h: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const [ax, ay] = h[j]!;
    const [bx, by] = h[i]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

// Cuts every upright sign along the wall pieces it is painted on and hangs each part on its piece,
// so it is drawn right after the piece and sorts together with it.
function attachSigns(solids: Poly[], signs: TexQuad[]): TexQuad[] {
  const loose: TexQuad[] = [];
  for (const q of signs) {
    const [tl, tr] = q.pts;
    const ux = tr[0] - tl[0];
    const uy = tr[1] - tl[1];
    const len = Math.hypot(ux, uy);
    if (Math.abs(q.normal[2]) > 0.5 || len < 0.01) {
      loose.push(q);
      continue;
    }
    const dx = ux / len;
    const dy = uy / len;
    const cuts: { a: number; b: number; p: Poly }[] = [];
    for (const p of solids) {
      if (!p.plane) continue;
      const [nx, ny, k] = p.plane;
      if (Math.abs(nx * q.normal[0] + ny * q.normal[1]) < 0.99) continue;
      if (Math.abs(nx * q.cx + ny * q.cy - k) > 1.2) continue;
      const zLo = Math.min(p.zs[0]!, p.zs[2]!);
      const zHi = Math.max(p.zs[0]!, p.zs[2]!);
      if (zHi <= q.pts[2][2] + 0.01 || zLo >= q.pts[0][2] - 0.01) continue;
      const t0 = ((p.xs[0]! - tl[0]) * dx + (p.ys[0]! - tl[1]) * dy) / len;
      const t1 = ((p.xs[1]! - tl[0]) * dx + (p.ys[1]! - tl[1]) * dy) / len;
      const a = Math.max(0, Math.min(t0, t1));
      const b = Math.min(1, Math.max(t0, t1));
      if (b - a > 1e-3) cuts.push({ a, b, p });
    }
    if (cuts.length === 0) {
      loose.push(q);
      continue;
    }
    for (const { a, b, p } of cuts) {
      p.decals ??= [];
      p.decals.push(subQuad(q, a, b));
    }
  }
  return loose;
}

export function buildScene(): Scene {
  const groundPolys: Poly[] = [];
  const decals: Poly[] = [];
  const island: Poly[] = [];
  const solids: Poly[] = [];
  const glows: Glow[] = [];

  groundPolys.push(ground(stadium(R_OUT, 0), night(COL.asphalt)));
  groundPolys.push(ground(stadium(R_IN, 0.01), night(COL.pitSurface)));

  const lane = night('#FFF8E8', 0.85);
  for (const d of [-19, 0, 19]) {
    for (let s = 0; s < TRACK_LEN; s += 32) decals.push(makePoly(strip(s, s + 12, d - 0.8, d + 0.8, 0.02), lane));
  }
  const edge = night('#FFF8E8');
  for (let s = 0; s < TRACK_LEN; s += 24) decals.push(makePoly(strip(s, s + 24, -HALF_W + 0.5, -HALF_W + 2, 0.02), edge));
  for (let y = CY + R_IN, row = 0; y < CY + R_OUT; y += 5, row++) {
    for (let c = 0; c < 3; c++) {
      const col = (row + c) % 2 ? '#17142B' : '#FFF8E8';
      decals.push(makePoly(rect(FINISH_X - 7 + c * 5, y, FINISH_X - 2 + c * 5, y + 5, 0.03), hexRgb(col)));
    }
  }

  const red = night(COL.wallDark);
  const cream = night(COL.wallLight, 0.9);
  for (let s = 0, k = 0; s < TRACK_LEN; s += 18, k++) {
    const a = pointAt(s, HALF_W);
    const b = pointAt(s + 18, HALF_W);
    solids.push(makePoly(wall(a.x, a.y, b.x, b.y, 0, WALL_H), k % 2 ? cream : red));
  }

  const hull = islandHull();
  const grass = night(COL.grass);
  island.push(
    ground(
      hull.map(([x, y]) => [x, y, ISLAND_H] as P3),
      grass,
    ),
  );
  const curb = night(COL.curbFace, 1.6);
  const curbTop = night(COL.curbTop);
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i]!;
    const [bx, by] = hull[(i + 1) % hull.length]!;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const out = !insideHull(hull, mx - (by - ay) * 0.01, my + (bx - ax) * 0.01);
    pieces(out ? ax : bx, out ? ay : by, out ? bx : ax, out ? by : ay, (x0, y0, x1, y1) => {
      const low = makePoly(wall(x0, y0, x1, y1, 0, ISLAND_H - 1.4), curb);
      const lip = makePoly(wall(x0, y0, x1, y1, ISLAND_H - 1.4, ISLAND_H), curbTop);
      low.back = grass;
      lip.back = grass;
      solids.push(low, lip);
    });
  }
  const pad = night('#4A4858');
  island.push(ground(rect(PAD_L0 - 8, PAD_TOP, PAD_L0 + 6 * 75 + 2, PIT_LABEL_TOP, ISLAND_H + 0.05), pad));
  island.push(ground(rect(RC_X0 - 8, PAD_TOP, RC_X1 + 220, PIT_LABEL_TOP, ISLAND_H + 0.05), pad));
  island.push(ground(rect(PIT_X0 + 10, PIT_LABEL_TOP, PIT_X1 - 10, PIT_BOX_TOP, ISLAND_H + 0.04), night(COL.curbFace, 1.4)));

  box(solids, WALL_X0, PIT_WALL_TOP, WALL_X1, SEP_BOTTOM, 0, 7, night(COL.sep, 1.8), night(COL.sepTop));

  const base = ISLAND_H;
  unitXs().forEach((x, i) => {
    const tm = TEAMS[i % TEAMS.length]!;
    const y1 = UNIT_TOP + 52;
    box(solids, x + 4, UNIT_TOP - 36, x + UNIT_W - 4, UNIT_TOP - 20, base, base + 15, night(tm.a, 0.8), night(tm.a, 0.6));
    box(solids, x, UNIT_TOP, x + UNIT_W, y1, base, base + 22, night(tm.a, 0.7), night(tm.a, 0.5), night(tm.a));
  });

  const tiers = 4;
  const depth = (STANDS_BOTTOM - CURB_H - STAND_TOP) / tiers;
  for (let t = 0; t < tiers; t++) {
    const y1 = STANDS_BOTTOM - CURB_H - t * depth;
    box(
      solids,
      STAND_X0,
      y1 - depth,
      STAND_X1,
      y1,
      base,
      base + 8 + t * 9,
      night('#3a3450'),
      night(t % 2 ? '#6a4a7a' : '#4a5a8a'),
      night(t % 2 ? '#5a4a6a' : '#46405e'),
    );
  }
  box(solids, STAND_X0, STAND_TOP, STAND_X1, STAND_TOP + depth * 1.6, base + 44, base + 46, night('#2a2838'), night('#5a5870'));
  box(solids, RC_X0, RC_TOP, RC_X1, RC_FRONT, base, base + 36, night('#4a4858'), night('#3a3846'), night('#5a5868'));

  const mast = (x: number, y: number, fx: number, fy: number) => {
    box(solids, x - 1.5, y - 1.5, x + 1.5, y + 1.5, 0, 78, hexRgb('#2a2834'), hexRgb('#2a2834'));
    const lx = x + fx * 1.6;
    const ly = y + fy * 1.6;
    solids.push(makePoly(wall(lx + fy * 6, ly - fx * 6, lx - fy * 6, ly + fx * 6, 78, 84), hexRgb('#FFF4D0'), true));
    glows.push({ x: lx, y: ly, z: 81, r: 22, color: '255,214,140' });
  };
  for (let x = CX_L; x <= CX_R; x += 200) {
    mast(x, CY - R_OUT - 12, 0, 1);
    mast(x + 100, CY + R_OUT + 14, 0, -1);
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) {
      const ux = s * Math.cos(a);
      const uy = Math.sin(a);
      mast(cx + ux * (R_OUT + 14), CY + uy * (R_OUT + 14), -ux, -uy);
    }
  }

  const lm = buildLandmarks(ISLAND_H, depth);
  decals.push(...lm.decals);
  island.push(...lm.island);
  solids.push(...lm.solids);
  glows.push(...lm.glows);
  return {
    ground: groundPolys,
    decals,
    island,
    solids,
    glows,
    signs: attachSigns(solids, lm.signs),
    groundSigns: lm.groundSigns,
    billboards: lm.billboards,
    pools: lm.pools,
  };
}
