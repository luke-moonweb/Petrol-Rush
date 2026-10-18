import { defineConfig } from 'vitest/config';

// Headless full-race simulations take ~30 s together; `npm test` skips them (~5 s) and
// `npm run test:all` (also run by CI and the deploy) includes them.
const SLOW = ['tests/gripGate.test.ts', 'tests/gripRace.test.ts', 'tests/gp-races.test.ts', 'tests/grandprix.test.ts'];

export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'fast', include: ['tests/**/*.test.ts'], exclude: SLOW } },
      { extends: true, test: { name: 'slow', include: SLOW } },
    ],
  },
});
