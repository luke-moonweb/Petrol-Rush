import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import {
  type CabinInput,
  cabinFor,
  cabinReadout,
  JOLT_GAP_S,
  joltOffset,
  LED_COUNT,
  RING_SEGS,
  ringColor,
  stepCabin,
} from '../src/gfx/fpv/cabin';
import { Camera, clipProject, outX, outY } from '../src/gfx/fpv/engine';
import { upright } from '../src/gfx/fpv/geom';
import { buildScene } from '../src/gfx/fpv/scene';
import { drawTexQuad, texFacing, texQuad } from '../src/gfx/fpv/texture';
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

  it('clips a sign that reaches behind the camera instead of dropping it', () => {
    const img = { width: 64, height: 32 } as HTMLCanvasElement;
    const q = texQuad(upright(0, 10, 20, 10, 0, 5), () => img);
    let drawn = 0;
    const noop = () => {};
    const g = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      save: noop,
      restore: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      closePath: noop,
      clip: noop,
      transform: noop,
      drawImage: () => drawn++,
    } as unknown as CanvasRenderingContext2D;
    const c = camera();
    // Looking along the sign from 1 unit off its near end: that end is closer than the near plane.
    c.set(21, 12, 3, Math.PI);
    expect(texFacing(q, c)).toBe(true);
    drawTexQuad(g, c, q, 10);
    expect(drawn).toBeGreaterThan(0);
    // Wholly in front, a cell is still drawn as two triangles.
    drawn = 0;
    c.set(10, 60, 3, -Math.PI / 2);
    drawTexQuad(g, c, q, 50);
    expect(drawn).toBe(2);
  });
});

describe('cockpit camera', () => {
  const race = {} as Race;
  it('stays locked to the heading while driving and limits the turn during a spin', async () => {
    const { cameraYaw, syncCameraYaw } = await import('../src/gfx/fpv/view');
    syncCameraYaw({} as Race, 0);
    const car = { spinTime: 0, speed: 120, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 30; i++) expect(cameraYaw(car, i * 0.05, i * 0.016)).toBe(i * 0.05);
    const spin = { spinTime: 1, speed: 120, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 30; i++) {
      const yaw = cameraYaw(spin, i * 0.4, 1 + i * 0.016);
      expect(Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)))).toBeLessThanOrEqual(1.6);
    }
  });

  it('eases back to the heading after a spin without a final jump, on race time', async () => {
    const { cameraYaw, syncCameraYaw } = await import('../src/gfx/fpv/view');
    let now = 100;
    syncCameraYaw(race, now);
    const spin = { spinTime: 1, speed: 60, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 40; i++) {
      now += 0.016;
      cameraYaw(spin, i * 0.12, now);
    }
    const done = { spinTime: 0, speed: 20, moveAngle: 0 } as unknown as Car;
    let prev = cameraYaw(done, 2.98, now);
    let maxStep = 0;
    for (let i = 0; i < 200; i++) {
      now += 0.016;
      const yaw = cameraYaw(done, 2.98, now);
      maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev))));
      prev = yaw;
    }
    expect(prev).toBe(2.98);
    expect(maxStep).toBeLessThanOrEqual(2.5 * 0.016 + 1e-9);
  });

  it('catches up with the heading when a corner follows a spin', async () => {
    const { cameraYaw, syncCameraYaw } = await import('../src/gfx/fpv/view');
    let now = 200;
    syncCameraYaw(race, now);
    const spin = { spinTime: 1, speed: 60, moveAngle: 0 } as unknown as Car;
    for (let i = 0; i < 40; i++) {
      now += 0.016;
      cameraYaw(spin, i * 0.12, now);
    }
    const done = { spinTime: 0, speed: 60, moveAngle: 0 } as unknown as Car;
    let heading = 1;
    let yaw = 0;
    for (let i = 0; i < 180; i++) {
      now += 0.016;
      heading += 1.4 * 0.016;
      yaw = cameraYaw(done, heading, now);
    }
    expect(yaw).toBe(heading);
  });

  it('drops a leftover spin swing after a camera switch, a restart or a new race', async () => {
    const { cameraYaw, cockpitCameraYaw, noteTopDownFrame, syncCameraYaw } = await import('../src/gfx/fpv/view');
    const spin = { spinTime: 1, speed: 60, moveAngle: 0 } as unknown as Car;
    const done = { spinTime: 0, speed: 60, moveAngle: 0 } as unknown as Car;
    const swing = (r: Race, t0: number) => {
      syncCameraYaw(r, t0);
      for (let i = 0; i < 40; i++) cameraYaw(spin, 1.5, t0 + i * 0.016);
      return t0 + 40 * 0.016;
    };
    // Paused: race time stands still, the swing is kept.
    let t = swing(race, 300);
    syncCameraYaw(race, t);
    expect(cameraYaw(done, 1.5, t)).not.toBe(1.5);
    expect(cockpitCameraYaw(race)).not.toBe(1.5);
    // Fast race time (debug x8): a long step between two cockpit frames keeps the swing.
    t = swing(race, 350);
    syncCameraYaw(race, t + 0.5);
    expect(cameraYaw(done, 1.5, t + 0.5)).not.toBe(1.5);
    // A frame with the top-down camera in between: the cockpit starts on the heading.
    t = swing(race, 400);
    noteTopDownFrame();
    syncCameraYaw(race, t);
    expect(cameraYaw(done, 1.5, t)).toBe(1.5);
    // Restart: race time goes back.
    t = swing(race, 500);
    syncCameraYaw(race, 0);
    expect(cameraYaw(done, 1.5, 0)).toBe(1.5);
    // A new race.
    t = swing(race, 600);
    const other = {} as Race;
    expect(Number.isNaN(cockpitCameraYaw(other))).toBe(true);
    syncCameraYaw(other, t);
    expect(cameraYaw(done, 1.5, t)).toBe(1.5);
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
  const read = (s: Partial<CabinInput>) => cabinReadout({ ...base, ...s });
  const lit = (s: Partial<CabinInput>) => read(s).leds.filter(Boolean).length;
  const hudSkidOn = (time: number) => Math.floor(time * 6) % 2 === 0;

  it('lights the LED strip from 114 mph to 146 mph', () => {
    expect(lit({ speed: 113 })).toBe(0);
    expect(lit({ speed: 130 })).toBe(5);
    expect(lit({ speed: 147 })).toBe(LED_COUNT);
    expect(read({ speed: 147 }).leds.slice(0, 4)).toEqual([PR.teal, PR.teal, PR.teal, PR.teal]);
  });

  it('turns the strip red for a skid and blinks it in a turn in step with the HUD SKID lamp', () => {
    expect(read({ speed: 151, skid: 1 }).leds.every((c) => c === PR.red)).toBe(true);
    for (let time = 10; time < 11; time += 0.037) {
      const r = read({ speed: 151, skid: 2, time });
      expect(r.leds.every((c) => c === (hudSkidOn(time) ? PR.red : null))).toBe(true);
      expect(r.lamps.skid).toBe(hudSkidOn(time));
    }
  });

  it('flashes the whole strip when a spin starts, then chases three red LEDs', () => {
    const start = CONFIG.SPIN_MAX_S;
    for (const time of [10, 10.1, 10.37]) expect(lit({ spinTime: start - 0.01, time })).toBe(LED_COUNT);
    expect(lit({ spinTime: start - 0.2, time: 10 })).toBe(0);
    for (const time of [11, 11.06, 11.5]) {
      const leds = read({ spinTime: 1, time }).leds;
      expect(leds.filter(Boolean).length).toBe(3);
      const head = leds.findIndex((c, i) => c && !leds[(i + LED_COUNT - 1) % LED_COUNT]);
      expect(leds[(head + 1) % LED_COUNT]).toBe(PR.red);
      expect(leds[(head + 2) % LED_COUNT]).toBe(PR.red);
    }
    expect(read({ spinTime: 1 }).lamps.skid).toBe(true);
  });

  it('alternates even and odd LEDs in the pit lane', () => {
    const a = read({ pitAuto: true, time: 10 }).leds;
    const b = read({ pitAuto: true, time: 10.25 }).leds;
    expect(a.filter(Boolean).length + b.filter(Boolean).length).toBe(LED_COUNT);
    for (let i = 0; i < LED_COUNT; i++) expect(!!a[i]).not.toBe(!!b[i]);
  });

  it('cascades the strip after the finish and then goes dark', () => {
    expect(lit({ finished: true, finishAge: 0.01 })).toBe(1);
    expect(lit({ finished: true, finishAge: 0.35 })).toBe(5);
    expect(read({ finished: true, finishAge: 0.8 }).leds[0]).toBe(PR.amber);
    expect(lit({ finished: true, finishAge: 2.5 })).toBe(0);
  });

  it('mirrors the start lights and flashes green at lights out', () => {
    expect(read({ started: false, lights: { lit: 3, out: false, since: -1 } }).leds).toEqual([
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

  it('shows the speed on an 18 segment ring that turns red as soon as it passes 150', () => {
    expect(read({ speed: 0 }).ring).toBe(0);
    expect(read({ speed: 95 }).ring).toBe(10);
    expect(read({ speed: 150 }).ring).toBe(15);
    expect(ringColor(read({ speed: 151 }).ring - 1)).toBe(PR.red);
    expect(read({ speed: 180 }).ring).toBe(RING_SEGS);
    expect(read({ speed: -12, reverse: true }).digits).toBe('R12');
    expect(ringColor(10)).toBe(PR.teal);
    expect(ringColor(14)).toBe(PR.amber);
  });

  it('warns about fuel only when a stop is close', () => {
    const full = read({ fuel: 1, lapsToGo: 18 });
    expect(full.fuelColor).toBe(PR.teal);
    expect(full.lamps.fuel).toBe(false);
    expect(full.podBottom).toBe('+0.42');
    const half = read({ fuel: 0.5, lapsToGo: 8 });
    expect(half.fuelLaps).toBeCloseTo(6);
    expect(half.fuelColor).toBe(PR.teal);
    const soon = read({ fuel: 0.2, lapsToGo: 8 });
    expect(soon.fuelColor).toBe(PR.amber);
    expect(soon.lamps.fuel).toBe(false);
    expect(soon).toMatchObject({ podBottom: 'PIT 2', podColor: PR.amber });
    expect(read({ fuel: 0.2, lapsToGo: 2 }).fuelColor).toBe(PR.teal);
    expect(read({ fuel: 0.13, lapsToGo: 8 })).toMatchObject({ podBottom: 'PIT 1', podColor: PR.amber });
    expect(read({ fuel: 0.07, lapsToGo: 8 })).toMatchObject({ podBottom: 'PIT NOW', podColor: PR.red });
    expect(read({ fuel: 0.121, lapsToGo: 8 }).lamps.fuel).toBe(true);
    expect(read({ fuel: 0.15, lapsToGo: 8 }).fuelColor).not.toBe(PR.red);
    const low = read({ fuel: CONFIG.LOW_FUEL - 0.01, time: 0.1 });
    expect(low.fuelColor).toBe(PR.red);
    expect(low.lamps.fuel).toBe(true);
    expect(read({ fuel: CONFIG.LOW_FUEL - 0.01, time: 0.4 }).lamps.fuel).toBe(false);
  });

  it('shows position with the interval to the car ahead', () => {
    expect(read({})).toMatchObject({ podTop: 'P4', podBottom: '+0.42', podColor: PR.amber });
    expect(read({ interval: 1.5 }).podColor).toBe(PR.tealLight);
    expect(read({ interval: null }).podBottom).toBe('—');
    expect(read({ position: 1 }).podBottom).toBe('LEAD');
    expect(read({ lapsToGo: 1 }).podBottom).toBe('FINAL');
    expect(read({ started: false }).podBottom).toBe('— —');
    expect(read({ finished: true, position: 3, time: 10 }).podTop).toBe('P3');
    expect(read({ finished: true, position: 3, time: 10.6 }).podTop).toBe('FINISH');
  });

  it('lights the tell-tales for pit, penalty and reverse and darkens them at the finish', () => {
    const r = read({ pitAuto: true, penalty: 2, penaltyAge: 5, reverse: true });
    expect(r.lamps).toMatchObject({ pit: true, pen: true, rev: true });
    expect(read({ penalty: 2, penaltyAge: 0.3 }).lamps.pen).toBe(false);
    expect(Object.values(read({ finished: true, pitAuto: true, reverse: true }).lamps).some(Boolean)).toBe(false);
  });
});

describe('cockpit glass and jolt', () => {
  const race = () => {
    const r = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 1);
    r.player.speed = 120;
    return r;
  };

  it('soils the glass in oil and clears most of it within 8 seconds', () => {
    const r = race();
    const p = r.player;
    r.oil.push({ x: p.x, y: p.y, s: 0, d: 0, age: 5 });
    for (let i = 0; i < 30; i++) stepCabin(r, 1 / 60);
    const peak = cabinFor(r).oil;
    expect(peak).toBeGreaterThan(0.5);
    r.oil.length = 0;
    for (let i = 0; i < 8 * 60; i++) stepCabin(r, 1 / 60);
    expect(cabinFor(r).oil).toBeLessThan(peak * 0.05);
    expect(cabinFor(race()).oil).toBe(0);
  });

  it('adds grit and a small jolt once per hit, at most once per jolt gap during long contact', () => {
    const r = race();
    const p = r.player;
    p.wallImpact = 30;
    p.contactStrength = 30;
    stepCabin(r, 1 / 60);
    const once = cabinFor(r).grit;
    expect(once).toBeGreaterThan(0.3);
    for (let i = 0; i < 5; i++) stepCabin(r, 1 / 60);
    expect(cabinFor(r).grit).toBeLessThanOrEqual(once);
    const j = joltOffset(cabinFor(r), r.time);
    expect(j.y).toBeGreaterThan(0);
    expect(Math.hypot(j.x, j.y)).toBeLessThanOrEqual(3);
    expect(joltOffset(cabinFor(r), r.time + 0.4)).toEqual({ x: 0, y: 0, kick: 0 });
    const before = cabinFor(r).grit;
    r.time += JOLT_GAP_S + 0.01;
    stepCabin(r, 1 / 60);
    expect(cabinFor(r).grit).toBeGreaterThan(before + 0.3);
  });

  it('counts a wall hit once instead of adding wall and contact strength', () => {
    const r = race();
    r.player.wallImpact = 4;
    r.player.contactStrength = 4;
    stepCabin(r, 1 / 60);
    expect(cabinFor(r).grit).toBe(0);
  });
});

describe('floodlight streaks', () => {
  it('projects only floodlight masts that are just ahead', async () => {
    const { floodStreaks } = await import('../src/gfx/fpv/view');
    const c = camera();
    const mast = { x: 40, y: 30, z: 81, r: 22, color: '255,214,140', flood: true };
    const out = floodStreaks(c, [mast, { ...mast, flood: false }, { ...mast, x: -40 }, { ...mast, x: 300 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo(c.ox + (c.focal * 30) / 40);
    expect(out[0]!.k).toBeGreaterThan(0);
    expect(out[0]!.k).toBeLessThanOrEqual(1);
  });
});
