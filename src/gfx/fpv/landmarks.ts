import { CONFIG } from '../../config';
import { createRng } from '../../sim/rng';
import {
  BOX_W,
  boxX,
  CX_L,
  CX_R,
  CY,
  NUM_BOXES,
  PIT_BOX_TOP,
  PIT_LANE_TOP,
  PIT_LINE_IN_X,
  PIT_LINE_OUT_X,
  PIT_ROAD_Y,
  PIT_WALL_TOP,
  PIT_X0,
  PIT_X1,
  pointAt,
  RC,
  WALL_X0,
  WALL_X1,
} from '../../track/oval';
import { gridS } from '../../track/ovalTrack';
import { HELI, PYLON, palmSpots } from '../track/oval/infield';
import { RC_X0, RC_X1, STAND_TOP, STAND_X0, STAND_X1, TEAMS, UNIT_TOP, UNIT_W, unitXs } from '../track/oval/paddock';
import { COL, FONT_BLACK } from '../track/style';
import { hexRgb, makePoly, type Poly } from './engine';
import { groundQuad, type P3, rect, upright, wall } from './geom';
import { type Billboard, lazyCanvas, type TexQuad, texQuad } from './texture';

export interface Glow {
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
  flood?: boolean;
}

export interface Pool {
  x: number;
  y: number;
  r: number;
  z: number;
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
}

export const RC_FRONT = CY + 25;

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

function label(
  w: number,
  h: number,
  text: string,
  bg: string | null,
  fg: string,
  font: number,
  stripe?: string,
  glow = true,
): () => HTMLCanvasElement {
  return lazyCanvas(w, h, (g) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    }
    if (stripe) {
      g.fillStyle = stripe;
      g.fillRect(0, h - Math.round(h / 6), w, Math.round(h / 6));
    }
    g.font = `${font}px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fg;
    g.shadowColor = fg;
    g.shadowBlur = glow ? Math.max(2, font / 5) : 0;
    g.fillText(text, w / 2, h / 2 - (stripe ? h / 14 : 0), w - 8);
  });
}

const crowd = lazyCanvas(96, 32, (g) => {
  const rng = createRng(4711);
  g.fillStyle = '#1C1830';
  g.fillRect(0, 0, 96, 32);
  const shirts = ['#E63B2E', '#FFB627', '#12B5A6', '#FFF8E8', '#2633C5', '#C8F03C', '#F06EAA'];
  const skin = ['#f0c098', '#e0a878', '#c88a5a', '#8a5a38'];
  for (let y = 3; y < 30; y += 9) {
    g.fillStyle = '#2A2640';
    g.fillRect(0, y + 6, 96, 2);
    for (let x = 1; x < 96; x += 5) {
      if (rng() < 0.12) continue;
      g.fillStyle = shirts[Math.floor(rng() * shirts.length)]!;
      g.fillRect(x, y + 2, 4, 4);
      g.fillStyle = skin[Math.floor(rng() * skin.length)]!;
      g.fillRect(x + 1, y - 1, 2, 3);
    }
  }
});

const windows = lazyCanvas(96, 40, (g) => {
  g.fillStyle = '#3A3846';
  g.fillRect(0, 0, 96, 40);
  for (let x = 4; x < 92; x += 16) {
    g.fillStyle = '#FFD27A';
    g.fillRect(x, 6, 12, 28);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x, 6, 12, 4);
  }
});

function pitArrow(color: string): () => HTMLCanvasElement {
  return lazyCanvas(64, 96, (g) => {
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.lineJoin = 'round';
    for (const o of [6, 22, 38]) {
      g.beginPath();
      g.moveTo(14, o + 14);
      g.lineTo(32, o);
      g.lineTo(50, o + 14);
      g.stroke();
    }
    g.font = `22px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,248,232,0.8)';
    g.fillText('PIT', 32, 80);
  });
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

const garageDoor = lazyCanvas(112, 26, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 26);
  gr.addColorStop(0, '#6E6048');
  gr.addColorStop(1, '#C8B088');
  g.fillStyle = gr;
  g.fillRect(0, 0, 112, 26);
  g.fillStyle = 'rgba(23,20,43,0.35)';
  for (let x = 14; x < 112; x += 28) g.fillRect(x, 4, 2, 22);
});

const digits = new Map<number, () => HTMLCanvasElement>();
function gridNumber(n: number): () => HTMLCanvasElement {
  let t = digits.get(n);
  if (!t) {
    t = label(32, 24, String(n), null, 'rgba(255,248,232,0.7)', 16, undefined, false);
    digits.set(n, t);
  }
  return t;
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
    groundSigns.push(texQuad(groundQuad(p.x + 10, p.y, 12, 16, 1, 0, 0.04), gridNumber(slot + 1), { far: 350 }));
  }

  const lineCol = hexRgb('#FFC85A');
  for (const [x, text] of [
    [PIT_LINE_IN_X, 'PIT LANE'],
    [PIT_LINE_OUT_X, 'PIT EXIT'],
  ] as const) {
    decals.push(makePoly(rect(x, PIT_BOX_TOP + 1, x + 3, PIT_WALL_TOP - 1, 0.03), lineCol));
    const mid = (PIT_BOX_TOP + PIT_WALL_TOP) / 2;
    groundSigns.push(
      texQuad(
        groundQuad(x + 12, mid, 12, PIT_WALL_TOP - PIT_BOX_TOP - 6, 1, 0, 0.04),
        label(128, 64, text, null, 'rgba(255,200,90,0.9)', 20),
        {
          far: 400,
        },
      ),
    );
  }
  const lightX = PIT_X1 - 1.5;
  const lightY = PIT_LANE_TOP + 17;
  for (const [x0, y0, x1, y1] of [
    [lightX - 1, lightY - 1, lightX + 1, lightY - 1],
    [lightX + 1, lightY - 1, lightX + 1, lightY + 1],
    [lightX + 1, lightY + 1, lightX - 1, lightY + 1],
    [lightX - 1, lightY + 1, lightX - 1, lightY - 1],
  ] as const) {
    solids.push(makePoly(wall(x0, y0, x1, y1, 0, 16), hexRgb('#17142B')));
  }
  solids.push(makePoly(wall(lightX - 1.2, lightY - 1.2, lightX - 1.2, lightY + 1.2, 12, 15), hexRgb('#52E252'), true));
  glows.push({ x: lightX - 1.5, y: lightY, z: 13.5, r: 5, color: '82,226,82' });

  for (const [x, color] of [
    [(WALL_X0 + PIT_X0) / 2, 'rgba(255,200,90,0.9)'],
    [(PIT_X1 + WALL_X1) / 2, 'rgba(127,227,217,0.9)'],
  ] as const) {
    groundSigns.push(texQuad(groundQuad(x, PIT_ROAD_Y, 36, 24, 1, 0, 0.04), pitArrow(color), { rows: 2, far: 450 }));
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
    const pt = (a: number, r: number): P3 => [HELI.x + Math.cos(a) * r, HELI.y + Math.sin(a) * r, z + 0.02];
    island.push(makePoly([pt(a0, HELI.r - 6), pt(a1, HELI.r - 6), pt(a1, HELI.r - 4), pt(a0, HELI.r - 4)], white));
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
  const hx = HELI.x;
  const hy = HELI.y + HELI.r + 6;
  const board = hexRgb('#17142B');
  solids.push(makePoly(wall(hx - 9, hy - 1, hx + 9, hy - 1, islandH, islandH + 16), board));
  solids.push(makePoly(wall(hx + 9, hy + 1, hx - 9, hy + 1, islandH, islandH + 16), board));
  const hTex = label(48, 40, 'H', '#17142B', '#7FE3D9', 30);
  signs.push(texQuad(upright(hx - 8, hy + 1.3, hx + 8, hy + 1.3, islandH + 3, islandH + 15), hTex));
  signs.push(texQuad(upright(hx + 8, hy - 1.3, hx - 8, hy - 1.3, islandH + 3, islandH + 15), hTex));

  unitXs().forEach((x, i) => {
    const tm = TEAMS[i % TEAMS.length]!;
    const y = UNIT_TOP + 52;
    signs.push(texQuad(upright(x + 8, y + 0.4, x + UNIT_W - 8, y + 0.4, islandH, islandH + 13), garageDoor));
    glows.push({ x: x + UNIT_W / 2, y: y + 2, z: islandH + 6, r: 14, color: '255,214,140' });
    pools.push({ x: x + UNIT_W / 2, y: y + 10, r: 26, z: islandH + 0.08 });
    signs.push(
      texQuad(upright(x + 4, y + 0.6, x + UNIT_W - 4, y + 0.6, islandH + 14, islandH + 21), label(240, 26, tm.name, tm.a, tm.t, 17, tm.b)),
    );
  });

  let k = 0;
  for (let x = PIT_X0 + 64; x < PIT_X1 - 30; x += 128, k++) {
    const text = k % 2 ? 'PETROL RUSH' : 'PIT ROAD';
    const color = k % 2 ? COL.labelAlt : COL.label;
    signs.push(
      texQuad(
        upright(x - 52, PIT_BOX_TOP + 0.4, x + 52, PIT_BOX_TOP + 0.4, 0.4, islandH - 0.4),
        label(320, 16, text, COL.curbFace, color, 13),
        {
          far: 600,
        },
      ),
    );
  }

  for (let t = 0; t < 4; t++) {
    const y1 = CY + 13 - t * standDepth + 0.4;
    const top = islandH + 8 + t * 9;
    const z0 = t === 0 ? islandH : islandH + 8 + (t - 1) * 9;
    signs.push(texQuad(upright(STAND_X0, y1, STAND_X1, y1, z0, top), crowd, { tile: true }));
  }
  signs.push(
    texQuad(
      upright(
        STAND_X0 + 40,
        STAND_TOP + standDepth * 1.6 + 0.4,
        STAND_X1 - 40,
        STAND_TOP + standDepth * 1.6 + 0.4,
        islandH + 34,
        islandH + 44,
      ),
      label(700, 20, 'PETROL RUSH  ·  MAIN GRANDSTAND', '#17142B', '#FFB627', 14),
      { far: 1300 },
    ),
  );

  signs.push(texQuad(upright(RC_X0 + 6, RC_FRONT + 0.6, RC_X1 - 6, RC_FRONT + 0.6, islandH + 16, islandH + 28), windows, { tile: true }));
  signs.push(
    texQuad(
      upright(RC_X0 + 4, RC_FRONT + 0.6, RC_X1 - 4, RC_FRONT + 0.6, islandH + 29, islandH + 35),
      label(340, 20, 'RACE CONTROL', '#17142B', '#FFC85A', 14),
      {
        far: 1300,
      },
    ),
  );

  const px = PYLON.x;
  const py = PYLON.y;
  const dark = hexRgb('#17142B');
  solids.push(makePoly(wall(px - 10, py + 3, px + 10, py + 3, islandH, islandH + 64), dark));
  solids.push(makePoly(wall(px + 10, py - 3, px - 10, py - 3, islandH, islandH + 64), dark));
  solids.push(makePoly(wall(px - 10, py - 3, px - 10, py + 3, islandH, islandH + 64), dark));
  solids.push(makePoly(wall(px + 10, py + 3, px + 10, py - 3, islandH, islandH + 64), dark));
  signs.push(texQuad(upright(px - 9, py + 3.4, px + 9, py + 3.4, islandH + 4, islandH + 62), pylonTex, { rows: 2, far: 1300 }));
  signs.push(texQuad(upright(px + 9, py - 3.4, px - 9, py - 3.4, islandH + 4, islandH + 62), pylonTex, { rows: 2, far: 1300 }));
  glows.push({ x: px, y: py, z: islandH + 67, r: 5, color: '230,59,46' });

  for (const p of palmSpots()) billboards.push({ x: p.x, y: p.y, z: islandH, w: 26 * p.s, h: 40 * p.s, tex: palmTex });

  for (let x = CX_L; x <= CX_R; x += 200) {
    pools.push({ x, y: CY - RC, r: 70, z: 0.015 });
    pools.push({ x: x + 100, y: CY + RC, r: 70, z: 0.015 });
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) pools.push({ x: cx + s * Math.cos(a) * RC, y: CY + Math.sin(a) * RC, r: 62, z: 0.015 });
  }
  for (const x of [560, 700, 840, 990, 1120, 1250, 1400, 1540, 1680]) pools.push({ x, y: CY - 14, r: 60, z: islandH + 0.08 });

  return { decals, island, solids, signs, groundSigns, billboards, pools, glows };
}
