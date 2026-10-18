// Minimal open-plane test tracks built from constant-curvature pieces. They implement the same
// curvature contract as the game track (curvatureAt), plus pointAt / project for test drivers.
import { CAR_R, HALF_W } from '../../src/track/common';
import { type CurvatureSource, CurvatureTable } from '../../src/track/curvature';
import { wrapAngle } from '../../src/track/oval';

export interface Piece {
  len: number;
  /** Signed curvature 1/px: + = heading increases (clockwise on screen, a right turn). */
  k: number;
}

interface Placed extends Piece {
  s0: number;
  x0: number;
  y0: number;
  h0: number;
}

export class CurveTrack implements CurvatureSource {
  readonly len: number;
  readonly table: CurvatureTable;
  private readonly pieces: Placed[] = [];

  /** start: pose of s = 0 (default the origin, heading east). */
  constructor(pieces: Piece[], start = { x: 0, y: 0, h: 0 }) {
    let s = 0;
    let { x, y, h } = start;
    for (const p of pieces) {
      this.pieces.push({ ...p, s0: s, x0: x, y0: y, h0: h });
      const e = this.local(this.pieces[this.pieces.length - 1]!, p.len, 0);
      x = e.x;
      y = e.y;
      h = e.heading;
      s += p.len;
    }
    this.len = s;
    this.table = new CurvatureTable(s, (q) => this.curvatureAt(q), 2);
  }

  curvatureAt(s: number): number {
    if (s < 0 || s >= this.len) return 0;
    return this.pieceAt(s).k;
  }

  /** Pose on the line at lateral offset d (d + = right of travel). Beyond the ends it continues straight. */
  pointAt(s: number, d: number): { x: number; y: number; heading: number } {
    if (s < 0) {
      const p = this.pieces[0]!;
      return this.offset(p.x0 + Math.cos(p.h0) * s, p.y0 + Math.sin(p.h0) * s, p.h0, d);
    }
    if (s >= this.len) {
      const last = this.pieces[this.pieces.length - 1]!;
      const e = this.local(last, last.len, 0);
      const u = s - this.len;
      return this.offset(e.x + Math.cos(e.heading) * u, e.y + Math.sin(e.heading) * u, e.heading, d);
    }
    const p = this.pieceAt(s);
    return this.local(p, s - p.s0, d);
  }

  /** Nearest (s, d) for a point; with a hint, the candidate closest to it along s (for tracks that overlap). */
  project(x: number, y: number, sHint?: number): { s: number; d: number } {
    const cands: { s: number; d: number }[] = [];
    const first = this.pieces[0]!;
    const fx = x - first.x0;
    const fy = y - first.y0;
    const along0 = fx * Math.cos(first.h0) + fy * Math.sin(first.h0);
    if (along0 < 0) cands.push({ s: along0, d: -fx * Math.sin(first.h0) + fy * Math.cos(first.h0) });
    for (const p of this.pieces) {
      const last = p === this.pieces[this.pieces.length - 1];
      if (p.k === 0) {
        const dx = x - p.x0;
        const dy = y - p.y0;
        const u = dx * Math.cos(p.h0) + dy * Math.sin(p.h0);
        if (u >= -1e-6 && (u <= p.len + 1e-6 || last)) cands.push({ s: p.s0 + u, d: -dx * Math.sin(p.h0) + dy * Math.cos(p.h0) });
        continue;
      }
      const cx = p.x0 - Math.sin(p.h0) / p.k;
      const cy = p.y0 + Math.cos(p.h0) / p.k;
      const rx = x - cx;
      const ry = y - cy;
      const r = Math.hypot(rx, ry);
      const h = p.k > 0 ? Math.atan2(rx, -ry) : Math.atan2(-rx, ry);
      const d = p.k > 0 ? 1 / p.k - r : r + 1 / p.k;
      const lap = (2 * Math.PI) / Math.abs(p.k);
      let u = wrapAngle(h - p.h0) / p.k;
      if (u < -1e-6) u += lap;
      for (; u <= p.len + 1e-6; u += lap) cands.push({ s: p.s0 + u, d });
    }
    let best = cands[0] ?? { s: 0, d: 0 };
    for (const c of cands) {
      if (sHint === undefined) {
        if (Math.abs(c.d) < Math.abs(best.d)) best = c;
      } else {
        const score = Math.abs(c.s - sHint) + Math.abs(c.d) * 4;
        if (score < Math.abs(best.s - sHint) + Math.abs(best.d) * 4) best = c;
      }
    }
    return best;
  }

  private pieceAt(s: number): Placed {
    for (let i = this.pieces.length - 1; i >= 0; i--) if (s >= this.pieces[i]!.s0) return this.pieces[i]!;
    return this.pieces[0]!;
  }

  private local(p: Placed, u: number, d: number): { x: number; y: number; heading: number } {
    if (p.k === 0) return this.offset(p.x0 + Math.cos(p.h0) * u, p.y0 + Math.sin(p.h0) * u, p.h0, d);
    const h = p.h0 + p.k * u;
    const x = p.x0 + (Math.sin(h) - Math.sin(p.h0)) / p.k;
    const y = p.y0 + (Math.cos(p.h0) - Math.cos(h)) / p.k;
    return this.offset(x, y, h, d);
  }

  private offset(x: number, y: number, h: number, d: number): { x: number; y: number; heading: number } {
    return { x: x - Math.sin(h) * d, y: y + Math.cos(h) * d, heading: wrapAngle(h) };
  }
}

const DEG = Math.PI / 180;
const lead = (len = 400): Piece => ({ len, k: 0 });

/** A full circle of radius r (left turn) after a run-up straight, then a run-off straight. */
export const circle = (r: number, turns = 1.5): CurveTrack =>
  new CurveTrack([lead(), { len: 2 * Math.PI * r * turns, k: -1 / r }, lead(600)]);
/** 180 degrees at r 60 (left). */
export const hairpin = (): CurveTrack => new CurveTrack([lead(), { len: Math.PI * 60, k: -1 / 60 }, lead(600)]);
/** r 120 left 60 degrees, 40 px straight, r 120 right 60 degrees. */
export const chicane = (): CurveTrack =>
  new CurveTrack([lead(), { len: 120 * 60 * DEG, k: -1 / 120 }, { len: 40, k: 0 }, { len: 120 * 60 * DEG, k: 1 / 120 }, lead(600)]);
/** r 150, 90 degrees left then 90 degrees right. */
export const sBend = (): CurveTrack =>
  new CurveTrack([lead(), { len: 150 * 90 * DEG, k: -1 / 150 }, { len: 150 * 90 * DEG, k: 1 / 150 }, lead(600)]);

/** How far the car centre may get from the centre line: the walls of the game tracks. */
export const LAB_HW = HALF_W - CAR_R;
/** The racing line keeps this far off the walls (px), so tracking errors do not touch them. */
export const LINE_MARGIN = 4;
/** ...and this far for a key player, who weaves about +-10 px around the line. */
export const HUMAN_MARGIN = 14;

/** How far before the road's arc the racing line turns in, on a corner of `deg` using half-width hw. */
function turnInBefore(deg: number, hw: number): number {
  const s = Math.cos((deg * DEG) / 2);
  return 2 * hw * Math.sqrt((1 + s) / (1 - s));
}

export interface LabCorner {
  /** The road: run-up, one arc of radius r turning deg, run-off. Its walls are at +-LAB_HW. */
  road: CurveTrack;
  /** The line driven: on the outside, one arc touching the inside at the apex, back to the outside. */
  line: CurveTrack;
  /** Radius of the line's arc, and how far off the centre line it runs on the straights (px). */
  rho: number;
  hw: number;
  /** Road s where the road's arc starts and ends. */
  arc0: number;
  arc1: number;
  /** Line s where its arc starts and ends. */
  lineArc0: number;
  lineArc1: number;
  /** +1 right turn, -1 left turn (the sign of the curvature). */
  sign: number;
}

/**
 * A single corner (0 < deg <= 180) of radius r with the widest line through it that uses `use` (0..1)
 * of the track width, keeping `margin` px off the walls: outside, apex, outside. use 0 drives the centre line.
 */
export function labCorner(r: number, deg: number, dir: 'left' | 'right' = 'left', use = 1, margin = LINE_MARGIN): LabCorner {
  if (!(deg > 0 && deg <= 180) || r <= LAB_HW) throw new Error(`labCorner: need 0 < deg <= 180 and r > ${LAB_HW}`);
  const sign = dir === 'left' ? -1 : 1;
  const th = deg * DEG;
  const hw = use * (LAB_HW - margin);
  // the run-up fits the full line's turn-in plus braking from top speed for every use
  const runUp = turnInBefore(deg, LAB_HW) + 600;
  const road = new CurveTrack([lead(runUp), { len: r * th, k: sign / r }, lead(1000)]);
  const sinPhi = Math.sin((Math.PI - th) / 2);
  const rho = hw === 0 ? r : (r + hw - (r - hw) * sinPhi) / (1 - sinPhi);
  const pre = hw === 0 ? 0 : turnInBefore(deg, hw);
  // the line starts on the outside of the run-up: d = -sign * hw (right of travel for a left turn)
  const line = new CurveTrack([lead(runUp - pre), { len: rho * th, k: sign / rho }, lead(1000 + pre)], { x: 0, y: -sign * hw, h: 0 });
  return { road, line, rho, hw, arc0: runUp, arc1: runUp + r * th, lineArc0: runUp - pre, lineArc1: runUp - pre + rho * th, sign };
}
