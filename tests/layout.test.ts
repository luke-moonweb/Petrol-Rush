import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/layout';

describe('responsive layout', () => {
  it('keeps the classic 640×480 frame for 4:3 windows', () => {
    const l = computeLayout(800, 600);
    expect(l).toMatchObject({ mode: 'wide', w: 640, h: 480 });
  });

  it('widens the track view for wide windows, up to 21:9', () => {
    const hd = computeLayout(1920, 1080);
    expect(hd.mode).toBe('wide');
    expect(hd.w).toBe(853);
    expect(hd.view.w).toBe(853 - 124);
    expect(computeLayout(5120, 1080).w).toBe(1120);
  });

  it('moves the HUD under the track in tall windows', () => {
    const l = computeLayout(500, 1000);
    expect(l.mode).toBe('stacked');
    expect(l.view).toMatchObject({ x: 0, w: l.w });
    expect(l.panel.y).toBe(480);
    expect(l.w).toBeGreaterThanOrEqual(400);
  });

  it('stays wide when stacking would not make the game noticeably bigger', () => {
    expect(computeLayout(640, 600).mode).toBe('wide');
  });
});
