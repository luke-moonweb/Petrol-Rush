import { CONFIG } from '../../config';
import type { Car } from '../../race/car';
import { oilRadius } from '../../race/oil';
import type { Race } from '../../race/race';
import { PR } from '../../ui/theme';

export const LED_COUNT = 9;
export const RING_SEGS = 18;
export const FUEL_SEGS = CONFIG.FUEL_RANGE_LAPS;
export const LED_GREEN = '#52E252';
export const JOLT_PX = 3;
export const JOLT_S = 0.12;
export const KICK_RAD = 0.25;
export const KICK_S = 0.06;

const SOIL_CLEAR_S = 8;
const OIL_SPLASH_S = 0.4;
const HIT_MIN = 6;
const HIT_FULL = 36;
const JOLT_GAP_S = 0.25;
const GREEN_S = 0.4;
const CASCADE_LED_S = 0.08;
const CASCADE_LOOPS = 3;

export interface CabinState {
  oil: number;
  grit: number;
  joltAt: number;
  joltK: number;
  joltX: number;
  joltY: number;
  finishedAt: number;
  spinning: boolean;
}

const cabins = new WeakMap<Race, CabinState>();

export function cabinFor(race: Race): CabinState {
  let c = cabins.get(race);
  if (!c) {
    c = { oil: 0, grit: 0, joltAt: -Infinity, joltK: 0, joltX: 0, joltY: 0, finishedAt: -1, spinning: false };
    cabins.set(race, c);
  }
  return c;
}

function lateral(p: Car, x: number, y: number): number {
  return -(x - p.x) * Math.sin(p.heading) + (y - p.y) * Math.cos(p.heading);
}

function jolt(c: CabinState, time: number, k: number, dx: number, dy: number): void {
  if (time - c.joltAt < JOLT_GAP_S && k <= c.joltK) return;
  c.joltAt = time;
  c.joltK = k;
  const len = Math.hypot(dx, dy) || 1;
  c.joltX = dx / len;
  c.joltY = dy / len;
}

export function stepCabin(race: Race, dt: number): void {
  const c = cabinFor(race);
  const p = race.player;
  const clear = Math.exp(-dt / SOIL_CLEAR_S);
  c.oil *= clear;
  c.grit *= clear;
  if (Math.abs(p.speed) > CONFIG.OIL_MIN_MPH) {
    for (const o of race.oil) {
      if (Math.hypot(o.x - p.x, o.y - p.y) < oilRadius(o) + CONFIG.CAR_WID / 2) {
        c.oil = Math.min(1, c.oil + dt / OIL_SPLASH_S);
        break;
      }
    }
  }
  const hit = p.wallImpact + p.contactStrength;
  if (hit > HIT_MIN) {
    const k = Math.min(1, hit / HIT_FULL);
    c.grit = Math.min(1, c.grit + k * 0.5);
    const side = Math.sign(lateral(p, p.contactX, p.contactY)) || 1;
    jolt(c, race.time, k, -side * (p.wallImpact > 0 ? 0.5 : 1), p.wallImpact > 0 ? 1 : 0);
  }
  const spinning = p.spinTime > 0;
  if (spinning && !c.spinning) jolt(c, race.time, 0.6, p.spinDir || 1, 0);
  c.spinning = spinning;
  if (p.finished && c.finishedAt < 0) c.finishedAt = race.time;
}

export function joltOffset(c: CabinState, time: number): { x: number; y: number; kick: number } {
  const t = time - c.joltAt;
  if (!(t >= 0) || t > JOLT_S * 3) return { x: 0, y: 0, kick: 0 };
  const a = c.joltK * Math.exp(-t / JOLT_S) * JOLT_PX;
  return { x: c.joltX * a, y: c.joltY * a, kick: -c.joltX * c.joltK * KICK_RAD * Math.exp(-t / KICK_S) };
}

export interface CabinInput {
  time: number;
  speed: number;
  reverse: boolean;
  fuel: number;
  lapsToGo: number;
  started: boolean;
  finished: boolean;
  finishAge: number;
  skid: 0 | 1 | 2;
  slideTime: number;
  spinTime: number;
  pitAuto: boolean;
  refueling: boolean;
  penalty: number;
  penaltyAge: number;
  lights?: { lit: number; out: boolean; since: number };
  position: number;
  interval: number | null;
}

export interface Lamps {
  pit: boolean;
  fuel: boolean;
  skid: boolean;
  pen: boolean;
  rev: boolean;
}

export interface Readout {
  leds: (string | null)[];
  ring: number;
  digits: string;
  digitsColor: string;
  fuelLaps: number;
  fuelColor: string;
  fuelOn: boolean;
  fuelTick: number;
  lamps: Lamps;
  podTop: string;
  podBottom: string;
  podColor: string;
}

const on = (time: number, hz: number) => Math.floor(time * hz * 2) % 2 === 0;

function ledColor(i: number): string {
  return i < 4 ? PR.teal : i < 7 ? PR.amber : PR.red;
}

function leds(s: CabinInput, mph: number): (string | null)[] {
  const out: (string | null)[] = new Array(LED_COUNT).fill(null);
  const all = (color: string | null) => out.fill(color);
  const t = s.time;
  if (s.lights && !s.lights.out) {
    for (let i = 0; i < s.lights.lit && i < 5; i++) out[2 + i] = PR.red;
    return out;
  }
  if (s.lights && s.lights.since < GREEN_S) return all(LED_GREEN);
  if (s.finished) {
    const loop = Math.floor(s.finishAge / (CASCADE_LED_S * LED_COUNT));
    if (loop >= CASCADE_LOOPS) return out;
    const n = Math.floor(s.finishAge / CASCADE_LED_S) % LED_COUNT;
    for (let i = 0; i <= n; i++) out[i] = loop % 2 === 0 ? PR.teal : PR.amber;
    return out;
  }
  if (s.spinTime > 0) {
    out[Math.floor(t / 0.06) % LED_COUNT] = PR.red;
    return out;
  }
  if (s.skid === 1 || (s.skid === 2 && on(t, 3))) return all(PR.red);
  if (s.skid === 2) return out;
  if (s.pitAuto) {
    const phase = Math.floor(t * 4) % 2;
    for (let i = 0; i < LED_COUNT; i++) if (i % 2 === phase) out[i] = PR.teal;
    return out;
  }
  for (let i = 0; i < LED_COUNT; i++) if (mph >= CONFIG.SPIN_MPH - 36 + 4 * i) out[i] = ledColor(i);
  if (s.slideTime > 0.5 * CONFIG.SLIDE_MAX_S && on(t, 4)) {
    out[0] = PR.amber;
    out[LED_COUNT - 1] = PR.amber;
  }
  return out;
}

export function ringColor(seg: number): string {
  const top = (seg + 1) * 10;
  return top <= 110 ? PR.teal : top <= CONFIG.SPIN_MPH ? PR.amber : PR.red;
}

export function cabinReadout(s: CabinInput): Readout {
  const mph = Math.round(Math.abs(s.speed));
  const t = s.time;
  const fuel = Math.max(0, Math.min(1, s.fuel));
  const fuelLaps = fuel * FUEL_SEGS;
  const low = fuel < CONFIG.LOW_FUEL;
  const racing = s.started && !s.finished;
  const short = racing && fuelLaps < s.lapsToGo;
  const lamps: Lamps = s.finished
    ? { pit: false, fuel: false, skid: false, pen: false, rev: false }
    : {
        pit: s.pitAuto && (!s.refueling || on(t, 2)),
        fuel: low ? on(t, 1.5) : short,
        skid: s.spinTime > 0 || s.skid === 1 || (s.skid === 2 && on(t, 3)),
        pen: s.penalty > 0 && (s.penaltyAge >= 3 || Math.floor(s.penaltyAge * 4) % 2 === 0),
        rev: s.reverse,
      };
  let podTop = `P${s.position}`;
  let podBottom: string;
  let podColor: string = PR.tealLight;
  if (!s.started) podBottom = '— —';
  else if (s.finished) {
    if (!on(t, 1)) podTop = 'FINISH';
    podBottom = '';
  } else if (s.lapsToGo <= 1) {
    podBottom = 'FINAL';
    podColor = PR.amber;
  } else if (s.position === 1) podBottom = 'LEAD';
  else if (s.interval === null) podBottom = '—';
  else {
    podBottom = `+${s.interval.toFixed(2)}`;
    if (s.interval < 0.5) podColor = PR.amber;
  }
  return {
    leds: leds(s, mph),
    ring: Math.min(RING_SEGS, Math.floor(mph / 10)),
    digits: s.reverse ? `R${mph}` : String(mph),
    digitsColor: s.skid >= 1 && !s.reverse ? PR.red : PR.amber,
    fuelLaps,
    fuelColor: low ? PR.red : short ? PR.amber : PR.teal,
    fuelOn: !low || on(t, 1.5),
    fuelTick: s.refueling ? (t % 1) * FUEL_SEGS : -1,
    lamps,
    podTop,
    podBottom,
    podColor,
  };
}
