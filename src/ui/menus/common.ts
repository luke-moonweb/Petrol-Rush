import { CONFIG } from '../../config';
import { frameRect, inFrame, layout } from '../../layout';
import { hintList } from '../hints';
import { FONT_UI, text } from '../text';
import { FONT_BLACK, PR } from '../theme';

export const W = CONFIG.SCREEN_W;
export const H = CONFIG.SCREEN_H;
export const DEG = Math.PI / 180;

export function poly(g: CanvasRenderingContext2D, pts: number[], fill: string): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

export function circle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string | null, stroke?: string, lw = 1): void {
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

export function rrect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | null,
  stroke?: string,
  lw = 1,
): void {
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

export function skewBox(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, deg: number, draw: () => void): void {
  g.save();
  g.translate(cx, cy);
  g.transform(1, 0, Math.tan(-deg * DEG), 1, 0, 0);
  g.translate(-w / 2, -h / 2);
  draw();
  g.restore();
}

export function logoText(g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, align: CanvasTextAlign): void {
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

export function tag(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  cy: number,
  bg: string,
  fg: string,
  size = 11,
  shadow = false,
): number {
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

export function keycap(g: CanvasRenderingContext2D, label: string, x: number, cy: number, minW = 22, size = 11): number {
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

export function footerHints(g: CanvasRenderingContext2D, hints: [string, string][], cy: number, cx = W / 2): void {
  const gap = 22;
  g.font = `bold 11px ${FONT_UI}`;
  const parts = hintList(hints).map(([k, l]) => {
    g.font = `bold 11px ${FONT_UI}`;
    const kw = g.measureText(k).width + 12;
    const lw = g.measureText(l).width;
    return { k, l, kw, w: kw + 7 + lw };
  });
  const total = parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1);
  let x = cx - total / 2;
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

export function stripesBg(g: CanvasRenderingContext2D): void {
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

export function menuScreen(g: CanvasRenderingContext2D, draw: () => void): void {
  const f = frameRect();
  g.fillStyle = PR.mango;
  g.fillRect(0, 0, layout.w, layout.h);
  g.fillStyle = PR.red;
  g.fillRect(0, f.y + 430 * f.s, layout.w, 5 * f.s);
  g.fillStyle = PR.ink;
  g.fillRect(0, f.y + 435 * f.s, layout.w, layout.h);
  inFrame(g, draw);
}

export function screenHeader(g: CanvasRenderingContext2D, title: string, tagText: string): void {
  logoText(g, title, 40, 42, 40, 'left');
  g.font = `italic 40px ${FONT_BLACK}`;
  const w = g.measureText(title).width;
  tag(g, tagText, 40 + w + 22, 50, PR.ultra, PR.mango, 11);
}

export function wrapText(g: CanvasRenderingContext2D, str: string, maxW: number): string[] {
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

export function darkPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = PR.mangoDeep;
  g.fillRect(x + 6, y + 6, w, h);
  g.fillStyle = PR.ultra;
  g.fillRect(x, y, w, h);
  g.fillStyle = PR.ink;
  g.fillRect(x + 3, y + 3, w - 6, h - 6);
}

export function skewButton(g: CanvasRenderingContext2D, label: string, sel: boolean, right: number, cy: number, w: number): void {
  skewBox(g, right - w / 2, cy, w, 34, 12, () => {
    g.fillStyle = PR.ink;
    g.fillRect(4, 4, w, 34);
    g.fillRect(0, 0, w, 34);
    g.fillStyle = sel ? PR.ultra : PR.cream;
    g.fillRect(3, 3, w - 6, 28);
  });
  text(g, label, right - w / 2, cy + 5, { font: `13px ${FONT_BLACK}`, align: 'center', color: sel ? PR.mango : PR.ultra, shadow: null });
}
