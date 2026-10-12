import { CONFIG } from '../../config';
import { addHit } from '../hit';
import { FONT_UI } from '../text';
import { FONT_BLACK, PR } from '../theme';
import { circle, footerHints, H, logoText, tag } from './common';

export const TITLE_ITEMS = ['NEW GAME', 'CONTROLS', 'SETTINGS', 'CREDITS'];

export interface TitleView {
  sel: number;
  lap: number;
  laps: number;
  top: string[];
  w: number;
}

export function drawTitle(g: CanvasRenderingContext2D, v: TitleView): void {
  const W = v.w;
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
    addHit(g, i, x, ry, w, rowH);
    g.fillStyle = sel ? PR.teal : 'rgba(28,25,48,0.92)';
    g.fillRect(x, ry, w, rowH);
    g.fillStyle = sel ? PR.night : PR.mango;
    g.fillRect(x + 3, ry + 3, 30, rowH - 6);
    g.fillStyle = sel ? PR.mango : PR.night;
    g.font = `12px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.fillText(`P${i + 1}`, x + 18, ry + rowH / 2 + 1);
    g.fillStyle = stripes[i % stripes.length]!;
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
  footerHints(
    g,
    [
      ['↑ ↓', 'SELECT'],
      ['ENTER', 'CONFIRM'],
      ['M', 'SOUND'],
    ],
    456,
    W / 2,
  );
}
