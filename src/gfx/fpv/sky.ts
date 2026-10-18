import { createRng } from '../../sim/rng';
import { wrapAngle } from '../../track/common';
import type { Camera } from './engine';

// The night sky of the cockpit view: a gradient, stars and a distant skyline in the track's style.

const SKY_TOP = '#05040C';
export const SKY_HORIZON = '#221C3C';

/** A track's sky: the ground colour below the horizon and its skyline (see FpvTheme). */
export interface Sky {
  ground: string;
  skyline: { h: number; color: string; lit: number };
}

export const NIGHT_CITY = { h: 1, color: '#100E1E', lit: 0.45 };

interface Star {
  a: number;
  e: number;
  size: number;
}
interface Tower {
  a0: number;
  a1: number;
  e: number;
  lit: number;
}
let stars: Star[] = [];
let skyline: Tower[] = [];

function initSky(): void {
  const rng = createRng(1337);
  stars = Array.from({ length: 140 }, () => ({ a: rng() * Math.PI * 2, e: 0.08 + rng() * 0.7, size: rng() < 0.15 ? 2 : 1 }));
  skyline = [];
  for (let a = 0; a < Math.PI * 2; ) {
    const w = 0.03 + rng() * 0.07;
    skyline.push({ a0: a, a1: a + w, e: 0.02 + rng() * 0.07, lit: rng() });
    a += w + rng() * 0.02;
  }
}

function screenX(c: Camera, rel: number): number {
  return c.ox + c.flip * c.focal * Math.tan(rel);
}

export function drawSky(g: CanvasRenderingContext2D, c: Camera, w: number, yaw: number, look: Sky): void {
  if (stars.length === 0) initSky();
  const sky = g.createLinearGradient(0, 0, 0, c.oy);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, c.oy);
  const lim = Math.atan(c.halfW / c.focal) + 0.05;
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (const st of stars) {
    const rel = wrapAngle(st.a - yaw);
    if (Math.abs(rel) > lim) continue;
    g.fillRect(screenX(c, rel), c.oy - c.focal * Math.tan(st.e), st.size, st.size);
  }
  const { h, color, lit } = look.skyline;
  for (const t of skyline) {
    const r0 = wrapAngle(t.a0 - yaw);
    const r1 = r0 + (t.a1 - t.a0);
    if (r1 < -lim || r0 > lim) continue;
    const xa = screenX(c, Math.max(-lim, r0));
    const xb = screenX(c, Math.min(lim, r1));
    const y = c.oy - c.focal * Math.tan(t.e * h);
    g.fillStyle = color;
    g.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), c.oy - y + 1);
    if (t.lit > 1 - lit) {
      g.fillStyle = 'rgba(255,200,110,0.35)';
      g.fillRect(Math.min(xa, xb) + 2, y + 3, 2, 2);
    }
  }
  g.fillStyle = look.ground;
  g.fillRect(0, c.oy, w, 10_000);
}
