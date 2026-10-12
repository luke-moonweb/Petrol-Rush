import { describe, expect, it } from 'vitest';
import { Camera, clipProject, NEAR, outX, outY } from '../src/gfx/fpv/engine';
import { buildScene } from '../src/gfx/fpv/scene';

function camera(): Camera {
  const c = new Camera();
  c.set(0, 0, 10, 0);
  c.focal = 100;
  c.ox = 200;
  c.oy = 150;
  return c;
}

describe('first-person renderer', () => {
  it('projects a point ahead of the camera with perspective', () => {
    const c = camera();
    const m = clipProject(c, [100, 100, 100], [0, 50, 0], [10, 10, 20], 3);
    expect(m).toBe(3);
    expect(outX[0]).toBeCloseTo(200);
    expect(outX[1]).toBeCloseTo(250);
    expect(outY[2]).toBeCloseTo(140);
  });

  it('drops polygons behind the camera and clips ones crossing the near plane', () => {
    const c = camera();
    expect(clipProject(c, [-50, -40, -60], [0, 10, 10], [0, 0, 0], 3)).toBe(0);
    const m = clipProject(c, [-20, 40, 40, -20], [-5, -5, 5, 5], [0, 0, 0, 0], 4);
    expect(m).toBe(4);
    for (let i = 0; i < m; i++) expect(Number.isFinite(outX[i]!)).toBe(true);
    expect(NEAR).toBeGreaterThan(0);
  });

  it('builds the static night track scene', () => {
    const s = buildScene();
    expect(s.ground.length).toBeGreaterThan(0);
    expect(s.solids.length).toBeGreaterThan(200);
    expect(s.glows.length).toBeGreaterThan(5);
  });
});
