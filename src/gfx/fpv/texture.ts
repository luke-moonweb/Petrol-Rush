import { type Camera, NEAR } from './engine';
import type { P3 } from './geom';

export interface TexQuad {
  pts: [P3, P3, P3, P3];
  tex: () => HTMLCanvasElement;
  u0: number;
  u1: number;
  cols: number;
  rows: number;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  far: number;
  normal: P3;
  tile: boolean;
}

export interface TexOpts {
  cols?: number;
  rows?: number;
  far?: number;
  tile?: boolean;
}

export function texQuad(pts: [P3, P3, P3, P3], tex: () => HTMLCanvasElement, o: TexOpts = {}, u0 = 0, u1 = 1): TexQuad {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  const cz = (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4;
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, Math.hypot(p[0] - cx, p[1] - cy));
  const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
  const e2 = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
  const n: P3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return {
    pts,
    tex,
    u0,
    u1,
    cols: o.cols ?? 1,
    rows: o.rows ?? 1,
    cx,
    cy,
    cz,
    radius,
    far: o.far ?? 1100,
    normal: [n[0] / l, n[1] / l, n[2] / l],
    tile: o.tile ?? false,
  };
}

// Part of a quad between fractions a and b of its width (left → right), keeping the texture mapping.
export function subQuad(q: TexQuad, a: number, b: number): TexQuad {
  const [tl, tr, br, bl] = q.pts;
  const lerp = (p: P3, r: P3, t: number): P3 => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t];
  const du = q.u1 - q.u0;
  return texQuad(
    [lerp(tl, tr, a), lerp(tl, tr, b), lerp(bl, br, b), lerp(bl, br, a)],
    q.tex,
    { cols: 1, rows: q.rows, far: q.far, tile: q.tile },
    q.tile ? 0 : q.u0 + du * a,
    q.tile ? 1 : q.u0 + du * b,
  );
}

export function lazyCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): () => HTMLCanvasElement {
  let c: HTMLCanvasElement | null = null;
  return () => {
    if (!c) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
    }
    return c;
  };
}

export function texFacing(q: TexQuad, c: Camera): boolean {
  return q.normal[0] * (c.x - q.cx) + q.normal[1] * (c.y - q.cy) + q.normal[2] * (c.z - q.cz) > 0;
}

const sx = new Float32Array(8);
const sy = new Float32Array(8);
const cell: P3[] = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

// Camera-space corners of the current cell (lateral, height, depth) with their texture coordinates.
const ca = new Float32Array(4);
const cb = new Float32Array(4);
const cd = new Float32Array(4);
const cu = [0, 0, 0, 0];
const cv = [0, 0, 0, 0];

function toCamera(c: Camera, p: P3, i: number): void {
  const dx = p[0] - c.x;
  const dy = p[1] - c.y;
  cd[i] = dx * c.cos + dy * c.sin;
  ca[i] = -dx * c.sin + dy * c.cos;
  cb[i] = p[2] - c.z;
}

// Clips the cell against the near plane (keeping the texture coordinates) and projects it into sx/sy/us/vs.
// Returns the number of points (0, or 3 to 5).
function clipCell(c: Camera): number {
  let m = 0;
  const emit = (a: number, b: number, d: number, u: number, v: number) => {
    sx[m] = c.ox + (c.flip * c.focal * a) / d;
    sy[m] = c.oy - (c.focal * b) / d;
    us[m] = u;
    vs[m] = v;
    m++;
  };
  for (let i = 0; i < 4; i++) {
    const p = (i + 3) % 4;
    const inC = cd[i]! >= NEAR;
    const inP = cd[p]! >= NEAR;
    if (inC !== inP) {
      const t = (NEAR - cd[p]!) / (cd[i]! - cd[p]!);
      const lerp = (x: number, y: number) => x + (y - x) * t;
      emit(lerp(ca[p]!, ca[i]!), lerp(cb[p]!, cb[i]!), NEAR, lerp(cu[p]!, cu[i]!), lerp(cv[p]!, cv[i]!));
    }
    if (inC) emit(ca[i]!, cb[i]!, cd[i]!, cu[i]!, cv[i]!);
  }
  return m;
}

function tri(g: CanvasRenderingContext2D, img: HTMLCanvasElement, i0: number, i1: number, i2: number, u: number[], v: number[]): void {
  const x0 = sx[i0]!;
  const y0 = sy[i0]!;
  const du1 = u[i1]! - u[i0]!;
  const dv1 = v[i1]! - v[i0]!;
  const du2 = u[i2]! - u[i0]!;
  const dv2 = v[i2]! - v[i0]!;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return;
  const dx1 = sx[i1]! - x0;
  const dy1 = sy[i1]! - y0;
  const dx2 = sx[i2]! - x0;
  const dy2 = sy[i2]! - y0;
  const a = (dx1 * dv2 - dx2 * dv1) / det;
  const cc = (dx2 * du1 - dx1 * du2) / det;
  const b = (dy1 * dv2 - dy2 * dv1) / det;
  const d = (dy2 * du1 - dy1 * du2) / det;
  const mx = (x0 + sx[i1]! + sx[i2]!) / 3;
  const my = (y0 + sy[i1]! + sy[i2]!) / 3;
  g.save();
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const i = k === 0 ? i0 : k === 1 ? i1 : i2;
    const ex = sx[i]! - mx;
    const ey = sy[i]! - my;
    const l = Math.hypot(ex, ey) || 1;
    const px = sx[i]! + (ex / l) * 0.7;
    const py = sy[i]! + (ey / l) * 0.7;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.clip();
  g.transform(a, b, cc, d, x0 - a * u[i0]! - cc * v[i0]!, y0 - b * u[i0]! - d * v[i0]!);
  g.drawImage(img, 0, 0);
  g.restore();
}

const MIN_PX = 5;
const us = [0, 0, 0, 0, 0, 0, 0, 0];
const vs = [0, 0, 0, 0, 0, 0, 0, 0];

export function drawTexQuad(g: CanvasRenderingContext2D, c: Camera, q: TexQuad, dist: number): void {
  if (!texFacing(q, c)) return;
  const fade = dist > c.fogNear ? Math.max(0, 1 - (dist - c.fogNear) / (q.far - c.fogNear)) : 1;
  if (fade <= 0.02) return;
  const img = q.tex();
  const [tl, tr, br, bl] = q.pts;
  const W = img.width;
  const H = img.height;
  const at = (out: P3, s: number, t: number) => {
    for (let k = 0; k < 3; k++) {
      const top = tl[k]! + (tr[k]! - tl[k]!) * s;
      const bot = bl[k]! + (br[k]! - bl[k]!) * s;
      out[k] = top + (bot - top) * t;
    }
  };
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = true;
  g.globalAlpha = fade;
  const du = q.u1 - q.u0;
  for (let j = 0; j < q.rows; j++) {
    for (let i = 0; i < q.cols; i++) {
      const s0 = i / q.cols;
      const s1 = (i + 1) / q.cols;
      const t0 = j / q.rows;
      const t1 = (j + 1) / q.rows;
      at(cell[0]!, s0, t0);
      at(cell[1]!, s1, t0);
      at(cell[2]!, s1, t1);
      at(cell[3]!, s0, t1);
      const ua = (q.u0 + du * s0) * W;
      const ub = (q.u0 + du * s1) * W;
      cu[0] = ua;
      cu[1] = ub;
      cu[2] = ub;
      cu[3] = ua;
      cv[0] = t0 * H;
      cv[1] = t0 * H;
      cv[2] = t1 * H;
      cv[3] = t1 * H;
      for (let k = 0; k < 4; k++) toCamera(c, cell[k]!, k);
      // A cell reaching behind the near plane is clipped instead of dropped, so signs do not vanish up close.
      const m = clipCell(c);
      if (m < 3) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let k = 0; k < m; k++) {
        x0 = Math.min(x0, sx[k]!);
        x1 = Math.max(x1, sx[k]!);
        y0 = Math.min(y0, sy[k]!);
        y1 = Math.max(y1, sy[k]!);
      }
      const lod = Math.min(1, Math.max((y1 - y0) / MIN_PX - 1, (x1 - x0) / (MIN_PX * 4) - 1));
      if (lod <= 0) continue;
      g.globalAlpha = fade * lod;
      for (let k = 1; k < m - 1; k++) tri(g, img, 0, k, k + 1, us, vs);
    }
  }
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = smooth;
}

export interface Billboard {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  tex: () => HTMLCanvasElement;
}

export function drawBillboard(g: CanvasRenderingContext2D, c: Camera, b: Billboard, fade: number): void {
  const dx = b.x - c.x;
  const dy = b.y - c.y;
  const z = dx * c.cos + dy * c.sin;
  if (z < NEAR * 2) return;
  const x = -dx * c.sin + dy * c.cos;
  const k = c.focal / z;
  const w = b.w * k;
  const h = b.h * k;
  if (h < 1) return;
  const px = c.ox + c.flip * x * k;
  const py = c.oy - (b.z - c.z) * k;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = true;
  g.globalAlpha = fade;
  g.drawImage(b.tex(), px - w / 2, py - h, w, h);
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = smooth;
}
