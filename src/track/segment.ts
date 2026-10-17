import { CONFIG } from '../config';
import { CAR_R, type Constrainable, type Corner, type Frenet, HALF_W, type Track, type TrackPoint, type WallNormal } from './common';
import { CurvatureTable } from './curvature';
import { pitGeo, StraightPit } from './straightPit';

/** A corner of the track polygon: position and the radius of the arc that rounds it. */
export type Vertex = readonly [x: number, y: number, r: number];

export interface TrackDef {
  id: string;
  name: string;
  /**
   * Polygon corners in driving order. The edge from corner 0 to corner 1 is the main straight,
   * which must run east (left to right); the pit lane sits north of it.
   */
  corners: readonly Vertex[];
  /** Position of the finish line as a fraction of the main straight. */
  finish: number;
}

interface Line {
  kind: 'line';
  s0: number;
  len: number;
  x0: number;
  y0: number;
  hx: number;
  hy: number;
  heading: number;
}

interface Arc {
  kind: 'arc';
  s0: number;
  len: number;
  r: number;
  phi0: number;
  corner: Corner;
}

export type Segment = Line | Arc;

/**
 * The tightest corner radius allowed. In the grip model the limit follows the radius, so this only
 * keeps the inside lane (r - 28.5) at a sensible speed (about 126 mph) and the kerbs drawable.
 */
export const R_MIN = 120;
/** Kerb that may be driven over on the inside of every corner. */
export const KERB_W = 12;
const KERB_PAD = 60;
const KERB_RAMP = 40;
const KERB_STEP = 4;
export const WORLD_MARGIN = 260;

export interface CompiledShape {
  segments: Segment[];
  len: number;
  problems: string[];
}

/** Turns the polygon into straights and arcs; s = 0 is the start of the main straight. */
export function compileShape(corners: readonly Vertex[]): CompiledShape {
  const n = corners.length;
  const problems: string[] = [];
  const turn: { delta: number; t: number }[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [px, py] = corners[(i + n - 1) % n]!;
    const [x, y, r] = corners[i]!;
    const [nx, ny] = corners[(i + 1) % n]!;
    const aIn = Math.atan2(y - py, x - px);
    const aOut = Math.atan2(ny - y, nx - x);
    let delta = aOut - aIn;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) < 1e-6) problems.push(`corner ${i} does not turn`);
    if (r < R_MIN) problems.push(`corner ${i}: radius ${r} < ${R_MIN}`);
    total += delta;
    turn.push({ delta, t: r * Math.tan(Math.abs(delta) / 2) });
  }
  if (Math.abs(Math.abs(total) - 2 * Math.PI) > 1e-6) problems.push(`the corners turn ${((total * 180) / Math.PI).toFixed(1)}°, not 360°`);

  const segments: Segment[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [xi, yi] = corners[i]!;
    const [xj, yj, rj] = corners[j]!;
    const ex = xj - xi;
    const ey = yj - yi;
    const edge = Math.hypot(ex, ey);
    const hx = ex / edge;
    const hy = ey / edge;
    const len = edge - turn[i]!.t - turn[j]!.t;
    if (len < 0) problems.push(`edge ${i}→${j} is ${(-len).toFixed(0)} px too short for its corners`);
    segments.push({
      kind: 'line',
      s0: s,
      len: Math.max(0, len),
      x0: xi + hx * turn[i]!.t,
      y0: yi + hy * turn[i]!.t,
      hx,
      hy,
      heading: Math.atan2(hy, hx),
    });
    s += Math.max(0, len);

    const dir = turn[j]!.delta > 0 ? 1 : -1;
    const ax = xj - hx * turn[j]!.t;
    const ay = yj - hy * turn[j]!.t;
    const cx = ax - hy * rj * dir;
    const cy = ay + hx * rj * dir;
    const arcLen = rj * Math.abs(turn[j]!.delta);
    segments.push({ kind: 'arc', s0: s, len: arcLen, r: rj, phi0: Math.atan2(ay - cy, ax - cx), corner: { cx, cy, dir } });
    s += arcLen;
  }
  return { segments, len: s, problems };
}

function segPoint(g: Segment, u: number, d: number): TrackPoint {
  if (g.kind === 'line') return { x: g.x0 + g.hx * u - g.hy * d, y: g.y0 + g.hy * u + g.hx * d, heading: g.heading };
  const dir = g.corner.dir;
  const phi = g.phi0 + (dir * u) / g.r;
  const rad = g.r - dir * d;
  return { x: g.corner.cx + rad * Math.cos(phi), y: g.corner.cy + rad * Math.sin(phi), heading: phi + (dir * Math.PI) / 2 };
}

/** A circuit built from straights and constant-radius arcs. s = 0 is the finish line. */
export class SegmentTrack implements Track {
  readonly id: string;
  readonly name: string;
  readonly len: number;
  readonly sectorLen: number;
  readonly worldW: number;
  readonly worldH: number;
  readonly segments: readonly Segment[];
  readonly problems: readonly string[];
  readonly pit: StraightPit;
  /** Length of the main straight, and where on it the finish line is. */
  readonly mainLen: number;
  readonly finishAt: number;
  /** s at the start of the main straight. */
  readonly startS: number;
  private readonly arcStarts: number[];
  private readonly kerbL: Float32Array;
  private readonly kerbR: Float32Array;
  private readonly gridSide: number;

  constructor(def: TrackDef) {
    this.id = def.id;
    this.name = def.name;
    const shape = compileShape(def.corners);
    this.problems = shape.problems;
    this.len = shape.len;
    this.sectorLen = this.len / 8;
    const main = shape.segments[0]!;
    this.mainLen = main.len;
    this.finishAt = main.len * def.finish;
    if (main.kind !== 'line' || Math.abs(main.hy) > 1e-9 || main.hx < 0)
      this.problems = [...this.problems, 'the main straight must run east'];

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of def.corners) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const ox = WORLD_MARGIN - x0;
    const oy = WORLD_MARGIN - y0;
    this.worldW = Math.ceil(x1 - x0 + 2 * WORLD_MARGIN);
    this.worldH = Math.ceil(y1 - y0 + 2 * WORLD_MARGIN);

    const shift = this.finishAt;
    this.segments = shape.segments.map((g): Segment => {
      const s0 = g.s0 - shift;
      if (g.kind === 'line') return { ...g, s0, x0: g.x0 + ox, y0: g.y0 + oy };
      return { ...g, s0, corner: { ...g.corner, cx: g.corner.cx + ox, cy: g.corner.cy + oy } };
    });
    this.arcStarts = this.segments.filter((g) => g.kind === 'arc').map((g) => this.wrapS(g.s0));

    const n = Math.ceil(this.len / KERB_STEP) + 1;
    this.kerbL = new Float32Array(n);
    this.kerbR = new Float32Array(n);
    for (const g of this.segments) {
      if (g.kind !== 'arc') continue;
      const side = g.corner.dir > 0 ? this.kerbR : this.kerbL;
      for (let k = -(KERB_PAD + KERB_RAMP); k <= g.len + KERB_PAD + KERB_RAMP; k += KERB_STEP) {
        const out = k < -KERB_PAD ? -KERB_PAD - k : k > g.len + KERB_PAD ? k - g.len - KERB_PAD : 0;
        const idx = Math.round(this.wrapS(g.s0 + k) / KERB_STEP) % n;
        side[idx] = Math.max(side[idx]!, KERB_W * Math.max(0, 1 - out / KERB_RAMP));
      }
    }
    const start = this.segments[0] as Line;
    this.startS = this.wrapS(-this.finishAt);
    this.pit = new StraightPit(pitGeo(start.x0, start.y0, this.mainLen), this);
    const firstArc = this.segments.find((g) => g.kind === 'arc') as Arc;
    this.gridSide = -firstArc.corner.dir;
  }

  wrapS(s: number): number {
    s %= this.len;
    return s < 0 ? s + this.len : s;
  }

  deltaS(a: number, b: number): number {
    let d = this.wrapS(b - a);
    if (d > this.len / 2) d -= this.len;
    return d;
  }

  segmentAt(s: number): Segment {
    const ws = this.wrapS(s);
    const segs = this.segments;
    for (let i = segs.length - 1; i >= 0; i--) {
      const g = segs[i]!;
      if (this.wrapS(ws - g.s0) < g.len) return g;
    }
    return segs[0]!;
  }

  pointAt(s: number, d: number): TrackPoint {
    const g = this.segmentAt(s);
    return segPoint(g, this.wrapS(s - g.s0), d);
  }

  /** Nearest point on the centre line: the segment whose closest point is nearest wins. */
  private nearest(x: number, y: number): { g: Segment; u: number; d: number } {
    let best: { g: Segment; u: number; d: number } | null = null;
    let bestDist = Infinity;
    for (const g of this.segments) {
      let u: number;
      let d: number;
      let dist: number;
      if (g.kind === 'line') {
        const dx = x - g.x0;
        const dy = y - g.y0;
        u = dx * g.hx + dy * g.hy;
        d = dy * g.hx - dx * g.hy;
        if (u < 0 || u > g.len) {
          u = Math.max(0, Math.min(g.len, u));
          dist = Math.hypot(x - (g.x0 + g.hx * u), y - (g.y0 + g.hy * u));
        } else dist = Math.abs(d);
      } else {
        const c = g.corner;
        const vx = x - c.cx;
        const vy = y - c.cy;
        const rho = Math.hypot(vx, vy);
        let a = c.dir * (Math.atan2(vy, vx) - g.phi0);
        a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        u = a * g.r;
        d = c.dir * (g.r - rho);
        if (u > g.len) {
          // Outside the arc's wedge: measure to whichever end is closer.
          const back = (2 * Math.PI - a) * g.r;
          u = u - g.len < back ? g.len : 0;
          const p = segPoint(g, u, 0);
          dist = Math.hypot(x - p.x, y - p.y);
        } else dist = Math.abs(d);
      }
      if (dist < bestDist) {
        bestDist = dist;
        best = { g, u, d };
      }
    }
    return best!;
  }

  project(x: number, y: number): Frenet {
    const n = this.nearest(x, y);
    return { s: this.wrapS(n.g.s0 + n.u), d: n.d };
  }

  headingAt(x: number, y: number): number {
    return this.pointAt(this.project(x, y).s, 0).heading;
  }

  cornerAt(x: number, y: number): Corner | null {
    const n = this.nearest(x, y);
    return n.g.kind === 'arc' && n.u > 0 && n.u < n.g.len ? n.g.corner : null;
  }

  distToCorner(s: number): number {
    let best = Infinity;
    for (const a of this.arcStarts) best = Math.min(best, this.wrapS(a - s));
    return best;
  }

  /** Extra drivable width on each side at s: [left, right]. */
  kerbs(s: number): [number, number] {
    const i = Math.round(this.wrapS(s) / KERB_STEP) % this.kerbL.length;
    return [this.kerbL[i]!, this.kerbR[i]!];
  }

  /** Distance along the main straight from its start, or -1 elsewhere on the lap. */
  mainU(s: number): number {
    const u = this.wrapS(s + this.finishAt);
    return u <= this.mainLen ? u : -1;
  }

  constrain(p: Constrainable): WallNormal | null {
    const { s, d } = this.project(p.x, p.y);
    const [kl, kr] = this.kerbs(s);
    let lo = -(HALF_W + kl) + CAR_R;
    if (this.mainU(s) >= 0) {
      const pit = this.pit.constrain(p);
      if (pit !== undefined) return pit;
      lo = Math.min(lo, this.pit.taperEdge(p.x - this.pit.geo.x0) ?? lo);
    } else p.wasInPit = false;
    const hi = HALF_W + kr - CAR_R;
    if (d >= lo && d <= hi) return null;
    const dd = d < lo ? lo : hi;
    const q = this.pointAt(s, dd);
    p.x = q.x;
    p.y = q.y;
    // Right-hand normal is (-sin h, cos h); the wall pushes back towards the centre line.
    const side = d < lo ? 1 : -1;
    return { nx: -Math.sin(q.heading) * side, ny: Math.cos(q.heading) * side };
  }

  curvatureAt(s: number): number {
    const g = this.segmentAt(s);
    return g.kind === 'arc' ? g.corner.dir / g.r : 0;
  }

  private table: CurvatureTable | null = null;

  curves(): CurvatureTable {
    if (!this.table) this.table = CurvatureTable.from(this);
    return this.table;
  }

  gridSlot(slot: number): Frenet {
    const s = CONFIG.GRID_FRONT_S - CONFIG.CAR_LEN / 2 - slot * CONFIG.GRID_SPACING;
    return { s, d: CONFIG.GRID_LANES[slot % 2]! * this.gridSide };
  }
}
