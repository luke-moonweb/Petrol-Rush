import { CONFIG } from '../../config';
import { layout } from '../../layout';
import { type Car, lapsCompleted } from '../../race/car';
import type { Race } from '../../race/race';
import type { ResultRow } from '../../ui/overlays';
import { offBall, redBall, text } from '../../ui/text';
import { FONT_BLACK, PR } from '../../ui/theme';

export const LIGHTS_COUNT = 5;
export const LIGHT_INTERVAL_S = 1;

const SPEED_BAR_MAX_OVER = 20;

export interface StartLights {
  t: number;
  outAt: number;
}

export function drawStartLights(g: CanvasRenderingContext2D, lights: StartLights): void {
  const out = lights.t >= lights.outAt;
  const lit = out ? 0 : Math.min(LIGHTS_COUNT, Math.floor(lights.t / LIGHT_INTERVAL_S));
  const r = 7;
  const gap = 10;
  const w = LIGHTS_COUNT * 2 * r + (LIGHTS_COUNT + 1) * gap;
  const h = 2 * r + 2 * 8;
  const v = layout.view;
  const x0 = Math.round(v.x + v.w / 2 - w / 2);
  const y0 = v.y + 12;
  g.fillStyle = PR.night;
  g.fillRect(x0, y0, w, h);
  g.strokeStyle = '#2A2740';
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  for (let i = 0; i < LIGHTS_COUNT; i++) {
    const cx = x0 + gap + r + i * (2 * r + gap);
    const cy = y0 + h / 2;
    if (i < lit) {
      g.save();
      g.shadowColor = PR.red;
      g.shadowBlur = 12;
      redBall(g, cx, cy);
      g.restore();
    } else offBall(g, cx, cy);
  }
}

export function drawSpeedBar(g: CanvasRenderingContext2D, p: Car, pitAuto: boolean, cx: number, bottom: number): void {
  if (pitAuto || p.finished || p.spinTime > 0) return;
  const over = Math.abs(p.speed) - CONFIG.SPIN_MPH;
  if (over <= 0.5) return;
  const W_BAR = 34;
  const H_BAR = 4;
  const scale = W_BAR / SPEED_BAR_MAX_OVER;
  const len = Math.min(W_BAR, over * scale);
  const slideEnd = CONFIG.SLIDE_SPIN_OVER * scale;
  const x0 = Math.round(cx - W_BAR / 2);
  const y0 = Math.round(bottom - H_BAR);
  g.fillStyle = 'rgba(10,9,20,0.55)';
  g.fillRect(x0 - 1, y0 - 1, W_BAR + 2, H_BAR + 2);
  g.fillStyle = '#FF9A2E';
  g.fillRect(x0, y0, Math.min(len, slideEnd), H_BAR);
  if (len > slideEnd) {
    g.fillStyle = PR.red;
    g.fillRect(x0 + slideEnd, y0, len - slideEnd, H_BAR);
  }
  g.fillStyle = 'rgba(255,248,232,0.5)';
  g.fillRect(x0 + slideEnd, y0 - 1, 1, H_BAR + 2);
}

export function drawRaceMessage(g: CanvasRenderingContext2D, msg: string): void {
  g.save();
  g.shadowColor = PR.amber;
  g.shadowBlur = 8;
  text(g, msg, layout.view.x + layout.view.w / 2, layout.view.y + 44, {
    font: `14px ${FONT_BLACK}`,
    align: 'center',
    color: PR.amber,
    shadow: null,
  });
  g.restore();
}

export function resultRows(race: Race): ResultRow[] {
  const list = race.classification();
  const winner = list[0]!;
  const tWin = race.resultTime(winner);
  return list.map((car, i) => {
    let time: string;
    const t = race.resultTime(car);
    const lapsDown = lapsCompleted(winner) - lapsCompleted(car);
    const dnf = car.isPlayer && race.playerRetired;
    if (dnf || (!car.finished && race.autoPlayer)) time = 'DNF';
    else if (i === 0 && t !== null) {
      const m = Math.floor(t / 60);
      time = `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
    } else if (t !== null && tWin !== null && lapsDown === 0) time = `+${(t - tWin).toFixed(2)}`;
    else if (lapsDown > 0) time = `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
    else time = 'RUNNING';
    return { colorIdx: car.colorIdx, isPlayer: car.isPlayer, time, penalty: car.penalty };
  });
}

export function drawDebug(g: CanvasRenderingContext2D, lines: string[]): void {
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(4, 4, 300, lines.length * 12 + 6);
  lines.forEach((l, i) => {
    text(g, l, 8, 16 + i * 12, { font: `10px monospace`, shadow: null, color: '#8f8' });
  });
}
