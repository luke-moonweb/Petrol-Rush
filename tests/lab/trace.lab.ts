import { test } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/config';
import { Race } from '../../src/race/race';
import { getTrack } from '../../src/track/tracks';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

// TEMP ablation: spins / contacts / walls / time per flag set (AB_SETS: sets split by ';', flags by ',').
test('ablation', () => {
  const id = process.env.AB_TRACK ?? 'oval';
  const seeds = Number(process.env.AB_SEEDS ?? 8);
  const out: string[] = [];
  for (const set of (process.env.AB_SETS ?? 'none').split(';')) {
    const F: Record<string, boolean> = {};
    for (const f of set.split(',')) F[f] = true;
    (globalThis as unknown as { FLF: typeof F }).FLF = F;
    let spins = 0;
    let contacts = 0;
    let walls = 0;
    let time = 0;
    const per: number[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = new Race({ ...DEFAULT_OPTIONS, difficulty: 'hard', track: id, cars: 20, laps: 5, qualifying: 'middle' } as never, seed, true, undefined, getTrack(id));
      r.start();
      const was = r.cars.map(() => false);
      const touch = r.cars.map(() => false);
      const wall = r.cars.map(() => false);
      let sp = 0;
      while (!r.allFinished() && r.time < 5 * 90 + 60) {
        r.step(1 / 60, null);
        r.cars.forEach((c, i) => {
          if (c.spinTime > 0 && !was[i]) sp++;
          was[i] = c.spinTime > 0;
          if (c.contactStrength > 0 && !touch[i]) contacts++;
          touch[i] = c.contactStrength > 0;
          if (c.wallImpact > 0 && !wall[i]) walls++;
          wall[i] = c.wallImpact > 0;
        });
      }
      spins += sp;
      per.push(sp);
      time += r.time;
    }
    out.push(`${id} ${set.padEnd(30)} spins ${spins} [${per.join(' ')}] contacts ${contacts} walls ${walls} time ${(time / seeds).toFixed(1)}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}, 1_200_000);
