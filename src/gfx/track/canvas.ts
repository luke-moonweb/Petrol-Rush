import { CONFIG } from '../../config';
import { gridS } from '../../race/race';
import { createRng, type Rng } from '../../sim/rng';
import { CURB_H, CX_L, CX_R, CY, FINISH_X, islandOutline, pointAt, R_IN, R_OUT, RC, STANDS_BOTTOM, WORLD_W } from '../../track/track';
import { makeCanvas } from '../sprites';
import { drawInfieldDecor, drawInfieldDecorLights } from './infield';
import { drawCenter, drawCenterLights, STAND_TOP, STAND_X0, STAND_X1 } from './paddock';
import { drawPitLabels, drawPitRoad, drawPitRoadPaint, drawPitSigns } from './pit';
import { COL, FONT_BLACK } from './style';

const OUT_TOP = CY + R_OUT + 12;

function infieldPath(g: CanvasRenderingContext2D, dy: number): void {
  g.beginPath();
  islandOutline(dy).forEach(([x, y], k) => {
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
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
    const d = CONFIG.GRID_LANES[slot % 2]!;
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
  for (const cx of [CX_L, CX_R]) {
    const s = cx === CX_R ? 1 : -1;
    for (let a = -1.2; a <= 1.21; a += 0.6) mast(cx + s * Math.cos(a) * (R_OUT + 14), CY + Math.sin(a) * (R_OUT + 14));
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
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
}
