import {
  CX_L,
  CX_R,
  CY,
  FINISH_X,
  HALF_W,
  islandHull,
  PIT_ROAD_Y,
  PIT_X0,
  PIT_X1,
  pointAt,
  R_IN,
  R_OUT,
  RC,
  TRACK_LEN,
  WALL_X0,
  WALL_X1,
} from '../../track/oval';
import { OVAL } from '../../track/ovalTrack';
import { HELI, PYLON, palmSpots } from '../track/oval/infield';
import { OVAL_PIT_PAINT } from '../track/oval/pit';
import { COL, FONT_BLACK } from '../track/style';
import { trackCanvas } from '../world';
import { hexRgb, makePoly } from './engine';
import { type P3, rect, upright, wall } from './geom';
import { box, ground, insideHull, label, night, type Parts, pieces, strip } from './kit';
import type { PitScene } from './pitScene';
import type { SceneSpec } from './spec';
import { lazyCanvas, texQuad } from './texture';

// The night oval's scene: its stadium-shaped ground, the raised infield island with the paddock on it,
// the heliport, the leader pylon and the palms. The only fpv file that reads the oval's geometry.

export const ISLAND_H = 6;
const WALL_H = 10;

const pylonNames: string[] = ['BEL', 'TAN', 'FER', 'CAL'];
let pylonCanvas: HTMLCanvasElement | null = null;
let pylonKey = '';

export function pylonTex(): HTMLCanvasElement {
  if (!pylonCanvas) {
    pylonCanvas = document.createElement('canvas');
    pylonCanvas.width = 40;
    pylonCanvas.height = 128;
  }
  const key = pylonNames.join('|');
  if (key !== pylonKey) {
    pylonKey = key;
    const g = pylonCanvas.getContext('2d')!;
    g.fillStyle = '#17142B';
    g.fillRect(0, 0, 40, 128);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `14px ${FONT_BLACK}`;
    g.fillStyle = '#FFC85A';
    g.shadowColor = '#FFC85A';
    g.shadowBlur = 6;
    g.fillText('P', 20, 14);
    g.font = `12px ${FONT_BLACK}`;
    g.fillStyle = '#FFF8E8';
    g.shadowColor = '#FFF8E8';
    pylonNames.forEach((t, i) => {
      g.fillText(t, 20, 38 + i * 24);
    });
    g.shadowBlur = 0;
  }
  return pylonCanvas;
}

export function setPylonNames(names: string[]): void {
  pylonNames.splice(0, pylonNames.length, ...names.slice(0, 4));
}

const palmTex = lazyCanvas(96, 192, (g) => {
  g.strokeStyle = '#6A4A2A';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(48, 192);
  g.quadraticCurveTo(44, 120, 52, 60);
  g.stroke();
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const a = -Math.PI + (i / (leaves - 1)) * Math.PI;
    const ex = 52 + Math.cos(a) * 44;
    const ey = 60 + Math.sin(a) * 20 + 20;
    g.strokeStyle = i % 2 ? '#2E7A3A' : '#3E9A48';
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(52, 60);
    g.quadraticCurveTo(52 + Math.cos(a) * 24, 60 + Math.sin(a) * 24 - 12, ex, ey);
    g.stroke();
  }
  g.fillStyle = '#5A3A1A';
  g.beginPath();
  g.arc(52, 60, 6, 0, Math.PI * 2);
  g.fill();
});

function stadium(r: number, z: number): P3[] {
  const pts: P3[] = [];
  for (let a = -90; a <= 90; a += 6) {
    const t = (a * Math.PI) / 180;
    pts.push([CX_R + r * Math.cos(t), CY + r * Math.sin(t), z]);
  }
  for (let a = 90; a <= 270; a += 6) {
    const t = (a * Math.PI) / 180;
    pts.push([CX_L + r * Math.cos(t), CY + r * Math.sin(t), z]);
  }
  return pts;
}

function ovalGround(P: Parts): void {
  P.ground.push(ground(stadium(R_OUT, 0), night(COL.asphalt)));
  P.ground.push(ground(stadium(R_IN, 0.01), night(COL.pitSurface)));
}

function ovalRibbon(P: Parts): void {
  const lane = night('#FFF8E8', 0.85);
  for (const d of [-19, 0, 19]) {
    for (let s = 0; s < TRACK_LEN; s += 32) P.decals.push(makePoly(strip(OVAL, s, s + 12, d - 0.8, d + 0.8, 0.02), lane));
  }
  const edge = night('#FFF8E8');
  for (let s = 0; s < TRACK_LEN; s += 24) P.decals.push(makePoly(strip(OVAL, s, s + 24, -HALF_W + 0.5, -HALF_W + 2, 0.02), edge));
  for (let y = CY + R_IN, row = 0; y < CY + R_OUT; y += 5, row++) {
    for (let c = 0; c < 3; c++) {
      const col = (row + c) % 2 ? '#17142B' : '#FFF8E8';
      P.decals.push(makePoly(rect(FINISH_X - 7 + c * 5, y, FINISH_X - 2 + c * 5, y + 5, 0.03), hexRgb(col)));
    }
  }

  const red = night(COL.wallDark);
  const cream = night(COL.wallLight, 0.9);
  for (let s = 0, k = 0; s < TRACK_LEN; s += 18, k++) {
    const a = pointAt(s, HALF_W);
    const b = pointAt(s + 18, HALF_W);
    P.solids.push(makePoly(wall(a.x, a.y, b.x, b.y, 0, WALL_H), k % 2 ? cream : red));
  }
}

/** The infield island: grass on top, a kerb all round. */
function ovalIsland(P: Parts): void {
  const hull = islandHull();
  const grass = night(COL.grass);
  P.island.push(
    ground(
      hull.map(([x, y]) => [x, y, ISLAND_H] as P3),
      grass,
    ),
  );
  const curb = night(COL.curbFace, 1.6);
  const curbTop = night(COL.curbTop);
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i]!;
    const [bx, by] = hull[(i + 1) % hull.length]!;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const out = !insideHull(hull, mx - (by - ay) * 0.01, my + (bx - ax) * 0.01);
    pieces(out ? ax : bx, out ? ay : by, out ? bx : ax, out ? by : ay, (x0, y0, x1, y1) => {
      const low = makePoly(wall(x0, y0, x1, y1, 0, ISLAND_H - 1.4), curb);
      const lip = makePoly(wall(x0, y0, x1, y1, ISLAND_H - 1.4, ISLAND_H), curbTop);
      low.back = grass;
      lip.back = grass;
      P.solids.push(low, lip);
    });
  }
}

function ovalMasts(P: Parts): void {
  const mast = (x: number, y: number, fx: number, fy: number) => {
    box(P.solids, x - 1.5, y - 1.5, x + 1.5, y + 1.5, 0, 78, hexRgb('#2a2834'), hexRgb('#2a2834'));
    const lx = x + fx * 1.6;
    const ly = y + fy * 1.6;
    P.solids.push(makePoly(wall(lx + fy * 6, ly - fx * 6, lx - fy * 6, ly + fx * 6, 78, 84), hexRgb('#FFF4D0'), true));
    P.glows.push({ x: lx, y: ly, z: 81, r: 22, color: '255,214,140', flood: true });
  };
  for (let x = CX_L; x <= CX_R; x += 200) {
    mast(x, CY - R_OUT - 12, 0, 1);
    mast(x + 100, CY + R_OUT + 14, 0, -1);
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) {
      const ux = s * Math.cos(a);
      const uy = Math.sin(a);
      mast(cx + ux * (R_OUT + 14), CY + uy * (R_OUT + 14), -ux, -uy);
    }
  }
  for (let x = CX_L; x <= CX_R; x += 200) {
    P.pools.push({ x, y: CY - RC, r: 70, z: 0.015 });
    P.pools.push({ x: x + 100, y: CY + RC, r: 70, z: 0.015 });
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) P.pools.push({ x: cx + s * Math.cos(a) * RC, y: CY + Math.sin(a) * RC, r: 62, z: 0.015 });
  }
}

function heliport(P: Parts): void {
  const islandH = ISLAND_H;
  const white = hexRgb('#FFF8E8');
  const z = islandH + 0.06;
  const ring: P3[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ring.push([HELI.x + Math.cos(a) * HELI.r, HELI.y + Math.sin(a) * HELI.r, z]);
  }
  P.island.push(makePoly(ring, hexRgb('#2E2C3A')));
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2;
    const a1 = ((k + 1) / 24) * Math.PI * 2;
    const pt = (a: number, r: number): P3 => [HELI.x + Math.cos(a) * r, HELI.y + Math.sin(a) * r, z + 0.02];
    P.island.push(makePoly([pt(a0, HELI.r - 6), pt(a1, HELI.r - 6), pt(a1, HELI.r - 4), pt(a0, HELI.r - 4)], white));
  }
  P.island.push(makePoly(rect(HELI.x - 8, HELI.y - 9, HELI.x - 5, HELI.y + 9, z + 0.02), white));
  P.island.push(makePoly(rect(HELI.x + 5, HELI.y - 9, HELI.x + 8, HELI.y + 9, z + 0.02), white));
  P.island.push(makePoly(rect(HELI.x - 5, HELI.y - 1.5, HELI.x + 5, HELI.y + 1.5, z + 0.02), white));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    P.glows.push({
      x: HELI.x + Math.cos(a) * HELI.r,
      y: HELI.y + Math.sin(a) * HELI.r,
      z: z + 0.6,
      r: 2.2,
      color: k % 3 === 0 ? '127,227,217' : '255,244,208',
    });
  }
  const hx = HELI.x;
  const hy = HELI.y + HELI.r + 6;
  const board = hexRgb('#17142B');
  P.solids.push(makePoly(wall(hx - 9, hy - 1, hx + 9, hy - 1, islandH, islandH + 16), board));
  P.solids.push(makePoly(wall(hx + 9, hy + 1, hx - 9, hy + 1, islandH, islandH + 16), board));
  const hTex = label(48, 40, 'H', '#17142B', '#7FE3D9', 30);
  P.signs.push(texQuad(upright(hx - 8, hy + 1.3, hx + 8, hy + 1.3, islandH + 3, islandH + 15), hTex));
  P.signs.push(texQuad(upright(hx + 8, hy - 1.3, hx - 8, hy - 1.3, islandH + 3, islandH + 15), hTex));
}

/** The leader pylon showing the first four. */
function pylon(P: Parts): void {
  const islandH = ISLAND_H;
  const px = PYLON.x;
  const py = PYLON.y;
  const dark = hexRgb('#17142B');
  P.solids.push(makePoly(wall(px - 10, py + 3, px + 10, py + 3, islandH, islandH + 64), dark));
  P.solids.push(makePoly(wall(px + 10, py - 3, px - 10, py - 3, islandH, islandH + 64), dark));
  P.solids.push(makePoly(wall(px - 10, py - 3, px - 10, py + 3, islandH, islandH + 64), dark));
  P.solids.push(makePoly(wall(px + 10, py + 3, px + 10, py - 3, islandH, islandH + 64), dark));
  P.signs.push(texQuad(upright(px - 9, py + 3.4, px + 9, py + 3.4, islandH + 4, islandH + 62), pylonTex, { rows: 2, far: 1300 }));
  P.signs.push(texQuad(upright(px + 9, py - 3.4, px - 9, py - 3.4, islandH + 4, islandH + 62), pylonTex, { rows: 2, far: 1300 }));
  P.glows.push({ x: px, y: py, z: islandH + 67, r: 5, color: '230,59,46' });
}

function palms(P: Parts): void {
  // The palms are placed while the top-down oval is painted.
  trackCanvas(OVAL);
  for (const p of palmSpots()) P.billboards.push({ x: p.x, y: p.y, z: ISLAND_H, w: 26 * p.s, h: 40 * p.s, tex: palmTex });
}

const OVAL_PIT: PitScene = {
  ...OVAL_PIT_PAINT,
  y0: CY + RC,
  curbH: ISLAND_H,
  arrows: [
    { x: (WALL_X0 + PIT_X0) / 2, y: PIT_ROAD_Y, color: 'rgba(255,200,90,0.9)' },
    { x: (PIT_X1 + WALL_X1) / 2, y: PIT_ROAD_Y, color: 'rgba(127,227,217,0.9)' },
  ],
};

export const OVAL_SPEC: SceneSpec = {
  track: OVAL,
  pit: OVAL_PIT,
  paddock: { dx: 0, dy: 0, z: ISLAND_H },
  ground: ovalGround,
  ribbon: ovalRibbon,
  base: ovalIsland,
  masts: ovalMasts,
  extras(P) {
    heliport(P);
    pylon(P);
    palms(P);
  },
};
