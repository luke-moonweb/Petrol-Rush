import { layout } from '../../layout';
import { lapsCompleted } from '../../race/car';
import type { Race } from '../../race/race';
import type { ResultRow } from '../../ui/overlays';
import { offBall, redBall, text } from '../../ui/text';
import { FONT_BLACK, PR } from '../../ui/theme';

export const LIGHTS_COUNT = 5;
export const LIGHT_INTERVAL_S = 1;

export interface StartLights {
  t: number;
  outAt: number;
}

export function drawStartLights(g: CanvasRenderingContext2D, lights: StartLights, top = 12): void {
  const out = lights.t >= lights.outAt;
  const lit = out ? 0 : Math.min(LIGHTS_COUNT, Math.floor(lights.t / LIGHT_INTERVAL_S));
  const r = 7;
  const gap = 10;
  const w = LIGHTS_COUNT * 2 * r + (LIGHTS_COUNT + 1) * gap;
  const h = 2 * r + 2 * 8;
  const v = layout.view;
  const x0 = Math.round(v.x + v.w / 2 - w / 2);
  const y0 = v.y + top;
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

export function drawRaceMessage(g: CanvasRenderingContext2D, msg: string, top = 44): void {
  g.save();
  g.shadowColor = PR.amber;
  g.shadowBlur = 8;
  text(g, msg, layout.view.x + layout.view.w / 2, layout.view.y + top, {
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
