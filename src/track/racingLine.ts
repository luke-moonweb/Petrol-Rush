// The racing line: outside, apex, outside through every corner, as a lateral offset d(s) from the
// centre line. Every track is built from straights and constant-radius arcs, so each corner's line is
// one arc of radius rho that touches the outside on the straights before and after and the inside at
// the apex (the corner lab's line, tests/sim/curves.ts labCorner). Between two corners the line moves
// straight across; where the straight is too short for both corners' lines, both use less width.
import { CAR_R, HALF_W, type TrackPoint } from './common';
import type { CurvatureTable } from './curvature';

/** What the line needs from a track (any Track has it). */
export interface LineSource {
  readonly len: number;
  curves(): CurvatureTable;
  curvatureAt(s: number): number;
  pointAt(s: number, d: number): TrackPoint;
}

export const RACING_LINE = {
  /** The line keeps this far (px) off the walls for a car centre at full use. */
  MARGIN: 4,
  /** Moving across between two corners turning opposite ways takes this many px along per px across. */
  CROSS: 4,
};

interface LineCorner {
  /** Road s where the arc starts and ends, its radius and turn (+1 right, -1 left), angle (rad). */
  s0: number;
  s1: number;
  r: number;
  sign: number;
  theta: number;
  /** Arc centre, and the unit vector from it to the arc's midpoint. */
  cx: number;
  cy: number;
  bx: number;
  by: number;
  /** Turn-in distance before the arc per px of half-width used. */
  pre: number;
  /** Largest half-width the line may use here (px), after the neighbours took their share. */
  hMax: number;
}

/** One corner's line at a given use: the road s it spans (turn-in to exit) and its curvature. */
export interface LineZone {
  start: number;
  len: number;
  k: number;
}

/** Turn-in distance before an arc of angle theta, per px of half-width used. */
function preFactor(theta: number): number {
  const c = Math.cos(Math.min(Math.PI, theta) / 2);
  return 2 * Math.sqrt((1 + c) / (1 - c));
}

/** Radius of the line through an arc of radius r and angle theta using half-width h. */
function lineRadius(r: number, theta: number, h: number): number {
  if (h <= 0) return r;
  const sinPhi = Math.sin((Math.PI - Math.min(Math.PI, theta)) / 2);
  return (r + h - (r - h) * sinPhi) / (1 - sinPhi);
}

export class RacingLine {
  private readonly corners: LineCorner[] = [];
  readonly len: number;

  constructor(private readonly track: LineSource) {
    this.len = track.len;
    const hw = HALF_W - CAR_R - RACING_LINE.MARGIN;
    for (const run of track.curves().runs()) {
      const s0 = this.edge(run.s0, run.k, -1);
      const s1 = this.edge(run.s0 + run.len, run.k, 1);
      const arc = this.wrap(s1 - s0);
      // (the table holds float32: the exact curvature comes from the track)
      const kExact = track.curvatureAt(this.wrap(s0 + arc / 2));
      const r = 1 / Math.abs(kExact);
      const sign = Math.sign(kExact);
      const mid = track.pointAt(s0 + arc / 2, 0);
      // the centre is on the inside: d = sign * r
      const cx = mid.x - Math.sin(mid.heading) * sign * r;
      const cy = mid.y + Math.cos(mid.heading) * sign * r;
      const theta = arc / r;
      this.corners.push({ s0, s1, r, sign, theta, cx, cy, bx: (mid.x - cx) / r, by: (mid.y - cy) / r, pre: preFactor(theta), hMax: hw });
    }
    // each straight between two corners has to fit the exit of one and the turn-in of the next
    const n = this.corners.length;
    const fit = this.corners.map((a, i) => {
      const b = this.corners[(i + 1) % n]!;
      const gap = this.wrap(b.s0 - a.s1);
      const need = (a.pre + b.pre) * hw + (a.sign === b.sign ? 0 : RACING_LINE.CROSS * 2 * hw);
      return Math.max(0, Math.min(1, gap / need));
    });
    this.corners.forEach((c, i) => {
      c.hMax = hw * Math.min(fit[i]!, fit[(i + n - 1) % n]!);
    });
  }

  /** Where the arc around s really starts (dir -1) or ends (+1): the table is sampled every few px. */
  private edge(s: number, k: number, dir: number): number {
    const step = this.track.curves().step;
    const on = (q: number) => Math.abs(this.track.curvatureAt(this.wrap(q)) - k) < Math.abs(k) * 1e-5;
    let inside = s - dir * step;
    let outside = s + dir * step;
    if (!on(inside)) inside = s - (dir * step) / 2;
    for (let i = 0; i < 24; i++) {
      const m = (inside + outside) / 2;
      if (on(m)) inside = m;
      else outside = m;
    }
    return this.wrap((inside + outside) / 2);
  }

  private wrap(s: number): number {
    const L = this.len;
    return ((s % L) + L) % L;
  }

  /** Each corner's line for a driver using `use` (0..1) of the width. */
  zones(use: number): LineZone[] {
    return this.corners.map((c) => {
      const h = c.hMax * use;
      const pre = c.pre * h;
      return { start: this.wrap(c.s0 - pre), len: this.wrap(c.s1 - c.s0) + 2 * pre, k: c.sign / lineRadius(c.r, c.theta, h) };
    });
  }

  /** The corner whose line spans s at this use, or the gap between two corners' lines. */
  private locate(s: number, use: number): { at: number; inZone: boolean; u: number } {
    const n = this.corners.length;
    let after = 0;
    let since = Infinity;
    for (let i = 0; i < n; i++) {
      const c = this.corners[i]!;
      const pre = c.pre * c.hMax * use;
      const u = this.wrap(s - (c.s0 - pre));
      if (u < this.wrap(c.s1 - c.s0) + 2 * pre) return { at: i, inZone: true, u };
      const e = this.wrap(s - (c.s1 + pre));
      if (e < since) {
        since = e;
        after = i;
      }
    }
    return { at: after, inZone: false, u: since };
  }

  /** Lateral offset (px, + right of travel) of the line at s for a driver using `use` of the width. */
  d(s: number, use: number): number {
    if (this.corners.length === 0) return 0;
    const loc = this.locate(s, use);
    const c = this.corners[loc.at]!;
    const h = c.hMax * use;
    if (loc.inZone) return this.zoneD(c, s, h);
    // between two corners' lines: straight across from the exit of one to the turn-in of the next
    const next = this.corners[(loc.at + 1) % this.corners.length]!;
    const hn = next.hMax * use;
    const from = -c.sign * h;
    const to = -next.sign * hn;
    const gap = this.wrap(next.s0 - next.pre * hn - (c.s1 + c.pre * h));
    return gap <= 0 ? to : from + (to - from) * Math.min(1, loc.u / gap);
  }

  /** Curvature (1/px) of the line at s: the corner line's arc, 0 between corners. */
  k(s: number, use: number): number {
    if (this.corners.length === 0) return 0;
    const loc = this.locate(s, use);
    if (!loc.inZone) return 0;
    const c = this.corners[loc.at]!;
    return c.sign / lineRadius(c.r, c.theta, c.hMax * use);
  }

  /** Where the normal to the centre line at s meets the corner's line arc. */
  private zoneD(c: LineCorner, s: number, h: number): number {
    const rho = lineRadius(c.r, c.theta, h);
    const off = c.r - h - rho;
    const lx = c.cx + c.bx * off;
    const ly = c.cy + c.by * off;
    const p = this.track.pointAt(s, 0);
    const nx = -Math.sin(p.heading);
    const ny = Math.cos(p.heading);
    const wx = p.x - lx;
    const wy = p.y - ly;
    const nw = nx * wx + ny * wy;
    const disc = nw * nw - (wx * wx + wy * wy) + rho * rho;
    if (disc < 0) return -c.sign * h;
    const q = Math.sqrt(disc);
    const a = -nw + q;
    const b = -nw - q;
    const d = Math.abs(a) < Math.abs(b) ? a : b;
    return Math.max(-h, Math.min(h, d));
  }
}

const cache = new WeakMap<LineSource, RacingLine>();

/** The track's racing line (built once per track). */
export function racingLine(track: LineSource): RacingLine {
  let line = cache.get(track);
  if (!line) {
    line = new RacingLine(track);
    cache.set(track, line);
  }
  return line;
}
