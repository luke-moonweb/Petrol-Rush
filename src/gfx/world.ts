import { CONFIG } from '../config';
import type { Car } from '../race/car';
import { type OilSlick, oilRadius } from '../race/oil';
import type { Track } from '../track/common';
import type { SegmentTrack } from '../track/segment';
import { buildCircuitCanvas } from './track/circuit/canvas';
import { buildTrackCanvas } from './track/oval/canvas';
import { CAR_ANCHOR_X, CAR_ANCHOR_Y, carDirIndex, carGlowSprite, PLAYER_DIRECTIONS, playerCarSprite } from './vehicles';

/** The part of the world shown in the race view. */
export interface Cam {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampCamera(cx: number, cy: number, w: number, h: number, worldW: number, worldH: number): Cam {
  const axis = (c: number, view: number, world: number) =>
    world <= view ? Math.round((world - view) / 2) : Math.min(Math.max(Math.round(c) - view / 2, 0), world - view);
  return { x: axis(cx, w, worldW), y: axis(cy, h, worldH), w, h };
}

let ovalBg: HTMLCanvasElement | null = null;
let circuitBg: { id: string; canvas: HTMLCanvasElement } | null = null;

/** Pre-rendered track: the oval stays cached for the title screen, plus the latest other circuit. */
export function trackCanvas(track: Track): HTMLCanvasElement {
  if (track.id === 'oval') {
    if (!ovalBg) ovalBg = buildTrackCanvas();
    return ovalBg;
  }
  if (circuitBg?.id !== track.id) circuitBg = { id: track.id, canvas: buildCircuitCanvas(track as SegmentTrack) };
  return circuitBg.canvas;
}

export function drawTrack(g: CanvasRenderingContext2D, track: Track, cam: Cam): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, cam.w, cam.h);
  const sx = Math.max(0, cam.x);
  const sy = Math.max(0, cam.y);
  const w = Math.min(track.worldW, cam.x + cam.w) - sx;
  const h = Math.min(track.worldH, cam.y + cam.h) - sy;
  if (w > 0 && h > 0) g.drawImage(trackCanvas(track), sx, sy, w, h, sx - cam.x, sy - cam.y, w, h);
}

export function drawCarLights(
  g: CanvasRenderingContext2D,
  cars: Car[],
  cam: Cam,
  ix: (c: Car) => number,
  iy: (c: Car) => number,
  ih: (c: Car) => number,
  pass: 'beams' | 'lamps',
): void {
  const K = (CONFIG.CAR_LEN + 4) / 4;
  const P = Math.SQRT1_2;
  g.globalCompositeOperation = 'lighter';
  for (const car of cars) {
    const ox = ix(car) - cam.x;
    const oy = iy(car) - cam.y;
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

/** `fine`: the car drawn at PLAYER_DIRECTIONS headings (the player's; none in the title demo). */
export function drawCars(
  g: CanvasRenderingContext2D,
  cars: Car[],
  cam: Cam,
  ix: (c: Car) => number,
  iy: (c: Car) => number,
  ih: (c: Car) => number,
  fine?: Car,
): void {
  const visible = cars.filter((c) => inView(cam, c.x, c.y, 40)).sort((p, q) => iy(p) - iy(q));
  drawCarLights(g, visible, cam, ix, iy, ih, 'beams');
  for (const car of visible) {
    const spr =
      car === fine
        ? playerCarSprite(car.colorIdx, carDirIndex(ih(car), PLAYER_DIRECTIONS))
        : carGlowSprite(car.colorIdx, carDirIndex(ih(car)));
    g.drawImage(spr, Math.round(ix(car)) - cam.x - CAR_ANCHOR_X, Math.round(iy(car)) - cam.y - CAR_ANCHOR_Y);
  }
  drawCarLights(g, visible, cam, ix, iy, ih, 'lamps');
}

export function inView(cam: Cam, x: number, y: number, margin: number): boolean {
  return x - cam.x > -margin && x - cam.x < cam.w + margin && y - cam.y > -margin && y - cam.y < cam.h + margin;
}

export function drawOil(g: CanvasRenderingContext2D, oil: readonly OilSlick[], cam: Cam): void {
  for (const o of oil) {
    if (!inView(cam, o.x, o.y, 30)) continue;
    const x = o.x - cam.x;
    const y = o.y - cam.y;
    const r = oilRadius(o);
    const fade = Math.min(1, (CONFIG.OIL_LIFE_S - o.age) / CONFIG.OIL_FADE_S);
    const seed = Math.abs(Math.sin(o.x * 12.9898 + o.y * 78.233)) * 1000;
    g.save();
    g.globalAlpha = 0.85 * fade;
    g.fillStyle = '#07060C';
    g.beginPath();
    g.ellipse(x, y, r, r * 0.8, seed % Math.PI, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) {
      const a = seed + k * 1.7;
      const d = r * (0.55 + 0.25 * Math.sin(a * 3));
      const rr = r * (0.35 + 0.15 * Math.cos(a * 5));
      g.moveTo(x + Math.cos(a) * d + rr, y + Math.sin(a) * d * 0.8);
      g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, rr, 0, Math.PI * 2);
    }
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35 * fade;
    const sheen = g.createRadialGradient(x - r * 0.25, y - r * 0.2, 1, x, y, r);
    sheen.addColorStop(0, 'rgba(120,90,200,0.0)');
    sheen.addColorStop(0.45, 'rgba(70,180,170,0.55)');
    sheen.addColorStop(0.7, 'rgba(200,120,220,0.45)');
    sheen.addColorStop(0.9, 'rgba(230,180,80,0.3)');
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sheen;
    g.beginPath();
    g.ellipse(x, y, r * 0.9, r * 0.7, seed % Math.PI, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
