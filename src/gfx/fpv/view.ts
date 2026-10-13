import { CONFIG } from '../../config';
import type { Box } from '../../layout';
import type { Car } from '../../race/car';
import { oilRadius } from '../../race/oil';
import type { Race } from '../../race/race';
import { createRng } from '../../sim/rng';
import { CX_L, CX_R, CY, PIT_DRIVE_Y, PIT_X0, PIT_X1, R_IN, R_OUT, WORLD_W, wrapAngle } from '../../track/track';
import { FONT_BLACK, PR } from '../../ui/theme';
import type { Particles } from '../particles';
import { CAR_SCHEMES, carFaces, driverName, MODEL_SCALE } from '../vehicles';
import { trackCanvas } from '../world';
import { Camera, clipProject, drawPoly, FOG_LEVELS, fillProjected, fogged, hexRgb, NEAR, type Poly, type RGB, visible } from './engine';
import { setPylonNames } from './landmarks';
import { buildScene, type Glow, type Scene } from './scene';
import { type Billboard, drawBillboard, drawTexQuad, type TexQuad } from './texture';

export interface CockpitFrame {
  race: Race;
  view: Box;
  ix: (c: Car) => number;
  iy: (c: Car) => number;
  ih: (c: Car) => number;
  steer: number;
  time: number;
  particles?: Particles;
}

const EYE_BACK = -2;
const EYE_SIDE = -3.6;
const EYE_Z = 9.2;
const MIRROR_FAR = 600;
const LIGHT: [number, number, number] = [0.27, -0.37, 0.89];
const SKY_TOP = '#05040C';
const SKY_HORIZON = '#221C3C';
const GROUND = '#0B0A16';
const SPIN_LOOK = 0.5;
const CAM_EASE_S = 0.25;
const SETTLED = 0.002;
const MAX_SWING = 2.5;
const CAR_REACH = 26;
const OIL_MIN_PX = 6;
const OWN_SMOKE = 15;
const MAX_PUFF_PX = 60;

let scene: Scene | null = null;
const cam = new Camera();
const mirrorCam = new Camera();
let camYaw = Number.NaN;
let camClock = 0;
let recovering = false;
let camOff = 0;

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

const shadeCache = new Map<string, string>();
function lit(color: string, k: number, level: number, fog: RGB): string {
  const kq = Math.round(k * 20);
  const key = `${color}|${kq}|${level}`;
  let s = shadeCache.get(key);
  if (!s) {
    const amt = kq / 20;
    const c = hexRgb(color).map((v) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))) as RGB;
    s = fogged(c, fog, level);
    shadeCache.set(key, s);
  }
  return s;
}

const glowSprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = glowSprites.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${color},0.75)`);
    gr.addColorStop(0.35, `rgba(${color},0.22)`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowSprites.set(color, c);
  }
  return c;
}

const wx = new Float32Array(64);
const wy = new Float32Array(64);
const wz = new Float32Array(64);

function screenX(c: Camera, rel: number): number {
  return c.ox + c.flip * c.focal * Math.tan(rel);
}

function drawSky(g: CanvasRenderingContext2D, c: Camera, w: number, yaw: number): void {
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
  for (const t of skyline) {
    const r0 = wrapAngle(t.a0 - yaw);
    const r1 = r0 + (t.a1 - t.a0);
    if (r1 < -lim || r0 > lim) continue;
    const xa = screenX(c, Math.max(-lim, r0));
    const xb = screenX(c, Math.min(lim, r1));
    const y = c.oy - c.focal * Math.tan(t.e);
    g.fillStyle = '#100E1E';
    g.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), c.oy - y + 1);
    if (t.lit > 0.55) {
      g.fillStyle = 'rgba(255,200,110,0.35)';
      g.fillRect(Math.min(xa, xb) + 2, y + 3, 2, 2);
    }
  }
  g.fillStyle = GROUND;
  g.fillRect(0, c.oy, w, 10_000);
}

function drawGlow(g: CanvasRenderingContext2D, c: Camera, gl: Glow): void {
  const dx = gl.x - c.x;
  const dy = gl.y - c.y;
  const z = dx * c.cos + dy * c.sin;
  if (z < NEAR * 2 || z > c.far) return;
  const x = -dx * c.sin + dy * c.cos;
  const r = (c.focal * gl.r) / z;
  if (r < 0.8) return;
  const sx = c.ox + (c.flip * c.focal * x) / z;
  const sy = c.oy - (c.focal * (gl.z - c.z)) / z;
  g.globalCompositeOperation = 'lighter';
  g.drawImage(glowSprite(gl.color), sx - r, sy - r, r * 2, r * 2);
  g.globalCompositeOperation = 'source-over';
}

function drawCar(g: CanvasRenderingContext2D, c: Camera, car: Car, f: CockpitFrame, dist: number): void {
  const h = f.ih(car);
  const ox = f.ix(car);
  const oy = f.iy(car);
  const cs = Math.cos(h);
  const sn = Math.sin(h);
  const K = MODEL_SCALE;
  const level = c.fogLevel(dist);
  const toWorld = (pts: ArrayLike<readonly number[]>): number => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      wx[i] = ox + (p[0]! * cs - p[1]! * sn) * K;
      wy[i] = oy + (p[0]! * sn + p[1]! * cs) * K;
      wz[i] = p[2]! * K;
    }
    return n;
  };
  const faces = carFaces(car.colorIdx)
    .map((face) => {
      const nx = face.normal[0] * cs - face.normal[1] * sn;
      const ny = face.normal[0] * sn + face.normal[1] * cs;
      const nz = face.normal[2];
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const p of face.pts) {
        mx += p[0] * cs - p[1] * sn;
        my += p[0] * sn + p[1] * cs;
        mz += p[2];
      }
      const n = face.pts.length;
      const fx = ox + (mx / n) * K;
      const fy = oy + (my / n) * K;
      const fz = (mz / n) * K;
      const facing = nx * (c.x - fx) + ny * (c.y - fy) + nz * (c.z - fz);
      return { face, facing, depth: c.depth(fx, fy), light: Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) };
    })
    .filter((x) => x.facing > 0)
    .sort((a, b) => b.depth - a.depth);
  for (const { face, light } of faces) {
    const k = face.flat ? -0.15 : -0.45 + 0.45 * light;
    fillProjected(g, clipProject(c, wx, wy, wz, toWorld(face.pts)), lit(face.color, k, level, c.fog));
    if (dist > 260) continue;
    for (const d of face.decals ?? []) {
      fillProjected(g, clipProject(c, wx, wy, wz, toWorld(d.pts)), lit(d.color, d.flat ? -0.15 : -0.45 + 0.45 * light, level, c.fog));
    }
  }
  const toCam = (lx: number) => lx * cs * (c.x - ox) + lx * sn * (c.y - oy) > 0;
  const lamp = (lx: number, ly0: number, ly1: number, z0: number, z1: number, color: string) => {
    const quad = [
      [lx, ly0, z0],
      [lx, ly1, z0],
      [lx, ly1, z1],
      [lx, ly0, z1],
    ];
    fillProjected(g, clipProject(c, wx, wy, wz, toWorld(quad)), color);
  };
  const glowAt = (lx: number, ly: number, z: number, r: number, color: string) =>
    drawGlow(g, c, { x: ox + (lx * cs - ly * sn) * K, y: oy + (lx * sn + ly * cs) * K, z, r, color });
  if (toCam(-1)) {
    for (const side of [-1, 1]) {
      lamp(-2.02, side * 0.42, side * 0.78, 0.44, 0.58, car.braking ? '#FF5A46' : '#B81E18');
      glowAt(-2.1, side * 0.6, 5, car.braking ? 7 : 4.5, '255,60,40');
    }
  }
  if (toCam(1)) {
    for (const side of [-1, 1]) {
      lamp(2.02, side * 0.4, side * 0.75, 0.4, 0.52, '#FFF6DA');
      glowAt(2.1, side * 0.57, 4.6, 8, '255,244,210');
    }
  }
}

function drawOilSlicks(g: CanvasRenderingContext2D, c: Camera, race: Race, far: number): void {
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

function drawPools(g: CanvasRenderingContext2D, c: Camera, sc: Scene, far: number, onIsland: boolean): void {
  g.globalCompositeOperation = 'lighter';
  for (const p of sc.pools) {
    if (p.z > 1 !== onIsland) continue;
    const d = c.dist(p.x, p.y);
    if (d - p.r > far || !c.inView(p.x, p.y, p.r)) continue;
    const fade = d > c.fogNear ? Math.max(0, 1 - (d - c.fogNear) / (far - c.fogNear)) : 1;
    g.globalAlpha = 0.045 * fade;
    for (const k of [1, 0.6]) {
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

interface Item {
  d: number;
  poly?: Poly;
  car?: Car;
  x?: number;
  y?: number;
  dist?: number;
  glow?: Glow;
  sign?: TexQuad;
  bill?: Billboard;
  puff?: { x: number; y: number; z: number; r: number; a: number; spark: boolean };
}

// Centroid depth alone misplaces a car next to a wall piece. For walls close to a car, the side of the
// wall plane the car is on (compared with the camera) decides which of the two must be drawn first.
function orderCarsAgainstWalls(c: Camera, items: Item[]): void {
  const walls = items.filter((it) => it.poly?.plane);
  for (const it of items) {
    if (!it.car) continue;
    const x = it.x!;
    const y = it.y!;
    let front = Infinity;
    let behind = -Infinity;
    for (const w of walls) {
      const p = w.poly!;
      const reach = p.radius + CAR_REACH;
      if (Math.abs(p.cx - x) > reach || Math.abs(p.cy - y) > reach) continue;
      const [nx, ny, k] = p.plane!;
      const sCar = nx * x + ny * y - k;
      const sCam = nx * c.x + ny * c.y - k;
      if (sCar * sCam >= 0) front = Math.min(front, w.d);
      else behind = Math.max(behind, w.d);
    }
    if (front !== Infinity) it.d = Math.min(it.d, front - 0.01);
    if (behind !== -Infinity && behind > it.d) it.d = behind + 0.01;
  }
}

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

function drawPuff(g: CanvasRenderingContext2D, c: Camera, p: NonNullable<Item['puff']>): void {
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

function renderWorld(g: CanvasRenderingContext2D, c: Camera, f: CockpitFrame, cheap: boolean): void {
  if (!scene) {
    trackCanvas();
    scene = buildScene();
  }
  for (const p of scene.ground) {
    const d = visible(p, c);
    if (d >= 0) drawPoly(g, c, p, d);
  }
  drawPools(g, c, scene, cheap ? 300 : 900, false);
  const decalFar = cheap ? 200 : 650;
  for (const p of scene.decals) {
    const d = visible(p, c);
    if (d >= 0 && d < decalFar) drawPoly(g, c, p, d);
  }
  if (!cheap) {
    for (const q of scene.groundSigns) {
      const d = c.dist(q.cx, q.cy);
      if (d < q.far && c.inView(q.cx, q.cy, q.radius)) drawTexQuad(g, c, q, d);
    }
  }
  drawOilSlicks(g, c, f.race, cheap ? 300 : 900);
  for (const p of scene.island) {
    const d = visible(p, c);
    if (d >= 0) drawPoly(g, c, p, d);
  }
  drawPools(g, c, scene, cheap ? 300 : 900, true);

  const items: Item[] = [];
  for (const p of scene.solids) {
    if (visible(p, c) < 0) continue;
    items.push({ d: c.depth(p.cx, p.cy), poly: p });
  }
  for (const q of cheap ? [] : scene.signs) {
    const dist = c.dist(q.cx, q.cy);
    if (dist - q.radius > q.far || !c.inView(q.cx, q.cy, q.radius)) continue;
    items.push({ d: c.depth(q.cx, q.cy) - 0.3, sign: q, dist });
  }
  for (const b of cheap ? [] : scene.billboards) {
    const dist = c.dist(b.x, b.y);
    if (dist > c.far || c.depth(b.x, b.y) < NEAR * 2 || !c.inView(b.x, b.y, b.w)) continue;
    items.push({ d: c.depth(b.x, b.y), bill: b, dist });
  }
  for (const gl of scene.glows) {
    const d = c.depth(gl.x, gl.y);
    if (d > NEAR * 2 && d < c.far && c.inView(gl.x, gl.y, gl.r)) items.push({ d: d - 0.5, glow: gl });
  }
  const player = f.race.player;
  for (const car of f.race.cars) {
    if (car === player) continue;
    const x = f.ix(car);
    const y = f.iy(car);
    const dist = c.dist(x, y);
    if (dist > c.far || !c.inView(x, y, CAR_REACH)) continue;
    items.push({ d: c.depth(x, y), car, x, y, dist });
  }
  if (!cheap) {
    f.particles?.forEachLive((spark, x, y, t, size) => {
      const d = c.dist(x, y);
      if (d > 500 || (!spark && d < OWN_SMOKE) || !c.inView(x, y, 10)) return;
      const puff = spark
        ? { x, y, z: 2 + (1 - t) * 3, r: size * 0.5, a: 1 - t, spark }
        : { x, y, z: 4 + t * 8, r: size * (1 + t * 2.2), a: 0.45 * (1 - t), spark };
      items.push({ d: c.depth(x, y) - 0.2, puff });
    });
  }
  orderCarsAgainstWalls(c, items);
  items.sort((a, b) => b.d - a.d);
  for (const it of items) {
    if (it.poly) {
      const dist = c.dist(it.poly.cx, it.poly.cy);
      drawPoly(g, c, it.poly, dist);
      if (!cheap) for (const q of it.poly.decals ?? []) if (dist - q.radius < q.far) drawTexQuad(g, c, q, c.dist(q.cx, q.cy));
    } else if (it.car) drawCar(g, c, it.car, f, it.dist!);
    else if (it.glow) drawGlow(g, c, it.glow);
    else if (it.sign) drawTexQuad(g, c, it.sign, it.dist!);
    else if (it.bill) drawBillboard(g, c, it.bill, Math.max(0.15, 1 - c.fogLevel(it.dist!) / FOG_LEVELS));
    else if (it.puff) drawPuff(g, c, it.puff);
  }
}

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

function drawMinimap(g: CanvasRenderingContext2D, w: number, h: number, wheelR: number, f: CockpitFrame): void {
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
  const yaw = f.ih(p);
  const px = x0 + f.ix(p) * kx;
  const py = y0 + f.iy(p) * ky;
  const vx = Math.cos(yaw) * kx;
  const vy = Math.sin(yaw) * ky;
  const ang = Math.atan2(vy, vx);
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

function wheelRadius(w: number, h: number): number {
  return Math.min(w * 0.19, h * 0.3);
}

/** Metal bezel + night instrument glow around a cluster dial. */
function clusterBezel(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  glow: string,
): void {
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = r * 0.65;
  g.fillStyle = '#1A1824';
  g.beginPath();
  g.arc(cx, cy, r + 3, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  const bezel = g.createRadialGradient(cx - r * 0.28, cy - r * 0.35, r * 0.08, cx, cy, r + 3);
  bezel.addColorStop(0, '#7A7688');
  bezel.addColorStop(0.4, '#3E3A4C');
  bezel.addColorStop(1, '#121018');
  g.fillStyle = bezel;
  g.beginPath();
  g.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0A0910';
  g.beginPath();
  g.arc(cx, cy, r - 1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(18,181,166,0.2)';
  g.lineWidth = Math.max(1, r * 0.035);
  g.beginPath();
  g.arc(cx, cy, r - 1, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function clusterNeedle(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ang: number,
  len: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.6, len * 0.07);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - Math.cos(ang) * len * 0.12, cy - Math.sin(ang) * len * 0.12);
  g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = PR.steel;
  g.beginPath();
  g.arc(cx, cy, Math.max(2.2, len * 0.09), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0A0910';
  g.beginPath();
  g.arc(cx, cy, Math.max(1.2, len * 0.04), 0, Math.PI * 2);
  g.fill();
}

// Cabin PoC demo: race with cockpit cam (KeyC / prefs), watch hood lip + dash gauges + glass flecks near oil/after scrapes.
function glassSoil(f: CockpitFrame): { oil: number; scrape: number } {
  const p = f.race.player;
  let oil = 0;
  for (const o of f.race.oil) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < 100) oil = Math.max(oil, 1 - d / 100);
  }
  const scrape = Math.min(1, (p.wallImpact + p.contactStrength) / 36 + (p.spinTime > 0 ? 0.5 : 0));
  return { oil, scrape };
}

/** Night windshield: cool sky sheen, warm dash bounce, pillar wash; flecks stay off the race lane. */
function drawWindshieldGlass(g: CanvasRenderingContext2D, w: number, h: number, glassBot: number, f: CockpitFrame): void {
  const gx0 = w * 0.08;
  const gy0 = h * 0.06;
  const gw = w * 0.84;
  const gh = glassBot - gy0;

  const glass = g.createLinearGradient(0, gy0, 0, glassBot);
  glass.addColorStop(0, 'rgba(120,150,220,0.07)');
  glass.addColorStop(0.28, 'rgba(180,200,255,0.035)');
  glass.addColorStop(0.55, 'rgba(255,255,255,0.015)');
  glass.addColorStop(0.78, 'rgba(40,28,18,0.045)');
  glass.addColorStop(1, 'rgba(8,6,14,0.14)');
  g.fillStyle = glass;
  g.fillRect(gx0, gy0, gw, gh);

  // Cool night sky band (upper third, soft diagonal).
  const skySheen = g.createLinearGradient(w * 0.1, h * 0.08, w * 0.9, h * 0.32);
  skySheen.addColorStop(0, 'rgba(140,170,255,0)');
  skySheen.addColorStop(0.4, 'rgba(160,190,255,0.055)');
  skySheen.addColorStop(0.65, 'rgba(255,248,232,0.04)');
  skySheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = skySheen;
  g.fillRect(w * 0.12, h * 0.08, w * 0.76, h * 0.22);

  // Warm instrument bounce off lower glass (teal–amber night palette).
  const dashBounce = g.createLinearGradient(w * 0.25, glassBot - h * 0.14, w * 0.75, glassBot);
  dashBounce.addColorStop(0, 'rgba(18,181,166,0)');
  dashBounce.addColorStop(0.45, 'rgba(18,181,166,0.04)');
  dashBounce.addColorStop(0.72, 'rgba(255,200,90,0.05)');
  dashBounce.addColorStop(1, 'rgba(255,182,39,0.03)');
  g.fillStyle = dashBounce;
  g.fillRect(w * 0.18, glassBot - h * 0.16, w * 0.64, h * 0.16);

  // Soft A-pillar wash — edges only so the track stays readable.
  const leftWash = g.createLinearGradient(gx0, gy0, w * 0.28, gy0 + gh * 0.7);
  leftWash.addColorStop(0, 'rgba(0,0,0,0.16)');
  leftWash.addColorStop(0.55, 'rgba(0,0,0,0.04)');
  leftWash.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = leftWash;
  g.fillRect(gx0, gy0, w * 0.22, gh);
  const rightWash = g.createLinearGradient(w - gx0, gy0, w * 0.72, gy0 + gh * 0.65);
  rightWash.addColorStop(0, 'rgba(0,0,0,0.16)');
  rightWash.addColorStop(0.55, 'rgba(0,0,0,0.04)');
  rightWash.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rightWash;
  g.fillRect(w * 0.7, gy0, w * 0.22, gh);

  // Faint wiper-arc hint (very soft, does not muddy the view).
  g.save();
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.08, w * 0.42, h * 0.55, 0, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(8,6,12,0.07)';
  g.lineWidth = Math.max(8, w * 0.012);
  g.stroke();
  g.restore();

  const { oil, scrape } = glassSoil(f);
  const dirt = Math.min(1, oil * 0.9 + scrape * 0.75);
  if (dirt > 0.04) {
    // Seeded flecks biased to lower corners / edges — never a muddy center strip.
    const rng = createRng(901 + Math.floor(f.time * 0.28) * 19 + Math.floor(dirt * 10));
    const n = Math.floor(4 + oil * 10 + scrape * 12);
    for (let i = 0; i < n; i++) {
      const edge = rng();
      let fx: number;
      let fy: number;
      if (edge < 0.35) {
        fx = w * (0.12 + rng() * 0.18);
        fy = h * (0.18 + rng() * 0.42);
      } else if (edge < 0.7) {
        fx = w * (0.7 + rng() * 0.18);
        fy = h * (0.18 + rng() * 0.42);
      } else {
        fx = w * (0.22 + rng() * 0.56);
        fy = h * (0.42 + rng() * 0.2);
      }
      const isOil = rng() < oil / (oil + scrape + 0.001);
      if (isOil) {
        g.fillStyle = `rgba(28,22,10,${0.1 + oil * 0.18})`;
        g.beginPath();
        g.ellipse(fx, fy, 2 + rng() * 4.5 * oil, 0.6 + rng() * 1.4, rng() * Math.PI, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = `rgba(48,36,22,${0.1 + scrape * 0.2})`;
        const s = 0.8 + rng() * 2.2 * scrape;
        g.beginPath();
        g.ellipse(fx, fy, s, s * (0.35 + rng() * 0.55), rng() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function drawCockpit(g: CanvasRenderingContext2D, w: number, h: number, f: CockpitFrame): void {
  const p = f.race.player;
  const dashTop = h * 0.74;
  const glassBot = dashTop - h * 0.08;

  drawWindshieldGlass(g, w, h, glassBot, f);

  // Structure draw order: hood mass (behind glass lip) → roof/A-pillar solids →
  // pillar thickness + roof underside → hood nose lip. Keeps cabin from reading paper-thin.
  const roofDeep = h * 0.072;
  const roofDip = h * 0.138;
  const pilL0 = 0;
  const pilL1 = w * 0.128;
  const pilL2 = w * 0.055;
  const pilL3 = w * 0.022;
  const pilR0 = w;
  const pilR1 = w * 0.872;
  const pilR2 = w * 0.945;
  const pilR3 = w * 0.978;
  const pilBot = h * 0.72;
  const hoodY0 = glassBot - h * 0.01;
  const hoodY1 = dashTop - h * 0.015;

  // Hood / nose body first — sits under the glass opening, darker than dash.
  const hoodBody = g.createLinearGradient(0, hoodY0, 0, hoodY1);
  hoodBody.addColorStop(0, '#0A0912');
  hoodBody.addColorStop(0.45, '#07060C');
  hoodBody.addColorStop(1, '#05040A');
  g.fillStyle = hoodBody;
  g.beginPath();
  g.moveTo(w * 0.1, glassBot + h * 0.028);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.055, w * 0.9, glassBot + h * 0.028);
  g.lineTo(w * 0.94, hoodY1);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.135, w * 0.06, hoodY1);
  g.closePath();
  g.fill();

  // Roof header solid — opaque band so sky never leaks through the header.
  g.fillStyle = '#08070E';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, 0);
  g.lineTo(w, roofDeep);
  g.quadraticCurveTo(w * 0.5, roofDip, 0, roofDeep);
  g.closePath();
  g.fill();
  // Roof underside lip (thickness facing the cabin).
  const roofLip = g.createLinearGradient(0, roofDeep * 0.55, 0, roofDip);
  roofLip.addColorStop(0, 'rgba(28,24,40,0.95)');
  roofLip.addColorStop(0.55, 'rgba(14,12,22,0.9)');
  roofLip.addColorStop(1, 'rgba(5,4,10,0)');
  g.fillStyle = roofLip;
  g.beginPath();
  g.moveTo(w * 0.12, roofDeep * 0.85);
  g.quadraticCurveTo(w * 0.5, roofDip - h * 0.012, w * 0.88, roofDeep * 0.85);
  g.lineTo(w * 0.86, roofDip - h * 0.028);
  g.quadraticCurveTo(w * 0.5, roofDip + h * 0.01, w * 0.14, roofDip - h * 0.028);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,248,232,0.08)';
  g.lineWidth = Math.max(1, w * 0.0018);
  g.beginPath();
  g.moveTo(w * 0.14, roofDeep * 0.92);
  g.quadraticCurveTo(w * 0.5, roofDip - h * 0.018, w * 0.86, roofDeep * 0.92);
  g.stroke();

  // A-pillars: outer shade wedge + body + inner highlight face (readable thickness).
  const pillarOuter = '#05040A';
  const pillarBody = '#0B0A12';
  // Left outer shade (against the world edge).
  g.fillStyle = pillarOuter;
  g.beginPath();
  g.moveTo(pilL0, 0);
  g.lineTo(pilL1 * 0.72, 0);
  g.lineTo(pilL3, pilBot);
  g.lineTo(pilL0, pilBot + h * 0.02);
  g.closePath();
  g.fill();
  // Left body.
  g.fillStyle = pillarBody;
  g.beginPath();
  g.moveTo(pilL1 * 0.55, 0);
  g.lineTo(pilL1, 0);
  g.lineTo(pilL2, h * 0.66);
  g.lineTo(pilL3 + w * 0.012, pilBot);
  g.lineTo(pilL3, pilBot);
  g.closePath();
  g.fill();
  // Left inner face (cooler highlight toward glass).
  const leftInner = g.createLinearGradient(pilL1, 0, pilL2, h * 0.6);
  leftInner.addColorStop(0, 'rgba(255,248,232,0.14)');
  leftInner.addColorStop(0.35, 'rgba(127,227,217,0.1)');
  leftInner.addColorStop(1, 'rgba(18,181,166,0.04)');
  g.fillStyle = leftInner;
  g.beginPath();
  g.moveTo(pilL1 * 0.9, h * 0.015);
  g.lineTo(pilL1, h * 0.01);
  g.lineTo(pilL2 + w * 0.01, h * 0.64);
  g.lineTo(pilL2 - w * 0.004, h * 0.655);
  g.closePath();
  g.fill();
  // Left outer recess shadow.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.moveTo(0, h * 0.02);
  g.lineTo(pilL1 * 0.35, h * 0.01);
  g.lineTo(pilL3 * 0.6, pilBot);
  g.lineTo(0, pilBot);
  g.closePath();
  g.fill();

  // Right outer shade.
  g.fillStyle = pillarOuter;
  g.beginPath();
  g.moveTo(pilR0, 0);
  g.lineTo(pilR1 + (w - pilR1) * 0.28, 0);
  g.lineTo(pilR3, pilBot);
  g.lineTo(pilR0, pilBot + h * 0.02);
  g.closePath();
  g.fill();
  // Right body.
  g.fillStyle = pillarBody;
  g.beginPath();
  g.moveTo(pilR1 + (w - pilR1) * 0.45, 0);
  g.lineTo(pilR1, 0);
  g.lineTo(pilR2, h * 0.62);
  g.lineTo(pilR3 - w * 0.012, pilBot);
  g.lineTo(pilR3, pilBot);
  g.closePath();
  g.fill();
  // Right inner face.
  const rightInner = g.createLinearGradient(pilR1, 0, pilR2, h * 0.58);
  rightInner.addColorStop(0, 'rgba(255,248,232,0.14)');
  rightInner.addColorStop(0.35, 'rgba(127,227,217,0.1)');
  rightInner.addColorStop(1, 'rgba(18,181,166,0.04)');
  g.fillStyle = rightInner;
  g.beginPath();
  g.moveTo(pilR1 + (w - pilR1) * 0.1, h * 0.015);
  g.lineTo(pilR1, h * 0.01);
  g.lineTo(pilR2 - w * 0.01, h * 0.6);
  g.lineTo(pilR2 + w * 0.004, h * 0.615);
  g.closePath();
  g.fill();
  // Right outer recess shadow.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.moveTo(w, h * 0.02);
  g.lineTo(pilR1 + (w - pilR1) * 0.65, h * 0.01);
  g.lineTo(pilR3 + (w - pilR3) * 0.4, pilBot);
  g.lineTo(w, pilBot);
  g.closePath();
  g.fill();

  // Seal pillar→hood corners so the aperture reads as one windshield opening.
  g.fillStyle = pillarBody;
  g.beginPath();
  g.moveTo(0, h * 0.62);
  g.lineTo(pilL2, h * 0.64);
  g.lineTo(w * 0.12, glassBot + h * 0.02);
  g.lineTo(0, pilBot);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(w, h * 0.58);
  g.lineTo(pilR2, h * 0.6);
  g.lineTo(w * 0.88, glassBot + h * 0.02);
  g.lineTo(w, pilBot);
  g.closePath();
  g.fill();

  // Hood / nose lip on top of the hood body — raised edge between glass bottom and dash.
  g.fillStyle = '#06050B';
  g.beginPath();
  g.moveTo(w * 0.13, glassBot + h * 0.018);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.048, w * 0.87, glassBot + h * 0.018);
  g.lineTo(w * 0.89, glassBot + h * 0.048);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.012, w * 0.11, glassBot + h * 0.048);
  g.closePath();
  g.fill();
  const hoodEdge = g.createLinearGradient(0, glassBot - h * 0.055, 0, glassBot + h * 0.05);
  hoodEdge.addColorStop(0, 'rgba(18,181,166,0.22)');
  hoodEdge.addColorStop(0.35, 'rgba(255,248,232,0.08)');
  hoodEdge.addColorStop(0.7, 'rgba(20,16,30,0.35)');
  hoodEdge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hoodEdge;
  g.beginPath();
  g.moveTo(w * 0.15, glassBot + h * 0.008);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.042, w * 0.85, glassBot + h * 0.008);
  g.lineTo(w * 0.83, glassBot + h * 0.032);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.008, w * 0.17, glassBot + h * 0.032);
  g.closePath();
  g.fill();
  // Soft shadow from lip onto the hood deck (depth cue before dash).
  const hoodDeckShade = g.createLinearGradient(0, glassBot + h * 0.02, 0, dashTop);
  hoodDeckShade.addColorStop(0, 'rgba(0,0,0,0.35)');
  hoodDeckShade.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  hoodDeckShade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hoodDeckShade;
  g.beginPath();
  g.moveTo(w * 0.14, glassBot + h * 0.03);
  g.quadraticCurveTo(w * 0.5, glassBot - h * 0.02, w * 0.86, glassBot + h * 0.03);
  g.lineTo(w * 0.9, dashTop - h * 0.03);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.11, w * 0.1, dashTop - h * 0.03);
  g.closePath();
  g.fill();

  // Matte dash plastic under the hood lip (instrument binnacle sits in the center recess).
  const dash = g.createLinearGradient(0, dashTop - h * 0.08, 0, h);
  dash.addColorStop(0, '#2A2736');
  dash.addColorStop(0.18, '#1C1A28');
  dash.addColorStop(0.55, '#12101A');
  dash.addColorStop(1, '#08070E');
  g.fillStyle = dash;
  g.beginPath();
  g.moveTo(0, dashTop + h * 0.02);
  g.quadraticCurveTo(w * 0.22, dashTop - h * 0.01, w * 0.32, dashTop - h * 0.008);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.095, w * 0.68, dashTop - h * 0.008);
  g.quadraticCurveTo(w * 0.82, dashTop + h * 0.005, w, dashTop + h * 0.03);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  // Soft teal rim light along the dash lip (night instrument wash).
  const lipGlow = g.createLinearGradient(0, dashTop - h * 0.1, 0, dashTop + h * 0.04);
  lipGlow.addColorStop(0, 'rgba(18,181,166,0)');
  lipGlow.addColorStop(0.55, 'rgba(18,181,166,0.22)');
  lipGlow.addColorStop(0.85, 'rgba(255,200,90,0.08)');
  lipGlow.addColorStop(1, 'rgba(18,181,166,0)');
  g.fillStyle = lipGlow;
  g.beginPath();
  g.moveTo(w * 0.08, dashTop + h * 0.01);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.1, w * 0.92, dashTop + h * 0.01);
  g.lineTo(w * 0.9, dashTop + h * 0.035);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.055, w * 0.1, dashTop + h * 0.035);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(18,181,166,0.35)';
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(0, dashTop + h * 0.02);
  g.quadraticCurveTo(w * 0.22, dashTop - h * 0.01, w * 0.32, dashTop - h * 0.008);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.095, w * 0.68, dashTop - h * 0.008);
  g.quadraticCurveTo(w * 0.82, dashTop + h * 0.005, w, dashTop + h * 0.03);
  g.stroke();

  // Recessed instrument binnacle — gauges read as bolted in-car cluster, not HUD.
  const binCx = w * 0.5;
  const binCy = dashTop + h * 0.018;
  const binW = w * 0.52;
  const binH = h * 0.115;
  g.fillStyle = '#0A0912';
  g.beginPath();
  g.moveTo(binCx - binW * 0.5, binCy + binH * 0.15);
  g.quadraticCurveTo(binCx - binW * 0.48, binCy - binH * 0.55, binCx - binW * 0.22, binCy - binH * 0.72);
  g.quadraticCurveTo(binCx, binCy - binH * 0.95, binCx + binW * 0.22, binCy - binH * 0.72);
  g.quadraticCurveTo(binCx + binW * 0.48, binCy - binH * 0.55, binCx + binW * 0.5, binCy + binH * 0.15);
  g.quadraticCurveTo(binCx, binCy + binH * 0.55, binCx - binW * 0.5, binCy + binH * 0.15);
  g.closePath();
  g.fill();
  const binShade = g.createLinearGradient(binCx, binCy - binH, binCx, binCy + binH * 0.2);
  binShade.addColorStop(0, 'rgba(0,0,0,0.55)');
  binShade.addColorStop(0.45, 'rgba(18,181,166,0.06)');
  binShade.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = binShade;
  g.fill();
  g.strokeStyle = 'rgba(74,72,96,0.7)';
  g.lineWidth = 1.4;
  g.stroke();
  g.strokeStyle = 'rgba(255,200,90,0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(binCx - binW * 0.42, binCy - binH * 0.35);
  g.quadraticCurveTo(binCx, binCy - binH * 0.78, binCx + binW * 0.42, binCy - binH * 0.35);
  g.stroke();

  const mphVal = Math.round(Math.abs(p.speed));
  const fuel = Math.max(0, Math.min(1, p.fuel));
  const rpmT = Math.min(1, Math.abs(p.speed) / CONFIG.MAX_MPH);
  const labelPx = Math.max(7, Math.round(h * 0.012));
  const tickPx = Math.max(6, Math.round(h * 0.01));

  // FUEL dial (left secondary).
  const fuelCx = binCx - binW * 0.28;
  const fuelCy = binCy - binH * 0.05;
  const fuelR = Math.max(16, h * 0.034);
  const fuelGlow = fuel < 0.2 ? 'rgba(230,59,46,0.55)' : 'rgba(18,181,166,0.45)';
  clusterBezel(g, fuelCx, fuelCy, fuelR, fuelGlow);
  g.strokeStyle = PR.red;
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(fuelCx, fuelCy, fuelR - 5, Math.PI, Math.PI + Math.PI * 0.12, false);
  g.stroke();
  g.strokeStyle = PR.amber;
  g.lineWidth = 1.2;
  for (let k = 0; k <= 4; k++) {
    const a = Math.PI + (k / 4) * Math.PI;
    const major = k % 2 === 0;
    g.beginPath();
    g.moveTo(fuelCx + Math.cos(a) * (fuelR - (major ? 11 : 9)), fuelCy + Math.sin(a) * (fuelR - (major ? 11 : 9)));
    g.lineTo(fuelCx + Math.cos(a) * (fuelR - 4), fuelCy + Math.sin(a) * (fuelR - 4));
    g.stroke();
  }
  g.fillStyle = PR.amber;
  g.font = `${tickPx}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('E', fuelCx - fuelR + 9, fuelCy - 2);
  g.fillText('F', fuelCx + fuelR - 9, fuelCy - 2);
  clusterNeedle(g, fuelCx, fuelCy, Math.PI + fuel * Math.PI, fuelR - 6, fuel < 0.2 ? PR.red : PR.amber);
  g.font = `bold ${labelPx}px ${FONT_BLACK}`;
  g.fillStyle = fuel < 0.12 && Math.floor(f.time * 3) % 2 === 0 ? PR.amber : PR.tealLight;
  if (fuel < 0.12) {
    g.shadowColor = PR.amber;
    g.shadowBlur = 6;
  }
  g.fillText('FUEL', fuelCx, fuelCy + fuelR * 0.42);
  g.shadowBlur = 0;

  // MPH dial (center primary) — digital + arc ticks.
  const mphCx = binCx;
  const mphCy = binCy - binH * 0.18;
  const mphR = Math.max(24, h * 0.048);
  clusterBezel(g, mphCx, mphCy, mphR, 'rgba(255,200,90,0.5)');
  const mphAng = (val: number) => Math.PI + (Math.min(200, val) / 200) * Math.PI;
  g.strokeStyle = PR.red;
  g.lineWidth = 2.8;
  g.beginPath();
  g.arc(mphCx, mphCy, mphR - 6, mphAng(CONFIG.SPIN_MPH), mphAng(200), false);
  g.stroke();
  g.strokeStyle = PR.amber;
  for (let val = 0; val <= 200; val += 20) {
    if (val > CONFIG.SPIN_MPH) continue;
    const a = mphAng(val);
    const major = val % 40 === 0;
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(mphCx + Math.cos(a) * (mphR - (major ? 13 : 10)), mphCy + Math.sin(a) * (mphR - (major ? 13 : 10)));
    g.lineTo(mphCx + Math.cos(a) * (mphR - 5), mphCy + Math.sin(a) * (mphR - 5));
    g.stroke();
  }
  g.fillStyle = PR.amber;
  g.font = `${tickPx}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const val of [0, 80, 160]) {
    const a = mphAng(val);
    g.fillText(String(val), mphCx + Math.cos(a) * (mphR - 17), mphCy + Math.sin(a) * (mphR - 17));
  }
  const mphHot = mphVal > CONFIG.SPIN_MPH;
  g.font = `bold ${Math.max(14, Math.round(h * 0.032))}px ${FONT_BLACK}`;
  g.fillStyle = mphHot ? PR.red : PR.amber;
  g.shadowColor = mphHot ? 'rgba(230,59,46,0.85)' : 'rgba(255,200,90,0.75)';
  g.shadowBlur = 7;
  g.fillText(p.reverse ? `R${mphVal}` : String(mphVal), mphCx, mphCy - mphR * 0.12);
  g.shadowBlur = 0;
  clusterNeedle(g, mphCx, mphCy, mphAng(mphVal), mphR - 7, mphHot ? PR.red : '#FF5A3A');
  g.font = `bold ${labelPx}px ${FONT_BLACK}`;
  g.fillStyle = PR.muted;
  g.fillText('MPH', mphCx, mphCy + mphR * 0.38);

  // RPM dial (right secondary).
  const rpmCx = binCx + binW * 0.28;
  const rpmCy = binCy - binH * 0.05;
  const rpmR = Math.max(16, h * 0.034);
  clusterBezel(g, rpmCx, rpmCy, rpmR, 'rgba(18,181,166,0.5)');
  g.strokeStyle = 'rgba(138,134,160,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(rpmCx, rpmCy, rpmR - 5, Math.PI * 0.85, Math.PI * 0.15, false);
  g.stroke();
  g.strokeStyle = 'rgba(230,59,46,0.65)';
  g.beginPath();
  g.arc(rpmCx, rpmCy, rpmR - 5, Math.PI * 0.05, Math.PI * 0.15, false);
  g.stroke();
  g.strokeStyle = PR.tealLight;
  g.lineWidth = 1.2;
  for (let k = 0; k <= 5; k++) {
    const a = Math.PI * 0.85 + (k / 5) * Math.PI * 1.3;
    g.beginPath();
    g.moveTo(rpmCx + Math.cos(a) * (rpmR - 10), rpmCy + Math.sin(a) * (rpmR - 10));
    g.lineTo(rpmCx + Math.cos(a) * (rpmR - 4), rpmCy + Math.sin(a) * (rpmR - 4));
    g.stroke();
  }
  const rpmAng = Math.PI * 0.85 + rpmT * Math.PI * 1.3;
  clusterNeedle(g, rpmCx, rpmCy, rpmAng, rpmR - 6, PR.amber);
  g.font = `bold ${labelPx}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.fillStyle = PR.tealLight;
  g.fillText('RPM', rpmCx, rpmCy + rpmR * 0.42);

  // Lap / TO GO — small LCD window under the MPH bezel (tertiary race cue).
  const lcdW = Math.max(56, w * 0.11);
  const lcdH = Math.max(12, h * 0.022);
  const lcdX = mphCx - lcdW / 2;
  const lcdY = mphCy + mphR * 0.55;
  g.fillStyle = '#05040C';
  g.beginPath();
  g.roundRect(lcdX - 2, lcdY - 2, lcdW + 4, lcdH + 4, 3);
  g.fill();
  g.strokeStyle = 'rgba(74,72,96,0.8)';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#0E1A18';
  g.fillRect(lcdX, lcdY, lcdW, lcdH);
  g.font = `bold ${Math.max(8, Math.round(h * 0.014))}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (f.race.started && !p.finished) {
    const left = f.race.lapsToGo(p);
    const finalLap = left <= 1;
    g.fillStyle = finalLap ? PR.amber : PR.tealLight;
    g.shadowColor = finalLap ? 'rgba(255,200,90,0.7)' : 'rgba(18,181,166,0.55)';
    g.shadowBlur = 4;
    g.fillText(finalLap ? 'FINAL' : `${left} TO GO`, mphCx, lcdY + lcdH / 2);
    g.shadowBlur = 0;
  } else {
    g.fillStyle = 'rgba(18,181,166,0.35)';
    g.fillText('— — —', mphCx, lcdY + lcdH / 2);
  }

  // Steering wheel: leather rim thickness, tapered spokes, hub; rotates with steer; sits low for mirror/minimap.
  const r = wheelRadius(w, h);
  const cx = w * 0.5;
  const cy = h + r * 0.42;
  g.save();
  g.translate(cx, cy);
  g.rotate(f.steer * 1.4);
  // Outer carcass + matte leather + inner highlight = readable rim thickness.
  g.strokeStyle = '#07060B';
  g.lineWidth = r * 0.24;
  g.lineCap = 'butt';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#1A1520';
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#2A2432';
  g.lineWidth = r * 0.07;
  g.beginPath();
  g.arc(0, 0, r - r * 0.02, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,248,232,0.12)';
  g.lineWidth = r * 0.03;
  g.beginPath();
  g.arc(0, 0, r - r * 0.07, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  // Grip pads at 9 / 3.
  g.strokeStyle = '#14101A';
  g.lineWidth = r * 0.13;
  g.beginPath();
  g.arc(0, 0, r, Math.PI * 0.88, Math.PI * 1.12);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, r, -Math.PI * 0.12, Math.PI * 0.12);
  g.stroke();
  // Three tapered spokes into the hub (one at 6 o'clock).
  for (const a of [Math.PI * 0.5, Math.PI * 0.5 + (Math.PI * 2) / 3, Math.PI * 0.5 + (Math.PI * 4) / 3]) {
    g.save();
    g.rotate(a);
    const spoke = g.createLinearGradient(r * 0.2, 0, r * 0.9, 0);
    spoke.addColorStop(0, '#2A2736');
    spoke.addColorStop(1, '#16131E');
    g.fillStyle = spoke;
    g.beginPath();
    g.moveTo(r * 0.2, -r * 0.055);
    g.lineTo(r * 0.88, -r * 0.085);
    g.lineTo(r * 0.88, r * 0.085);
    g.lineTo(r * 0.2, r * 0.055);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(201,204,214,0.18)';
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }
  // Soft hand suggestion (does not climb into mirror band).
  g.fillStyle = 'rgba(32,26,36,0.5)';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(side * r * 0.82, r * 0.06, r * 0.14, r * 0.1, side * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = PR.red;
  g.fillRect(-r * 0.04, -r * 1.08, r * 0.08, r * 0.16);
  // Hub + small team cue.
  const hub = g.createRadialGradient(-r * 0.06, -r * 0.08, r * 0.02, 0, 0, r * 0.32);
  hub.addColorStop(0, '#2E2A3A');
  hub.addColorStop(1, '#16131E');
  g.fillStyle = hub;
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(201,204,214,0.35)';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = PR.teal;
  g.fillRect(-r * 0.12, -r * 0.035, r * 0.24, r * 0.07);
  g.fillStyle = PR.amber;
  g.beginPath();
  g.arc(0, 0, r * 0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawMirror(g: CanvasRenderingContext2D, w: number, h: number, f: CockpitFrame, ex: number, ey: number, yaw: number): void {
  const mw = Math.round(Math.max(140, Math.min(420, w * 0.26)));
  const mh = Math.round(mw * 0.25);
  const mx = Math.round(Math.min(w - mw - 8, w * 0.56 - mw / 2));
  const my = Math.round(h * 0.03);
  g.fillStyle = '#0B0A12';
  g.fillRect(mx + mw / 2 - 3, 0, 6, my + 2);
  g.save();
  g.beginPath();
  g.roundRect(mx, my, mw, mh, mh * 0.35);
  g.clip();
  mirrorCam.set(ex, ey, EYE_Z + 1, yaw + Math.PI);
  mirrorCam.focal = mh * 2;
  mirrorCam.ox = mx + mw / 2;
  mirrorCam.oy = my + mh * 0.5;
  mirrorCam.halfW = mw / 2;
  mirrorCam.flip = -1;
  mirrorCam.far = MIRROR_FAR;
  mirrorCam.fogNear = 180;
  g.fillStyle = SKY_HORIZON;
  g.fillRect(mx, my, mw, mirrorCam.oy - my);
  g.fillStyle = GROUND;
  g.fillRect(mx, mirrorCam.oy, mw, mh);
  renderWorld(g, mirrorCam, f, true);
  const sheen = g.createLinearGradient(mx, my, mx + mw, my + mh);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(mx, my, mw, mh);
  g.restore();
  g.strokeStyle = '#15131F';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(mx, my, mw, mh, mh * 0.35);
  g.stroke();
}

// During a spin the camera keeps looking roughly where the car travels instead of turning with it.
// Afterwards it follows the car's heading and only its leftover offset fades out, so turning into the
// rest of a corner does not leave it trailing. In normal driving it is locked to the heading.
export function cameraYaw(p: Car, heading: number): number {
  const now = performance.now() / 1000;
  const dt = Math.max(0, Math.min(0.1, now - camClock));
  camClock = now;
  const ease = Math.min(1, dt / CAM_EASE_S);
  if (p.spinTime > 0 && Math.abs(p.speed) > 2) {
    const off = wrapAngle(heading - p.moveAngle);
    const target = p.moveAngle + Math.max(-SPIN_LOOK, Math.min(SPIN_LOOK, off));
    if (Number.isNaN(camYaw)) camYaw = heading;
    camYaw += wrapAngle(target - camYaw) * ease;
    camOff = wrapAngle(camYaw - heading);
    recovering = true;
    return camYaw;
  }
  if (recovering) {
    camOff -= Math.sign(camOff) * Math.min(Math.abs(camOff) * ease, MAX_SWING * dt);
    if (Math.abs(camOff) < SETTLED) recovering = false;
    else {
      camYaw = heading + camOff;
      return camYaw;
    }
  }
  camYaw = heading;
  return camYaw;
}

export function drawCockpitView(g: CanvasRenderingContext2D, f: CockpitFrame): void {
  if (stars.length === 0) initSky();
  setPylonNames(
    f.race
      .standings()
      .slice(0, 4)
      .map((car) => driverName(car.colorIdx).slice(0, 3)),
  );
  const v = f.view;
  const p = f.race.player;
  const heading = f.ih(p);
  const yaw = cameraYaw(p, heading);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const ex = f.ix(p) + EYE_BACK * c - EYE_SIDE * s;
  const ey = f.iy(p) + EYE_BACK * s + EYE_SIDE * c;
  const speed = Math.abs(p.speed);
  const shake = speed > 5 ? Math.sin(f.time * 41) * 0.12 * (speed / 180) : 0;

  g.save();
  g.translate(v.x, v.y);
  g.beginPath();
  g.rect(0, 0, v.w, v.h);
  g.clip();
  cam.set(ex, ey, EYE_Z + shake, yaw);
  cam.focal = Math.max(v.h * 0.62, Math.min(v.h * 0.9, v.w * 0.55)) * (1 - 0.08 * Math.min(1, speed / 180));
  cam.ox = v.w / 2;
  cam.oy = Math.round(v.h * 0.42);
  cam.halfW = v.w / 2;
  cam.flip = 1;
  cam.far = 1300;
  cam.fogNear = 260;
  drawSky(g, cam, v.w, yaw);
  renderWorld(g, cam, f, false);
  drawCockpit(g, v.w, v.h, f);
  drawMirror(g, v.w, v.h, f, ex, ey, yaw);
  drawMinimap(g, v.w, v.h, wheelRadius(v.w, v.h), f);
  g.restore();
}
