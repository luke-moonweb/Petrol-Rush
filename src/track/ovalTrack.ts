import { CONFIG } from '../config';
import type { Frenet, Track } from './common';
import {
  constrainPos,
  curvatureAt,
  deltaS,
  pointAt,
  project,
  SECTOR_LEN,
  TRACK_LEN,
  trackCurves,
  trackHeadingAt,
  WORLD_W,
  wrapS,
} from './oval';
import { OVAL_PIT } from './ovalPit';

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
  constrain: constrainPos,
  curvatureAt,
  curves: trackCurves,
  gridSlot(slot: number): Frenet {
    return { s: gridS(slot), d: CONFIG.GRID_LANES[slot % 2]! };
  },
};
