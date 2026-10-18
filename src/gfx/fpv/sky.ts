import { createRng, type Rng } from '../../sim/rng';
import { wrapAngle } from '../../track/common';
import type { FpvSky, SkylineKind } from '../track/circuit/theme';
import type { Camera } from './engine';

// The sky of the cockpit view, in each track's own style but always night or dusk (the headlights must
// still matter): a gradient, stars, a low sun or the moon, a haze band and a skyline of silhouettes.

/** A track's sky and the ground colour below the horizon. */
export interface Sky extends FpvSky {
  ground: string;
}

/** The oval's night sky over a city, also the default of a circuit without its own. */
export const NIGHT_SKY: FpvSky = {
  top: '#05040C',
  horizon: '#221C3C',
  stars: 1,
  moon: { az: 2.3, e: 0.32 },
  skyline: { kind: 'city', h: 1, color: '#100E1E', lit: 0.45 },
};

const TAU = Math.PI * 2;
const STAR_COUNT = 160;

interface Star {
  a: number;
  e: number;
  size: number;
}

/** An angular box on the horizon (a tower, a crane's mast or jib); `lit` picks its lights. */
interface Block {
  a0: number;
  a1: number;
  e0: number;
  e1: number;
  lit: number;
  /** A single red warning light on top instead of windows. */
  beacon?: boolean;
}

/** A silhouette as heights round the horizon, with a few lights on it. */
interface Profile {
  e: Float32Array;
  lights: { i: number; lit: number }[];
}

type Shape = { blocks: Block[] } | { profile: Profile };

let stars: Star[] = [];
const shapes = new Map<SkylineKind, Shape>();

function cityBlocks(rng: Rng, low: number): Block[] {
  const out: Block[] = [];
  for (let a = 0; a < TAU; ) {
    const w = 0.03 + rng() * 0.07;
    out.push({ a0: a, a1: a + w, e0: 0, e1: (0.02 + rng() * 0.07) * low, lit: rng() });
    a += w + rng() * 0.02;
  }
  return out;
}

function cranes(rng: Rng): Block[] {
  const out = cityBlocks(rng, 0.35);
  for (let a = rng() * 0.3; a < TAU; a += 0.25 + rng() * 0.35) {
    const top = 0.07 + rng() * 0.03;
    const jib = (0.04 + rng() * 0.04) * (rng() < 0.5 ? 1 : -1);
    out.push({ a0: a, a1: a + 0.004, e0: 0, e1: top, lit: 0 });
    out.push({ a0: Math.min(a, a + jib), a1: Math.max(a, a + jib) + 0.004, e0: top - 0.005, e1: top, lit: 0 });
    out.push({ a0: a - 0.002, a1: a + 0.006, e0: top, e1: top + 0.004, lit: 1, beacon: true });
  }
  return out;
}

function profile(n: number, height: (a: number, i: number) => number, lights: number, rng: Rng): Profile {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.max(0, height((i / n) * TAU, i));
  const out: Profile = { e, lights: [] };
  for (let k = 0; k < lights; k++) out.lights.push({ i: (rng() * n) | 0, lit: rng() });
  return out;
}

function makeShape(kind: SkylineKind): Shape {
  const rng = createRng(2024 + kind.length * 31);
  switch (kind) {
    case 'city':
      return { blocks: cityBlocks(createRng(1337), 1) };
    case 'cranes':
      return { blocks: cranes(rng) };
    case 'hills': {
      const p0 = rng() * TAU;
      const p1 = rng() * TAU;
      return {
        profile: profile(
          720,
          (a) => 0.028 + 0.016 * Math.sin(3 * a + p0) + 0.01 * Math.sin(7 * a + p1) + 0.004 * Math.sin(19 * a),
          90,
          rng,
        ),
      };
    }
    case 'mesas': {
      // Flat-topped plateaus with steep sides over a low desert floor.
      const n = 1440;
      const e = new Float32Array(n).fill(0.006);
      for (let a = 0; a < TAU; ) {
        const w = 0.08 + rng() * 0.3;
        const h = 0.025 + rng() * 0.05;
        const slope = 0.015 + rng() * 0.02;
        for (let i = 0; i < n; i++) {
          let d = (i / n) * TAU - (a + w / 2);
          d = Math.abs(wrapAngle(d)) - w / 2;
          const v = d <= 0 ? h : h - (d / slope) * h;
          if (v > e[i]!) e[i] = v;
        }
        a += w + 0.1 + rng() * 0.5;
      }
      return { profile: { e, lights: [] } };
    }
    case 'pines': {
      // A treeline: pointed crowns over a gentle ridge.
      const n = 2880;
      const ridge = (a: number) => 0.012 + 0.008 * Math.sin(2 * a + 1) + 0.004 * Math.sin(5 * a);
      const e = new Float32Array(n);
      for (let i = 0; i < n; i++) e[i] = ridge((i / n) * TAU);
      for (let c = 0; c < TAU; c += 0.006 + rng() * 0.014) {
        const h = ridge(c) + 0.012 + rng() * 0.03;
        const half = 0.004 + rng() * 0.005;
        const i0 = Math.floor(((c - half) / TAU) * n);
        const i1 = Math.ceil(((c + half) / TAU) * n);
        for (let i = i0; i <= i1; i++) {
          const j = ((i % n) + n) % n;
          const v = h - (Math.abs((i / n) * TAU - c) / half) * (h - ridge(c) + 0.004);
          if (v > e[j]!) e[j] = v;
        }
      }
      return { profile: { e, lights: [] } };
    }
  }
}

function shapeOf(kind: SkylineKind): Shape {
  let s = shapes.get(kind);
  if (!s) {
    s = makeShape(kind);
    shapes.set(kind, s);
  }
  return s;
}

function screenX(c: Camera, rel: number): number {
  return c.ox + c.flip * c.focal * Math.tan(rel);
}

function screenY(c: Camera, e: number): number {
  return c.oy - c.focal * Math.tan(e);
}

function drawBlocks(g: CanvasRenderingContext2D, c: Camera, yaw: number, lim: number, look: Sky, blocks: Block[]): void {
  const { h, color, lit } = look.skyline;
  for (const t of blocks) {
    const r0 = wrapAngle(t.a0 - yaw);
    const r1 = r0 + (t.a1 - t.a0);
    if (r1 < -lim || r0 > lim) continue;
    const xa = screenX(c, Math.max(-lim, r0));
    const xb = screenX(c, Math.min(lim, r1));
    const top = screenY(c, t.e1 * h);
    const bottom = t.e0 > 0 ? screenY(c, t.e0 * h) : c.oy + 1;
    const x = Math.min(xa, xb);
    const w = Math.max(1, Math.abs(xb - xa));
    if (t.beacon) {
      g.fillStyle = 'rgba(255,70,50,0.9)';
      g.fillRect(x, top, Math.max(2, w), 2);
      continue;
    }
    g.fillStyle = color;
    g.fillRect(x, top, w, bottom - top);
    if (t.lit > 1 - lit) {
      g.fillStyle = 'rgba(255,200,110,0.4)';
      g.fillRect(x + 2, top + 3, 2, 2);
      if (w > 9 && bottom - top > 12) g.fillRect(x + w - 5, top + 8, 2, 2);
    }
  }
}

function drawProfile(g: CanvasRenderingContext2D, c: Camera, yaw: number, lim: number, look: Sky, p: Profile): void {
  const { h, color, lit } = look.skyline;
  const n = p.e.length;
  const step = TAU / n;
  const k0 = Math.floor((yaw - lim) / step);
  const k1 = Math.ceil((yaw + lim) / step);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(screenX(c, k0 * step - yaw), c.oy + 1);
  for (let k = k0; k <= k1; k++) g.lineTo(screenX(c, k * step - yaw), screenY(c, p.e[((k % n) + n) % n]! * h));
  g.lineTo(screenX(c, k1 * step - yaw), c.oy + 1);
  g.closePath();
  g.fill();
  if (lit <= 0) return;
  g.fillStyle = 'rgba(255,214,140,0.55)';
  for (const l of p.lights) {
    if (l.lit <= 1 - lit) continue;
    const rel = wrapAngle(l.i * step - yaw);
    if (Math.abs(rel) > lim) continue;
    g.fillRect(screenX(c, rel), screenY(c, p.e[l.i]! * h * 0.6), 2, 2);
  }
}

/** The sun's glow (and its disk when r > 0), low on the horizon. */
function drawSun(g: CanvasRenderingContext2D, c: Camera, yaw: number, lim: number, sun: NonNullable<FpvSky['sun']>): void {
  const rel = wrapAngle(sun.az - yaw);
  if (Math.abs(rel) > lim + 0.9) return;
  // Off screen the glow still reaches in from the side.
  const x = c.ox + c.flip * c.focal * Math.tan(Math.max(-1.3, Math.min(1.3, rel)));
  const y = screenY(c, sun.e);
  const R = c.focal * 0.9;
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, `rgba(${sun.glow},0.65)`);
  gr.addColorStop(0.35, `rgba(${sun.glow},0.22)`);
  gr.addColorStop(1, `rgba(${sun.glow},0)`);
  g.fillStyle = gr;
  g.fillRect(x - R, y - R, 2 * R, R + (c.oy - y) + 1);
  if (sun.r <= 0 || Math.abs(rel) > lim) return;
  g.fillStyle = sun.color;
  g.beginPath();
  g.arc(x, y, c.focal * Math.tan(sun.r), 0, TAU);
  g.fill();
}

function drawMoon(g: CanvasRenderingContext2D, c: Camera, yaw: number, lim: number, moon: NonNullable<FpvSky['moon']>): void {
  const rel = wrapAngle(moon.az - yaw);
  if (Math.abs(rel) > lim) return;
  const x = screenX(c, rel);
  const y = screenY(c, moon.e);
  const r = Math.max(3, c.focal * 0.016);
  const gr = g.createRadialGradient(x, y, r, x, y, r * 5);
  gr.addColorStop(0, 'rgba(220,226,255,0.18)');
  gr.addColorStop(1, 'rgba(220,226,255,0)');
  g.fillStyle = gr;
  g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
  g.fillStyle = '#EEEAD8';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

export function drawSky(g: CanvasRenderingContext2D, c: Camera, w: number, yaw: number, look: Sky): void {
  if (stars.length === 0) {
    const rng = createRng(1337);
    stars = Array.from({ length: STAR_COUNT }, () => ({ a: rng() * TAU, e: 0.08 + rng() * 0.7, size: rng() < 0.15 ? 2 : 1 }));
  }
  const sky = g.createLinearGradient(0, 0, 0, c.oy);
  sky.addColorStop(0, look.top);
  sky.addColorStop(1, look.horizon);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, c.oy);
  const lim = Math.atan(c.halfW / c.focal) + 0.05;
  g.fillStyle = 'rgba(255,255,255,0.6)';
  const shown = Math.round(STAR_COUNT * look.stars);
  for (let i = 0; i < shown; i++) {
    const st = stars[i]!;
    const rel = wrapAngle(st.a - yaw);
    if (Math.abs(rel) > lim) continue;
    g.fillRect(screenX(c, rel), screenY(c, st.e), st.size, st.size);
  }
  if (look.moon) drawMoon(g, c, yaw, lim, look.moon);
  if (look.sun) drawSun(g, c, yaw, lim, look.sun);
  const shape = shapeOf(look.skyline.kind);
  if ('blocks' in shape) drawBlocks(g, c, yaw, lim, look, shape.blocks);
  else drawProfile(g, c, yaw, lim, look, shape.profile);
  if (look.haze) {
    const top = c.oy - c.focal * 0.12;
    const haze = g.createLinearGradient(0, top, 0, c.oy);
    haze.addColorStop(0, 'rgba(0,0,0,0)');
    haze.addColorStop(1, `rgba(${look.haze})`);
    g.fillStyle = haze;
    g.fillRect(0, top, w, c.oy - top);
  }
  g.fillStyle = look.ground;
  g.fillRect(0, c.oy, w, 10_000);
}
