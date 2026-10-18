import { GameAudio } from './audio/audio';
import { CONFIG } from './config';
import { Input, loadBindings } from './input';
import { computeLayout, FRAME_H, FRAME_W, layout, setLayout } from './layout';
import { Game, loadOptions, readParams } from './states/game';
import { RaceState } from './states/race/state';
import { TitleState } from './states/title';
import { prefersTouch, TouchControls } from './touch';
import { setTouchHints } from './ui/hints';
import { clearHits, hitAt } from './ui/hit';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let renderScale = 1;

const params = readParams(location.search);
const input = new Input(window, loadBindings());
const audio = new GameAudio();
const game = new Game(input, audio, params, (g) => new TitleState(g));
game.touch = prefersTouch(params.touch);
setTouchHints(game.touch);
const touch = game.touch ? new TouchControls(input, () => audio.muted) : null;

input.onFirstInteraction = () => audio.unlock();
input.onBlur = () => {
  game.state.onBlur?.();
  audio.suspend();
};

function pointAt(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * layout.w, y: ((e.clientY - r.top) / r.height) * layout.h };
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  e.preventDefault();
  const p = pointAt(e);
  game.state.tap?.(hitAt(p.x, p.y), p.x);
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const p = pointAt(e);
  game.state.tap?.(hitAt(p.x, p.y), p.x);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const p = pointAt(e);
  const hit = hitAt(p.x, p.y);
  canvas.style.cursor = hit ? 'pointer' : '';
  if (hit) game.state.hover?.(hit, p.x);
});

if (params.debug) (window as unknown as { __game: Game }).__game = game;

if (params.quick) game.set(new RaceState(game, loadOptions(params), 'running'));
else game.toTitle();

function resize(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const box = touch ? touch.gameBox(vw, vh) : { x: 0, y: 0, w: vw, h: vh };
  setLayout(touch ? computeLayout(FRAME_W, FRAME_H) : computeLayout(box.w, box.h));
  const s = Math.min(box.w / layout.w, box.h / layout.h);
  const scale = game.fit || s < 1 ? s : Math.floor(s);
  const cssW = Math.floor(layout.w * scale);
  const cssH = Math.floor(layout.h * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  renderScale = canvas.width / layout.w;
  if (touch) {
    const rect = {
      x: Math.round(box.x + (box.w - cssW) / 2),
      y: touch.portrait ? box.y : Math.round(box.y + (box.h - cssH) / 2),
      w: cssW,
      h: cssH,
    };
    canvas.style.left = `${rect.x}px`;
    canvas.style.top = `${rect.y}px`;
    touch.arrange(rect, vw, vh);
  }
}
window.addEventListener('resize', resize);
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', resize);
resize();

const STEP = 1 / CONFIG.STEP_HZ;
let acc = 0;
let last = performance.now();

// ?debug: `__ff(40)` runs 40 s of game time at once and draws the result, so browser checks need no
// real-time waits (a hidden browser pane gets no animation frames at all).
if (params.debug) {
  (window as unknown as { __ff: (seconds: number) => void }).__ff = (seconds) => {
    for (let i = Math.round(seconds * CONFIG.STEP_HZ); i > 0; i--) {
      game.state.update(STEP);
      input.endStep();
    }
    acc = 0;
    draw();
  };
}

function frame(now: number): void {
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.25));
  last = now;
  acc += dt * game.timeScale;
  const maxSteps = CONFIG.MAX_STEPS_PER_FRAME * game.timeScale;
  let steps = 0;
  while (acc >= STEP && steps < maxSteps) {
    if (input.pressed('mute')) audio.toggleMute();
    if (input.pressed('fit')) {
      game.fit = !game.fit;
      resize();
    }
    game.state.update(STEP);
    input.endStep();
    acc -= STEP;
    steps++;
  }
  if (steps >= maxSteps) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

function draw(): void {
  touch?.update(game.state.touchLayout?.() ?? 'menu', game.state.touchCamera?.() ?? true);
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  clearHits(renderScale);
  game.state.render(ctx, Math.min(1, acc / STEP));
}
requestAnimationFrame(frame);
