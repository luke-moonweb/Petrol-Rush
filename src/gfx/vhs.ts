// The VHS look of the cockpit picture, after a worn tape losing its tracking: rows torn sideways by
// noise bands that roll down the picture (the heads reading between the tracks), the head-switching
// band at the bottom, snow and white dropout streaks, colour that lags to the right of the picture
// (VHS records colour at a fraction of the luma bandwidth), a vertical roll with the black blanking
// bar while the sync is lost, and the soft 240-line picture of a field. Two uses:
// - the glitch that covers the switch from the top-down view into the cockpit: the whole picture, a
//   moment long;
// - the cockpit's unrest when the car hits something: the lower part of the picture breaks up for a
//   moment, by the hit's strength (never as strong as the switch), and stays broken through a spin
//   the hit set off.
import type { Box } from '../layout';
import type { Car } from '../race/car';
import { makeCanvas } from './sprites';

/** Seconds the switch glitch lasts. */
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

/** The most a hit brings to the cockpit picture (the switch peaks at 1). */
export const UNREST_MAX = 0.5;
/** A spin that a hit set off holds the unrest at least here. */
const SPIN_UNREST = 0.42;
/** How fast the unrest of a hit fades, per second. */
const SHAKE_FADE = 0.8;
/** The share of the picture, from the bottom, the unrest reaches at the most. */
const REACH_MAX = 0.42;

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

/** One field of the effect. */
interface Look {
  /** 0..1: how hard the rows tear and how thick the snow. */
  s: number;
  /** Rows above this share of the picture height are left alone (0: the whole picture). */
  top: number;
  /** The rows below `top` fade in over this share of the picture height. */
  fade: number;
  /** 0..1: the strength of the tracking bands. */
  bands: number;
  /** Picture heights the picture has rolled down. */
  roll: number;
  /** Seconds: moves the bands and the edge wave. */
  t: number;
}

/** A tracking noise band: its centre and half height, as shares of the picture height. */
interface Band {
  y: number;
  half: number;
}

let pic: HTMLCanvasElement | null = null;
let chroma: HTMLCanvasElement | null = null;
let snow: HTMLCanvasElement | null = null;
// per row: the sideways shift (in SRC_W samples), the source line (-1: the blanking bar) and how much
// of the effect it gets (0 above the reach)
const shift = new Float32Array(ROWS);
const line = new Float32Array(ROWS);
const weight = new Float32Array(ROWS);
const look: Look = { s: 0, top: 0, fade: 0, bands: 0, roll: 0, t: 0 };
const BANDS: Band[] = [
  { y: 0, half: 0 },
  { y: 0, half: 0 },
];
let seed = 0;

/** The effect's clocks: `RaceState` starts the switch, steps it, jolts it on hits and draws it over the view. */
export class VhsGlitch {
  private t = VHS_S;
  private runs = 0;
  /** Seconds of unrest so far (moves its noise fields). */
  private clock = 0;
  /** The unrest left of the last hit. */
  private shake = 0;

  start(): void {
    this.t = 0;
    this.runs++;
  }

  /** Ends the switch glitch and calms the unrest (a new race, or back to the top-down view). */
  reset(): void {
    this.t = VHS_S;
    this.shake = 0;
  }

  update(dt: number): void {
    if (this.t < VHS_S) this.t = Math.min(VHS_S, this.t + dt);
    this.clock += dt;
    this.shake = Math.max(0, this.shake - SHAKE_FADE * dt);
  }

  /** Shakes the cockpit picture on a hit (`level` 0..UNREST_MAX, `joltOf`), which then fades; a spin the hit set off holds it up. */
  jolt(level: number, spinning: boolean): void {
    if (spinning && this.shake > 0) level = Math.max(level, SPIN_UNREST);
    this.shake = Math.max(this.shake, Math.min(UNREST_MAX, level));
  }

  /** The cockpit picture's unrest now (0 unless a hit shook it). */
  get unrest(): number {
    return this.shake;
  }

  /** Whether the switch glitch runs. */
  get active(): boolean {
    return this.t < VHS_S;
  }

  /** Whether to draw the cockpit: the top-down view stays until the cut. */
  cockpitShown(cockpit: boolean): boolean {
    return cockpit && !(this.active && this.t < VHS_CUT_S);
  }

  /**
   * Distorts the picture already drawn in `box` (layout units, `pixelScale` canvas pixels each): the
   * switch glitch, or the unrest of a hit when `cockpit` (the cockpit is on screen).
   */
  draw(g: CanvasRenderingContext2D, box: Box, pixelScale: number, cockpit: boolean): void {
    if (this.active) {
      switchLook(this.t, cockpit && this.shake > 0 ? this.shake : null);
      // new noise every field (60 a second), the same for the same moment of the same glitch
      seed = this.runs * 7919 + Math.floor(this.t * 60);
    } else if (cockpit && this.shake > 0) {
      unrestLook(this.shake, this.clock);
      seed = 0x5eed + Math.floor(this.clock * 60);
    } else return;
    drawVhs(g, box, pixelScale);
  }
}

/** How hard a car is hit this step, for the cockpit picture: a wall or car hit by its strength (0 for a scrape). */
export function joltOf(car: Pick<Car, 'wallImpact' | 'contactStrength'>): number {
  const hit = Math.max(car.wallImpact, car.contactStrength);
  return hit < 4 ? 0 : 0.3 + 0.2 * Math.min(1, hit / 80);
}

/** How strong the switch glitch is `t` seconds in, 0..1: a sudden onset, the peak at the cut, then it settles. */
export function vhsStrength(t: number): number {
  if (t >= VHS_S || t < 0) return 0;
  if (t < VHS_CUT_S) return 0.4 + (0.6 * t) / VHS_CUT_S;
  const u = Math.max(0, t - VHS_CUT_S - HOLD_S) / (VHS_S - VHS_CUT_S - HOLD_S);
  return (1 - u) * (1 - u);
}

/** How far the picture has rolled down `t` seconds into the switch glitch, in picture heights (0 once the sync locks). */
export function vhsRoll(t: number): number {
  return t >= ROLL_FROM_S && t < ROLL_TO_S ? (t - ROLL_FROM_S) * ROLL_SPEED : 0;
}

/** The share of the picture, from the top, the cockpit's unrest leaves alone. */
export function unrestTop(unrest: number): number {
  return 1 - REACH_MAX * Math.min(1, Math.max(0, unrest / UNREST_MAX));
}

function unrestLook(unrest: number, clock: number): void {
  look.s = unrest;
  look.top = unrestTop(unrest);
  look.fade = Math.max(0.02, (1 - look.top) * 0.3);
  look.bands = Math.min(1, Math.max(0, (unrest - 0.3) / 0.25));
  look.roll = 0;
  look.t = clock;
}

/** The switch glitch; after the cut (`unrest` given) it settles into the cockpit's unrest without a seam. */
function switchLook(t: number, unrest: number | null): void {
  const s = vhsStrength(t);
  look.s = s;
  look.top = 0;
  look.fade = 0;
  look.bands = 1;
  look.roll = vhsRoll(t);
  look.t = t;
  if (unrest === null) return;
  // 1 at the peak, 0 once the glitch has faded to the unrest: from there on it is the unrest's look
  const f = Math.min(1, Math.max(0, (s - unrest) / (1 - unrest)));
  unrestLook(unrest, t);
  look.s = Math.max(s, unrest);
  look.top *= 1 - f;
  look.fade *= 1 - f;
  look.bands += (1 - look.bands) * f;
  look.roll = vhsRoll(t);
}

/** A seeded generator (mulberry32), so a field draws the same noise every time. */
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Places a tracking band inside the reach of the look: `phase` spreads the two bands apart. */
function placeBand(b: Band, phase: number, size: number): void {
  const span = 1 - look.top;
  b.y = look.top + span * (((phase + look.t * 1.6) % 1.3) - 0.15);
  b.half = span * (0.03 + 0.05 * look.s * size);
}

function drawVhs(g: CanvasRenderingContext2D, box: Box, pixelScale: number): void {
  const x = Math.round(box.x * pixelScale);
  const y = Math.round(box.y * pixelScale);
  const w = Math.round(box.w * pixelScale);
  const h = Math.round(box.h * pixelScale);
  if (look.s <= 0 || w < 2 || h < 2) return;
  copyPicture(g.canvas, x, y, w, h);
  placeBand(BANDS[0]!, 0.15, 1);
  placeBand(BANDS[1]!, 0.75, 0.6);
  tearRows();
  const top = y + Math.floor(look.top * h);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(x, top, w, y + h - top);
  g.clip();
  drawRows(g, x, y, w, h);
  drawSnow(g, x, y, w, h);
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

/** Fills `shift`, `line` and `weight` for this field: edge wave, jitter, the tracking bands, head switching, the roll. */
function tearRows(): void {
  const { s, top, fade, t } = look;
  for (let i = 0; i < ROWS; i++) {
    const yn = (i + 0.5) / ROWS;
    const wt = top <= 0 ? 1 : Math.min(1, Math.max(0, (yn - top) / fade));
    weight[i] = wt;
    if (wt === 0) continue;
    let dx = Math.sin(yn * 17 + t * 37) * 1.2 + (rand() - 0.5) * 1.6;
    for (const b of BANDS) {
      const k = 1 - Math.abs(yn - b.y) / b.half;
      if (k > 0) dx += look.bands * k * (8 + 30 * rand()) * (rand() < 0.75 ? 1 : -1);
    }
    if (yn > 1 - HEAD) dx += ((yn - 1 + HEAD) / HEAD) * (14 + 12 * rand());
    shift[i] = dx * s * wt;
    const pos = (((yn - look.roll) % (1 + BAR)) + 1 + BAR) % (1 + BAR);
    line[i] = pos < 1 ? pos * SRC_H : -1;
  }
}

/** The torn rows, black where they leave the picture, then their colour lagging to the right. */
function drawRows(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const unit = w / SRC_W;
  const rowH = SRC_H / ROWS;
  const alpha = Math.min(1, look.s * 3);
  g.imageSmoothingEnabled = true;
  g.fillStyle = '#000';
  for (let i = 0; i < ROWS; i++) {
    if (weight[i] === 0) continue;
    const y0 = y + Math.round((i * h) / ROWS);
    const rh = y + Math.round(((i + 1) * h) / ROWS) - y0;
    const dx = Math.round(shift[i]! * unit);
    g.globalAlpha = alpha * weight[i]!;
    if (line[i]! < 0) {
      g.fillRect(x, y0, w, rh);
      continue;
    }
    g.drawImage(pic!, 0, line[i]!, SRC_W, rowH, x + dx, y0, w, rh);
    if (dx > 0) g.fillRect(x, y0, dx, rh);
    else if (dx < 0) g.fillRect(x + w + dx, y0, -dx, rh);
  }
  g.globalCompositeOperation = 'color';
  const lag = Math.round((2 + 5 * look.s) * unit);
  for (let i = 0; i < ROWS; i++) {
    if (weight[i] === 0 || line[i]! < 0) continue;
    const y0 = y + Math.round((i * h) / ROWS);
    const rh = y + Math.round(((i + 1) * h) / ROWS) - y0;
    g.globalAlpha = alpha * 0.85 * weight[i]!;
    g.drawImage(chroma!, 0, line[i]!, CHROMA_W, rowH, x + Math.round(shift[i]! * unit) + lag, y0, w, rh);
  }
  g.globalCompositeOperation = 'source-over';
}

/** One field of snow over the picture rows `from`..`to` (shares of its height). */
function snowField(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, from: number, to: number): void {
  const sx = Math.floor(rand() * (SNOW_W - GRAIN_W));
  const sy = Math.floor(rand() * (SNOW_H - SRC_H));
  g.drawImage(snowTile(), sx, sy, GRAIN_W, SRC_H, x, y + from * h, w, (to - from) * h);
}

/** Snow over the reach of the look, half as thick where its rows fade in. */
function snowOver(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void {
  if (alpha < 0.01) return;
  const { top, fade } = look;
  if (top > 0) {
    g.globalAlpha = alpha * 0.5;
    snowField(g, x, y, w, h, top, top + fade);
  }
  g.globalAlpha = alpha;
  snowField(g, x, y, w, h, Math.max(0, top + fade), 1);
}

/** Snow: a veil near the peak that hides the cut, sparkle over the picture, brighter in the bands, and dropout streaks. */
function drawSnow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const { s, top } = look;
  g.imageSmoothingEnabled = false;
  snowOver(g, x, y, w, h, s * s * s * 0.8);
  g.globalCompositeOperation = 'lighter';
  snowOver(g, x, y, w, h, s * 0.4);
  if (look.bands > 0) {
    g.globalAlpha = s * 0.8 * look.bands;
    for (const b of BANDS) snowField(g, x, y, w, h, b.y - b.half, b.y + b.half);
  }
  g.globalAlpha = s * 0.7;
  snowField(g, x, y, w, h, 1 - HEAD, 1);
  g.fillStyle = '#fff';
  const lineH = Math.max(1, Math.round(h / SRC_H));
  for (let i = Math.floor((4 + 14 * s) * (1 - top) + rand()); i > 0; i--) {
    const b = BANDS[i % BANDS.length]!;
    const sy = look.bands > 0 && rand() < 0.7 ? b.y + (rand() * 2 - 1) * b.half : top + rand() * (1 - top);
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
