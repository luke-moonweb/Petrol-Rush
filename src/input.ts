export type BindableAction = 'left' | 'right' | 'gas' | 'brake' | 'reverse' | 'pause' | 'menu' | 'help' | 'mute';

export type Action = BindableAction | 'up' | 'down' | 'navLeft' | 'navRight' | 'enter' | 'back' | 'clear' | 'fit' | 'debugSpeed';

export type Bindings = Record<BindableAction, [string | null, string | null]>;

export const BINDABLE: { action: BindableAction; label: string }[] = [
  { action: 'left', label: 'STEER LEFT' },
  { action: 'right', label: 'STEER RIGHT' },
  { action: 'gas', label: 'ACCELERATE' },
  { action: 'brake', label: 'BRAKE' },
  { action: 'reverse', label: 'REVERSE GEAR' },
  { action: 'pause', label: 'PAUSE' },
  { action: 'menu', label: 'RACE MENU' },
  { action: 'help', label: 'CONTROLS (HELP)' },
  { action: 'mute', label: 'SOUND ON / OFF' },
];

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', null],
  right: ['ArrowRight', null],
  gas: ['ArrowUp', 'KeyW'],
  brake: ['Space', 'ArrowDown'],
  reverse: ['ShiftLeft', null],
  pause: ['KeyP', null],
  menu: ['Tab', null],
  help: ['F1', 'KeyH'],
  mute: ['KeyM', null],
};

const FIXED: Record<string, Action[]> = {
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  ArrowLeft: ['navLeft'],
  ArrowRight: ['navRight'],
  Enter: ['enter'],
  NumpadEnter: ['enter'],
  Escape: ['back'],
  Backspace: ['clear'],
  Delete: ['clear'],
  KeyF: ['fit'],
  BracketRight: ['debugSpeed'],
};

export const RESERVED_CODES = new Set(['Escape', 'KeyF', 'BracketRight']);

function norm(code: string): string {
  if (/^(Shift|Control|Alt|Meta)Right$/.test(code)) return code.replace('Right', 'Left');
  return code;
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ShiftLeft: 'SHIFT',
  ControlLeft: 'CTRL',
  AltLeft: 'ALT',
  MetaLeft: 'CMD',
  Space: 'SPACE',
  Escape: 'ESC',
  Tab: 'TAB',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  Backspace: 'BKSP',
  Delete: 'DEL',
  CapsLock: 'CAPS',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function keyLabel(code: string | null): string {
  if (!code) return '—';
  const c = norm(code);
  if (KEY_NAMES[c]) return KEY_NAMES[c];
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return `NUM ${c.slice(6)}`;
  if (/^F\d+$/.test(c)) return c;
  return c.toUpperCase().slice(0, 6);
}

const STORAGE_KEY = 'petrolrush.keys.v2';

export function loadBindings(): Bindings {
  const b: Bindings = structuredClone(DEFAULT_BINDINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return b;
    const o = JSON.parse(raw) as Partial<Record<BindableAction, unknown>>;
    for (const { action } of BINDABLE) {
      const v = o[action];
      if (!Array.isArray(v) || v.length !== 2) continue;
      const ok = (k: unknown): k is string | null => k === null || (typeof k === 'string' && !RESERVED_CODES.has(k));
      if (ok(v[0]) && ok(v[1])) b[action] = [v[0], v[1]];
    }
  } catch {}
  return b;
}

export function saveBindings(b: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {}
}

export class Input {
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private keymap = new Map<string, Action[]>();
  private bindings: Bindings;
  capture = false;
  onFirstInteraction: (() => void) | null = null;
  onBlur: (() => void) | null = null;

  constructor(target: Window, bindings: Bindings = DEFAULT_BINDINGS) {
    this.bindings = structuredClone(bindings);
    this.rebuild();
    target.addEventListener('keydown', (e) => {
      const code = norm(e.code);
      if (this.keymap.has(code) || (this.capture && !e.metaKey)) e.preventDefault();
      this.onFirstInteraction?.();
      if (!e.repeat) this.pressedCodes.add(code);
      this.down.add(code);
    });
    target.addEventListener('keyup', (e) => {
      const code = norm(e.code);
      if (this.keymap.has(code)) e.preventDefault();
      this.down.delete(code);
    });
    target.addEventListener('pointerdown', () => this.onFirstInteraction?.());
    target.addEventListener('blur', () => this.lostFocus());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lostFocus();
    });
  }

  getBindings(): Bindings {
    return structuredClone(this.bindings);
  }

  setBindings(b: Bindings): void {
    this.bindings = structuredClone(b);
    this.rebuild();
  }

  private rebuild(): void {
    this.keymap.clear();
    for (const [code, actions] of Object.entries(FIXED)) this.keymap.set(code, [...actions]);
    for (const { action } of BINDABLE) {
      for (const code of this.bindings[action]) {
        if (!code) continue;
        const list = this.keymap.get(code) ?? [];
        if (!list.includes(action)) list.push(action);
        this.keymap.set(code, list);
      }
    }
  }

  private lostFocus(): void {
    this.down.clear();
    this.pressedCodes.clear();
    this.onBlur?.();
  }

  isDown(action: Action): boolean {
    for (const code of this.down) if (this.keymap.get(code)?.includes(action)) return true;
    return false;
  }

  pressed(action: Action): boolean {
    for (const code of this.pressedCodes) if (this.keymap.get(code)?.includes(action)) return true;
    return false;
  }

  firstPressedCode(): string | null {
    for (const code of this.pressedCodes) return code;
    return null;
  }

  endStep(): void {
    this.pressedCodes.clear();
  }
}
