import { GameAudio } from './audio/audio';
import { CONFIG } from './config';
import { Input, loadBindings } from './input';
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

if (touch) {
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CONFIG.SCREEN_W;
    const y = ((e.clientY - r.top) / r.height) * CONFIG.SCREEN_H;
    game.state.tap?.(hitAt(x, y), x);
  });
}

if (params.debug) (window as unknown as { __game: Game }).__game = game;

if (params.quick) game.set(new RaceState(game, loadOptions(params), 'running'));
else game.toTitle();

function resize(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const box = touch ? touch.gameBox(vw, vh) : { x: 0, y: 0, w: vw, h: vh };
  const s = Math.min(box.w / CONFIG.SCREEN_W, box.h / CONFIG.SCREEN_H);
  const scale = game.fit || s < 1 ? s : Math.floor(s);
  const cssW = Math.floor(CONFIG.SCREEN_W * scale);
  const cssH = Math.floor(CONFIG.SCREEN_H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  renderScale = canvas.width / CONFIG.SCREEN_W;
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
  touch?.update(game.state.touchLayout?.() ?? 'menu');
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  clearHits();
  game.state.render(ctx, Math.min(1, acc / STEP));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
