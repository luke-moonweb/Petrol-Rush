import { it } from 'vitest';
import { CONFIG } from '../../src/config';
import {
  bestEntry,
  type CornerBest,
  type CornerSpec,
  formatBest,
  formatRuns,
  formatTrace,
  type LabDriver,
  type LabMode,
  runCorner,
  type TraceRow,
} from '../sim/lab';

// The corner lab's command line (project `lab`: not part of npm test or test:all).
//   npm run lab                                         the corner map (R x angle, drivers line and human)
//   LAB="r=140 deg=90" npm run lab                      best entry for one corner (lists: r=120,140; ranges: deg=45:180:45)
//   LAB="r=140 deg=90 v=150:180:5 driver=human" npm run lab     one run per start speed (mode hold by default)
//   keys: r deg dir=left|right use=0..1 driver=line|human insist=1 react=s mode=flat|brake|hold v vc
//   trace=1 with one corner and one v / vc: the run step by step (every 0.1 s and every wall contact)
//   LAB_SET="GRIP.TOP=80 GRIP.KNEE_MPH=135" npm run lab  override CONFIG numbers for this run (tuning without edits)

// (the project has no Node types; this is all the lab uses)
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

function applySet(src: string): void {
  for (const tok of src.split(/\s+/).filter(Boolean)) {
    const [path, val] = tok.split('=');
    const keys = path!.split('.');
    let obj = CONFIG as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
    const last = keys[keys.length - 1]!;
    if (typeof obj?.[last] !== 'number') throw new Error(`LAB_SET: ${path} is not a number in CONFIG`);
    obj[last] = Number(val);
  }
}

function parse(src: string): Record<string, string> {
  return Object.fromEntries(
    src
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.split('=') as [string, string]),
  );
}

/** "a,b,c" or "from:to:step" (inclusive). */
function nums(s: string | undefined, def: number[]): number[] {
  if (!s) return def;
  if (s.includes(':')) {
    const [a, b, st] = s.split(':').map(Number) as [number, number, number];
    const out: number[] = [];
    for (let v = a; v <= b + 1e-9; v += st || 1) out.push(v);
    return out;
  }
  return s.split(',').map(Number);
}

it('corner lab', () => {
  applySet(process.env.LAB_SET ?? '');
  const o = parse(process.env.LAB ?? '');
  const base = {
    dir: (o.dir ?? 'left') as 'left' | 'right',
    use: o.use !== undefined ? Number(o.use) : undefined,
    insist: o.insist === '1',
    react: o.react !== undefined ? Number(o.react) : undefined,
  };
  const drivers = (o.driver ? o.driver.split(',') : ['line', 'human']) as LabDriver[];
  const out: string[] = [];
  const bests: CornerBest[] = [];
  const traced = (spec: CornerSpec) => {
    const rows: TraceRow[] = [];
    runCorner(spec, (row) => rows.push(row));
    out.push(formatTrace(rows));
  };
  for (const r of nums(o.r, [60, 100, 140, 200])) {
    for (const deg of nums(o.deg, [45, 90, 135, 180])) {
      for (const driver of drivers) {
        const spec: CornerSpec = { ...base, r, deg, driver };
        if (o.v !== undefined && o.mode !== 'brake') {
          const speeds = nums(o.v, []);
          const runs = speeds.map((v) => runCorner({ ...spec, mode: (o.mode ?? 'hold') as LabMode, v }));
          if (o.trace === '1') traced({ ...spec, mode: (o.mode ?? 'hold') as LabMode, v: speeds[0] });
          out.push(formatRuns({ ...spec, mode: (o.mode ?? 'hold') as LabMode }, speeds, runs));
        } else if (o.vc !== undefined) {
          const speeds = nums(o.vc, []);
          const runs = speeds.map((vc) => runCorner({ ...spec, mode: 'brake', vc, v: o.v ? Number(o.v) : undefined }));
          if (o.trace === '1') traced({ ...spec, mode: 'brake', vc: speeds[0], v: o.v ? Number(o.v) : undefined });
          out.push(formatRuns({ ...spec, mode: 'brake' }, speeds, runs));
        } else bests.push(bestEntry({ ...spec, v: o.v ? Number(o.v) : undefined }));
      }
    }
  }
  if (bests.length > 0) out.push(formatBest(bests));
  const set = process.env.LAB_SET ? `  LAB_SET ${process.env.LAB_SET}` : '';
  process.stdout.write(`corner lab (GRIP ${CONFIG.GRIP.GRIP}, MAX_MPH ${CONFIG.MAX_MPH})${set}\n${out.join('\n')}\n`);
}, 300_000);
