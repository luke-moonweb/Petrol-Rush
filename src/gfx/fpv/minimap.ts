import { HALF_W } from '../../track/common';
import { PR } from '../../ui/theme';
import { bounds, trackOutline } from '../trackmap';
import { CAR_SCHEMES } from '../vehicles';
import type { Scene } from './scene';
import type { CockpitFrame } from './view';

// The minimap in the cockpit's lower right corner: the track's shape at its own proportions, the pit
// lane, the finish line and the cars.

/** Room around the centre line: the tarmac and a little more. */
const MARGIN = HALF_W + 6;

function trackPath(g: CanvasRenderingContext2D, pts: readonly [number, number][], k: number, ox: number, oy: number): void {
  g.beginPath();
  for (const [x, y] of pts) g.lineTo(ox + x * k, oy + y * k);
  g.closePath();
}

export function drawMinimap(g: CanvasRenderingContext2D, w: number, h: number, wheelR: number, f: CockpitFrame, scene: Scene): void {
  const track = f.race.track;
  const pts = trackOutline(track);
  const [bx0, by0, bx1, by1] = bounds(pts);
  const bw = bx1 - bx0 + 2 * MARGIN;
  const bh = by1 - by0 + 2 * MARGIN;
  const pad = 6;
  const room = w / 2 - wheelR - 16;
  const maxW = Math.round(Math.max(90, Math.min(340, w * 0.24, room - pad * 2)));
  const maxH = Math.max(30, Math.min(h * 0.17, maxW * 0.8));
  const k = Math.min(maxW / bw, maxH / bh);
  const mw = Math.round(bw * k);
  const mh = Math.round(bh * k);
  const x0 = w - mw - pad - 8;
  const y0 = h - mh - pad - 8;
  const ox = x0 + (mw - bw * k) / 2 + (MARGIN - bx0) * k;
  const oy = y0 + (mh - bh * k) / 2 + (MARGIN - by0) * k;
  g.save();
  g.fillStyle = 'rgba(10,9,18,0.88)';
  g.beginPath();
  g.roundRect(x0 - pad, y0 - pad, mw + pad * 2, mh + pad * 2, 6);
  g.fill();
  g.strokeStyle = 'rgba(18,181,166,0.55)';
  g.lineWidth = 1;
  g.stroke();
  g.clip();
  const road = 2 * HALF_W * k;
  g.lineJoin = 'round';
  trackPath(g, pts, k, ox, oy);
  g.strokeStyle = 'rgba(255,248,232,0.8)';
  g.lineWidth = Math.max(3, road + 2);
  g.stroke();
  g.strokeStyle = '#3A3946';
  g.lineWidth = Math.max(2, road);
  g.stroke();
  const pit = scene.pitLine;
  g.strokeStyle = 'rgba(127,227,217,0.6)';
  g.lineWidth = Math.max(1, road * 0.4);
  g.beginPath();
  g.moveTo(ox + pit.x0 * k, oy + pit.y * k);
  g.lineTo(ox + pit.x1 * k, oy + pit.y * k);
  g.stroke();
  const a = track.pointAt(0, -HALF_W);
  const b = track.pointAt(0, HALF_W);
  g.strokeStyle = '#FFF8E8';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(ox + a.x * k, oy + a.y * k);
  g.lineTo(ox + b.x * k, oy + b.y * k);
  g.stroke();

  const p = f.race.player;
  const px = ox + f.ix(p) * k;
  const py = oy + f.iy(p) * k;
  const ang = f.ih(p);
  const fan = Math.max(8, Math.min(mh, mw) * 0.25);
  g.fillStyle = 'rgba(127,227,217,0.25)';
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, fan, ang - 0.5, ang + 0.5);
  g.closePath();
  g.fill();
  for (const car of f.race.cars) {
    if (car === p) continue;
    g.fillStyle = car.finished ? '#8A86A0' : CAR_SCHEMES[car.colorIdx % CAR_SCHEMES.length]!.body;
    g.fillRect(ox + f.ix(car) * k - 2, oy + f.iy(car) * k - 2, 4, 4);
  }
  g.translate(px, py);
  g.rotate(ang);
  g.fillStyle = PR.teal;
  g.strokeStyle = '#0A0910';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(7, 0);
  g.lineTo(-4.5, -4.5);
  g.lineTo(-4.5, 4.5);
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
}
