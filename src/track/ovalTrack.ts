import { CONFIG } from '../config';
import type { Corner, Frenet, Track } from './common';
import {
  CX_L,
  CX_R,
  CY,
  constrainPos,
  deltaS,
  pointAt,
  project,
  S_TURN1,
  S_TURN2,
  SECTOR_LEN,
  TRACK_LEN,
  trackHeadingAt,
  WORLD_W,
  wrapS,
} from './oval';
import { OVAL_PIT } from './ovalPit';

const LEFT_TURN: Corner = { cx: CX_L, cy: CY, dir: -1 };
const RIGHT_TURN: Corner = { cx: CX_R, cy: CY, dir: -1 };

export function gridS(slot: number): number {
  return CONFIG.GRID_FRONT_S - CONFIG.CAR_LEN / 2 - slot * CONFIG.GRID_SPACING;
}

/** The original night oval: two straights and two 180° turns, pit lane on the infield. */
export const OVAL: Track = {
  id: 'oval',
  name: 'NIGHT OVAL',
  len: TRACK_LEN,
  sectorLen: SECTOR_LEN,
  worldW: WORLD_W,
  worldH: CONFIG.PLAY_H,
  pit: OVAL_PIT,
  wrapS,
  deltaS,
  pointAt,
  project,
  headingAt: trackHeadingAt,
  cornerAt(x: number): Corner | null {
    if (x < CX_L) return LEFT_TURN;
    if (x > CX_R) return RIGHT_TURN;
    return null;
  },
  distToCorner(s: number): number {
    return Math.min(wrapS(S_TURN1 - s), wrapS(S_TURN2 - s));
  },
  constrain: constrainPos,
  gridSlot(slot: number): Frenet {
    return { s: gridS(slot), d: CONFIG.GRID_LANES[slot % 2]! };
  },
};
