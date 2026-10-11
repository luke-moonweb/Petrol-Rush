import { ENGINE_STYLES } from '../audio/engines';
import { CONFIG } from '../config';
import { BINDABLE, BindableAction, Bindings, DEFAULT_BINDINGS, keyLabel, RESERVED_CODES, saveBindings } from '../input';
import { savePrefs } from '../prefs';
import { drawSettings, GameOptionRow, KEYS_ROWS, SettingsTab } from '../ui/menus';
import { Game, State } from './game';

const ROW_RESET = BINDABLE.length + 1;
const ROW_BACK = BINDABLE.length + 2;
const GAME_OPTIONS = ['sound', 'penalties', 'speedBar', 'collisions'] as const;
type GameOption = (typeof GAME_OPTIONS)[number];

export class SettingsState implements State {
  private tab: SettingsTab = 'keys';
  private row = 0;
  private col = 0;
  private listening = false;
  private message: string | null = null;
  private bindings: Bindings;

  constructor(
    private readonly game: Game,
    private readonly back: State,
  ) {
    this.bindings = game.input.getBindings();
  }

  private rows(): number {
    return this.tab === 'keys' ? KEYS_ROWS : GAME_OPTIONS.length + 2;
  }

  private apply(): void {
    this.game.input.setBindings(this.bindings);
    saveBindings(this.bindings);
  }

  private labelOf(action: BindableAction): string {
    return BINDABLE.find((b) => b.action === action)!.label;
  }

  private assign(code: string): void {
    const action = BINDABLE[this.row - 1].action;
    if (RESERVED_CODES.has(code)) {
      this.message = `${keyLabel(code)} IS RESERVED – PICK ANOTHER KEY`;
      this.game.audio.ui('error');
      return;
    }
    let takenFrom: BindableAction | null = null;
    for (const { action: other } of BINDABLE) {
      const keys = this.bindings[other];
      for (let c = 0; c < 2; c++) {
        if (keys[c] === code && !(other === action && c === this.col)) {
          keys[c] = null;
          if (other !== action) takenFrom = other;
        }
      }
    }
    this.bindings[action][this.col] = code;
    this.listening = false;
    this.game.input.capture = false;
    this.message = takenFrom ? `${keyLabel(code)} MOVED FROM ${this.labelOf(takenFrom)}` : null;
    this.game.audio.ui('ok');
    this.apply();
  }

  private changeOption(opt: GameOption, step: number): void {
    const audio = this.game.audio;
    const prefs = this.game.prefs;
    switch (opt) {
      case 'sound': {
        const i = ENGINE_STYLES.findIndex((e) => e.id === audio.engineStyle);
        audio.setEngineStyle(ENGINE_STYLES[(i + step + ENGINE_STYLES.length) % ENGINE_STYLES.length].id);
        return;
      }
      case 'penalties':
        prefs.penalties = !prefs.penalties;
        break;
      case 'speedBar':
        prefs.speedBar = !prefs.speedBar;
        break;
      case 'collisions':
        prefs.collisions = prefs.collisions === 'realistic' ? 'classic' : 'realistic';
        break;
    }
    audio.ui('move');
    savePrefs(prefs);
  }

  private gameRows(): GameOptionRow[] {
    const prefs = this.game.prefs;
    const on = (b: boolean) => (b ? 'ON' : 'OFF');
    return GAME_OPTIONS.map((opt) => {
      switch (opt) {
        case 'sound':
          return {
            label: 'ENGINE SOUND',
            value: ENGINE_STYLES.find((e) => e.id === this.game.audio.engineStyle)?.label ?? '',
            desc: 'Engine sound of your car and your rivals. ENTER plays a sample.',
          };
        case 'penalties':
          return {
            label: 'CRASH PENALTIES',
            value: on(prefs.penalties),
            desc: `+${CONFIG.PENALTY_S} s for causing a crash. The car ahead has right of way – the car behind is at fault.`,
          };
        case 'speedBar':
          return {
            label: 'SPEED WARNING',
            value: on(prefs.speedBar),
            desc: `Bar under your car's arrow above ${CONFIG.SPIN_MPH} MPH: orange – slide, red – spin in a corner.`,
          };
        case 'collisions':
          return {
            label: 'COLLISIONS',
            value: prefs.collisions === 'realistic' ? 'REALISTIC' : 'CLASSIC',
            desc:
              prefs.collisions === 'realistic'
                ? 'The car hit in the rear or rear side spins – the hitter does not.'
                : 'Old model: in a hard crash both cars spin.',
          };
      }
    });
  }

  update(): void {
    const input = this.game.input;
    if (this.listening) {
      const code = input.firstPressedCode();
      if (!code) return;
      if (code === 'Escape') {
        this.listening = false;
        input.capture = false;
        this.message = null;
        this.game.audio.ui('back');
        return;
      }
      this.assign(code);
      return;
    }
    const audio = this.game.audio;
    if (input.pressed('back')) {
      audio.ui('back');
      this.game.set(this.back);
      return;
    }
    const n = this.rows();
    if (input.pressed('up') || input.pressed('down')) audio.ui('move');
    if (input.pressed('up')) this.row = (this.row + n - 1) % n;
    if (input.pressed('down')) this.row = (this.row + 1) % n;
    const step = (input.pressed('navRight') ? 1 : 0) - (input.pressed('navLeft') ? 1 : 0);

    if (this.row === 0) {
      if (step !== 0) {
        this.tab = this.tab === 'keys' ? 'game' : 'keys';
        this.message = null;
        audio.ui('move');
      }
      if (input.pressed('enter')) this.row = 1;
      return;
    }

    if (this.tab === 'game') {
      const opt = GAME_OPTIONS[this.row - 1];
      if (opt) {
        if (step !== 0) this.changeOption(opt, step);
        if (input.pressed('enter')) {
          if (opt === 'sound') audio.playPreview();
          else this.changeOption(opt, 1);
        }
      } else if (input.pressed('enter')) {
        audio.ui('back');
        this.game.set(this.back);
      }
      return;
    }

    if (step !== 0) audio.ui('move');
    if (input.pressed('navLeft')) this.col = 0;
    if (input.pressed('navRight')) this.col = 1;
    const onAction = this.row >= 1 && this.row <= BINDABLE.length;
    if (onAction && input.pressed('clear')) {
      const keys = this.bindings[BINDABLE[this.row - 1].action];
      if (!keys[1 - this.col]) {
        this.message = 'EVERY ACTION NEEDS AT LEAST ONE KEY';
        audio.ui('error');
      } else {
        keys[this.col] = null;
        this.message = null;
        this.apply();
      }
    }
    if (!input.pressed('enter')) return;
    audio.ui(this.row === ROW_BACK ? 'back' : 'ok');
    if (this.row === ROW_RESET) {
      this.bindings = structuredClone(DEFAULT_BINDINGS);
      this.message = 'DEFAULT KEYS RESTORED';
      this.apply();
    } else if (this.row === ROW_BACK) {
      this.game.set(this.back);
    } else {
      this.listening = true;
      input.capture = true;
      this.message = null;
    }
  }

  onBlur(): void {
    this.listening = false;
    this.game.input.capture = false;
  }

  render(g: CanvasRenderingContext2D): void {
    drawSettings(g, {
      tab: this.tab,
      row: this.row,
      col: this.col,
      listening: this.listening,
      message: this.message,
      bindings: this.bindings,
      game: this.gameRows(),
    });
  }
}
