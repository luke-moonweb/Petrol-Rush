import { HALF_W } from '../../track/common';
import type { SegmentTrack } from '../../track/segment';
import { NOSE, PIT_D, SEP_MID } from '../../track/straightPit';
import { circuitGround, circuitPropSpots, circuitTheme, inSideOf, pitPaint, pitRange, SHOULDER_W, WALL_W } from '../track/circuit/canvas';
import type { CircuitTheme } from '../track/circuit/theme';
import { PADDOCK_ORIGIN } from '../track/oval/paddock';
import { COL } from '../track/style';
import { makePoly, type RGB, rgbStyle } from './engine';
import { type P3, rect, wall } from './geom';
import { ground, night, type Parts, pieces } from './kit';
import { props } from './props';
import { band, edgeD } from './ribbon';
import { NIGHT_CITY } from './sky';
import type { SceneSpec } from './spec';

// The scene of any Grand Prix circuit (SegmentTrack), read the way the top-down canvas
// (circuit/canvas.ts) draws it: walls outside, a kerb wall on the infield side, the pit lane with its
// entry and exit roads north of the main straight, the oval's paddock moved behind it on a raised
// platform, and the theme's colours and props.

/** Height of the platform the paddock stands on (the oval's island height). */
const PAD_H = 6;
const TILE = 40;
const PAVE_STEP = 24;
const SHOULDER_STEP = 32;
const PIT_PIECE = 120;

/** The ground in coarse tiles of the theme's colours, merged into runs along each row. */
function tiles(P: Parts, track: SegmentTrack, theme: CircuitTheme): void {
  const { inside, onLand } = circuitGround(track);
  const fill = theme.far ?? theme.outside;
  const colour = (x: number, y: number) => (!onLand(x, y) ? fill : inside(x, y) ? theme.infield : theme.outside);
  const rgb = new Map<string, RGB>();
  for (let y = 0; y < track.worldH; y += TILE) {
    let x0 = 0;
    let run = colour(TILE / 2, y + TILE / 2);
    for (let x = TILE; x <= track.worldW + TILE; x += TILE) {
      const c = x < track.worldW ? colour(x + TILE / 2, y + TILE / 2) : null;
      if (c === run) continue;
      if (run !== fill) {
        if (!rgb.has(run)) rgb.set(run, night(run));
        P.ground.push(ground(rect(x0, y, x, y + TILE, 0), rgb.get(run)!));
      }
      x0 = x;
      run = c ?? fill;
    }
  }
}

/** Shoulders behind the barriers, then the tarmac, kerbs included. */
function pave(P: Parts, spec: SceneSpec, theme: CircuitTheme): void {
  const { track } = spec;
  const shoulder = night(theme.shoulder);
  for (const side of [-1, 1] as const) {
    for (let s = 0; s < track.len; s += SHOULDER_STEP) {
      if (spec.barrier(side, s + SHOULDER_STEP / 2) === 'none') continue;
      const e0 = edgeD(spec, side, s);
      const e1 = edgeD(spec, side, s + SHOULDER_STEP);
      const w = side * (WALL_W + SHOULDER_W);
      P.ground.push(ground(band(track, s, s + SHOULDER_STEP, [e0, e1], [e0 + w, e1 + w], 0), shoulder));
    }
  }
  const asphalt = night(COL.asphalt);
  for (let s = 0; s < track.len; s += PAVE_STEP) {
    const l0 = edgeD(spec, -1, s);
    const l1 = edgeD(spec, -1, s + PAVE_STEP);
    const r0 = edgeD(spec, 1, s);
    const r1 = edgeD(spec, 1, s + PAVE_STEP);
    P.ground.push(ground(band(track, s, s + PAVE_STEP, [l0, l1], [r0, r1], 0), asphalt));
  }
}

/** The pit lane's tarmac and its entry and exit roads. */
function pitGround(P: Parts, track: SegmentTrack): void {
  const geo = track.pit.geo;
  const x = (u: number) => geo.x0 + u;
  const y = (d: number) => geo.y0 + d;
  const surface = night(COL.pitSurface);
  const n = Math.ceil((geo.wall1 - geo.wall0) / PIT_PIECE);
  for (let i = 0; i < n; i++) {
    const a = x(geo.wall0 + ((geo.wall1 - geo.wall0) * i) / n);
    const b = x(geo.wall0 + ((geo.wall1 - geo.wall0) * (i + 1)) / n);
    P.ground.push(ground(rect(a, y(PIT_D.BOX_TOP), b, y(PIT_D.SEP), 0), surface));
  }
  for (const [a, b] of [
    [geo.entry0, geo.wall0],
    [geo.exit1, geo.wall1],
  ] as const) {
    const pts: P3[] = [
      [x(a), y(PIT_D.SEP), 0],
      [x(b), y(PIT_D.BOX_TOP), 0],
      [x(b), y(PIT_D.SEP), 0],
    ];
    P.ground.push(ground(a < b ? pts : pts.reverse(), surface));
  }
}

/** A low kerb wall from a to b: kerb face and lip, `back` seen from behind. */
function kerbWall(P: Parts, ax: number, ay: number, bx: number, by: number, h: number, back: RGB): void {
  const face = night(COL.curbFace, 1.6);
  const top = night(COL.curbTop);
  pieces(ax, ay, bx, by, (x0, y0, x1, y1) => {
    const low = makePoly(wall(x0, y0, x1, y1, 0, h - 1.4), face);
    const lip = makePoly(wall(x0, y0, x1, y1, h - 1.4, h), top);
    low.back = back;
    lip.back = back;
    P.solids.push(low, lip);
  });
}

/**
 * The raised platform behind the pit lane that the paddock stands on. Its front is the kerb behind the
 * boxes, where the PIT ROAD signs hang.
 */
function platform(P: Parts, track: SegmentTrack, theme: CircuitTheme): void {
  const geo = track.pit.geo;
  const fx = geo.x0 + track.finishAt;
  const x0 = Math.max(geo.x0, Math.min(geo.x0 + geo.wall0, fx - 700));
  const x1 = Math.min(geo.x0 + track.mainLen, Math.max(geo.x0 + geo.wall1, fx + 690));
  const y0 = geo.y0 - 250;
  const y1 = geo.y0 + PIT_D.BOX_TOP;
  const top = night(inSideOf(track) < 0 ? theme.infield : theme.outside, 1.15);
  P.island.push(ground(rect(x0, y0, x1, y1, PAD_H), top));
  kerbWall(P, x0, y1, x1, y1, PAD_H, top);
  kerbWall(P, x1, y1, x1, y0, PAD_H, top);
  kerbWall(P, x1, y0, x0, y0, PAD_H, top);
  kerbWall(P, x0, y0, x0, y1, PAD_H, top);
}

/** The kerb walls along the entry and exit roads, and the pointed ends of the pit wall. */
function pitEnds(P: Parts, track: SegmentTrack, theme: CircuitTheme): void {
  const geo = track.pit.geo;
  const x = (u: number) => geo.x0 + u;
  const y = (d: number) => geo.y0 + d;
  const back = night(theme.shoulder);
  // The roads' outer edge runs diagonally from the straight's edge out to the boxes; where a corner's
  // kerb still widens the straight, the kerb is drivable and the wall starts beyond it.
  const taperD = (u: number) =>
    PIT_D.SEP +
    (PIT_D.BOX_TOP - PIT_D.SEP) *
      Math.min(1, u < geo.wall0 ? (u - geo.entry0) / (geo.wall0 - geo.entry0) : (geo.exit1 - u) / (geo.exit1 - geo.wall1));
  const clear = (u: number) => -taperD(u) >= HALF_W + track.kerbs(track.startS + u)[0];
  let u0 = geo.entry0;
  while (u0 < geo.wall0 && !clear(u0)) u0 += 2;
  let u1 = geo.exit1;
  while (u1 > geo.wall1 && !clear(u1)) u1 -= 2;
  kerbWall(P, x(u0), y(taperD(u0)), x(geo.wall0), y(PIT_D.BOX_TOP), PAD_H, back);
  kerbWall(P, x(geo.wall1), y(PIT_D.BOX_TOP), x(u1), y(taperD(u1)), PAD_H, back);
  const side = night(COL.sep, 1.8);
  const top = night(COL.sepTop);
  for (const [tip, dir] of [
    [geo.wall0, 1],
    [geo.wall1, -1],
  ] as const) {
    const bx = x(tip);
    const by = y(SEP_MID);
    const cx = x(tip + dir * NOSE);
    const north = y(PIT_D.WALL_TOP);
    const south = y(PIT_D.SEP);
    P.solids.push(makePoly(wall(bx, by, cx, north, 0, 7), side));
    P.solids.push(makePoly(wall(cx, south, bx, by, 0, 7), side));
    P.solids.push(
      makePoly(
        [
          [bx, by, 7],
          [cx, north, 7],
          [cx, south, 7],
        ],
        top,
      ),
    );
  }
}

export function circuitSpec(track: SegmentTrack): SceneSpec {
  const theme = circuitTheme(track);
  const inSide = inSideOf(track);
  const [pitS0, pitS1] = pitRange(track);
  const inPit = (s: number) => track.wrapS(s - pitS0) <= pitS1 - pitS0;
  const geo = track.pit.geo;
  const spec: SceneSpec = {
    track,
    kerbs: (s) => track.kerbs(s),
    barrier: (side, s) => (side < 0 && inPit(s) ? 'none' : side === inSide ? 'curb' : 'wall'),
    pit: {
      ...pitPaint(track),
      y0: geo.y0,
      curbH: PAD_H,
      arrows: [
        { x: geo.x0 + geo.wall0 - 40, y: geo.y0 + PIT_D.SEP - 12, color: 'rgba(255,200,90,0.9)' },
        { x: geo.x0 + geo.wall1 + 40, y: geo.y0 + PIT_D.SEP - 12, color: 'rgba(127,227,217,0.9)' },
      ],
    },
    paddock: { dx: geo.x0 + track.finishAt - PADDOCK_ORIGIN.x, dy: geo.y0 - PADDOCK_ORIGIN.y, z: PAD_H },
    look: {
      horizon: rgbStyle(night(theme.far ?? theme.outside)),
      shoulder: theme.shoulder,
      lamp: theme.lamp,
      mastStep: 100,
      skyline: { ...NIGHT_CITY, ...theme.fpv?.skyline },
    },
    ground(P) {
      tiles(P, track, theme);
      pave(P, spec, theme);
      pitGround(P, track);
    },
    base(P) {
      platform(P, track, theme);
      pitEnds(P, track, theme);
    },
    extras(P) {
      props(P, track, theme.fpv?.props ?? 'pines', circuitPropSpots(track));
    },
  };
  return spec;
}
