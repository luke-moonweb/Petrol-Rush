import type { Rng } from '../../sim/rng';
import { CY, islandOutline } from '../../track/track';
import { FONT_BLACK } from './style';

export const HELI = { x: 300, y: CY - 39, r: 24 };
export const PYLON = { x: 1945, y: CY - 39 };
const palms: { x: number; y: number; s: number }[] = [];

function insideIsland(x: number, y: number, margin: number): boolean {
  const pts = islandOutline(0);
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!;
    const [bx, by] = pts[i]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return inside && best >= margin;
}

function drawPalm(g: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(x + 3, y + 2, 9 * s, 4 * s, 0, 0, Math.PI * 2);
  g.fill();
  const h = 12 * s;
  const lean = (rng() - 0.5) * 4;
  g.strokeStyle = '#6A4A2A';
  g.lineWidth = 2.2 * s;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + lean, y - h / 2, x + lean * 1.5, y - h);
  g.stroke();
  const cx = x + lean * 1.5;
  const cy = y - h;
  const leaves = 7;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rng() * 0.4;
    const len = (8 + rng() * 3) * s;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.6 + 2 * s;
    g.strokeStyle = i % 2 ? '#2E7A3A' : '#3E9A48';
    g.lineWidth = 2.4 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, cy + Math.sin(a) * len * 0.3 - 3 * s, ex, ey);
    g.stroke();
  }
  g.fillStyle = '#5A3A1A';
  g.beginPath();
  g.arc(cx, cy, 1.6 * s, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'butt';
}

export function drawInfieldDecor(g: CanvasRenderingContext2D, rng: Rng): void {
  g.fillStyle = '#2E2C3A';
  g.beginPath();
  g.arc(HELI.x, HELI.y, HELI.r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#FFF8E8';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(HELI.x, HELI.y, HELI.r - 5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#FFF8E8';
  g.fillRect(HELI.x - 8, HELI.y - 9, 3, 18);
  g.fillRect(HELI.x + 5, HELI.y - 9, 3, 18);
  g.fillRect(HELI.x - 5, HELI.y - 1.5, 10, 3);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(PYLON.x - 10, PYLON.y + 2, 30, 6);
  g.fillStyle = '#3A3848';
  g.fillRect(PYLON.x - 12, PYLON.y - 2, 24, 6);
  palms.length = 0;
  const areas = [
    { x0: 120, x1: 420 },
    { x0: 1800, x1: 2120 },
  ];
  for (const a of areas) {
    let tries = 0;
    let placed = 0;
    while (placed < 11 && tries++ < 400) {
      const x = a.x0 + rng() * (a.x1 - a.x0);
      const y = CY - 77 + rng() * 95;
      if (!insideIsland(x, y, 14)) continue;
      if (Math.hypot(x - HELI.x, y - HELI.y) < HELI.r + 14) continue;
      if (Math.abs(x - PYLON.x) < 24 && y > PYLON.y - 60 && y < PYLON.y + 16) continue;
      if (palms.some((p) => Math.hypot(p.x - x, p.y - y) < 18)) continue;
      palms.push({ x, y, s: 0.85 + rng() * 0.35 });
      placed++;
    }
  }
  palms.sort((p, q) => p.y - q.y);
  for (const p of palms) drawPalm(g, p.x, p.y, p.s, rng);
}

export function drawInfieldDecorLights(g: CanvasRenderingContext2D): void {
  g.globalCompositeOperation = 'lighter';
  for (const p of palms) {
    const gr = g.createRadialGradient(p.x, p.y - 6, 1, p.x, p.y - 6, 16);
    gr.addColorStop(0, 'rgba(255,200,110,0.22)');
    gr.addColorStop(1, 'rgba(255,200,110,0)');
    g.fillStyle = gr;
    g.fillRect(p.x - 16, p.y - 22, 32, 32);
  }
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = HELI.x + Math.cos(a) * HELI.r;
    const y = HELI.y + Math.sin(a) * HELI.r;
    g.save();
    g.fillStyle = k % 3 === 0 ? '#7FE3D9' : '#FFF4D0';
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 5;
    g.fillRect(x - 1, y - 1, 2, 2);
    g.restore();
  }
  const hx = HELI.x;
  const hy = HELI.y + HELI.r + 6;
  g.fillStyle = '#17142B';
  g.fillRect(hx - 9, hy - 14, 18, 15);
  g.save();
  g.font = `11px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#7FE3D9';
  g.shadowColor = '#7FE3D9';
  g.shadowBlur = 5;
  g.fillText('H', hx, hy - 6);
  g.restore();
  const x = PYLON.x;
  const top = PYLON.y - 58;
  g.fillStyle = '#17142B';
  g.fillRect(x - 10, top, 20, 58);
  g.fillStyle = '#2A2838';
  g.fillRect(x - 10, top - 4, 20, 4);
  g.save();
  g.font = `7px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#FFC85A';
  g.shadowColor = '#FFC85A';
  g.shadowBlur = 5;
  g.fillText('P', x, top + 6);
  g.fillStyle = '#FFF8E8';
  g.shadowColor = '#FFF8E8';
  ['BEL', 'TAN', 'FER', 'CAL'].forEach((t, i) => {
    g.fillText(t, x, top + 18 + i * 10);
  });
  g.restore();
  g.save();
  g.fillStyle = '#E63B2E';
  g.shadowColor = '#E63B2E';
  g.shadowBlur = 6;
  g.fillRect(x - 1, top - 7, 2, 3);
  g.restore();
}

export function palmSpots(): readonly { x: number; y: number; s: number }[] {
  return palms;
}
