import { test } from 'vitest';
import type { Difficulty } from '../../src/config';
import type { Race } from '../../src/race/race';
import { runStopEvent, type StopEvent } from '../sim/stopped';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// Stopped-player survey (not a test): the player brakes to a stop on a straight (tests/sim/stopped.ts) in
// ST_SEEDS races per track and level; per AI car that comes up behind it: passed, stalled (stood over 1 s),
// contact, late (too close to stop), spins; "clean" counts only events with no AI spin. ST_TRACKS,
// ST_LEVELS (easy,normal,hard), ST_HOLD (s), ST_D (a d the player stops at), ST_LOG=1 (the stalled and
// touching cars of clean events; =all: of every event), ST_TRACE=track:level:seed:carId (that car's steps).
// Run: npx vitest run --project lab tests/lab/stopped.lab.ts

const tracks = (process.env.ST_TRACKS ?? 'oval,harbour,desert,city,forest,finale').split(',');
const seeds = Number(process.env.ST_SEEDS ?? 12);
const levels = (process.env.ST_LEVELS ?? 'easy,normal,hard').split(',') as Difficulty[];
const trace = process.env.ST_TRACE?.split(':');

interface Tally {
  events: number;
  cars: number;
  passed: number;
  stalled: number;
  contact: number;
  late: number;
  lateContact: number;
  spins: number;
  cleanCars: number;
  cleanStalled: number;
  cleanContact: number;
}

const blank = (): Tally => ({
  events: 0,
  cars: 0,
  passed: 0,
  stalled: 0,
  contact: 0,
  late: 0,
  lateContact: 0,
  spins: 0,
  cleanCars: 0,
  cleanStalled: 0,
  cleanContact: 0,
});

function add(t: Tally, e: StopEvent, label: string, log: string[]): void {
  t.events++;
  for (const w of e.outcomes) {
    t.cars++;
    if (w.passed) t.passed++;
    if (w.still > 1) t.stalled++;
    if (w.spun) t.spins++;
    if (w.late) {
      t.late++;
      if (w.contact) t.lateContact++;
    } else if (w.contact) t.contact++;
    if (e.clean) {
      t.cleanCars++;
      if (w.still > 1) t.cleanStalled++;
      if (w.contact) t.cleanContact++;
    }
    if ((w.still > 1 || (w.contact && !w.late)) && process.env.ST_LOG && (e.clean || process.env.ST_LOG === 'all'))
      log.push(
        `    ${label}: car ${w.car.id} ${w.car.ai.persona.kind} still ${w.still.toFixed(1)}s contact ${w.contact} passed ${w.passed} late ${w.late} pd ${e.playerD.toFixed(0)}`,
      );
  }
}

function tracer(id: string, level: string, seed: number, log: string[]) {
  if (!trace || trace[0] !== id || trace[1] !== level || Number(trace[2]) !== seed) return undefined;
  return (race: Race, phase: string) => {
    if (Math.round(race.time * 60) % 10 !== 0) return;
    const track = race.track;
    const o = race.cars.find((c) => c.id === Number(trace[3]));
    if (!o) return;
    const ai = o.ai;
    const near = race.cars
      .filter((c) => c !== o && Math.abs(track.deltaS(o.s, c.s)) < 120)
      .map((c) => `${c.isPlayer ? 'P' : c.id}@${track.deltaS(o.s, c.s).toFixed(0)}/${c.d.toFixed(0)}/${c.speed.toFixed(0)}`)
      .join(' ');
    log.push(
      `  t ${race.time.toFixed(2)} ${phase} ds ${track.deltaS(race.player.s, o.s).toFixed(0)} d ${o.d.toFixed(1)} v ${o.speed.toFixed(0)} lane ${ai.lane} stuck ${ai.stuckTime.toFixed(1)} rec ${ai.recoverTime.toFixed(1)} | ${near}`,
    );
  };
}

test('stopped-player survey', () => {
  const lines: string[] = [];
  const total = blank();
  const hold = process.env.ST_HOLD ? Number(process.env.ST_HOLD) : undefined;
  const playerD = process.env.ST_D ? Number(process.env.ST_D) : undefined;
  for (const level of levels) {
    for (const id of tracks) {
      const t = blank();
      for (let seed = 1; seed <= seeds; seed++) {
        const e = runStopEvent(id, seed, level, { hold, playerD, onStep: tracer(id, level, seed, lines) });
        if (e) add(t, e, `${id} ${level} seed ${seed}`, lines);
      }
      for (const k of Object.keys(t) as (keyof Tally)[]) total[k] += t[k];
      lines.push(fmt(`${level.padEnd(6)} ${id.padEnd(8)}`, t));
    }
  }
  lines.push(fmt('total          ', total));
  process.stdout.write(`\n${lines.join('\n')}\n`);
}, 600_000);

function fmt(label: string, t: Tally): string {
  return `${label} events ${t.events} cars ${t.cars} passed ${t.passed} stalled ${t.stalled} contact ${t.contact} late ${t.late} (contact ${t.lateContact}) spins ${t.spins} | clean: cars ${t.cleanCars} stalled ${t.cleanStalled} contact ${t.cleanContact}`;
}
