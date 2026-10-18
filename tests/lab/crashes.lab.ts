import { test } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/config';
import { PERSONAS } from '../../src/race/persona';
import { lineUse } from '../../src/race/planner';
import { Race } from '../../src/race/race';
import { racingLine } from '../../src/track/racingLine';
import { getTrack } from '../../src/track/tracks';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// Crash survey (not a test): 20-car, CR_LAPS-lap races over CR_SEEDS seeds from CR_SEED0 on the CR_TRACKS
// tracks, counting spins, contacts, wall hits, turn-in slides and blocks per track (CR_SEEDLOG=1: the
// spins per seed). "corner" is the share of racing steps in a bend within CR_LINE_PX (6) of the car's own racing
// line, "off" the mean distance (px) from it there. CR_OPTS adds race options (CR_LEVEL=hard: the difficulty); CR_MODE=noslide,noblock,neutral
// switches personality traits off. Run: CR_TRACKS=oval,city npx vitest run --project lab tests/lab/crashes.lab.ts

const tracks = (process.env.CR_TRACKS ?? 'oval,harbour,desert,city,forest,finale').split(',');
const seeds = Number(process.env.CR_SEEDS ?? 8);
const laps = Number(process.env.CR_LAPS ?? 5);
const extra = JSON.parse(process.env.CR_OPTS ?? '{}') as Record<string, unknown>;
if (process.env.CR_LEVEL) extra.difficulty = process.env.CR_LEVEL;

test('crash survey', () => {
  const lines: string[] = [];
  for (const id of tracks) {
    const track = getTrack(id);
    let spins = 0;
    let contacts = 0;
    let walls = 0;
    let lineSteps = 0;
    let slides = 0;
    let blocks = 0;
    let allSteps = 0;
    let bendSteps = 0;
    let bendOn = 0;
    let bendOff = 0;
    const line = racingLine(track);
    const curves = track.curves();
    const near = Number(process.env.CR_LINE_PX ?? 6);
    let finished = 0;
    let time = 0;
    const byKind = new Map<string, { spins: number; cars: number; pos: number }>();
    const seed0 = Number(process.env.CR_SEED0 ?? 1);
    for (let seed = seed0; seed < seed0 + seeds; seed++) {
      const r = new Race(
        { ...DEFAULT_OPTIONS, ...extra, track: id, cars: 20, laps, qualifying: 'middle' } as never,
        seed,
        true,
        undefined,
        track,
      );
      const mode = process.env.CR_MODE ?? '';
      for (const c of r.cars) {
        if (mode.includes('noslide')) c.ai.persona = { ...c.ai.persona, slide: 0 };
        if (mode.includes('noblock')) c.ai.persona = { ...c.ai.persona, blocks: false };
        if (mode.includes('neutral')) c.ai.persona = PERSONAS.neutral;
      }
      r.start();
      const was = r.cars.map(() => false);
      const touch = r.cars.map(() => false);
      const wall = r.cars.map(() => false);
      const sl = r.cars.map(() => 0);
      const bl = r.cars.map(() => false);
      const carSpins = r.cars.map(() => 0);
      while (!r.allFinished() && r.time < laps * 90 + 60) {
        r.step(1 / 60, null);
        r.cars.forEach((c, i) => {
          if (c.spinTime > 0 && !was[i]) {
            spins++;
            carSpins[i]!++;
          }
          was[i] = c.spinTime > 0;
          if (c.ai.slide === 2 && sl[i] !== 2) slides++;
          sl[i] = c.ai.slide;
          if (c.ai.blockLane !== null && !bl[i]) blocks++;
          bl[i] = c.ai.blockLane !== null;
          if (c.ai.pitPhase === 'none' && !c.finished) {
            allSteps++;
            if (c.ai.onLine) lineSteps++;
            if (curves.at(c.s) !== 0 && r.time > 10) {
              const off = Math.abs(c.d - line.d(c.s, lineUse(c)));
              bendSteps++;
              bendOff += off;
              if (off < near) bendOn++;
            }
          }
          if (c.contactStrength > 0 && !touch[i]) contacts++;
          touch[i] = c.contactStrength > 0;
          if (c.wallImpact > 0 && !wall[i]) walls++;
          wall[i] = c.wallImpact > 0;
        });
      }
      finished += r.cars.filter((c) => c.finished).length;
      if (process.env.CR_SEEDLOG)
        lines.push(
          `  seed ${seed}: spins ${carSpins.reduce((a, b) => a + b, 0)} ${r.cars
            .filter((_, i) => carSpins[i]! > 0)
            .map((c) => `${c.id}:${c.ai.persona.kind}`)
            .join(' ')}`,
        );
      time += r.time;
      const order = r.standings();
      r.cars.forEach((c, i) => {
        const kind = (c.ai as unknown as { persona?: { kind: string } }).persona?.kind ?? 'all';
        const k = byKind.get(kind) ?? { spins: 0, cars: 0, pos: 0 };
        k.spins += carSpins[i]!;
        k.cars++;
        k.pos += order.indexOf(c) + 1;
        byKind.set(kind, k);
      });
    }
    const kinds = [...byKind.entries()].map(([k, v]) => `${k} ${v.cars} cars ${v.spins} spins P${(v.pos / v.cars).toFixed(1)}`).join(' | ');
    lines.push(
      `${id.padEnd(8)} spins ${String(spins).padStart(3)} contacts ${String(contacts).padStart(4)} walls ${String(walls).padStart(4)} line ${((100 * lineSteps) / allSteps).toFixed(0)}% corner ${((100 * bendOn) / bendSteps).toFixed(0)}% off ${(bendOff / bendSteps).toFixed(1)} slides ${slides} blocks ${blocks}  finished ${finished}/${seeds * 20}  avg time ${(time / seeds).toFixed(1)} s  ${kinds}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}, 600_000);
