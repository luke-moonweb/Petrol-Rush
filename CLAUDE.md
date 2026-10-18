# Petrol Rush: notes for agents

Top-down 2D racing game in TypeScript with Canvas 2D and Web Audio. There are no asset files and no
runtime dependencies. The README has the module map (section "How it's built") and all URL
parameters. This file covers only what saves time when making changes.

## Commands (all fast unless marked)

| Command | Time | When |
|---|---|---|
| `npx vitest run tests/<file>.test.ts` | 0.1–2 s | while iterating: run only the tests for the area you change |
| `npm test` | ~5 s | after a change: the fast tier, which skips the full-race simulations |
| `npx tsc --noEmit` / `npx biome check --write .` | ~2 s each | before committing |
| `npm run test:all` | ~35–45 s | **once**, before a commit that touches `src/race`, `src/track` or the AI; CI runs it too |

- The slow tier (`vite.config.ts` → `SLOW`): `gripGate` (40 seeds, ~33 s in a single test), `gripRace`, `gp-races`, `grandprix`.
- Don't loop full-suite runs to "check determinism": the simulation is deterministic per seed.
- `vitest related` doesn't help much here, because nearly every test imports `Race` and so pulls in the slow tier.
- The golden masters (`golden.test.ts`, `oval-golden.test.ts`) pin the **classic** model bit for bit.
  - They swap in a JS fdlibm (`tests/sim/fdlibm.ts`), so they pass on macOS arm64 too.
  - If a golden test fails, the classic driving behaviour really changed. Don't re-record it unless the change is intended.

## Where things are (most-edited files)

- `src/config.ts`: every tuning constant, plus `CONFIG.DRIVE_MODEL` (`grip` is the default, `classic` is the old model).
- `src/race/physics.ts`: `stepCar` and the grip/classic models. `collideCars` sits at the end of the file.
- `src/race/race.ts`: the `Race` class, which handles the step, laps, pit stops, penalties and classification.
- `src/race/ai.ts`: `aiInput`. The pit-lane AI is in `src/track/pitAi.ts`.
- `src/states/race/state.ts`: the race screen.
  - Phases, start lights, the menu, and the camera toggle (KeyC).
  - `render()` picks the top-down or the cockpit view.
- `src/gfx/fpv/*`: the cockpit view, oval only.
  - `view.ts` draws the frame, `cockpit.ts` draws the cabin, and `cabin.ts` holds the readouts.
  - `cars.ts` draws the rival cars; their 3D models are in `src/gfx/carFpv.ts`.
- `src/ui/hud.ts`, `src/ui/overlays.ts`: the HUD, the timing tower and the result screens.
- Tracks:
  - `src/track/oval*.ts` is the oval: analytic geometry plus its pit.
  - `src/track/segment.ts` and `src/track/gp.ts` are the Grand Prix circuits.
  - Only oval code may import oval geometry (`tests/structure.test.ts` checks this).
- Test helpers: `tests/sim/harness.ts` (`runRace`, headless races) and `tests/sim/drivers.ts` (test drivers).
- `docs/grip-model/*` and `CABIN_QUALITY.md` are a **historical** record of finished work. Don't read them unless the task is about that history.

## Checking in the browser

- Start the dev server with `preview_start {name: "vite"}` (port 5173).
- Use `?quick&debug&seed=1` (optionally add `&track=harbour&laps=3`).
- **Never wait in real time.** With the browser pane hidden, `requestAnimationFrame` does not fire and the game stands still.
  - Instead, call `__ff(30)` in `javascript_tool`. It simulates 30 s of game time in about 0.25 s and draws the frame.
  - Then take a screenshot, or read the state from `window.__race` (`__race.race.cars`, `__race.race.time`).
- The game pauses when the window loses focus. That doesn't stop `__ff`, but the screenshot shows the PAUSED overlay.
- Check numbers (lap times, positions, spins) in headless tests (`tests/sim/harness.ts`), not in the browser. Use the browser for a final screenshot of a visual change.

## Git and deploy

- Every push to `main` deploys the live game to GitHub Pages.
  - Work on a branch and commit locally.
  - Ask before pushing or merging to `main`.
- Commit messages are plain English sentences (see `git log`).

## Way of working (keeps changes quick)

- For a small or medium change, the main agent does it directly: no spec, critic, designer or tester subagents.
- For a large feature: at most **one** combined review agent and **one** review round.
  - Fix what it finds, then stop.
  - Don't loop "until the reviewers have no remarks".
- Ask any questions together, up front. Otherwise go ahead with a stated default.
- Start a new session per feature. Long sessions cost compactions and re-reading.
