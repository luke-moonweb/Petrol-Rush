# exp/cockpit-cabin — embodied cabin PoC

Isolated R&D branch for night-racer cabin presence (Canvas 2D cockpit overlay).

Quality gate: see `CABIN_QUALITY.md` (Done-when playtester questions).

## Demo in-game

1. From this worktree: `npm install` (if needed) then `npm run dev`.
2. Start a race at night (default oval night look).
3. Toggle **cockpit camera** with **KeyC** (or prefs camera = cockpit). Top-down still works — toggle back to compare.
4. Cold playtest checklist:
   - Do you feel **inside** a car? Roof header, A-pillars, livery hood, binnacle on the dash, wheel with gloves at 10 and 2.
   - Can you still see the **track and rivals** clearly? The centre lane and the race-info corridor under the mirror stay clear; flecks sit at the edges.
   - Do the **gauges** look intentional? LED strip, segmented speed ring, fuel-laps pod, race pod (position + interval ahead) and tell-tales.
5. Stress the cabin: drive through an **oil** slick (dark smears build up on the lower glass) and hit a wall (grit specks plus a small cabin jolt that the mirror follows). Go over 150 mph in a turn: LED strip and SKID lamp blink together with the HUD SKID lamp.
6. Confirm **mirror** + **minimap** are still usable; the wheel follows steer; spin yaw recovery is unchanged (`cameraYaw`).

## Acceptance (Done when)

| Question | Verdict |
| --- | --- |
| Do I feel *inside* a car? | Self-check yes; not re-run by a cold playtester |
| Can I still see the track and rivals clearly? | Self-check yes; measured clear zones (see `CABIN_QUALITY.md`) |
| Do the gauges look intentional, not prototype? | Self-check yes; not re-run by a cold playtester |

## Remaining limits (honest)

- Still a **Canvas 2D overlay** on the existing FPV world, not a 3D cabin or real reflections.
- Floodlight streaks are capped at alpha 0.2 (roof) / 0.14 (pillar) and stay subtle at normal size.
- Glass soil is mostly gone 8 s after the last oil or impact; it does not accumulate over a whole stint.
- Wheel and gloves are a flat 2D sprite.
- fps at the target sizes was not read live (hidden browser pane); overlay cost was measured with `performance.now()` and a GPU-synced A/B instead.

## Scope

Cabin drawing in `src/gfx/fpv/cockpit.ts`, readout and per-race cabin state in `src/gfx/fpv/cabin.ts` (tests in `tests/fpv.test.ts`), frame plumbing in `src/states/race/state.ts`, shared `CONFIG.LOW_FUEL`. No speed-warp, G-force roll, or chase-cam.
