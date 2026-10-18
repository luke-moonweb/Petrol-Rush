// A stand-in browser for headless screen tests. Import it FIRST in a test file: it installs a seeded
// Math.random, the fdlibm trig (so fingerprints match on every platform), an in-memory localStorage
// and a document whose canvases record every 2D call into one FNV fingerprint (`drawing`).
import { useFdlibm } from './fdlibm';

let seed = 0x2f6b9a1d;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
useFdlibm();

/** Fingerprint of every canvas call since the last reset (numbers rounded to 0.01). */
export const drawing = { hash: 0x811c9dc5, calls: 0 };

export function resetDrawing(): void {
  drawing.hash = 0x811c9dc5;
  drawing.calls = 0;
}

function feed(s: string): void {
  let h = drawing.hash;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  drawing.hash = Math.imul(h ^ 0x3b, 0x01000193) >>> 0;
}

function val(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : String(v);
  if (typeof v === 'string' || typeof v === 'boolean' || v == null) return String(v);
  if (Array.isArray(v)) return `[${v.map(val).join(',')}]`;
  const tag = (v as { tag?: string }).tag;
  return tag ?? 'object';
}

const DEFAULTS: Record<string, unknown> = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  globalAlpha: 1,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  direction: 'ltr',
  letterSpacing: '0px',
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  filter: 'none',
};

function special(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'measureText':
      return { width: String(args[0]).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 };
    case 'createLinearGradient':
    case 'createRadialGradient':
    case 'createConicGradient':
      return { tag: 'gradient', addColorStop: (o: number, c: string) => feed(`stop ${val(o)} ${c}`) };
    case 'createPattern':
      return { tag: 'pattern', setTransform: () => {} };
    case 'getImageData':
    case 'createImageData': {
      const w = Number(args[args.length === 4 ? 2 : 0]);
      const h = Number(args[args.length === 4 ? 3 : 1]);
      return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
    }
    case 'isPointInPath':
    case 'isPointInStroke':
      return false;
    case 'getLineDash':
      return [];
    case 'getTransform':
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    default:
      return undefined;
  }
}

export class StubCanvas {
  width = 300;
  height = 150;
  readonly style: Record<string, string> = {};
  private ctx: CanvasRenderingContext2D | null = null;

  get tag(): string {
    return `canvas ${this.width}x${this.height}`;
  }

  getContext(): CanvasRenderingContext2D {
    this.ctx ??= stubContext(this);
    return this.ctx;
  }

  toDataURL(): string {
    return '';
  }
}

function stubContext(canvas: StubCanvas): CanvasRenderingContext2D {
  let props: Record<string, unknown> = { ...DEFAULTS };
  const saved: Record<string, unknown>[] = [];
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_, prop) {
      if (prop === 'canvas') return canvas;
      if (typeof prop !== 'string') return undefined;
      if (prop in props) return props[prop];
      let m = methods.get(prop);
      if (!m) {
        m = (...args: unknown[]) => {
          drawing.calls++;
          feed(`${prop}(${args.map(val).join(',')})`);
          if (prop === 'save') saved.push({ ...props });
          if (prop === 'restore') props = saved.pop() ?? props;
          return special(prop, args);
        };
        methods.set(prop, m);
      }
      return m;
    },
    set(_, prop, v) {
      if (typeof prop === 'string') {
        props[prop] = v;
        feed(`${prop}=${val(v)}`);
      }
      return true;
    },
  });
}

/** Path2D: its commands become part of the fingerprint of whatever fills, strokes or clips it. */
class StubPath2D {
  private ops = '';

  constructor(from?: StubPath2D) {
    if (from) this.ops = from.ops;
  }

  get tag(): string {
    return `path(${this.ops})`;
  }

  private op(name: string, args: unknown[]): void {
    this.ops += `${name}(${args.map(val).join(',')})`;
  }

  moveTo(...a: number[]): void {
    this.op('moveTo', a);
  }
  lineTo(...a: number[]): void {
    this.op('lineTo', a);
  }
  quadraticCurveTo(...a: number[]): void {
    this.op('quadraticCurveTo', a);
  }
  bezierCurveTo(...a: number[]): void {
    this.op('bezierCurveTo', a);
  }
  arc(...a: unknown[]): void {
    this.op('arc', a);
  }
  arcTo(...a: number[]): void {
    this.op('arcTo', a);
  }
  ellipse(...a: unknown[]): void {
    this.op('ellipse', a);
  }
  rect(...a: number[]): void {
    this.op('rect', a);
  }
  roundRect(...a: unknown[]): void {
    this.op('roundRect', a);
  }
  closePath(): void {
    this.op('closePath', []);
  }
  addPath(p: StubPath2D): void {
    this.ops += p.ops;
  }
}

const store = new Map<string, string>();
// (defineProperty: newer Node versions have their own localStorage accessor on globalThis)
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    hidden: false,
    createElement: (tag: string) => (tag === 'canvas' ? new StubCanvas() : { style: {} }),
    addEventListener: () => {},
  },
});
// (audio looks for window.speechSynthesis; nothing else of window is needed)
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: StubPath2D });
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});
