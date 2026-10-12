import { describe, expect, it, vi } from 'vitest';
import { Camera, clipProject, outX, outY } from '../src/gfx/fpv/engine';
import { upright } from '../src/gfx/fpv/geom';
import { buildScene } from '../src/gfx/fpv/scene';
import { texFacing, texQuad } from '../src/gfx/fpv/texture';
import type { Car } from '../src/race/car';

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
  });

  it('builds the static night track scene', () => {
    const s = buildScene();
    expect(s.ground.length).toBeGreaterThan(0);
    expect(s.solids.length).toBeGreaterThan(200);
    expect(s.glows.length).toBeGreaterThan(5);
  });

  it('hangs wall signs on the wall pieces behind them, piece by piece', () => {
    const s = buildScene();
    const hung = s.solids.flatMap((p) => p.decals ?? []);
    expect(hung.length).toBeGreaterThan(40);
    for (const p of s.solids) {
      for (const q of p.decals ?? []) {
        expect(Math.abs(p.plane![0] * q.normal[0] + p.plane![1] * q.normal[1])).toBeGreaterThan(0.99);
        expect(q.radius).toBeLessThanOrEqual(p.radius + 0.5);
      }
    }
  });

  it('shows signs only from the front', () => {
    const q = texQuad(upright(0, 10, 20, 10, 0, 5), () => ({}) as HTMLCanvasElement);
    const c = camera();
    c.set(10, 50, 3, -Math.PI / 2);
    expect(texFacing(q, c)).toBe(true);
    c.set(10, -30, 3, Math.PI / 2);
    expect(texFacing(q, c)).toBe(false);
  });
});

describe('cockpit camera', () => {
  it('stays locked to the heading while driving and limits the turn during a spin', async () => {
    const { cameraYaw } = await import('../src/gfx/fpv/view');
    const car = { spinTime: 0, speed: 120, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 30; i++) expect(cameraYaw(car, i * 0.05)).toBe(i * 0.05);
    const spin = { spinTime: 1, speed: 120, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 30; i++) {
      const yaw = cameraYaw(spin, i * 0.4);
      expect(Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)))).toBeLessThanOrEqual(1.6);
    }
  });

  it('eases back to the heading after a spin without a final jump', async () => {
    const { cameraYaw } = await import('../src/gfx/fpv/view');
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const spin = { spinTime: 1, speed: 60, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 40; i++) {
      now += 16;
      cameraYaw(spin, i * 0.12);
    }
    const done = { spinTime: 0, speed: 20, moveAngle: 0 } as unknown as Car;
    let prev = cameraYaw(done, 2.98);
    let maxStep = 0;
    for (let i = 0; i < 200; i++) {
      now += 16;
      const yaw = cameraYaw(done, 2.98);
      maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev))));
      prev = yaw;
    }
    clock.mockRestore();
    expect(prev).toBe(2.98);
    expect(maxStep).toBeLessThan(0.2);
  });
});
