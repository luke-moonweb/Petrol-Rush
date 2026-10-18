import { CONFIG } from '../../config';
import type { Track } from '../../track/common';
import { hexRgb, makePoly } from './engine';
import { groundQuad, rect } from './geom';
import { label, type Parts } from './kit';
import { texQuad } from './texture';

// The track itself in 3D, laid along any Track's centre line.

const digits = new Map<number, () => HTMLCanvasElement>();
function gridNumber(n: number): () => HTMLCanvasElement {
  let t = digits.get(n);
  if (!t) {
    t = label(32, 24, String(n), null, 'rgba(255,248,232,0.7)', 16, undefined, false);
    digits.set(n, t);
  }
  return t;
}

/** The starting grid: a bracket and the number in front of every slot. */
export function gridMarks(P: Parts, track: Track): void {
  const white = hexRgb('#FFF8E8');
  for (let slot = 0; slot < 20; slot++) {
    const q = track.gridSlot(slot);
    const p = track.pointAt(q.s + CONFIG.CAR_LEN / 2 + 3, q.d);
    P.decals.push(makePoly(rect(p.x, p.y - 11, p.x + 2, p.y + 11, 0.03), white));
    P.decals.push(makePoly(rect(p.x - 9, p.y - 11, p.x, p.y - 9, 0.03), white));
    P.decals.push(makePoly(rect(p.x - 9, p.y + 9, p.x, p.y + 11, 0.03), white));
    P.groundSigns.push(texQuad(groundQuad(p.x + 10, p.y, 12, 16, 1, 0, 0.04), gridNumber(slot + 1), { far: 350 }));
  }
}
