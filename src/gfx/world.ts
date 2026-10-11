import { CONFIG } from '../config';
import { Car } from '../race/car';
import { OilSlick, oilRadius } from '../race/oil';
import { buildTrackCanvas } from '../track/render';
import { CAR_ANCHOR_X, CAR_ANCHOR_Y, carDirIndex, carGlowSprite } from './vehicles';

let trackBg: HTMLCanvasElement | null = null;

export function trackCanvas(): HTMLCanvasElement {
  if (!trackBg) trackBg = buildTrackCanvas();
  return trackBg;
}

export function drawCarLights(
  g: CanvasRenderingContext2D,
  cars: Car[],
  camX: number,
  ix: (c: Car) => number,
  iy: (c: Car) => number,
  ih: (c: Car) => number,
  pass: 'beams' | 'lamps',
): void {
  const K = (CONFIG.CAR_LEN + 4) / 4;
  const P = Math.SQRT1_2;
  g.globalCompositeOperation = 'lighter';
  for (const car of cars) {
    const ox = ix(car) - camX;
    const oy = iy(car);
    const h = ih(car);
    const c = Math.cos(h);
    const sn = Math.sin(h);
    const pt = (fx: number, fy: number, z: number): [number, number] => {
      const wx = fx * c - fy * sn;
      const wy = fx * sn + fy * c;
      return [ox + wx * K, oy + (wy * P - z * P) * K];
    };
    const braking = car.braking;
    const LAMP_X = 2.02;
    const LAMP_Z = 0.5;
    if (pass === 'beams') {
      for (const side of [-0.55, 0.55]) {
        const a = pt(LAMP_X, side - 0.08, LAMP_Z);
        const b = pt(LAMP_X, side + 0.08, LAMP_Z);
        const e1 = pt(9.6, side - 1.5, 0);
        const e2 = pt(9.6, side + 1.5, 0);
        const s0 = pt(LAMP_X, side, LAMP_Z);
        const s1 = pt(9.6, side, 0);
        const gr = g.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
        gr.addColorStop(0, 'rgba(255,244,205,0.42)');
        gr.addColorStop(0.5, 'rgba(255,236,180,0.16)');
        gr.addColorStop(1, 'rgba(255,236,180,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(e1[0], e1[1]);
        g.lineTo(e2[0], e2[1]);
        g.lineTo(b[0], b[1]);
        g.closePath();
        g.fill();
      }
      const pool = pt(4.6, 0, 0);
      const pg = g.createRadialGradient(pool[0], pool[1], 1, pool[0], pool[1], 2.4 * K);
      pg.addColorStop(0, 'rgba(255,240,200,0.18)');
      pg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = pg;
      g.fillRect(pool[0] - 2.4 * K, pool[1] - 2.4 * K, 4.8 * K, 4.8 * K);
      const rear = pt(-2.6, 0, 0);
      const rr = (braking ? 2.2 : 1.5) * K;
      const rg = g.createRadialGradient(rear[0], rear[1], 1, rear[0], rear[1], rr);
      rg.addColorStop(0, braking ? 'rgba(255,40,30,0.5)' : 'rgba(255,40,30,0.28)');
      rg.addColorStop(1, 'rgba(255,40,30,0)');
      g.fillStyle = rg;
      g.fillRect(rear[0] - rr, rear[1] - rr, rr * 2, rr * 2);
      continue;
    }
    if (sn > -0.2) {
      for (const side of [-0.55, 0.55]) {
        const [x, y] = pt(LAMP_X, side, LAMP_Z);
        const lg = g.createRadialGradient(x, y, 0.5, x, y, 5);
        lg.addColorStop(0, 'rgba(255,252,235,0.95)');
        lg.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = lg;
        g.fillRect(x - 5, y - 5, 10, 10);
      }
    }
    if (sn < 0.2) {
      for (const side of [-0.6, 0.6]) {
        const [x, y] = pt(-2.02, side, 0.55);
        const r = braking ? 6 : 4;
        const tg = g.createRadialGradient(x, y, 0.5, x, y, r);
        tg.addColorStop(0, braking ? 'rgba(255,90,70,1)' : 'rgba(255,60,45,0.9)');
        tg.addColorStop(1, 'rgba(255,30,20,0)');
        g.fillStyle = tg;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
  g.globalCompositeOperation = 'source-over';
}

export function drawCars(
  g: CanvasRenderingContext2D,
  cars: Car[],
  camX: number,
  viewW: number,
  ix: (c: Car) => number,
  iy: (c: Car) => number,
  ih: (c: Car) => number,
): void {
  const visible = cars.filter((c) => c.x - camX > -40 && c.x - camX < viewW + 40).sort((p, q) => iy(p) - iy(q));
  drawCarLights(g, visible, camX, ix, iy, ih, 'beams');
  for (const car of visible) {
    const spr = carGlowSprite(car.colorIdx, carDirIndex(ih(car)));
    g.drawImage(spr, Math.round(ix(car)) - camX - CAR_ANCHOR_X, Math.round(iy(car)) - CAR_ANCHOR_Y);
  }
  drawCarLights(g, visible, camX, ix, iy, ih, 'lamps');
}

export function drawOil(g: CanvasRenderingContext2D, oil: readonly OilSlick[], camX: number, viewW: number): void {
  for (const o of oil) {
    const x = o.x - camX;
    if (x < -30 || x > viewW + 30) continue;
    const r = oilRadius(o);
    const fade = Math.min(1, (CONFIG.OIL_LIFE_S - o.age) / CONFIG.OIL_FADE_S);
    const seed = Math.abs(Math.sin(o.x * 12.9898 + o.y * 78.233)) * 1000;
    g.save();
    g.globalAlpha = 0.85 * fade;
    g.fillStyle = '#07060C';
    g.beginPath();
    g.ellipse(x, o.y, r, r * 0.8, seed % Math.PI, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) {
      const a = seed + k * 1.7;
      const d = r * (0.55 + 0.25 * Math.sin(a * 3));
      const rr = r * (0.35 + 0.15 * Math.cos(a * 5));
      g.moveTo(x + Math.cos(a) * d + rr, o.y + Math.sin(a) * d * 0.8);
      g.arc(x + Math.cos(a) * d, o.y + Math.sin(a) * d * 0.8, rr, 0, Math.PI * 2);
    }
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35 * fade;
    const sheen = g.createRadialGradient(x - r * 0.25, o.y - r * 0.2, 1, x, o.y, r);
    sheen.addColorStop(0, 'rgba(120,90,200,0.0)');
    sheen.addColorStop(0.45, 'rgba(70,180,170,0.55)');
    sheen.addColorStop(0.7, 'rgba(200,120,220,0.45)');
    sheen.addColorStop(0.9, 'rgba(230,180,80,0.3)');
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sheen;
    g.beginPath();
    g.ellipse(x, o.y, r * 0.9, r * 0.7, seed % Math.PI, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
