import type { Track } from '../../track/common';
import { FONT_BLACK } from '../track/style';
import { hexRgb, makePoly, type Poly, type RGB, scaleRgb } from './engine';
import { type P3, rect, wall } from './geom';
import { type Billboard, lazyCanvas, subQuad, type TexQuad } from './texture';

// Building blocks shared by every part of the 3D scene.

export interface Glow {
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
  flood?: boolean;
}

export interface Pool {
  x: number;
  y: number;
  r: number;
  z: number;
}

/** The scene's lists, in draw order within each list. `signs` are upright signs before they are hung on walls. */
export interface Parts {
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

export function emptyParts(): Parts {
  return { ground: [], decals: [], island: [], solids: [], glows: [], signs: [], groundSigns: [], billboards: [], pools: [] };
}

const SEG = 24;
const NIGHT: RGB = [0.62, 0.62, 0.8];

export function night(hex: string, k = 1): RGB {
  const c = hexRgb(hex);
  return [c[0] * NIGHT[0] * k, c[1] * NIGHT[1] * k, c[2] * NIGHT[2] * k];
}

/** A flat quad between offsets d0 and d1 from s0 to s1 along the track. */
export function strip(track: Track, s0: number, s1: number, d0: number, d1: number, z: number): P3[] {
  const a = track.pointAt(s0, d0);
  const b = track.pointAt(s1, d0);
  const c = track.pointAt(s1, d1);
  const d = track.pointAt(s0, d1);
  return [
    [a.x, a.y, z],
    [b.x, b.y, z],
    [c.x, c.y, z],
    [d.x, d.y, z],
  ];
}

export function ground(pts: P3[], rgb: RGB): Poly {
  const p = makePoly(pts, rgb);
  p.noFog = true;
  return p;
}

/** Cuts the line from a to b into pieces of at most SEG, so long walls sort piece by piece. */
export function pieces(ax: number, ay: number, bx: number, by: number, fn: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SEG));
  for (let i = 0; i < n; i++) {
    fn(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n);
  }
}

// Box walls wind so that their plane normals point outwards.
export function box(
  out: Poly[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  side: RGB,
  top: RGB,
  front?: RGB,
): void {
  const face = (ax: number, ay: number, bx: number, by: number, c: RGB) =>
    pieces(ax, ay, bx, by, (a, b, c2, d) => {
      const p = makePoly(wall(a, b, c2, d, z0, z1), c);
      p.closed = true;
      out.push(p);
    });
  face(x1, y0, x0, y0, scaleRgb(side, 0.8));
  face(x1, y1, x1, y0, side);
  face(x0, y1, x1, y1, front ?? side);
  face(x0, y0, x0, y1, side);
  const long = x1 - x0 >= y1 - y0;
  pieces(x0, y0, long ? x1 : x0, long ? y0 : y1, (a, b, c, d) => {
    out.push(makePoly(long ? rect(a, y0, c, y1, z1) : rect(x0, b, x1, d, z1), top));
  });
}

export function insideHull(h: readonly (readonly [number, number])[], x: number, y: number): boolean {
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
export function attachSigns(solids: Poly[], signs: TexQuad[]): TexQuad[] {
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
    const cuts: { a: number; b: number; p: Poly; z: number }[] = [];
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
      const z = Math.min(zHi, q.pts[0][2]) - Math.max(zLo, q.pts[2][2]);
      if (b - a <= 1e-3) continue;
      const same = cuts.findIndex((u) => Math.abs(u.a - a) < 1e-3 && Math.abs(u.b - b) < 1e-3);
      if (same < 0) cuts.push({ a, b, p, z });
      else if (z > cuts[same]!.z) cuts[same] = { a, b, p, z };
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

export function label(
  w: number,
  h: number,
  text: string,
  bg: string | null,
  fg: string,
  font: number,
  stripe?: string,
  glow = true,
): () => HTMLCanvasElement {
  return lazyCanvas(w, h, (g) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    }
    if (stripe) {
      g.fillStyle = stripe;
      g.fillRect(0, h - Math.round(h / 6), w, Math.round(h / 6));
    }
    g.font = `${font}px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fg;
    g.shadowColor = fg;
    g.shadowBlur = glow ? Math.max(2, font / 5) : 0;
    g.fillText(text, w / 2, h / 2 - (stripe ? h / 14 : 0), w - 8);
  });
}
