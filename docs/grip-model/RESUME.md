# Grip driving model — where we stopped (2026-10-17)

## Goal
Replace the speed-threshold driving model ("in a turn" + a fixed 150 mph limit) with an arcade
grip model where the cornering limit comes from lateral grip and radius, so that more complex
tracks become possible. Applies to all cars and both cameras. The aim is a more interesting feel,
not easier driving.

## State
- Branch `feature/grip-model` (local only, not pushed), based on main `1a2098f`.
  - 9 implementation commits `38968a9`..`945e2dd`, then `50a503a` (this folder).
  - Round-1 fixes: `03922cf`..`1ed31c9`. Round-2 notes `2e040bb`, round-2 fixes `5d4eb24`..`8d2d37c`.
- Both models are in the code. Grip is the default; `?drive=classic` gives the old model, which
  is bit-identical to main (golden test), display included (classic SKID blink and LED strip).
- `npx tsc --noEmit`, `npx biome ci .` and `npx vitest run` (165 tests) pass; the suite passed 3
  runs in a row (full-race tests now have explicit timeouts).
- main and feature/grand-prix are untouched. Grand Prix is parked for later.

### Round 1 (all addressed, see commits)
Key / touch steering cap with graded overdrive, realistic `human` key driver, SLIP_DRAG 0.6, pit
exit / pit approach AI, warnings fixes, wall kick direction, dt = 0, solo pace test, texts, straight
assist fade 20 deg.

### Round 2 (all addressed)
- Pit exit: the leaving car commits to the merge (brake-room check over 450 px; after 2.5 s
  stopped as soon as nobody is alongside; after 4 s in any case); racing cars count it only once
  committed and moving and only when it is clearly ahead, so they never stop for it; the pit-road
  follow only looks at cars leaving the pits; the player under autopilot never yields.
- Fuel: a stop is skipped only with fuel for a lap to the far end of the pit lane + 0.15 lap and
  never twice running; the decision also fires when the fuel would not reach the box from the
  next (earlier) grip decision window.
- Walls: a slow steep hit (above WALL_SPIN_DEG, below the spin speed) stops the car as in classic;
  the 15-30 deg kick rotates the nose at 4 rad/s at most (`car.wallYaw`); a car pinned nose-in at
  rest can creep away along the wall.
- Cockpit LEDs (user decision): start lights, then nearness to top speed only (140-180 mph,
  5 mph per LED). Round-2 item 5 (LEDs read the car) is superseded.
- Insisting: releasing the key only winds the overdrive push down, so pulsing insists too.
- Calm AI field kept (user decision); no AI driver errors added.
- Numbers (40 seeds 100-139): all finish, 0 dry tanks, at most 1 skip per car, pit-exit wait
  p50 0.17 / p95 2.30 / max 5.0 s (classic 0.05 / 2.45 / 17.4), race time 329 / 334 / 362 s.
  Turn 1 plus the following straight, key driver: braked 9.52 / 9.47 s, flat out 10.47 / 10.15 s
  (lanes -9.5 / 0). Wall heading change at most 4 deg per step (was 128). Key laps +0.8 % vs
  classic.

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
2. Review round 3 (designer, projektant, critic, tester) on the round-2 fixes. Open points:
   - pure understeer without insisting (a player who neither holds nor pulses the key past the
     cap) costs ~0.4 s per corner flat out on the centre line, under the 0.5 s target; with the
     realistic key driver (who insists) it is 0.68 s;
   - a 400 ms key press at 180 mph on a straight still spins (designer L1, tester #6);
   - SKID lights in ~10-15 % of corner time at the limit from lift-off tuck-in slip.
   Repeat until all four say "VERDICT: NO REMAINING ISSUES".
3. Let the user playtest grip against classic. After sign-off, delete the classic model and its
   constants, then merge to main. Ask before pushing: a push to main deploys GitHub Pages.
4. Later, when Grand Prix comes back:
   - implement `curvatureAt` for its segment tracks;
   - `ai.ts`, `warnings.ts` call the oval-only `trackCurves()` directly and must take the track's
     own table (`PlayerSteering` already takes a `SteerTrack`); the pit merge / pit approach / fuel
     reach logic in `ai.ts` is oval-specific;
   - drop that branch's `R_MIN` and its "150 on the inside lane" assumptions;
   - re-record the oval golden master.

## Defaults chosen without the user (they can override them)
- Collisions keep speed-threshold spins, with "loaded" (grip use ≥ 0.7) replacing "in a turn".
- Oil stays an instant spin.
- No AI racing line yet.
- A calmer AI field (fewer spins) is accepted.
