// Draws rival cars in the cockpit view from the closed cockpit model (carFpv.ts).
// Painter's order inside a car is decided per piece with planes that separate the pieces, so the faces of
// one convex piece never overlap and no per-face sort is needed. Nothing here allocates per frame.
import {
  BODY_W,
  CABIN_SLOPE,
  CABIN_X0,
  CABIN_Z0,
  carFacesFpv,
  carLod,
  FPV_PALETTE,
  type FpvFace,
  type FpvModel,
  type FpvPiece,
  TYRE_OUT,
  WING_HW,
  WING_SPLIT_X,
} from '../carFpv';
import { LIGHT } from '../model3d';
import { MODEL_SCALE } from '../vehicles';
import { type Camera, clipProject, drawGlowAt, FOG_LEVELS, fillProjected, fogged, hexRgb, type RGB } from './engine';

const K = MODEL_SCALE;
const KQ = 20;
const KQ_MIN = -12;
const KQ_SLOTS = 25;
const OUTLINE_KQ = -12;
// Cars keep the sprite brightness with a slight blue night cast, so they stay brighter than the walls.
const TINT: RGB = [0.85, 0.85, 0.95];
const SHADOW_ALPHA = 0.42;
const BODY_LEN = 4 * K;
// Footprint half sizes (model units) covering everything a car draws on the ground or above it: body,
// lamps, tyres and the contact shadow. Ordering cars against each other uses the same box.
const FOOT_L = 2.08;
const FOOT_W = Math.max(TYRE_OUT, 0.9);
const FOOT_HL = FOOT_L * K;
const FOOT_HW = FOOT_W * K;

// One style cache per fog colour (main view and mirror may use different fog arrays).
const styleCaches = new Map<RGB, string[]>();
const shadowStyles: string[] = [];

function style(cid: number, kq: number, level: number, fog: RGB): string {
  let styles = styleCaches.get(fog);
  if (!styles) {
    styles = [];
    styleCaches.set(fog, styles);
  }
  const key = (cid * KQ_SLOTS + kq - KQ_MIN) * FOG_LEVELS + level;
  let s = styles[key];
  if (s === undefined) {
    const amt = kq / KQ;
    const c = hexRgb(FPV_PALETTE[cid]!);
    const lit = (v: number, t: number) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)) * t;
    s = fogged([lit(c[0], TINT[0]), lit(c[1], TINT[1]), lit(c[2], TINT[2])], fog, level);
    styles[key] = s;
  }
  return s;
}

// Contact shadow: the footprint with chamfered corners.
const SHADOW = new Float32Array([
  FOOT_L,
  -0.75,
  1.9,
  -FOOT_W,
  -1.9,
  -FOOT_W,
  -FOOT_L,
  -0.75,
  -FOOT_L,
  0.75,
  -1.9,
  FOOT_W,
  1.9,
  FOOT_W,
  FOOT_L,
  0.75,
]);
const TAIL = [-1, 1].map(
  (s) => new Float32Array([-2.01, s * 0.42, 0.44, -2.01, s * 0.78, 0.44, -2.01, s * 0.78, 0.58, -2.01, s * 0.42, 0.58]),
);
const HEAD = [-1, 1].map((s) => new Float32Array([2.01, s * 0.4, 0.4, 2.01, s * 0.75, 0.4, 2.01, s * 0.75, 0.52, 2.01, s * 0.4, 0.52]));

const wx = new Float32Array(32);
const wy = new Float32Array(32);
const wz = new Float32Array(32);

// Per-car state, set by drawCarBody.
let cam: Camera;
let ox = 0;
let oy = 0;
let cs = 1;
let sn = 0;
let level = 0;
let tier: 0 | 1 | 2 = 0;
// Eye and light in the car's model space.
let ex = 0;
let ey = 0;
let ez = 0;
let lx = 0;
let ly = 0;
let lz = 0;
// Device px per canvas unit (DPR × layout scale); the LOD works on device px.
let pixelScale = 1;

export function setCarPixelScale(s: number): void {
  pixelScale = s > 0 ? s : 1;
}

function project(xyz: Float32Array): number {
  const n = xyz.length / 3;
  for (let i = 0; i < n; i++) {
    const px = xyz[i * 3]!;
    const py = xyz[i * 3 + 1]!;
    wx[i] = ox + (px * cs - py * sn) * K;
    wy[i] = oy + (px * sn + py * cs) * K;
    wz[i] = xyz[i * 3 + 2]! * K;
  }
  return clipProject(cam, wx, wy, wz, n);
}

function drawFace(g: CanvasRenderingContext2D, f: FpvFace, kq: number, outline: boolean): void {
  const m = project(f.xyz);
  if (m >= 3) {
    fillProjected(g, m, style(f.cid, kq, level, cam.fog));
    if (outline && f.outline) {
      g.strokeStyle = style(f.cid, OUTLINE_KQ, level, cam.fog);
      g.stroke();
    }
  }
  for (const d of f.decals) {
    if (tier === 2 ? d.broad : tier === 0 || !d.detail) drawFace(g, d, d.flat ? 0 : kq, false);
  }
}

function drawPiece(g: CanvasRenderingContext2D, p: FpvPiece): void {
  for (const f of p.faces) {
    if (f.hidden) continue;
    const n = f.normal;
    if (n[0] * ex + n[1] * ey + n[2] * ez <= f.d) continue;
    const kq = f.flat ? 0 : Math.round((-0.3 + 0.42 * Math.max(0, n[0] * lx + n[1] * ly + n[2] * lz)) * KQ);
    drawFace(g, f, kq, true);
  }
}

// Painter's order of a car's pieces for an eye at (x, y, z) in model space. Fills `out`, returns the count.
// - Tyres and floor lie partly inside the body: they go first and the body covers what it hides. The far
//   side, the floor, then the near side; on each side the far axle first.
// - The outer tyre slices lie outside the body; a slice whose side the eye is on goes after the body.
// - The deck plane under the greenhouse separates body and greenhouse; x = WING_SPLIT_X separates greenhouse
//   and spoiler; the spoiler stands on the body (plane z = PLATE_Z0), below every eye.
// - Tiny cars (tier 2) draw a dark skirt instead of tyres and floor.
let outArr: FpvPiece[] = [];
let on = 0;
function put(p: FpvPiece): void {
  outArr[on++] = p;
}

function putSpoiler(m: FpvModel, y: number): void {
  // An end plate is separated from the wing by the plane y = ±WING_HW: the one on the eye's side goes last.
  if (-y <= WING_HW) put(m.plates[0]!);
  if (y <= WING_HW) put(m.plates[1]!);
  put(m.wing);
  if (-y > WING_HW) put(m.plates[0]!);
  if (y > WING_HW) put(m.plates[1]!);
}

export function pieceOrder(m: FpvModel, x: number, y: number, z: number, lod: 0 | 1 | 2, out: FpvPiece[]): number {
  outArr = out;
  on = 0;
  const near = y >= 0 ? 2 : 0;
  const far = 2 - near;
  const back = x >= 0 ? 0 : 1;
  const nearOutside = (near === 0 ? -y : y) > BODY_W;
  if (lod < 2) {
    put(m.wheels[far + back]!);
    put(m.wheels[far + 1 - back]!);
    if (!nearOutside) {
      put(m.wheels[near + back]!);
      put(m.wheels[near + 1 - back]!);
    }
    put(m.tyres[far + back]!);
    put(m.tyres[far + 1 - back]!);
    put(m.floor);
    put(m.tyres[near + back]!);
    put(m.tyres[near + 1 - back]!);
  } else put(m.skirt);
  const behindWing = x < WING_SPLIT_X;
  const aboveDeck = z >= CABIN_Z0 + CABIN_SLOPE * (CABIN_X0 - x);
  if (!aboveDeck) put(m.cabin);
  put(m.body);
  if (lod < 2 && nearOutside) {
    put(m.wheels[near + back]!);
    put(m.wheels[near + 1 - back]!);
  }
  if (!aboveDeck) putSpoiler(m, y);
  else if (behindWing) {
    put(m.cabin);
    putSpoiler(m, y);
  } else {
    putSpoiler(m, y);
    put(m.cabin);
  }
  return on;
}

const order: FpvPiece[] = [];

function fillModelQuad(g: CanvasRenderingContext2D, xyz: Float32Array, color: string): void {
  fillProjected(g, project(xyz), color);
}

// Length of a car on screen in device px at a distance, for the level of detail.
export function carLengthPx(c: Camera, dist: number): number {
  return (c.focal * BODY_LEN * pixelScale) / Math.max(1, dist);
}

// Shadow and pieces of a car, without its lamps (the hole check in the car lab draws only these).
// `lod` remembers each car's last tier (index colorIdx, value tier + 1) for the hysteresis.
export function drawCarBody(
  g: CanvasRenderingContext2D,
  c: Camera,
  colorIdx: number,
  x: number,
  y: number,
  heading: number,
  dist: number,
  shadow = true,
  lod?: Int8Array,
): void {
  const m = carFacesFpv(colorIdx);
  cam = c;
  ox = x;
  oy = y;
  cs = Math.cos(heading);
  sn = Math.sin(heading);
  level = c.fogLevel(dist);
  const px = carLengthPx(c, dist);
  tier = carLod(px, lod ? ((lod[colorIdx]! - 1) as -1 | 0 | 1 | 2) : -1);
  if (lod) lod[colorIdx] = tier + 1;
  const dx = c.x - x;
  const dy = c.y - y;
  ex = (dx * cs + dy * sn) / K;
  ey = (-dx * sn + dy * cs) / K;
  ez = c.z / K;
  lx = LIGHT[0] * cs + LIGHT[1] * sn;
  ly = -LIGHT[0] * sn + LIGHT[1] * cs;
  lz = LIGHT[2];

  if (shadow) {
    let sh = shadowStyles[level];
    if (!sh) {
      sh = `rgba(0,0,0,${(SHADOW_ALPHA * (1 - level / FOG_LEVELS)).toFixed(3)})`;
      shadowStyles[level] = sh;
    }
    const n = SHADOW.length / 2;
    for (let i = 0; i < n; i++) {
      const sx = SHADOW[i * 2]!;
      const sy = SHADOW[i * 2 + 1]!;
      wx[i] = x + (sx * cs - sy * sn) * K;
      wy[i] = y + (sx * sn + sy * cs) * K;
      wz[i] = 0.2;
    }
    fillProjected(g, clipProject(c, wx, wy, wz, n), sh);
  }
  // Outline width in canvas units, from the size in device px.
  g.lineWidth = Math.max(0.75, Math.min(2, px / 160)) / pixelScale;
  g.lineJoin = 'bevel';
  const n = pieceOrder(m, ex, ey, ez, tier, order);
  for (let i = 0; i < n; i++) drawPiece(g, order[i]!);
  g.lineJoin = 'miter';
}

export function drawCarModel(
  g: CanvasRenderingContext2D,
  c: Camera,
  colorIdx: number,
  x: number,
  y: number,
  heading: number,
  dist: number,
  braking: boolean,
  lod?: Int8Array,
): void {
  drawCarBody(g, c, colorIdx, x, y, heading, dist, true, lod);
  if (ex < -2.01) {
    for (let i = 0; i < 2; i++) {
      fillModelQuad(g, TAIL[i]!, braking ? '#FF5A46' : '#B81E18');
      const ly0 = i === 0 ? -0.6 : 0.6;
      drawGlowAt(g, c, x + (-2.1 * cs - ly0 * sn) * K, y + (-2.1 * sn + ly0 * cs) * K, 5, braking ? 7 : 4.5, '255,60,40');
    }
  }
  if (ex > 2.01) {
    for (let i = 0; i < 2; i++) {
      fillModelQuad(g, HEAD[i]!, '#FFF6DA');
      const ly0 = i === 0 ? -0.57 : 0.57;
      drawGlowAt(g, c, x + (2.1 * cs - ly0 * sn) * K, y + (2.1 * sn + ly0 * cs) * K, 4.6, 6, '255,244,210');
    }
  }
}

// Which of two cars must be painted later, from a vertical plane that separates their footprints
// (±FOOT_HL × ±FOOT_HW around each centre, turned by the heading): the car on the camera's side of it.
// Returns 1 when b goes after a, −1 when a goes after b, 0 when no such plane exists (the cars touch).
export function carPaintOrder(
  ax: number,
  ay: number,
  ah: number,
  bx: number,
  by: number,
  bh: number,
  camX: number,
  camY: number,
): -1 | 0 | 1 {
  const ac = Math.cos(ah);
  const as = Math.sin(ah);
  const bc = Math.cos(bh);
  const bs = Math.sin(bh);
  // Candidate axes: the length and width directions of each car.
  for (let k = 0; k < 4; k++) {
    const nx = k === 0 ? ac : k === 1 ? -as : k === 2 ? bc : -bs;
    const ny = k === 0 ? as : k === 1 ? ac : k === 2 ? bs : bc;
    const ra = FOOT_HL * Math.abs(nx * ac + ny * as) + FOOT_HW * Math.abs(-nx * as + ny * ac);
    const rb = FOOT_HL * Math.abs(nx * bc + ny * bs) + FOOT_HW * Math.abs(-nx * bs + ny * bc);
    const pa = nx * ax + ny * ay;
    const pb = nx * bx + ny * by;
    const gap = Math.abs(pb - pa) - ra - rb;
    if (gap <= 0) continue;
    // Separating line halfway through the gap; the camera's side of it decides.
    const mid = pa < pb ? pa + ra + gap / 2 : pa - ra - gap / 2;
    const pc = nx * camX + ny * camY;
    const camOnB = pa < pb ? pc > mid : pc < mid;
    return camOnB ? 1 : -1;
  }
  return 0;
}

// Angular extent of a car's footprint seen from the camera (radians, relative to the view direction),
// written to lo[i] and hi[i]. Two cars can only overlap on screen when these intervals overlap.
export function footprintAngles(c: Camera, x: number, y: number, h: number, lo: Float64Array, hi: Float64Array, i: number): void {
  const hc = Math.cos(h);
  const hs = Math.sin(h);
  let a0 = Infinity;
  let a1 = -Infinity;
  for (let k = 0; k < 4; k++) {
    const u = k < 2 ? FOOT_HL : -FOOT_HL;
    const v = k % 2 === 0 ? FOOT_HW : -FOOT_HW;
    const dx = x + u * hc - v * hs - c.x;
    const dy = y + u * hs + v * hc - c.y;
    const a = Math.atan2(-dx * c.sin + dy * c.cos, dx * c.cos + dy * c.sin);
    if (a < a0) a0 = a;
    if (a > a1) a1 = a;
  }
  lo[i] = a0;
  hi[i] = a1;
}
