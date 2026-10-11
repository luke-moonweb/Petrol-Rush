import { CONFIG } from '../config';
import { BINDABLE, Bindings, keyLabel } from '../input';
import { FONT_UI, text } from './text';
import { FONT_BLACK, PR } from './theme';

const W = CONFIG.SCREEN_W;
const H = CONFIG.SCREEN_H;
const DEG = Math.PI / 180;

function poly(g: CanvasRenderingContext2D, pts: number[], fill: string): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function circle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string | null, stroke?: string, lw = 1): void {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke?: string, lw = 1): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
}

function skewBox(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, deg: number, draw: () => void): void {
  g.save();
  g.translate(cx, cy);
  g.transform(1, 0, Math.tan(-deg * DEG), 1, 0, 0);
  g.translate(-w / 2, -h / 2);
  draw();
  g.restore();
}

function logoText(g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, align: CanvasTextAlign): void {
  g.font = `italic ${size}px ${FONT_BLACK}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const lw = Math.max(2, size / 20);
  const layer = (dx: number, dy: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = lw * 2;
    g.strokeText(str, x + dx, y + dy);
    g.fillStyle = color;
    g.fillText(str, x + dx, y + dy);
  };
  const s1 = Math.round(size / 12);
  const s2 = Math.round(size / 7);
  layer(s2, s2, PR.ultraDark);
  layer(s1, s1, PR.red);
  g.strokeStyle = PR.ultraDark;
  g.lineWidth = lw * 2;
  g.strokeText(str, x, y);
  g.fillStyle = PR.cream;
  g.fillText(str, x, y);
}

function tag(g: CanvasRenderingContext2D, str: string, x: number, cy: number, bg: string, fg: string, size = 11, shadow = false): number {
  g.font = `${size}px ${FONT_BLACK}`;
  const spacing = 3;
  const tw = g.measureText(str).width + spacing * (str.length - 1);
  const w = tw + 26;
  const h = size + 11;
  skewBox(g, x + w / 2, cy, w, h, 14, () => {
    if (shadow) {
      g.fillStyle = PR.ink;
      g.fillRect(3, 3, w, h);
    }
    g.fillStyle = PR.ink;
    g.fillRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(3, 3, w - 6, h - 6);
  });
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let tx = x + 13;
  for (const ch of str) {
    g.fillText(ch, tx, cy + 1);
    tx += g.measureText(ch).width + spacing;
  }
  return w;
}

function keycap(g: CanvasRenderingContext2D, label: string, x: number, cy: number, minW = 22, size = 11): number {
  g.font = `${size}px ${FONT_BLACK}`;
  const w = Math.max(minW, g.measureText(label).width + 14);
  const h = size + 7;
  rrect(g, x, cy - h / 2 + 3, w, h, 3, PR.keyShadow);
  rrect(g, x, cy - h / 2, w, h, 3, PR.cream, PR.ink, 2);
  g.fillStyle = PR.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, cy + 1);
  return w;
}

function footerHints(g: CanvasRenderingContext2D, hints: [string, string][], cy: number): void {
  const gap = 22;
  g.font = `bold 11px ${FONT_UI}`;
  const parts = hints.map(([k, l]) => {
    g.font = `bold 11px ${FONT_UI}`;
    const kw = g.measureText(k).width + 12;
    const lw = g.measureText(l).width;
    return { k, l, kw, w: kw + 7 + lw };
  });
  const total = parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1);
  let x = W / 2 - total / 2;
  for (const p of parts) {
    rrect(g, x, cy - 8, p.kw, 16, 3, PR.mango);
    g.fillStyle = PR.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(p.k, x + p.kw / 2, cy + 1);
    g.fillStyle = PR.cream;
    g.textAlign = 'left';
    g.fillText(p.l, x + p.kw + 7, cy + 1);
    x += p.w + gap;
  }
}

function stripesBg(g: CanvasRenderingContext2D): void {
  g.fillStyle = PR.mango;
  g.fillRect(0, 0, W, H);
  for (const x of [-40, 60, 560, 660]) poly(g, [x, 0, x + 60, 0, x - 80, H, x - 140, H], PR.mangoLight);
  poly(g, [470, 0, 640, 0, 640, 70], PR.ultra);
  poly(g, [530, 0, 556, 0, 640, 50, 640, 66], PR.red);
  g.fillStyle = PR.red;
  g.fillRect(0, 430, W, 5);
  g.fillStyle = PR.ink;
  g.fillRect(0, 435, W, 45);
}

function screenHeader(g: CanvasRenderingContext2D, title: string, tagText: string): void {
  logoText(g, title, 40, 42, 40, 'left');
  g.font = `italic 40px ${FONT_BLACK}`;
  const w = g.measureText(title).width;
  tag(g, tagText, 40 + w + 22, 50, PR.ultra, PR.mango, 11);
}

export const TITLE_ITEMS = ['NEW GAME', 'CONTROLS', 'SETTINGS', 'CREDITS'];

export interface TitleView {
  sel: number;
  lap: number;
  laps: number;
  top: string[];
}

export function drawTitle(g: CanvasRenderingContext2D, v: TitleView): void {
  const top = CONFIG.HUD_TOP_H;
  const shade = g.createLinearGradient(0, 0, 360, 0);
  shade.addColorStop(0, 'rgba(14,12,28,0.92)');
  shade.addColorStop(0.65, 'rgba(14,12,28,0.6)');
  shade.addColorStop(1, 'rgba(14,12,28,0)');
  g.fillStyle = shade;
  g.fillRect(0, top, 360, H - top);

  g.fillStyle = PR.night;
  g.fillRect(0, 0, W, top);
  g.fillStyle = '#2A2740';
  g.fillRect(0, top - 1, W, 1);
  g.fillStyle = PR.red;
  g.fillRect(0, 0, 66, top - 1);
  circle(g, 14, 11.5, 3.5, PR.cream);
  g.font = `11px ${FONT_BLACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = PR.cream;
  g.fillText('LIVE', 23, 12.5);
  g.textAlign = 'right';
  g.font = `13px ${FONT_BLACK}`;
  g.fillStyle = PR.tealLight;
  const lap = `${v.lap} / ${v.laps}`;
  g.fillText(lap, W - 14, 12.5);
  const lw = g.measureText(lap).width;
  g.font = `bold 9px ${FONT_UI}`;
  g.fillStyle = PR.muted;
  g.fillText('L A P', W - 22 - lw, 12.5);

  logoText(g, 'PETROL', 34, 84, 50, 'left');
  logoText(g, 'RUSH', 34, 134, 50, 'left');
  tag(g, 'LIGHTS OUT AND AWAY WE GO', 34, 178, PR.mango, PR.ink, 10, true);

  const x = 30;
  const w = 220;
  const rowH = 30;
  const y = 214;
  g.fillStyle = 'rgba(14,12,28,0.88)';
  g.fillRect(x, y - 22, w, 20);
  g.fillStyle = PR.red;
  g.fillRect(x, y - 22, 3, 20);
  g.fillStyle = PR.muted;
  g.font = `bold 9px ${FONT_UI}`;
  g.textAlign = 'left';
  g.fillText('S T A R T I N G   G R I D', x + 10, y - 11.5);
  const stripes = [PR.red, PR.ultra, PR.mango];
  TITLE_ITEMS.forEach((item, i) => {
    const ry = y + i * (rowH + 3);
    const sel = i === v.sel;
    g.fillStyle = sel ? PR.teal : 'rgba(28,25,48,0.92)';
    g.fillRect(x, ry, w, rowH);
    g.fillStyle = sel ? PR.night : PR.mango;
    g.fillRect(x + 3, ry + 3, 30, rowH - 6);
    g.fillStyle = sel ? PR.mango : PR.night;
    g.font = `12px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.fillText(`P${i + 1}`, x + 18, ry + rowH / 2 + 1);
    g.fillStyle = stripes[i % stripes.length];
    g.fillRect(x + 39, ry + 6, 3, rowH - 12);
    g.fillStyle = sel ? PR.night : PR.cream;
    g.font = `14px ${FONT_BLACK}`;
    g.textAlign = 'left';
    g.fillText(item, x + 50, ry + rowH / 2 + 1);
  });

  g.fillStyle = 'rgba(14,12,28,0.92)';
  g.fillRect(0, 414, W, H - 414);
  g.fillStyle = '#2A2740';
  g.fillRect(0, 414, W, 1);
  g.font = `bold 9px ${FONT_UI}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = PR.mango;
  g.fillText('TOP 5', 14, 428);
  let tx = 60;
  v.top.forEach((name, i) => {
    g.fillStyle = PR.muted;
    g.fillText(String(i + 1), tx, 428);
    g.fillStyle = PR.cream;
    g.fillText(name, tx + 10, 428);
    tx += 10 + g.measureText(name).width + 22;
  });
  footerHints(g, [['↑ ↓', 'SELECT'], ['ENTER', 'CONFIRM'], ['M', 'SOUND']], 456);
}

function wrapText(g: CanvasRenderingContext2D, str: string, maxW: number): string[] {
  const words = str.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function darkPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = PR.mangoDeep;
  g.fillRect(x + 6, y + 6, w, h);
  g.fillStyle = PR.ultra;
  g.fillRect(x, y, w, h);
  g.fillStyle = PR.ink;
  g.fillRect(x + 3, y + 3, w - 6, h - 6);
}

const TIPS = [
  'Above 150 MPH in a corner the car will spin. Red SKID lamp on? Brake before the turn.',
  'Oil on the track spins you out – steer around it. Hit a rival from behind and you get a time penalty.',
  'A full tank lasts about 12 laps. Low on fuel? Pull into PIT ROAD and stop in a box.',
  'Spun out? Stop, switch to reverse gear, back up and turn.',
];

export function drawHelp(g: CanvasRenderingContext2D, b: Bindings): void {
  stripesBg(g);
  screenHeader(g, 'CONTROLS', 'HOW TO RACE');

  const px = 40;
  const py = 84;
  const pw = 272;
  const ph = 300;
  darkPanel(g, px, py, pw, ph);
  text(g, 'YOUR KEYS', px + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  const k = (a: keyof Bindings) => keyLabel(b[a][0] ?? b[a][1]);
  const rows: [string, string][] = [
    [`${k('left')} ${k('right')}`, 'STEER'],
    [k('gas'), 'ACCELERATE'],
    [k('brake'), 'BRAKE'],
    [k('reverse'), 'REVERSE GEAR ON / OFF'],
    [k('pause'), 'PAUSE'],
    [`ESC ${keyLabel(b.menu[0])}`, 'RACE MENU'],
    [k('mute'), 'SOUND ON / OFF'],
  ];
  rows.forEach(([key, label], i) => {
    const cy = py + 54 + i * 28;
    keycap(g, key, px + 17, cy, 54, 10);
    text(g, label, px + 17 + 76, cy + 4, { font: `bold 11px ${FONT_UI}`, color: PR.cream, shadow: null });
  });
  g.fillStyle = PR.ultra;
  g.fillRect(px + 17, py + ph - 42, pw - 34, 22);
  text(g, 'CHANGE ANY KEY IN SETTINGS', px + 27, py + ph - 27, { font: `bold 10px ${FONT_UI}`, color: PR.mango, shadow: null });

  const qx = px + pw + 16;
  darkPanel(g, qx, py, pw, ph);
  text(g, 'RACING TIPS', qx + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  let ty = py + 46;
  TIPS.forEach((tip, i) => {
    skewBox(g, qx + 28, ty + 10, 22, 22, 12, () => {
      g.fillStyle = PR.red;
      g.fillRect(0, 0, 22, 22);
    });
    text(g, String(i + 1), qx + 28, ty + 15, { font: `12px ${FONT_BLACK}`, align: 'center', color: PR.cream, shadow: null });
    g.font = `bold 11px ${FONT_UI}`;
    const lines = wrapText(g, tip, pw - 70);
    lines.forEach((ln, j) => text(g, ln, qx + 50, ty + 10 + j * 15, { font: `bold 11px ${FONT_UI}`, color: PR.cream, shadow: null }));
    ty += Math.max(34, lines.length * 15 + 16);
  });

  footerHints(g, [['ENTER / ESC', 'BACK']], 457);
}

export const CREDITS_ITEMS = ['AUTHOR PROFILE', 'GAME REPOSITORY', 'BACK'];

const BUILT_WITH = ['TYPESCRIPT', 'VITE', 'CANVAS 2D', 'WEB AUDIO'];

export interface CreditsView {
  sel: number;
  author: string;
  links: string[];
}

export function drawCredits(g: CanvasRenderingContext2D, v: CreditsView): void {
  stripesBg(g);
  screenHeader(g, 'CREDITS', 'THE PIT CREW');

  const px = 40;
  const py = 84;
  const pw = 272;
  const ph = 300;
  darkPanel(g, px, py, pw, ph);
  text(g, 'CREATED BY', px + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  text(g, v.author.toUpperCase(), px + 17, py + 60, { font: `22px ${FONT_BLACK}`, color: PR.cream, shadow: PR.red, shadowOffset: 2 });

  text(g, 'BUILT WITH', px + 17, py + 104, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  let bx = px + 17;
  let by = py + 128;
  for (const tech of BUILT_WITH) {
    g.font = `10px ${FONT_BLACK}`;
    const w = g.measureText(tech).width + 16;
    if (bx + w > px + pw - 17) {
      bx = px + 17;
      by += 26;
    }
    rrect(g, bx, by - 10, w, 20, 3, PR.ultra);
    text(g, tech, bx + w / 2, by + 4, { font: `10px ${FONT_BLACK}`, align: 'center', color: PR.mango, shadow: null });
    bx += w + 8;
  }

  text(g, 'All team and driver names are fictional.', px + 17, py + ph - 24, { font: `bold 10px ${FONT_UI}`, color: PR.muted, shadow: null });

  const qx = px + pw + 16;
  darkPanel(g, qx, py, pw, ph);
  text(g, 'ON GITHUB', qx + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  const bw = pw - 44;
  CREDITS_ITEMS.forEach((item, i) => {
    const cy = py + 62 + i * 76;
    settingsButton(g, item, v.sel === i, qx + 22 + bw, cy, bw);
    const link = v.links[i];
    if (link) {
      text(g, link.replace('https://', ''), qx + 22, cy + 38, {
        font: `bold 10px ${FONT_UI}`,
        color: v.sel === i ? PR.mango : PR.muted,
        shadow: null,
      });
    }
  });

  footerHints(g, [['↑ ↓', 'SELECT'], ['ENTER', 'OPEN'], ['ESC', 'BACK']], 457);
}

export type SettingsTab = 'keys' | 'game';

export interface GameOptionRow {
  label: string;
  value: string;
  desc: string;
}

export interface SettingsView {
  tab: SettingsTab;
  row: number;
  col: number;
  listening: boolean;
  message: string | null;
  bindings: Bindings;
  game: GameOptionRow[];
}

export const KEYS_ROWS = BINDABLE.length + 3;

function settingsTabs(g: CanvasRenderingContext2D, v: SettingsView, x: number): void {
  const tabs: [SettingsTab, string][] = [
    ['keys', 'KEYS'],
    ['game', 'GAME'],
  ];
  let tx = x;
  for (const [id, label] of tabs) {
    const active = v.tab === id;
    const w = tag(g, label, tx, 50, active ? PR.ultra : PR.cream, active ? PR.mango : PR.ultra, 12, active);
    if (active && v.row === 0) {
      g.fillStyle = PR.ink;
      g.fillRect(tx + 6, 64, w - 12, 3);
    }
    tx += w + 10;
  }
}

function settingsButton(g: CanvasRenderingContext2D, label: string, sel: boolean, right: number, cy: number, w: number): void {
  skewBox(g, right - w / 2, cy, w, 34, 12, () => {
    g.fillStyle = PR.ink;
    g.fillRect(4, 4, w, 34);
    g.fillRect(0, 0, w, 34);
    g.fillStyle = sel ? PR.ultra : PR.cream;
    g.fillRect(3, 3, w - 6, 28);
  });
  text(g, label, right - w / 2, cy + 5, { font: `13px ${FONT_BLACK}`, align: 'center', color: sel ? PR.mango : PR.ultra, shadow: null });
}

export function drawSettings(g: CanvasRenderingContext2D, v: SettingsView): void {
  stripesBg(g);
  logoText(g, 'SETTINGS', 40, 42, 40, 'left');
  g.font = `italic 40px ${FONT_BLACK}`;
  settingsTabs(g, v, 40 + g.measureText('SETTINGS').width + 22);
  if (v.tab === 'keys') drawKeysTab(g, v);
  else drawGameTab(g, v);
}

const TAB_HINTS: [string, string][] = [['← →', 'KEYS / GAME'], ['↓', 'SELECT'], ['ESC', 'BACK']];

function drawKeysTab(g: CanvasRenderingContext2D, v: SettingsView): void {
  const px = 40;
  const py = 80;
  const pw = 560;
  const rowH = 25;
  const ph = 22 + BINDABLE.length * (rowH + 3) + 20;
  darkPanel(g, px, py, pw, ph);
  const cAction = px + 24;
  const cKey = cAction + 220;
  const cAlt = cKey + 150;
  const hy = py + 22;
  for (const [label, x] of [['ACTION', cAction], ['KEY', cKey], ['ALT KEY', cAlt]] as const) {
    text(g, label, x, hy, { font: `10px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  }
  g.fillStyle = PR.ultra;
  g.fillRect(px + 14, hy + 6, pw - 28, 2);

  BINDABLE.forEach(({ action, label }, i) => {
    const y = hy + 12 + i * (rowH + 3);
    const cy = y + rowH / 2;
    const selected = v.row === i + 1;
    skewBox(g, px + pw / 2, cy, pw - 28, rowH, 8, () => {
      g.fillStyle = selected ? PR.ultra : i % 2 === 0 ? PR.inkRow : PR.ink;
      g.fillRect(0, 0, pw - 28, rowH);
    });
    const keys = v.bindings[action];
    const unbound = !keys[0] && !keys[1];
    text(g, label, cAction, cy + 4, { font: `bold 12px ${FONT_UI}`, color: unbound ? PR.red : PR.cream, shadow: null });
    keys.forEach((code, c) => {
      const x = c === 0 ? cKey : cAlt;
      const active = selected && v.col === c;
      if (active && v.listening) {
        g.font = `10px ${FONT_BLACK}`;
        const w = g.measureText('PRESS A KEY…').width + 16;
        g.fillStyle = PR.mango;
        g.fillRect(x, cy - 9, w, 18);
        g.setLineDash([3, 2]);
        g.strokeStyle = PR.ink;
        g.lineWidth = 2;
        g.strokeRect(x, cy - 9, w, 18);
        g.setLineDash([]);
        text(g, 'PRESS A KEY…', x + 8, cy + 4, { font: `10px ${FONT_BLACK}`, color: PR.ink, shadow: null });
        return;
      }
      let w = 22;
      if (code) w = keycap(g, keyLabel(code), x, cy - 1, 22, 11);
      else text(g, '—', x + 4, cy + 4, { font: `bold 12px ${FONT_UI}`, color: '#6B6680', shadow: null });
      if (active) {
        g.strokeStyle = PR.mango;
        g.lineWidth = 2;
        g.strokeRect(x - 4, cy - 12, w + 8, 24);
      }
    });
  });

  const by = py + ph + 22;
  settingsButton(g, 'BACK', v.row === BINDABLE.length + 2, px + pw, by, 110);
  settingsButton(g, 'RESET DEFAULTS', v.row === BINDABLE.length + 1, px + pw - 128, by, 190);
  if (v.message) text(g, v.message, px, by + 5, { font: `bold 11px ${FONT_UI}`, color: PR.ink, shadow: null });

  footerHints(
    g,
    v.listening
      ? [['ANY KEY', 'ASSIGN'], ['ESC', 'CANCEL']]
      : v.row === 0
        ? TAB_HINTS
        : [['↑ ↓', 'SELECT'], ['← →', 'KEY / ALT'], ['ENTER', 'REMAP'], ['DEL', 'CLEAR'], ['ESC', 'BACK']],
    457,
  );
}

function drawGameTab(g: CanvasRenderingContext2D, v: SettingsView): void {
  const px = 40;
  const py = 80;
  const pw = 560;
  const rowH = 54;
  const gap = 6;
  const ph = 16 + v.game.length * (rowH + gap) + 10;
  darkPanel(g, px, py, pw, ph);
  v.game.forEach((opt, i) => {
    const y = py + 16 + i * (rowH + gap);
    const selected = v.row === i + 1;
    skewBox(g, px + pw / 2, y + rowH / 2, pw - 28, rowH, 6, () => {
      g.fillStyle = selected ? PR.ultra : i % 2 === 0 ? PR.inkRow : PR.ink;
      g.fillRect(0, 0, pw - 28, rowH);
    });
    text(g, opt.label, px + 28, y + 22, { font: `13px ${FONT_BLACK}`, color: PR.cream, shadow: null });
    text(g, opt.desc, px + 28, y + 41, { font: `bold 10px ${FONT_UI}`, color: selected ? '#C9CCF0' : PR.muted, shadow: null });
    const right = px + pw - 30;
    const arrow = selected ? PR.mango : '#6B6680';
    text(g, '▶', right, y + 22, { font: `bold 11px ${FONT_UI}`, align: 'right', color: arrow, shadow: null });
    text(g, opt.value, right - 18, y + 22, { font: `12px ${FONT_BLACK}`, align: 'right', color: selected ? PR.mango : PR.amber, shadow: null });
    g.font = `12px ${FONT_BLACK}`;
    const vw = g.measureText(opt.value).width;
    text(g, '◀', right - 18 - vw - 8, y + 22, { font: `bold 11px ${FONT_UI}`, align: 'right', color: arrow, shadow: null });
  });
  settingsButton(g, 'BACK', v.row === v.game.length + 1, px + pw, py + ph + 22, 110);
  footerHints(
    g,
    v.row === 0
      ? TAB_HINTS
      : v.row > v.game.length
        ? [['↑ ↓', 'SELECT'], ['ENTER', 'BACK'], ['ESC', 'BACK']]
        : v.row === 1
          ? [['↑ ↓', 'SELECT'], ['← →', 'CHANGE SOUND'], ['ENTER', 'LISTEN'], ['ESC', 'BACK']]
          : [['↑ ↓', 'SELECT'], ['← →', 'CHANGE'], ['ESC', 'BACK']],
    457,
  );
}
