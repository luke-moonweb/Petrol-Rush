import { CONFIG } from '../../../config';
import { createRng, type Rng } from '../../../sim/rng';
import { HALF_W } from '../../../track/common';
import type { SegmentTrack } from '../../../track/segment';
import { NOSE, NUM_BOXES, PIT_D, SEP_MID } from '../../../track/straightPit';
import { makeCanvas } from '../../sprites';
import { drawCenter, drawCenterLights, PADDOCK_ORIGIN } from '../oval/paddock';
import { drawPitLabels, drawPitRoad, drawPitSigns, type PitPaint } from '../oval/pit';
import { COL, FONT_BLACK } from '../style';
import { type CircuitTheme, THEMES } from './theme';

const STEP = 4;
const WALL_W = 8;
const SHOULDER_W = 26;
const LANE_LINES = [-19, 0, 19];
const KERB_STRIPE = 6;

type Pt = [number, number];

/** Samples an offset line d(s) along the lap (or part of it). */
function offsetLine(track: SegmentTrack, d: (s: number) => number, s0 = 0, s1 = track.len): Pt[] {
  const pts: Pt[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / STEP));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const p = track.pointAt(s, d(s));
    pts.push([p.x, p.y]);
  }
  return pts;
}

/** Fills the band between two offset lines. */
function band(g: CanvasRenderingContext2D, a: Pt[], b: Pt[]): void {
  polyline(g, a);
  for (let i = b.length - 1; i >= 0; i--) g.lineTo(b[i]![0], b[i]![1]);
  g.closePath();
  g.fill();
}

function polyline(g: CanvasRenderingContext2D, pts: Pt[]): void {
  g.beginPath();
  for (const [x, y] of pts) g.lineTo(x, y);
}

interface Ctx {
  g: CanvasRenderingContext2D;
  track: SegmentTrack;
  theme: CircuitTheme;
  /** Side of the infield: +1 right, -1 left. */
  inSide: number;
  /** s range of the main straight where the pit complex replaces the left wall. */
  pitS0: number;
  pitS1: number;
  /** Coarse centre line, for inside/outside tests. */
  loop: Pt[];
}

function pitPaint(track: SegmentTrack): PitPaint {
  const p = track.pit;
  const g = p.geo;
  return {
    x0: g.x0 + g.wall0 + NOSE,
    x1: g.x0 + g.wall1 - NOSE,
    numBoxes: NUM_BOXES,
    boxX: (i) => p.boxX(i),
    boxW: g.boxPitch - 14,
    wallX0: g.x0 + g.wall0 + NOSE,
    wallX1: g.x0 + g.wall1 - NOSE,
    lineInX: g.x0 + g.lineIn,
    lineOutX: g.x0 + g.lineOut,
  };
}

export function buildCircuitCanvas(track: SegmentTrack): HTMLCanvasElement {
  const W = track.worldW;
  const H = track.worldH;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  const theme = THEMES[track.id] ?? THEMES.harbour!;
  const turn = track.segments.reduce((a, s) => a + (s.kind === 'arc' ? s.corner.dir * s.len : 0), 0);
  const geo = track.pit.geo;
  const ctx: Ctx = {
    g,
    track,
    theme,
    inSide: turn > 0 ? 1 : -1,
    pitS0: -track.finishAt + geo.entry0,
    pitS1: -track.finishAt + geo.exit1,
    loop: [],
  };
  for (let s = 0; s < track.len; s += 20) {
    const p = track.pointAt(s, 0);
    ctx.loop.push([p.x, p.y]);
  }
  const rng = createRng(track.len | 0);

  drawGround(ctx, rng);
  drawProps(ctx, createRng(7 + (track.len | 0)));
  drawRoad(ctx);
  drawPitComplex(ctx);
  drawGrid(ctx);
  drawFinishLine(g, track);
  addNoise(g, W, H, createRng(99));
  nightLighting(ctx, rng);
  const L = pitPaint(track);
  g.save();
  g.translate(0, track.pit.geo.y0 - PADDOCK_ORIGIN.y);
  drawPitLabels(g, L);
  drawPitSigns(g, L);
  g.restore();
  withPaddock(track, g, () => drawCenterLights(g, createRng(78)));
  drawPropGlow(ctx, createRng(7 + (track.len | 0)));
  drawLitFinish(g, track);
  return c;
}

function drawGround(ctx: Ctx, rng: Rng): void {
  const { g, track, theme } = ctx;
  const W = track.worldW;
  const H = track.worldH;
  g.fillStyle = theme.far ?? theme.outside;
  g.fillRect(0, 0, W, H);
  const loop = offsetLine(track, () => 0);
  if (theme.far) {
    theme.farDetail?.(g, W, H, rng);
    g.strokeStyle = theme.outside;
    g.lineWidth = 2 * theme.nearW;
    g.lineJoin = 'round';
    polyline(g, loop);
    g.closePath();
    g.stroke();
    const geo = track.pit.geo;
    g.fillStyle = theme.outside;
    g.fillRect(geo.x0 - 40, geo.y0 - 280, track.mainLen + 80, 300);
  }
  g.fillStyle = theme.infield;
  polyline(g, loop);
  g.closePath();
  g.fill();
  g.fillStyle = theme.speckle;
  for (let i = 0; i < (W * H) / 900; i++) {
    const r = 1 + rng() * 3;
    const x = rng() * W;
    const y = rng() * H;
    if (theme.far && !onLand(ctx, x, y)) continue;
    g.globalAlpha = 0.25 + rng() * 0.35;
    g.fillRect(x, y, r, r);
  }
  g.globalAlpha = 1;
}

/** Inside the lap (ray casting against the centre line). */
function insideLoop(ctx: Ctx, x: number, y: number): boolean {
  const pts = ctx.loop;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!;
    const [bx, by] = pts[i]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function onLand(ctx: Ctx, x: number, y: number, margin = 0): boolean {
  if (!ctx.theme.far) return true;
  return insideLoop(ctx, x, y) || Math.abs(ctx.track.project(x, y).d) < ctx.theme.nearW - margin;
}

/** Free ground for scenery: away from the track, the pit lane and the paddock. */
function propSpots(ctx: Ctx, rng: Rng): Pt[] {
  const { track, theme } = ctx;
  const geo = track.pit.geo;
  const spots: Pt[] = [];
  const n = Math.round(((track.worldW * track.worldH) / 10000) * theme.density);
  const clear = HALF_W + WALL_W + SHOULDER_W + 20 + theme.propR;
  const fx = geo.x0 + track.finishAt;
  for (let i = 0; i < n * 3 && spots.length < n; i++) {
    const x = theme.propR + rng() * (track.worldW - 2 * theme.propR);
    const y = theme.propR + rng() * (track.worldH - 2 * theme.propR);
    if (Math.abs(track.project(x, y).d) < clear) continue;
    if (x > fx - 720 && x < fx + 700 && y > geo.y0 - 260 - theme.propR && y < geo.y0 + 20) continue;
    if (x > geo.x0 - 20 && x < geo.x0 + track.mainLen + 20 && y > geo.y0 - 140 - theme.propR && y < geo.y0) continue;
    if (!onLand(ctx, x, y, theme.propR)) continue;
    spots.push([x, y]);
  }
  return spots;
}

function drawProps(ctx: Ctx, rng: Rng): void {
  for (const [x, y] of propSpots(ctx, rng)) ctx.theme.prop(ctx.g, x, y, rng);
}

function drawPropGlow(ctx: Ctx, rng: Rng): void {
  const glow = ctx.theme.glow;
  const spots = propSpots(ctx, rng);
  if (!glow) return;
  for (const [x, y] of spots) if (rng() < 0.5) glow(ctx.g, x, y, rng);
}

function inPitS(ctx: Ctx, s: number): boolean {
  const ws = ctx.track.wrapS(s - ctx.pitS0);
  return ws <= ctx.pitS1 - ctx.pitS0;
}

/** Splits the lap into runs where `keep` holds, so walls can stop at the pit complex. */
function runs(ctx: Ctx, keep: (s: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  const len = ctx.track.len;
  let start: number | null = null;
  const base = ctx.pitS1;
  for (let k = 0; k <= len; k += STEP) {
    const s = base + k;
    const ok = keep(s) && k < len;
    if (ok && start === null) start = s;
    if (!ok && start !== null) {
      out.push([start, s]);
      start = null;
    }
  }
  return out;
}

function drawRoad(ctx: Ctx): void {
  const { g, track, theme } = ctx;
  const kerb = (side: number) => (s: number) => track.kerbs(s)[side < 0 ? 0 : 1];
  for (const side of [-1, 1]) {
    const edge = kerb(side);
    const leftPit = (s: number) => side > 0 || !inPitS(ctx, s);
    for (const [s0, s1] of runs(ctx, leftPit)) {
      g.fillStyle = theme.shoulder;
      band(
        g,
        offsetLine(track, (s) => side * (HALF_W + edge(s) + WALL_W), s0, s1),
        offsetLine(track, (s) => side * (HALF_W + edge(s) + WALL_W + SHOULDER_W), s0, s1),
      );
      const inner = offsetLine(track, (s) => side * (HALF_W + edge(s)), s0, s1);
      const outer = offsetLine(track, (s) => side * (HALF_W + edge(s) + WALL_W), s0, s1);
      if (side === ctx.inSide) {
        g.fillStyle = COL.curbFace;
        band(g, inner, outer);
        g.strokeStyle = COL.curbTop;
        g.lineWidth = 2;
        polyline(
          g,
          offsetLine(track, (s) => side * (HALF_W + edge(s) + 1), s0, s1),
        );
        g.stroke();
      } else {
        g.fillStyle = COL.wallDark;
        band(g, inner, outer);
        g.strokeStyle = COL.wallLight;
        g.lineWidth = WALL_W - 3;
        g.setLineDash([18, 18]);
        polyline(
          g,
          offsetLine(track, (s) => side * (HALF_W + edge(s) + WALL_W / 2), s0, s1),
        );
        g.stroke();
        g.setLineDash([]);
      }
    }
  }

  g.fillStyle = COL.asphalt;
  band(
    g,
    offsetLine(track, () => -HALF_W - 0.5),
    offsetLine(track, () => HALF_W + 0.5),
  );

  for (const seg of track.segments) {
    if (seg.kind !== 'arc') continue;
    const side = seg.corner.dir;
    const from = seg.s0 - 100;
    const to = seg.s0 + seg.len + 100;
    for (let s = from; s < to; s += KERB_STRIPE) {
      const e0 = track.kerbs(s)[side < 0 ? 0 : 1];
      if (e0 < 1) continue;
      g.fillStyle = Math.round((s - from) / KERB_STRIPE) % 2 ? COL.kerbLight : COL.kerbDark;
      band(
        g,
        offsetLine(track, () => side * HALF_W, s, s + KERB_STRIPE),
        offsetLine(track, (q) => side * (HALF_W + track.kerbs(q)[side < 0 ? 0 : 1] - 2), s, s + KERB_STRIPE),
      );
    }
  }

  g.strokeStyle = COL.lane;
  g.lineWidth = 2;
  g.setLineDash([12, 20]);
  for (const d of LANE_LINES) {
    polyline(
      g,
      offsetLine(track, () => d),
    );
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = COL.edge;
  g.lineWidth = 1.5;
  for (const d of [-HALF_W, HALF_W]) {
    polyline(
      g,
      offsetLine(track, () => d),
    );
    g.closePath();
    g.stroke();
  }
}

function withPaddock(track: SegmentTrack, g: CanvasRenderingContext2D, draw: () => void): void {
  const geo = track.pit.geo;
  g.save();
  g.translate(geo.x0 + track.finishAt - PADDOCK_ORIGIN.x, geo.y0 - PADDOCK_ORIGIN.y);
  draw();
  g.restore();
}

function drawPitComplex(ctx: Ctx): void {
  const { g, track } = ctx;
  const geo = track.pit.geo;
  const x = (u: number) => geo.x0 + u;
  const y = (d: number) => geo.y0 + d;
  // Entry and exit roads: tarmac between the straight and the diagonal pit wall, up to where the
  // pit wall's pointed end has grown to full thickness.
  for (const [a, b, c] of [
    [geo.entry0, geo.wall0, geo.wall0 + NOSE],
    [geo.exit1, geo.wall1, geo.wall1 - NOSE],
  ] as const) {
    g.fillStyle = COL.pitSurface;
    g.beginPath();
    g.moveTo(x(a), y(PIT_D.SEP));
    g.lineTo(x(b), y(PIT_D.BOX_TOP));
    g.lineTo(x(c), y(PIT_D.BOX_TOP));
    g.lineTo(x(c), y(PIT_D.SEP));
    g.closePath();
    g.fill();
    g.fillStyle = COL.curbFace;
    g.beginPath();
    g.moveTo(x(a), y(PIT_D.SEP));
    g.lineTo(x(b), y(PIT_D.BOX_TOP));
    g.lineTo(x(c), y(PIT_D.BOX_TOP));
    g.lineTo(x(c), y(PIT_D.LABEL_TOP));
    g.lineTo(x(b), y(PIT_D.LABEL_TOP));
    g.lineTo(x(a) + (a < b ? -14 : 14), y(PIT_D.SEP - 6));
    g.closePath();
    g.fill();
    g.strokeStyle = COL.curbTop;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(a), y(PIT_D.SEP - 1));
    g.lineTo(x(b), y(PIT_D.BOX_TOP - 1));
    g.lineTo(x(c), y(PIT_D.BOX_TOP - 1));
    g.stroke();
    // Pointed end of the pit wall.
    g.fillStyle = COL.sep;
    g.beginPath();
    g.moveTo(x(b), y(SEP_MID));
    g.lineTo(x(c), y(PIT_D.WALL_TOP));
    g.lineTo(x(c), y(PIT_D.SEP));
    g.closePath();
    g.fill();
    g.strokeStyle = '#FFC21A';
    g.lineWidth = 1.5;
    g.stroke();
  }
  const L = pitPaint(track);
  withPaddock(track, g, () => drawCenter(g, createRng(77)));
  g.save();
  g.translate(0, geo.y0 - PADDOCK_ORIGIN.y);
  drawPitRoad(g, L);
  g.restore();
  // Chevrons and PIT lettering on the entry and exit roads.
  g.font = `10px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,248,232,0.7)';
  g.fillText('PIT', x(geo.wall0 - 40), y(PIT_D.SEP - 12));
  g.fillText('PIT', x(geo.wall1 + 40), y(PIT_D.SEP - 12));
}

function drawGrid({ g, track }: Ctx): void {
  const half = 11;
  g.font = `7px ${FONT_BLACK}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let slot = 0; slot < 20; slot++) {
    const q = track.gridSlot(slot);
    const p = track.pointAt(q.s + CONFIG.CAR_LEN / 2 + 3, q.d);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    g.fillStyle = 'rgba(255,248,232,0.95)';
    g.fillRect(x, y - half, 2, half * 2);
    g.fillRect(x - 9, y - half, 9, 2);
    g.fillRect(x - 9, y + half - 2, 9, 2);
    g.fillStyle = 'rgba(255,248,232,0.85)';
    g.fillText(String(slot + 1), x + 4, y + 1);
  }
}

function drawFinishLine(g: CanvasRenderingContext2D, track: SegmentTrack): void {
  const p = track.pointAt(0, 0);
  const top = p.y - HALF_W;
  for (let y = top; y < p.y + HALF_W; y += 5) {
    for (let c = 0; c < 3; c++) {
      g.fillStyle = ((y - top) / 5 + c) % 2 < 1 ? '#FFF8E8' : '#17142B';
      g.fillRect(p.x - 7 + c * 5, y, 5, 5);
    }
  }
}

function drawLitFinish(g: CanvasRenderingContext2D, track: SegmentTrack): void {
  const p = track.pointAt(0, 0);
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, 70);
  gr.addColorStop(0, 'rgba(255,240,200,0.35)');
  gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr;
  g.fillRect(p.x - 70, p.y - 70, 140, 140);
  g.globalCompositeOperation = 'source-over';
  g.shadowColor = 'rgba(255,248,232,0.8)';
  g.shadowBlur = 8;
  drawFinishLine(g, track);
  g.shadowBlur = 0;
  drawFinishLine(g, track);
}

/** Fine grain over everything, as a repeated tile instead of a per-pixel pass. */
function addNoise(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void {
  const tile = makeCanvas(97, 89);
  const tg = tile.getContext('2d')!;
  for (let i = 0; i < 97 * 89 * 0.5; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    tg.fillStyle = `rgba(${v},${v},${v},${0.02 + rng() * 0.03})`;
    tg.fillRect((rng() * 97) | 0, (rng() * 89) | 0, 1, 1);
  }
  g.fillStyle = g.createPattern(tile, 'repeat')!;
  g.fillRect(0, 0, w, h);
}

function nightLighting(ctx: Ctx, rng: Rng): void {
  const { g, track, theme } = ctx;
  const W = track.worldW;
  const H = track.worldH;
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#6e6ea0';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const pool = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, `rgba(${theme.lamp},${a})`);
    gr.addColorStop(0.6, `rgba(${theme.lamp},${a * 0.35})`);
    gr.addColorStop(1, `rgba(${theme.lamp},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  const masts: Pt[] = [];
  for (let s = 0, k = 0; s < track.len; s += 100, k++) {
    const p = track.pointAt(s, k % 2 ? 20 : -20);
    pool(p.x, p.y, 90, 0.3);
    const side = k % 2 ? 1 : -1;
    if (side < 0 && inPitS(ctx, s)) continue;
    const m = track.pointAt(s, side * (HALF_W + track.kerbs(s)[side < 0 ? 0 : 1] + WALL_W + 8));
    masts.push([m.x, m.y]);
  }
  const geo = track.pit.geo;
  for (let u = geo.wall0 + 60; u < geo.wall1; u += 140) pool(geo.x0 + u, geo.y0 - 80, 80, 0.22);
  g.globalCompositeOperation = 'source-over';
  for (const [x, y] of masts) {
    g.fillStyle = '#26242F';
    g.fillRect(x - 1, y - 6, 3, 8);
    g.fillStyle = '#FFF4D0';
    g.shadowColor = '#FFD27A';
    g.shadowBlur = 10;
    g.fillRect(x - 3, y - 8, 7, 3);
    g.shadowBlur = 0;
  }
  for (let i = 0; i < 60; i++) {
    const x = rng() * W;
    const y = rng() * H;
    if (Math.abs(track.project(x, y).d) < 120) continue;
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(x, y, 1, 1);
  }
}
