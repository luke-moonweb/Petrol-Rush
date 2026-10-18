import type { Puff } from './drawList';
import { type Camera, NEAR } from './engine';

// Tyre smoke and sparks in the cockpit view.

const MAX_PUFF_PX = 60;

let smoke: HTMLCanvasElement | null = null;
function smokeSprite(): HTMLCanvasElement {
  if (!smoke) {
    smoke = document.createElement('canvas');
    smoke.width = 64;
    smoke.height = 64;
    const g = smoke.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(138,134,160,1)');
    gr.addColorStop(0.5, 'rgba(138,134,160,0.5)');
    gr.addColorStop(1, 'rgba(138,134,160,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  return smoke;
}

export function drawPuff(g: CanvasRenderingContext2D, c: Camera, p: Puff): void {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const z = dx * c.cos + dy * c.sin;
  if (z < NEAR * 2) return;
  const k = c.focal / z;
  const sx = c.ox + c.flip * (-dx * c.sin + dy * c.cos) * k;
  const sy = c.oy - (p.z - c.z) * k;
  const r = Math.min(MAX_PUFF_PX, Math.max(p.spark ? 1 : 0.5, p.r * k));
  g.globalAlpha = p.a;
  if (p.spark) {
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#FFD040';
    g.fillRect(sx - r / 2, sy - r / 2, r, r);
    g.globalCompositeOperation = 'source-over';
  } else {
    g.globalAlpha = p.a * 0.6;
    g.drawImage(smokeSprite(), sx - r, sy - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}
