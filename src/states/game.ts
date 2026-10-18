import type { GameAudio } from '../audio/audio';
import { DEFAULT_OPTIONS, DIFFICULTY_CHOICES, LAP_CHOICES, QUALIFYING_CHOICES, type RaceOptions } from '../config';
import type { Input } from '../input';
import { loadPrefs, type Prefs } from '../prefs';
import type { TouchLayout } from '../touch';
import { trackIds } from '../track/tracks';
import type { Hit } from '../ui/hit';

export interface State {
  update(dt: number): void;
  render(g: CanvasRenderingContext2D, alpha: number): void;
  onBlur?(): void;
  touchLayout?(): TouchLayout;
  // False hides the touch CAM button (the cockpit view exists on the oval only).
  touchCamera?(): boolean;
  tap?(hit: Hit | null, x: number): void;
  hover?(hit: Hit, x: number): void;
}

export interface Params {
  quick: boolean;
  debug: boolean;
  seed: number;
  overlayUrl: string | null;
  cars: number | null;
  laps: number | null;
  track: string | null;
  touch: boolean | null;
}

export function readParams(search: string): Params {
  const p = new URLSearchParams(search);
  const num = (k: string): number | null => {
    const v = p.get(k);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    quick: p.has('quick'),
    debug: p.has('debug'),
    seed: num('seed') ?? Math.floor(Math.random() * 1e9),
    overlayUrl: p.get('overlay'),
    cars: num('cars'),
    laps: num('laps'),
    track: p.get('track'),
    touch: p.has('touch') ? p.get('touch') !== '0' : null,
  };
}

const STORAGE_KEY = 'petrolrush.raceOptions';

export function loadOptions(params: Params): RaceOptions {
  let opts: RaceOptions = { ...DEFAULT_OPTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<RaceOptions>;
      opts = {
        track: typeof o.track === 'string' && trackIds().includes(o.track) ? o.track : opts.track,
        cars: typeof o.cars === 'number' ? o.cars : opts.cars,
        laps: typeof o.laps === 'number' ? o.laps : opts.laps,
        playerColor: typeof o.playerColor === 'number' ? o.playerColor : opts.playerColor,
        qualifying: QUALIFYING_CHOICES.includes(o.qualifying as never) ? o.qualifying! : opts.qualifying,
        difficulty: DIFFICULTY_CHOICES.includes(o.difficulty as never) ? o.difficulty! : opts.difficulty,
      };
    }
  } catch {}
  if (params.cars !== null) opts.cars = params.cars;
  if (params.laps !== null) opts.laps = params.laps;
  if (params.track !== null && trackIds().includes(params.track)) opts.track = params.track;
  opts.cars = Math.max(1, Math.min(20, Math.round(opts.cars)));
  opts.laps = Math.max(1, Math.min(LAP_CHOICES[LAP_CHOICES.length - 1]!, Math.round(opts.laps)));
  opts.playerColor = Math.max(0, Math.min(19, Math.round(opts.playerColor)));
  return opts;
}

export function saveOptions(opts: RaceOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {}
}

export function tapSide(hit: Hit, x: number): 'navLeft' | 'navRight' {
  return x < hit.x + hit.w / 2 ? 'navLeft' : 'navRight';
}

export class Game {
  state!: State;
  timeScale = 1;
  fit = true;
  touch = false;
  readonly prefs: Prefs = loadPrefs();

  constructor(
    readonly input: Input,
    readonly audio: GameAudio,
    readonly params: Params,
    private readonly titleScreen: (game: Game) => State,
  ) {}

  set(state: State): void {
    this.state = state;
  }

  toTitle(): void {
    this.set(this.titleScreen(this));
  }
}
