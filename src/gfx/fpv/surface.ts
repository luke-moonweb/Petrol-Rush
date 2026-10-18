import { CONFIG } from '../../config';
import { oilRadius } from '../../race/oil';
import type { Race } from '../../race/race';
import { type Camera, clipProject, drawGlowAt, fillProjected } from './engine';
import type { Glow } from './kit';
import type { Scene } from './scene';

// What lies on the asphalt in the cockpit view: oil slicks and the floodlights' pools of light.

const OIL_MIN_PX = 6;
const POOL_RINGS = [1, 0.6];

const wx = new Float32Array(64);
const wy = new Float32Array(64);
const wz = new Float32Array(64);

export function drawGlow(g: CanvasRenderingContext2D, c: Camera, gl: Glow): void {
  drawGlowAt(g, c, gl.x, gl.y, gl.z, gl.r, gl.color);
}

export function drawOilSlicks(g: CanvasRenderingContext2D, c: Camera, race: Race, far: number): void {
  for (const o of race.oil) {
    const d = c.dist(o.x, o.y);
    if (d > far || !c.inView(o.x, o.y, 20)) continue;
    const r = oilRadius(o);
    const fade = Math.max(0, Math.min(1, (CONFIG.OIL_LIFE_S - o.age) / CONFIG.OIL_FADE_S));
    const ring = (k: number, style: string) => {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        wx[i] = o.x + Math.cos(a) * r * k;
        wy[i] = o.y + Math.sin(a) * r * k * 0.8;
        wz[i] = 0.05;
      }
      fillProjected(g, clipProject(c, wx, wy, wz, 16), style);
    };
    const grow = Math.max(1, (OIL_MIN_PX * d) / (c.focal * r * 0.8));
    const rr = (k: number, style: string) => ring(k * Math.min(grow, 3), style);
    g.globalAlpha = fade;
    rr(1, 'rgba(4,3,8,0.9)');
    g.globalCompositeOperation = 'lighter';
    rr(0.9, 'rgba(200,120,220,0.22)');
    rr(0.7, 'rgba(70,180,170,0.3)');
    rr(0.35, 'rgba(230,180,80,0.18)');
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    const glint = Math.max(0, Math.min(1, (d - 40) / 40));
    if (glint > 0) {
      g.globalAlpha = glint * fade;
      drawGlow(g, c, { x: o.x, y: o.y, z: 0.6, r: Math.min(14, 4 + d * 0.012), color: '127,227,217' });
      g.globalAlpha = 1;
    }
  }
}

export function drawPools(g: CanvasRenderingContext2D, c: Camera, sc: Scene, far: number, onIsland: boolean): void {
  g.globalCompositeOperation = 'lighter';
  for (const p of sc.pools) {
    if (p.z > 1 !== onIsland) continue;
    const d = c.dist(p.x, p.y);
    if (d - p.r > far || !c.inView(p.x, p.y, p.r)) continue;
    const fade = d > c.fogNear ? Math.max(0, 1 - (d - c.fogNear) / (far - c.fogNear)) : 1;
    g.globalAlpha = 0.045 * fade;
    for (const k of POOL_RINGS) {
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        wx[i] = p.x + Math.cos(t) * p.r * k;
        wy[i] = p.y + Math.sin(t) * p.r * k;
        wz[i] = p.z;
      }
      fillProjected(g, clipProject(c, wx, wy, wz, 16), 'rgb(255,214,140)');
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
