import type { Box } from '../../layout';
import type { Car } from '../../race/car';
import type { Race } from '../../race/race';
import { NO_WARN, type Warn } from '../../race/warnings';
import type { Track } from '../../track/common';
import type { Particles } from '../particles';
import { driverName } from '../vehicles';
import { drawCarModel, setCarPixelScale } from './cars';
import { type CabinView, cockpitUsed, drawCockpit, prewarmCockpit, reducedMotion, wheelRadius } from './cockpit';
import { addItem, byDepth, CAR_REACH, type Item, items, NO_ITEMS, orderCarsAgainstCars, orderCarsAgainstWalls } from './drawList';
import { Camera, drawPoly, FOG_LEVELS, facesCamera, NEAR, visible } from './engine';
import { drawMinimap } from './minimap';
import { setPylonNames } from './oval';
import { type Scene, sceneFor } from './scene';
import { drawSky } from './sky';
import { drawPuff } from './smoke';
import { floodStreaks } from './streaks';
import { drawGlow, drawOilSlicks, drawPools } from './surface';
import { drawBillboard, drawTexQuad } from './texture';
import { cabinMs, carsMs, mirrorMs, sample, worldMs } from './timing';

export interface CockpitFrame {
  race: Race;
  view: Box;
  ix: (c: Car) => number;
  iy: (c: Car) => number;
  ih: (c: Car) => number;
  steer: number;
  time: number;
  touch: boolean;
  warn: Warn;
  arcFrom: number;
  lights?: CabinView['lights'];
  particles?: Particles;
  // Device px per canvas unit (DPR × layout scale); the car level of detail counts device px.
  pixelScale?: number;
}

const EYE_BACK = -2;
const EYE_SIDE = -3.6;
export const EYE_Z = 9.2;
// Mirror eye height above the driver's eye.
export const MIRROR_RISE = 1;
// Largest vertical speed shake of the cockpit camera (world units).
export const SHAKE_AMP = 0.12;
const MIRROR_FAR = 600;
const OWN_SMOKE = 15;

const cam = new Camera();
const mirrorCam = new Camera();
// One fog colour for both cameras, so the car style cache is shared.
mirrorCam.fog = cam.fog;
// Last LOD tier of each rival car (by colorIdx), per camera, for the LOD hysteresis.
const lodMain = new Int8Array(64);
const lodMirror = new Int8Array(64);
// Time spent drawing rival cars, and the whole world pass, this frame (main view and mirror together).
let carMs = 0;
let worldTime = 0;

function drawCar(g: CanvasRenderingContext2D, c: Camera, it: Item): void {
  const car = it.car!;
  drawCarModel(g, c, car.colorIdx, it.x!, it.y!, it.h!, it.dist!, car.braking, c === mirrorCam ? lodMirror : lodMain);
}

function renderWorld(g: CanvasRenderingContext2D, c: Camera, f: CockpitFrame, cheap: boolean): void {
  const t0 = performance.now();
  drawWorld(g, c, f, cheap);
  worldTime += performance.now() - t0;
}

function drawWorld(g: CanvasRenderingContext2D, c: Camera, f: CockpitFrame, cheap: boolean): void {
  const scene = prewarmScene(f.race.track);
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
    if ((p.closed && !facesCamera(p, c)) || visible(p, c) < 0) continue;
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
    it.h = f.ih(car);
    it.x = x;
    it.y = y;
    it.dist = dist;
  }
  if (!cheap && f.particles) {
    puffCam = c;
    f.particles.forEachLive(addPuff);
  }
  orderCarsAgainstWalls(c, items);
  orderCarsAgainstCars(c, items);
  items.sort(byDepth);
  for (const it of items) {
    if (it.poly) {
      const dist = c.dist(it.poly.cx, it.poly.cy);
      drawPoly(g, c, it.poly, dist);
      if (!cheap) for (const q of it.poly.decals ?? NO_ITEMS) if (dist - q.radius < q.far) drawTexQuad(g, c, q, c.dist(q.cx, q.cy));
    } else if (it.car) {
      const t0 = performance.now();
      drawCar(g, c, it);
      carMs += performance.now() - t0;
    } else if (it.glow) drawGlow(g, c, it.glow);
    else if (it.sign) drawTexQuad(g, c, it.sign, it.dist!);
    else if (it.bill) drawBillboard(g, c, it.bill, Math.max(0.15, 1 - c.fogLevel(it.dist!) / FOG_LEVELS));
    else if (it.puff) drawPuff(g, c, it.puff);
  }
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
  mirrorCam.set(ex, ey, EYE_Z + MIRROR_RISE, yaw + Math.PI);
  mirrorCam.focal = mh * 2;
  mirrorCam.ox = mx + mw / 2;
  mirrorCam.oy = my + mh * 0.5;
  mirrorCam.halfW = mw / 2;
  mirrorCam.flip = -1;
  mirrorCam.far = MIRROR_FAR;
  mirrorCam.fogNear = 180;
  g.fillStyle = prewarmScene(f.race.track).sky.horizon;
  g.fillRect(mx, my, mw, mirrorCam.oy - my);
  g.fillStyle = prewarmScene(f.race.track).sky.ground;
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

// The 3D scene takes a few hundred ms to build; the race state calls this during the start lights.
export function prewarmScene(track: Track): Scene {
  return sceneFor(track);
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

const cabinIn: CabinView = {
  race: null as unknown as Race,
  steer: 0,
  time: 0,
  touch: false,
  warn: NO_WARN,
  arcFrom: NO_WARN.vRef,
  standings: [],
  streaks: [],
};

export function drawCockpitView(g: CanvasRenderingContext2D, f: CockpitFrame): void {
  const standings = f.race.standings();
  updatePylon(standings);
  const v = f.view;
  const p = f.race.player;
  const heading = f.ih(p);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const ex = f.ix(p) + EYE_BACK * c - EYE_SIDE * s;
  const ey = f.iy(p) + EYE_BACK * s + EYE_SIDE * c;
  const speed = Math.abs(p.speed);
  const shake = speed > 5 && !reducedMotion() ? Math.sin(f.time * 41) * SHAKE_AMP * (speed / 180) : 0;

  g.save();
  g.translate(v.x, v.y);
  g.beginPath();
  g.rect(0, 0, v.w, v.h);
  g.clip();
  cam.set(ex, ey, EYE_Z + shake, heading);
  // The car LOD counts device pixels (DPR and layout scale included).
  setCarPixelScale(f.pixelScale ?? 1);
  carMs = 0;
  worldTime = 0;
  cam.focal = Math.max(v.h * 0.62, Math.min(v.h * 0.9, v.w * 0.55)) * (1 - 0.08 * Math.min(1, speed / 180));
  cam.ox = v.w / 2;
  cam.oy = Math.round(v.h * 0.42);
  cam.halfW = v.w / 2;
  cam.flip = 1;
  cam.far = 1300;
  cam.fogNear = 260;
  const scene = prewarmScene(f.race.track);
  drawSky(g, cam, v.w, heading, scene.sky);
  renderWorld(g, cam, f, false);
  const t0 = performance.now();
  cabinIn.race = f.race;
  cabinIn.steer = f.steer;
  cabinIn.time = f.time;
  cabinIn.touch = f.touch;
  cabinIn.warn = f.warn;
  cabinIn.arcFrom = f.arcFrom;
  cabinIn.lights = f.lights;
  cabinIn.standings = standings;
  cabinIn.streaks = floodStreaks(cam, scene.glows);
  const jolt = drawCockpit(g, v.w, v.h, cabinIn);
  const t1 = performance.now();
  g.translate(jolt.x, jolt.y);
  drawMirror(g, v.w, v.h, f, ex, ey, heading);
  drawMinimap(g, v.w, v.h, wheelRadius(v.w), f, scene);
  sample(cabinMs, t1 - t0);
  sample(mirrorMs, performance.now() - t1);
  sample(carsMs, carMs);
  sample(worldMs, worldTime);
  g.restore();
}
