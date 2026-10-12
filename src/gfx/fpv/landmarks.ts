import { CONFIG } from '../../config';
import { gridS } from '../../race/race';
import { createRng } from '../../sim/rng';
import {
  BOX_W,
  boxX,
  CX_L,
  CX_R,
  CY,
  NUM_BOXES,
  PIT_BOX_TOP,
  PIT_LABEL_TOP,
  PIT_LANE_TOP,
  PIT_ROAD_Y,
  PIT_X0,
  PIT_X1,
  pointAt,
  RC,
  WALL_X0,
  WALL_X1,
} from '../../track/track';
import { HELI, PYLON, palmSpots } from '../track/infield';
import { RC_X0, RC_X1, STAND_TOP, STAND_X0, STAND_X1, TEAMS, UNIT_TOP, UNIT_W, unitXs } from '../track/paddock';
import { COL, FONT_BLACK } from '../track/style';
import { hexRgb, makePoly, type Poly } from './engine';
import type { Glow } from './scene';
import { type Billboard, lazyCanvas, type TexQuad, texQuad } from './texture';

type P3 = [number, number, number];

export interface Pool {
  x: number;
  y: number;
  r: number;
}

export interface Landmarks {
  decals: Poly[];
  island: Poly[];
  solids: Poly[];
  signs: TexQuad[];
  groundSigns: TexQuad[];
  billboards: Billboard[];
  pools: Pool[];
  glows: Glow[];
  pylon: TexQuad[];
}

const pylonTexts: string[] = ['P', 'BEL', 'TAN', 'FER', 'CAL'];
let pylonCanvas: HTMLCanvasElement | null = null;
let pylonKey = '';

function drawPylon(g: CanvasRenderingContext2D, names: string[]): void {
  g.fillStyle = '#17142B';
  g.fillRect(0, 0, 40, 128);
  g.font = `14px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#FFC85A';
  g.shadowColor = '#FFC85A';
  g.shadowBlur = 6;
  g.fillText('P', 20, 14);
  g.fillStyle = '#FFF8E8';
  g.shadowColor = '#FFF8E8';
  g.font = `12px ${FONT_BLACK}`;
  names.slice(0, 4).forEach((t, i) => {
    g.fillText(t, 20, 38 + i * 24);
  });
  g.shadowBlur = 0;
}

export function pylonTex(): HTMLCanvasElement {
  if (!pylonCanvas) {
    pylonCanvas = document.createElement('canvas');
    pylonCanvas.width = 40;
    pylonCanvas.height = 128;
  }
  const key = pylonTexts.join('|');
  if (key !== pylonKey) {
    pylonKey = key;
    drawPylon(pylonCanvas.getContext('2d')!, pylonTexts.slice(1));
  }
  return pylonCanvas;
}

export function setPylonNames(names: string[]): void {
  pylonTexts.length = 1;
  pylonTexts.push(...names.slice(0, 4));
}

function label(w: number, h: number, text: string, bg: string, fg: string, font: number, stripe?: string): () => HTMLCanvasElement {
  return lazyCanvas(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (stripe) {
      g.fillStyle = stripe;
      g.fillRect(0, h - 4, w, 4);
    }
    g.font = `${font}px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fg;
    g.shadowColor = fg;
    g.shadowBlur = 4;
    g.fillText(text, w / 2, h / 2 - (stripe ? 1 : 0), w - 8);
  });
}

const crowd = lazyCanvas(256, 48, (g) => {
  const rng = createRng(4711);
  g.fillStyle = '#1C1830';
  g.fillRect(0, 0, 256, 48);
  const shirts = ['#E63B2E', '#FFB627', '#12B5A6', '#FFF8E8', '#2633C5', '#C8F03C', '#F06EAA'];
  for (let y = 4; y < 46; y += 7) {
    g.fillStyle = '#2A2640';
    g.fillRect(0, y + 4, 256, 2);
    for (let x = 1; x < 256; x += 4) {
      if (rng() < 0.12) continue;
      g.fillStyle = shirts[Math.floor(rng() * shirts.length)]!;
      g.fillRect(x, y + 1, 3, 3);
      g.fillStyle = ['#f0c098', '#e0a878', '#c88a5a', '#8a5a38'][Math.floor(rng() * 4)]!;
      g.fillRect(x + 0.5, y - 1, 2, 2);
    }
  }
});

const windows = lazyCanvas(128, 32, (g) => {
  g.fillStyle = '#3A3846';
  g.fillRect(0, 0, 128, 32);
  for (let x = 4; x < 124; x += 12) {
    g.fillStyle = '#FFD27A';
    g.fillRect(x, 6, 8, 20);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x, 6, 8, 3);
  }
});

const pitText = lazyCanvas(96, 32, (g) => {
  g.clearRect(0, 0, 96, 32);
  g.strokeStyle = 'rgba(255,200,90,0.9)';
  g.lineWidth = 3;
  for (const o of [0, 10, 20]) {
    g.beginPath();
    g.moveTo(6 + o, 6);
    g.lineTo(14 + o, 16);
    g.lineTo(6 + o, 26);
    g.stroke();
  }
  g.font = `18px ${FONT_BLACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,248,232,0.8)';
  g.fillText('PIT', 44, 17);
});

const palmTex = lazyCanvas(48, 96, (g) => {
  g.strokeStyle = '#6A4A2A';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(24, 96);
  g.quadraticCurveTo(22, 60, 26, 30);
  g.stroke();
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const a = -Math.PI + (i / (leaves - 1)) * Math.PI;
    const ex = 26 + Math.cos(a) * 22;
    const ey = 30 + Math.sin(a) * 10 + 10;
    g.strokeStyle = i % 2 ? '#2E7A3A' : '#3E9A48';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(26, 30);
    g.quadraticCurveTo(26 + Math.cos(a) * 12, 30 + Math.sin(a) * 12 - 6, ex, ey);
    g.stroke();
  }
  g.fillStyle = '#5A3A1A';
  g.beginPath();
  g.arc(26, 30, 3, 0, Math.PI * 2);
  g.fill();
});

function rect(x0: number, y0: number, x1: number, y1: number, z: number): P3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ];
}

function facing(x0: number, x1: number, y: number, z0: number, z1: number): [P3, P3, P3, P3] {
  return [
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
    [x0, y, z0],
  ];
}

export function buildLandmarks(islandH: number, standDepth: number): Landmarks {
  const decals: Poly[] = [];
  const island: Poly[] = [];
  const solids: Poly[] = [];
  const signs: TexQuad[] = [];
  const groundSigns: TexQuad[] = [];
  const billboards: Billboard[] = [];
  const pools: Pool[] = [];
  const glows: Glow[] = [];
  const pylon: TexQuad[] = [];

  const boxLine = hexRgb(COL.box);
  for (let i = 0; i < NUM_BOXES; i++) {
    const x0 = boxX(i) - BOX_W / 2;
    const x1 = x0 + BOX_W;
    const top = PIT_BOX_TOP + 1;
    const bottom = PIT_LANE_TOP - 1;
    decals.push(makePoly(rect(x0, top, x0 + 1.5, bottom, 0.03), boxLine));
    decals.push(makePoly(rect(x1 - 1.5, top, x1, bottom, 0.03), boxLine));
    decals.push(makePoly(rect(x0, top, x1, top + 1.5, 0.03), boxLine));
    for (let x = x0; x < x1; x += 9) decals.push(makePoly(rect(x, bottom - 2, Math.min(x1, x + 5), bottom, 0.03), boxLine));
  }

  const white = hexRgb('#FFF8E8');
  for (let slot = 0; slot < 20; slot++) {
    const d = CONFIG.GRID_LANES[slot % 2]!;
    const p = pointAt(gridS(slot) + CONFIG.CAR_LEN / 2 + 3, d);
    decals.push(makePoly(rect(p.x, p.y - 11, p.x + 2, p.y + 11, 0.03), white));
    decals.push(makePoly(rect(p.x - 9, p.y - 11, p.x, p.y - 9, 0.03), white));
    decals.push(makePoly(rect(p.x - 9, p.y + 9, p.x, p.y + 11, 0.03), white));
  }

  for (const x of [(WALL_X0 + PIT_X0) / 2, (PIT_X1 + WALL_X1) / 2]) {
    const y = PIT_ROAD_Y;
    groundSigns.push(
      texQuad(
        [
          [x + 24, y - 8, 0.04],
          [x + 24, y + 8, 0.04],
          [x - 24, y + 8, 0.04],
          [x - 24, y - 8, 0.04],
        ],
        pitText,
        2,
        2,
        400,
      ),
    );
  }

  const z = islandH + 0.06;
  const ring: P3[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ring.push([HELI.x + Math.cos(a) * HELI.r, HELI.y + Math.sin(a) * HELI.r, z]);
  }
  island.push(makePoly(ring, hexRgb('#2E2C3A')));
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2;
    const a1 = ((k + 1) / 24) * Math.PI * 2;
    const r0 = HELI.r - 6;
    const r1 = HELI.r - 4;
    const pt = (a: number, r: number): P3 => [HELI.x + Math.cos(a) * r, HELI.y + Math.sin(a) * r, z + 0.02];
    island.push(makePoly([pt(a0, r0), pt(a1, r0), pt(a1, r1), pt(a0, r1)], white));
  }
  island.push(makePoly(rect(HELI.x - 8, HELI.y - 9, HELI.x - 5, HELI.y + 9, z + 0.02), white));
  island.push(makePoly(rect(HELI.x + 5, HELI.y - 9, HELI.x + 8, HELI.y + 9, z + 0.02), white));
  island.push(makePoly(rect(HELI.x - 5, HELI.y - 1.5, HELI.x + 5, HELI.y + 1.5, z + 0.02), white));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    glows.push({
      x: HELI.x + Math.cos(a) * HELI.r,
      y: HELI.y + Math.sin(a) * HELI.r,
      z: z + 0.6,
      r: 2.2,
      color: k % 3 === 0 ? '127,227,217' : '255,244,208',
    });
  }

  unitXs().forEach((x, i) => {
    const tm = TEAMS[i % TEAMS.length]!;
    const y = UNIT_TOP + 52 + 0.6;
    signs.push(texQuad(facing(x + 4, x + UNIT_W - 4, y, islandH + 14, islandH + 21), label(160, 24, tm.name, tm.a, tm.t, 15, tm.b), 2, 1));
  });

  let k = 0;
  for (let x = PIT_X0 + 64; x < PIT_X1 - 30; x += 128, k++) {
    const text = k % 2 ? 'PETROL RUSH' : 'PIT ROAD';
    const color = k % 2 ? COL.labelAlt : COL.label;
    signs.push(
      texQuad(facing(x - 52, x + 52, PIT_LABEL_TOP + 0.4, 0.4, islandH - 0.4), label(160, 14, text, COL.curbFace, color, 11), 2, 1, 500),
    );
  }

  for (let t = 0; t < 4; t++) {
    const y1 = PIT_LABEL_TOP - 15 - t * standDepth + 0.4;
    const h = 8 + t * 9;
    const z0 = islandH + (t === 0 ? 0 : 8 + (t - 1) * 9);
    signs.push(texQuad(facing(STAND_X0, STAND_X1, y1, z0, islandH + h), crowd, 6, 1));
  }
  signs.push(
    texQuad(
      facing(STAND_X0 + 40, STAND_X1 - 40, STAND_TOP + standDepth * 1.6 + 0.4, islandH + 38, islandH + 44),
      label(320, 20, 'PETROL RUSH  ·  MAIN GRANDSTAND', '#17142B', '#FFB627', 13),
      4,
      1,
      800,
    ),
  );

  const rcFront = UNIT_TOP + 40 + 0.6;
  signs.push(texQuad(facing(RC_X0 + 6, RC_X1 - 6, rcFront, islandH + 18, islandH + 30), windows, 2, 1));
  signs.push(
    texQuad(
      facing(RC_X0 + 4, RC_X1 - 4, rcFront, islandH + 30, islandH + 36),
      label(160, 18, 'RACE CONTROL', '#17142B', '#FFC85A', 12),
      2,
      1,
      800,
    ),
  );

  const px = PYLON.x;
  const py = PYLON.y;
  const pz = islandH;
  const dark = hexRgb('#17142B');
  solids.push(makePoly(facing(px + 10, px - 10, py - 3, pz, pz + 64), dark));
  solids.push(makePoly(facing(px - 10, px + 10, py + 3, pz, pz + 64), dark));
  solids.push(
    makePoly(
      [
        [px - 10, py - 3, pz],
        [px - 10, py + 3, pz],
        [px - 10, py + 3, pz + 64],
        [px - 10, py - 3, pz + 64],
      ],
      dark,
    ),
  );
  solids.push(
    makePoly(
      [
        [px + 10, py + 3, pz],
        [px + 10, py - 3, pz],
        [px + 10, py - 3, pz + 64],
        [px + 10, py + 3, pz + 64],
      ],
      dark,
    ),
  );
  pylon.push(texQuad(facing(px - 9, px + 9, py + 3.4, pz + 4, pz + 62), pylonTex, 1, 2, 900));
  pylon.push(texQuad(facing(px + 9, px - 9, py - 3.4, pz + 4, pz + 62), pylonTex, 1, 2, 900));
  glows.push({ x: px, y: py, z: pz + 67, r: 5, color: '230,59,46' });

  for (const p of palmSpots()) billboards.push({ x: p.x, y: p.y, z: islandH, w: 26 * p.s, h: 40 * p.s, tex: palmTex });

  for (let x = CX_L; x <= CX_R; x += 200) {
    pools.push({ x, y: CY - RC, r: 70 });
    pools.push({ x: x + 100, y: CY + RC, r: 70 });
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) pools.push({ x: cx + s * Math.cos(a) * RC, y: CY + Math.sin(a) * RC, r: 62 });
  }

  return { decals, island, solids, signs, groundSigns, billboards, pools, glows, pylon };
}
