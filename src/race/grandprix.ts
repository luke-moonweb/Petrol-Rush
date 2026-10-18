import { CONFIG, DIFFICULTY_CHOICES, type Difficulty, LAP_CHOICES, QUALIFYING_CHOICES, type Qualifying } from '../config';
import { createRng, lerp } from '../sim/rng';
import type { Race } from './race';

/** Points for 1st … 10th, as in modern F1. */
export const GP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const FORMAT_VERSION = 1;
const NUM_COLORS = 20;

/** An AI driver's character, fixed for the whole championship. */
export interface DriverSkill {
  topMph: number;
  turnMph: number;
  pitFuelLaps: number;
  reaction: number;
  fuelSave: number;
  /** The personality draw (race/persona.ts personaOf). */
  temper: number;
}

export interface GpEntry {
  colorIdx: number;
  /** Absent for the player. */
  skill?: DriverSkill;
}

export interface GpRaceResult {
  /** colorIdx in finishing order. */
  order: number[];
  /** colorIdx of cars that did not finish (they score nothing). */
  dnf: number[];
}

export interface GpSetup {
  cars: number;
  laps: number;
  playerColor: number;
  qualifying: Qualifying;
  difficulty: Difficulty;
}

export interface GrandPrix extends GpSetup {
  version: number;
  seed: number;
  tracks: string[];
  entries: GpEntry[];
  results: GpRaceResult[];
  restarts: number;
}

export interface Standing {
  colorIdx: number;
  points: number;
  wins: number;
  /** How many times the driver finished 1st, 2nd, … (for count-back on ties). */
  places: number[];
}

export function newGrandPrix(setup: GpSetup, seed: number, tracks: string[]): GrandPrix {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const n = Math.max(1, Math.min(NUM_COLORS, setup.cars));
  const entries: GpEntry[] = [{ colorIdx: setup.playerColor }];
  for (let c = 0; c < NUM_COLORS && entries.length < n; c++) {
    if (c === setup.playerColor) continue;
    entries.push({
      colorIdx: c,
      skill: {
        topMph: lerp(CONFIG.AI_TOP_MPH[0], CONFIG.AI_TOP_MPH[1], rng()),
        turnMph: lerp(CONFIG.AI_TURN_MPH[0], CONFIG.AI_TURN_MPH[1], rng()),
        pitFuelLaps: lerp(CONFIG.AI_PIT_FUEL_LAPS[0], CONFIG.AI_PIT_FUEL_LAPS[1], rng()),
        reaction: lerp(CONFIG.AI_REACTION_S[0], CONFIG.AI_REACTION_S[1], rng()),
        fuelSave: lerp(CONFIG.AI_FUEL_SAVE[0], CONFIG.AI_FUEL_SAVE[1], rng()),
        temper: 0,
      },
    });
  }
  // (the personality draws come after all the others, so the drivers' other skills stay as they were)
  for (const e of entries) if (e.skill) e.skill.temper = rng();
  return { version: FORMAT_VERSION, seed, ...setup, cars: n, tracks, entries, results: [], restarts: 0 };
}

export function round(gp: GrandPrix): number {
  return gp.results.length;
}

export function isOver(gp: GrandPrix): boolean {
  return gp.results.length >= gp.tracks.length;
}

/** Seed of the given round's race, so a continued championship replays the same race. */
export function raceSeed(gp: GrandPrix, r: number): number {
  return (gp.seed + (r + 1) * 7919) >>> 0;
}

export function pointsFor(position: number): number {
  return GP_POINTS[position - 1] ?? 0;
}

export function standings(gp: GrandPrix): Standing[] {
  const table = new Map<number, Standing>();
  for (const e of gp.entries) table.set(e.colorIdx, { colorIdx: e.colorIdx, points: 0, wins: 0, places: new Array(NUM_COLORS).fill(0) });
  for (const res of gp.results) {
    res.order.forEach((c, i) => {
      const s = table.get(c);
      if (!s || res.dnf.includes(c)) return;
      s.points += pointsFor(i + 1);
      s.places[i]!++;
      if (i === 0) s.wins++;
    });
  }
  return [...table.values()].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    for (let i = 0; i < NUM_COLORS; i++) if (a.places[i] !== b.places[i]) return b.places[i]! - a.places[i]!;
    return a.colorIdx - b.colorIdx;
  });
}

/**
 * Starting order (colorIdx per grid slot) for the next race. In round 1 the AI drivers line up in
 * random order and the player starts last; from round 2 on everyone, the player included, starts
 * from their place in the championship standings.
 */
export function gridOrder(gp: GrandPrix): number[] {
  if (round(gp) > 0) return standings(gp).map((s) => s.colorIdx);
  const ai = gp.entries.filter((e) => e.colorIdx !== gp.playerColor).map((e) => e.colorIdx);
  const rng = createRng(raceSeed(gp, -1));
  for (let i = ai.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ai[i], ai[j]] = [ai[j]!, ai[i]!];
  }
  return [...ai, gp.playerColor];
}

export function withResult(gp: GrandPrix, result: GpRaceResult): GrandPrix {
  return { ...gp, results: [...gp.results, result] };
}

export function serializeGp(gp: GrandPrix): string {
  return JSON.stringify(gp);
}

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isColor = (v: unknown): v is number => isNum(v, 0, NUM_COLORS - 1) && Number.isInteger(v);

function parseSkill(v: unknown): DriverSkill | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!isNum(s.topMph, 50, 300) || !isNum(s.turnMph, 50, 300) || !isNum(s.pitFuelLaps, 0, 20) || !isNum(s.reaction, 0, 5)) return null;
  // fuelSave came later: a championship saved before it gets the middle of the range
  const fuelSave = s.fuelSave === undefined ? 0.5 : s.fuelSave;
  if (!isNum(fuelSave, 0, 1)) return null;
  // (so did the personality: a neutral driver in the normal mix)
  const temper = s.temper === undefined ? 0.5 : s.temper;
  if (!isNum(temper, 0, 1)) return null;
  return { topMph: s.topMph, turnMph: s.turnMph, pitFuelLaps: s.pitFuelLaps, reaction: s.reaction, fuelSave, temper };
}

/** Reads a saved championship; anything unexpected (old format, edited, corrupt) gives null. */
export function parseGp(raw: string | null, knownTracks: string[]): GrandPrix | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || o.version !== FORMAT_VERSION) return null;
  if (!isNum(o.seed, 0, 2 ** 32) || !isNum(o.cars, 1, NUM_COLORS) || !isColor(o.playerColor)) return null;
  if (!isNum(o.laps, 1, LAP_CHOICES[LAP_CHOICES.length - 1]!) || !isNum(o.restarts, 0, 1e6)) return null;
  if (!QUALIFYING_CHOICES.includes(o.qualifying as Qualifying)) return null;
  // (a championship saved before the difficulty option races at normal)
  const difficulty = o.difficulty === undefined ? 'normal' : o.difficulty;
  if (!DIFFICULTY_CHOICES.includes(difficulty as Difficulty)) return null;
  const tracks = o.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0 || !tracks.every((t) => typeof t === 'string' && knownTracks.includes(t))) return null;
  const rawEntries = o.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length !== o.cars) return null;
  const entries: GpEntry[] = [];
  for (const e of rawEntries as Record<string, unknown>[]) {
    if (!e || !isColor(e.colorIdx)) return null;
    if (e.colorIdx === o.playerColor) entries.push({ colorIdx: e.colorIdx });
    else {
      const skill = parseSkill(e.skill);
      if (!skill) return null;
      entries.push({ colorIdx: e.colorIdx, skill });
    }
  }
  const colors = new Set(entries.map((e) => e.colorIdx));
  if (colors.size !== entries.length || !colors.has(o.playerColor)) return null;
  const rawResults = o.results;
  if (!Array.isArray(rawResults) || rawResults.length > tracks.length) return null;
  const results: GpRaceResult[] = [];
  for (const r of rawResults as Record<string, unknown>[]) {
    if (!r || !Array.isArray(r.order) || !Array.isArray(r.dnf)) return null;
    const order = r.order as unknown[];
    const dnf = r.dnf as unknown[];
    if (order.length !== entries.length || !order.every((c) => isColor(c) && colors.has(c)) || new Set(order).size !== order.length)
      return null;
    if (!dnf.every((c) => isColor(c) && colors.has(c))) return null;
    results.push({ order: order as number[], dnf: dnf as number[] });
  }
  return {
    version: FORMAT_VERSION,
    seed: o.seed,
    cars: o.cars,
    laps: o.laps,
    playerColor: o.playerColor,
    qualifying: o.qualifying as Qualifying,
    difficulty: difficulty as Difficulty,
    tracks: tracks as string[],
    entries,
    results,
    restarts: o.restarts,
  };
}

const STORAGE_KEY = 'petrolrush.gp';

export function loadGp(knownTracks: string[]): GrandPrix | null {
  try {
    return parseGp(localStorage.getItem(STORAGE_KEY), knownTracks);
  } catch {
    return null;
  }
}

export function saveGp(gp: GrandPrix | null): void {
  try {
    if (gp) localStorage.setItem(STORAGE_KEY, serializeGp(gp));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * The race's result for the championship: a retired player is classified last; a car out of fuel
 * (car.ts `isStranded`) keeps its place by the distance it covered, but like every car that did not
 * finish it scores nothing.
 */
export function raceResult(race: Race): GpRaceResult {
  let order = race.classification();
  if (race.playerRetired) order = [...order.filter((c) => !c.isPlayer), race.player];
  return {
    order: order.map((c) => c.colorIdx),
    dnf: order.filter((c) => !c.finished || (c.isPlayer && race.playerRetired)).map((c) => c.colorIdx),
  };
}
