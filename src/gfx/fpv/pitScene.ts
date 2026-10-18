import { PIT_D } from '../../track/straightPit';
import type { PitPaint } from '../track/oval/pit';
import { COL, FONT_BLACK } from '../track/style';
import { hexRgb, makePoly } from './engine';
import { groundQuad, rect, upright, wall } from './geom';
import { box, ground, label, night, type Parts } from './kit';
import { lazyCanvas, texQuad } from './texture';

// The pit lane in 3D: boxes, lines, the pit wall, the exit light and the PIT ROAD signs. Every track
// shares the oval's cross-section (PIT_D from the main straight's centre line); only x differs.

export interface PitScene extends PitPaint {
  /** y of the main straight's centre line, which the cross-section is measured from. */
  y0: number;
  /** Height of the kerb behind the boxes; the PIT ROAD signs hang on it. */
  curbH: number;
  /** Chevrons on the entry and exit roads. */
  arrows: readonly { x: number; y: number; color: string }[];
}

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

/** The top of the label kerb and the pit wall. */
function pitBase(P: Parts, pit: PitScene): void {
  const y = (d: number) => pit.y0 + d;
  P.island.push(ground(rect(pit.x0 + 10, y(PIT_D.LABEL_TOP), pit.x1 - 10, y(PIT_D.BOX_TOP), pit.curbH + 0.04), night(COL.curbFace, 1.4)));
  box(P.solids, pit.wallX0, y(PIT_D.WALL_TOP), pit.wallX1, y(PIT_D.SEP), 0, 7, night(COL.sep, 1.8), night(COL.sepTop));
}

function pitBoxes(P: Parts, pit: PitScene): void {
  const boxLine = hexRgb(COL.box);
  for (let i = 0; i < pit.numBoxes; i++) {
    const x0 = pit.boxX(i) - pit.boxW / 2;
    const x1 = x0 + pit.boxW;
    const top = pit.y0 + PIT_D.BOX_TOP + 1;
    const bottom = pit.y0 + PIT_D.LANE_TOP - 1;
    P.decals.push(makePoly(rect(x0, top, x0 + 1.5, bottom, 0.03), boxLine));
    P.decals.push(makePoly(rect(x1 - 1.5, top, x1, bottom, 0.03), boxLine));
    P.decals.push(makePoly(rect(x0, top, x1, top + 1.5, 0.03), boxLine));
    for (let x = x0; x < x1; x += 9) P.decals.push(makePoly(rect(x, bottom - 2, Math.min(x1, x + 5), bottom, 0.03), boxLine));
  }
}

/** The PIT LANE and PIT EXIT lines, the exit light and the chevrons. */
function pitLines(P: Parts, pit: PitScene): void {
  const boxTop = pit.y0 + PIT_D.BOX_TOP;
  const wallTop = pit.y0 + PIT_D.WALL_TOP;
  const lineCol = hexRgb('#FFC85A');
  for (const [x, text] of [
    [pit.lineInX, 'PIT LANE'],
    [pit.lineOutX, 'PIT EXIT'],
  ] as const) {
    P.decals.push(makePoly(rect(x, boxTop + 1, x + 3, wallTop - 1, 0.03), lineCol));
    const mid = (boxTop + wallTop) / 2;
    P.groundSigns.push(
      texQuad(groundQuad(x + 12, mid, 12, wallTop - boxTop - 6, 1, 0, 0.04), label(128, 64, text, null, 'rgba(255,200,90,0.9)', 20), {
        far: 400,
      }),
    );
  }
  const lightX = pit.x1 - 1.5;
  const lightY = pit.y0 + PIT_D.LANE_TOP + 17;
  for (const [x0, y0, x1, y1] of [
    [lightX - 1, lightY - 1, lightX + 1, lightY - 1],
    [lightX + 1, lightY - 1, lightX + 1, lightY + 1],
    [lightX + 1, lightY + 1, lightX - 1, lightY + 1],
    [lightX - 1, lightY + 1, lightX - 1, lightY - 1],
  ] as const) {
    P.solids.push(makePoly(wall(x0, y0, x1, y1, 0, 16), hexRgb('#17142B')));
  }
  P.solids.push(makePoly(wall(lightX - 1.2, lightY - 1.2, lightX - 1.2, lightY + 1.2, 12, 15), hexRgb('#52E252'), true));
  P.glows.push({ x: lightX - 1.5, y: lightY, z: 13.5, r: 5, color: '82,226,82' });

  for (const a of pit.arrows) {
    P.groundSigns.push(texQuad(groundQuad(a.x, a.y, 36, 24, 1, 0, 0.04), pitArrow(a.color), { rows: 2, far: 450 }));
  }
}

/** PIT ROAD / PETROL RUSH along the kerb behind the boxes. */
function pitSigns(P: Parts, pit: PitScene): void {
  const y = pit.y0 + PIT_D.BOX_TOP + 0.4;
  let k = 0;
  for (let x = pit.x0 + 64; x < pit.x1 - 30; x += 128, k++) {
    const text = k % 2 ? 'PETROL RUSH' : 'PIT ROAD';
    const color = k % 2 ? COL.labelAlt : COL.label;
    P.signs.push(texQuad(upright(x - 52, y, x + 52, y, 0.4, pit.curbH - 0.4), label(320, 16, text, COL.curbFace, color, 13), { far: 600 }));
  }
}

export function pitScene(P: Parts, pit: PitScene): void {
  pitBase(P, pit);
  pitBoxes(P, pit);
  pitLines(P, pit);
  pitSigns(P, pit);
}
