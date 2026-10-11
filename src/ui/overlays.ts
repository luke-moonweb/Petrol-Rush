import { CONFIG } from '../config';
import { carIcon, driverName } from '../gfx/vehicles';
import { FONT_UI } from './text';
import { FONT_BLACK, PR } from './theme';

const W = CONFIG.SCREEN_W;
const TOP = CONFIG.HUD_TOP_H;
const PLAY_H = CONFIG.PLAY_H;
const DEG = Math.PI / 180;

const PANEL_W = 256;
const PAD = 18;

function txt(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'left',
  glow: string | null = null,
): number {
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 7;
  }
  g.fillText(s, x, y);
  g.shadowBlur = 0;
  return g.measureText(s).width;
}

function spaced(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, sp = 2): number {
  g.font = font;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + sp;
  }
  return cx - x - sp;
}

function skew(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  deg: number,
  fill: string,
  stroke?: string,
  glow?: string,
): void {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.transform(1, 0, Math.tan(-deg * DEG), 1, 0, 0);
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 10;
  }
  g.fillStyle = fill;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.shadowBlur = 0;
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.strokeRect(-w / 2 + 0.75, -h / 2 + 0.75, w - 1.5, h - 1.5);
  }
  g.restore();
}

function tri(g: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, size: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - dir * size * 0.6, y - size);
  g.lineTo(x + dir * size * 0.6, y);
  g.lineTo(x - dir * size * 0.6, y + size);
  g.closePath();
  g.fill();
}

function nightKey(g: CanvasRenderingContext2D, label: string, x: number, cy: number): number {
  g.font = `9px ${FONT_BLACK}`;
  const w = Math.max(18, g.measureText(label).width + 10);
  g.fillStyle = '#2A2640';
  g.beginPath();
  g.roundRect(x, cy - 8, w, 16, 3);
  g.fill();
  g.strokeStyle = PR.teal;
  g.lineWidth = 1;
  g.stroke();
  txt(g, label, x + w / 2, cy + 1, `9px ${FONT_BLACK}`, PR.tealLight, 'center');
  return w;
}

function hints(g: CanvasRenderingContext2D, list: [string, string][], x: number, y: number, maxW: number): void {
  let cx = x;
  let cy = y;
  for (const [k, l] of list) {
    g.font = `9px ${FONT_BLACK}`;
    const kw = Math.max(18, g.measureText(k).width + 10);
    g.font = `bold 9px ${FONT_UI}`;
    const lw = g.measureText(l).width;
    if (cx + kw + 5 + lw > x + maxW) {
      cx = x;
      cy += 20;
    }
    nightKey(g, k, cx, cy);
    txt(g, l, cx + kw + 5, cy + 1, `bold 9px ${FONT_UI}`, PR.muted);
    cx += kw + 5 + lw + 12;
  }
}

function sidePanel(g: CanvasRenderingContext2D, tag: string, title: string): number {
  g.fillStyle = 'rgba(8,6,18,0.35)';
  g.fillRect(PANEL_W, TOP, W - PANEL_W, PLAY_H);
  g.fillStyle = 'rgba(14,12,28,0.94)';
  g.fillRect(0, TOP, PANEL_W, PLAY_H);
  g.save();
  g.shadowColor = PR.teal;
  g.shadowBlur = 10;
  g.fillStyle = PR.teal;
  g.fillRect(PANEL_W - 2, TOP, 2, PLAY_H);
  g.restore();
  g.fillStyle = PR.amber;
  g.beginPath();
  g.moveTo(PANEL_W - 64, TOP);
  g.lineTo(PANEL_W - 2, TOP);
  g.lineTo(PANEL_W - 2, TOP + 8);
  g.lineTo(PANEL_W - 56, TOP + 8);
  g.closePath();
  g.fill();

  g.font = `9px ${FONT_BLACK}`;
  let tw = 0;
  for (const ch of tag) tw += g.measureText(ch).width + 2;
  skew(g, PAD, TOP + 16, tw + 16, 15, 14, PR.amber);
  spaced(g, tag, PAD + 8, TOP + 24, `9px ${FONT_BLACK}`, PR.ink);
  txt(g, title, PAD, TOP + 50, `italic 22px ${FONT_BLACK}`, PR.cream);
  return TOP + 72;
}

export interface StatField {
  label: string;
  value?: string;
  carColor?: number;
}

function statCard(g: CanvasRenderingContext2D, y: number, fields: StatField[]): number {
  const w = PANEL_W - PAD * 2;
  const h = 76;
  g.fillStyle = '#1C1930';
  g.beginPath();
  g.roundRect(PAD, y, w, h, 4);
  g.fill();
  g.fillStyle = '#2A2640';
  g.fillRect(PAD + w / 2, y + 8, 1, h - 16);
  g.fillRect(PAD + 8, y + h / 2, w - 16, 1);
  fields.slice(0, 4).forEach((f, i) => {
    const fx = PAD + 10 + (i % 2) * (w / 2);
    const fy = y + 12 + Math.floor(i / 2) * (h / 2);
    spaced(g, f.label, fx, fy, `bold 8px ${FONT_UI}`, PR.muted, 1.5);
    if (f.carColor !== undefined) carIcon(g, f.carColor, fx + 22, fy + 21, 0.62);
    else if (f.value !== undefined) txt(g, f.value, fx, fy + 15, `13px ${FONT_BLACK}`, PR.tealLight, 'left', 'rgba(18,181,166,0.8)');
  });
  return y + h;
}

function menuButton(g: CanvasRenderingContext2D, label: string, y: number, selected: boolean, danger: boolean): void {
  const x = PAD;
  const w = PANEL_W - PAD * 2;
  const h = 30;
  if (selected) skew(g, x, y, w, h, 12, PR.amber, undefined, 'rgba(255,200,90,0.6)');
  else skew(g, x, y, w, h, 12, '#1C1930', danger ? 'rgba(230,59,46,0.7)' : 'rgba(18,181,166,0.55)');
  if (selected) tri(g, x + 16, y + h / 2, 1, 5, PR.ink);
  txt(g, label, x + (selected ? 28 : 16), y + h / 2 + 1, `12px ${FONT_BLACK}`, selected ? PR.ink : danger ? '#FF7A6A' : PR.cream);
}

export interface RaceMenuView {
  tag: string;
  title: string;
  stats: StatField[];
  items: string[];
  sel: number;
  danger: string[];
}

export function drawRaceMenu(g: CanvasRenderingContext2D, v: RaceMenuView): void {
  let y = sidePanel(g, v.tag, v.title);
  y = statCard(g, y, v.stats) + 16;
  v.items.forEach((it, i) => {
    menuButton(g, it, y, i === v.sel, v.danger.includes(it));
    y += 38;
  });
  hints(
    g,
    [
      ['↑↓', 'SELECT'],
      ['ENTER', 'OK'],
      ['ESC', 'BACK'],
    ],
    PAD,
    TOP + PLAY_H - 18,
    PANEL_W - PAD * 2,
  );
}

export interface SettingRow {
  label: string;
  value?: string;
  carColor?: number;
  action?: boolean;
}

export function drawRaceSettings(g: CanvasRenderingContext2D, rows: SettingRow[], sel: number, note: string | null): void {
  let y = sidePanel(g, 'SETUP', 'RACE SETTINGS');
  const w = PANEL_W - PAD * 2;
  rows.forEach((r, i) => {
    const selected = i === sel;
    if (r.action) {
      y += 6;
      menuButton(g, r.label, y, selected, false);
      y += 38;
      return;
    }
    const h = 44;
    g.fillStyle = selected ? 'rgba(18,181,166,0.16)' : '#1C1930';
    g.beginPath();
    g.roundRect(PAD, y, w, h, 4);
    g.fill();
    if (selected) {
      g.strokeStyle = PR.teal;
      g.lineWidth = 1.5;
      g.stroke();
    }
    spaced(g, r.label, PAD + 10, y + 12, `bold 8px ${FONT_UI}`, selected ? PR.tealLight : PR.muted, 1.5);
    const cy = y + 30;
    const color = selected ? PR.amber : PR.cream;
    if (selected) {
      tri(g, PAD + 14, cy, -1, 5, PR.amber);
      tri(g, PAD + w - 14, cy, 1, 5, PR.amber);
    }
    if (r.carColor !== undefined) {
      carIcon(g, r.carColor, PAD + w / 2, cy + 6, 0.7);
    } else if (r.value !== undefined) {
      txt(g, r.value, PAD + w / 2, cy + 1, `14px ${FONT_BLACK}`, color, 'center', selected ? 'rgba(255,200,90,0.7)' : null);
    }
    y += h + 6;
  });
  if (note) txt(g, note, PAD, y + 6, `bold 9px ${FONT_UI}`, PR.amber);
  hints(
    g,
    [
      ['↑↓', 'SELECT'],
      ['←→', 'CHANGE'],
      ['ESC', 'BACK'],
    ],
    PAD,
    TOP + PLAY_H - 18,
    PANEL_W - PAD * 2,
  );
}

export function drawPause(g: CanvasRenderingContext2D, keys: { pause: string; help: string }): void {
  g.fillStyle = 'rgba(8,6,18,0.6)';
  g.fillRect(0, TOP, W, PLAY_H);
  const cw = 300;
  const ch = 118;
  const x = W / 2 - cw / 2;
  const y = TOP + PLAY_H / 2 - ch / 2 - 10;
  g.fillStyle = 'rgba(14,12,28,0.95)';
  g.fillRect(x, y, cw, ch);
  g.save();
  g.shadowColor = PR.amber;
  g.shadowBlur = 12;
  g.strokeStyle = PR.amber;
  g.lineWidth = 2;
  g.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
  g.restore();
  g.save();
  g.shadowColor = PR.amber;
  g.shadowBlur = 10;
  g.fillStyle = PR.amber;
  g.fillRect(x + 28, y + 26, 8, 30);
  g.fillRect(x + 42, y + 26, 8, 30);
  g.restore();
  txt(g, 'PAUSED', x + 64, y + 42, `italic 32px ${FONT_BLACK}`, PR.amber, 'left', 'rgba(255,200,90,0.9)');
  const list: [string, string][] = [
    [keys.pause, 'RESUME'],
    ['ESC', 'MENU'],
    [keys.help, 'CONTROLS'],
  ];
  let total = 0;
  g.font = `bold 9px ${FONT_UI}`;
  const parts = list.map(([k, l]) => {
    g.font = `9px ${FONT_BLACK}`;
    const kw = Math.max(18, g.measureText(k).width + 10);
    g.font = `bold 9px ${FONT_UI}`;
    const w = kw + 5 + g.measureText(l).width;
    total += w;
    return { k, l, kw, w };
  });
  total += 14 * (parts.length - 1);
  let hx = W / 2 - total / 2;
  for (const p of parts) {
    nightKey(g, p.k, hx, y + 88);
    txt(g, p.l, hx + p.kw + 5, y + 89, `bold 9px ${FONT_UI}`, PR.muted);
    hx += p.w + 14;
  }
}

export interface ResultRow {
  colorIdx: number;
  isPlayer: boolean;
  time: string;
  penalty: number;
}

function ord(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}TH`;
  return `${n}${['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
}

export function drawResults(g: CanvasRenderingContext2D, rows: ResultRow[], playerPos: number): void {
  g.fillStyle = 'rgba(8,6,18,0.55)';
  g.fillRect(0, TOP, W, PLAY_H);
  const x0 = 34;
  const y0 = TOP + 10;
  const pw = W - 68;
  const ph = PLAY_H - 20;
  g.fillStyle = 'rgba(14,12,28,0.95)';
  g.fillRect(x0, y0, pw, ph);
  g.save();
  g.shadowColor = PR.teal;
  g.shadowBlur = 10;
  g.fillStyle = PR.teal;
  g.fillRect(x0, y0, pw, 2);
  g.fillRect(x0, y0 + ph - 2, pw, 2);
  g.restore();

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      g.fillStyle = (i + j) % 2 ? PR.ink : PR.cream;
      g.fillRect(x0 + 18 + i * 5, y0 + 16 + j * 5, 5, 5);
    }
  }
  txt(g, 'RACE RESULTS', x0 + 56, y0 + 24, `italic 20px ${FONT_BLACK}`, PR.amber, 'left', 'rgba(255,200,90,0.8)');
  const banner = playerPos ? `YOU FINISHED ${ord(playerPos)}` : 'RACE OVER';
  g.font = `11px ${FONT_BLACK}`;
  const bw = g.measureText(banner).width + 24;
  skew(g, x0 + pw - bw - 18, y0 + 14, bw, 20, 12, PR.teal, undefined, 'rgba(18,181,166,0.6)');
  txt(g, banner, x0 + pw - bw / 2 - 18, y0 + 25, `11px ${FONT_BLACK}`, PR.ink, 'center');

  const podY = y0 + 160;
  const slots = [
    { i: 1, x: W / 2 - 150, h: 68 },
    { i: 0, x: W / 2 - 50, h: 86 },
    { i: 2, x: W / 2 + 50, h: 62 },
  ];
  for (const s of slots) {
    const r = rows[s.i];
    if (!r) continue;
    const top = podY - s.h;
    const grad = g.createLinearGradient(0, top, 0, podY);
    grad.addColorStop(0, s.i === 0 ? PR.amber : '#3A3654');
    grad.addColorStop(1, s.i === 0 ? '#B07A1A' : '#22203A');
    g.fillStyle = grad;
    g.fillRect(s.x, top, 100, s.h);
    if (r.isPlayer) {
      g.strokeStyle = PR.teal;
      g.lineWidth = 2;
      g.strokeRect(s.x + 1, top + 1, 98, s.h - 2);
    }
    txt(g, String(s.i + 1), s.x + 50, top + 18, `italic 22px ${FONT_BLACK}`, s.i === 0 ? PR.ink : PR.cream, 'center');
    carIcon(g, r.colorIdx, s.x + 50, top - 12, 1.1);
    const name = r.isPlayer ? 'YOU' : driverName(r.colorIdx);
    txt(g, name, s.x + 50, top + 36, `10px ${FONT_BLACK}`, s.i === 0 ? PR.ink : PR.tealLight, 'center');
    txt(g, r.time, s.x + 50, top + 52, `bold 9px ${FONT_UI}`, s.i === 0 ? PR.ink : PR.muted, 'center');
    if (r.penalty > 0) txt(g, `PEN +${r.penalty}s`, s.x + 50, top + 63, `bold 7px ${FONT_UI}`, s.i === 0 ? '#9A1A10' : PR.red, 'center');
  }
  g.fillStyle = '#2A2640';
  g.fillRect(x0 + 18, podY, pw - 36, 1);

  const rest = rows.slice(3);
  const colW = (pw - 36) / 3;
  const perCol = Math.max(1, Math.ceil(rest.length / 3));
  rest.forEach((r, k) => {
    const col = Math.floor(k / perCol);
    const row = k % perCol;
    const x = x0 + 18 + col * colW;
    const y = podY + 16 + row * 26;
    if (r.isPlayer) {
      g.fillStyle = 'rgba(18,181,166,0.2)';
      g.fillRect(x - 4, y - 11, colW - 8, 22);
    }
    txt(g, String(k + 4), x + 14, y + 1, `11px ${FONT_BLACK}`, r.isPlayer ? PR.tealLight : PR.amber, 'right');
    carIcon(g, r.colorIdx, x + 40, y + 6, 0.55);
    txt(g, r.isPlayer ? 'YOU' : driverName(r.colorIdx), x + 62, y + 1, `9px ${FONT_BLACK}`, r.isPlayer ? PR.tealLight : PR.cream);
    txt(g, r.time, x + colW - 14, y + 1, `bold 9px ${FONT_UI}`, PR.muted, 'right');
    if (r.penalty > 0) txt(g, `PEN +${r.penalty}s`, x + 62, y + 10, `bold 7px ${FONT_UI}`, PR.red);
  });

  hints(g, [['ENTER', 'CONTINUE']], W / 2 - 50, y0 + ph - 16, 200);
}
