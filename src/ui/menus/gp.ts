import { drawTrackMap } from '../../gfx/trackmap';
import { carIcon } from '../../gfx/vehicles';
import type { Track } from '../../track/common';
import { addHit } from '../hit';
import { FONT_UI, text } from '../text';
import { FONT_BLACK, PR } from '../theme';
import { darkPanel, footerHints, logoText, skewBox, skewButton, stripesBg, tag } from './common';

export type GpHubMode = 'setup' | 'season' | 'final';

export interface GpRoundView {
  track: Track;
  /** e.g. "P3 · 15 PTS" once raced. */
  result: string | null;
  next: boolean;
}

export interface GpStandingView {
  pos: number;
  colorIdx: number;
  name: string;
  points: number;
  isPlayer: boolean;
  /** Places gained (+) or lost (−) in the last round. */
  move: number;
}

export interface GpSetupRow {
  label: string;
  value?: string;
  carColor?: number;
}

export interface GpHubView {
  mode: GpHubMode;
  tagText: string;
  rows: GpSetupRow[];
  buttons: string[];
  /** Index into rows, then buttons. */
  sel: number;
  rounds: GpRoundView[];
  standings: GpStandingView[];
  note: string | null;
}

const PANEL_Y = 78;
const CAL_X = 30;
const CAL_W = 262;
const RIGHT_X = 312;
const RIGHT_W = 298;
const ROW_H = 54;

function drawCalendar(g: CanvasRenderingContext2D, v: GpHubView): void {
  const h = 22 + v.rounds.length * ROW_H + 6;
  darkPanel(g, CAL_X, PANEL_Y, CAL_W, h);
  text(g, 'CALENDAR', CAL_X + 16, PANEL_Y + 20, { font: `10px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  v.rounds.forEach((r, i) => {
    const y = PANEL_Y + 28 + i * ROW_H;
    if (r.next) {
      g.fillStyle = PR.ultra;
      g.fillRect(CAL_X + 8, y - 2, CAL_W - 16, ROW_H - 4);
    }
    g.fillStyle = PR.inkRow;
    g.fillRect(CAL_X + 14, y + 2, 64, ROW_H - 12);
    drawTrackMap(g, r.track, CAL_X + 16, y + 4, 60, ROW_H - 16, r.result ? PR.muted : r.next ? PR.mango : PR.tealLight, 2);
    text(g, `ROUND ${i + 1}`, CAL_X + 88, y + 14, { font: `bold 9px ${FONT_UI}`, color: r.next ? PR.mango : PR.muted, shadow: null });
    text(g, r.track.name, CAL_X + 88, y + 29, { font: `12px ${FONT_BLACK}`, color: PR.cream, shadow: null });
    const sub = r.result ?? (r.next ? 'NEXT RACE' : `${(r.track.len / 1000).toFixed(1)} KM LAP`);
    text(g, sub, CAL_X + 88, y + 43, {
      font: `bold 10px ${FONT_UI}`,
      color: r.result ? PR.tealLight : r.next ? PR.amber : PR.muted,
      shadow: null,
    });
  });
}

function drawStandings(g: CanvasRenderingContext2D, v: GpHubView): void {
  const shown = v.standings.slice(0, 10);
  const player = v.standings.find((s) => s.isPlayer);
  if (player && !shown.includes(player)) shown[9] = player;
  const rowH = 25;
  const h = 30 + shown.length * rowH + 8;
  darkPanel(g, RIGHT_X, PANEL_Y, RIGHT_W, h);
  text(g, 'CHAMPIONSHIP', RIGHT_X + 16, PANEL_Y + 20, { font: `10px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  text(g, 'PTS', RIGHT_X + RIGHT_W - 18, PANEL_Y + 20, { font: `10px ${FONT_BLACK}`, color: PR.mango, align: 'right', shadow: null });
  shown.forEach((s, i) => {
    const y = PANEL_Y + 30 + i * rowH;
    const cy = y + rowH / 2;
    skewBox(g, RIGHT_X + RIGHT_W / 2, cy, RIGHT_W - 28, rowH - 3, 8, () => {
      g.fillStyle = s.isPlayer ? PR.teal : i % 2 === 0 ? PR.inkRow : PR.ink;
      g.fillRect(0, 0, RIGHT_W - 28, rowH - 3);
    });
    const ink = s.isPlayer ? PR.ink : PR.cream;
    text(g, String(s.pos), RIGHT_X + 34, cy + 5, {
      font: `12px ${FONT_BLACK}`,
      color: s.isPlayer ? PR.ink : PR.amber,
      align: 'right',
      shadow: null,
    });
    carIcon(g, s.colorIdx, RIGHT_X + 58, cy + 5, 0.5);
    text(g, s.name, RIGHT_X + 80, cy + 4, { font: `10px ${FONT_BLACK}`, color: ink, shadow: null });
    if (s.move !== 0) {
      const up = s.move > 0;
      text(g, `${up ? '▲' : '▼'}${Math.abs(s.move)}`, RIGHT_X + RIGHT_W - 64, cy + 4, {
        font: `bold 9px ${FONT_UI}`,
        color: s.isPlayer ? PR.ink : up ? PR.tealLight : '#FF7A6A',
        align: 'right',
        shadow: null,
      });
    }
    text(g, String(s.points), RIGHT_X + RIGHT_W - 20, cy + 5, { font: `12px ${FONT_BLACK}`, color: ink, align: 'right', shadow: null });
  });
}

function drawSetup(g: CanvasRenderingContext2D, v: GpHubView): void {
  const rowH = 44;
  const h = 30 + v.rows.length * (rowH + 6) + 4;
  darkPanel(g, RIGHT_X, PANEL_Y, RIGHT_W, h);
  text(g, 'NEW CHAMPIONSHIP', RIGHT_X + 16, PANEL_Y + 20, { font: `10px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  v.rows.forEach((r, i) => {
    const y = PANEL_Y + 30 + i * (rowH + 6);
    const sel = v.sel === i;
    const x = RIGHT_X + 14;
    const w = RIGHT_W - 28;
    addHit(g, i, x, y, w, rowH);
    g.fillStyle = sel ? PR.ultra : PR.inkRow;
    g.fillRect(x, y, w, rowH);
    text(g, r.label, x + 10, y + 15, { font: `bold 9px ${FONT_UI}`, color: sel ? PR.mango : PR.muted, shadow: null });
    const cy = y + 31;
    if (sel) {
      text(g, '◀', x + 12, cy + 4, { font: `bold 11px ${FONT_UI}`, color: PR.mango, shadow: null });
      text(g, '▶', x + w - 12, cy + 4, { font: `bold 11px ${FONT_UI}`, color: PR.mango, align: 'right', shadow: null });
    }
    if (r.carColor !== undefined) carIcon(g, r.carColor, x + w / 2, cy + 5, 0.6);
    else if (r.value !== undefined)
      text(g, r.value, x + w / 2, cy + 5, { font: `13px ${FONT_BLACK}`, color: PR.cream, align: 'center', shadow: null });
  });
}

export function drawGpHub(g: CanvasRenderingContext2D, v: GpHubView): void {
  stripesBg(g);
  logoText(g, 'GRAND PRIX', 40, 42, 40, 'left');
  g.font = `italic 40px ${FONT_BLACK}`;
  tag(g, v.tagText, 40 + g.measureText('GRAND PRIX').width + 22, 50, PR.ultra, PR.mango, 11);

  drawCalendar(g, v);
  if (v.mode === 'setup') drawSetup(g, v);
  else drawStandings(g, v);

  const by = 404;
  let right = 610;
  const nRows = v.rows.length;
  for (let i = v.buttons.length - 1; i >= 0; i--) {
    const label = v.buttons[i]!;
    g.font = `13px ${FONT_BLACK}`;
    const w = Math.max(110, g.measureText(label).width + 40);
    skewButton(g, label, v.sel === nRows + i, right, by, w);
    addHit(g, nRows + i, right - w, by - 17, w, 38);
    right -= w + 18;
  }
  if (v.note) text(g, v.note, CAL_X, by + 5, { font: `bold 11px ${FONT_UI}`, color: PR.ink, shadow: null });
  footerHints(
    g,
    v.mode === 'setup'
      ? [
          ['↑ ↓', 'SELECT'],
          ['← →', 'CHANGE'],
          ['ENTER', 'OK'],
          ['ESC', 'BACK'],
        ]
      : [
          ['← →', 'SELECT'],
          ['ENTER', 'OK'],
          ['ESC', 'BACK'],
        ],
    456,
  );
}
