import { CX_L, CX_R, CY, PIT_DRIVE_Y, PIT_X0, PIT_X1, R_IN, R_OUT, WORLD_W } from '../../track/oval';
import { PR } from '../../ui/theme';
import { CAR_SCHEMES } from '../vehicles';
import type { CockpitFrame } from './view';

// The oval minimap in the cockpit's lower right corner.

const MAP_H = CY + R_OUT + 12;

function stadiumPath(g: CanvasRenderingContext2D, r: number, kx: number, ky: number, x0: number, y0: number): void {
  g.beginPath();
  for (let a = -90; a <= 270; a += 10) {
    const t = (a * Math.PI) / 180;
    const cx = a <= 90 ? CX_R : CX_L;
    const x = x0 + (cx + r * Math.cos(t)) * kx;
    const y = y0 + (CY + r * Math.sin(t)) * ky;
    if (a === -90) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

export function drawMinimap(g: CanvasRenderingContext2D, w: number, h: number, wheelR: number, f: CockpitFrame): void {
  const pad = 6;
  const room = w / 2 - wheelR - 16;
  const mw = Math.round(Math.max(90, Math.min(340, w * 0.24, room - pad * 2)));
  const mh = Math.round(Math.max(mw / 4.5, Math.min(h * 0.1, mw / 3)));
  const x0 = w - mw - pad - 8;
  const y0 = h - mh - pad - 8;
  const kx = mw / WORLD_W;
  const ky = mh / MAP_H;
  g.save();
  g.fillStyle = 'rgba(10,9,18,0.88)';
  g.beginPath();
  g.roundRect(x0 - pad, y0 - pad, mw + pad * 2, mh + pad * 2, 6);
  g.fill();
  g.strokeStyle = 'rgba(18,181,166,0.55)';
  g.lineWidth = 1;
  g.stroke();
  g.clip();
  stadiumPath(g, R_OUT, kx, ky, x0, y0);
  g.fillStyle = '#3A3946';
  g.fill();
  g.strokeStyle = 'rgba(255,248,232,0.8)';
  g.stroke();
  stadiumPath(g, R_IN, kx, ky, x0, y0);
  g.fillStyle = 'rgba(10,9,18,1)';
  g.fill();
  g.strokeStyle = 'rgba(255,248,232,0.8)';
  g.stroke();
  g.strokeStyle = 'rgba(127,227,217,0.6)';
  g.lineWidth = Math.max(1, mh * 0.04);
  g.beginPath();
  g.moveTo(x0 + PIT_X0 * kx, y0 + PIT_DRIVE_Y * ky);
  g.lineTo(x0 + PIT_X1 * kx, y0 + PIT_DRIVE_Y * ky);
  g.stroke();
  g.fillStyle = '#FFF8E8';
  g.fillRect(x0 + (WORLD_W / 2) * kx - 1, y0 + (CY + R_IN) * ky, 2, (R_OUT - R_IN) * ky);

  const p = f.race.player;
  const px = x0 + f.ix(p) * kx;
  const py = y0 + f.iy(p) * ky;
  // On the squashed map an angle is mapped through the axis scales.
  const mapAngle = (a: number) => Math.atan2(Math.sin(a) * ky, Math.cos(a) * kx);
  const ang = mapAngle(f.ih(p));
  g.fillStyle = 'rgba(127,227,217,0.25)';
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, mh * 0.6, ang - 0.5, ang + 0.5);
  g.closePath();
  g.fill();
  for (const car of f.race.cars) {
    if (car === p) continue;
    g.fillStyle = car.finished ? '#8A86A0' : CAR_SCHEMES[car.colorIdx % CAR_SCHEMES.length]!.body;
    g.fillRect(x0 + f.ix(car) * kx - 2, y0 + f.iy(car) * ky - 2, 4, 4);
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
