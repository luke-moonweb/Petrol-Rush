# Grip model: open tasks after review round 3 (state 3c8e867 / 47f0378)

On 2026-10-17 the user said: record the findings as tasks and make no code changes for now.
Full reports are in `review-r3/`. Status: [ ] open, [x] done.

Signed off by the user. Do not change or review these:
- The cockpit LED strip: start lights, then 140–180 mph.
- The SKID lamp.
- A calm AI field.

## High
- [ ] **T1. Lifting off at a small excess spins instead of recovering (A4).** Source: projektant r3;
  present since round 1.
  - **Setup:** oval turn 1, real PlayerSteering, entry 1.05–1.10 × the limit, key held, throttle
    lifted or coasting.
  - **Result:** the car spins after about 1.7 s.
  - **Setup:** the same at 1.0–1.08 ×, lifting after 0.5 s.
  - **Result:** slip is still 14–28° at the corner exit; the car never recovers.
  - **Cause:** the key cap holds demand at 1.05 × grip, so nothing balances the lift-off tuck-in
    (LIFT_YAW, FRONT_GAIN). Slip grows about 14°/s, passes 12.6° (the rear lets go) and feeds
    itself into a spin.
  - **Fix options (pick one):**
    - bound tuck-in slip to about 4–5° unless demand is above 1.3 × or overdrive is active;
    - cap the key at ≤ 1.0 while lifting or braking;
    - apply the tuck-in to the direction of travel (tighten the line) instead of only to the nose.
  - **Acceptance:**
    - at 1.0–1.10 × with the key held or tracking the line, lifting at turn-in or mid-corner →
      no spin, and slip below 5° by the corner exit;
    - at ≥ 1.25 × while insisting → it still spins.

## Medium / minor
- [ ] **T2. The forced pit-exit merge brings pile-ups back.** Source: projektant r3.
  - **Where:** seeds 502 and 504, 10 spins each.
  - **Sequence:** a car that waited 3.7 s or 8.8 s is pushed out by the 2.5 s / 4 s fallback, a
    racing car at 111–112 mph on the inside line rear-ends it, and an oil chain follows.
  - **Numbers:** pit-exit spins are 34 % of grip spins vs 18 % in classic. Round 2 had none.
  - **Fix (either):**
    - the fallback merge still requires reduced braking room for the nearest racing car within
      about 200 px behind;
    - racing cars treat a committed merger that is alongside or ahead as being on their line.
- [ ] **T3. The 40-seed gate cannot see pile-ups.** Source: projektant r3.
  - **Gaps:**
    - no pit-exit spin share;
    - no race-time comparison with classic;
    - the "stopped" check only catches < 1 mph, so crawling cars pass;
    - the incident excuse window (500 px, 20 s) is generous.
  - **Add:** pit-exit spin share ≤ 1.5 × classic over ≥ 12 seeds, and a crawl check.

## Known open items carried over from round 2
- [ ] **T4. Pure understeer is too cheap.** Flat out on the centre line without insisting costs
  about 0.4 s per corner (target 0.5 s). With the realistic key driver it is 0.68 s.
- [ ] **T5. A 400 ms key press at 180 mph on a straight spins.** Designer target 8 says it should not.
- [ ] **T6. Grand Prix port** (when Grand Prix comes back):
  - add `curvatureAt` for segment tracks;
  - `ai.ts` and `warnings.ts` must take the track's own curvature table;
  - make the oval-only pit merge, pit approach and fuel-reach logic in `ai.ts` work per track;
  - drop `R_MIN` and the "150 on the inside lane" assumptions;
  - re-record the oval golden master.

## Pending review reports
Designer, critic and tester round 3 were still running when the user paused the work. Their
findings are added below as they arrive.
