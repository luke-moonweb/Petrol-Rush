import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '../src/input';
import { hintList, setTouchHints } from '../src/ui/hints';
import { addHit, clearHits, hitAt } from '../src/ui/hit';

function makeInput(): Input {
  (globalThis as { document?: unknown }).document ??= { addEventListener: () => {}, hidden: false };
  return new Input(new EventTarget() as unknown as Window);
}

describe('virtual (touch) input', () => {
  it('holds an action until released and reports the press once', () => {
    const input = makeInput();
    input.setVirtual('gas', true);
    expect(input.isDown('gas')).toBe(true);
    expect(input.pressed('gas')).toBe(true);
    input.endStep();
    input.setVirtual('gas', true);
    expect(input.pressed('gas')).toBe(false);
    expect(input.isDown('gas')).toBe(true);
    input.setVirtual('gas', false);
    expect(input.isDown('gas')).toBe(false);
  });

  it('keeps a tap until the next simulation step', () => {
    const input = makeInput();
    input.tapVirtual('enter');
    expect(input.pressed('enter')).toBe(true);
    expect(input.isDown('enter')).toBe(false);
    input.endStep();
    expect(input.pressed('enter')).toBe(false);
  });
});

describe('menu hit areas', () => {
  it('returns the topmost area under the point', () => {
    const g = { getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }) } as unknown as CanvasRenderingContext2D;
    clearHits();
    addHit(g, 0, 0, 0, 100, 100);
    addHit(g, 1, 50, 50, 20, 20);
    expect(hitAt(60, 60)?.id).toBe(1);
    expect(hitAt(10, 10)?.id).toBe(0);
    expect(hitAt(200, 10)).toBeNull();
    clearHits();
    expect(hitAt(10, 10)).toBeNull();
  });
});

describe('touch hints', () => {
  afterEach(() => setTouchHints(false));

  it('renames keys to on-screen buttons and drops keyboard-only hints', () => {
    const list: [string, string][] = [
      ['↑ ↓', 'SELECT'],
      ['← →', 'CHANGE'],
      ['ENTER', 'CONFIRM'],
      ['ESC', 'BACK'],
      ['M', 'SOUND'],
    ];
    expect(hintList(list)).toEqual(list);
    setTouchHints(true);
    expect(hintList(list)).toEqual([
      ['▲ ▼', 'SELECT'],
      ['◀ ▶', 'CHANGE'],
      ['OK', 'CONFIRM'],
    ]);
  });
});
