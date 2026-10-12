import { addHit } from '../hit';
import { FONT_UI, text } from '../text';
import { FONT_BLACK, PR } from '../theme';
import { darkPanel, footerHints, rrect, screenHeader, skewButton, stripesBg } from './common';

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

  text(g, 'All team and driver names are fictional.', px + 17, py + ph - 24, {
    font: `bold 10px ${FONT_UI}`,
    color: PR.muted,
    shadow: null,
  });

  const qx = px + pw + 16;
  darkPanel(g, qx, py, pw, ph);
  text(g, 'ON GITHUB', qx + 17, py + 24, { font: `12px ${FONT_BLACK}`, color: PR.mango, shadow: null });
  const bw = pw - 44;
  CREDITS_ITEMS.forEach((item, i) => {
    const cy = py + 62 + i * 76;
    skewButton(g, item, v.sel === i, qx + 22 + bw, cy, bw);
    addHit(i, qx + 22, cy - 17, bw, 38);
    const link = v.links[i];
    if (link) {
      text(g, link.replace('https://', ''), qx + 22, cy + 38, {
        font: `bold 10px ${FONT_UI}`,
        color: v.sel === i ? PR.mango : PR.muted,
        shadow: null,
      });
    }
  });

  footerHints(
    g,
    [
      ['↑ ↓', 'SELECT'],
      ['ENTER', 'OPEN'],
      ['ESC', 'BACK'],
    ],
    457,
  );
}
