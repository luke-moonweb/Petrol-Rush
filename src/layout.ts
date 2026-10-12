import { CONFIG } from './config';

export type LayoutMode = 'wide' | 'stacked';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  mode: LayoutMode;
  w: number;
  h: number;
  view: Box;
  panel: Box;
}

export const FRAME_W = CONFIG.SCREEN_W;
export const FRAME_H = CONFIG.SCREEN_H;
const TOP = CONFIG.HUD_TOP_H;
const MAX_W = 1120;
const STACK_MIN_W = 400;
export const STACK_PANEL_H = 180;
const STACK_MIN_GAIN = 1.08;

function wide(w: number): Layout {
  return {
    mode: 'wide',
    w,
    h: FRAME_H,
    view: { x: CONFIG.HUD_LEFT_W, y: TOP, w: w - CONFIG.HUD_LEFT_W, h: CONFIG.PLAY_H },
    panel: { x: 0, y: TOP, w: CONFIG.HUD_LEFT_W, h: CONFIG.PLAY_H },
  };
}

function stacked(w: number): Layout {
  return {
    mode: 'stacked',
    w,
    h: FRAME_H + STACK_PANEL_H,
    view: { x: 0, y: TOP, w, h: CONFIG.PLAY_H },
    panel: { x: 0, y: FRAME_H, w, h: STACK_PANEL_H },
  };
}

export function computeLayout(vw: number, vh: number): Layout {
  const aspect = vw / vh;
  const w = wide(Math.round(Math.min(MAX_W, Math.max(FRAME_W, FRAME_H * aspect))));
  const s = stacked(Math.round(Math.min(FRAME_W, Math.max(STACK_MIN_W, (FRAME_H + STACK_PANEL_H) * aspect))));
  const scale = (l: Layout) => Math.min(vw / l.w, vh / l.h);
  return scale(s) > scale(w) * STACK_MIN_GAIN ? s : w;
}

export const layout: Layout = wide(FRAME_W);

export function setLayout(next: Layout): void {
  Object.assign(layout, next);
}

export function frameRect(): { x: number; y: number; s: number } {
  const s = Math.min(1, layout.w / FRAME_W, layout.h / FRAME_H);
  return { x: (layout.w - FRAME_W * s) / 2, y: (layout.h - FRAME_H * s) / 2, s };
}

export function inFrame(g: CanvasRenderingContext2D, draw: () => void): void {
  const f = frameRect();
  g.save();
  g.translate(f.x, f.y);
  g.scale(f.s, f.s);
  draw();
  g.restore();
}
