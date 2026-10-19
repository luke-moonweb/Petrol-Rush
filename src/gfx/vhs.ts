// The VHS tracking glitch that covers the switch from the top-down view to the cockpit, a moment
// long: the picture of a worn tape losing its tracking and finding it again. The artifacts are those of analog VHS playback:
// rows torn sideways by noise bands that roll down the picture (the heads reading between the
// tracks), the head-switching band at the bottom, snow and white dropout streaks, colour that lags
// to the right of the picture (VHS records colour at a fraction of the luma bandwidth), a vertical
// roll with the black blanking bar while the sync is lost, and the soft 240-line picture of a field.
import type { Box } from '../layout';
import { makeCanvas } from './sprites';

/** Seconds the glitch lasts. */
export const VHS_S = 0.6;
/** The cockpit replaces the top-down view at the peak of the noise, which hides the cut. */
export const VHS_CUT_S = 0.14;
/** Full noise this long after the cut; then the picture settles. */
const HOLD_S = 0.04;
/** The vertical roll: the picture slides down from ROLL_FROM_S until the sync locks at ROLL_TO_S. */
const ROLL_FROM_S = 0.07;
const ROLL_TO_S = 0.23;
/** Picture heights per second. */
const ROLL_SPEED = 2.4;
/** The black blanking bar between two pictures in a roll, as a share of the picture height. */
const BAR = 0.06;

/** The picture at VHS resolution: about 240 TV lines across (320 samples), one field of 240 lines. */
const SRC_W = 320;
const SRC_H = 240;
/** The colour, at an eighth of the luma's resolution. */
const CHROMA_W = 40;
/** Rows of the picture torn sideways on their own. */
const ROWS = 96;
/** The head-switching band: the bottom share of the picture. */
const HEAD = 0.06;
/** The snow: a tile made once, and the samples of it across one field (finer than the picture). */
const SNOW_W = 1024;
const SNOW_H = 256;
const GRAIN_W = 640;

let pic: HTMLCanvasElement | null = null;
let chroma: HTMLCanvasElement | null = null;
let snow: HTMLCanvasElement | null = null;
// per row: the sideways shift (in SRC_W samples) and the source line (-1: the blanking bar)
const shift = new Float32Array(ROWS);
const line = new Float32Array(ROWS);
let seed = 0;

/** The glitch's clock; `RaceState` starts it on a switch to the cockpit, steps it and draws it over the view. */
export class VhsGlitch {
  private t = VHS_S;
  private runs = 0;

  start(): void {
    this.t = 0;
    this.runs++;
  }

  reset(): void {
    this.t = VHS_S;
  }

  update(dt: number): void {
    if (this.t < VHS_S) this.t = Math.min(VHS_S, this.t + dt);
  }

  get active(): boolean {
    return this.t < VHS_S;
  }

  /** Whether to draw the cockpit: the top-down view stays until the cut. */
  cockpitShown(cockpit: boolean): boolean {
    return cockpit && !(this.active && this.t < VHS_CUT_S);
  }

  /** Distorts the picture already drawn in `box` (layout units, `pixelScale` canvas pixels each). */
  draw(g: CanvasRenderingContext2D, box: Box, pixelScale: number): void {
    if (!this.active) return;
    // new noise every field (60 a second), the same for the same moment of the same glitch
    seed = this.runs * 7919 + Math.floor(this.t * 60);
    drawVhs(g, box, pixelScale, this.t);
  }
}

/** How strong the noise is `t` seconds into the glitch, 0..1: a sudden onset, the peak at the cut, then it settles. */
export function vhsStrength(t: number): number {
  if (t >= VHS_S || t < 0) return 0;
  if (t < VHS_CUT_S) return 0.4 + (0.6 * t) / VHS_CUT_S;
  const u = Math.max(0, t - VHS_CUT_S - HOLD_S) / (VHS_S - VHS_CUT_S - HOLD_S);
  return (1 - u) * (1 - u);
}

/** How far the picture has rolled down `t` seconds into the glitch, in picture heights (0 once the sync locks). */
export function vhsRoll(t: number): number {
  return t >= ROLL_FROM_S && t < ROLL_TO_S ? (t - ROLL_FROM_S) * ROLL_SPEED : 0;
}

/** A seeded generator (mulberry32), so a glitch frame draws the same noise every time. */
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A tracking noise band: its centre and half height, as shares of the picture height. */
interface Band {
  y: number;
  half: number;
}

function band(t: number, s: number, phase: number): Band {
  return { y: ((phase + t * 1.6) % 1.3) - 0.15, half: 0.03 + 0.05 * s };
}

function drawVhs(g: CanvasRenderingContext2D, box: Box, pixelScale: number, t: number): void {
  const s = vhsStrength(t);
  const x = Math.round(box.x * pixelScale);
  const y = Math.round(box.y * pixelScale);
  const w = Math.round(box.w * pixelScale);
  const h = Math.round(box.h * pixelScale);
  if (s <= 0 || w < 2 || h < 2) return;
  copyPicture(g.canvas, x, y, w, h);
  const bands = [band(t, s, 0.15), band(t, s * 0.6, 0.75)];
  tearRows(t, s, bands);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  drawRows(g, x, y, w, h, s);
  drawSnow(g, x, y, w, h, s, bands);
  g.restore();
}

/** The view, shrunk to one VHS field (`pic`) and its colour to an eighth of that (`chroma`). */
function copyPicture(from: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  pic ??= makeCanvas(SRC_W, SRC_H);
  chroma ??= makeCanvas(CHROMA_W, SRC_H);
  const p = pic.getContext('2d')!;
  p.imageSmoothingEnabled = true;
  p.imageSmoothingQuality = 'medium';
  p.drawImage(from, x, y, w, h, 0, 0, SRC_W, SRC_H);
  const c = chroma.getContext('2d')!;
  c.imageSmoothingEnabled = true;
  c.drawImage(pic, 0, 0, SRC_W, SRC_H, 0, 0, CHROMA_W, SRC_H);
}

/** Fills `shift` and `line` for this field: edge wave, jitter, the tracking bands, head switching, the roll. */
function tearRows(t: number, s: number, bands: Band[]): void {
  const roll = vhsRoll(t);
  for (let i = 0; i < ROWS; i++) {
    const yn = (i + 0.5) / ROWS;
    let dx = Math.sin(yn * 17 + t * 37) * 1.2 + (rand() - 0.5) * 1.6;
    for (const b of bands) {
      const k = 1 - Math.abs(yn - b.y) / b.half;
      if (k > 0) dx += k * (8 + 30 * rand()) * (rand() < 0.75 ? 1 : -1);
    }
    if (yn > 1 - HEAD) dx += ((yn - 1 + HEAD) / HEAD) * (14 + 12 * rand());
    shift[i] = dx * s;
    const pos = (((yn - roll) % (1 + BAR)) + 1 + BAR) % (1 + BAR);
    line[i] = pos < 1 ? pos * SRC_H : -1;
  }
}

/** The torn rows, black where they leave the picture, then their colour lagging to the right. */
function drawRows(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
  const unit = w / SRC_W;
  const rowH = SRC_H / ROWS;
  const alpha = Math.min(1, s * 3);
  g.imageSmoothingEnabled = true;
  g.globalAlpha = alpha;
  g.fillStyle = '#000';
  for (let i = 0; i < ROWS; i++) {
    const y0 = y + Math.round((i * h) / ROWS);
    const rh = y + Math.round(((i + 1) * h) / ROWS) - y0;
    const dx = Math.round(shift[i]! * unit);
    if (line[i]! < 0) {
      g.fillRect(x, y0, w, rh);
      continue;
    }
    g.drawImage(pic!, 0, line[i]!, SRC_W, rowH, x + dx, y0, w, rh);
    if (dx > 0) g.fillRect(x, y0, dx, rh);
    else if (dx < 0) g.fillRect(x + w + dx, y0, -dx, rh);
  }
  g.globalCompositeOperation = 'color';
  g.globalAlpha = alpha * 0.85;
  const lag = Math.round((2 + 5 * s) * unit);
  for (let i = 0; i < ROWS; i++) {
    if (line[i]! < 0) continue;
    const y0 = y + Math.round((i * h) / ROWS);
    const rh = y + Math.round(((i + 1) * h) / ROWS) - y0;
    g.drawImage(chroma!, 0, line[i]!, CHROMA_W, rowH, x + Math.round(shift[i]! * unit) + lag, y0, w, rh);
  }
  g.globalCompositeOperation = 'source-over';
}

/** Snow: a veil near the peak that hides the cut, sparkle over the picture, brighter in the bands, and dropout streaks. */
function drawSnow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, bands: Band[]): void {
  const tile = snowTile();
  const field = (dy: number, dh: number) =>
    g.drawImage(tile, Math.floor(rand() * (SNOW_W - GRAIN_W)), Math.floor(rand() * (SNOW_H - SRC_H)), GRAIN_W, SRC_H, x, dy, w, dh);
  g.imageSmoothingEnabled = false;
  g.globalAlpha = s * s * s * 0.8;
  field(y, h);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = s * 0.4;
  field(y, h);
  for (const b of bands) {
    g.globalAlpha = s * 0.8;
    field(y + (b.y - b.half) * h, 2 * b.half * h);
  }
  g.globalAlpha = s * 0.7;
  field(y + (1 - HEAD) * h, HEAD * h);
  g.fillStyle = '#fff';
  const lineH = Math.max(1, Math.round(h / SRC_H));
  for (let i = Math.round(4 + 14 * s); i > 0; i--) {
    const b = bands[i % bands.length]!;
    const sy = rand() < 0.7 ? b.y + (rand() * 2 - 1) * b.half : rand();
    g.globalAlpha = (0.3 + 0.6 * rand()) * s;
    g.fillRect(x + rand() * w, y + sy * h, w * (0.04 + 0.35 * rand()), lineH);
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
}

/** Tape noise, drawn once: mostly dark with bright speckles, in short horizontal runs; some lines brighter, a little colour noise. */
function snowTile(): HTMLCanvasElement {
  if (snow) return snow;
  snow = makeCanvas(SNOW_W, SNOW_H);
  const c = snow.getContext('2d')!;
  const img = c.createImageData(SNOW_W, SNOW_H);
  const d = img.data;
  for (let row = 0; row < SNOW_H; row++) {
    const gain = 0.55 + 0.45 * rand();
    let v = 0;
    let tint = 0;
    let run = 0;
    for (let col = 0; col < SNOW_W; col++) {
      if (run-- <= 0) {
        const r = rand();
        v = r * r * 255 * gain;
        tint = (rand() - 0.5) * 40;
        run = Math.floor(rand() * rand() * 8);
      }
      const i = (row * SNOW_W + col) * 4;
      d[i] = v + tint;
      d[i + 1] = v;
      d[i + 2] = v - tint;
      d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return snow;
}
