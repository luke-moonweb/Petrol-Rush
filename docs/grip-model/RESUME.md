# Grip driving model — where we stopped (2026-10-17)

## Goal
Replace the speed-threshold driving model ("in a turn" + a fixed 150 mph limit) with an arcade
grip model where the cornering limit comes from lateral grip and radius, so that more complex
tracks become possible. Applies to all cars and both cameras. The aim is a more interesting feel,
not easier driving.

## State
- Branch `feature/grip-model` (local only, not pushed), based on main `1a2098f`.
  - 9 implementation commits `38968a9`..`945e2dd`, then `50a503a` (this folder).
  - Round-1 fixes (2026-10-17): `03922cf`..`3a58f50`, see below.
- Both models are in the code. Grip is the default; `?drive=classic` gives the old model, which
  is bit-identical to main (golden test).
- `npx tsc --noEmit`, `npx biome ci .` and `npx vitest run` (164 tests) pass.
- main and feature/grand-prix are untouched. Grand Prix is parked for later.

### Round-1 findings, all addressed
- Designer H2 (keys overdrive): `src/race/steering.ts` caps key / touch steering at KEY_CAP 1.05 x
  the grip left after braking. Insisting (key held into a corner the car is >10 % over the grip
  for) opens towards full lock, sooner and further with the excess (OVERDRIVE_*).
- Designer H1 / M3 (braking pointless, spins not graded): SLIP_DRAG 0.35 -> 0.6. With the
  realistic key driver (`human` in `tests/sim/drivers.ts`, 0.18 s reaction) on turn 1: braked
  5.85 / 5.83 s vs flat out 6.47 / 6.27 s (lanes -9.5 / 0); +10 % understeer only, +15 % steps
  out and costs 0.3-0.5 s, an insisting player spins only from ~+15-20 %.
- Projektant A12 + critic co-cause: grip AI gives way at the pit exit (brake-room merge check,
  queueing on the exit road), racing cars count merging / pit-bound cars on the line they move
  to, the pit approach waits for the inside lane (skips the stop for a lap if still held out at
  turn 2), diving cars no longer swerve for oil. 10 seeds: 15 spins (classic 496), 1 near the pit
  exit (6.7 %, classic 11.9 %), worst seed +6.4 %, mean 339.4 s (classic 354.6).
- Critic: SKID blink phase (WarnDisplay), SKID steady in a spin on the HUD, LEDs red from 95 %
  and reading the grip use of the car's line (not the key demand), speed bar and arc share one
  eased limit, paused fallback band, pit-lane red arc, wall kick direction, dt = 0, solo pace test
  (grip 16.40 vs classic 16.03 s), weak assertions fixed.
- Designer M4 (settings text) and L5 (STRAIGHT_OFF_DEG 14 -> 20) done.
- Key-driver laps (best per lane, mean of 4 lanes): grip 16.26 s vs classic 16.13 s (+0.8 %).

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
   - Re-create `tmp-harness.html`: an iframe page loading `/?<q>` at `w`x`h`.
2. Review round 2 (designer, projektant, critic, tester) on the round-1 fixes. Things to look at:
   - feel of the key cap and the overdrive in a real playtest (keyboard and touch, both cameras);
   - SKID lights in ~10-15 % of corner time at the limit from lift-off tuck-in slip (> 4.6 deg);
   - the AI field is now much calmer than classic (15 vs 496 spins over 10 seeds);
   - a 400 ms press at 180 mph on a straight still reaches the wall and spins (as before the
     fixes; designer target 8 says it should not reach the wall).
   Repeat until all four say "VERDICT: NO REMAINING ISSUES".
3. Let the user playtest grip against classic. After sign-off, delete the classic model and its
   constants, then merge to main. Ask before pushing: a push to main deploys GitHub Pages.
4. Later, when Grand Prix comes back:
   - implement `curvatureAt` for its segment tracks;
   - `ai.ts`, `warnings.ts` call the oval-only `trackCurves()` directly and must take the track's
     own table (`PlayerSteering` already takes a `SteerTrack`); the pit merge / pit approach logic
     in `ai.ts` is oval-specific;
   - drop that branch's `R_MIN` and its "150 on the inside lane" assumptions;
   - re-record the oval golden master.

## Defaults chosen without the user (they can override them)
- Collisions keep speed-threshold spins, with "loaded" (grip use ≥ 0.7) replacing "in a turn".
- Oil stays an instant spin.
- No AI racing line yet.
- A calmer AI field (fewer spins) is accepted.
