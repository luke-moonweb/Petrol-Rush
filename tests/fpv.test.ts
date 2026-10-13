import { describe, expect, it, vi } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { type CabinInput, cabinFor, cabinReadout, joltOffset, LED_COUNT, RING_SEGS, ringColor, stepCabin } from '../src/gfx/fpv/cabin';
import { Camera, clipProject, outX, outY } from '../src/gfx/fpv/engine';
import { upright } from '../src/gfx/fpv/geom';
import { buildScene } from '../src/gfx/fpv/scene';
import { texFacing, texQuad } from '../src/gfx/fpv/texture';
import type { Car } from '../src/race/car';
import { Race } from '../src/race/race';
import { PR } from '../src/ui/theme';

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
    expect(maxStep).toBeLessThanOrEqual(2.5 * 0.016 + 1e-9);
  });

  it('catches up with the heading when a corner follows a spin', async () => {
    const { cameraYaw } = await import('../src/gfx/fpv/view');
    let now = 5000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const spin = { spinTime: 1, speed: 60, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 40; i++) {
      now += 16;
      cameraYaw(spin, i * 0.12);
    }
    const done = { spinTime: 0, speed: 60, moveAngle: 0 } as unknown as Car;
    let heading = 1;
    let yaw = 0;
    for (let i = 0; i < 180; i++) {
      now += 16;
      heading += 1.4 * 0.016;
      yaw = cameraYaw(done, heading);
    }
    clock.mockRestore();
    expect(yaw).toBe(heading);
  });
});

describe('cockpit readout', () => {
  const base: CabinInput = {
    time: 10,
    speed: 0,
    reverse: false,
    fuel: 1,
    lapsToGo: 5,
    started: true,
    finished: false,
    finishAge: 0,
    skid: 0,
    slideTime: 0,
    spinTime: 0,
    pitAuto: false,
    refueling: false,
    penalty: 0,
    penaltyAge: 99,
    position: 4,
    interval: 0.42,
  };
  const lit = (s: Partial<CabinInput>) => cabinReadout({ ...base, ...s }).leds.filter(Boolean).length;

  it('lights the LED strip from 114 mph to 146 mph', () => {
    expect(lit({ speed: 113 })).toBe(0);
    expect(lit({ speed: 130 })).toBe(5);
    expect(lit({ speed: 147 })).toBe(LED_COUNT);
    expect(cabinReadout({ ...base, speed: 147 }).leds.slice(0, 4)).toEqual([PR.teal, PR.teal, PR.teal, PR.teal]);
  });

  it('turns the strip red for a skid and blinks it in a turn in step with the SKID lamp', () => {
    expect(cabinReadout({ ...base, speed: 151, skid: 1 }).leds.every((c) => c === PR.red)).toBe(true);
    for (const time of [10, 10.1, 10.2, 10.3]) {
      const r = cabinReadout({ ...base, speed: 151, skid: 2, time });
      expect(lit({ speed: 151, skid: 2, time }) > 0).toBe(r.lamps.skid);
    }
  });

  it('mirrors the start lights and flashes green at lights out', () => {
    expect(cabinReadout({ ...base, started: false, lights: { lit: 3, out: false, since: -1 } }).leds).toEqual([
      null,
      null,
      PR.red,
      PR.red,
      PR.red,
      null,
      null,
      null,
      null,
    ]);
    expect(lit({ lights: { lit: 0, out: true, since: 0.2 } })).toBe(LED_COUNT);
    expect(lit({ lights: { lit: 0, out: true, since: 0.5 } })).toBe(0);
  });

  it('shows the speed on an 18 segment ring with reverse marked', () => {
    expect(cabinReadout({ ...base, speed: 95 }).ring).toBe(9);
    expect(cabinReadout({ ...base, speed: 180 }).ring).toBe(RING_SEGS);
    expect(cabinReadout({ ...base, speed: -12, reverse: true }).digits).toBe('R12');
    expect(ringColor(10)).toBe(PR.teal);
    expect(ringColor(14)).toBe(PR.amber);
    expect(ringColor(15)).toBe(PR.red);
  });

  it('counts fuel in laps and warns at the shared low fuel threshold', () => {
    const half = cabinReadout({ ...base, fuel: 0.5 });
    expect(half.fuelLaps).toBeCloseTo(6);
    expect(half.fuelColor).toBe(PR.teal);
    expect(cabinReadout({ ...base, fuel: 0.5, lapsToGo: 8 }).fuelColor).toBe(PR.amber);
    expect(cabinReadout({ ...base, fuel: 0.15 }).fuelColor).not.toBe(PR.red);
    const low = cabinReadout({ ...base, fuel: CONFIG.LOW_FUEL - 0.01, time: 0.1 });
    expect(low.fuelColor).toBe(PR.red);
    expect(low.lamps.fuel).toBe(true);
    expect(cabinReadout({ ...base, fuel: CONFIG.LOW_FUEL - 0.01, time: 0.4 }).lamps.fuel).toBe(false);
  });

  it('shows position with the interval to the car ahead', () => {
    expect(cabinReadout(base)).toMatchObject({ podTop: 'P4', podBottom: '+0.42', podColor: PR.amber });
    expect(cabinReadout({ ...base, interval: 1.5 }).podColor).toBe(PR.tealLight);
    expect(cabinReadout({ ...base, position: 1 }).podBottom).toBe('LEAD');
    expect(cabinReadout({ ...base, lapsToGo: 1 }).podBottom).toBe('FINAL');
    expect(cabinReadout({ ...base, started: false }).podBottom).toBe('— —');
  });

  it('lights the tell-tales for pit, penalty and reverse and darkens them at the finish', () => {
    const r = cabinReadout({ ...base, pitAuto: true, penalty: 2, penaltyAge: 5, reverse: true });
    expect(r.lamps).toMatchObject({ pit: true, pen: true, rev: true });
    expect(Object.values(cabinReadout({ ...base, finished: true, pitAuto: true, reverse: true }).lamps).some(Boolean)).toBe(false);
  });
});

describe('cockpit glass and jolt', () => {
  it('soils the glass in oil and on impacts, clears it over time, and keeps it per race', () => {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 1);
    const p = race.player;
    p.speed = 120;
    race.oil.push({ x: p.x, y: p.y, s: 0, d: 0, age: 5 });
    for (let i = 0; i < 30; i++) stepCabin(race, 1 / 60);
    expect(cabinFor(race).oil).toBeGreaterThan(0.5);
    race.oil.length = 0;
    p.wallImpact = 30;
    stepCabin(race, 1 / 60);
    expect(cabinFor(race).grit).toBeGreaterThan(0.3);
    expect(joltOffset(cabinFor(race), race.time).y).toBeGreaterThan(0);
    expect(Math.hypot(joltOffset(cabinFor(race), race.time).x, joltOffset(cabinFor(race), race.time).y)).toBeLessThanOrEqual(3);
    expect(joltOffset(cabinFor(race), race.time + 0.4)).toEqual({ x: 0, y: 0, kick: 0 });
    p.wallImpact = 0;
    const before = cabinFor(race).oil;
    for (let i = 0; i < 600; i++) stepCabin(race, 1 / 60);
    expect(cabinFor(race).oil).toBeLessThan(before * 0.5);
    expect(cabinFor(new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 2)).oil).toBe(0);
  });
});
