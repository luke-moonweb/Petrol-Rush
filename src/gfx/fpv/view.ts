import { CONFIG } from '../../config';
import type { Box } from '../../layout';
import type { Car } from '../../race/car';
import { oilRadius } from '../../race/oil';
import type { Race } from '../../race/race';
import { createRng } from '../../sim/rng';
import { CX_L, CX_R, CY, PIT_DRIVE_Y, PIT_X0, PIT_X1, R_IN, R_OUT, WORLD_W, wrapAngle } from '../../track/track';
import { PR } from '../../ui/theme';
import type { Particles } from '../particles';
import { CAR_SCHEMES, driverName } from '../vehicles';
import { trackCanvas } from '../world';
import { drawCarModel } from './cars';
import { type CabinView, cockpitUsed, drawCockpit, prewarmCockpit, reducedMotion, type Streak, wheelRadius } from './cockpit';
import { Camera, clipProject, drawGlowAt, drawPoly, FOG_LEVELS, fillProjected, NEAR, type Poly, visible } from './engine';
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
  touch: boolean;
  skid: 0 | 1 | 2;
  lights?: CabinView['lights'];
  particles?: Particles;
}

const EYE_BACK = -2;
const EYE_SIDE = -3.6;
const EYE_Z = 9.2;
const MIRROR_FAR = 600;
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
const FLOOD_DEPTH = 176;
const FLOOD_SIDE = 140;
const MAX_STREAKS = 3;
const OVERLAY_SAMPLES = 60;

let scene: Scene | null = null;
const cam = new Camera();
const mirrorCam = new Camera();
let camYaw = Number.NaN;
let camClock = 0;
let recovering = false;
let camOff = 0;
let camRace: Race | null = null;
// A longer gap in race time between two cockpit frames means the top-down camera was shown meanwhile.
const CAM_RESET_GAP_S = 0.25;

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
  drawGlowAt(g, c, gl.x, gl.y, gl.z, gl.r, gl.color);
}

function drawCar(g: CanvasRenderingContext2D, c: Camera, car: Car, f: CockpitFrame, dist: number): void {
  drawCarModel(g, c, car.colorIdx, f.ix(car), f.iy(car), f.ih(car), dist, car.braking);
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

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  a: number;
  spark: boolean;
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
  puff?: Puff;
  // Pooled storage behind `puff`.
  puffData: Puff;
}

// Draw list, reused every frame (the mirror reuses it after the main view): no per-frame garbage.
const items: Item[] = [];
const itemPool: Item[] = [];
const walls: Item[] = [];
const NO_ITEMS: never[] = [];
const byDepth = (a: Item, b: Item) => b.d - a.d;

function addItem(d: number): Item {
  let it = itemPool[items.length];
  if (!it) {
    it = { d, puffData: { x: 0, y: 0, z: 0, r: 0, a: 0, spark: false } };
    itemPool.push(it);
  }
  it.d = d;
  it.poly = undefined;
  it.car = undefined;
  it.glow = undefined;
  it.sign = undefined;
  it.bill = undefined;
  it.puff = undefined;
  items.push(it);
  return it;
}

// Centroid depth alone misplaces a car next to a wall piece. For walls close to a car, the side of the
// wall plane the car is on (compared with the camera) decides which of the two must be drawn first.
function orderCarsAgainstWalls(c: Camera, items: Item[]): void {
  walls.length = 0;
  for (const it of items) if (it.poly?.plane) walls.push(it);
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

function drawPuff(g: CanvasRenderingContext2D, c: Camera, p: Puff): void {
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
  const scene = prewarmScene();
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

  items.length = 0;
  for (const p of scene.solids) {
    if (visible(p, c) < 0) continue;
    addItem(c.depth(p.cx, p.cy)).poly = p;
  }
  for (const q of cheap ? NO_ITEMS : scene.signs) {
    const dist = c.dist(q.cx, q.cy);
    if (dist - q.radius > q.far || !c.inView(q.cx, q.cy, q.radius)) continue;
    const it = addItem(c.depth(q.cx, q.cy) - 0.3);
    it.sign = q;
    it.dist = dist;
  }
  for (const b of cheap ? NO_ITEMS : scene.billboards) {
    const dist = c.dist(b.x, b.y);
    if (dist > c.far || c.depth(b.x, b.y) < NEAR * 2 || !c.inView(b.x, b.y, b.w)) continue;
    const it = addItem(c.depth(b.x, b.y));
    it.bill = b;
    it.dist = dist;
  }
  for (const gl of scene.glows) {
    const d = c.depth(gl.x, gl.y);
    if (d > NEAR * 2 && d < c.far && c.inView(gl.x, gl.y, gl.r)) addItem(d - 0.5).glow = gl;
  }
  const player = f.race.player;
  for (const car of f.race.cars) {
    if (car === player) continue;
    const x = f.ix(car);
    const y = f.iy(car);
    const dist = c.dist(x, y);
    if (dist > c.far || !c.inView(x, y, CAR_REACH)) continue;
    const it = addItem(c.depth(x, y));
    it.car = car;
    it.x = x;
    it.y = y;
    it.dist = dist;
  }
  if (!cheap && f.particles) {
    puffCam = c;
    f.particles.forEachLive(addPuff);
  }
  orderCarsAgainstWalls(c, items);
  items.sort(byDepth);
  let carMs = 0;
  for (const it of items) {
    if (it.poly) {
      const dist = c.dist(it.poly.cx, it.poly.cy);
      drawPoly(g, c, it.poly, dist);
      if (!cheap) for (const q of it.poly.decals ?? []) if (dist - q.radius < q.far) drawTexQuad(g, c, q, c.dist(q.cx, q.cy));
    } else if (it.car) {
      const t0 = performance.now();
      drawCar(g, c, it.car, f, it.dist!);
      carMs += performance.now() - t0;
    } else if (it.glow) drawGlow(g, c, it.glow);
    else if (it.sign) drawTexQuad(g, c, it.sign, it.dist!);
    else if (it.bill) drawBillboard(g, c, it.bill, Math.max(0.15, 1 - c.fogLevel(it.dist!) / FOG_LEVELS));
    else if (it.puff) drawPuff(g, c, it.puff);
  }
  if (!cheap) sample(carsMs, carMs);
}

let puffCam: Camera = cam;
function addPuff(spark: boolean, x: number, y: number, t: number, size: number): void {
  const c = puffCam;
  const d = c.dist(x, y);
  if (d > 500 || (!spark && d < OWN_SMOKE) || !c.inView(x, y, 10)) return;
  const it = addItem(c.depth(x, y) - 0.2);
  const p = it.puffData;
  p.x = x;
  p.y = y;
  p.spark = spark;
  if (spark) {
    p.z = 2 + (1 - t) * 3;
    p.r = size * 0.5;
    p.a = 1 - t;
  } else {
    p.z = 4 + t * 8;
    p.r = size * (1 + t * 2.2);
    p.a = 0.45 * (1 - t);
  }
  it.puff = p;
}

const MAP_H = CY + R_OUT + 12;
const POOL_RINGS = [1, 0.6];

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

function drawMinimap(g: CanvasRenderingContext2D, w: number, h: number, wheelR: number, f: CockpitFrame, camYawNow: number): void {
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
  // The wedge shows where the camera looks (it differs from the heading during a spin), the arrow the car.
  const look = mapAngle(camYawNow);
  const ang = mapAngle(f.ih(p));
  g.fillStyle = 'rgba(127,227,217,0.25)';
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, mh * 0.6, look - 0.5, look + 0.5);
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

// Forgets a leftover spin swing: on a new race, a restart, or when the cockpit was not drawn last frame.
export function syncCameraYaw(race: Race, time: number): void {
  if (race === camRace && time >= camClock && time - camClock <= CAM_RESET_GAP_S) return;
  camRace = race;
  camClock = time;
  camYaw = Number.NaN;
  recovering = false;
  camOff = 0;
}

// Direction the cockpit camera looks in for this race, or NaN when the cockpit has not drawn it.
// During a spin it differs from the car heading, so the sound uses it to pan rivals.
export function cockpitCameraYaw(race: Race): number {
  return race === camRace ? camYaw : Number.NaN;
}

// During a spin the camera keeps looking roughly where the car travels instead of turning with it.
// Afterwards it follows the car's heading and only its leftover offset fades out, so turning into the
// rest of a corner does not leave it trailing. In normal driving it is locked to the heading.
export function cameraYaw(p: Car, heading: number, time: number): number {
  const dt = Math.max(0, Math.min(0.1, time - camClock));
  camClock = time;
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

const streaks: Streak[] = [];
const streakPool: Streak[] = Array.from({ length: MAX_STREAKS }, () => ({ x: 0, k: 0 }));

// The strongest floodlight masts just ahead, strongest first. The returned list is reused every frame.
export function floodStreaks(c: Camera, glows: Glow[]): Streak[] {
  streaks.length = 0;
  for (const gl of glows) {
    if (!gl.flood) continue;
    const dx = gl.x - c.x;
    const dy = gl.y - c.y;
    const d = dx * c.cos + dy * c.sin;
    const lat = -dx * c.sin + dy * c.cos;
    if (d <= 0 || d >= FLOOD_DEPTH || Math.abs(lat) >= FLOOD_SIDE) continue;
    const t = 1 - d / FLOOD_DEPTH;
    const k = t * t * (3 - 2 * t);
    // Insert into the sorted top list, dropping the weakest when it is full.
    let i = streaks.length;
    if (i === MAX_STREAKS) {
      if (k <= streaks[i - 1]!.k) continue;
      i--;
    } else streaks.push(streakPool[i]!);
    const slot = streaks[i]!;
    while (i > 0 && streaks[i - 1]!.k < k) {
      streaks[i] = streaks[i - 1]!;
      i--;
    }
    streaks[i] = slot;
    slot.x = c.ox + (c.focal * lat) / d;
    slot.k = k;
  }
  return streaks;
}

const cabinMs: number[] = [];
const mirrorMs: number[] = [];
const carsMs: number[] = [];
const sortScratch: number[] = [];

function sample(list: number[], ms: number): void {
  list.push(ms);
  if (list.length > OVERLAY_SAMPLES) list.shift();
}

function median(list: number[]): number {
  sortScratch.length = 0;
  for (const v of list) sortScratch.push(v);
  sortScratch.sort((a, b) => a - b);
  return sortScratch[Math.floor(sortScratch.length / 2)] ?? 0;
}

export function cockpitOverlayMs(): { cabin: number; mirror: number; cars: number } {
  return { cabin: median(cabinMs), mirror: median(mirrorMs), cars: median(carsMs) };
}

// The 3D scene takes a few hundred ms to build; the race state calls this during the start lights.
export function prewarmScene(): Scene {
  if (!scene) {
    trackCanvas();
    scene = buildScene();
  }
  return scene;
}

// Builds the cockpit layers on idle once the cockpit has been used this session.
export function prewarmCockpitView(g: CanvasRenderingContext2D, view: Box, colorIdx: number, touch: boolean): void {
  if (cockpitUsed()) prewarmCockpit(g, view.w, view.h, colorIdx, touch);
}

const pylonTop = [-1, -1, -1, -1];

// The pylon texture shows the first four; rebuild its names only when they change.
function updatePylon(standings: Car[]): void {
  let same = true;
  for (let i = 0; i < 4; i++) if (pylonTop[i] !== (standings[i]?.colorIdx ?? -1)) same = false;
  if (same) return;
  for (let i = 0; i < 4; i++) pylonTop[i] = standings[i]?.colorIdx ?? -1;
  setPylonNames(standings.slice(0, 4).map((car) => driverName(car.colorIdx).slice(0, 3)));
}

const cabinIn: CabinView = { race: null as unknown as Race, steer: 0, time: 0, touch: false, skid: 0, standings: [], streaks: [] };

export function drawCockpitView(g: CanvasRenderingContext2D, f: CockpitFrame): void {
  if (stars.length === 0) initSky();
  const standings = f.race.standings();
  updatePylon(standings);
  const v = f.view;
  const p = f.race.player;
  const heading = f.ih(p);
  syncCameraYaw(f.race, f.time);
  const yaw = cameraYaw(p, heading, f.time);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const ex = f.ix(p) + EYE_BACK * c - EYE_SIDE * s;
  const ey = f.iy(p) + EYE_BACK * s + EYE_SIDE * c;
  const speed = Math.abs(p.speed);
  const shake = speed > 5 && !reducedMotion() ? Math.sin(f.time * 41) * 0.12 * (speed / 180) : 0;

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
  const t0 = performance.now();
  cabinIn.race = f.race;
  cabinIn.steer = f.steer;
  cabinIn.time = f.time;
  cabinIn.touch = f.touch;
  cabinIn.skid = f.skid;
  cabinIn.lights = f.lights;
  cabinIn.standings = standings;
  cabinIn.streaks = floodStreaks(cam, scene!.glows);
  const jolt = drawCockpit(g, v.w, v.h, cabinIn);
  const t1 = performance.now();
  g.translate(jolt.x, jolt.y);
  drawMirror(g, v.w, v.h, f, ex, ey, yaw);
  drawMinimap(g, v.w, v.h, wheelRadius(v.w), f, yaw);
  sample(cabinMs, t1 - t0);
  sample(mirrorMs, performance.now() - t1);
  g.restore();
}
