import { CONFIG } from '../config';
import { makeCanvas, shade } from '../gfx/sprites';
import { drawHauler3d } from '../gfx/vehicles';
import { gridS } from '../race/race';
import { createRng, Rng } from '../sim/rng';
import {
  BOX_W,
  boxX,
  CURB_H,
  CX_L,
  CX_R,
  CY,
  FINISH_X,
  islandOutline,
  NUM_BOXES,
  PIT_BOX_TOP,
  PIT_LABEL_TOP,
  PIT_LANE_TOP,
  PIT_LINE_IN_X,
  PIT_LINE_OUT_X,
  PIT_ROAD_Y,
  PIT_WALL_TOP,
  PIT_X0,
  PIT_X1,
  pointAt,
  R_IN,
  R_OUT,
  RC,
  SEP_BOTTOM,
  STANDS_BOTTOM,
  WALL_X0,
  WALL_X1,
  STANDS_X1,
  WORLD_W,
} from './track';

const COL = {
  outside: '#0E0C1C',
  wallDark: '#E63B2E',
  wallLight: '#FFF8E8',
  asphalt: '#3A3946',
  lane: 'rgba(255,248,232,0.75)',
  edge: '#FFF8E8',
  curbFace: '#17142B',
  curbTop: '#12B5A6',
  grass: '#1E5A34',
  grassEdge: '#0A2014',
  pitSurface: '#2E2C3A',
  box: '#FFC85A',
  sep: '#17142B',
  sepTop: '#12B5A6',
  label: '#FFB627',
  labelAlt: '#12B5A6',
  ink: '#17142B',
};

const FONT_BLACK = '"Arial Black", "Arial Bold", Arial, sans-serif';

function infieldPath(g: CanvasRenderingContext2D, dy: number): void {
  g.beginPath();
  islandOutline(dy).forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
}

function stadium(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath();
  g.arc(CX_R, CY, r, -Math.PI / 2, Math.PI / 2);
  g.arc(CX_L, CY, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
}

export function buildTrackCanvas(): HTMLCanvasElement {
  const H = CONFIG.PLAY_H;
  const c = makeCanvas(WORLD_W, H);
  const g = c.getContext('2d')!;
  const rng = createRng(4242);

  g.fillStyle = COL.outside;
  g.fillRect(0, 0, WORLD_W, H);

  stadium(g, R_OUT + 10);
  g.fillStyle = COL.wallDark;
  g.fill();
  stadium(g, R_OUT + 5);
  g.strokeStyle = COL.wallLight;
  g.lineWidth = 9;
  g.setLineDash([18, 18]);
  g.stroke();
  g.setLineDash([]);

  stadium(g, R_OUT);
  g.fillStyle = COL.asphalt;
  g.fill();

  g.strokeStyle = COL.lane;
  g.lineWidth = 2;
  g.setLineDash([12, 20]);
  for (const d of [-19, 0, 19]) {
    stadium(g, RC + d);
    g.stroke();
  }
  g.setLineDash([]);

  stadium(g, R_IN);
  g.strokeStyle = COL.edge;
  g.lineWidth = 1.5;
  g.stroke();

  drawGrid(g);

  infieldPath(g, CURB_H);
  g.fillStyle = COL.curbFace;
  g.fill();
  g.strokeStyle = COL.ink;
  g.lineWidth = 2;
  g.stroke();
  infieldPath(g, 1);
  g.strokeStyle = COL.curbTop;
  g.lineWidth = 2;
  g.stroke();
  infieldPath(g, 0);
  g.fillStyle = COL.grass;
  g.fill();
  g.strokeStyle = COL.grassEdge;
  g.lineWidth = 2;
  g.stroke();

  drawPitRoad(g);
  drawPitRoadPaint(g);
  drawCenter(g, createRng(77));
  drawInfieldDecor(g, createRng(91));
  drawFinishLine(g);
  addNoise(g, WORLD_W, H, rng);
  nightLighting(g, rng);
  drawPitLabels(g);
  drawPitSigns(g);
  drawCenterLights(g, createRng(78));
  drawInfieldDecorLights(g);
  drawLitFinish(g);
  g.fillStyle = '#000';
  g.fillRect(0, OUT_TOP, WORLD_W, H - OUT_TOP);
  return c;
}

function drawGrid(g: CanvasRenderingContext2D): void {
  const half = 11;
  g.font = `7px ${FONT_BLACK}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let slot = 0; slot < 20; slot++) {
    const d = CONFIG.GRID_LANES[slot % 2];
    const p = pointAt(gridS(slot) + CONFIG.CAR_LEN / 2 + 3, d);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    g.fillStyle = 'rgba(255,248,232,0.95)';
    g.fillRect(x, y - half, 2, half * 2);
    g.fillRect(x - 9, y - half, 9, 2);
    g.fillRect(x - 9, y + half - 2, 9, 2);
    g.fillStyle = 'rgba(255,248,232,0.85)';
    g.fillText(String(slot + 1), x + 4, y + 1);
  }
}

function drawPitRoad(g: CanvasRenderingContext2D): void {
  const len = PIT_X1 - PIT_X0;
  g.fillStyle = COL.pitSurface;
  g.fillRect(PIT_X0, PIT_BOX_TOP, len, PIT_WALL_TOP - PIT_BOX_TOP);

  g.fillStyle = COL.curbFace;
  g.fillRect(PIT_X0, PIT_LABEL_TOP, len, CURB_H);
  g.fillStyle = COL.curbTop;
  g.fillRect(PIT_X0, PIT_LABEL_TOP, len, 2);
  g.fillStyle = COL.ink;
  g.fillRect(PIT_X0, PIT_BOX_TOP - 1, len, 1);

  const top = PIT_BOX_TOP + 1;
  const bottom = PIT_LANE_TOP - 1;
  for (let i = 0; i < NUM_BOXES; i++) {
    const x0 = Math.round(boxX(i) - BOX_W / 2);
    const x1 = x0 + BOX_W;
    g.fillStyle = COL.box;
    g.fillRect(x0, top, 2, bottom - top);
    g.fillRect(x1 - 2, top, 2, bottom - top);
    for (let x = x0; x < x1; x += 9) g.fillRect(x, bottom - 2, 5, 2);
    const gr = g.createRadialGradient(x0 + BOX_W / 2, top + 4, 1, x0 + BOX_W / 2, top + 4, 26);
    gr.addColorStop(0, 'rgba(255,200,90,0.35)');
    gr.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = gr;
    g.fillRect(x0 - 10, top - 10, BOX_W + 20, 40);
  }

  g.fillStyle = COL.sep;
  g.fillRect(PIT_X0, PIT_WALL_TOP, len, SEP_BOTTOM - PIT_WALL_TOP);
  g.fillStyle = COL.sepTop;
  g.fillRect(PIT_X0, PIT_WALL_TOP, len, 2);
  for (let x = PIT_X0; x < PIT_X1; x += 24) g.fillRect(x, PIT_WALL_TOP + 2, 12, SEP_BOTTOM - PIT_WALL_TOP - 3);
  g.fillStyle = '#101010';
  g.fillRect(PIT_X0, SEP_BOTTOM - 1, len, 1);
}

const OUT_TOP = CY + R_OUT + 12;

const HELI = { x: 300, y: CY - 39, r: 24 };
const PYLON = { x: 1945, y: CY - 39 };
const palms: { x: number; y: number; s: number }[] = [];

function insideIsland(x: number, y: number, margin: number): boolean {
  const pts = islandOutline(0);
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return inside && best >= margin;
}

function drawPalm(g: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(x + 3, y + 2, 9 * s, 4 * s, 0, 0, Math.PI * 2);
  g.fill();
  const h = 12 * s;
  const lean = (rng() - 0.5) * 4;
  g.strokeStyle = '#6A4A2A';
  g.lineWidth = 2.2 * s;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + lean, y - h / 2, x + lean * 1.5, y - h);
  g.stroke();
  const cx = x + lean * 1.5;
  const cy = y - h;
  const leaves = 7;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rng() * 0.4;
    const len = (8 + rng() * 3) * s;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.6 + 2 * s;
    g.strokeStyle = i % 2 ? '#2E7A3A' : '#3E9A48';
    g.lineWidth = 2.4 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, cy + Math.sin(a) * len * 0.3 - 3 * s, ex, ey);
    g.stroke();
  }
  g.fillStyle = '#5A3A1A';
  g.beginPath();
  g.arc(cx, cy, 1.6 * s, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'butt';
}

function drawInfieldDecor(g: CanvasRenderingContext2D, rng: Rng): void {
  g.fillStyle = '#2E2C3A';
  g.beginPath();
  g.arc(HELI.x, HELI.y, HELI.r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#FFF8E8';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(HELI.x, HELI.y, HELI.r - 5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#FFF8E8';
  g.fillRect(HELI.x - 8, HELI.y - 9, 3, 18);
  g.fillRect(HELI.x + 5, HELI.y - 9, 3, 18);
  g.fillRect(HELI.x - 5, HELI.y - 1.5, 10, 3);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(PYLON.x - 10, PYLON.y + 2, 30, 6);
  g.fillStyle = '#3A3848';
  g.fillRect(PYLON.x - 12, PYLON.y - 2, 24, 6);
  palms.length = 0;
  const areas = [
    { x0: 120, x1: 420 },
    { x0: 1800, x1: 2120 },
  ];
  for (const a of areas) {
    let tries = 0;
    let placed = 0;
    while (placed < 11 && tries++ < 400) {
      const x = a.x0 + rng() * (a.x1 - a.x0);
      const y = CY - 77 + rng() * 95;
      if (!insideIsland(x, y, 14)) continue;
      if (Math.hypot(x - HELI.x, y - HELI.y) < HELI.r + 14) continue;
      if (Math.abs(x - PYLON.x) < 24 && y > PYLON.y - 60 && y < PYLON.y + 16) continue;
      if (palms.some((p) => Math.hypot(p.x - x, p.y - y) < 18)) continue;
      palms.push({ x, y, s: 0.85 + rng() * 0.35 });
      placed++;
    }
  }
  palms.sort((p, q) => p.y - q.y);
  for (const p of palms) drawPalm(g, p.x, p.y, p.s, rng);
}

function drawInfieldDecorLights(g: CanvasRenderingContext2D): void {
  g.globalCompositeOperation = 'lighter';
  for (const p of palms) {
    const gr = g.createRadialGradient(p.x, p.y - 6, 1, p.x, p.y - 6, 16);
    gr.addColorStop(0, 'rgba(255,200,110,0.22)');
    gr.addColorStop(1, 'rgba(255,200,110,0)');
    g.fillStyle = gr;
    g.fillRect(p.x - 16, p.y - 22, 32, 32);
  }
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = HELI.x + Math.cos(a) * HELI.r;
    const y = HELI.y + Math.sin(a) * HELI.r;
    g.save();
    g.fillStyle = k % 3 === 0 ? '#7FE3D9' : '#FFF4D0';
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 5;
    g.fillRect(x - 1, y - 1, 2, 2);
    g.restore();
  }
  const x = PYLON.x;
  const top = PYLON.y - 58;
  g.fillStyle = '#17142B';
  g.fillRect(x - 10, top, 20, 58);
  g.fillStyle = '#2A2838';
  g.fillRect(x - 10, top - 4, 20, 4);
  g.save();
  g.font = `7px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#FFC85A';
  g.shadowColor = '#FFC85A';
  g.shadowBlur = 5;
  g.fillText('P', x, top + 6);
  g.fillStyle = '#FFF8E8';
  g.shadowColor = '#FFF8E8';
  ['BEL', 'TAN', 'FER', 'CAL'].forEach((t, i) => g.fillText(t, x, top + 18 + i * 10));
  g.restore();
  g.save();
  g.fillStyle = '#E63B2E';
  g.shadowColor = '#E63B2E';
  g.shadowBlur = 6;
  g.fillRect(x - 1, top - 7, 2, 3);
  g.restore();
}

function drawPitRoadPaint(g: CanvasRenderingContext2D): void {
  const chevron = (x: number, y: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = 2;
    for (const o of [-6, 0, 6]) {
      g.beginPath();
      g.moveTo(x + o - 3, y - 5);
      g.lineTo(x + o + 2, y);
      g.lineTo(x + o - 3, y + 5);
      g.stroke();
    }
  };
  for (const x of [WALL_X0 + 40, PIT_X0 - 40]) chevron(x, PIT_ROAD_Y, 'rgba(255,200,90,0.8)');
  for (const x of [PIT_X1 + 40, WALL_X1 - 40]) chevron(x, PIT_ROAD_Y, 'rgba(127,227,217,0.8)');
  g.font = `10px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,248,232,0.7)';
  g.fillText('PIT', (WALL_X0 + PIT_X0) / 2, PIT_ROAD_Y + 1);
  g.fillText('PIT', (PIT_X1 + WALL_X1) / 2, PIT_ROAD_Y + 1);
  for (const [x0, x1] of [[WALL_X0, PIT_X0], [PIT_X1, WALL_X1]]) {
    g.fillStyle = COL.grass;
    g.fillRect(x0, PIT_WALL_TOP, x1 - x0, SEP_BOTTOM - PIT_WALL_TOP);
    g.strokeStyle = '#FFF8E8';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, PIT_WALL_TOP + 0.5, x1 - x0 - 1, SEP_BOTTOM - PIT_WALL_TOP - 1);
  }
}

function drawPitSigns(g: CanvasRenderingContext2D): void {
  const barrier = (x: number) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i % 2 ? '#17142B' : '#FFC21A';
      g.fillRect(x - 6 + i * 4, PIT_WALL_TOP, 4, SEP_BOTTOM - PIT_WALL_TOP);
    }
    g.save();
    g.shadowColor = '#FFC21A';
    g.shadowBlur = 8;
    g.fillStyle = '#FFC21A';
    g.fillRect(x - 7, PIT_WALL_TOP - 1, 2, SEP_BOTTOM - PIT_WALL_TOP + 2);
    g.restore();
  };
  barrier(WALL_X0 + 6);
  barrier(WALL_X1 - 6);
  const line = (x: number, label: string) => {
    g.save();
    g.fillStyle = '#FFC85A';
    g.shadowColor = '#FFC85A';
    g.shadowBlur = 5;
    g.fillRect(x, PIT_BOX_TOP + 1, 3, PIT_WALL_TOP - PIT_BOX_TOP - 2);
    g.restore();
    g.save();
    g.translate(x + 9, (PIT_BOX_TOP + PIT_WALL_TOP) / 2);
    g.rotate(-Math.PI / 2);
    g.font = `7px ${FONT_BLACK}`;
    g.fillStyle = 'rgba(255,200,90,0.9)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, 0);
    g.restore();
  };
  line(PIT_LINE_IN_X, 'PIT LANE');
  line(PIT_LINE_OUT_X, 'PIT EXIT');
  g.fillStyle = '#17142B';
  g.fillRect(PIT_X1 - 6, PIT_LANE_TOP + 9, 9, 17);
  g.save();
  g.fillStyle = '#3A1A1A';
  g.beginPath();
  g.arc(PIT_X1 - 1.5, PIT_LANE_TOP + 13.5, 2.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#52E252';
  g.shadowColor = '#52E252';
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(PIT_X1 - 1.5, PIT_LANE_TOP + 21, 2.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawPitLabels(g: CanvasRenderingContext2D): void {
  g.font = `9px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let k = 0;
  for (let x = PIT_X0 + 64; x < PIT_X1 - 30; x += 128, k++) {
    const color = k % 2 ? COL.labelAlt : COL.label;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 6;
    g.fillText(k % 2 ? 'PETROL RUSH' : 'PIT ROAD', x, PIT_LABEL_TOP + 8.5);
  }
  g.shadowBlur = 0;
}

const TEAMS = [
  { name: 'ROSSETTI', a: '#D8141E', b: '#FFD200', t: '#FFF8E8' },
  { name: 'RAGING BULL', a: '#1A2A6C', b: '#E8202A', t: '#FFD200' },
  { name: 'SILBERPFEIL', a: '#B8BCC4', b: '#00A19B', t: '#17142B' },
  { name: 'McLANE', a: '#FF8000', b: '#47C7FC', t: '#17142B' },
  { name: 'ASTRA VERDE', a: '#0B6B4A', b: '#C8F03C', t: '#FFF8E8' },
  { name: 'BLEU ALPIN', a: '#1E5BC6', b: '#F06EAA', t: '#FFF8E8' },
  { name: 'WILLISTON', a: '#0A2A6E', b: '#37BEDD', t: '#FFF8E8' },
  { name: 'HAASTEK', a: '#ECECEC', b: '#D8141E', t: '#17142B' },
  { name: 'HELVETIA GP', a: '#1F1F24', b: '#52E252', t: '#52E252' },
  { name: 'TORO JUNIOR', a: '#F4F4F8', b: '#1E3CA0', t: '#1E3CA0' },
];
const SKIN = ['#f0c098', '#e0a878', '#c88a5a', '#8a5a38'];

const STAND_X0 = FINISH_X - 215;
const STAND_X1 = FINISH_X + 215;
const STAND_TOP = CY - 77;
const ROOF_FRONT = CY - 39;
const PAD_TOP = CY - 89;
const UNIT_TOP = CY - 29;
const RC_TOP = CY - 61;
const RC_X0 = STAND_X1 + 15;
const RC_X1 = RC_X0 + 100;
const PAD_L0 = 440;
const PAD_R0 = RC_X1 + 18;
const UNIT_W = 72;
const UNIT_GAP = 3;

function unitXs(): number[] {
  const xs: number[] = [];
  for (let i = 0; i < 6; i++) xs.push(PAD_L0 + i * (UNIT_W + UNIT_GAP));
  for (let i = 0; i < 4; i++) xs.push(PAD_R0 + i * (UNIT_W + UNIT_GAP) + 4);
  return xs;
}

function drawCenter(g: CanvasRenderingContext2D, rng: Rng): void {
  g.fillStyle = '#4A4858';
  const padH = PIT_LABEL_TOP - PAD_TOP;
  g.fillRect(PAD_L0 - 8, PAD_TOP, 6 * (UNIT_W + UNIT_GAP) + 10, padH);
  g.fillRect(RC_X0 - 8, PAD_TOP, STANDS_X1 - RC_X0 + 6, padH);
  g.fillStyle = '#5A5868';
  for (let x = PAD_L0 - 8; x < PAD_L0 + 6 * (UNIT_W + UNIT_GAP); x += 24) g.fillRect(x, PAD_TOP, 1, padH);
  for (let x = RC_X0 - 8; x < STANDS_X1; x += 24) g.fillRect(x, PAD_TOP, 1, padH);

  const xs = unitXs();
  xs.forEach((x, i) => drawHauler3d(g, x + UNIT_W / 2, UNIT_TOP - 28, 0, TEAMS[i].a));
  xs.forEach((x, i) => {
    const tm = TEAMS[i];
    g.fillStyle = shade(tm.a, -0.35);
    g.fillRect(x, UNIT_TOP, UNIT_W, 14);
    g.fillStyle = shade(tm.a, -0.15);
    g.fillRect(x, UNIT_TOP, UNIT_W, 2);
    g.fillStyle = tm.a;
    g.fillRect(x, UNIT_TOP + 14, UNIT_W, 38);
    g.fillStyle = tm.b;
    g.fillRect(x, UNIT_TOP + 14, UNIT_W, 3);
    g.fillStyle = COL.ink;
    g.fillRect(x, UNIT_TOP + 51, UNIT_W, 1);
    g.fillRect(x, UNIT_TOP, 1, 52);
    g.fillRect(x + UNIT_W - 1, UNIT_TOP, 1, 52);
    g.fillStyle = '#1A1822';
    g.fillRect(x + 8, UNIT_TOP + 32, UNIT_W - 16, 19);
  });

  g.fillStyle = '#5E5C70';
  g.fillRect(RC_X0, RC_TOP, RC_X1 - RC_X0, 24);
  g.fillStyle = '#6E6C80';
  g.fillRect(RC_X0, RC_TOP, RC_X1 - RC_X0, 2);
  g.fillStyle = '#3A3848';
  g.fillRect(RC_X0, RC_TOP + 24, RC_X1 - RC_X0, 62);
  g.fillStyle = COL.ink;
  g.fillRect(RC_X0, RC_TOP + 85, RC_X1 - RC_X0, 1);
  g.fillRect(RC_X0, RC_TOP, 1, 86);
  g.fillRect(RC_X1 - 1, RC_TOP, 1, 86);
  g.fillStyle = '#26242F';
  g.fillRect(RC_X0 + 40, RC_TOP - 20, 3, 20);
  g.fillRect(RC_X0 + 30, RC_TOP - 16, 22, 2);
  g.fillStyle = '#1A1822';
  for (let f = 0; f < 3; f++) for (let w = 0; w < 8; w++) g.fillRect(RC_X0 + 6 + w * 11.5, RC_TOP + 40 + f * 15, 8, 9);
  g.fillRect(RC_X0 + 4, RC_TOP + 27, RC_X1 - RC_X0 - 8, 9);

  for (let y = STAND_TOP; y < STANDS_BOTTOM; y++) {
    for (let x = STAND_X0; x < STAND_X1; x++) {
      g.fillStyle = (x + y) & 1 ? '#4A4A5A' : '#3E3E4C';
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#26242F';
  for (let y = STAND_TOP + 6; y < STANDS_BOTTOM; y += 6) g.fillRect(STAND_X0, y, STAND_X1 - STAND_X0, 1);

  const SECT = 6;
  const sw = (STAND_X1 - STAND_X0) / SECT;
  const sectorTeam = [0, 3, 1, 2, 4, 5];
  for (let y = ROOF_FRONT + 2; y < STANDS_BOTTOM - 6; y += 6) {
    for (let x = STAND_X0 + 2; x < STAND_X1 - 5; x += 5) {
      const sec = Math.min(SECT - 1, ((x - STAND_X0) / sw) | 0);
      if ((x - STAND_X0) % sw < 6) continue;
      if (rng() < 0.08) continue;
      const tm = TEAMS[sectorTeam[sec]];
      const shirt = rng() < 0.75 ? (rng() < 0.7 ? tm.a : tm.b) : ['#FFF8E8', '#8A86A0', '#2633C5'][(rng() * 3) | 0];
      const skin = SKIN[(rng() * SKIN.length) | 0];
      g.fillStyle = shade(shirt, -0.4);
      g.fillRect(x - 1, y + 2, 5, 4);
      g.fillStyle = shirt;
      g.fillRect(x - 1, y + 2, 4, 3);
      g.fillStyle = skin;
      g.fillRect(x, y, 2, 2);
      if (rng() < 0.07) {
        g.fillStyle = '#C9CCD6';
        g.fillRect(x + 3, y - 5, 1, 7);
        g.fillStyle = tm.a;
        g.fillRect(x + 4, y - 5, 5, 2);
        g.fillStyle = tm.b;
        g.fillRect(x + 4, y - 3, 5, 2);
      }
    }
  }
  g.fillStyle = '#5A5868';
  for (let s = 1; s < SECT; s++) g.fillRect(STAND_X0 + s * sw, ROOF_FRONT, 4, STANDS_BOTTOM - ROOF_FRONT);

  g.fillStyle = '#2A2838';
  g.fillRect(STAND_X0 - 6, STAND_TOP - 4, STAND_X1 - STAND_X0 + 12, ROOF_FRONT - STAND_TOP + 4);
  g.fillStyle = '#34324A';
  for (let x = STAND_X0 - 6; x < STAND_X1 + 6; x += 4) g.fillRect(x, STAND_TOP - 4, 1, ROOF_FRONT - STAND_TOP + 4);
  g.fillStyle = '#2633C5';
  g.fillRect(STAND_X0 - 6, ROOF_FRONT - 7, STAND_X1 - STAND_X0 + 12, 8);
  g.fillStyle = COL.ink;
  g.fillRect(STAND_X0 - 6, ROOF_FRONT + 1, STAND_X1 - STAND_X0 + 12, 1);
  g.fillStyle = '#26242F';
  for (let x = STAND_X0 + 30; x < STAND_X1; x += 72) g.fillRect(x, ROOF_FRONT + 1, 2, 22);
  g.fillStyle = '#C9CCD6';
  g.fillRect(STAND_X0, STANDS_BOTTOM - 2, STAND_X1 - STAND_X0, 1);
}

function drawCenterLights(g: CanvasRenderingContext2D, rng: Rng): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `7px ${FONT_BLACK}`;
  g.fillStyle = '#FFC85A';
  g.shadowColor = '#FFC85A';
  g.shadowBlur = 5;
  g.fillText('PETROL RUSH  ·  MAIN GRANDSTAND', (STAND_X0 + STAND_X1) / 2, ROOF_FRONT - 3);
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'lighter';
  for (let x = STAND_X0 + 20; x < STAND_X1; x += 40) {
    const gr = g.createRadialGradient(x, ROOF_FRONT + 4, 1, x, ROOF_FRONT + 12, 34);
    gr.addColorStop(0, 'rgba(255,230,170,0.35)');
    gr.addColorStop(1, 'rgba(255,230,170,0)');
    g.fillStyle = gr;
    g.fillRect(x - 34, ROOF_FRONT, 68, 50);
  }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#FFF4D0';
  for (let x = STAND_X0 + 4; x < STAND_X1; x += 8) g.fillRect(x, ROOF_FRONT + 1, 2, 1);
  for (let i = 0; i < 160; i++) {
    const x = STAND_X0 + 4 + rng() * (STAND_X1 - STAND_X0 - 8);
    const y = ROOF_FRONT + 4 + rng() * (STANDS_BOTTOM - ROOF_FRONT - 10);
    const color = ['#FFFFFF', '#7FE3D9', '#FFC85A', '#FFFFFF'][(rng() * 4) | 0];
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 3;
    g.fillRect(x | 0, y | 0, 1, 2);
  }
  g.shadowBlur = 0;

  for (let f = 0; f < 3; f++) {
    for (let w = 0; w < 8; w++) {
      if (rng() < 0.25) continue;
      g.fillStyle = rng() < 0.7 ? '#FFE8A0' : '#BFEFFF';
      g.fillRect(RC_X0 + 6 + w * 11.5, RC_TOP + 40 + f * 15, 8, 9);
    }
  }
  g.fillStyle = '#7FE3D9';
  g.shadowColor = '#12B5A6';
  g.shadowBlur = 8;
  g.fillRect(RC_X0 + 4, RC_TOP + 27, RC_X1 - RC_X0 - 8, 9);
  g.shadowBlur = 0;
  g.fillStyle = COL.ink;
  for (let x = RC_X0 + 14; x < RC_X1 - 6; x += 12) g.fillRect(x, RC_TOP + 27, 1, 9);
  g.font = `8px ${FONT_BLACK}`;
  g.fillStyle = '#FFF8E8';
  g.shadowColor = '#FFF8E8';
  g.shadowBlur = 5;
  g.fillText('RACE CONTROL', (RC_X0 + RC_X1) / 2, RC_TOP + 12);
  g.fillStyle = '#E63B2E';
  g.shadowColor = '#E63B2E';
  g.shadowBlur = 6;
  g.fillRect(RC_X0 + 40, RC_TOP - 22, 3, 3);
  g.shadowBlur = 0;

  unitXs().forEach((x, i) => {
    const tm = TEAMS[i];
    const gr = g.createLinearGradient(0, UNIT_TOP + 32, 0, UNIT_TOP + 51);
    gr.addColorStop(0, '#FFE6A8');
    gr.addColorStop(1, '#C88A3A');
    g.fillStyle = gr;
    g.fillRect(x + 8, UNIT_TOP + 32, UNIT_W - 16, 19);
    g.fillStyle = '#3A3848';
    g.fillRect(x + 14, UNIT_TOP + 43, UNIT_W - 28, 6);
    g.fillStyle = tm.b;
    g.fillRect(x + 16, UNIT_TOP + 41, UNIT_W - 32, 2);
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(x + UNIT_W / 2, UNIT_TOP + 52, 2, x + UNIT_W / 2, UNIT_TOP + 54, 36);
    gl.addColorStop(0, 'rgba(255,220,150,0.4)');
    gl.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gl;
    g.fillRect(x - 10, UNIT_TOP + 40, UNIT_W + 20, 20);
    g.globalCompositeOperation = 'source-over';
    g.font = `7px ${FONT_BLACK}`;
    g.fillStyle = tm.t;
    g.shadowColor = tm.b;
    g.shadowBlur = 4;
    g.fillText(tm.name, x + UNIT_W / 2, UNIT_TOP + 24);
    g.shadowBlur = 0;
  });
}

function drawFinishLine(g: CanvasRenderingContext2D): void {
  const top = CY + R_IN;
  const h = R_OUT - R_IN;
  for (let y = top; y < top + h; y += 5) {
    for (let c = 0; c < 3; c++) {
      g.fillStyle = ((y - top) / 5 + c) % 2 < 1 ? '#FFF8E8' : '#17142B';
      g.fillRect(FINISH_X - 7 + c * 5, y, 5, 5);
    }
  }
}

function drawLitFinish(g: CanvasRenderingContext2D): void {
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(FINISH_X, CY + RC, 4, FINISH_X, CY + RC, 70);
  gr.addColorStop(0, 'rgba(255,240,200,0.35)');
  gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr;
  g.fillRect(FINISH_X - 70, CY + RC - 70, 140, 140);
  g.globalCompositeOperation = 'source-over';
  g.shadowColor = 'rgba(255,248,232,0.8)';
  g.shadowBlur = 8;
  drawFinishLine(g);
  g.shadowBlur = 0;
  drawFinishLine(g);
}

function nightLighting(g: CanvasRenderingContext2D, rng: Rng): void {
  const H = CONFIG.PLAY_H;
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#6e6ea0';
  g.fillRect(0, 0, WORLD_W, H);
  g.globalCompositeOperation = 'lighter';
  const pool = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, `rgba(255,200,110,${a})`);
    gr.addColorStop(0.6, `rgba(255,170,60,${a * 0.35})`);
    gr.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  for (let x = CX_L; x <= CX_R; x += 200) {
    pool(x, CY - RC, 90, 0.32);
    pool(x + 100, CY + RC, 90, 0.32);
  }
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) pool(cx + s * Math.cos(a) * RC, CY + Math.sin(a) * RC, 80, 0.28);
  }
  for (const x of [560, 700, 840, 990, 1120, 1250, 1400, 1540, 1680]) pool(x, CY - 14, 80, 0.2);
  g.globalCompositeOperation = 'source-over';
  const mast = (x: number, y: number) => {
    g.fillStyle = '#26242F';
    g.fillRect(x - 1, y - 6, 3, 8);
    g.fillStyle = '#FFF4D0';
    g.shadowColor = '#FFD27A';
    g.shadowBlur = 10;
    g.fillRect(x - 3, y - 8, 7, 3);
    g.shadowBlur = 0;
  };
  for (let x = CX_L; x <= CX_R; x += 200) {
    mast(x, CY - R_OUT - 2);
    mast(x + 100, CY + R_OUT + 14);
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * WORLD_W;
    const y = rng() * H;
    const inside = Math.abs(y - CY) < R_OUT + 14 && x > CX_L - R_OUT - 14 && x < CX_R + R_OUT + 14;
    if (inside) continue;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x, y, 1, 1);
  }
}

function addNoise(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % w;
    const py = (i / 4 / w) | 0;
    if (px >= STAND_X0 && px < STAND_X1 && py >= STAND_TOP - 8 && py < STANDS_BOTTOM) continue;
    const n = (rng() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}
