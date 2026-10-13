# Cabin quality bar (`exp/cockpit-cabin`)

Target: a **night oval racer cockpit** that feels like a real driver’s seat — not a few dark polygons with gauges glued on.

## Must ship (acceptance)

1. **Silhouette** — Readable car nose / hood through the glass, thicker A-pillars with depth (outer dark + inner highlight + slight thickness), roof header that frames the windshield like a real canopy.
2. **Dash architecture** — Clustered instrument binnacle (not floating labels). Clear hierarchy: MPH primary, fuel + RPM secondary, lap info tertiary. Materials: matte plastic + subtle metal bezels.
3. **Steering wheel** — Believable rim (thickness, leather/matte), spokes, hub; follows steer; does not cover critical HUD/mirror.
4. **Glass** — Night reflection, subtle dirt/flecks that react to oil/scrapes, without muddying the race view.
5. **Lighting** — Soft night dash glow / instrument lighting consistent with the game’s teal–amber night palette (`PR` / existing FPV fog).
6. **Playability** — KeyC toggle intact; top-down unchanged; `cameraYaw` spin recovery untouched; mirror + minimap still visible and usable; no typecheck/test regressions.

## Nice-to-have (if time)

- Subtle windshield wiper / pillar shadow on the glass
- Small team or car cue on the wheel hub
- Gentle parallax of dash vs pillars when steering (very subtle)

## Out of scope

- G-force roll / speed-warp tunnel / Night Drama bloom (other branches)
- Three.js or new render engines
- Rewriting world FPV mesh

## Done when

A cold playtester (KeyC in a race at night) can answer **yes** to:
- “Do I feel *inside* a car?”
- “Can I still see the track and rivals clearly?”
- “Do the gauges look intentional, not prototype?”

Work in rounds until those three are yes. Prefer iterative polish in `src/gfx/fpv/view.ts` `drawCockpit` (+ tiny helpers). Update `NOTES.md` when acceptance is met.

## Status — Structure

Windshield aperture now reads as a sealed canopy: deeper roof header with underside lip, A-pillars with outer shade + body + teal/cream inner face, hood deck under the glass with a raised nose lip and deck shadow before the dash. Draw order is hood mass → roof/pillars → thickness → lip so cabin solids no longer look paper-thin. Cluster gauges / glass dirt / KeyC / mirror / minimap / `cameraYaw` left intact. `npm test` + `npm run typecheck` pass.

## Status — Cluster

Dash under the hood lip is matte plastic with a soft teal/amber lip wash. Gauges sit in a recessed binnacle (not floating HUD): primary MPH dial (digital + needle + spin-zone arc), secondary FUEL and RPM dials with metal bezels and night glow, tertiary lap LCD (`TO GO` / `FINAL`). Instrument hierarchy and warm teal–amber glow match the night cabin bar. Structure pillars/hood left intact; KeyC, mirror, minimap, `cameraYaw` unchanged. `npm test` + `npm run typecheck` pass.

## Status — Atmosphere

Night glass: cool sky sheen + roof specular streak, warm teal/amber dash bounce, pillar edge wash, soft wiper arcs; center race lane stays clear. Dirt flecks use a fixed RNG seed and slot layout (appear/fade with oil/scrape only — no per-frame reshuffle). Steering wheel: leather rim thickness + stitch ring, grip pads, tapered riveted spokes, chrome hub with team cue, soft glove hands; sits low so mirror/minimap stay usable. Kept Cluster dash parallax and Structure canopy/pillars/hood; reconciled draw order (glass → hood/roof/pillars → parallax dash/cluster → wheel). No G-force / speed-warp / Night Drama. KeyC, mirror, minimap, `cameraYaw` unchanged. `npm test` + `npm run typecheck` pass. Done-when playtester questions: yes / yes / yes (see `NOTES.md`).
