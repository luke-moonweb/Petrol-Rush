import { CONFIG } from '../../config';
import { HALF_W, type Track } from '../../track/common';
import { COL } from '../track/style';
import { hexRgb, makePoly, type RGB } from './engine';
import { groundQuad, type P3, rect, wall } from './geom';
import { box, kerbPiece, label, night, type Parts } from './kit';
import type { SceneSpec } from './spec';
import { texQuad } from './texture';

// The track itself in 3D, laid along any Track's centre line: lane and edge lines, the finish line,
// kerbs, the grid, the barriers on both sides and the floodlight masts.

const WALL_H = 10;
const WALL_STEP = 18;
const CURB_H = 4;
const KERB_STRIPE = 8;
const MAST_OFF = 14;
const MAST_H = 78;

/** A flat quad from s0 to s1 between two offset lines; each line may change its offset along the way. */
export function band(track: Track, s0: number, s1: number, inner: [number, number], outer: [number, number], z: number): P3[] {
  const a = track.pointAt(s0, inner[0]);
  const b = track.pointAt(s1, inner[1]);
  const c = track.pointAt(s1, outer[1]);
  const d = track.pointAt(s0, outer[0]);
  return [
    [a.x, a.y, z],
    [b.x, b.y, z],
    [c.x, c.y, z],
    [d.x, d.y, z],
  ];
}

const sideIdx = (side: -1 | 1) => (side < 0 ? 0 : 1);

/** Offset of the barrier on one side at s: the tarmac's edge plus the kerb there. */
export function edgeD(spec: SceneSpec, side: -1 | 1, s: number): number {
  return side * (HALF_W + spec.kerbs(s)[sideIdx(side)]);
}

function lines(P: Parts, track: Track): void {
  const lane = night('#FFF8E8', 0.85);
  for (const d of [-19, 0, 19]) {
    for (let s = 0; s < track.len; s += 32)
      P.decals.push(makePoly(band(track, s, s + 12, [d - 0.8, d - 0.8], [d + 0.8, d + 0.8], 0.02), lane));
  }
  const edge = night('#FFF8E8');
  for (const side of [-1, 1] as const) {
    const d0 = side * (HALF_W - 2);
    const d1 = side * (HALF_W - 0.5);
    for (let s = 0; s < track.len; s += 24) P.decals.push(makePoly(band(track, s, s + 24, [d0, d0], [d1, d1], 0.02), edge));
  }
  for (let d = -HALF_W, row = 0; d < HALF_W; d += 5, row++) {
    const d1 = Math.min(HALF_W, d + 5);
    for (let c = 0; c < 3; c++) {
      const col = (row + c) % 2 ? '#17142B' : '#FFF8E8';
      P.decals.push(makePoly(band(track, -7 + c * 5, -2 + c * 5, [d, d], [d1, d1], 0.03), hexRgb(col)));
    }
  }
}

/** Red and white stripes over the kerbs that widen the track through corners. */
function kerbStripes(P: Parts, spec: SceneSpec): void {
  const { track } = spec;
  const light = night(COL.kerbLight);
  const dark = night(COL.kerbDark);
  for (const side of [-1, 1] as const) {
    for (let s = 0, k = 0; s < track.len; s += KERB_STRIPE, k++) {
      const e0 = edgeD(spec, side, s);
      const e1 = edgeD(spec, side, s + KERB_STRIPE);
      if (Math.abs(e0) < HALF_W + 1 && Math.abs(e1) < HALF_W + 1) continue;
      const h = side * HALF_W;
      P.decals.push(makePoly(band(track, s, s + KERB_STRIPE, [h, h], [e0, e1], 0.025), k % 2 ? light : dark));
    }
  }
}

/** The starting grid: a bracket and the number in front of every slot. */
const digits = new Map<number, () => HTMLCanvasElement>();
function gridNumber(n: number): () => HTMLCanvasElement {
  let t = digits.get(n);
  if (!t) {
    t = label(32, 24, String(n), null, 'rgba(255,248,232,0.7)', 16, undefined, false);
    digits.set(n, t);
  }
  return t;
}

function gridMarks(P: Parts, track: Track): void {
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

/** Red and cream walls, or a low kerb wall, along both edges; nothing where the spec says so (the pit). */
function barriers(P: Parts, spec: SceneSpec): void {
  const { track } = spec;
  const red = night(COL.wallDark);
  const cream = night(COL.wallLight, 0.9);
  const back: RGB = night(spec.look.shoulder);
  for (const side of [1, -1] as const) {
    for (let s = 0, k = 0; s < track.len; s += WALL_STEP, k++) {
      const kind = spec.barrier(side, s + WALL_STEP / 2);
      if (kind === 'none') continue;
      const a = track.pointAt(s, edgeD(spec, side, s));
      const b = track.pointAt(s + WALL_STEP, edgeD(spec, side, s + WALL_STEP));
      if (kind === 'wall') {
        P.solids.push(makePoly(wall(a.x, a.y, b.x, b.y, 0, WALL_H), k % 2 ? cream : red));
        continue;
      }
      kerbPiece(P.solids, a.x, a.y, b.x, b.y, CURB_H, k, back);
    }
  }
}

/**
 * A floodlight mast every `mastStep` along the lap, on alternate sides, behind the barrier; where a side
 * has no barrier (the pit) the mast stands on the other side. Each lights a pool on the tarmac.
 */
function masts(P: Parts, spec: SceneSpec): void {
  const { track } = spec;
  const pole = hexRgb('#2a2834');
  for (let s = 0, k = 0; s < track.len; s += spec.look.mastStep, k++) {
    let side: -1 | 1 = k % 2 ? 1 : -1;
    if (spec.barrier(side, s) === 'none') side = side < 0 ? 1 : -1;
    if (spec.barrier(side, s) === 'none') continue;
    const p = track.pointAt(s, edgeD(spec, side, s) + side * MAST_OFF);
    // Towards the track.
    const fx = side * Math.sin(p.heading);
    const fy = -side * Math.cos(p.heading);
    box(P.solids, p.x - 1.5, p.y - 1.5, p.x + 1.5, p.y + 1.5, 0, MAST_H, pole, pole);
    const lx = p.x + fx * 1.6;
    const ly = p.y + fy * 1.6;
    P.solids.push(makePoly(wall(lx + fy * 6, ly - fx * 6, lx - fy * 6, ly + fx * 6, MAST_H, MAST_H + 6), hexRgb('#FFF4D0'), true));
    P.glows.push({ x: lx, y: ly, z: MAST_H + 3, r: 22, color: spec.look.lamp, flood: true });
    const q = track.pointAt(s, side * 20);
    P.pools.push({ x: q.x, y: q.y, r: 70, z: 0.015 });
  }
}

export function ribbon(P: Parts, spec: SceneSpec): void {
  lines(P, spec.track);
  kerbStripes(P, spec);
  gridMarks(P, spec.track);
  barriers(P, spec);
  masts(P, spec);
}
