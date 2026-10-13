import { CONFIG } from '../config';
import { CAR_SCHEMES, driverName } from '../gfx/vehicles';
import { type Box, layout } from '../layout';
import { lapsCompleted, progress } from '../race/car';
import type { Race } from '../race/race';
import { FONT_UI } from './text';
import { FONT_BLACK, PR } from './theme';

const HUD_EDGE = '#2A2740';

const TOP_H = CONFIG.HUD_TOP_H;

function label(g: CanvasRenderingContext2D, str: string, x: number, y: number, color: string = PR.muted): number {
  g.font = `bold 9px ${FONT_UI}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = color;
  let cx = x;
  for (const ch of str) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + 2;
  }
  return cx - x;
}

function glowText(
  g: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  font: string,
  color: string,
  glow: string | null,
  align: CanvasTextAlign = 'left',
): number {
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillStyle = color;
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 6;
  }
  g.fillText(str, x, y);
  g.shadowBlur = 0;
  return g.measureText(str).width;
}

export function drawHudTop(g: CanvasRenderingContext2D, race: Race, notice: { text: string; age: number } | null = null): void {
  const p = race.player;
  g.fillStyle = PR.night;
  g.fillRect(0, 0, layout.w, TOP_H);
  g.fillStyle = HUD_EDGE;
  g.fillRect(0, TOP_H - 1, layout.w, 1);

  g.fillStyle = PR.red;
  g.fillRect(0, 0, 66, TOP_H - 1);
  g.fillStyle = PR.cream;
  g.beginPath();
  g.arc(14, 11, 3.5, 0, Math.PI * 2);
  g.fill();
  g.font = `11px ${FONT_BLACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let lx = 22;
  for (const ch of 'LIVE') {
    g.fillText(ch, lx, 12);
    lx += g.measureText(ch).width + 2;
  }

  const y = 17;
  let x = 84;
  const lap = p.finished ? race.laps : Math.min(race.laps, lapsCompleted(p) + 1);
  x += label(g, 'LAP', x, y) + 5;
  x += glowText(g, `${lap} / ${race.laps}`, x, y, `13px ${FONT_BLACK}`, PR.tealLight, 'rgba(18,181,166,0.9)') + 18;
  x += label(g, 'BEHIND', x, y) + 5;
  x += glowText(g, String(race.lapsBehind(p)), x, y, `13px ${FONT_BLACK}`, PR.tealLight, 'rgba(18,181,166,0.9)');

  const pos = String(race.position(p));
  const of = `/${race.cars.length}`;
  g.font = `16px ${FONT_BLACK}`;
  const wPos = g.measureText(pos).width;
  g.font = `10px ${FONT_BLACK}`;
  const wOf = g.measureText(of).width;
  const blockW = 12 + 22 + 4 + wPos + 4 + wOf + 12;
  const bx = layout.w - blockW;
  let noticeEnd = bx - 12;
  if (p.penalty > 0 && !p.finished) {
    const proj = `→ P${race.projectedPosition(p)}`;
    const pen = `PEN +${p.penalty}s`;
    g.font = `bold 9px ${FONT_UI}`;
    const wPen = g.measureText(pen).width;
    g.font = `12px ${FONT_BLACK}`;
    const wProj = g.measureText(proj).width;
    const pw = 10 + wPen + 6 + wProj + 10;
    const px = bx - pw;
    g.fillStyle = PR.red;
    g.fillRect(px, 0, pw, TOP_H - 1);
    g.fillStyle = PR.cream;
    g.font = `bold 9px ${FONT_UI}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(pen, px + 10, y);
    g.font = `12px ${FONT_BLACK}`;
    g.fillText(proj, px + 10 + wPen + 6, y);
    noticeEnd = px - 12;
  }
  if (notice) drawNotice(g, notice, x + 16, noticeEnd);
  g.fillStyle = PR.amber;
  g.fillRect(bx, 0, blockW, TOP_H - 1);
  g.fillStyle = PR.ink;
  g.font = `bold 9px ${FONT_UI}`;
  g.textBaseline = 'alphabetic';
  g.fillText('POS', bx + 12, y);
  g.font = `16px ${FONT_BLACK}`;
  g.fillText(pos, bx + 38, y + 1);
  g.font = `10px ${FONT_BLACK}`;
  g.fillText(of, bx + 42 + wPos, y);
}

function drawNotice(g: CanvasRenderingContext2D, n: { text: string; age: number }, x0: number, x1: number): void {
  if (n.age < 1 && Math.floor(n.age * 6) % 2 === 1) return;
  const alpha = Math.min(1, (4 - n.age) / 0.5);
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `11px ${FONT_BLACK}`;
  const tw = g.measureText(n.text).width;
  const w = 14 + 8 + tw + 12;
  const cx = (x0 + x1) / 2;
  const bx = Math.round(cx - w / 2);
  g.fillStyle = '#FFD21A';
  g.fillRect(bx, 3, w, TOP_H - 7);
  g.fillStyle = PR.ink;
  g.fillRect(bx + 7, 6, 1.5, TOP_H - 13);
  g.fillRect(bx + 8.5, 6, 8, 6);
  g.fillStyle = '#FFD21A';
  g.fillRect(bx + 10, 7.5, 2.5, 1.5);
  g.fillRect(bx + 13, 9, 2.5, 1.5);
  g.fillStyle = PR.ink;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(n.text, bx + 22, TOP_H / 2);
  g.restore();
}

function gapLabel(race: Race, i: number, list: ReturnType<Race['standings']>): string {
  if (i === 0) return 'LEADER';
  const car = list[i]!;
  const ahead = list[i - 1]!;
  const laps = Math.floor((progress(ahead, race.track) - progress(car, race.track)) / race.track.len);
  if (laps >= 1 && !race.leaderFinished) return `+${laps} LAP`;
  const gap = race.gap(car, ahead);
  return gap === null ? '—' : `+${gap.toFixed(2)}`;
}

export function drawHudPanel(g: CanvasRenderingContext2D, race: Race): void {
  const b = layout.panel;
  g.fillStyle = PR.night;
  g.fillRect(b.x, b.y, b.w, b.h);
  g.fillStyle = HUD_EDGE;
  const p = race.player;
  if (layout.mode === 'wide') {
    g.fillRect(b.x + b.w - 1, b.y, 1, b.h);
    drawTower(g, race, { x: b.x, y: b.y, w: b.w, h: b.h }, 1);
    drawSpeedo(g, p.speed, b.x + 62, b.y + 372, 54);
    drawFuelGauge(g, p.fuel, race.time, b.x + 62, b.y + 432, 34);
    return;
  }
  const gaugeW = 132;
  g.fillRect(b.x, b.y, b.w, 1);
  g.fillRect(b.x + gaugeW, b.y, 1, b.h);
  drawSpeedo(g, p.speed, b.x + gaugeW / 2, b.y + 72, 54);
  drawFuelGauge(g, p.fuel, race.time, b.x + gaugeW / 2, b.y + 146, 34);
  drawTower(g, race, { x: b.x + gaugeW, y: b.y, w: b.w - gaugeW, h: b.h }, 2);
}

function drawTower(g: CanvasRenderingContext2D, race: Race, box: Box, cols: number): void {
  const list = race.standings();
  const x0 = box.x + 4;
  const colGap = 6;
  const w = (box.w - 10 - colGap * (cols - 1)) / cols;
  const rowH = 14;
  const perCol = Math.ceil(list.length / cols);
  let x = x0;
  let y = box.y + 6;
  const p = race.player;
  const lap = p.finished ? race.laps : Math.min(race.laps, lapsCompleted(p) + 1);
  g.fillStyle = 'rgba(14,12,28,0.88)';
  g.fillRect(x, y, w, 16);
  g.fillStyle = PR.red;
  g.fillRect(x, y, 3, 16);
  label(g, 'LAP', x + 8, y + 11, PR.muted);
  g.font = `10px ${FONT_BLACK}`;
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  g.fillStyle = PR.cream;
  g.fillText(`${lap}/${race.laps}`, x + w - 6, y + 12);
  y += 18;
  g.fillStyle = 'rgba(14,12,28,0.82)';
  for (let c = 0; c < cols; c++) {
    const n = Math.min(perCol, list.length - c * perCol);
    if (n > 0) g.fillRect(x0 + c * (w + colGap), y, w, n * rowH + 2);
  }
  list.forEach((car, i) => {
    x = x0 + Math.floor(i / perCol) * (w + colGap);
    const ry = y + 1 + (i % perCol) * rowH;
    const me = car.isPlayer;
    if (me) {
      g.fillStyle = 'rgba(18,181,166,0.35)';
      g.fillRect(x, ry, w, rowH);
    }
    g.fillStyle = me ? PR.teal : '#1C1930';
    g.fillRect(x + 2, ry + 1, 18, rowH - 2);
    g.font = `9px ${FONT_BLACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = me ? PR.ink : PR.amber;
    g.fillText(String(i + 1), x + 11, ry + rowH / 2 + 0.5);
    g.fillStyle = CAR_SCHEMES[car.colorIdx % CAR_SCHEMES.length]!.body;
    g.fillRect(x + 23, ry + 3, 2, rowH - 6);
    let right = x + w - 5;
    const cy = ry + rowH / 2 + 0.5;
    if (car.penalty > 0) {
      g.font = `bold 7px ${FONT_UI}`;
      g.textAlign = 'right';
      const pen = `+${car.penalty}s`;
      const blink = race.time - car.penaltyAt < 3 && Math.floor((race.time - car.penaltyAt) * 4) % 2 === 1;
      if (!blink) {
        g.fillStyle = PR.red;
        g.fillText(pen, right, cy);
      }
      right -= g.measureText(pen).width + 4;
    }
    g.font = `bold 8px ${FONT_UI}`;
    g.textAlign = 'right';
    const gap = gapLabel(race, i, list);
    g.fillStyle = i === 0 ? PR.amber : me ? PR.tealLight : PR.muted;
    g.fillText(gap, right, cy);
    const name = me ? 'YOU' : driverName(car.colorIdx);
    const room = right - g.measureText(gap).width - 4 - (x + 29);
    for (const size of [8, 7, 6]) {
      g.font = `${size}px ${FONT_BLACK}`;
      if (g.measureText(name).width <= room) break;
    }
    g.save();
    g.beginPath();
    g.rect(x + 29, ry, room, rowH);
    g.clip();
    g.textAlign = 'left';
    g.fillStyle = me ? PR.cream : '#E8E6F0';
    g.fillText(name, x + 29, cy);
    g.restore();
  });
}

function semiDial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const half = (rr: number, fill: string | CanvasGradient) => {
    g.beginPath();
    g.arc(cx, cy, rr, Math.PI, Math.PI * 2);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const bezel = g.createLinearGradient(0, cy - r, 0, cy);
  bezel.addColorStop(0, '#4A4860');
  bezel.addColorStop(1, '#22202E');
  half(r, bezel);
  g.strokeStyle = HUD_EDGE;
  g.lineWidth = 1;
  g.stroke();
  half(r - 4, '#0A0914');
}

function needle(g: CanvasRenderingContext2D, cx: number, cy: number, a: number, len: number): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.shadowColor = '#FF5A3A';
  g.shadowBlur = 4;
  g.fillStyle = '#FF5A3A';
  g.beginPath();
  g.moveTo(-4, -1.5);
  g.lineTo(len, 0);
  g.lineTo(-4, 1.5);
  g.closePath();
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(cx, cy, 3.5, 0, Math.PI * 2);
  g.fillStyle = '#22202E';
  g.fill();
  g.strokeStyle = '#5A5870';
  g.lineWidth = 1;
  g.stroke();
}

export function drawSpeedo(g: CanvasRenderingContext2D, mph: number, cx: number, cy: number, r: number): void {
  const v = Math.min(200, Math.abs(mph));
  const ang = (val: number) => Math.PI + (val / 200) * Math.PI;
  g.save();
  semiDial(g, cx, cy, r);
  g.strokeStyle = PR.red;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, r - 8, ang(CONFIG.SPIN_MPH), ang(200));
  g.stroke();
  const hot = v > CONFIG.SPIN_MPH;
  g.strokeStyle = hot ? '#FF6A4A' : PR.red;
  g.lineWidth = 1.2;
  for (let val = CONFIG.SPIN_MPH; val <= 200; val += 5) {
    const a = ang(val);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 15), cy + Math.sin(a) * (r - 15));
    g.lineTo(cx + Math.cos(a) * (r - 9.5), cy + Math.sin(a) * (r - 9.5));
    g.stroke();
  }
  g.strokeStyle = PR.amber;
  for (let val = 0; val <= 200; val += 20) {
    if (val > CONFIG.SPIN_MPH) continue;
    const a = ang(val);
    const major = val % 40 === 0;
    g.lineWidth = major ? 2 : 1;
    const r0 = r - (major ? 12 : 9);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
    g.stroke();
  }
  g.fillStyle = PR.amber;
  g.font = `6px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let val = 0; val <= 200; val += 40) {
    const a = ang(val);
    g.fillText(String(val), cx + Math.cos(a) * (r - 19), cy + Math.sin(a) * (r - 19) + (val === 0 || val === 200 ? -3 : 0));
  }
  g.fillStyle = PR.tealLight;
  g.font = `bold 12px "Courier New", monospace`;
  g.fillText(String(Math.round(Math.abs(mph))), cx, cy - 14);
  needle(g, cx, cy, ang(v), r - 7);
  g.fillStyle = PR.muted;
  g.font = `6px ${FONT_BLACK}`;
  g.fillText('MPH', cx, cy + 7);
  g.restore();
}

export function drawFuelGauge(g: CanvasRenderingContext2D, fuel: number, time: number, cx: number, cy: number, r: number): void {
  const f = Math.max(0, Math.min(1, fuel));
  const ang = (val: number) => Math.PI + val * Math.PI;
  g.save();
  semiDial(g, cx, cy, r);
  g.strokeStyle = PR.red;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, r - 8, ang(0), ang(0.12));
  g.stroke();
  g.strokeStyle = PR.amber;
  for (let k = 0; k <= 4; k++) {
    const a = ang(k / 4);
    g.lineWidth = k % 2 === 0 ? 2 : 1;
    const r0 = r - (k % 2 === 0 ? 11 : 9);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
    g.stroke();
  }
  g.fillStyle = PR.amber;
  g.font = `6px ${FONT_BLACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('E', cx - r + 9, cy - 3);
  g.fillText('½', cx, cy - r + 15);
  g.fillText('F', cx + r - 9, cy - 3);
  needle(g, cx, cy, ang(f), r - 7);
  const lit = f < 0.12 && Math.floor(time * 3) % 2 === 0;
  const ic = lit ? PR.amber : PR.muted;
  if (lit) {
    g.shadowColor = PR.amber;
    g.shadowBlur = 6;
  }
  g.fillStyle = ic;
  g.fillRect(cx - 14, cy + 3, 5, 7);
  g.fillStyle = '#0A0914';
  g.fillRect(cx - 13, cy + 4, 3, 2);
  g.fillStyle = ic;
  g.fillRect(cx - 8, cy + 5, 1, 4);
  g.shadowBlur = 0;
  g.fillStyle = PR.muted;
  g.fillText('FUEL', cx + 4, cy + 7);
  g.restore();
}

export function drawSkidLamp(g: CanvasRenderingContext2D, level: 0 | 1 | 2, time: number, right: number, top: number): void {
  const w = 52;
  const h = 18;
  const x = right - w;
  g.save();
  g.fillStyle = 'rgba(14,12,28,0.88)';
  g.fillRect(x, top, w, h);
  g.strokeStyle = HUD_EDGE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
  const on = level === 1 || (level === 2 && Math.floor(time * 6) % 2 === 0);
  const lx = x + 10;
  const ly = top + h / 2;
  if (on) {
    g.shadowColor = PR.red;
    g.shadowBlur = 8;
  }
  g.fillStyle = on ? PR.red : '#3A2A2E';
  g.beginPath();
  g.arc(lx, ly, 4.5, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
  g.fillRect(lx - 2, ly - 3, 2, 2);
  g.font = `8px ${FONT_BLACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = level === 0 ? PR.muted : PR.red;
  g.fillText('SKID', lx + 9, ly + 0.5);
  g.restore();
}
