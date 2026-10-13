import { SegmentTrack, type TrackDef } from './segment';

// Grand Prix circuits. Every corner is taken at the usual 150 mph, so the circuits differ in
// shape and rhythm: corner count, direction changes, chicanes and the length of the straights.
// Corner 0 → corner 1 is always the main straight (running east, pit lane to the north).

export const GP_DEFS: readonly TrackDef[] = [
  {
    // Clockwise triangle: one long straight and three long sweepers. The gentle opener.
    id: 'harbour',
    name: 'HARBOUR LOOP',
    corners: [
      [300, 300, 150],
      [2850, 300, 200],
      [1580, 1500, 160],
    ],
    finish: 0.55,
  },
  {
    // Anticlockwise heart: a right-hand hairpin dips into the infield of a left-handed lap.
    id: 'desert',
    name: 'DESERT HEART',
    corners: [
      [300, 1500, 130],
      [2300, 1500, 160],
      [2300, 350, 200],
      [1700, 350, 140],
      [1300, 800, 120],
      [900, 350, 140],
      [300, 350, 170],
    ],
    finish: 0.55,
  },
  {
    // Clockwise L-shaped street circuit: right-angle corners, one left-hander and a chicane.
    id: 'city',
    name: 'NEON CITY',
    corners: [
      [300, 300, 140],
      [2400, 300, 150],
      [2400, 1000, 130],
      [1500, 1000, 120],
      [1500, 1600, 130],
      [300, 1600, 140],
      [300, 1100, 120],
      [396, 985, 120],
      [300, 870, 120],
    ],
    finish: 0.55,
  },
  {
    // Anticlockwise and twisty: esses up the east side, a winding back section through the trees.
    id: 'forest',
    name: 'PINE FOREST',
    corners: [
      [300, 1550, 140],
      [2350, 1550, 160],
      [2350, 1150, 200],
      [2050, 900, 160],
      [2250, 600, 180],
      [2000, 300, 150],
      [1350, 300, 150],
      [1150, 500, 150],
      [1150, 850, 140],
      [850, 1050, 140],
      [500, 850, 160],
      [300, 1050, 140],
    ],
    finish: 0.55,
  },
  {
    // Clockwise finale with everything: a kink, a chicane, a switchback and a double right.
    id: 'finale',
    name: 'GRAND FINALE',
    corners: [
      [300, 300, 150],
      [2400, 300, 140],
      [2400, 700, 200],
      [2250, 950, 170],
      [2400, 1200, 200],
      [2400, 1650, 140],
      [1750, 1650, 120],
      [1610, 1530, 120],
      [1470, 1650, 120],
      [900, 1650, 120],
      [900, 1250, 120],
      [1300, 1250, 130],
      [1300, 800, 130],
      [300, 800, 140],
    ],
    finish: 0.55,
  },
];

let built: SegmentTrack[] | null = null;

export function gpTracks(): SegmentTrack[] {
  if (!built) built = GP_DEFS.map((d) => new SegmentTrack(d));
  return built;
}
