import { type Camera, NEAR } from './engine';

type P3 = [number, number, number];

export interface TexQuad {
  pts: [P3, P3, P3, P3];
  tex: () => HTMLCanvasElement;
  cols: number;
  rows: number;
  cx: number;
  cy: number;
  radius: number;
  far: number;
}

export function texQuad(pts: [P3, P3, P3, P3], tex: () => HTMLCanvasElement, cols = 1, rows = 1, far = 650): TexQuad {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, Math.hypot(p[0] - cx, p[1] - cy));
  return { pts, tex, cols, rows, cx, cy, radius, far };
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

const sx = new Float32Array(4);
const sy = new Float32Array(4);

function toScreen(c: Camera, x: number, y: number, z: number, i: number): boolean {
  const dx = x - c.x;
  const dy = y - c.y;
  const cz = dx * c.cos + dy * c.sin;
  if (cz < NEAR) return false;
  const cx = -dx * c.sin + dy * c.cos;
  sx[i] = c.ox + (c.flip * c.focal * cx) / cz;
  sy[i] = c.oy - (c.focal * (z - c.z)) / cz;
  return true;
}

function tri(
  g: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  i0: number,
  i1: number,
  i2: number,
  u: [number, number, number],
  v: [number, number, number],
): void {
  const x0 = sx[i0]!;
  const y0 = sy[i0]!;
  const du1 = u[1] - u[0];
  const dv1 = v[1] - v[0];
  const du2 = u[2] - u[0];
  const dv2 = v[2] - v[0];
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
  const grow = (x: number, y: number): [number, number] => {
    const ex = x - mx;
    const ey = y - my;
    const l = Math.hypot(ex, ey) || 1;
    return [x + (ex / l) * 0.7, y + (ey / l) * 0.7];
  };
  g.save();
  g.beginPath();
  const p0 = grow(x0, y0);
  const p1 = grow(sx[i1]!, sy[i1]!);
  const p2 = grow(sx[i2]!, sy[i2]!);
  g.moveTo(p0[0], p0[1]);
  g.lineTo(p1[0], p1[1]);
  g.lineTo(p2[0], p2[1]);
  g.closePath();
  g.clip();
  g.transform(a, b, cc, d, x0 - a * u[0] - cc * v[0], y0 - b * u[0] - d * v[0]);
  g.drawImage(img, 0, 0);
  g.restore();
}

export function drawTexQuad(g: CanvasRenderingContext2D, c: Camera, q: TexQuad, dist: number): void {
  const img = q.tex();
  const [tl, tr, br, bl] = q.pts;
  const W = img.width;
  const H = img.height;
  const at = (s: number, t: number): P3 => {
    const top: P3 = [tl[0] + (tr[0] - tl[0]) * s, tl[1] + (tr[1] - tl[1]) * s, tl[2] + (tr[2] - tl[2]) * s];
    const bot: P3 = [bl[0] + (br[0] - bl[0]) * s, bl[1] + (br[1] - bl[1]) * s, bl[2] + (br[2] - bl[2]) * s];
    return [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
  };
  const fade = dist > c.fogNear ? Math.max(0, 1 - (dist - c.fogNear) / (q.far - c.fogNear)) : 1;
  if (fade <= 0.02) return;
  g.globalAlpha = fade;
  for (let j = 0; j < q.rows; j++) {
    for (let i = 0; i < q.cols; i++) {
      const s0 = i / q.cols;
      const s1 = (i + 1) / q.cols;
      const t0 = j / q.rows;
      const t1 = (j + 1) / q.rows;
      const corners = [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
      let ok = true;
      corners.forEach((p, k) => {
        ok = toScreen(c, p[0], p[1], p[2], k) && ok;
      });
      if (!ok) continue;
      const u: [number, number, number, number] = [s0 * W, s1 * W, s1 * W, s0 * W];
      const v: [number, number, number, number] = [t0 * H, t0 * H, t1 * H, t1 * H];
      tri(g, img, 0, 1, 2, [u[0], u[1], u[2]], [v[0], v[1], v[2]]);
      tri(g, img, 0, 2, 3, [u[0], u[2], u[3]], [v[0], v[2], v[3]]);
    }
  }
  g.globalAlpha = 1;
}

export interface Billboard {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  tex: () => HTMLCanvasElement;
}

export function drawBillboard(g: CanvasRenderingContext2D, c: Camera, b: Billboard, dist: number): void {
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
  const fade = dist > c.fogNear ? Math.max(0.15, 1 - (dist - c.fogNear) / (c.far - c.fogNear)) : 1;
  g.globalAlpha = fade;
  g.drawImage(b.tex(), px - w / 2, py - h, w, h);
  g.globalAlpha = 1;
}
