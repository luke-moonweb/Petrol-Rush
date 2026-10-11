import { shade } from './sprites';

export type Vec3 = [number, number, number];

export interface Face {
  pts: Vec3[];
  color: string;
  normal: Vec3;
  decals?: Face[];
  outline?: boolean;
  flat?: boolean;
}

export const PITCH = (45 * Math.PI) / 180;
const SIN_P = Math.sin(PITCH);
const COS_P = Math.cos(PITCH);
const TO_CAMERA: Vec3 = [0, COS_P, SIN_P];
const LIGHT = normalize([-0.35, 0.55, 0.76]);

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function rotZ(p: Vec3, c: number, s: number): Vec3 {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

interface Projected {
  face: Face;
  pts: [number, number][];
  depth: number;
  light: number;
}

function project(face: Face, c: number, s: number, scale: number): Projected | null {
  const n = rotZ(face.normal, c, s);
  if (dot(n, TO_CAMERA) <= 0.001) return null;
  let depth = 0;
  const pts = face.pts.map((p) => {
    const w = rotZ(p, c, s);
    depth += w[1] * COS_P + w[2] * SIN_P;
    return [w[0] * scale, (w[1] * SIN_P - w[2] * COS_P) * scale] as [number, number];
  });
  return { face, pts, depth: depth / face.pts.length, light: Math.max(0, dot(n, LIGHT)) };
}

function fillPoly(g: CanvasRenderingContext2D, pr: Projected): void {
  const f = pr.face;
  g.beginPath();
  pr.pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  const k = f.flat ? 0 : -0.3 + 0.42 * pr.light;
  g.fillStyle = shade(f.color, k);
  g.fill();
  if (f.outline) {
    g.strokeStyle = shade(f.color, -0.6);
    g.lineWidth = 0.7;
    g.stroke();
  }
}

export function renderModel(g: CanvasRenderingContext2D, faces: Face[], yaw: number, scale: number, ox: number, oy: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const visible = faces
    .map((f) => project(f, c, s, scale))
    .filter((p): p is Projected => p !== null)
    .sort((a, b) => a.depth - b.depth);
  g.save();
  g.translate(ox, oy);
  for (const pr of visible) {
    fillPoly(g, pr);
    for (const d of pr.face.decals ?? []) {
      const dp = project(d, c, s, scale);
      if (dp) {
        dp.light = pr.light;
        fillPoly(g, dp);
      }
    }
  }
  g.restore();
}

export function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string, normal: Vec3, extra: Partial<Face> = {}): Face {
  return { pts: [a, b, c, d], color, normal, ...extra };
}

export function wheel(x: number, y: number, zc: number, r: number, side: 1 | -1): Face {
  const pts: Vec3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push([x + Math.cos(a) * r, y, zc + Math.sin(a) * r]);
  }
  if (side < 0) pts.reverse();
  const hub: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    hub.push([x + Math.cos(a) * r * 0.45, y + side * 0.01, zc + Math.sin(a) * r * 0.45]);
  }
  if (side < 0) hub.reverse();
  return {
    pts,
    color: '#141414',
    normal: [0, side, 0],
    flat: true,
    decals: [{ pts: hub, color: '#8a8a8a', normal: [0, side, 0], flat: true }],
  };
}
