import type { Action, Input } from './input';

export type TouchLayout = 'race' | 'menu';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ButtonAction = Action | 'fullscreen';
type Kind = 'hold' | 'tap' | 'repeat';

interface ButtonSpec {
  action: ButtonAction;
  kind: Kind;
  html: string;
  cls: string;
  group?: string;
}

const SIDE_MIN = 150;
const BOTTOM_MIN = 240;
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 110;
const FLASH_MS = 120;

const svg = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const ICON = {
  left: svg('<path d="M16 4 6 12l10 8z"/>'),
  right: svg('<path d="m8 4 10 8-10 8z"/>'),
  up: svg('<path d="m4 16 8-10 8 10z"/>'),
  down: svg('<path d="m4 8 8 10 8-10z"/>'),
  pause: svg('<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'),
  menu: svg('<path d="M4 5h16v3H4zM4 10.5h16v3H4zM4 16h16v3H4z"/>'),
  sound: svg(
    '<path d="M3 9h4l5-4v14l-5-4H3z"/><path class="tc-wave" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/><path class="tc-x" d="m15 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  ),
  fullscreen: svg('<path d="M4 4h6v2.5H6.5V10H4zM14 4h6v6h-2.5V6.5H14zM4 14h2.5v3.5H10V20H4zM17.5 14H20v6h-6v-2.5h3.5z"/>'),
};

const LAYOUTS: Record<TouchLayout, { left: ButtonSpec[][]; right: ButtonSpec[][] }> = {
  race: {
    left: [
      [
        { action: 'mute', kind: 'tap', html: ICON.sound, cls: 'tc-small tc-sound' },
        { action: 'fullscreen', kind: 'tap', html: ICON.fullscreen, cls: 'tc-small tc-fs' },
        { action: 'camera', kind: 'tap', html: 'CAM', cls: 'tc-small tc-text' },
      ],
      [
        { action: 'left', kind: 'hold', html: ICON.left, cls: 'tc-big', group: 'steer' },
        { action: 'right', kind: 'hold', html: ICON.right, cls: 'tc-big', group: 'steer' },
      ],
    ],
    right: [
      [
        { action: 'reverse', kind: 'tap', html: 'REV', cls: 'tc-small tc-text' },
        { action: 'pause', kind: 'tap', html: ICON.pause, cls: 'tc-small' },
        { action: 'menu', kind: 'tap', html: ICON.menu, cls: 'tc-small' },
      ],
      [
        { action: 'brake', kind: 'hold', html: 'BRAKE', cls: 'tc-big tc-text tc-brake', group: 'pedals' },
        { action: 'gas', kind: 'hold', html: 'GAS', cls: 'tc-big tc-text tc-gas', group: 'pedals' },
      ],
    ],
  },
  menu: {
    left: [
      [
        { action: 'mute', kind: 'tap', html: ICON.sound, cls: 'tc-small tc-sound' },
        { action: 'fullscreen', kind: 'tap', html: ICON.fullscreen, cls: 'tc-small tc-fs' },
      ],
      [
        { action: 'up', kind: 'repeat', html: ICON.up, cls: 'tc-pad tc-up' },
        { action: 'navLeft', kind: 'repeat', html: ICON.left, cls: 'tc-pad tc-l' },
        { action: 'navRight', kind: 'repeat', html: ICON.right, cls: 'tc-pad tc-r' },
        { action: 'down', kind: 'repeat', html: ICON.down, cls: 'tc-pad tc-down' },
      ],
    ],
    right: [
      [],
      [
        { action: 'back', kind: 'tap', html: 'BACK', cls: 'tc-big tc-text tc-back' },
        { action: 'enter', kind: 'tap', html: 'OK', cls: 'tc-big tc-text tc-ok' },
      ],
    ],
  },
};

export function prefersTouch(override: boolean | null): boolean {
  if (override !== null) return override;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
  return /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
}

function fullscreenSupported(): boolean {
  const d = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function toggleFullscreen(): void {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    if (d.exitFullscreen) void d.exitFullscreen().catch(() => {});
    else d.webkitExitFullscreen?.();
    return;
  }
  const lock = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  };
  if (el.requestFullscreen) el.requestFullscreen().then(lock, () => {});
  else el.webkitRequestFullscreen?.();
}

function readSafeArea(): { t: number; r: number; b: number; l: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  const res = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
  probe.remove();
  return res;
}

interface Tracked {
  btn: HTMLElement;
  timers: number[];
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly zones: Record<TouchLayout, { left: HTMLElement; right: HTMLElement }>;
  private layout: TouchLayout | null = null;
  private readonly pointers = new Map<number, Tracked>();
  private readonly holdActions = new Set<Action>();
  portrait = false;

  constructor(
    private readonly input: Input,
    private readonly isMuted: () => boolean,
  ) {
    document.documentElement.classList.add('touch-mode');
    this.root = document.createElement('div');
    this.root.className = 'tc-root';
    this.hint = document.createElement('div');
    this.hint.className = 'tc-hint';
    this.hint.textContent = 'ROTATE YOUR PHONE FOR A BIGGER VIEW';
    this.root.appendChild(this.hint);
    const build = (name: TouchLayout) => {
      const spec = LAYOUTS[name];
      return { left: this.buildZone(spec.left, 'tc-left'), right: this.buildZone(spec.right, 'tc-right') };
    };
    this.zones = { race: build('race'), menu: build('menu') };
    document.body.appendChild(this.root);
    if (!fullscreenSupported()) this.root.classList.add('tc-no-fs');

    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onUp(e));
    this.root.addEventListener('lostpointercapture', (e) => this.onUp(e));
    const block = (e: Event) => e.preventDefault();
    for (const type of ['contextmenu', 'selectstart', 'gesturestart', 'dblclick']) document.addEventListener(type, block);
    document.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  private buildZone(rows: ButtonSpec[][], cls: string): HTMLElement {
    const zone = document.createElement('div');
    zone.className = `tc-zone ${cls}`;
    zone.hidden = true;
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = i === 0 ? 'tc-row tc-top' : row.some((b) => b.cls.includes('tc-pad')) ? 'tc-dpad' : 'tc-row tc-main';
      for (const spec of row) el.appendChild(this.buildButton(spec));
      zone.appendChild(el);
    });
    this.root.appendChild(zone);
    return zone;
  }

  private buildButton(spec: ButtonSpec): HTMLElement {
    const btn = document.createElement('div');
    btn.className = `tc-btn ${spec.cls}`;
    btn.innerHTML = spec.html;
    btn.dataset.action = spec.action;
    btn.dataset.kind = spec.kind;
    if (spec.group) btn.dataset.group = spec.group;
    if (spec.kind === 'hold' && spec.action !== 'fullscreen') this.holdActions.add(spec.action);
    btn.addEventListener('pointerdown', (e) => this.onDown(e, btn));
    return btn;
  }

  private onDown(e: PointerEvent, btn: HTMLElement): void {
    e.preventDefault();
    const action = btn.dataset.action as ButtonAction;
    navigator.vibrate?.(8);
    switch (btn.dataset.kind as Kind) {
      case 'tap':
        if (action === 'fullscreen') toggleFullscreen();
        else this.input.tapVirtual(action);
        btn.classList.add('tc-active');
        window.setTimeout(() => btn.classList.remove('tc-active'), FLASH_MS);
        return;
      case 'repeat': {
        this.input.tapVirtual(action as Action);
        const t: Tracked = { btn, timers: [] };
        t.timers.push(
          window.setTimeout(() => {
            t.timers.push(window.setInterval(() => this.input.tapVirtual(action as Action), REPEAT_EVERY_MS));
          }, REPEAT_DELAY_MS),
        );
        this.track(e, t);
        return;
      }
      case 'hold':
        this.track(e, { btn, timers: [] });
        return;
    }
  }

  private track(e: PointerEvent, t: Tracked): void {
    this.drop(e.pointerId);
    this.pointers.set(e.pointerId, t);
    try {
      t.btn.setPointerCapture(e.pointerId);
    } catch {}
    this.sync();
  }

  private onMove(e: PointerEvent): void {
    const t = this.pointers.get(e.pointerId);
    if (!t?.btn.dataset.group) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.tc-btn');
    if (!hit || hit === t.btn || hit.dataset.group !== t.btn.dataset.group) return;
    t.btn = hit;
    navigator.vibrate?.(8);
    this.sync();
  }

  private onUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.drop(e.pointerId);
    this.sync();
  }

  private drop(id: number): void {
    const t = this.pointers.get(id);
    if (!t) return;
    for (const timer of t.timers) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    this.pointers.delete(id);
  }

  private releaseAll(): void {
    for (const id of [...this.pointers.keys()]) this.drop(id);
    this.sync();
  }

  private sync(): void {
    const held = new Set<HTMLElement>();
    for (const t of this.pointers.values()) held.add(t.btn);
    for (const btn of this.root.querySelectorAll<HTMLElement>('.tc-btn')) {
      if (btn.dataset.kind !== 'tap') btn.classList.toggle('tc-active', held.has(btn));
    }
    const actions = new Set<string>();
    for (const t of this.pointers.values()) if (t.btn.dataset.kind === 'hold') actions.add(t.btn.dataset.action!);
    for (const a of this.holdActions) this.input.setVirtual(a, actions.has(a));
  }

  update(layout: TouchLayout, camera = true): void {
    this.root.classList.toggle('tc-muted', this.isMuted());
    this.root.classList.toggle('tc-nocam', !camera);
    if (layout === this.layout) return;
    this.releaseAll();
    this.layout = layout;
    for (const [name, z] of Object.entries(this.zones)) {
      z.left.hidden = name !== layout;
      z.right.hidden = name !== layout;
    }
  }

  gameBox(vw: number, vh: number): Rect {
    const sa = readSafeArea();
    this.portrait = vh > vw;
    if (this.portrait) return { x: sa.l, y: sa.t, w: vw - sa.l - sa.r, h: vh - sa.t - Math.max(BOTTOM_MIN, sa.b + BOTTOM_MIN) };
    const side = Math.max(SIDE_MIN + sa.l, SIDE_MIN + sa.r);
    return { x: side, y: sa.t, w: vw - 2 * side, h: vh - sa.t - sa.b };
  }

  arrange(game: Rect, vw: number, vh: number): void {
    const sa = readSafeArea();
    this.root.classList.toggle('tc-portrait', this.portrait);
    let left: Rect;
    let right: Rect;
    if (this.portrait) {
      const top = game.y + game.h;
      const h = vh - sa.b - top;
      const half = (vw - sa.l - sa.r) / 2;
      left = { x: sa.l, y: top, w: half, h };
      right = { x: sa.l + half, y: top, w: half, h };
      Object.assign(this.hint.style, { left: `${sa.l}px`, width: `${vw - sa.l - sa.r}px`, top: `${top}px` });
    } else {
      const h = vh - sa.t - sa.b;
      left = { x: sa.l, y: sa.t, w: game.x - sa.l, h };
      right = { x: game.x + game.w, y: sa.t, w: vw - sa.r - game.x - game.w, h };
    }
    const bigH = Math.round(Math.max(72, Math.min(180, (this.portrait ? left.h - 70 : left.h) * 0.5)));
    const pad = Math.round(Math.max(120, Math.min(200, left.w - 20, left.h - 70)));
    this.root.style.setProperty('--tc-big-h', `${bigH}px`);
    this.root.style.setProperty('--tc-pad', `${pad}px`);
    for (const z of Object.values(this.zones)) {
      for (const [el, r] of [
        [z.left, left],
        [z.right, right],
      ] as const) {
        Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      }
    }
  }
}
