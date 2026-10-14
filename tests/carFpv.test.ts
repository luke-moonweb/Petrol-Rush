import { describe, expect, it } from 'vitest';
import { renderModel } from '../src/gfx/model3d';
import { CAR_ANCHOR_X, CAR_ANCHOR_Y, CAR_DIRECTIONS, CAR_SCHEMES, carFaces, MODEL_SCALE } from '../src/gfx/vehicles';

// Records every drawing call a sprite render makes, so the top-down output can be fingerprinted without a canvas.
function recorder(): { g: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const r = (n: number) => n.toFixed(4);
  const g = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    translate: (x: number, y: number) => log.push(`t${r(x)},${r(y)}`),
    beginPath: () => log.push('b'),
    moveTo: (x: number, y: number) => log.push(`m${r(x)},${r(y)}`),
    lineTo: (x: number, y: number) => log.push(`l${r(x)},${r(y)}`),
    closePath: () => log.push('z'),
    fill() {
      log.push(`f${this.fillStyle}`);
    },
    stroke() {
      log.push(`s${this.strokeStyle}/${this.lineWidth}`);
    },
  };
  return { g: g as unknown as CanvasRenderingContext2D, log };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

describe('top-down car sprites', () => {
  it('draw exactly as before the cockpit model was added (all 20 cars x 32 directions)', () => {
    const { g, log } = recorder();
    for (let c = 0; c < CAR_SCHEMES.length; c++) {
      for (let d = 0; d < CAR_DIRECTIONS; d++) {
        renderModel(g, carFaces(c), (d / CAR_DIRECTIONS) * Math.PI * 2, MODEL_SCALE, CAR_ANCHOR_X, CAR_ANCHOR_Y);
      }
    }
    expect(log.length).toBeGreaterThan(100_000);
    expect(fnv(log.join(';'))).toBe('add37640');
  });
});
