import { test } from 'vitest';
import type { Difficulty } from '../../src/config';
import type { Race } from '../../src/race/race';
import { phaseCode, runPitRace } from '../sim/pits';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// Pit-lane survey (not a test): 20-car races of PL_LAPS laps over PL_SEEDS seeds per track (tests/sim/pits.ts),
// every car starting with PL_FUEL of a tank (default 0.2: the whole field pits within a few laps, the busy
// case; PL_LAPS=18 PL_FUEL=1 is an ordinary race). Per track: stops, stops with a contact in the pits and
// their share, the contacts by the phases of the two cars (e entering, f refuelling, x exiting), merge
// contacts, the box exit wait (mean, p50, p90, max), the longest stand on the pit road, unfinished cars and
// the mean heading of the parked cars. PL_LEVEL: the difficulty. PL_LOG=1: each pit contact and unfinished
// car. PL_SNAP=track:seed:t0:t1: every pit car (phase, * pulling out, x, y, mph) each 0.25 s from t0 to t1.
// PL_TRACE=track:seed:carIds:t0:t1: those cars' steps. Run: npx vitest run --project lab tests/lab/pits.lab.ts

const tracks = (process.env.PL_TRACKS ?? 'oval,harbour,desert,city,forest,finale').split(',');
const seeds = Number(process.env.PL_SEEDS ?? 8);
const laps = Number(process.env.PL_LAPS ?? 4);
const fuel0 = Number(process.env.PL_FUEL ?? 0.2);
const seed0 = Number(process.env.PL_SEED0 ?? 1);
const level = process.env.PL_LEVEL as Difficulty | undefined;
const log = !!process.env.PL_LOG;
const snap = process.env.PL_SNAP?.split(':');
const trace = process.env.PL_TRACE?.split(':');

function watch(id: string, seed: number, lines: string[]): (r: Race) => void {
  return (r) => {
    const at = (a: string[] | undefined, from: number) =>
      a && a[0] === id && Number(a[1]) === seed && r.time >= Number(a[from]) && r.time <= Number(a[from + 1]);
    if (at(snap, 2) && Math.round(r.time * 60) % 15 === 0) {
      const cars = r.cars.filter((c) => c.ai.pitPhase !== 'none').sort((a, b) => a.x - b.x);
      const show = (c: Race['cars'][number]) =>
        `${c.id}${phaseCode(c.ai.pitPhase)}${c.ai.pullOut ? '*' : ''}(${c.x.toFixed(0)},${c.y.toFixed(0)},${c.speed.toFixed(0)})`;
      lines.push(`  t ${r.time.toFixed(2)} ${cars.map(show).join(' ')}`);
    }
    if (at(trace, 3))
      for (const c of trace![2]!.split(',').map((i) => r.cars[Number(i)]!))
        lines.push(
          `  t ${r.time.toFixed(2)} car ${c.id} ${c.ai.pitPhase} x ${c.x.toFixed(1)} y ${c.y.toFixed(1)} hdg ${c.heading.toFixed(3)} v ${c.speed.toFixed(1)} contact ${c.contactStrength.toFixed(1)} fuel ${c.fuel.toFixed(3)}`,
        );
  };
}

test('pit-lane survey', () => {
  const lines: string[] = [];
  const total = { stops: 0, hit: 0 };
  for (const id of tracks) {
    const t = { stops: 0, hit: 0, merge: 0, maxStand: 0, unfinished: 0, park: 0, spins: 0, gaveUp: 0 };
    const kinds = new Map<string, number>();
    const waits: number[] = [];
    for (let seed = seed0; seed < seed0 + seeds; seed++) {
      const s = runPitRace({
        track: id,
        seed,
        laps,
        fuel0,
        difficulty: level,
        onStep: snap || trace ? watch(id, seed, lines) : undefined,
        onContact: log
          ? (r, a, b, merge) =>
              lines.push(
                `  ${id} seed ${seed} t ${r.time.toFixed(1)}:${merge ? ' merge' : ''} ${a.id}(${a.ai.pitPhase}) ${b.id}(${b.ai.pitPhase}) at x ${a.x.toFixed(0)} ${a.y.toFixed(0)} / ${b.x.toFixed(0)} ${b.y.toFixed(0)} closing ${Math.max(a.contactStrength, b.contactStrength).toFixed(1)} v ${a.speed.toFixed(0)}/${b.speed.toFixed(0)} box ${a.ai.box}/${b.ai.box} d ${a.d.toFixed(0)}/${b.d.toFixed(0)}`,
              )
          : undefined,
      });
      t.stops += s.stops;
      t.hit += s.hitStops;
      t.merge += s.merge;
      t.maxStand = Math.max(t.maxStand, s.maxStand);
      t.unfinished += s.unfinished.length;
      t.spins += s.spins;
      t.gaveUp += s.gaveUp;
      t.park += s.parkHeading * s.stops;
      for (const [k, v] of s.kinds) kinds.set(k, (kinds.get(k) ?? 0) + v);
      waits.push(...s.waits);
      if (log)
        for (const c of s.unfinished)
          lines.push(
            `  ${id} seed ${seed}: car ${c.id} unfinished at t ${s.race.time.toFixed(0)}: ${c.ai.pitPhase} x ${c.x.toFixed(0)} y ${c.y.toFixed(0)} fuel ${c.fuel.toFixed(3)}`,
          );
    }
    total.stops += t.stops;
    total.hit += t.hit;
    waits.sort((a, b) => a - b);
    const mean = waits.reduce((a, b) => a + b, 0) / Math.max(1, waits.length);
    const pct = (q: number) => (waits[Math.floor(waits.length * q)] ?? 0).toFixed(2);
    const ks = [...kinds.entries()]
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(' ');
    lines.push(
      `${id.padEnd(8)} stops ${String(t.stops).padStart(4)} hit ${String(t.hit).padStart(3)} (${((100 * t.hit) / Math.max(1, t.stops)).toFixed(1)}%)  pit contacts [${ks}]  merge ${t.merge}  box wait mean ${mean.toFixed(2)} s p50 ${pct(0.5)} p90 ${pct(0.9)} max ${(waits.at(-1) ?? 0).toFixed(1)} s  stood ${t.maxStand.toFixed(1)} s  unfinished ${t.unfinished}  gave up ${t.gaveUp}  spins ${t.spins}  park heading ${(t.park / Math.max(1, t.stops)).toFixed(2)}`,
    );
  }
  lines.push(`all      stops ${total.stops} hit ${total.hit} (${((100 * total.hit) / Math.max(1, total.stops)).toFixed(1)}%)`);
  process.stdout.write(`${lines.join('\n')}\n`);
}, 600_000);
