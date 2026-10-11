import { BINDABLE, type Bindings, keyLabel } from '../../input';
import { FONT_UI, text } from '../text';
import { FONT_BLACK, PR } from '../theme';
import { darkPanel, footerHints, keycap, logoText, skewBox, skewButton, stripesBg, tag } from './common';

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

export function drawSettings(g: CanvasRenderingContext2D, v: SettingsView): void {
  stripesBg(g);
  logoText(g, 'SETTINGS', 40, 42, 40, 'left');
  g.font = `italic 40px ${FONT_BLACK}`;
  settingsTabs(g, v, 40 + g.measureText('SETTINGS').width + 22);
  if (v.tab === 'keys') drawKeysTab(g, v);
  else drawGameTab(g, v);
}

const TAB_HINTS: [string, string][] = [
  ['← →', 'KEYS / GAME'],
  ['↓', 'SELECT'],
  ['ESC', 'BACK'],
];

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
  for (const [label, x] of [
    ['ACTION', cAction],
    ['KEY', cKey],
    ['ALT KEY', cAlt],
  ] as const) {
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
  skewButton(g, 'BACK', v.row === BINDABLE.length + 2, px + pw, by, 110);
  skewButton(g, 'RESET DEFAULTS', v.row === BINDABLE.length + 1, px + pw - 128, by, 190);
  if (v.message) text(g, v.message, px, by + 5, { font: `bold 11px ${FONT_UI}`, color: PR.ink, shadow: null });

  footerHints(
    g,
    v.listening
      ? [
          ['ANY KEY', 'ASSIGN'],
          ['ESC', 'CANCEL'],
        ]
      : v.row === 0
        ? TAB_HINTS
        : [
            ['↑ ↓', 'SELECT'],
            ['← →', 'KEY / ALT'],
            ['ENTER', 'REMAP'],
            ['DEL', 'CLEAR'],
            ['ESC', 'BACK'],
          ],
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
    text(g, opt.value, right - 18, y + 22, {
      font: `12px ${FONT_BLACK}`,
      align: 'right',
      color: selected ? PR.mango : PR.amber,
      shadow: null,
    });
    g.font = `12px ${FONT_BLACK}`;
    const vw = g.measureText(opt.value).width;
    text(g, '◀', right - 18 - vw - 8, y + 22, { font: `bold 11px ${FONT_UI}`, align: 'right', color: arrow, shadow: null });
  });
  skewButton(g, 'BACK', v.row === v.game.length + 1, px + pw, py + ph + 22, 110);
  footerHints(
    g,
    v.row === 0
      ? TAB_HINTS
      : v.row > v.game.length
        ? [
            ['↑ ↓', 'SELECT'],
            ['ENTER', 'BACK'],
            ['ESC', 'BACK'],
          ]
        : v.row === 1
          ? [
              ['↑ ↓', 'SELECT'],
              ['← →', 'CHANGE SOUND'],
              ['ENTER', 'LISTEN'],
              ['ESC', 'BACK'],
            ]
          : [
              ['↑ ↓', 'SELECT'],
              ['← →', 'CHANGE'],
              ['ESC', 'BACK'],
            ],
    457,
  );
}
