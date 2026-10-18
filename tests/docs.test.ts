/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// The CLAUDE.md files are the agents' map of the code. They travel with it: a file added to an area
// must be named in that area's CLAUDE.md, and a path a CLAUDE.md names must still exist.

/** Vite keys are relative to this file: '../src/x.ts' or './sim/x.ts' → repo paths 'src/x.ts', 'tests/sim/x.ts'. */
const repoPath = (key: string) => (key.startsWith('./') ? `tests/${key.slice(2)}` : key.slice(3));
const DOCS = import.meta.glob<string>(['../CLAUDE.md', '../src/**/CLAUDE.md'], { query: '?raw', import: 'default', eager: true });
// (import.meta.glob leaves out the importing file itself)
const FILES = [...Object.keys(import.meta.glob(['../src/**/*.ts', './**/*.ts'])), ...Object.keys(DOCS), './docs.test.ts'].map(repoPath);

/** An area CLAUDE.md covers the files of its own directory, plus these. */
const ALSO_COVERS: Record<string, string[]> = {
  'src/race/CLAUDE.md': ['src/track/', 'src/sim/'],
};

const globRe = (glob: string) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
const named = (doc: string) => [...doc.matchAll(/`([^`\s<>]+)`/g)].map((m) => m[1]!);

describe('CLAUDE.md files', () => {
  const docs = Object.entries(DOCS).map(([path, text]) => ({ path: repoPath(path), text }));

  it('finds the root and the area docs', () => {
    expect(docs.map((d) => d.path)).toContain('CLAUDE.md');
    expect(docs.length).toBeGreaterThan(1);
  });

  it('every file of an area is named in its CLAUDE.md', () => {
    const missing: string[] = [];
    for (const doc of docs) {
      if (doc.path === 'CLAUDE.md') continue;
      const dirs = [doc.path.replace(/CLAUDE\.md$/, ''), ...(ALSO_COVERS[doc.path] ?? [])];
      const globs = named(doc.text)
        .filter((n) => n.includes('*'))
        .map((n) => globRe(n.split('/').pop()!));
      for (const file of FILES.filter((f) => f.endsWith('.ts'))) {
        const dir = dirs.find((d) => file.startsWith(d) && !file.slice(d.length).includes('/'));
        if (!dir) continue;
        const base = file.slice(dir.length);
        if (!doc.text.includes(base) && !globs.some((g) => g.test(base))) missing.push(`${doc.path}: ${file}`);
      }
    }
    expect(missing, 'name the file in its area CLAUDE.md (what it is for, one line)').toEqual([]);
  });

  it('every src/ or tests/ path a CLAUDE.md names exists', () => {
    const stale: string[] = [];
    for (const doc of docs) {
      for (const n of named(doc.text)) {
        if (!/^(src|tests)\//.test(n)) continue;
        const ok = n.includes('*')
          ? FILES.some((f) => globRe(n).test(f) || f.startsWith(n.replace(/\*.*$/, '')))
          : FILES.includes(n) || FILES.some((f) => f.startsWith(n.endsWith('/') ? n : `${n}/`));
        if (!ok) stale.push(`${doc.path}: ${n}`);
      }
    }
    expect(stale, 'fix or remove the path in the CLAUDE.md').toEqual([]);
  });
});
