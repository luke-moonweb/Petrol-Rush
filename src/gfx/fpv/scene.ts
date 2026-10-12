import {
  CURB_H,
  CX_L,
  CX_R,
  CY,
  FINISH_X,
  HALF_W,
  islandOutline,
  PIT_LABEL_TOP,
  PIT_WALL_TOP,
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
import { buildLandmarks, type Pool } from './landmarks';
import type { Billboard, TexQuad } from './texture';

export interface Glow {
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
}

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

type P3 = [number, number, number];

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

function rect(x0: number, y0: number, x1: number, y1: number, z: number): P3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ];
}

function wall(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): P3[] {
  return [
    [x0, y0, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y0, z1],
  ];
}

function box(out: Poly[], x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, side: RGB, top: RGB, front?: RGB): void {
  const seg = (ax: number, ay: number, bx: number, by: number, c: RGB) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SEG));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      out.push(makePoly(wall(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, z0, z1), c));
    }
  };
  seg(x0, y0, x1, y0, scaleRgb(side, 0.8));
  seg(x1, y0, x1, y1, side);
  seg(x1, y1, x0, y1, front ?? side);
  seg(x0, y1, x0, y0, side);
  out.push(makePoly(rect(x0, y0, x1, y1, z1), top));
}

export function buildScene(): Scene {
  const ground: Poly[] = [];
  const decals: Poly[] = [];
  const island: Poly[] = [];
  const solids: Poly[] = [];
  const glows: Glow[] = [];

  ground.push(makePoly(stadium(R_OUT, 0), night(COL.asphalt)));
  ground.push(makePoly(stadium(R_IN, 0.01), night(COL.pitSurface)));

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

  const outline = islandOutline(0);
  island.push(
    makePoly(
      outline.map(([x, y]) => [x, y, ISLAND_H] as P3),
      night(COL.grass),
    ),
  );
  const curb = night(COL.curbFace, 1.6);
  const curbTop = night(COL.curbTop);
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i]!;
    const [bx, by] = outline[(i + 1) % outline.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SEG));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n;
      const y0 = ay + ((by - ay) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n;
      const y1 = ay + ((by - ay) * (k + 1)) / n;
      solids.push(makePoly(wall(x0, y0, x1, y1, 0, ISLAND_H - 1.4), curb));
      solids.push(makePoly(wall(x0, y0, x1, y1, ISLAND_H - 1.4, ISLAND_H), curbTop));
    }
  }
  const pad = night('#4A4858');
  island.push(makePoly(rect(PAD_L0 - 8, PAD_TOP, PAD_L0 + 6 * 75 + 2, PIT_LABEL_TOP - CURB_H, ISLAND_H + 0.05), pad));
  island.push(makePoly(rect(RC_X0 - 8, PAD_TOP, RC_X1 + 220, PIT_LABEL_TOP - CURB_H, ISLAND_H + 0.05), pad));

  box(solids, WALL_X0, PIT_WALL_TOP, WALL_X1, SEP_BOTTOM, 0, 7, night(COL.sep, 1.8), night(COL.sepTop));

  const base = ISLAND_H;
  unitXs().forEach((x, i) => {
    const tm = TEAMS[i % TEAMS.length]!;
    const y1 = UNIT_TOP + 52;
    box(solids, x + 4, UNIT_TOP - 36, x + UNIT_W - 4, UNIT_TOP - 20, base, base + 15, night(tm.a, 0.8), night(tm.a, 0.6));
    box(solids, x, UNIT_TOP, x + UNIT_W, y1, base, base + 22, night(tm.a, 0.7), night(tm.a, 0.5), night(tm.a));
    solids.push(makePoly(wall(x + 8, y1 + 0.4, x + UNIT_W - 8, y1 + 0.4, base, base + 13), hexRgb('#2a2638')));
    solids.push(makePoly(wall(x, y1 + 0.3, x + UNIT_W, y1 + 0.3, base + 18, base + 20), night(tm.b, 1.2)));
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

  box(solids, RC_X0, RC_TOP, RC_X1, UNIT_TOP + 40, base, base + 34, night('#4a4858'), night('#3a3846'), night('#5a5868'));
  solids.push(makePoly(wall(RC_X0 + 6, UNIT_TOP + 40.4, RC_X1 - 6, UNIT_TOP + 40.4, base + 20, base + 28), hexRgb('#FFD27A'), true));

  const mast = (x: number, y: number, facing: 1 | -1) => {
    box(solids, x - 1.5, y - 1.5, x + 1.5, y + 1.5, 0, 78, hexRgb('#2a2834'), hexRgb('#2a2834'));
    const fy = y + facing * 1.6;
    solids.push(makePoly(wall(x - 6, fy, x + 6, fy, 78, 84), hexRgb('#FFF4D0'), true));
    glows.push({ x, y: fy, z: 81, r: 22, color: '255,214,140' });
  };
  for (let x = CX_L; x <= CX_R; x += 200) {
    mast(x, CY - R_OUT - 14, 1);
    mast(x + 100, CY + R_OUT + 14, -1);
  }

  const lm = buildLandmarks(ISLAND_H, depth);
  decals.push(...lm.decals);
  island.push(...lm.island);
  solids.push(...lm.solids);
  glows.push(...lm.glows);
  return {
    ground,
    decals,
    island,
    solids,
    glows,
    signs: [...lm.signs, ...lm.pylon],
    groundSigns: lm.groundSigns,
    billboards: lm.billboards,
    pools: lm.pools,
  };
}
