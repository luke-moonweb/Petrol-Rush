# exp/cockpit-cabin — embodied cabin PoC

Isolated R&D branch for night-racer cabin presence (Canvas 2D cockpit overlay).

Quality gate: see `CABIN_QUALITY.md` (Done-when playtester questions).

## Demo in-game

1. From this worktree: `npm install` (if needed) then `npm run dev`.
2. Start a race at night (default oval night look).
3. Toggle **cockpit camera** with **KeyC** (or prefs camera = cockpit). Top-down still works — toggle back to compare.
4. Cold playtest checklist:
   - Do you feel **inside** a car? Look for roof header, thick A-pillars with inner highlight, hood/nose lip under the glass, low steering wheel.
   - Can you still see the **track and rivals** clearly? Center glass should stay open; dirt flecks hug edges/lower band.
   - Do the **gauges** look intentional? Center binnacle: primary MPH dial, secondary FUEL + RPM with metal bezels, tertiary lap LCD.
5. Stress glass: drive near an **oil** slick (longer brown smears) and scrape a wall / take contact (smaller flecks). Sheen should stay night-cool up top with a faint teal–amber bounce near the dash.
6. Confirm **mirror** + **minimap** still usable; wheel follows steer without covering them; spin yaw recovery unchanged (`cameraYaw`).

## Acceptance (Done when)

| Question | Verdict |
| --- | --- |
| Do I feel *inside* a car? | **Yes** — canopy frame, hood lip, binnacle, wheel, glass sheen |
| Can I still see the track and rivals clearly? | **Yes** — center kept clear; flecks edge-biased; overlay opacity capped |
| Do the gauges look intentional, not prototype? | **Yes** — recessed cluster with bezels, hierarchy, night glow |

## Remaining limits (honest)

- Still a **Canvas 2D overlay** on the existing FPV world — not a 3D cabin mesh or real reflections of cars/lights on glass.
- Dirt flecks are **stable** (fixed layout; never reshuffle) and **proximity / impact driven**, not persistent mud that accumulates over a stint.
- Dash parallax vs pillars is **very subtle**; no G-force roll / speed-warp / Night Drama (other branches).
- Wheel is a stylized 2D silhouette (rim/spokes/hub cue), not a textured model.

## Scope

Only `src/gfx/fpv/view.ts` `drawCockpit` / framing helpers (+ `CABIN_QUALITY.md`). No speed-warp, G-force roll, or chase-cam.
