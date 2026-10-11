import { GameAudio } from './audio/audio';
import { CONFIG } from './config';
import { Input, loadBindings } from './input';
import { Game, loadOptions, readParams } from './states/game';
import { RaceState } from './states/race';
import { TitleState } from './states/title';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let renderScale = 1;

const params = readParams(location.search);
const input = new Input(window, loadBindings());
const audio = new GameAudio();
const game = new Game(input, audio, params);

input.onFirstInteraction = () => audio.unlock();
input.onBlur = () => {
  game.state.onBlur?.();
  audio.suspend();
};

if (params.debug) (window as unknown as { __game: Game }).__game = game;

game.set(params.quick ? new RaceState(game, loadOptions(params), 'running') : new TitleState(game));

function resize(): void {
  const s = Math.min(window.innerWidth / CONFIG.SCREEN_W, window.innerHeight / CONFIG.SCREEN_H);
  const scale = game.fit || s < 1 ? s : Math.floor(s);
  const cssW = Math.floor(CONFIG.SCREEN_W * scale);
  const cssH = Math.floor(CONFIG.SCREEN_H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  renderScale = canvas.width / CONFIG.SCREEN_W;
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
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  game.state.render(ctx, Math.min(1, acc / STEP));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
