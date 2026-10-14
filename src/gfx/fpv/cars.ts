// Draws rival cars in the cockpit view from the closed cockpit model (carFpv.ts).
// Painter's order inside a car is decided per piece with planes that separate the pieces, so the faces of
// one convex piece never overlap and no per-face sort is needed. Nothing here allocates per frame.
import {
  CABIN_SLOPE,
  CABIN_X0,
  CABIN_Z0,
  carFacesFpv,
  carLod,
  FPV_PALETTE,
  type FpvFace,
  type FpvPiece,
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
const BODY_LEN_PX = 4 * K;

let styleFog: RGB | null = null;
let styles: string[] = [];
const shadowStyles: string[] = [];

function style(cid: number, kq: number, level: number, fog: RGB): string {
  if (fog !== styleFog) {
    styles = [];
    styleFog = fog;
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

const SHADOW = new Float32Array([2.2, -0.85, 1.95, -1.02, -1.95, -1.02, -2.2, -0.85, -2.2, 0.85, -1.95, 1.02, 1.95, 1.02, 2.2, 0.85]);
const TAIL = [-1, 1].map(
  (s) => new Float32Array([-2.01, s * 0.42, 0.44, -2.01, s * 0.78, 0.44, -2.01, s * 0.78, 0.58, -2.01, s * 0.42, 0.58]),
);
const HEAD = [-1, 1].map((s) => new Float32Array([2.01, s * 0.4, 0.4, 2.01, s * 0.75, 0.4, 2.01, s * 0.75, 0.52, 2.01, s * 0.4, 0.52]));

const wx = new Float32Array(32);
const wy = new Float32Array(32);
const wz = new Float32Array(32);

// Per-car state, set by drawCarModel.
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
  if (tier === 2) return;
  for (const d of f.decals) if (tier === 0 || !d.detail) drawFace(g, d, d.flat ? 0 : kq, false);
}

function drawPiece(g: CanvasRenderingContext2D, p: FpvPiece): void {
  for (const f of p.faces) {
    if (f.hidden) continue;
    const n = f.normal;
    if (n[0] * ex + n[1] * ey + n[2] * ez <= f.d) continue;
    const kq = f.flat ? 0 : Math.round((-0.3 + 0.42 * Math.max(0, n[0] * lx + n[1] * ly + n[2] * lz)) * KQ);
    drawFace(g, f, kq, tier < 2);
  }
}

function drawSpoiler(g: CanvasRenderingContext2D, wing: FpvPiece, plates: FpvPiece[]): void {
  // An end plate is separated from the wing by the plane y = ±WING_HW: the one on the eye's side goes last.
  if (-ey <= WING_HW) drawPiece(g, plates[0]!);
  if (ey <= WING_HW) drawPiece(g, plates[1]!);
  drawPiece(g, wing);
  if (-ey > WING_HW) drawPiece(g, plates[0]!);
  if (ey > WING_HW) drawPiece(g, plates[1]!);
}

function fillModelQuad(g: CanvasRenderingContext2D, xyz: Float32Array, color: string): void {
  fillProjected(g, project(xyz), color);
}

// Length of a car on screen in px at a distance, for the level of detail.
export function carLengthPx(c: Camera, dist: number): number {
  return (c.focal * BODY_LEN_PX) / Math.max(1, dist);
}

// Shadow and pieces of a car, without its lamps (the hole check in the car lab draws only these).
export function drawCarBody(
  g: CanvasRenderingContext2D,
  c: Camera,
  colorIdx: number,
  x: number,
  y: number,
  heading: number,
  dist: number,
  shadow = true,
): void {
  const m = carFacesFpv(colorIdx);
  cam = c;
  ox = x;
  oy = y;
  cs = Math.cos(heading);
  sn = Math.sin(heading);
  level = c.fogLevel(dist);
  const px = carLengthPx(c, dist);
  tier = carLod(px);
  const dx = c.x - x;
  const dy = c.y - y;
  ex = (dx * cs + dy * sn) / K;
  ey = (-dx * sn + dy * cs) / K;
  ez = c.z / K;
  lx = LIGHT[0] * cs + LIGHT[1] * sn;
  ly = -LIGHT[0] * sn + LIGHT[1] * cs;
  lz = LIGHT[2];

  if (tier < 2 && shadow) {
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
  if (tier < 2) {
    g.lineWidth = Math.max(0.75, Math.min(2, px / 160));
    g.lineJoin = 'bevel';

    // Tyres and floor lie partly inside the body, so they go first and the body covers what it hides.
    // Among themselves: the far side, the floor, then the near side; on each side the far axle first.
    const near = ey >= 0 ? 2 : 0;
    const far = 2 - near;
    const back = ex >= 0 ? 0 : 1;
    drawPiece(g, m.tyres[far + back]!);
    drawPiece(g, m.tyres[far + 1 - back]!);
    if (tier === 0) drawPiece(g, m.floor);
    drawPiece(g, m.tyres[near + back]!);
    drawPiece(g, m.tyres[near + 1 - back]!);
  }

  // The deck plane under the greenhouse separates body and greenhouse; x = WING_SPLIT_X separates
  // greenhouse and spoiler; the spoiler stands on the body, which is below any eye.
  const behindWing = ex < WING_SPLIT_X;
  const aboveDeck = ez >= CABIN_Z0 + CABIN_SLOPE * (CABIN_X0 - ex);
  if (aboveDeck) {
    drawPiece(g, m.body);
    if (behindWing) {
      drawPiece(g, m.cabin);
      drawSpoiler(g, m.wing, m.plates);
    } else {
      drawSpoiler(g, m.wing, m.plates);
      drawPiece(g, m.cabin);
    }
  } else {
    drawPiece(g, m.cabin);
    drawPiece(g, m.body);
    drawSpoiler(g, m.wing, m.plates);
  }
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
): void {
  drawCarBody(g, c, colorIdx, x, y, heading, dist);
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
      drawGlowAt(g, c, x + (2.1 * cs - ly0 * sn) * K, y + (2.1 * sn + ly0 * cs) * K, 4.6, 8, '255,244,210');
    }
  }
}
