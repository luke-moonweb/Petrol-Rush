import type { Track } from '../track/common';

const cache = new Map<string, [number, number][]>();

function outline(track: Track): [number, number][] {
  let pts = cache.get(track.id);
  if (!pts) {
    pts = [];
    const n = 160;
    for (let i = 0; i < n; i++) {
      const p = track.pointAt((track.len * i) / n, 0);
      pts.push([p.x, p.y]);
    }
    cache.set(track.id, pts);
  }
  return pts;
}

/** The circuit's shape fitted into a box, with the start/finish line marked. */
export function drawTrackMap(
  g: CanvasRenderingContext2D,
  track: Track,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  lineWidth = 2,
): void {
  const pts = outline(track);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of pts) {
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  }
  const pad = lineWidth + 1;
  const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0));
  const ox = x + (w - (x1 - x0) * s) / 2 - x0 * s;
  const oy = y + (h - (y1 - y0) * s) / 2 - y0 * s;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = lineWidth;
  g.lineJoin = 'round';
  g.beginPath();
  for (const [px, py] of pts) g.lineTo(ox + px * s, oy + py * s);
  g.closePath();
  g.stroke();
  const [sx, sy] = pts[0]!;
  g.fillStyle = '#FFF8E8';
  g.fillRect(Math.round(ox + sx * s) - 1, Math.round(oy + sy * s) - lineWidth - 2, 2, lineWidth * 2 + 4);
  g.restore();
}
