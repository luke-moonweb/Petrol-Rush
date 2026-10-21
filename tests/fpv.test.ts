import './sim/browser';
import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { type CabinInput, cabinFor, cabinReadout, JOLT_GAP_S, joltOffset, LED_COUNT, ledKph, stepCabin } from '../src/gfx/fpv/cabin';
import { Camera, clipProject, outX, outY, visible } from '../src/gfx/fpv/engine';
import { upright } from '../src/gfx/fpv/geom';
import { OVAL_SPEC } from '../src/gfx/fpv/oval';
import { buildScene, sceneSpec } from '../src/gfx/fpv/scene';
import { drawTexQuad, texFacing, texQuad } from '../src/gfx/fpv/texture';
import { Race } from '../src/race/race';
import { NO_WARN } from '../src/race/warnings';
import { HALF_W } from '../src/track/common';
import { allTracks } from '../src/track/tracks';
import { fuelCall, fuelOutlook } from '../src/ui/hud';
import { PR } from '../src/ui/theme';
import { KPH_PER_MPH, toKph } from '../src/units';

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
    const s = buildScene(OVAL_SPEC);
    expect(s.ground.length).toBeGreaterThan(0);
    expect(s.solids.length).toBeGreaterThan(200);
    expect(s.glows.length).toBeGreaterThan(5);
  });

  it('hangs wall signs on the wall pieces behind them, piece by piece', () => {
    const s = buildScene(OVAL_SPEC);
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

// Every track gets the cockpit from its TrackDef alone, so these checks run on every track there is.
describe.each(allTracks().map((t) => [t.id, t] as const))('the cockpit scene of %s', (_id, track) => {
  const spec = sceneSpec(track);
  const scene = buildScene(spec);

  it('builds, with finite coordinates everywhere', () => {
    expect(scene.ground.length).toBeGreaterThan(0);
    expect(scene.solids.length).toBeGreaterThan(500);
    const polys = [...scene.ground, ...scene.decals, ...scene.island, ...scene.solids];
    for (const p of polys) for (const a of [p.xs, p.ys, p.zs]) for (const v of a) expect(Number.isFinite(v)).toBe(true);
    const quads = [...scene.signs, ...scene.groundSigns, ...scene.solids.flatMap((p) => p.decals ?? [])];
    for (const q of quads) for (const v of q.pts.flat()) expect(Number.isFinite(v)).toBe(true);
    for (const o of [...scene.glows, ...scene.pools, ...scene.billboards]) expect(Number.isFinite(o.x + o.y + o.z)).toBe(true);
  });

  it('hangs its upright signs on the walls behind them (only the grandstand banner hangs free)', () => {
    const hung = scene.solids.flatMap((p) => p.decals ?? []);
    expect(hung.length).toBeGreaterThan(40);
    for (const p of scene.solids) {
      for (const q of p.decals ?? []) {
        expect(Math.abs(p.plane![0] * q.normal[0] + p.plane![1] * q.normal[1])).toBeGreaterThan(0.99);
        expect(q.radius).toBeLessThanOrEqual(p.radius + 0.5);
        // In front of its wall and facing away from it, so it is seen from where it is meant to be read.
        const [nx, ny, k] = p.plane!;
        const side = nx * q.cx + ny * q.cy - k;
        if (Math.abs(side) > 0.05) expect(Math.sign(nx * q.normal[0] + ny * q.normal[1])).toBe(Math.sign(side));
      }
    }
    expect(scene.signs.length).toBeLessThanOrEqual(1);
  });

  it('puts nothing solid on the tarmac', () => {
    const onTrack: string[] = [];
    for (const p of scene.solids) {
      for (let i = 0; i < p.xs.length; i++) {
        const { s, d } = track.project(p.xs[i]!, p.ys[i]!);
        const edge = HALF_W + spec.kerbs(s)[d < 0 ? 0 : 1];
        if (Math.abs(d) < edge - 2) onTrack.push(`(${p.xs[i]!.toFixed(0)}, ${p.ys[i]!.toFixed(0)}) s ${s.toFixed(0)} d ${d.toFixed(1)}`);
      }
    }
    expect(onTrack.slice(0, 5)).toEqual([]);
  });

  it('shows the finish line and the walls from pole position', () => {
    const q = track.gridSlot(0);
    const p = track.pointAt(q.s, q.d);
    const c = new Camera();
    c.set(p.x, p.y, 9.2, p.heading);
    c.focal = 300;
    c.ox = 320;
    c.oy = 200;
    c.halfW = 320;
    const finish = track.pointAt(0, 0);
    const line = scene.decals.filter((d) => Math.hypot(d.cx - finish.x, d.cy - finish.y) < HALF_W);
    expect(line.length).toBeGreaterThan(20);
    expect(line.filter((d) => visible(d, c) >= 0 && c.depth(d.cx, d.cy) > 0).length).toBeGreaterThan(10);
    const walls = scene.solids.filter((w) => w.plane && visible(w, c) >= 0 && c.depth(w.cx, w.cy) > 0 && c.dist(w.cx, w.cy) < 400);
    expect(walls.length).toBeGreaterThan(10);
  });
});

describe('cockpit readout', () => {
  const base: CabinInput = {
    time: 10,
    speed: 0,
    reverse: false,
    fuel: 1,
    fuelOut: fuelCall(12, 5),
    lapsToGo: 5,
    started: true,
    finished: false,
    warn: NO_WARN,
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
  it('the strip only shows how close the car is to top speed: one LED per 10 km/h from 210, all lit at 290', () => {
    // (the cabin reads the simulation's speed in mph and converts; the thresholds are in km/h)
    const atKph = (kph: number) => ({ speed: kph / KPH_PER_MPH });
    expect(lit(atKph(209))).toBe(0);
    expect(lit(atKph(210))).toBe(1);
    expect(lit(atKph(250))).toBe(5);
    expect(lit(atKph(280))).toBe(8);
    expect(lit({ speed: CONFIG.MAX_MPH })).toBe(LED_COUNT);
    expect(lit({ speed: -CONFIG.MAX_MPH })).toBe(LED_COUNT);
    for (let i = 0; i < LED_COUNT; i++) expect(ledKph(i)).toBeCloseTo(209.68 + 10 * i, 2);
    expect(ledKph(LED_COUNT - 1)).toBe(toKph(CONFIG.MAX_MPH));
    // teal, amber, red along the strip, as before
    expect(read({ speed: 180 }).leds).toEqual([...Array(4).fill(PR.teal), ...Array(3).fill(PR.amber), PR.red, PR.red]);
    // nothing else: no skid, spin, pit-limiter, slide or finish patterns
    const plain = read({ speed: 150 }).leds;
    expect(read({ speed: 150, warn: { ...NO_WARN, skidHz: Infinity, skidLit: true } }).leds).toEqual(plain);
    expect(read({ speed: 150, spinTime: CONFIG.SPIN_MAX_S - 0.01 }).leds).toEqual(plain);
    expect(read({ speed: 150, spinTime: 1 }).leds).toEqual(plain);
    expect(read({ speed: 150, pitAuto: true }).leds).toEqual(plain);
    expect(read({ speed: 150, finished: true }).leds).toEqual(plain);
  });

  it('the SKID tell-tale follows the shown SKID lamp, and is lit through a spin', () => {
    for (const skidLit of [true, false]) expect(read({ warn: { ...NO_WARN, skidHz: 5, skidLit } }).lamps.skid).toBe(skidLit);
    expect(read({ warn: { ...NO_WARN, skidHz: Infinity, skidLit: true }, spinTime: 1 }).lamps.skid).toBe(true);
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

  it("warns about fuel only when a stop is close, by the laps the tank lasts at the car's own rate", () => {
    const full = read({ fuel: 1, fuelOut: fuelCall(12, 18) });
    expect(full.lamps.fuel).toBe(false);
    expect(full.podBottom).toBe('+0.42');
    const soon = read({ fuel: 0.2, fuelOut: fuelCall(2.4, 8) });
    expect(soon.lamps.fuel).toBe(false);
    expect(soon).toMatchObject({ podBottom: 'PIT 2', podColor: PR.amber });
    expect(read({ fuel: 0.2, fuelOut: fuelCall(2.4, 1.9) }).podBottom).toBe('+0.42');
    expect(read({ fuel: 0.13, fuelOut: fuelCall(1.56, 8) })).toMatchObject({ podBottom: 'PIT 1', podColor: PR.amber });
    expect(read({ fuel: 0.07, fuelOut: fuelCall(0.84, 8) })).toMatchObject({ podBottom: 'PIT NOW', podColor: PR.red });
    expect(read({ fuel: 0.121, fuelOut: fuelCall(1.45, 8) }).lamps.fuel).toBe(true);
    expect(read({ fuel: 0.15, fuelOut: fuelCall(1.8, 8) }).podColor).toBe(PR.amber);
    const low = read({ fuel: CONFIG.LOW_FUEL - 0.01, time: 0.1 });
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
    r.oil.push({ x: p.x, y: p.y, s: 0, d: 0, age: 5, owner: -1 });
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
    const { floodStreaks } = await import('../src/gfx/fpv/streaks');
    const c = camera();
    const mast = { x: 40, y: 30, z: 81, r: 22, color: '255,214,140', flood: true };
    const out = floodStreaks(c, [mast, { ...mast, flood: false }, { ...mast, x: -40 }, { ...mast, x: 300 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo(c.ox + (c.focal * 30) / 40);
    expect(out[0]!.k).toBeGreaterThan(0);
    expect(out[0]!.k).toBeLessThanOrEqual(1);
  });
});

describe('fuel outlook (HUD readout, cockpit pod, FUEL SHORT message)', () => {
  it("calls the fuel against the finish with the AI drivers' margin and saving gain", () => {
    const { GAIN, MARGIN_LAPS } = CONFIG.AI_ECO;
    expect(fuelCall(2 + MARGIN_LAPS, 2).call).toBe('ok');
    expect(fuelCall(2 + MARGIN_LAPS - 0.01, 2).call).toBe('tight');
    expect(fuelCall(2, 2).call).toBe('tight');
    expect(fuelCall(1.99, 2)).toMatchObject({ call: 'short', canSave: true });
    expect(fuelCall(2 / (1 + GAIN) - 0.01, 2)).toMatchObject({ call: 'short', canSave: false });
  });

  it("reads the player's own estimate, and only the current lap once the leader is home", () => {
    const race = new Race({ ...DEFAULT_OPTIONS, track: 'harbour', laps: 10 }, 1);
    const p = race.player;
    p.ai.fuelPerLap = 0.1;
    p.fuel = 0.5;
    const out = fuelOutlook(race);
    expect(out.laps).toBeCloseTo(5);
    expect(out.toGo).toBeGreaterThan(9.5);
    expect(out.call).toBe('short');
    race.leaderFinished = true;
    // on the grid, a little behind the line: to the end of the first lap
    expect(fuelOutlook(race).toGo).toBeLessThan(1.5);
    expect(fuelOutlook(race).call).toBe('ok');
  });
});
