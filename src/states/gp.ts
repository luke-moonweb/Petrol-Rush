import { DIFFICULTY_CHOICES, LAP_CHOICES, type RaceOptions } from '../config';
import { driverName } from '../gfx/vehicles';
import {
  type GpSetup,
  type GrandPrix,
  isOver,
  loadGp,
  newGrandPrix,
  pointsFor,
  round,
  type Standing,
  saveGp,
  standings,
} from '../race/grandprix';
import { NUM_COLORS } from '../race/race';
import { GP_DEFS } from '../track/gp';
import { getTrack, trackIds } from '../track/tracks';
import type { Hit } from '../ui/hit';
import { menuScreen } from '../ui/menus/common';
import { drawGpHub, type GpHubMode, type GpRoundView, type GpSetupRow, type GpStandingView } from '../ui/menus/gp';
import { ordinal } from '../ui/text';
import { type Game, loadOptions, type State, tapSide } from './game';
import { DIFFICULTY_LABELS } from './race/options';
import { RaceState } from './race/state';

// (no grid position: round 1 starts the player last, later rounds line up by the standings)
const SETUP_LABELS = ['CARS', 'LAPS', 'YOUR CAR', 'DIFFICULTY'];

let gpCount = 0;
const GP_DEFAULT_LAPS = 5;

/** The Grand Prix home screen: new championship setup, calendar and standings, final table. */
export class GrandPrixState implements State {
  private gp: GrandPrix | null;
  private mode: GpHubMode;
  private setup: GpSetup;
  private sel = 0;

  constructor(
    private readonly game: Game,
    gp: GrandPrix | null = loadGp(trackIds()),
    /** Standings before the round just raced, for the ▲▼ arrows. */
    private readonly before: Standing[] | null = null,
  ) {
    this.gp = gp;
    this.mode = !gp ? 'setup' : isOver(gp) ? 'final' : 'season';
    const o = loadOptions(game.params);
    this.setup = {
      cars: o.cars,
      laps: gp?.laps ?? GP_DEFAULT_LAPS,
      playerColor: o.playerColor,
      qualifying: 'last',
      difficulty: o.difficulty,
    };
  }

  private rows(): GpSetupRow[] {
    if (this.mode !== 'setup') return [];
    const s = this.setup;
    return [
      { label: SETUP_LABELS[0]!, value: String(s.cars) },
      { label: SETUP_LABELS[1]!, value: `${s.laps} PER RACE` },
      { label: SETUP_LABELS[2]!, carColor: s.playerColor },
      { label: SETUP_LABELS[3]!, value: DIFFICULTY_LABELS[s.difficulty]! },
    ];
  }

  private buttons(): string[] {
    switch (this.mode) {
      case 'setup':
        return ['START GRAND PRIX', 'BACK'];
      case 'season':
        return [`START ROUND ${round(this.gp!) + 1}`, 'NEW', 'BACK'];
      default:
        return ['NEW GRAND PRIX', 'BACK'];
    }
  }

  update(): void {
    const input = this.game.input;
    const audio = this.game.audio;
    const nRows = this.rows().length;
    const buttons = this.buttons();
    const n = nRows + buttons.length;
    const onRow = this.sel < nRows;
    if (input.pressed('back')) {
      audio.ui('back');
      this.leave();
      return;
    }
    let move = 0;
    if (input.pressed('up')) move = -1;
    if (input.pressed('down')) move = 1;
    if (!onRow && input.pressed('navLeft')) move = -1;
    if (!onRow && input.pressed('navRight')) move = 1;
    if (move !== 0) {
      this.sel = (this.sel + move + n) % n;
      audio.ui('move');
      return;
    }
    if (onRow) {
      let delta = 0;
      if (input.pressed('navLeft')) delta = -1;
      if (input.pressed('navRight') || input.pressed('enter')) delta = 1;
      if (delta !== 0) {
        audio.ui('move');
        this.change(this.sel, delta);
      }
      return;
    }
    if (!input.pressed('enter')) return;
    const label = buttons[this.sel - nRows]!;
    audio.ui(label === 'BACK' ? 'back' : 'ok');
    if (label === 'BACK') this.leave();
    else if (label === 'START GRAND PRIX') this.start();
    else if (label === 'NEW' || label === 'NEW GRAND PRIX') {
      this.mode = 'setup';
      this.sel = 0;
    } else this.race();
  }

  private leave(): void {
    if (this.mode === 'setup' && this.gp) {
      this.mode = isOver(this.gp) ? 'final' : 'season';
      this.sel = 0;
      return;
    }
    this.game.toTitle();
  }

  private change(row: number, delta: number): void {
    const s = { ...this.setup };
    switch (row) {
      case 0:
        s.cars = ((s.cars - 1 + delta + 20) % 20) + 1;
        break;
      case 1: {
        const idx = LAP_CHOICES.indexOf(s.laps);
        const cur = idx < 0 ? LAP_CHOICES.indexOf(5) : idx;
        s.laps = LAP_CHOICES[(cur + delta + LAP_CHOICES.length) % LAP_CHOICES.length]!;
        break;
      }
      case 2:
        s.playerColor = (s.playerColor + delta + NUM_COLORS) % NUM_COLORS;
        break;
      case 3: {
        const idx = DIFFICULTY_CHOICES.indexOf(s.difficulty);
        s.difficulty = DIFFICULTY_CHOICES[(idx + delta + DIFFICULTY_CHOICES.length) % DIFFICULTY_CHOICES.length]!;
        break;
      }
    }
    this.setup = s;
  }

  private start(): void {
    const seed = (this.game.params.seed + 104729 * ++gpCount) >>> 0;
    this.gp = newGrandPrix(
      this.setup,
      seed,
      GP_DEFS.map((d) => d.id),
    );
    saveGp(this.gp);
    this.mode = 'season';
    this.sel = 0;
  }

  private race(): void {
    const gp = this.gp!;
    const opts: RaceOptions = {
      track: gp.tracks[round(gp)]!,
      cars: gp.cars,
      laps: gp.laps,
      playerColor: gp.playerColor,
      qualifying: gp.qualifying,
      difficulty: gp.difficulty,
    };
    const before = standings(gp);
    const ctx = {
      gp,
      done: (next: GrandPrix) => {
        const raced = round(next) > round(gp);
        saveGp(next);
        this.game.set(new GrandPrixState(this.game, next, raced ? before : this.before));
      },
    };
    this.game.set(new RaceState(this.game, opts, 'choose', ctx));
  }

  hover(hit: Hit): void {
    this.sel = hit.id;
  }

  tap(hit: Hit | null, x: number): void {
    if (!hit) return;
    this.sel = hit.id;
    this.game.input.tapVirtual(hit.id < this.rows().length ? tapSide(hit, x) : 'enter');
  }

  private view() {
    const gp = this.gp;
    const tracks = (gp?.tracks ?? GP_DEFS.map((d) => d.id)).map(getTrack);
    const r = gp && this.mode !== 'setup' ? round(gp) : -1;
    const rounds: GpRoundView[] = tracks.map((track, i) => {
      let result: string | null = null;
      const res = gp && this.mode !== 'setup' ? gp.results[i] : undefined;
      if (res && gp) {
        const pos = res.order.indexOf(gp.playerColor) + 1;
        // single spaces: "20TH · 0 PTS · WIN: BRANNIGAN" just fits the calendar row
        result = res.dnf.includes(gp.playerColor) ? 'DNF' : `${ordinal(pos).toUpperCase()} · ${pointsFor(pos)} PTS`;
        const winner = res.order[0]!;
        if (winner !== gp.playerColor) result += ` · WIN: ${driverName(winner)}`;
      }
      return { track, result, next: i === r };
    });
    const table = gp ? standings(gp) : [];
    // Movement only means something once there was a table to move in.
    const scored = (this.before ?? []).some((s) => s.points > 0);
    const prev = new Map(scored ? this.before!.map((s, i) => [s.colorIdx, i]) : []);
    const list: GpStandingView[] = table.map((s, i) => ({
      pos: i + 1,
      colorIdx: s.colorIdx,
      name: s.colorIdx === gp?.playerColor ? 'YOU' : driverName(s.colorIdx),
      points: s.points,
      isPlayer: s.colorIdx === gp?.playerColor,
      move: prev.has(s.colorIdx) ? prev.get(s.colorIdx)! - i : 0,
    }));
    let tagText = 'NEW CHAMPIONSHIP';
    let note: string | null = null;
    if (gp && this.mode === 'season') tagText = `ROUND ${r + 1} OF ${gp.tracks.length}`;
    if (gp && this.mode === 'final') {
      tagText = 'FINAL STANDINGS';
      const mine = list.findIndex((s) => s.isPlayer) + 1;
      note = mine === 1 ? 'YOU ARE THE CHAMPION!' : `CHAMPION: ${list[0]!.name}  ·  YOU: ${ordinal(mine).toUpperCase()}`;
    }
    if (this.mode === 'setup' && gp && !isOver(gp)) note = 'STARTING ENDS THE CURRENT CHAMPIONSHIP';
    return {
      mode: this.mode,
      tagText,
      rows: this.rows(),
      buttons: this.buttons(),
      sel: this.sel,
      rounds,
      standings: list,
      note,
    };
  }

  render(g: CanvasRenderingContext2D): void {
    menuScreen(g, () => drawGpHub(g, this.view()));
  }
}
