/// <reference types="vite/client" />
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

// Oval geometry constants must not leak into code shared by every track, or new tracks would
// silently use the oval's numbers. The cockpit view (gfx/fpv) is an oval renderer too: the race state
// only offers it on the oval.
const OVAL_ONLY = [
  '../src/track/oval.ts',
  '../src/track/ovalPit.ts',
  '../src/track/ovalTrack.ts',
  '../src/gfx/track/oval/',
  '../src/gfx/fpv/',
];

describe('module structure', () => {
  it('finds the sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
  });

  it('only the oval itself and its renderer import the oval geometry', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !OVAL_ONLY.some((ok) => path.startsWith(ok)))
      .filter(([, code]) => /from '(\.\.?\/)+(track\/)?oval'/.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  // The simulation (race, track, sim, config) is the deterministic core the golden masters pin. It
  // never reaches into the presentation, so a change only in gfx / ui / audio / states cannot change
  // how a race runs (npm test is enough there; see CLAUDE.md).
  const SIM = ['../src/race/', '../src/track/', '../src/sim/', '../src/config.ts'];
  const inSim = (path: string) => SIM.some((p) => path.startsWith(p));
  const importsOf = (path: string, code: string) =>
    [...code.matchAll(/from '(\.{1,2}\/[^']+)'/g)].map((m) => `${posix.join(posix.dirname(path), m[1]!)}.ts`);

  it('the simulation imports nothing from the presentation', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => inSim(path))
      .flatMap(([path, code]) =>
        importsOf(path, code)
          .filter((dep) => !inSim(dep))
          .map((dep) => `${path} -> ${dep}`),
      );
    expect(offenders).toEqual([]);
  });

  it('the simulation has no randomness, clock or DOM of its own (only the seeded RNG; saving a Grand Prix may use localStorage)', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => inSim(path))
      .flatMap(([path, code]) =>
        [...code.matchAll(/Math\.random|Date\.now|new Date|performance\.now|\bdocument\.|\bwindow\./g)].map((m) => `${path}: ${m[0]}`),
      );
    expect(offenders).toEqual([]);
  });

  it('only the screens (states) and main import the screens', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.startsWith('../src/states/') && path !== '../src/main.ts')
      .flatMap(([path, code]) =>
        importsOf(path, code)
          .filter((dep) => dep.startsWith('../src/states/'))
          .map((dep) => `${path} -> ${dep}`),
      );
    expect(offenders).toEqual([]);
  });
});
