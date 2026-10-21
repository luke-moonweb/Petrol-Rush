import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../src/config';
import { isStranded } from '../src/race/car';
import {
  GP_POINTS,
  type GpSetup,
  type GrandPrix,
  gridOrder,
  isOver,
  newGrandPrix,
  parseGp,
  raceResult,
  raceSeed,
  round,
  serializeGp,
  standings,
  withResult,
} from '../src/race/grandprix';
import { Race } from '../src/race/race';
import { GP_DEFS } from '../src/track/gp';
import { getTrack, trackIds } from '../src/track/tracks';

const TRACKS = GP_DEFS.map((d) => d.id);
const SETUP: GpSetup = { cars: 20, laps: 3, playerColor: 4, qualifying: 'last', difficulty: 'normal' };

function gp(setup = SETUP): GrandPrix {
  return newGrandPrix(setup, 1234, TRACKS);
}

/** colorIdx order with the player at the given position, other cars in entry order. */
function orderWithPlayerAt(g: GrandPrix, pos: number): number[] {
  const others = g.entries.map((e) => e.colorIdx).filter((c) => c !== g.playerColor);
  others.splice(pos - 1, 0, g.playerColor);
  return others;
}

function lineupFor(g: GrandPrix) {
  const skills = new Map(g.entries.flatMap((e) => (e.skill ? [[e.colorIdx, e.skill] as const] : [])));
  return { colors: gridOrder(g), skills };
}

describe('championship', () => {
  it('starts with one entry per car, the player first and without AI skill', () => {
    const g = gp();
    expect(g.entries.length).toBe(20);
    expect(new Set(g.entries.map((e) => e.colorIdx)).size).toBe(20);
    expect(g.entries.find((e) => e.colorIdx === 4)!.skill).toBeUndefined();
    expect(g.entries.filter((e) => e.skill).length).toBe(19);
    expect(round(g)).toBe(0);
    expect(isOver(g)).toBe(false);
  });

  it('scores 25-18-15-12-10-8-6-4-2-1 and nothing for a DNF', () => {
    let g = gp();
    const order = orderWithPlayerAt(g, 1);
    g = withResult(g, { order, dnf: [order[19]!] });
    const table = standings(g);
    expect(table.map((s) => s.points).slice(0, 11)).toEqual([...GP_POINTS, 0]);
    expect(table.reduce((a, s) => a + s.points, 0)).toBe(101);
    expect(table[0]!.colorIdx).toBe(4);
    expect(table[0]!.wins).toBe(1);
  });

  it('a DNF in the points scores nothing', () => {
    let g = gp();
    const order = orderWithPlayerAt(g, 2);
    g = withResult(g, { order, dnf: [g.playerColor] });
    expect(standings(g).find((s) => s.colorIdx === g.playerColor)!.points).toBe(0);
  });

  it('ties are broken by count-back: more wins, then more 2nd places …', () => {
    let g = gp({ ...SETUP, cars: 3 });
    const [a, b, c] = g.entries.map((e) => e.colorIdx) as [number, number, number];
    // a: 25 + 15 = 40, b: 15 + 25 = 40 → equal points and wins; c: 18 + 18 = 36.
    g = withResult(g, { order: [a, c, b], dnf: [] });
    g = withResult(g, { order: [b, c, a], dnf: [] });
    const t1 = standings(g);
    expect(t1.map((s) => s.points)).toEqual([40, 40, 36]);
    // Same points, same wins and same 3rd places: the lower colour index is listed first.
    expect(t1[0]!.colorIdx).toBe(Math.min(a, b));
    g = withResult(g, { order: [c, a, b], dnf: [] });
    // a: 58, b: 55, c: 61.
    expect(standings(g).map((s) => s.colorIdx)).toEqual([c, a, b]);
  });

  it('works with a single car', () => {
    let g = gp({ ...SETUP, cars: 1 });
    expect(g.entries.length).toBe(1);
    expect(gridOrder(g)).toEqual([4]);
    for (let i = 0; i < 5; i++) g = withResult(g, { order: [4], dnf: [] });
    expect(isOver(g)).toBe(true);
    expect(standings(g)[0]!.points).toBe(125);
  });

  it('grid: the player starts last in round 1, then everyone by the standings', () => {
    // (an old save's grid position no longer matters)
    for (const q of ['pole', 'middle', 'last', 'random'] as const) {
      const g = gp({ ...SETUP, qualifying: q });
      expect(gridOrder(g).indexOf(4)).toBe(19);
      expect(gridOrder(g)).toEqual(gridOrder(g));
      expect(new Set(gridOrder(g)).size).toBe(20);
    }
    let g = gp({ ...SETUP, qualifying: 'pole' });
    const first = orderWithPlayerAt(g, 3);
    g = withResult(g, { order: first, dnf: [] });
    expect(gridOrder(g)).toEqual(first);
    expect(gridOrder(g).indexOf(4)).toBe(2);
    // Round 3: the grid is the championship table, not the last race's result.
    g = withResult(g, { order: [...first].reverse(), dnf: [] });
    expect(gridOrder(g)).toEqual(standings(g).map((s) => s.colorIdx));
    expect(gridOrder(g)).not.toEqual([...first].reverse());
  });

  it('race seeds differ per round and repeat for the same championship', () => {
    const g = gp();
    const seeds = [0, 1, 2, 3, 4].map((r) => raceSeed(g, r));
    expect(new Set(seeds).size).toBe(5);
    expect(raceSeed(gp(), 2)).toBe(seeds[2]);
  });

  it('the same AI driver keeps the same skill in every race', () => {
    const g = gp();
    const lineup = lineupFor(g);
    const color = g.entries[5]!.colorIdx;
    const speeds = TRACKS.map((id, r) => {
      const race = new Race({ ...DEFAULT_OPTIONS, track: id, cars: 20 }, raceSeed(g, r), false, undefined, getTrack(id), lineup);
      return race.cars.find((c) => c.colorIdx === color)!.ai.topMph;
    });
    expect(new Set(speeds).size).toBe(1);
    expect(speeds[0]).toBe(g.entries[5]!.skill!.topMph);
  });

  it('a retired player is classified last and does not score', () => {
    const g = gp({ ...SETUP, cars: 4 });
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 4, playerColor: 4 }, 1, false, undefined, getTrack(TRACKS[0]!), lineupFor(g));
    race.playerRetired = true;
    const res = raceResult(race);
    expect(res.order[3]).toBe(4);
    expect(res.dnf).toContain(4);
  });

  it('a car out of fuel stands, the race ends without it, and it keeps its place by distance but scores nothing', () => {
    const g = gp({ ...SETUP, cars: 6, laps: 2 });
    const id = TRACKS[0]!;
    const race = new Race(
      { ...DEFAULT_OPTIONS, track: id, cars: 6, laps: 2, playerColor: 4 },
      1,
      true,
      undefined,
      getTrack(id),
      lineupFor(g),
    );
    race.start();
    const dt = 1 / CONFIG.STEP_HZ;
    // two AI cars run dry on the first lap, the second further round than the first
    const [early, late] = race.cars.filter((c) => !c.isPlayer);
    while (race.time < 10) race.step(dt, null);
    early!.fuel = 0;
    while (race.time < 20) race.step(dt, null);
    late!.fuel = 0;
    while (!race.raceOver() && race.time < 300) race.step(dt, null);
    expect(race.raceOver()).toBe(true);
    expect(race.allFinished()).toBe(false);
    expect([early, late].map((c) => isStranded(c!))).toEqual([true, true]);
    expect(race.cars.filter((c) => c.finished).length).toBe(4);
    const res = raceResult(race);
    // behind the four finishers, by the distance covered
    expect(res.order.slice(4)).toEqual([late!.colorIdx, early!.colorIdx]);
    expect(res.dnf.sort()).toEqual([early!.colorIdx, late!.colorIdx].sort());
    const table = standings(withResult(g, res));
    expect(table.find((s) => s.colorIdx === late!.colorIdx)!.points).toBe(0);
    expect(table.find((s) => s.colorIdx === early!.colorIdx)!.points).toBe(0);
  });
});

describe('saved championship', () => {
  const ids = trackIds();

  it('round-trips', () => {
    let g = gp();
    g = withResult(g, { order: orderWithPlayerAt(g, 3), dnf: [] });
    expect(parseGp(serializeGp(g), ids)).toEqual(g);
  });

  it('reads a championship saved before the fuel-saving skill, with the middle of the range', () => {
    const g = gp();
    const old = { ...g, entries: g.entries.map((e) => (e.skill ? { ...e, skill: { ...e.skill, fuelSave: undefined } } : e)) };
    const read = parseGp(JSON.stringify(old), ids)!;
    expect(read.entries[1]!.skill!.fuelSave).toBe(0.5);
    const silly = { ...g, entries: g.entries.map((e) => (e.skill ? { ...e, skill: { ...e.skill, fuelSave: 7 } } : e)) };
    expect(parseGp(JSON.stringify(silly), ids)).toBeNull();
  });

  // A championship the game saved on 2026-10-21 (format 1): newGrandPrix with 3 cars and seed 1234, one race run.
  // The skills are the simulation's speeds in mph, and the save keeps that name and unit: whatever unit the game
  // shows later, a reader must still give these drivers these numbers (a new unit means format 2 and a reader
  // that converts, never a reinterpretation), and the season must go on from the same next race.
  const SAVED_2026_10_21 =
    '{"version":1,"seed":1234,"cars":3,"laps":3,"playerColor":4,"qualifying":"last","difficulty":"normal","tracks":["harbour","desert","city","forest","finale"],"entries":[{"colorIdx":4},{"colorIdx":0,"skill":{"topMph":177.462048481917,"turnMph":146.56431506201625,"pitFuelLaps":1.7376990455202759,"reaction":0.5541875434340908,"fuelSave":0.0817739050835371,"temper":0.78556117718108}},{"colorIdx":1,"skill":{"topMph":172.94175889715552,"turnMph":145.96905256062746,"pitFuelLaps":4.739406910701655,"reaction":0.46482107839547093,"fuelSave":0.9129431215114892,"temper":0.5880564274266362}}],"results":[{"order":[0,4,1],"dnf":[]}],"restarts":0}';

  it('reads a championship saved on 2026-10-21 driver for driver, and goes on from its next race', () => {
    const read = parseGp(SAVED_2026_10_21, ids);
    expect(read).not.toBeNull();
    expect(read!.entries.map((e) => e.skill)).toEqual([
      undefined,
      {
        topMph: 177.462048481917,
        turnMph: 146.56431506201625,
        pitFuelLaps: 1.7376990455202759,
        reaction: 0.5541875434340908,
        fuelSave: 0.0817739050835371,
        temper: 0.78556117718108,
      },
      {
        topMph: 172.94175889715552,
        turnMph: 145.96905256062746,
        pitFuelLaps: 4.739406910701655,
        reaction: 0.46482107839547093,
        fuelSave: 0.9129431215114892,
        temper: 0.5880564274266362,
      },
    ]);
    expect(round(read!)).toBe(1);
    expect(raceSeed(read!, 1)).toBe(17072);
    expect(standings(read!)[0]!.colorIdx).toBe(0);
  });

  it('rejects missing, corrupt, foreign and inconsistent data', () => {
    const g = gp();
    const bad = (patch: Partial<GrandPrix> | Record<string, unknown>) => parseGp(JSON.stringify({ ...g, ...patch }), ids);
    expect(parseGp(null, ids)).toBeNull();
    expect(parseGp('{', ids)).toBeNull();
    expect(parseGp('[]', ids)).toBeNull();
    expect(bad({ version: 2 })).toBeNull();
    expect(bad({ tracks: ['nowhere'] })).toBeNull();
    expect(bad({ cars: 19 })).toBeNull();
    expect(bad({ playerColor: 25 })).toBeNull();
    expect(bad({ qualifying: 'front' })).toBeNull();
    expect(bad({ entries: g.entries.map((e) => ({ ...e, colorIdx: 0 })) })).toBeNull();
    expect(bad({ entries: g.entries.map((e) => (e.skill ? { ...e, skill: { ...e.skill, topMph: 'fast' } } : e)) })).toBeNull();
    expect(bad({ results: [{ order: [1, 2], dnf: [] }] })).toBeNull();
    expect(bad({ results: new Array(6).fill({ order: orderWithPlayerAt(g, 1), dnf: [] }) })).toBeNull();
  });
});

describe('a whole Grand Prix season, headless', () => {
  it('five races on five circuits, every car classified, points add up', () => {
    let g = gp({ ...SETUP, laps: 2 });
    while (!isOver(g)) {
      const id = g.tracks[round(g)]!;
      const race = new Race(
        { ...DEFAULT_OPTIONS, track: id, cars: g.cars, laps: g.laps, playerColor: g.playerColor },
        raceSeed(g, round(g)),
        true,
        undefined,
        getTrack(id),
        lineupFor(g),
      );
      race.start();
      while (!race.allFinished() && race.time < 300) race.step(1 / CONFIG.STEP_HZ, null);
      const res = raceResult(race);
      expect(res.dnf).toEqual([]);
      expect(new Set(res.order).size).toBe(20);
      g = withResult(g, res);
    }
    const table = standings(g);
    expect(table.reduce((a, s) => a + s.points, 0)).toBe(5 * 101);
    expect(table[0]!.points).toBeGreaterThan(table[19]!.points);
  }, 60000);
});
