CRITIC r1 — ISSUES FOUND (classic bit-identical verified; fuzz 480k steps clean; perf in budget)
1 Medium: the SKID blink is not phase-continuous — skidOn floor(time*hz*2)%2 (warnings.ts:43-46) with hz changing per frame (86-88) → random flicker at large race time. Fix: a phase accumulator (phase += hz*dt) or quantised hz. Affects hud.ts:422 and cabin.ts:210.
2 Medium-low: the wall kick (physics.ts:504 heading = along − wrap(heading−along)*kick) mirrors the nose; for an oversteering car (velocity into the wall, nose away) it turns the nose INTO the wall (measured: 22° vel / nose 10° away → nose +1.7° into the wall). Fix: nose = along rotated toward the wall normal by kick*angle. The test grip.test.ts:306 only asserts no spin — assert the kick direction.
3 Low: dt=0 → NaN in grip (physics.ts:286 aLong=|Δspeed|/dt). Guard dt>0.
4 Low: the LED red band starts at 1.011 (cabin.ts:145 ledUse) — the decision says red from 95%. Fix the mapping and the fpv test grip(1.0).
5 Low: during a spin the HUD SKID goes dark (warnings.ts:86 skidHz=0) while the cockpit tell-tale stays lit (cabin.ts:210). Make both lit during a spin.
6 Low: the paused fallback warn uses the classic 8 mph band (state.ts:409); the speed bar uses raw vRef vs the eased arc; nextCornerMph uses the car's lateral offset even in the pit lane (red arc ~96 mph near turn 1) — clamp the offset to the racing lanes when in the pit lane.
Tests:
- the race-time gate (5 seeds, mean +5%, seed +12%) hides regressions (seed 2024 +10.2% with 25→75 spins). Assert spin counts per seed too; more seeds.
- no solo pace test for A10/A11 (grip mean +2.2% ok; inside lane +8%). Add it.
- pit-phase spins not asserted (A13 requires 0). Suggestive: spins on the straight before turn 2 increased (16 vs 3 seed 1234; 6 vs 0 seed 2024) — the new pit decision makes AI cars cut to the inside kerb at full speed with no laneFree check (ai.ts:100,130). Add laneFree / a gradual lane change for the pit approach.
- weak assertions: gripRace.test.ts:132 TURN_LEN>0; the pit-entry test does not check the lane move finishes before the corner; grip.test.ts:283/288 says 10–25% but asserts ≥5%; grip.test.ts:306 kick direction.
