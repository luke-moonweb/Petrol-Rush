import {
  BOX_W,
  boxX,
  CURB_H,
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
  SEP_BOTTOM,
  WALL_X0,
  WALL_X1,
} from '../../../track/oval';
import { COL, FONT_BLACK } from '../style';

/** Where the pit road is painted along x; the y profile is always the oval's. */
export interface PitPaint {
  x0: number;
  x1: number;
  numBoxes: number;
  boxX(i: number): number;
  boxW: number;
  wallX0: number;
  wallX1: number;
  lineInX: number;
  lineOutX: number;
}

export const OVAL_PIT_PAINT: PitPaint = {
  x0: PIT_X0,
  x1: PIT_X1,
  numBoxes: NUM_BOXES,
  boxX,
  boxW: BOX_W,
  wallX0: WALL_X0,
  wallX1: WALL_X1,
  lineInX: PIT_LINE_IN_X,
  lineOutX: PIT_LINE_OUT_X,
};

export function drawPitRoad(g: CanvasRenderingContext2D, L: PitPaint = OVAL_PIT_PAINT): void {
  const len = L.x1 - L.x0;
  g.fillStyle = COL.pitSurface;
  g.fillRect(L.x0, PIT_BOX_TOP, len, PIT_WALL_TOP - PIT_BOX_TOP);

  g.fillStyle = COL.curbFace;
  g.fillRect(L.x0, PIT_LABEL_TOP, len, CURB_H);
  g.fillStyle = COL.curbTop;
  g.fillRect(L.x0, PIT_LABEL_TOP, len, 2);
  g.fillStyle = COL.ink;
  g.fillRect(L.x0, PIT_BOX_TOP - 1, len, 1);

  const top = PIT_BOX_TOP + 1;
  const bottom = PIT_LANE_TOP - 1;
  for (let i = 0; i < L.numBoxes; i++) {
    const x0 = Math.round(L.boxX(i) - L.boxW / 2);
    const x1 = x0 + L.boxW;
    g.fillStyle = COL.box;
    g.fillRect(x0, top, 2, bottom - top);
    g.fillRect(x1 - 2, top, 2, bottom - top);
    for (let x = x0; x < x1; x += 9) g.fillRect(x, bottom - 2, 5, 2);
    const gr = g.createRadialGradient(x0 + L.boxW / 2, top + 4, 1, x0 + L.boxW / 2, top + 4, 26);
    gr.addColorStop(0, 'rgba(255,200,90,0.35)');
    gr.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = gr;
    g.fillRect(x0 - 10, top - 10, L.boxW + 20, 40);
  }

  g.fillStyle = COL.sep;
  g.fillRect(L.x0, PIT_WALL_TOP, len, SEP_BOTTOM - PIT_WALL_TOP);
  g.fillStyle = COL.sepTop;
  g.fillRect(L.x0, PIT_WALL_TOP, len, 2);
  for (let x = L.x0; x < L.x1; x += 24) g.fillRect(x, PIT_WALL_TOP + 2, 12, SEP_BOTTOM - PIT_WALL_TOP - 3);
  g.fillStyle = '#101010';
  g.fillRect(L.x0, SEP_BOTTOM - 1, len, 1);
}

export function drawPitRoadPaint(g: CanvasRenderingContext2D): void {
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
  for (const [x0, x1] of [
    [WALL_X0, PIT_X0],
    [PIT_X1, WALL_X1],
  ] as const) {
    g.fillStyle = COL.grass;
    g.fillRect(x0, PIT_WALL_TOP, x1 - x0, SEP_BOTTOM - PIT_WALL_TOP);
    g.strokeStyle = '#FFF8E8';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, PIT_WALL_TOP + 0.5, x1 - x0 - 1, SEP_BOTTOM - PIT_WALL_TOP - 1);
  }
}

export function drawPitSigns(g: CanvasRenderingContext2D, L: PitPaint = OVAL_PIT_PAINT): void {
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
  barrier(L.wallX0 + 6);
  barrier(L.wallX1 - 6);
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
  line(L.lineInX, 'PIT LANE');
  line(L.lineOutX, 'PIT EXIT');
  g.fillStyle = '#17142B';
  g.fillRect(L.x1 - 6, PIT_LANE_TOP + 9, 9, 17);
  g.save();
  g.fillStyle = '#3A1A1A';
  g.beginPath();
  g.arc(L.x1 - 1.5, PIT_LANE_TOP + 13.5, 2.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#52E252';
  g.shadowColor = '#52E252';
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(L.x1 - 1.5, PIT_LANE_TOP + 21, 2.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawPitLabels(g: CanvasRenderingContext2D, L: PitPaint = OVAL_PIT_PAINT): void {
  g.font = `9px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let k = 0;
  for (let x = L.x0 + 64; x < L.x1 - 30; x += 128, k++) {
    const color = k % 2 ? COL.labelAlt : COL.label;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 6;
    g.fillText(k % 2 ? 'PETROL RUSH' : 'PIT ROAD', x, PIT_LABEL_TOP + 8.5);
  }
  g.shadowBlur = 0;
}
