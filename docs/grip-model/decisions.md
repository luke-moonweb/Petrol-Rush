# Grip model — user decisions (2026-10-17)

1. Grip level: GRIP = 500 px/s² (centre line of the oval ~160 mph, outside ~174, laps +1%, AI +2.3%).
2. Over the limit: GRADED. Small excess → understeer, lifting recovers; more → rear step-out catchable by countersteer within ≥0.3 s (a single ~100 ms tap catches a moderate slide); spin only on clear excess (~25%+) or an uncaught slide; the loss grows with excess (no "165 = 180").
3. Warnings: GRIP USAGE.
   - Cockpit LEDs = grip usage (teal 0–70%, amber 70–95%, red 95–110%, all-red flash >110% or rear stepping out). Nothing lit on straights unless sliding/braking hard.
   - SKID lamp (HUD + cockpit tell-tale) = real slip only, blinking faster with the slip angle.
   - The speed bar above the car and the speedo red arc show the limit speed of the next corner (predictive).
   - Update help text, settings text, README, NOTES accordingly.
4. Rollout: BOTH MODELS behind a switch during testing (URL param e.g. `?drive=classic|grip`, default grip on this branch; optionally a settings toggle). The old model is deleted after user sign-off, before merging to main.

Defaults chosen by the main session for the other open questions (state them in the report; the user can override):
- Collisions: keep the speed-threshold spins; replace "in a turn" by "car is loaded" (grip use ≥ 0.7) as in spec §5.
- Oil: keep the instant spin.
- AI racing line (outside-apex-outside): later phase, not now.
- A calmer AI field (fewer spins) is acceptable for now; report the numbers.
- grand-prix R_MIN / 150 tests: handled later when GP is merged; do not touch feature/grand-prix.

Unchanged user rules: coasting (COAST_MPH_S 8), Down/S brake→reverse, own-oil immunity, the cockpit camera locked to the car heading (slip must become visible as the road crabbing), the REV touch toggle.

Also apply the designer feel targets in scratchpad/designer-grip-baseline.md as acceptance criteria where compatible with the spec (graded walls without gluing, no vanishing-tap cliff on straights, yaw authority falling with speed, lift-off tightens the line, braking in a corner costs grip, lane times within ±0.4 s). Report any conflict with the spec instead of silently choosing.

## Decision added 2026-10-17 (round 2)
- AI incidents: the user chose to KEEP the calm field (far fewer AI spins than classic is accepted). Do not add AI driver errors. Contact and oil spins must still work when they happen.
