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

- [ ] **T12. AI cars crawl through the pit exit at ~5 mph for 10–33 s.** Source: tester r3.
  - **Numbers:** 60 seeds (1–20, 100–139), 20 cars × 18 laps. Transit time from x=1700 to off the
    pit road:

    | | p50 | p95 | p99 | max | exits > 10 s |
    |---|---|---|---|---|---|
    | grip | 2.4 s | 12.0 s | 16.0 s | 33.1 s | 82 / 1202 |
    | classic | 2.3 s | 3.4 s | 6.6 s | 13.7 s | 4 / 1264 |

    26 of 60 races have a 10 s+ exit. It is mostly cars 16–19, whose boxes (x 1588–1804) sit
    inside the 260 px give-way zone.
  - **Repro, seed 8:** from 199 to 228 s, car 17 (just out of its box, y≈270–277) and car 16 (in
    the drive lane, y≈285–290) run side by side at 4–6 mph from x=1736 to 1960. Car 17 steers
    toward the drive lane, touches car 16, brakes with opposite lock and repeats. Eight more
    exiting cars queue behind them at 5 mph and lose 25–30 s. None of them is in creep or
    recovery mode.
  - **Why the gate misses it:** the stopped-time metric does not count crawling, so the RESUME
    p95/max figures leave it out.
  - **To do:** fix the box-exit vs drive-lane interaction (a box exit yields cleanly, or the drive
    lane car lets it in), and gate on transit time (p95 ≤ ~4 s, max ≤ ~15 s).
  - Scripts: scratchpad/tester-grip/sim (queue, q2, transit).

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
  - **Note (critic r3):** fresh seeds 200–239 show only 2 spins near a merging car (classic: 259)
    and 0 forced 4 s merges. A probe of a forced merge with a racing car 40–300 px behind at
    120/150 mph gave no contact. Reproduce seeds 502/504 first to confirm before changing anything.
- [ ] **T3. The 40-seed gate cannot see pile-ups.** Source: projektant r3.
  - **Gaps:**
    - no pit-exit spin share;
    - no race-time comparison with classic;
    - the "stopped" check only catches < 1 mph, so crawling cars pass;
    - the incident excuse window (500 px, 20 s) is generous.
  - **Add:** pit-exit spin share ≤ 1.5 × classic over ≥ 12 seeds, and a crawl check.

## Known open items carried over from round 2
- [ ] **T4. Going in flat out is too cheap: the outer wall acts as a guide rail (designer M1, still
  open in r3).**
  - Designer r3, key tapper that steers along the wall: turn 1 + top straight braked 10.55 s vs
    flat out 10.82 s (+0.27 s); touch +0.23 s; ~+0.5 s per lap.
  - At 180 the car understeers to r=187 and grinds the outer wall at ~140 mph, exits at 148, no
    spin. The overdrive never opens before the wall (grip use peaks 1.21).
  - The implementer's 0.68–0.95 s comes from a driver who insists into the wall.
  - Target 3: 10% over should run about a lane wide and cost 0.5–1 s.
  - Suggestions: wall contact under understeer costs more speed, or excess speed itself builds
    rear stress so the tail can step out without overdrive.
- [ ] **T5. A 400 ms key press at 180 mph on a straight spins.** Designer target 8 says it should not.
- [ ] **T6. Grand Prix port** (when Grand Prix comes back):
  - add `curvatureAt` for segment tracks;
  - `ai.ts` and `warnings.ts` must take the track's own curvature table;
  - make the oval-only pit merge, pit approach and fuel-reach logic in `ai.ts` work per track;
  - drop `R_MIN` and the "150 on the inside lane" assumptions;
  - re-record the oval golden master.

## Designer r3 (other findings)
- [ ] **T10 (medium). Player and AI car stuck together at the outer wall of turn 2 for ~77 s.**
  - Touch run, lap 1: a contact at 16.4 s spun the player; at 18.3 s the player's speed dropped
    22→0 in one step with no wall contact (r=183.8). Player and one AI car stayed stuck until
    ~96 s and both lost ~5 laps.
  - The AI recovery in ai.ts only reverses when `tailBlocked` is false, so a car pressed on its
    tail creeps forever.
  - Probably shared with classic. Reproduce in classic first.
- [ ] **T11 (low). A fast glancing wall hit turned the heading 10.3° in one step.** 162 mph, 49 mph
  into the wall, 11° slip, player car at t=137.82 s. That is above the "≤ 4° per step" claim in
  RESUME. Check the wall-yaw cap and the slip alignment after the hit.
- Note: a 300 ms tap at ~175 mph reaches the wall (see T5); slow steep hits now stop cleanly and
  reverse drives away; holding the key at the limit works (laps 15.83 s); no cockpit view jumps
  besides T11.

## Low (critic r3, non-blocking; critic verdict: NO REMAINING ISSUES)
- [ ] **T7.** The gate comment says its seeds 100–141 were "not tuned on", but they are the round-2
  diagnostic seeds. Fix the comment, or move the gate to fresh seeds (200–239 also pass).
- [ ] **T8.** The forced 4 s merge path has no dedicated test; it never triggered in 40 races.
  Add a probe test.
- [ ] **T9.** Suite time rose from ~17 s to ~55 s (`gripGate` takes 51 s). Consider tagging the
  gate as a slow/CI-only test or sharding it.

## Tester r3 — what improved (for reference)
- The old standoff is fixed (seed 17: car 14 passes the exit at 70 mph; car 1 never drops below
  125 mph).
- Pit-exit stopped wait over 20 seeds: mean of per-race max 8.2 s (r2 20.6), max 31.9 s, 9 of 20
  races over 10 s. Classic: max 3.2 s.
- 0 dry tanks in 40 races; seed 10 car 19 pits correctly.
- Wall heading change per step at most 8° (was 128°); slow steep hits stop the car.
- A pinned car drives away.
- Queue behind a player stopped in the pit exit: 7–20 s (was 25–36 s). Nothing waits forever.
- Browser: a full race with your own pit stop is clean, all layouts work in both cameras,
  `?drive=classic` works, no console errors.

## Round 3 verdicts
critic NO REMAINING ISSUES; projektant, designer and tester ISSUES FOUND. Work is paused at the
user's request.
