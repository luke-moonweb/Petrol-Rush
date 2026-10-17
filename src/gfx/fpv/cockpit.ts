import type { Car } from '../../race/car';
import type { Race } from '../../race/race';
import type { Warn } from '../../race/warnings';
import { createRng } from '../../sim/rng';
import { drawFuelGauge, drawSpeedo } from '../../ui/hud';
import { FONT_BLACK, PR } from '../../ui/theme';
import { CAR_SCHEMES } from '../vehicles';
import { cabinFor, cabinReadout, joltOffset, LED_COUNT, type Readout } from './cabin';
import { glowSprite, hexRgb } from './engine';

export interface Streak {
  x: number;
  k: number;
}

export interface CabinView {
  race: Race;
  steer: number;
  time: number;
  touch: boolean;
  warn: Warn;
  /** Where the speedo's red arc starts (mph, smoothed). */
  arcFrom: number;
  lights?: { lit: number; out: boolean; since: number };
  standings: Car[];
  streaks: Streak[];
}

const INK = '#0A0912';
const SHELL = '#07060E';
const UNLIT = '#1E1B2C';
const LCD = '#0E1A18';
const PAD = 4;
// Radii the top-down HUD draws its speedo and fuel gauge at; the dash scales them by Geom.dialK.
const SPEEDO_R = 54;
const FUEL_R = 34;
const WARM = '#FFD68C';
export const ROOF_FLOOD = 0.2;
export const PILLAR_FLOOD = 0.14;
const NARROW_W = 520;

const rad = (deg: number) => (deg * Math.PI) / 180;

function rgba(hex: string, a: number): string {
  return `rgba(${hexRgb(hex).join(',')},${a})`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * t)).join(',')})`;
}

const glowKeys = new Map<string, string>();
function glowOf(hex: string): HTMLCanvasElement {
  let k = glowKeys.get(hex);
  if (!k) {
    k = hexRgb(hex).join(',');
    glowKeys.set(hex, k);
  }
  return glowSprite(k);
}

export function wheelRadius(w: number): number {
  return Math.min(w * 0.18, 123);
}

interface Geom {
  w: number;
  h: number;
  cx: number;
  u: number;
  binW: number;
  binTop: number;
  binBot: number;
  ledY: number;
  ledPitch: number;
  ledR: number;
  dialCy: number;
  dialK: number;
  podY: number;
  fuelCx: number;
  podCx: number;
  lcdW: number;
  lcdH: number;
  lampY: number;
  lampW: number;
  lampH: number;
  wheelR: number;
  wheelCy: number;
  captions: boolean;
  glass: Path2D;
  lip: Path2D;
  bead: Path2D;
}

function geom(w: number, h: number, touch: boolean): Geom {
  const cx = w / 2;
  const binW = Math.max(230, Math.min(400, w * 0.46));
  const u = Math.max(0.85, Math.min(1.15, binW / 335));
  const wheelR = wheelRadius(w);
  const glass = new Path2D();
  glass.moveTo(w * 0.13, h * 0.05);
  glass.quadraticCurveTo(w * 0.5, h * 0.17, w * 0.87, h * 0.05);
  glass.lineTo(w * 0.955, h * 0.68);
  glass.lineTo(w * 0.045, h * 0.68);
  glass.closePath();
  const top = h * 0.078;
  const dip = h * 0.145;
  const bead = new Path2D();
  bead.moveTo(w * 0.08, top * 0.72);
  bead.quadraticCurveTo(w * 0.5, dip - h * 0.022, w * 0.92, top * 0.72);
  const ledBot = h * 0.618 + 6;
  const lampTop = h * 0.772 - 11 / 2;
  // The speedo's dial top sits at cy - 54k and its MPH caption ends near cy + 10k.
  const dialK = Math.min(
    1.4,
    (lampTop - ledBot - 6) / (SPEEDO_R + 10),
    (binW * 0.33 - 4) / (SPEEDO_R + FUEL_R),
    (binW * 0.17 - 4) / FUEL_R,
  );
  const lip = new Path2D();
  lip.moveTo(-PAD, h * 0.75);
  lip.bezierCurveTo(w * 0.25, h * 0.75, w * 0.36, h * 0.69, cx, h * 0.69);
  lip.bezierCurveTo(w * 0.64, h * 0.69, w * 0.75, h * 0.75, w + PAD, h * 0.75);
  return {
    w,
    h,
    cx,
    u,
    binW,
    binTop: h * 0.6,
    binBot: h * 0.79,
    ledY: h * 0.618,
    ledPitch: binW * 0.04,
    ledR: 3,
    dialCy: lampTop - 2 - 10 * dialK,
    dialK,
    podY: h * 0.708,
    fuelCx: cx - binW * 0.33,
    podCx: cx + binW * 0.33,
    lcdW: Math.max(56, 64 * u),
    lcdH: Math.max(30, 34 * u),
    lampY: h * 0.772,
    lampW: Math.max(26, 28 * u),
    lampH: 11,
    wheelR,
    wheelCy: h + (w < NARROW_W ? 0.25 : 0.37) * wheelR,
    captions: !touch,
    glass,
    lip,
    bead,
  };
}

function hoodPath(g: CanvasRenderingContext2D, gm: Geom): void {
  const { w, h } = gm;
  const lipY = h * 0.632;
  g.beginPath();
  g.moveTo(-PAD, h * 0.682);
  g.lineTo(w * 0.09, h * 0.67);
  g.quadraticCurveTo(w * 0.26, lipY - h * 0.005, w * 0.4, lipY - h * 0.052);
  g.quadraticCurveTo(w * 0.5, lipY - h * 0.068, w * 0.6, lipY - h * 0.052);
  g.quadraticCurveTo(w * 0.74, lipY - h * 0.005, w * 0.91, h * 0.67);
  g.lineTo(w + PAD, h * 0.682);
}

function drawGlassTint(g: CanvasRenderingContext2D, gm: Geom): void {
  const { w, h } = gm;
  g.save();
  g.clip(gm.glass);
  const v = g.createLinearGradient(0, h * 0.05, 0, h * 0.68);
  v.addColorStop(0, 'rgba(130,160,230,0.07)');
  v.addColorStop(0.2, 'rgba(160,190,255,0.025)');
  v.addColorStop(0.4, 'rgba(160,190,255,0)');
  v.addColorStop(0.8, 'rgba(8,6,14,0)');
  v.addColorStop(1, 'rgba(8,6,14,0.1)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  for (const [x0, x1] of [
    [w * 0.04, w * 0.14],
    [w * 0.96, w * 0.86],
  ] as const) {
    const side = g.createLinearGradient(x0, 0, x1, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.12)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = side;
    g.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
  }
  const spec = g.createLinearGradient(w * 0.2, 0, w * 0.6, 0);
  spec.addColorStop(0, 'rgba(220,235,255,0)');
  spec.addColorStop(0.45, 'rgba(220,235,255,0.06)');
  spec.addColorStop(1, 'rgba(220,235,255,0)');
  g.fillStyle = spec;
  g.beginPath();
  g.moveTo(w * 0.2, h * 0.115);
  g.quadraticCurveTo(w * 0.4, h * 0.13, w * 0.6, h * 0.15);
  g.lineTo(w * 0.6, h * 0.158);
  g.quadraticCurveTo(w * 0.4, h * 0.142, w * 0.2, h * 0.13);
  g.closePath();
  g.fill();
  g.restore();
}

function drawHood(g: CanvasRenderingContext2D, gm: Geom, colorIdx: number): void {
  const { w, h, cx } = gm;
  const s = CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!;
  const body = mix(s.body, INK, 0.72);
  hoodPath(g, gm);
  g.lineTo(w + PAD, h + PAD);
  g.lineTo(-PAD, h + PAD);
  g.closePath();
  g.fillStyle = body;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = mix(s.body, INK, 0.8);
  g.beginPath();
  g.moveTo(cx, h * 0.56);
  g.lineTo(w + PAD, h * 0.6);
  g.lineTo(w + PAD, h + PAD);
  g.lineTo(cx, h + PAD);
  g.closePath();
  g.fill();
  const deck = g.createLinearGradient(0, h * 0.62, 0, h * 0.74);
  deck.addColorStop(0, 'rgba(5,4,10,0)');
  deck.addColorStop(1, 'rgba(5,4,10,0.75)');
  g.fillStyle = deck;
  g.fillRect(-PAD, h * 0.6, w + PAD * 2, h * 0.2);
  g.restore();
  g.strokeStyle = rgba(s.roof, 0.3);
  g.lineWidth = 1.5;
  g.save();
  g.translate(0, 1.5);
  hoodPath(g, gm);
  g.stroke();
  g.restore();
  g.strokeStyle = rgba(PR.cream, 0.06);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, h * 0.568);
  g.lineTo(cx, h * 0.7);
  g.stroke();
  // Parked wiper blades lying on the hood lip.
  g.save();
  g.beginPath();
  g.rect(w * 0.2, 0, w * 0.26, h);
  g.rect(w * 0.53, 0, w * 0.26, h);
  g.clip();
  g.translate(0, -2);
  hoodPath(g, gm);
  g.strokeStyle = '#040308';
  g.lineWidth = 2.5;
  g.stroke();
  g.restore();
}

function drawRoof(g: CanvasRenderingContext2D, gm: Geom): void {
  const { w, h } = gm;
  const top = h * 0.078;
  const dip = h * 0.145;
  g.fillStyle = SHELL;
  g.beginPath();
  g.moveTo(-PAD, -PAD);
  g.lineTo(w + PAD, -PAD);
  g.lineTo(w + PAD, top);
  g.quadraticCurveTo(w * 0.5, dip, -PAD, top);
  g.closePath();
  g.fill();
  const soffit = g.createLinearGradient(0, top * 0.4, 0, dip);
  soffit.addColorStop(0, '#1A1726');
  soffit.addColorStop(0.5, '#0E0C16');
  soffit.addColorStop(1, '#08070F');
  g.fillStyle = soffit;
  g.beginPath();
  g.moveTo(w * 0.05, top * 0.55);
  g.quadraticCurveTo(w * 0.5, dip - h * 0.01, w * 0.95, top * 0.55);
  g.lineTo(w * 0.97, top + h * 0.012);
  g.quadraticCurveTo(w * 0.5, dip + h * 0.016, w * 0.03, top + h * 0.012);
  g.closePath();
  g.fill();
  g.strokeStyle = rgba(PR.teal, 0.3);
  g.lineWidth = Math.max(1.2, w * 0.0022);
  g.stroke(gm.bead);
}

function drawPillars(g: CanvasRenderingContext2D, gm: Geom): void {
  const { w, h } = gm;
  const bot = h * 0.695;
  for (const side of [-1, 1]) {
    const x = (f: number) => (side < 0 ? w * f : w - w * f);
    const edge = side < 0 ? -PAD : w + PAD;
    g.fillStyle = '#05040A';
    g.beginPath();
    g.moveTo(edge, -PAD);
    g.lineTo(x(0.145), -PAD);
    g.lineTo(x(0.058), bot);
    g.lineTo(x(0.07), h * 0.74);
    g.lineTo(edge, h * 0.74);
    g.closePath();
    g.fill();
    const face = g.createLinearGradient(x(0.02), 0, x(0.12), bot);
    face.addColorStop(0, '#18151F');
    face.addColorStop(1, INK);
    g.fillStyle = face;
    g.beginPath();
    g.moveTo(x(0.118), h * 0.008);
    g.lineTo(x(0.145), -PAD);
    g.lineTo(x(0.058), bot);
    g.lineTo(x(0.042), bot - h * 0.012);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PR.cream, 0.15);
    g.lineWidth = Math.max(2, w * 0.0032);
    g.beginPath();
    g.moveTo(x(0.128), h * 0.016);
    g.lineTo(x(0.048), bot - h * 0.018);
    g.stroke();
    g.strokeStyle = rgba(PR.teal, 0.18);
    g.lineWidth = Math.max(1, w * 0.0018);
    g.beginPath();
    g.moveTo(x(0.134), h * 0.02);
    g.lineTo(x(0.054), bot - h * 0.022);
    g.stroke();
  }
}

function drawDash(g: CanvasRenderingContext2D, gm: Geom): void {
  const { w, h } = gm;
  const body = new Path2D(gm.lip);
  body.lineTo(w + PAD, h + PAD);
  body.lineTo(-PAD, h + PAD);
  body.closePath();
  const dash = g.createLinearGradient(0, h * 0.69, 0, h);
  dash.addColorStop(0, '#1C1A28');
  dash.addColorStop(0.35, '#12101A');
  dash.addColorStop(1, '#08070E');
  g.fillStyle = dash;
  g.fill(body);
  g.save();
  g.clip(body);
  const wash = g.createLinearGradient(0, h * 0.69, 0, h * 0.8);
  wash.addColorStop(0, rgba(PR.teal, 0.14));
  wash.addColorStop(1, rgba(PR.teal, 0));
  g.fillStyle = wash;
  g.fillRect(-PAD, h * 0.68, w + PAD * 2, h * 0.12);
  g.restore();
  g.strokeStyle = rgba(PR.teal, 0.35);
  g.lineWidth = 1.2;
  g.stroke(gm.lip);
}

function caption(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, px = 8): void {
  g.font = `bold ${px}px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y);
}

const LAMPS = ['PIT', 'FUEL', 'SKID', 'PEN', 'REV'] as const;
const LAMP_SHORT = ['P', 'F', 'S', '!', 'R'] as const;
const LAMP_COLORS = [PR.teal, PR.amber, PR.red, PR.red, PR.amber];

function lampCaption(g: CanvasRenderingContext2D, gm: Geom, i: number, color: string): void {
  const text = gm.captions ? LAMPS[i]! : LAMP_SHORT[i]!;
  caption(g, text, lampX(gm, i) + gm.lampW / 2, gm.lampY + 0.5, color, gm.captions ? 8 : 9);
}

function lampX(gm: Geom, i: number): number {
  return gm.cx + (i - 2) * (gm.lampW + 4) - gm.lampW / 2;
}

function drawBinnacle(g: CanvasRenderingContext2D, gm: Geom, colorIdx: number): void {
  const { h, cx, binW } = gm;
  const L = cx - binW / 2;
  const R = cx + binW / 2;
  const s = CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!;
  const cowl = new Path2D();
  cowl.moveTo(L, gm.binBot);
  cowl.lineTo(L, h * 0.7);
  cowl.bezierCurveTo(L, h * 0.625, cx - binW * 0.3, gm.binTop, cx, gm.binTop);
  cowl.bezierCurveTo(cx + binW * 0.3, gm.binTop, R, h * 0.625, R, h * 0.7);
  cowl.lineTo(R, gm.binBot);
  cowl.quadraticCurveTo(cx, gm.binBot + h * 0.004, L, gm.binBot);
  cowl.closePath();
  g.fillStyle = INK;
  g.fill(cowl);
  const shade = g.createLinearGradient(0, gm.binTop, 0, gm.binBot);
  shade.addColorStop(0, '#15131F');
  shade.addColorStop(0.3, '#0B0A13');
  shade.addColorStop(1, '#060509');
  g.fillStyle = shade;
  g.fill(cowl);
  g.strokeStyle = rgba(PR.steel, 0.28);
  g.lineWidth = 1;
  g.stroke(cowl);

  const half = (LED_COUNT - 1) / 2;
  const hw = half * gm.ledPitch + gm.ledPitch * 0.6;
  g.fillStyle = '#040308';
  g.beginPath();
  g.roundRect(cx - hw, gm.ledY - 6, hw * 2, 12, 6);
  g.fill();
  g.strokeStyle = rgba(s.roof, 0.25);
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = UNLIT;
  for (let i = 0; i < LED_COUNT; i++) {
    g.beginPath();
    g.arc(cx + (i - half) * gm.ledPitch, gm.ledY, gm.ledR, 0, Math.PI * 2);
    g.fill();
  }

  const lx = gm.podCx - gm.lcdW / 2;
  const ly = gm.podY - gm.lcdH / 2;
  g.save();
  g.shadowColor = rgba(PR.teal, 0.35);
  g.shadowBlur = 8;
  g.fillStyle = '#05040C';
  g.beginPath();
  g.roundRect(lx - 3, ly - 3, gm.lcdW + 6, gm.lcdH + 6, 4);
  g.fill();
  g.restore();
  g.strokeStyle = rgba(PR.steel, 0.3);
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = LCD;
  g.fillRect(lx, ly, gm.lcdW, gm.lcdH);

  for (let i = 0; i < LAMPS.length; i++) {
    g.fillStyle = '#1A1826';
    g.beginPath();
    g.roundRect(lampX(gm, i), gm.lampY - gm.lampH / 2, gm.lampW, gm.lampH, 3);
    g.fill();
    lampCaption(g, gm, i, rgba(LAMP_COLORS[i]!, 0.35));
  }
}

interface Layer {
  key: string;
  scale: number;
  colorIdx: number;
  touch: boolean;
  gm: Geom;
  shell: HTMLCanvasElement;
  wheel: HTMLCanvasElement;
  glove: HTMLCanvasElement;
}

let cache: Layer | null = null;
let pending = '';
let used = false;

function layer(w: number, h: number, scale: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  return { canvas, g };
}

function buildShell(gm: Geom, scale: number, colorIdx: number): HTMLCanvasElement {
  const { canvas, g } = layer(gm.w + PAD * 2, gm.h + PAD * 2, scale);
  g.translate(PAD, PAD);
  drawGlassTint(g, gm);
  drawHood(g, gm, colorIdx);
  drawRoof(g, gm);
  drawPillars(g, gm);
  drawDash(g, gm);
  drawBinnacle(g, gm, colorIdx);
  return canvas;
}

function buildWheel(r: number, scale: number, colorIdx: number): HTMLCanvasElement {
  const s = CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!;
  const size = r * 2.4;
  const { canvas, g } = layer(size, size, scale);
  g.translate(size / 2, size / 2);
  for (const a of [0, Math.PI / 2, Math.PI]) {
    g.save();
    g.rotate(a);
    g.fillStyle = '#1C1A26';
    g.beginPath();
    g.moveTo(r * 0.2, -r * 0.07);
    g.lineTo(r * 0.92, -r * 0.1);
    g.lineTo(r * 0.92, r * 0.1);
    g.lineTo(r * 0.2, r * 0.07);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PR.steel, 0.25);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r * 0.22, -r * 0.03);
    g.lineTo(r * 0.88, -r * 0.04);
    g.stroke();
    g.restore();
  }
  g.fillStyle = '#14121C';
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rgba(PR.steel, 0.45);
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = '#06050A';
  g.lineWidth = r * 0.24;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#1A1520';
  g.lineWidth = r * 0.17;
  g.stroke();
  g.strokeStyle = rgba(PR.muted, 0.45);
  g.lineWidth = 1;
  g.setLineDash([r * 0.04, r * 0.035]);
  g.beginPath();
  g.arc(0, 0, r - r * 0.05, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.rotate(-Math.PI / 2);
  g.fillStyle = s.body;
  g.fillRect(r * 0.885, -r * 0.035, r * 0.23, r * 0.07);
  return canvas;
}

// Left glove gripping the rim; x points out of the rim, +y towards 12 o'clock.
function buildGlove(r: number, scale: number, colorIdx: number): HTMLCanvasElement {
  const s = CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!;
  const size = r * 0.5;
  const { canvas, g } = layer(size, size, scale);
  g.translate(size / 2, size / 2);
  g.fillStyle = mix(s.body, INK, 0.72);
  g.beginPath();
  g.ellipse(0, 0, r * 0.12, r * 0.15, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = mix(s.body, INK, 0.58);
  g.fillRect(r * 0.01, -r * 0.2, r * 0.2, r * 0.4);
  g.restore();
  g.fillStyle = mix(s.body, INK, 0.82);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-r * 0.1, (i - 1.5) * r * 0.06, r * 0.035, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = mix(s.body, INK, 0.58);
  g.beginPath();
  g.ellipse(r * 0.05, r * 0.12, r * 0.045, r * 0.07, -0.5, 0, Math.PI * 2);
  g.fill();
  return canvas;
}

function build(key: string, w: number, h: number, scale: number, colorIdx: number, touch: boolean): Layer {
  const gm = geom(w, h, touch);
  cache = {
    key,
    scale,
    colorIdx,
    touch,
    gm,
    shell: buildShell(gm, scale, colorIdx),
    wheel: buildWheel(gm.wheelR, scale, colorIdx),
    glove: buildGlove(gm.wheelR, scale, colorIdx),
  };
  return cache;
}

function idle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 250 });
  else setTimeout(fn, 50);
}

// A width-only change keeps drawing the previous layers stretched while they are rebuilt off the draw
// path; anything else (scale, height, livery, touch) rebuilds at once.
function layers(w: number, h: number, scale: number, colorIdx: number, touch: boolean, drawing: boolean): Layer | null {
  const key = `${w}|${h}|${scale}|${colorIdx}|${touch}`;
  if (cache?.key === key) {
    pending = '';
    return cache;
  }
  const widthOnly = cache && cache.scale === scale && cache.gm.h === h && cache.colorIdx === colorIdx && cache.touch === touch;
  if (drawing && !widthOnly) {
    pending = '';
    return build(key, w, h, scale, colorIdx, touch);
  }
  if (pending !== key) {
    pending = key;
    idle(() => {
      if (pending !== key) return;
      pending = '';
      build(key, w, h, scale, colorIdx, touch);
    });
  }
  return cache;
}

export function cockpitUsed(): boolean {
  return used;
}

export function prewarmCockpit(g: CanvasRenderingContext2D, w: number, h: number, colorIdx: number, touch: boolean): void {
  if (used) layers(w, h, g.getTransform().a, colorIdx, touch, false);
}

interface Fleck {
  x: number;
  y: number;
  size: number;
  rot: number;
  bias: number;
}

// Dirt collects along the lower glass and the pillar edges, never across the sky or the racing line.
const FLECKS: Fleck[] = (() => {
  const rng = createRng(44011);
  return Array.from({ length: 24 }, () => {
    const zone = rng();
    let x: number;
    let y: number;
    if (zone < 0.6) {
      x = 0.1 + rng() * 0.8;
      y = 0.57 + rng() * 0.09;
    } else {
      y = 0.2 + rng() * 0.4;
      const edge = 0.145 - (0.087 * y) / 0.695 + 0.008 + rng() * 0.025;
      x = zone < 0.8 ? edge : 1 - edge;
    }
    return { x, y, size: 4 + rng() * 10, rot: (rng() - 0.5) * 0.3, bias: rng() };
  });
})();

function drawFlecks(g: CanvasRenderingContext2D, gm: Geom, oil: number, grit: number): void {
  const dirt = Math.max(oil, grit);
  if (dirt < 0.03) return;
  const n = Math.min(FLECKS.length, Math.ceil(FLECKS.length * dirt * 1.2));
  const share = oil / (oil + grit);
  g.save();
  g.clip(gm.glass);
  g.globalAlpha = 0.25 + 0.4 * dirt;
  g.lineWidth = 1;
  g.strokeStyle = rgba(PR.tealLight, 0.25);
  for (let i = 0; i < n; i++) {
    const f = FLECKS[i]!;
    const x = f.x * gm.w;
    const y = f.y * gm.h;
    if (f.bias < share) {
      g.fillStyle = '#1C160A';
      g.beginPath();
      g.ellipse(x, y, f.size / 2, f.size / 8, f.rot, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(x + f.size * 0.55, y + f.rot * f.size * 0.5, f.size / 4, f.size / 14, f.rot, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#4A3C2C';
      g.beginPath();
      g.ellipse(x, y, f.size / 3, f.size / 4, f.rot * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

let streakImg: HTMLCanvasElement | null = null;
function streakSprite(): HTMLCanvasElement {
  if (!streakImg) {
    streakImg = document.createElement('canvas');
    streakImg.width = 32;
    streakImg.height = 64;
    const g = streakImg.getContext('2d')!;
    const across = g.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, rgba(WARM, 0));
    across.addColorStop(0.5, rgba(WARM, 1));
    across.addColorStop(1, rgba(WARM, 0));
    g.fillStyle = across;
    g.fillRect(0, 0, 32, 64);
    g.globalCompositeOperation = 'destination-in';
    const down = g.createLinearGradient(0, 0, 0, 64);
    down.addColorStop(0, 'rgba(0,0,0,0.3)');
    down.addColorStop(0.5, 'rgba(0,0,0,1)');
    down.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = down;
    g.fillRect(0, 0, 32, 64);
  }
  return streakImg;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Floodlight masts passing overhead: a warm wash on the headliner that slides onto the pillar.
function drawStreaks(g: CanvasRenderingContext2D, gm: Geom, streaks: Streak[]): number {
  const { w, h, cx } = gm;
  let peak = 0;
  g.globalCompositeOperation = 'lighter';
  for (const st of streaks) {
    peak = Math.max(peak, st.k);
    const e = Math.abs(st.x - cx) / (w / 2);
    const onPillar = smooth(0.6, 0.75, e);
    const roof = st.k * (1 - onPillar);
    if (roof > 0.005) {
      const x = Math.max(w * 0.16, Math.min(w * 0.84, st.x));
      const t = x / w;
      const roofY = h * (0.09 + 0.14 * t * (1 - t));
      g.globalAlpha = ROOF_FLOOD * roof;
      g.drawImage(streakSprite(), x - w * 0.03, 0, w * 0.06, roofY);
      g.save();
      g.beginPath();
      g.rect(x - w * 0.04, 0, w * 0.08, roofY);
      g.clip();
      g.globalAlpha = 0.3 * roof;
      g.strokeStyle = WARM;
      g.lineWidth = 1;
      g.stroke(gm.bead);
      g.restore();
    }
    const pillar = st.k * onPillar;
    if (pillar > 0.005) {
      const left = st.x < cx;
      const x0 = left ? w * 0.132 : w * 0.868;
      const x1 = left ? w * 0.052 : w * 0.948;
      const len = h * 0.69;
      g.globalAlpha = PILLAR_FLOOD * pillar;
      g.save();
      g.translate(x0, 0);
      g.transform(1, 0, (x1 - x0) / len, 1, 0, 0);
      g.drawImage(streakSprite(), -w * 0.012, 0, w * 0.024, len);
      g.restore();
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return peak;
}

function drawLeds(g: CanvasRenderingContext2D, gm: Geom, leds: Readout['leds']): void {
  const half = (LED_COUNT - 1) / 2;
  const gr = gm.ledR * 4;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.5;
  for (let i = 0; i < LED_COUNT; i++) {
    const c = leds[i];
    if (c) g.drawImage(glowOf(c), gm.cx + (i - half) * gm.ledPitch - gr, gm.ledY - gr, gr * 2, gr * 2);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < LED_COUNT; i++) {
    const c = leds[i];
    if (!c) continue;
    g.fillStyle = c;
    g.beginPath();
    g.arc(gm.cx + (i - half) * gm.ledPitch, gm.ledY, gm.ledR, 0, Math.PI * 2);
    g.fill();
  }
}

function drawDial(g: CanvasRenderingContext2D, gm: Geom, cx: number, draw: () => void): void {
  g.save();
  g.translate(cx, gm.dialCy);
  g.scale(gm.dialK, gm.dialK);
  draw();
  g.restore();
}

function drawSpeed(g: CanvasRenderingContext2D, gm: Geom, mph: number, arcFrom: number): void {
  drawDial(g, gm, gm.cx, () => drawSpeedo(g, mph, 0, 0, SPEEDO_R, arcFrom));
}

function drawFuel(g: CanvasRenderingContext2D, gm: Geom, fuel: number, time: number): void {
  drawDial(g, gm, gm.fuelCx, () => drawFuelGauge(g, fuel, time, 0, 0, FUEL_R));
}

function drawPod(g: CanvasRenderingContext2D, gm: Geom, r: Readout): void {
  const top = gm.podY - gm.lcdH / 2;
  caption(g, r.podTop, gm.podCx, top + gm.lcdH * 0.36, r.podTop === 'FINISH' ? PR.amber : PR.tealLight, r.podTop.length > 3 ? 11 : 14);
  if (r.podBottom) caption(g, r.podBottom, gm.podCx, top + gm.lcdH * 0.76, r.podColor, 9);
}

function drawLamps(g: CanvasRenderingContext2D, gm: Geom, r: Readout): void {
  const on = [r.lamps.pit, r.lamps.fuel, r.lamps.skid, r.lamps.pen, r.lamps.rev];
  for (let i = 0; i < LAMPS.length; i++) {
    if (!on[i]) continue;
    const x = lampX(gm, i);
    g.fillStyle = LAMP_COLORS[i]!;
    g.beginPath();
    g.roundRect(x, gm.lampY - gm.lampH / 2, gm.lampW, gm.lampH, 3);
    g.fill();
    lampCaption(g, gm, i, INK);
  }
}

let motion: MediaQueryList | null = null;
export function reducedMotion(): boolean {
  if (!motion && typeof matchMedia === 'function') motion = matchMedia('(prefers-reduced-motion: reduce)');
  return motion?.matches ?? false;
}

const HAND_DEG = 50;

function drawHands(g: CanvasRenderingContext2D, gm: Geom, glove: HTMLCanvasElement, size: number, rot: number): void {
  const r = gm.wheelR;
  for (const side of [-1, 1]) {
    const a = -Math.PI / 2 + side * rad(HAND_DEG) + rot;
    const hx = Math.cos(a) * r;
    const hy = Math.sin(a) * r;
    const sx = side * r * 1.1;
    const sy = -r * 0.2;
    const len = Math.hypot(sx - hx, sy - hy) || 1;
    const ux = (sx - hx) / len;
    const uy = (sy - hy) / len;
    const wx = hx + ux * r * 0.13;
    const wy = hy + uy * r * 0.13;
    g.fillStyle = '#15121C';
    g.beginPath();
    g.moveTo(wx - uy * r * 0.09, wy + ux * r * 0.09);
    g.lineTo(sx - uy * r * 0.16, sy + ux * r * 0.16);
    g.lineTo(sx + uy * r * 0.16, sy - ux * r * 0.16);
    g.lineTo(wx + uy * r * 0.09, wy - ux * r * 0.09);
    g.closePath();
    g.fill();
    g.strokeStyle = PR.teal;
    g.lineWidth = Math.max(1.5, r * 0.03);
    g.beginPath();
    g.moveTo(wx - uy * r * 0.09, wy + ux * r * 0.09);
    g.lineTo(wx + uy * r * 0.09, wy - ux * r * 0.09);
    g.stroke();
    g.save();
    g.translate(hx, hy);
    g.rotate(a);
    if (side > 0) g.scale(1, -1);
    g.drawImage(glove, -size / 2, -size / 2, size, size);
    g.restore();
  }
}

export function drawCockpit(g: CanvasRenderingContext2D, w: number, h: number, f: CabinView): { x: number; y: number } {
  const race = f.race;
  const p = race.player;
  const cabin = cabinFor(race);
  const scale = g.getTransform().a;
  used = true;
  const lay = layers(w, h, scale, p.colorIdx, f.touch, true)!;
  const gm = lay.gm;
  const pos = p.finished ? race.shownPosition(p) : f.standings.indexOf(p) + 1;
  const ahead = p.finished ? undefined : f.standings[pos - 2];
  const r = cabinReadout({
    time: f.time,
    speed: p.speed,
    reverse: p.reverse,
    fuel: p.fuel,
    lapsToGo: race.lapsToGo(p),
    started: race.started,
    finished: p.finished,
    finishAge: race.time - cabin.finishedAt,
    warn: f.warn,
    slideTime: p.slideTime,
    spinTime: p.spinTime,
    pitAuto: race.pitAuto,
    refueling: p.refueling,
    penalty: p.penalty,
    penaltyAge: race.time - p.penaltyAt,
    lights: f.lights,
    position: pos,
    interval: ahead ? race.gap(p, ahead) : null,
  });
  const j = reducedMotion() ? { x: 0, y: 0, kick: 0 } : joltOffset(cabin, race.time);
  const jx = Math.round(j.x * scale) / scale;
  const jy = Math.round(j.y * scale) / scale;

  g.save();
  g.imageSmoothingEnabled = true;
  g.translate(jx, jy);
  if (gm.w !== w || gm.h !== h) g.scale(w / gm.w, h / gm.h);
  g.drawImage(lay.shell, -PAD, -PAD, lay.shell.width / lay.scale, lay.shell.height / lay.scale);
  const flood = drawStreaks(g, gm, f.streaks);
  const lipA = 0.1 * flood + (race.pitAuto ? 0.06 : 0);
  if (lipA > 0.005) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = lipA;
    g.strokeStyle = race.pitAuto ? PR.cream : WARM;
    g.lineWidth = 2;
    g.stroke(gm.lip);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  drawFlecks(g, gm, cabin.oil, cabin.grit);
  drawLeds(g, gm, r.leds);
  drawSpeed(g, gm, p.speed, f.arcFrom);
  drawFuel(g, gm, p.fuel, race.time);
  drawPod(g, gm, r);
  drawLamps(g, gm, r);

  const wr = gm.wheelR;
  const size = lay.wheel.width / lay.scale;
  const rot = f.steer * 1.4 + j.kick;
  g.translate(gm.cx, gm.wheelCy);
  g.save();
  g.rotate(rot);
  g.drawImage(lay.wheel, -size / 2, -size / 2, size, size);
  g.restore();
  g.strokeStyle = rgba(PR.cream, 0.1);
  g.lineWidth = wr * 0.035;
  g.beginPath();
  g.arc(0, 0, wr - wr * 0.04, Math.PI * 1.25, Math.PI * 1.75);
  g.stroke();
  drawHands(g, gm, lay.glove, lay.glove.width / lay.scale, rot);
  g.restore();
  return { x: jx, y: jy };
}
