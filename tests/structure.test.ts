/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

// Oval geometry constants must not leak into code shared by every track, or new tracks would
// silently use the oval's numbers. In the cockpit view (gfx/fpv) only the oval's scene adapter reads them.
const OVAL_ONLY = [
  '../src/track/oval.ts',
  '../src/track/ovalPit.ts',
  '../src/track/ovalTrack.ts',
  '../src/gfx/track/oval/',
  '../src/gfx/fpv/oval.ts',
];

describe('module structure', () => {
  it('finds the sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
  });

  it('only the oval itself and its renderer import the oval geometry', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !OVAL_ONLY.some((ok) => path.startsWith(ok)))
      .filter(([path, code]) => importsOf(path, code).includes('../src/track/oval.ts'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  // The simulation (race, track, sim, config) is the deterministic core the golden masters pin. It
  // never reaches into the presentation, so a change only in gfx / ui / audio / states cannot change
  // how a race runs (npm test is enough there; see CLAUDE.md).
  const SIM = ['../src/race/', '../src/track/', '../src/sim/', '../src/config.ts'];
  const inSim = (path: string) => SIM.some((p) => path.startsWith(p));
  /** '../src/race/ai.ts' + '../track/common' → '../src/track/common.ts' */
  const resolve = (from: string, rel: string) => {
    const parts = from.split('/').slice(0, -1);
    for (const p of rel.split('/')) {
      if (p === '..') parts.pop();
      else if (p !== '.') parts.push(p);
    }
    return `${parts.join('/')}.ts`;
  };
  const importsOf = (path: string, code: string) => [...code.matchAll(/from '(\.{1,2}\/[^']+)'/g)].map((m) => resolve(path, m[1]!));

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

  // Every speed the player reads is in km/h, converted at the edge by src/units.ts; the simulation stays in
  // mph. A screen that printed a raw Car.speed, or a dial captioned MPH, would show the wrong unit.
  const SCREEN = ['../src/ui/', '../src/gfx/', '../src/states/'];

  it('the screens show no mph: speeds reach them through src/units.ts', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => SCREEN.some((p) => path.startsWith(p)))
      .flatMap(([path, code]) => [...code.matchAll(/'MPH'|"MPH"|\d\s?mph\b/gi)].map((m) => `${path}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  it('the conversion factors live only in src/units.ts', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => path !== '../src/units.ts')
      .flatMap(([path, code]) => [...code.matchAll(/1\.609|0\.447|0\.263/g)].map((m) => `${path}: ${m[0]}`));
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
