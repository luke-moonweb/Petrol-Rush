# Designer baseline + feel targets (current main 1a2098f)

## Preserve
- The steering ramp (tap = nudge, hold = full turn; STEER_MIN 0.15 → 1 over 0.3 s, 0.15 s in turns).
- The corner assist as partial help (~30%, not an autopilot); the straight assist (but remove the 7° cliff).
- Braking 55–75 mph/s, learnable brake point (180→148 ≈ 150 px / 0.5 s).
- The acceleration curve and sense of speed; a dramatic but fast spin; coasting 8 mph/s; Down/S brake→reverse; own-oil immunity; the cockpit camera locked to the car heading; REV touch toggle.

## Problems today (measured)
- The limit is a speed constant, not grip: the inside line (r≈112) gives 15.30 s, centre 16.18, outside 17.00 → hugging the inside is free.
- A cliff at 157/158 mph (round): 152–157 is a free buffer; ≥158 spins within 0.15 s.
- 165 and 180 entries give identical outcomes (~4.5 s loss).
- Brake-in-corner exploit: holding the brake from turn-in allows entering at up to 167 mph with no cost.
- No understeer or visible slip (moveAngle == heading); yaw authority is speed-independent (2.9 rad/s cap); taps of 100 ms vanish (7° straight-assist window) and 200 ms stick.
- Walls: a glancing outer-wall contact glues the car (148 → 12 mph in 2 s with gas held); a steeper contact spins instantly.
- SKID/LEDs are red on straights above 150 (~70% of a lap).

## Feel targets (testable; centre line V*≈150 on this oval)
1. The limit comes from radius: the inside is ~10–15% lower than the centre, the outside ~10% higher; clean laps by line within ±0.4 s.
2. 5% over: 10–20 px wide, lifting recovers within 0.5 s, 0.1–0.3 s loss, no spin.
3. 10% over: ~one lane (30 px) wide, recoverable by lift/brake, 0.5–1 s loss.
4. 15–20% over: rear step-out, slip 10–25°; countersteer within 0.3 s catches it >80% of the time; otherwise spin after 0.6–1.0 s.
5. Spin only at ≥25% over, an uncaught slide, or contact; the loss grows with excess (~1.5–2 s at 20%, 4–5 s flat-out at 180).
6. Braking in a corner costs grip (≥10 px wider or provokes the rear); the 167 exploit is gone.
7. Lift-off tightens the line by 5–10 px within 0.5 s.
8. At 180 on a straight: a 100 ms tap gives 4–8 px; a 30 px lane change takes 0.6–0.9 s; a 400 ms hold does not reach the wall from the centre lane.
9. Full-lock yaw at 180 ≤ ~60% of that at 60 mph.
10. Walls: glancing <15° loses 10–25% and never glues; >30° above ~60 mph spins; graded in between.
11. Determinism (fixed step, no hidden timers > ~0.1 s).

## Touch
- The same digital path; one pedal at a time; ~1 s of look-ahead in top-down at 180 → forgiving at turn entry (understeer first); countersteer window ≥0.3 s; a single ~100 ms tap catches a moderate slide.

## Cockpit / warnings
- The camera stays locked to heading → the road visibly crabs by the slip angle (~5° at the limit, 15–25° in a rear slide); smoke in the mirror and at the screen edges.
- LEDs = grip usage (teal 0–70%, amber 70–95%, red 95–110%, all-red flash >110% or rear stepping out); never red on straights; optional predictive amber before the brake point.
- SKID only on real slip (>~100% grip or the rear sliding), blinking faster with the slip angle.
- Wheel/hands show opposite lock during a caught slide.
