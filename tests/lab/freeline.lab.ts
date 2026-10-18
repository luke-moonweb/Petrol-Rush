import { test } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/config';
import { lineUse } from '../../src/race/planner';
import { Race } from '../../src/race/race';
import { racingLine } from '../../src/track/racingLine';
import { getTrack } from '../../src/track/tracks';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// TEMP diagnosis: every FL_EVERY s, the slow cars (under 40 mph) of one race and their AI state.
test('free line diagnosis', () => {
  const id = process.env.FL_TRACK ?? 'oval';
  const seed = Number(process.env.FL_SEED ?? 4);
  const every = Number(process.env.FL_EVERY ?? 5);
  const track = getTrack(id);
  const line = racingLine(track);
  const out: string[] = [];
  const r = new Race(
    { ...DEFAULT_OPTIONS, difficulty: 'hard', track: id, cars: 20, laps: 5, qualifying: 'middle' } as never,
    seed,
    true,
    undefined,
    track,
  );
  r.start();
  let next = every;
  while (!r.allFinished() && r.time < Number(process.env.FL_UNTIL ?? 120)) {
    r.step(1 / 60, null);
    if (r.time < next) continue;
    next += every;
    const slow = r.cars.filter((c) => (process.env.FL_ALL ? track.curves().at(c.s) !== 0 : c.speed < 40) && !c.finished);
    out.push(`t ${r.time.toFixed(0)} slow ${slow.length}`);
    for (const c of slow.slice(0, 8))
      out.push(
        `  #${c.id} s ${c.s.toFixed(0)} d ${c.d.toFixed(0)} line ${line.d(c.s, lineUse(c)).toFixed(0)} v ${c.speed.toFixed(0)} rev ${c.reverse ? 1 : 0} on ${c.ai.onLine ? 1 : 0} sh ${c.ai.freeShift.toFixed(0)} lane ${c.ai.lane} pit ${c.ai.pitPhase} haz ${c.ai.hazardTime.toFixed(1)} rec ${c.ai.recoverTime.toFixed(1)} creep ${c.ai.creepTime.toFixed(1)} spin ${c.spinTime.toFixed(1)}`,
      );
  }
  process.stdout.write(`${out.join('\n')}\n`);
}, 600_000);
