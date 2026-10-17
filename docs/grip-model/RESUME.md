# Grip driving model — where we stopped (2026-10-17)

## Goal
Replace the speed-threshold driving model ("in a turn" + a fixed 150 mph limit) with an arcade
grip model where the cornering limit comes from lateral grip and radius, so that more complex
tracks become possible. Applies to all cars and both cameras. The aim is a more interesting feel,
not easier driving.

## State
- Branch `feature/grip-model` (local only, not pushed), based on main `1a2098f`.
  - 9 implementation commits: `38968a9`..`945e2dd`.
  - One more commit that adds this `docs/grip-model/` folder.
- Both models are in the code. Grip is the default; `?drive=classic` gives the old model, which
  is bit-identical to main (golden test).
- `npx tsc --noEmit`, `npx biome ci .` and `npx vitest run` (142 tests) all passed at `945e2dd`.
- main and feature/grand-prix are untouched. Grand Prix is parked for later.

## Documents (this folder)
- `spec.md` — the projektant's spec, with prototype measurements.
- `decisions.md` — the user's decisions, which override the spec. Summary:
  - GRIP 500;
  - graded consequences;
  - LEDs = grip use, SKID = slip only, speed bar and red arc = next corner's limit;
  - a classic/grip switch while testing.
- `designer-baseline.md` — feel targets measured on the old model.
- `critic-inventory.md` — every coupling, invariant and test list in the old code.
- `review-r1/` — review round 1 of `945e2dd`: designer, projektant, critic. All say ISSUES FOUND.
  The tester was stopped before reporting.

## Next steps, in order
1. Re-create the worktree if `/private/tmp` was cleaned:
   - `git worktree prune`
   - `git worktree add <scratchpad>/wt-grip feature/grip-model`
   - Symlink `node_modules` to the main checkout's.
   - Re-create `tmp-harness.html`: an iframe page loading `/?<q>` at `w`×`h`.
2. Send all round-1 findings to an implementer in one go. Highest priority first:
   - **Designer H2: digital steering overdrives the tyres.**
     - A held key asks for 1.5× grip, so key and touch corners run at ~135 mph against a ~160 mph
       limit. Laps are ~4% slower and the LEDs show red in every corner.
     - Fix: cap the player's key and touch steering like the AI's (~1.0–1.1× of the grip left).
       Going over the limit should need a deliberate extra input.
   - **Designer H1: braking is pointless.**
     - A flat-out entry at 180 laps the same as a braked entry, and a caught slide costs ~0 s.
     - Make excess speed cost more than braking would: a wider line, more scrub, wall risk.
     - Add a realistic key driver to the tests (hold while the heading error is above a
       threshold, with a reaction delay). Assert that a braked entry beats a flat-out one.
   - **Projektant: pit-exit / turn-1 pile-ups.** 44% of AI spins happen there, against 8% in
     classic. Seed 5 is +16.9% slower. Fix the merge (`mergeClear`) and the follow/hazard
     speed-difference logic.
   - **Critic (likely a co-cause):** the AI cuts to the pit lane before turn 2 at full speed
     with no `laneFree` check (`ai.ts:100,130`).
   - **Critic:** the SKID blink jumps phase, so it flickers. Use a phase accumulator.
   - **Critic:** the wall kick turns a sliding car's nose into the wall.
   - **Critic:** red LEDs start at 101% instead of 95%.
   - **Critic:** during a spin the HUD SKID is off while the cockpit SKID is on.
   - **Critic:** the red arc is wrong in the pit lane.
   - **Critic:** `dt = 0` produces NaN.
   - **Designer M3:** uncaught spins are not graded by how far over the limit the car was.
   - **Designer M4:** the speed-bar text "red – spins" is no longer true.
   - **Tests:**
     - more seeds, and assert spin counts;
     - a solo pace test;
     - assert zero pit-phase spins;
     - fix the weak assertions the critic listed.
3. Run review rounds (designer, projektant, critic, tester) until all four say
   "VERDICT: NO REMAINING ISSUES".
4. Let the user playtest grip against classic. After sign-off, delete the classic model and its
   constants, then merge to main. Ask before pushing: a push to main deploys GitHub Pages.
5. Later, when Grand Prix comes back:
   - implement `curvatureAt` for its segment tracks;
   - `ai.ts`, `steering.ts` and `warnings.ts` call the oval-only `trackCurves()` directly and
     must take the track's own table instead;
   - drop that branch's `R_MIN` and its "150 on the inside lane" assumptions;
   - re-record the oval golden master.

## Defaults chosen without the user (they can override them)
- Collisions keep speed-threshold spins, with "loaded" (grip use ≥ 0.7) replacing "in a turn".
- Oil stays an instant spin.
- No AI racing line yet.
- A calmer AI field (fewer spins) is accepted.
