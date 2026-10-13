/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

// Oval geometry constants must not leak into code shared by every track, or new tracks would
// silently use the oval's numbers.
const OVAL_ONLY = ['../src/track/oval.ts', '../src/track/ovalPit.ts', '../src/track/ovalTrack.ts', '../src/gfx/track/oval/'];

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
});
