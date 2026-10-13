# exp/cockpit-cabin — embodied cabin PoC

Isolated R&D branch for night-racer cabin presence (Canvas 2D cockpit overlay).

## Demo in-game

1. From this worktree: `npm install` (if needed) then `npm run dev`.
2. Start a race.
3. Toggle **cockpit camera** with **KeyC** (or prefs camera = cockpit). Top-down still works.
4. Look for:
   - Dark **hood / nose lip** under the windshield opening
   - Thicker **A-pillars** with a faint inner highlight
   - Dash **FUEL** bar, **RPM** needle, MPH, and lap “TO GO” / FINAL
   - Soft **glass** sheen; dirt flecks strengthen near oil slicks or after wall/contact scrapes
   - Richer **steering wheel** (spokes + hand blobs) that still follows steer
5. Confirm mirror + minimap still draw; spin yaw behavior unchanged.

## Scope

Only `src/gfx/fpv/view.ts` `drawCockpit` / framing helpers. No speed-warp, G-force roll, or chase-cam.
