import { type Bindings, keyLabel } from '../../input';
import { FONT_UI, text } from '../text';
import { FONT_BLACK, PR } from '../theme';
import { darkPanel, footerHints, keycap, screenHeader, skewBox, stripesBg, wrapText } from './common';

const TIPS = [
  'Above 150 MPH in a corner the car will spin. Red SKID lamp on? Brake before the turn.',
  'Oil on the track spins you out – steer around it. Hit a rival from behind and you get a time penalty.',
  'A full tank lasts about 12 laps. Low on fuel? Pull into PIT ROAD and stop in a box.',
  'Spun out? Stop, switch to reverse gear, back up and turn.',
];

const TOUCH_ROWS: [string, string][] = [
  ['◀ ▶', 'STEER (LEFT THUMB)'],
  ['GAS', 'ACCELERATE (RIGHT THUMB)'],
  ['BRAKE', 'BRAKE'],
  ['REV', 'REVERSE GEAR ON / OFF'],
  ['CAM', 'TOP-DOWN / COCKPIT VIEW'],
  ['❚❚', 'PAUSE'],
  ['☰', 'RACE MENU'],
  ['▲▼ OK', 'MENUS – OR TAP AN ITEM'],
];

export function drawHelp(g: CanvasRenderingContext2D, b: Bindings, touch = false): void {
  stripesBg(g);
  screenHeader(g, 'CONTROLS', 'HOW TO RACE');

  const px = 40;
  const py = 84;
  const pw = 272;
  const ph = 300;
  darkPanel(g, px, py, pw, ph);
  text(g, touch ? 'TOUCH CONTROLS' : 'YOUR KEYS', px + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  const k = (a: keyof Bindings) => keyLabel(b[a][0] ?? b[a][1]);
  const rows: [string, string][] = touch
    ? TOUCH_ROWS
    : [
        [`${k('left')} ${k('right')}`, 'STEER'],
        [k('gas'), 'ACCELERATE'],
        [k('brake'), 'BRAKE'],
        [k('reverse'), 'REVERSE GEAR ON / OFF'],
        [k('camera'), 'TOP-DOWN / COCKPIT VIEW'],
        [k('pause'), 'PAUSE'],
        [`ESC ${keyLabel(b.menu[0])}`, 'RACE MENU'],
        [k('mute'), 'SOUND ON / OFF'],
      ];
  rows.forEach(([key, label], i) => {
    const cy = py + 52 + i * 25;
    keycap(g, key, px + 17, cy, 54, 10);
    text(g, label, px + 17 + 76, cy + 4, { font: `bold 11px ${FONT_UI}`, color: PR.cream, shadow: null });
  });
  g.fillStyle = PR.ultra;
  g.fillRect(px + 17, py + ph - 42, pw - 34, 22);
  text(g, touch ? 'SLIDE A THUMB BETWEEN BUTTONS' : 'CHANGE ANY KEY IN SETTINGS', px + 27, py + ph - 27, {
    font: `bold 10px ${FONT_UI}`,
    color: PR.mango,
    shadow: null,
  });

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
    lines.forEach((ln, j) => {
      text(g, ln, qx + 50, ty + 10 + j * 15, { font: `bold 11px ${FONT_UI}`, color: PR.cream, shadow: null });
    });
    ty += Math.max(34, lines.length * 15 + 16);
  });

  footerHints(g, [['ENTER / ESC', 'BACK']], 457);
}
