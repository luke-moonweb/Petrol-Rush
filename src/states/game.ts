import { GameAudio } from '../audio/audio';
import { DEFAULT_OPTIONS, LAP_CHOICES, QUALIFYING_CHOICES, RaceOptions } from '../config';
import { Input } from '../input';
import { loadPrefs, Prefs } from '../prefs';

export interface State {
  update(dt: number): void;
  render(g: CanvasRenderingContext2D, alpha: number): void;
  onBlur?(): void;
}

export interface Params {
  quick: boolean;
  debug: boolean;
  seed: number;
  overlayUrl: string | null;
  cars: number | null;
  laps: number | null;
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
        cars: typeof o.cars === 'number' ? o.cars : opts.cars,
        laps: typeof o.laps === 'number' ? o.laps : opts.laps,
        playerColor: typeof o.playerColor === 'number' ? o.playerColor : opts.playerColor,
        qualifying: QUALIFYING_CHOICES.includes(o.qualifying as never) ? o.qualifying! : opts.qualifying,
      };
    }
  } catch {
  }
  if (params.cars !== null) opts.cars = params.cars;
  if (params.laps !== null) opts.laps = params.laps;
  opts.cars = Math.max(1, Math.min(20, Math.round(opts.cars)));
  opts.laps = Math.max(1, Math.min(LAP_CHOICES[LAP_CHOICES.length - 1], Math.round(opts.laps)));
  opts.playerColor = Math.max(0, Math.min(19, Math.round(opts.playerColor)));
  return opts;
}

export function saveOptions(opts: RaceOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
  }
}

export class Game {
  state!: State;
  timeScale = 1;
  fit = true;
  readonly prefs: Prefs = loadPrefs();

  constructor(
    readonly input: Input,
    readonly audio: GameAudio,
    readonly params: Params,
  ) {}

  set(state: State): void {
    this.state = state;
  }
}
