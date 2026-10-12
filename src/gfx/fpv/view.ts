import type { Box } from '../../layout';
import type { Car } from '../../race/car';
import { oilRadius } from '../../race/oil';
import type { Race } from '../../race/race';
import { createRng } from '../../sim/rng';
import { wrapAngle } from '../../track/track';
import { FONT_BLACK, PR } from '../../ui/theme';
import { shade } from '../sprites';
import { carFaces, MODEL_SCALE } from '../vehicles';
import { Camera, clipProject, drawPoly, fillProjected, NEAR, visible } from './engine';
import { buildScene, type Glow, type Scene } from './scene';

export interface CockpitFrame {
  race: Race;
  view: Box;
  ix: (c: Car) => number;
  iy: (c: Car) => number;
  ih: (c: Car) => number;
  steer: number;
  time: number;
}

const EYE_BACK = -2;
const EYE_SIDE = -3.6;
const EYE_Z = 9.2;
const CAR_FAR = 900;
const MIRROR_FAR = 600;
const LIGHT: [number, number, number] = [0.27, -0.37, 0.89];
const SKY_TOP = '#05040C';
const SKY_HORIZON = '#221C3C';
const GROUND = '#0B0A16';

let scene: Scene | null = null;
const cam = new Camera();
const mirrorCam = new Camera();

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
function lit(color: string, k: number): string {
  const key = `${color}|${Math.round(k * 20)}`;
  let s = shadeCache.get(key);
  if (!s) {
    s = shade(color, Math.round(k * 20) / 20);
    shadeCache.set(key, s);
  }
  return s;
}

const wx = new Float32Array(64);
const wy = new Float32Array(64);
const wz = new Float32Array(64);

function screenX(c: Camera, rel: number): number {
  return c.ox + c.flip * c.focal * Math.tan(rel);
}

function drawSky(g: CanvasRenderingContext2D, c: Camera, x0: number, w: number, top: number, yaw: number): void {
  const sky = g.createLinearGradient(0, top, 0, c.oy);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  g.fillStyle = sky;
  g.fillRect(x0, top, w, c.oy - top);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (const st of stars) {
    const rel = wrapAngle(st.a - yaw);
    if (Math.abs(rel) > 1.3) continue;
    g.fillRect(screenX(c, rel), c.oy - c.focal * Math.tan(st.e), st.size, st.size);
  }
  for (const t of skyline) {
    const r0 = wrapAngle(t.a0 - yaw);
    const r1 = r0 + (t.a1 - t.a0);
    if (r1 < -1.3 || r0 > 1.3) continue;
    const xa = screenX(c, Math.max(-1.3, r0));
    const xb = screenX(c, Math.min(1.3, r1));
    const y = c.oy - c.focal * Math.tan(t.e);
    g.fillStyle = '#100E1E';
    g.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), c.oy - y + 1);
    if (t.lit > 0.55) {
      g.fillStyle = 'rgba(255,200,110,0.35)';
      g.fillRect(Math.min(xa, xb) + 2, y + 3, 2, 2);
    }
  }
  g.fillStyle = GROUND;
  g.fillRect(x0, c.oy, w, 10_000);
}

function addGlow(list: Glow[], x: number, y: number, z: number, r: number, color: string): void {
  list.push({ x, y, z, r, color });
}

function drawGlows(g: CanvasRenderingContext2D, c: Camera, glows: Glow[]): void {
  g.globalCompositeOperation = 'lighter';
  for (const gl of glows) {
    const dx = gl.x - c.x;
    const dy = gl.y - c.y;
    const z = dx * c.cos + dy * c.sin;
    if (z < NEAR * 2 || z > c.far) continue;
    const x = -dx * c.sin + dy * c.cos;
    const sx = c.ox + (c.flip * c.focal * x) / z;
    const sy = c.oy - (c.focal * (gl.z - c.z)) / z;
    const r = (c.focal * gl.r) / z;
    if (r < 0.8) continue;
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0, `rgba(${gl.color},0.75)`);
    gr.addColorStop(0.35, `rgba(${gl.color},0.22)`);
    gr.addColorStop(1, `rgba(${gl.color},0)`);
    g.fillStyle = gr;
    g.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-over';
}

function drawCar(g: CanvasRenderingContext2D, c: Camera, car: Car, f: CockpitFrame, dist: number, glows: Glow[]): void {
  const h = f.ih(car);
  const ox = f.ix(car);
  const oy = f.iy(car);
  const cs = Math.cos(h);
  const sn = Math.sin(h);
  const K = MODEL_SCALE;
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
  const fade = dist > c.fogNear ? Math.max(0.25, 1 - (dist - c.fogNear) / (c.far - c.fogNear)) : 1;
  g.globalAlpha = fade;
  for (const { face, light } of faces) {
    const k = face.flat ? -0.15 : -0.45 + 0.45 * light;
    fillProjected(g, clipProject(c, wx, wy, wz, toWorld(face.pts)), lit(face.color, k));
    if (dist > 260) continue;
    for (const d of face.decals ?? []) {
      fillProjected(g, clipProject(c, wx, wy, wz, toWorld(d.pts)), lit(d.color, d.flat ? -0.15 : -0.45 + 0.45 * light));
    }
  }
  g.globalAlpha = 1;
  const toCam = (lx: number) => (lx * cs * (c.x - ox) + lx * sn * (c.y - oy) > 0 ? 1 : 0);
  const lamp = (lx: number, ly0: number, ly1: number, z0: number, z1: number, color: string) => {
    const quad: number[][] = [
      [lx, ly0, z0],
      [lx, ly1, z0],
      [lx, ly1, z1],
      [lx, ly0, z1],
    ];
    fillProjected(g, clipProject(c, wx, wy, wz, toWorld(quad)), color);
  };
  if (toCam(-1)) {
    const tail = car.braking ? '#FF5A46' : '#B81E18';
    for (const side of [-1, 1]) {
      lamp(-2.02, side * 0.42, side * 0.78, 0.44, 0.58, tail);
      const gx = ox + (-2.1 * cs - side * 0.6 * sn) * K;
      const gy = oy + (-2.1 * sn + side * 0.6 * cs) * K;
      addGlow(glows, gx, gy, 5, car.braking ? 7 : 4.5, '255,60,40');
    }
  }
  if (toCam(1)) {
    for (const side of [-1, 1]) {
      lamp(2.02, side * 0.4, side * 0.75, 0.4, 0.52, '#FFF6DA');
      const gx = ox + (2.1 * cs - side * 0.57 * sn) * K;
      const gy = oy + (2.1 * sn + side * 0.57 * cs) * K;
      addGlow(glows, gx, gy, 4.6, 8, '255,244,210');
    }
  }
}

function drawOilSlicks(g: CanvasRenderingContext2D, c: Camera, race: Race, far: number): void {
  for (const o of race.oil) {
    const d = c.dist(o.x, o.y);
    if (d > far || c.depth(o.x, o.y) < -20) continue;
    const r = oilRadius(o);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      wx[i] = o.x + Math.cos(a) * r;
      wy[i] = o.y + Math.sin(a) * r * 0.8;
      wz[i] = 0.05;
    }
    fillProjected(g, clipProject(c, wx, wy, wz, 12), 'rgba(4,3,8,0.85)');
  }
}

type Item = { d: number; poly?: import('./engine').Poly; car?: Car; dist?: number };

function renderWorld(g: CanvasRenderingContext2D, c: Camera, f: CockpitFrame, cheap: boolean): void {
  scene ??= buildScene();
  for (const p of scene.ground) {
    const d = visible(p, c);
    if (d >= 0) drawPoly(g, c, p, d);
  }
  const decalFar = cheap ? 260 : 650;
  for (const p of scene.decals) {
    const d = visible(p, c);
    if (d >= 0 && d < decalFar) drawPoly(g, c, p, d);
  }
  drawOilSlicks(g, c, f.race, cheap ? 300 : 700);
  for (const p of scene.island) {
    const d = visible(p, c);
    if (d >= 0) drawPoly(g, c, p, d);
  }
  const items: Item[] = [];
  for (const p of scene.solids) {
    if (visible(p, c) < 0) continue;
    items.push({ d: c.depth(p.cx, p.cy), poly: p });
  }
  const player = f.race.player;
  const carFar = Math.min(c.far, CAR_FAR);
  for (const car of f.race.cars) {
    if (car === player) continue;
    const x = f.ix(car);
    const y = f.iy(car);
    const dist = c.dist(x, y);
    const depth = c.depth(x, y);
    if (dist > carFar || depth < -25) continue;
    items.push({ d: depth, car, dist });
  }
  items.sort((a, b) => b.d - a.d);
  const glows: Glow[] = [...scene.glows];
  for (const it of items) {
    if (it.poly) drawPoly(g, c, it.poly, c.dist(it.poly.cx, it.poly.cy));
    else if (it.car) drawCar(g, c, it.car, f, it.dist!, glows);
  }
  drawGlows(g, c, glows);
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
  g.font = `bold ${Math.round(h * 0.045)}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = PR.amber;
  g.shadowColor = 'rgba(255,182,39,0.8)';
  g.shadowBlur = 6;
  g.fillText(p.reverse ? `R ${mph}` : String(mph), w * 0.5, dashTop - h * 0.035);
  g.shadowBlur = 0;
  g.font = `bold ${Math.round(h * 0.018)}px ${FONT_BLACK}`;
  g.fillStyle = PR.muted;
  g.fillText('MPH', w * 0.5, dashTop - h * 0.0);

  const r = Math.min(w * 0.19, h * 0.3);
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
  const mw = Math.round(Math.min(230, w * 0.34));
  const mh = Math.round(mw * 0.25);
  const mx = Math.round(w * 0.56 - mw / 2);
  const my = Math.round(h * 0.03);
  g.fillStyle = '#0B0A12';
  g.fillRect(mx + mw / 2 - 3, 0, 6, my + 2);
  g.save();
  g.beginPath();
  g.roundRect(mx, my, mw, mh, mh * 0.35);
  g.clip();
  mirrorCam.set(ex, ey, EYE_Z + 1, yaw + Math.PI);
  mirrorCam.focal = mh * 1.25;
  mirrorCam.ox = mx + mw / 2;
  mirrorCam.oy = my + mh * 0.5;
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

export function drawCockpitView(g: CanvasRenderingContext2D, f: CockpitFrame): void {
  if (stars.length === 0) initSky();
  const v = f.view;
  const p = f.race.player;
  const yaw = f.ih(p);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
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
  cam.focal = v.h * 0.85;
  cam.ox = v.w / 2;
  cam.oy = Math.round(v.h * 0.47);
  cam.flip = 1;
  cam.far = 1300;
  cam.fogNear = 260;
  drawSky(g, cam, 0, v.w, 0, yaw);
  renderWorld(g, cam, f, false);
  drawCockpit(g, v.w, v.h, f);
  drawMirror(g, v.w, v.h, f, ex, ey, yaw);
  g.restore();
}
