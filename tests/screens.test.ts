// (the stand-in browser above must load before the game modules)
import { describe, expect, it } from 'vitest';
import { GameAudio } from '../src/audio/audio';
import { CONFIG } from '../src/config';
import { type Action, Input } from '../src/input';
import { computeLayout, setLayout } from '../src/layout';
import type { Car } from '../src/race/car';
import { type GrandPrix, newGrandPrix } from '../src/race/grandprix';
import type { Race } from '../src/race/race';
import { Game, readParams } from '../src/states/game';
import { RaceState } from '../src/states/race/state';
import { TitleState } from '../src/states/title';
import { GP_DEFS } from '../src/track/gp';
import { clearHits } from '../src/ui/hit';
import { drawing, resetDrawing, StubCanvas } from './sim/browser';

// The screens run headless: real Game, states, input and audio (silent until unlocked), drawing into
// stub canvases. The flow test catches crashes and broken menu logic in seconds, without a browser.
// The fingerprints pin every canvas call of a few fixed frames, so a refactor of the drawing code
// (gfx, ui, states) can be checked bit for bit; after an intended visual change, update them with
// `npx vitest run tests/screens.test.ts -u` and check the change in the browser.

const STEP = 1 / CONFIG.STEP_HZ;
const SCALE = 2;

function newGame(): Game {
  setLayout(computeLayout(640, 480));
  const input = new Input(new EventTarget() as unknown as Window);
  const game = new Game(input, new GameAudio(), readParams('?seed=7'), (g) => new TitleState(g));
  game.toTitle();
  return game;
}

function run(game: Game, seconds: number): void {
  for (let i = Math.round(seconds * CONFIG.STEP_HZ); i > 0; i--) {
    game.state.update(STEP);
    game.input.endStep();
  }
}

/** A key press (or touch tap) for one step. */
function press(game: Game, action: Action, times = 1): void {
  for (let i = 0; i < times; i++) {
    game.input.tapVirtual(action);
    run(game, STEP);
  }
}

/** Draws one frame like main.ts; returns its fingerprint and the number of canvas calls. */
function frame(game: Game): { hash: string; calls: number } {
  const canvas = new StubCanvas();
  canvas.width = 640 * SCALE;
  canvas.height = 480 * SCALE;
  const g = canvas.getContext();
  resetDrawing();
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  clearHits(SCALE);
  game.state.render(g, 1);
  return { hash: drawing.hash.toString(16).padStart(8, '0'), calls: drawing.calls };
}

const screen = (game: Game) =>
  game.state as unknown as { constructor: { name: string }; phase?: string; race?: Race; watched?: Car | null };

/** Round 1 of a short Grand Prix, started; the player's tank is emptied on the grid. */
function gpRaceOutOfFuel(game: Game): { race: Race; result: () => GrandPrix | null } {
  const gp = newGrandPrix(
    { cars: 8, laps: 1, playerColor: 4, qualifying: 'last', difficulty: 'normal' },
    99,
    GP_DEFS.map((d) => d.id),
  );
  let after: GrandPrix | null = null;
  const opts = { track: gp.tracks[0]!, cars: gp.cars, laps: gp.laps, playerColor: 4, qualifying: gp.qualifying, difficulty: gp.difficulty };
  game.set(new RaceState(game, opts, 'running', { gp, done: (next) => (after = next) }));
  const race = screen(game).race!;
  run(game, 9);
  expect(race.started).toBe(true);
  game.prefs.camera = 'cockpit';
  race.player.fuel = 0;
  run(game, 1);
  return { race, result: () => after };
}

describe('screens, headless', () => {
  it('title → race menu → settings → a race with the cockpit, pause and menu → results; fingerprints of each screen', () => {
    const game = newGame();
    const shots: Record<string, { hash: string; calls: number }> = {};
    run(game, 1);
    shots.title = frame(game);

    press(game, 'enter'); // QUICK RACE
    expect(screen(game).constructor.name).toBe('RaceState');
    expect(screen(game).phase).toBe('choose');
    shots.raceMenu = frame(game);

    press(game, 'down');
    press(game, 'enter'); // RACE SETTINGS
    expect(screen(game).phase).toBe('options');
    press(game, 'down', 2); // LAPS
    press(game, 'navLeft', 6); // 18 → 1
    press(game, 'down', 2); // GRID POSITION
    press(game, 'navRight'); // middle → pole
    press(game, 'down'); // DIFFICULTY
    press(game, 'navRight'); // normal → hard
    shots.settings = frame(game);
    press(game, 'down');
    press(game, 'enter'); // START RACE
    expect(screen(game).phase).toBe('running');
    const race = screen(game).race!;
    expect(race.laps).toBe(1);
    expect(race.opts.difficulty).toBe('hard');

    run(game, 3);
    expect(race.started).toBe(false);
    shots.startLights = frame(game);
    run(game, 6);
    expect(race.started).toBe(true);

    game.input.setVirtual('gas', true);
    run(game, 8);
    expect(race.player.speed).toBeGreaterThan(100);
    shots.topDown = frame(game);

    press(game, 'camera');
    expect(game.prefs.camera).toBe('cockpit');
    run(game, 1);
    shots.cockpit = frame(game);

    press(game, 'pause');
    expect(screen(game).phase).toBe('paused');
    shots.paused = frame(game);
    press(game, 'pause');
    expect(screen(game).phase).toBe('running');

    press(game, 'menu');
    expect(screen(game).phase).toBe('choose');
    shots.raceMenuLive = frame(game);
    press(game, 'enter'); // RESUME RACE
    expect(screen(game).phase).toBe('running');

    game.input.setVirtual('gas', false);
    race.autoPlayer = true;
    for (let t = 0; t < 120 && screen(game).phase !== 'results'; t += 1) run(game, 1);
    expect(screen(game).phase).toBe('results');
    expect(race.player.finished).toBe(true);
    shots.results = frame(game);

    press(game, 'enter');
    expect(screen(game).constructor.name).toBe('TitleState');

    for (const [name, shot] of Object.entries(shots)) expect(shot.calls, name).toBeGreaterThan(20);
    expect(shots).toMatchSnapshot();
  }, 60_000);

  it('a race on a Grand Prix circuit, top-down and in the cockpit; fingerprints of both', () => {
    const game = newGame();
    press(game, 'enter');
    press(game, 'down');
    press(game, 'enter'); // RACE SETTINGS
    press(game, 'navRight'); // TRACK: oval → harbour
    press(game, 'down', 6);
    press(game, 'enter'); // START RACE
    const race = screen(game).race!;
    expect(race.track.id).toBe('harbour');
    race.autoPlayer = true;
    run(game, 20);
    expect(race.player.speed).toBeGreaterThan(80);
    const topDown = frame(game);
    press(game, 'camera');
    expect(game.prefs.camera).toBe('cockpit');
    run(game, 1);
    const cockpit = frame(game);
    expect(cockpit.calls).toBeGreaterThan(200);
    expect({ topDown, cockpit }).toMatchSnapshot();
  }, 60_000);

  it('out of fuel in a Grand Prix, the player watches the cars still racing until all are home', () => {
    const game = newGame();
    const { race, result } = gpRaceOutOfFuel(game);
    const first = screen(game).watched!;
    expect(first.isPlayer).toBe(false);
    expect(game.prefs.camera).toBe('top');
    expect(game.state.touchLayout!()).toBe('menu');
    press(game, 'camera');
    expect(game.prefs.camera).toBe('top');
    press(game, 'navRight');
    expect(screen(game).watched).not.toBe(first);
    const watching = frame(game);
    expect(watching.calls).toBeGreaterThan(200);

    for (let t = 0; t < 200 && screen(game).phase !== 'results'; t += 1) run(game, 1);
    expect(screen(game).phase).toBe('results');
    expect(race.raceOver()).toBe(true);
    expect(race.cars.filter((c) => c.finished).length).toBe(7);
    press(game, 'enter');
    expect(result()!.results[0]!.dnf).toEqual([4]);
    expect({ watching }).toMatchSnapshot();
  }, 60_000);

  it('out of fuel in a Grand Prix, ENTER skips to the results', () => {
    const game = newGame();
    const { race } = gpRaceOutOfFuel(game);
    expect(screen(game).watched).toBeTruthy();
    press(game, 'enter');
    expect(screen(game).phase).toBe('finishing');
    run(game, 1);
    expect(screen(game).phase).toBe('results');
    expect(race.cars.filter((c) => c.finished).length).toBe(7);
  }, 60_000);
});
