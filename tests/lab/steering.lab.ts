import { it } from 'vitest';
import { applySet, bestEntry } from '../sim/lab';
import {
  aiGap,
  bestTapper,
  catchSteps,
  ovalEntry,
  ovalKeyLap,
  tapAngle,
  tapOverdrive,
  tapperScore,
  tapping,
  toStop,
} from '../sim/steerLab';

// The steering lab's command line (project `lab`): the numbers that judge the player's key steering.
//   npx vitest run --project lab tests/lab/steering.lab.ts                     every section
//   STEER_LAB="taps tapper" npx vitest run --project lab tests/lab/steering.lab.ts   some sections
//   sections: taps (input probes), tapper (the skilled key player on six corners; grid: its best of 24 habits),
//     oval (key laps, turn 1 entered too fast), corners (AI - human, test 5)
//   LAB_SET="STEER_IN_S=0.1" overrides CONFIG numbers for the run, as in the corner lab.

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

const n = (x: number, p = 2) => (x === Infinity ? 'inf' : x.toFixed(p));

function taps(): string[] {
  const out: string[] = ['== taps (140 mph unless stated)'];
  for (const arc of [0.5, 0.65]) {
    const sway = [
      [12, 12],
      [10, 10],
      [6, 6],
    ].map(([on, off]) => n(tapping(140, on!, off!, arc).sway, 1));
    out.push(`weave on an arc at ${arc} of the grip, heading sway deg at 2.5 / 3 / 5 Hz: ${sway.join(' / ')}`);
  }
  for (const arc of [0, 0.6]) {
    const use = [
      [12, 12],
      [8, 8],
      [5, 5],
      [4, 4],
    ].map(([on, off]) => tapping(140, on!, off!, arc).use);
    const where = arc === 0 ? 'straight' : `arc ${arc}`;
    out.push(
      `50 % duty, grip used at 2.5 / 3.75 / 6 / 7.5 Hz (${where}): ${use.map((u) => n(u)).join(' / ')}  spread ${n(Math.max(...use) - Math.min(...use))}`,
    );
    const duty = [
      [2, 10],
      [6, 6],
      [10, 2],
    ].map(([on, off]) => n(tapping(140, on!, off!, arc).use));
    out.push(`duty 17 / 50 / 83 % at 5 Hz, grip used (${where}): ${duty.join(' / ')}`);
  }
  for (const mph of [140, 180])
    out.push(
      `tap of 1 / 2 / 3 / 4 steps at ${mph} mph, heading after 1.5 s (deg): ${[1, 2, 3, 4].map((k) => n(tapAngle(mph, k))).join(' / ')}`,
    );
  out.push(
    `to 98 % of the cap (ms), straight / turn 1: 100 mph ${n(toStop(100, false), 0)} / ${n(toStop(100, true), 0)}, 140 mph ${n(toStop(140, false), 0)} / ${n(toStop(140, true), 0)}`,
  );
  out.push(`countersteer to 98 % of the cap in turn 1 (steps): 140 mph ${catchSteps(140)}, 170 mph ${catchSteps(170)}`);
  for (const f of [1.15, 1.25]) {
    const od = [
      [60, 0],
      [4, 4],
      [6, 6],
      [3, 3],
    ].map(([on, off]) => n(tapOverdrive(f, on!, off!)));
    out.push(`overdrive into turn 1 at ${f} x the limit, hold / 4-4 / 6-6 / 3-3 steps: ${od.join(' / ')}`);
  }
  return out;
}

function tapper(grid: boolean): string[] {
  const fmt = (s: ReturnType<typeof tapperScore>) =>
    `bad ${s.bad}/18  rms ${n(s.rms, 1)} px  jitter ${n(s.jitter, 3)} rad/s  key changes ${n(s.keyChg, 1)}/s  clean time ${n(s.t)} s`;
  const out = ['== tapper (6 corners x 0.85 / 0.95 / 1.0 of the limit)', `default habits: ${fmt(tapperScore())}`];
  if (grid) {
    const b = bestTapper();
    out.push(`best of 24 habits: ${fmt(b.score)}  (ANT ${b.habits.ANT} W ${b.habits.W} TH ${b.habits.TH} DWELL ${b.habits.DWELL})`);
  }
  return out;
}

function oval(): string[] {
  const out = ['== oval (human key driver)'];
  const lanes = [-28.5, -9.5, 9.5, 28.5].map(ovalKeyLap);
  out.push(
    `best key laps per lane: ${lanes.map((l) => n(l)).join(' / ')}  mean ${n(lanes.reduce((a, b) => a + b, 0) / lanes.length, 3)} s`,
  );
  for (const d of [-9.5, 0]) {
    const base = ovalEntry(d, 1, {}, 1600);
    const rows = [1.05, 1.1, 1.15].map((f) => {
      const r = ovalEntry(d, f, {}, 1600);
      return `${f}: ${r.spun ? 'SPIN' : `${r.time - base.time >= 0 ? '+' : ''}${n(r.time - base.time)}`}`;
    });
    out.push(`turn 1 to the end of the top straight, lane ${d}, cost against the limit: ${rows.join('  ')}`);
  }
  return out;
}

function corners(): string[] {
  const g = aiGap();
  const h140 = bestEntry({ r: 140, deg: 180, driver: 'human' });
  const h60 = bestEntry({ r: 60, deg: 180, driver: 'human' });
  return [
    '== corners',
    `AI - human: worst ${n(g.worst, 3)} s, AI runs with a wall or spin ${g.dirty}`,
    `test 5: R 140/180 best entry ${n(h140.vBest, 1)} mph (line limit ${n(h140.vLimit, 1)}), +10 % ${h140.over?.spun ? 'spins' : 'no spin'}; R 60/180 +10 % ${h60.over?.spun ? 'spins' : 'no spin'}`,
  ];
}

it('steering lab', () => {
  applySet(process.env.LAB_SET ?? '');
  const want = (process.env.STEER_LAB ?? 'taps tapper oval corners').split(/\s+/);
  const out: string[] = [];
  if (want.includes('taps')) out.push(...taps());
  if (want.includes('tapper')) out.push(...tapper(want.includes('grid')));
  if (want.includes('oval')) out.push(...oval());
  if (want.includes('corners')) out.push(...corners());
  const set = process.env.LAB_SET ? `  LAB_SET ${process.env.LAB_SET}` : '';
  process.stdout.write(`steering lab${set}\n${out.join('\n')}\n`);
}, 600_000);
