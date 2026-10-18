import { it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/config';
import { Race } from '../../src/race/race';
import { getTrack } from '../../src/track/tracks';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// The first contact or spin in a race, with the cars near it over the 1.5 s before (not a test).
// Run: IN_TRACK=oval IN_SEED=6 CR_OPTS='{"difficulty":"hard"}' npx vitest run --project lab tests/lab/incident.lab.ts
it('incident', () => {
  const id = process.env.IN_TRACK ?? 'oval';
  const seed = Number(process.env.IN_SEED ?? 6);
  const r = new Race(
    { ...DEFAULT_OPTIONS, ...JSON.parse(process.env.CR_OPTS ?? '{}'), ...(process.env.IN_LEVEL ? { difficulty: process.env.IN_LEVEL } : {}), track: id, cars: 20, laps: 5, qualifying: 'middle' },
    seed,
    true,
    undefined,
    getTrack(id),
  );
  r.start();
  const hist: string[][] = [];
  let out = '';
  while (!r.allFinished() && r.time < 500) {
    r.step(1 / 60, null);
    const hit = r.cars.find((c) => c.contactStrength > 0 || c.spinTime > 0);
    const row = r.cars.map(
      (c) =>
        `t ${r.time.toFixed(2)} #${c.id} ${c.ai.persona.kind.padEnd(10)} s ${c.s.toFixed(0).padStart(5)} d ${c.d.toFixed(1).padStart(6)} v ${c.speed.toFixed(0)} lane ${c.ai.lane} line ${c.ai.onLine ? 1 : 0} sh ${c.ai.freeShift.toFixed(0)} pass ${c.ai.passId} blk ${c.ai.blockLane ?? '-'} sl ${c.ai.slide} ${c.braking ? 'B' : ''}${c.contactStrength > 0 ? ' HIT' : ''}`,
    );
    hist.push(row);
    if (hist.length > 90) hist.shift();
    if (hit) {
      const near = r.cars.filter((c) => Math.abs(r.track.deltaS(hit.s, c.s)) < 150).map((c) => c.id);
      out = hist
        .filter((_, i) => i % 10 === 0 || i === hist.length - 1)
        .map((rows) => near.map((n) => rows[n]).join('\n'))
        .join('\n--\n');
      break;
    }
  }
  process.stdout.write(`${out}\n`);
});
