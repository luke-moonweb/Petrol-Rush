import type { Rng } from '../../../sim/rng';
import { CURB_H, CY, FINISH_X, PIT_LABEL_TOP, RC, STANDS_BOTTOM, STANDS_X1 } from '../../../track/oval';
import { shade } from '../../sprites';
import { drawHauler3d } from '../../vehicles';
import { COL, FONT_BLACK } from '../style';

export const TEAMS = [
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

/** Finish line on the main straight's centre line: the paddock is laid out relative to it. */
export const PADDOCK_ORIGIN = { x: FINISH_X, y: CY + RC };

export const STAND_X0 = FINISH_X - 215;
export const STAND_X1 = FINISH_X + 215;
export const STAND_TOP = CY - 77;
const ROOF_FRONT = CY - 39;
export const PAD_TOP = CY - 89;
export const UNIT_TOP = CY - 29;
export const RC_TOP = CY - 61;
export const RC_X0 = STAND_X1 + 15;
export const RC_X1 = RC_X0 + 100;
export const PAD_L0 = 440;
const PAD_R0 = RC_X1 + 18;
export const UNIT_W = 72;
export const UNIT_GAP = 3;
/** Back edge of the paddock tarmac (the pit road's label kerb starts here). */
export const PAD_BOTTOM = PIT_LABEL_TOP;
/** Front of the grandstand's lowest tier, and of race control. */
export const STAND_FRONT = STANDS_BOTTOM - CURB_H;
export const RC_FRONT = CY + 25;
/** The row of light pools in front of the garages and the grandstand. */
export const POOL_ROW_Y = CY - 14;

export function unitXs(): number[] {
  const xs: number[] = [];
  for (let i = 0; i < 6; i++) xs.push(PAD_L0 + i * (UNIT_W + UNIT_GAP));
  for (let i = 0; i < 4; i++) xs.push(PAD_R0 + i * (UNIT_W + UNIT_GAP) + 4);
  return xs;
}

export function drawCenter(g: CanvasRenderingContext2D, rng: Rng): void {
  g.fillStyle = '#4A4858';
  const padH = PIT_LABEL_TOP - PAD_TOP;
  g.fillRect(PAD_L0 - 8, PAD_TOP, 6 * (UNIT_W + UNIT_GAP) + 10, padH);
  g.fillRect(RC_X0 - 8, PAD_TOP, STANDS_X1 - RC_X0 + 6, padH);
  g.fillStyle = '#5A5868';
  for (let x = PAD_L0 - 8; x < PAD_L0 + 6 * (UNIT_W + UNIT_GAP); x += 24) g.fillRect(x, PAD_TOP, 1, padH);
  for (let x = RC_X0 - 8; x < STANDS_X1; x += 24) g.fillRect(x, PAD_TOP, 1, padH);

  const xs = unitXs();
  xs.forEach((x, i) => {
    drawHauler3d(g, x + UNIT_W / 2, UNIT_TOP - 28, 0, TEAMS[i]!.a);
  });
  xs.forEach((x, i) => {
    const tm = TEAMS[i]!;
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
      const tm = TEAMS[sectorTeam[sec]!]!;
      const shirt = rng() < 0.75 ? (rng() < 0.7 ? tm.a : tm.b) : ['#FFF8E8', '#8A86A0', '#2633C5'][(rng() * 3) | 0]!;
      const skin = SKIN[(rng() * SKIN.length) | 0]!;
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

export function drawCenterLights(g: CanvasRenderingContext2D, rng: Rng): void {
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
    const color = ['#FFFFFF', '#7FE3D9', '#FFC85A', '#FFFFFF'][(rng() * 4) | 0]!;
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
    const tm = TEAMS[i]!;
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
