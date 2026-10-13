// Tiny flat-shaded 3D renderer on top of Canvas 2D: world polygons are moved into camera space,
// clipped against the near plane, projected and filled back to front (painter's algorithm).
import type { TexQuad } from './texture';

export type RGB = [number, number, number];

export interface Poly {
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  rgb: RGB;
  cx: number;
  cy: number;
  radius: number;
  emissive?: boolean;
  noFog?: boolean;
  back?: RGB;
  styles?: string[];
  backStyles?: string[];
  plane?: [number, number, number];
  decals?: TexQuad[];
}

export const NEAR = 1.5;
export const FOG_LEVELS = 12;

export class Camera {
  x = 0;
  y = 0;
  z = 0;
  cos = 1;
  sin = 0;
  focal = 300;
  ox = 0;
  oy = 0;
  halfW = 300;
  flip = 1;
  far = 1300;
  fogNear = 220;
  fog: RGB = [14, 12, 28];

  set(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  depth(wx: number, wy: number): number {
    return (wx - this.x) * this.cos + (wy - this.y) * this.sin;
  }

  lateral(wx: number, wy: number): number {
    return -(wx - this.x) * this.sin + (wy - this.y) * this.cos;
  }

  dist(wx: number, wy: number): number {
    return Math.hypot(wx - this.x, wy - this.y);
  }

  fogLevel(d: number): number {
    if (d <= this.fogNear) return 0;
    return Math.min(FOG_LEVELS - 1, Math.floor(((d - this.fogNear) / (this.far - this.fogNear)) * FOG_LEVELS));
  }

  inView(x: number, y: number, radius: number): boolean {
    const z = this.depth(x, y);
    if (z < -radius) return false;
    return Math.abs(this.lateral(x, y)) - radius <= ((Math.max(z, 0) + radius) * this.halfW) / this.focal;
  }
}

export function makePoly(pts: [number, number, number][], rgb: RGB, emissive = false): Poly {
  const n = pts.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  let cx = 0;
  let cy = 0;
  pts.forEach(([x, y, z], i) => {
    xs[i] = x;
    ys[i] = y;
    zs[i] = z;
    cx += x;
    cy += y;
  });
  cx /= n;
  cy /= n;
  let radius = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    radius = Math.max(radius, Math.hypot(xs[i]! - cx, ys[i]! - cy));
    zMin = Math.min(zMin, zs[i]!);
    zMax = Math.max(zMax, zs[i]!);
  }
  const poly: Poly = { xs, ys, zs, rgb, cx, cy, radius, emissive };
  const ex = xs[1]! - xs[0]!;
  const ey = ys[1]! - ys[0]!;
  const len = Math.hypot(ex, ey);
  if (zMax - zMin > 0.5 && len > 0.01) {
    const nx = -ey / len;
    const ny = ex / len;
    poly.plane = [nx, ny, nx * xs[0]! + ny * ys[0]!];
  }
  return poly;
}

export function hexRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function scaleRgb(c: RGB, k: number): RGB {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

export function rgbStyle(c: RGB): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

export function fogged(c: RGB, fog: RGB, level: number): string {
  const t = level / (FOG_LEVELS - 1);
  return rgbStyle([c[0] + (fog[0] - c[0]) * t, c[1] + (fog[1] - c[1]) * t, c[2] + (fog[2] - c[2]) * t]);
}

export function facesCamera(p: Poly, cam: Camera): boolean {
  if (!p.plane) return true;
  return p.plane[0] * cam.x + p.plane[1] * cam.y - p.plane[2] >= 0;
}

export function polyStyle(p: Poly, cam: Camera, d: number): string {
  const useBack = p.back !== undefined && !facesCamera(p, cam);
  const level = p.emissive || p.noFog || useBack ? 0 : cam.fogLevel(d);
  if (useBack) p.backStyles ??= [];
  else p.styles ??= [];
  const cache = (useBack ? p.backStyles : p.styles)!;
  let s = cache[level];
  if (!s) {
    s = fogged(useBack ? p.back! : p.rgb, cam.fog, level);
    cache[level] = s;
  }
  return s;
}

const CAP = 256;
const ax = new Float32Array(CAP);
const ay = new Float32Array(CAP);
const az = new Float32Array(CAP);
export const outX = new Float32Array(CAP * 2);
export const outY = new Float32Array(CAP * 2);

export function clipProject(cam: Camera, xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>, n: number): number {
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - cam.x;
    const dy = ys[i]! - cam.y;
    az[i] = dx * cam.cos + dy * cam.sin;
    ax[i] = -dx * cam.sin + dy * cam.cos;
    ay[i] = zs[i]! - cam.z;
  }
  let m = 0;
  const f = cam.focal;
  const emit = (x: number, y: number, z: number) => {
    outX[m] = cam.ox + (cam.flip * f * x) / z;
    outY[m] = cam.oy - (f * y) / z;
    m++;
  };
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const inC = az[i]! >= NEAR;
    const inP = az[p]! >= NEAR;
    if (inC !== inP) {
      const t = (NEAR - az[p]!) / (az[i]! - az[p]!);
      emit(ax[p]! + (ax[i]! - ax[p]!) * t, ay[p]! + (ay[i]! - ay[p]!) * t, NEAR);
    }
    if (inC) emit(ax[i]!, ay[i]!, az[i]!);
  }
  return m;
}

export function fillProjected(g: CanvasRenderingContext2D, m: number, style: string): void {
  if (m < 3) return;
  g.beginPath();
  g.moveTo(outX[0]!, outY[0]!);
  for (let i = 1; i < m; i++) g.lineTo(outX[i]!, outY[i]!);
  g.closePath();
  g.fillStyle = style;
  g.fill();
}

export function visible(p: Poly, cam: Camera): number {
  const d = cam.dist(p.cx, p.cy);
  if (d - p.radius > cam.far) return -1;
  if (!cam.inView(p.cx, p.cy, p.radius)) return -1;
  return d;
}

export function drawPoly(g: CanvasRenderingContext2D, cam: Camera, p: Poly, d: number): void {
  const m = clipProject(cam, p.xs, p.ys, p.zs, p.xs.length);
  fillProjected(g, m, polyStyle(p, cam, d));
}

const glowSprites = new Map<string, HTMLCanvasElement>();
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowSprites.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${color},0.75)`);
    gr.addColorStop(0.35, `rgba(${color},0.22)`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowSprites.set(color, c);
  }
  return c;
}
