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
const RECOVER_S = 0.6;
const CAR_REACH = 26;
const OIL_MIN_PX = 6;
const OWN_SMOKE = 15;
const MAX_PUFF_PX = 90;

let scene: Scene | null = null;
const cam = new Camera();
const mirrorCam = new Camera();
let camYaw = Number.NaN;
let camClock = 0;
let recover = 0;

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
    if (d > 60) drawGlow(g, c, { x: o.x, y: o.y, z: 0.6, r: Math.min(14, 4 + d * 0.012), color: '127,227,217' });
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
    g.fillStyle = '#C8C6D4';
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
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

function drawCockpit(g: CanvasRenderingContext2D, w: number, h: number, f: CockpitFrame): void {
  const p = f.race.player;
  g.fillStyle = '#0B0A12';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, 0);
  g.lineTo(w, h * 0.05);
  g.quadraticCurveTo(w * 0.5, h * 0.1, 0, h * 0.05);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w * 0.09, 0);
  g.lineTo(w * 0.035, h * 0.64);
  g.lineTo(0, h * 0.68);
  g.closePath();
  g.moveTo(w, 0);
  g.lineTo(w * 0.94, 0);
  g.lineTo(w * 0.985, h * 0.6);
  g.lineTo(w, h * 0.62);
  g.closePath();
  g.fill();

  const dashTop = h * 0.74;
  const dash = g.createLinearGradient(0, dashTop - h * 0.06, 0, h);
  dash.addColorStop(0, '#24212F');
  dash.addColorStop(1, '#0A0910');
  g.fillStyle = dash;
  g.beginPath();
  g.moveTo(0, dashTop + h * 0.02);
  g.quadraticCurveTo(w * 0.25, dashTop - h * 0.015, w * 0.33, dashTop - h * 0.01);
  g.quadraticCurveTo(w * 0.5, dashTop - h * 0.1, w * 0.67, dashTop - h * 0.01);
  g.quadraticCurveTo(w * 0.85, dashTop, w, dashTop + h * 0.03);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(18,181,166,0.35)';
  g.lineWidth = 1;
  g.stroke();

  const mph = Math.round(Math.abs(p.speed));
  const big = Math.max(22, Math.round(h * 0.045));
  g.font = `bold ${big}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = PR.amber;
  g.shadowColor = 'rgba(255,182,39,0.8)';
  g.shadowBlur = 6;
  g.fillText(p.reverse ? `R ${mph}` : String(mph), w * 0.5, dashTop - h * 0.035);
  g.shadowBlur = 0;
  g.font = `bold ${Math.max(10, Math.round(h * 0.018))}px ${FONT_BLACK}`;
  g.fillStyle = PR.muted;
  g.fillText('MPH', w * 0.5, dashTop - h * 0.035 + big * 0.75);

  const r = wheelRadius(w, h);
  const cx = w * 0.5;
  const cy = h + r * 0.38;
  g.save();
  g.translate(cx, cy);
  g.rotate(f.steer * 1.4);
  g.strokeStyle = '#15131F';
  g.lineWidth = r * 0.17;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = r * 0.04;
  g.beginPath();
  g.arc(0, 0, r - r * 0.05, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  g.fillStyle = '#1C1A26';
  for (const a of [Math.PI, 0]) {
    g.save();
    g.rotate(a);
    g.fillRect(r * 0.2, -r * 0.07, r * 0.75, r * 0.14);
    g.restore();
  }
  g.fillStyle = PR.red;
  g.fillRect(-r * 0.04, -r * 1.08, r * 0.08, r * 0.16);
  g.fillStyle = '#211E2C';
  g.beginPath();
  g.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PR.teal;
  g.beginPath();
  g.arc(0, 0, r * 0.09, 0, Math.PI * 2);
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

// During a spin the camera keeps looking roughly where the car travels instead of turning with it,
// then swings back to the car's heading. In normal driving it is locked to the heading.
export function cameraYaw(p: Car, heading: number): number {
  const now = performance.now() / 1000;
  const dt = Math.max(0, Math.min(0.1, now - camClock));
  camClock = now;
  const spinning = p.spinTime > 0 && Math.abs(p.speed) > 2;
  if (spinning) recover = RECOVER_S;
  else recover = Math.max(0, recover - dt);
  if (!spinning && recover === 0) {
    camYaw = heading;
    return camYaw;
  }
  let target = heading;
  if (spinning) {
    const off = wrapAngle(heading - p.moveAngle);
    target = p.moveAngle + Math.max(-SPIN_LOOK, Math.min(SPIN_LOOK, off));
  }
  if (Number.isNaN(camYaw)) camYaw = target;
  camYaw += wrapAngle(target - camYaw) * Math.min(1, dt / CAM_EASE_S);
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
