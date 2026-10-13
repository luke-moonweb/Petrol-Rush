# Cabin quality bar (`exp/cockpit-cabin`)

Target: a **night oval racer cockpit** that feels like a real driver’s seat — not a few dark polygons with gauges glued on.

## Must ship (acceptance)

1. **Silhouette** — Readable car nose / hood through the glass, thicker A-pillars with depth (outer dark + inner highlight + slight thickness), roof header that frames the windshield like a real canopy.
2. **Dash architecture** — Clustered instrument binnacle (not floating labels). Clear hierarchy: MPH primary, fuel + race pod secondary, tell-tales tertiary. Materials: matte plastic + subtle metal bezels.
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

## Status — current (cabin rebuild)

What is on screen now (checked in the harness at 640×480, 1280×720, 1680×720, 2520×1080, 500×1000 stacked and 844×390 touch):

- **Sealed cabin.** Glass tint, livery hood, roof, A-pillars, dash and binnacle are one opaque, overlapping layer with 4 px overscan. With the world filled magenta, no magenta shows below the hood lip (lowest world pixel 0.564h at centre, 0.671–0.673h at the edges) or outside the pillar/roof aperture, at steer −1, 0 and 1, in 4:3, 16:9, 21:9 and stacked. The dash no longer slides with steering.
- **Clear zones.** With the world filled white: centre lane (0.25–0.75w × 0.32–0.56h) mean luminance 1.000, race-info corridor (0.30–0.70w × 0.18–0.32h) 0.997. Glass flecks are placed only outside both zones; the old wiper ellipses are gone (the wipers are parked on the hood lip).
- **Hood** is painted in the player's livery (`CAR_SCHEMES[colorIdx].body` mixed 72 % toward `#0A0912`), flat-shaded in two facets with a `roof`-colour lip line. The hood crest stays at 0.564h, as in the spec layout table.
- **Instruments** (segmented, no needles): 9-LED strip on the cowl lip (114→146 mph, skid red/blink in phase with the HUD SKID formula `floor(time*6)%2`, slide pre-warning, spin: whole strip flashes at 6 Hz for 0.3 s, timed from the spin start so it opens lit, then three red LEDs chase, pit limiter, start lights, green flash at lights out, finish cascade); 18-segment 0–180 mph ring with 20 px digits (a segment lights once speed passes its lower bound, so red appears as soon as speed passes 150); 12-segment fuel arc, one segment per lap of fuel, with a laps-of-fuel readout captioned LAPS; race pod with position (classified position after the finish) and the interval to the car ahead (LEAD / FINAL / PIT n, or PIT NOW in red under one lap of fuel / FINISH); tell-tales PIT · FUEL · SKID · PEN · REV. PEN blinks at 2 Hz for 3 s after a penalty (same rhythm as the HUD tower), then stays lit. RPM dial removed. On touch the tell-tales carry 9 px letter captions (P F S ! R) and the fuel pod a 9 px LAPS caption; no cockpit text is below 8 px (9 px on touch).
- **Fuel warnings** use the shared `CONFIG.LOW_FUEL = 0.12` (HUD, sound, race message and cockpit). The fuel arc is teal while a stop is 3 or more laps away, amber when fewer than 3 laps of fuel remain and the race is longer than that (the race pod then shows `PIT n`), and red below `LOW_FUEL`. The FUEL lamp is steady under 1.5 laps of fuel when a stop is needed and blinks below `LOW_FUEL` in phase with the HUD fuel gauge (`time * 3`); the LOW FUEL race message keeps its own `time * 2` rhythm. At the start of an 18-lap race nothing is amber.
- **Wheel** is a cached sprite (rim, stitch, three spokes, livery 12-o'clock marker). Gloves are a separate cached sprite in the livery colour with one lighter facet, knuckles on the inner side of the rim and a thumb pad; dark sleeves with a teal cuff reach from each glove down to the bottom screen corners and follow the hands as the wheel turns. The rim highlight is drawn under the gloves. Both hands and the marker are on screen at steer 0 in every layout. Below 520 px view width (4:3, touch, stacked) the wheel sits higher (`wheelCy = h + 0.25·R`, otherwise `0.37·R`); the rim clears the binnacle and the minimap. Rotation is unchanged (steer × 1.4 rad).
- **Glass soil** lives per race (`cabinFor(race)`): it builds while the player drives through an oil slick (`oilRadius`) and once per impact jolt (wall or car, counted as `max(wallImpact, contactStrength)` like the sound code), and decays with a 2.5 s time constant, so it is mostly gone (< 5 %) 8 s after the last event. Flecks have a fixed seeded layout along the lower glass and the pillar edges: oil as horizontal smears with a tail, grit as small unstroked specks.
- **Floodlights:** only glows flagged as floodlight masts (`flood: true` in `scene.ts`) count; the red beacon on the leaderboard pylon no longer does. A mast within 176 px ahead adds a warm streak on the headliner (alpha ≤ 0.2, 0.06w wide, with a 1 px warm glint on the teal roof bead) that slides onto the pillar face (alpha ≤ 0.14) as the mast passes, plus a dash-lip glint. Intensity follows a smoothstep of distance and the roof/pillar hand-over is cross-faded, so nothing switches on or off abruptly. Visible on close inspection; still subtle at normal size.
- **Impact jolt:** wall/contact hits and spin entry shift the cabin overlay (never the world camera) by ≤ 3 px and kick the wheel, decaying in ~0.35 s. Off when `prefers-reduced-motion: reduce` matches.
- **Left HUD panel kept** in cockpit mode: it is ≥ 300 px from the gaze point on wide layouts and below the view when stacked, so the cockpit repeats only speed and fuel. The HUD SKID lamp over the view is hidden in cockpit mode; the cockpit SKID tell-tale is the single source there. After the finish the top-bar POS, the race pod and the FINISHED message all use the classified position.
- **Jolt:** the mirror and minimap move with the cabin jolt; the world speed shake and the jolt are both off under `prefers-reduced-motion: reduce`.
- **Cache:** shell, wheel and glove layers remember the scale and geometry they were built at and are drawn at that size. A change of scale (DPR, fullscreen, phone rotation), view height, livery or touch rebuilds them in the same frame (8.5 ms CPU measured once); only a width change keeps drawing the old layers stretched while an idle rebuild runs, and an idle rebuild for a key that is no longer wanted is dropped. A drawImage spy plus a magenta world fill on the first frame after 1280×720 → 640×360 → 1280×720 → 1680×720, a DPR 2 → 1.5 → 2 switch, stacked 500×1000, and touch 844×390 → 390×844 → 844×390 showed every cabin blit at 1:1 device scale and no world pixel below the hood lip (lowest 0.669–0.673h). While the top-down camera is shown, the cabin layers are prewarmed on idle only after the cockpit has been used this session (players who never use it pay nothing for them). The 3D cockpit scene (`trackCanvas()` + `buildScene()`, about 130 ms CPU in the harness) is built once during the start lights, whatever the camera, while the player cannot drive; resumed races or races without lights still build it on the first cockpit frame. Measured at 1280×720 with the race started in top-down: countdown frames median 0.6 ms with one 131 ms build frame at the first light; first KeyC frame into the cockpit 16.7–35.6 ms in two runs, against 68.3 ms without the countdown build, steady cockpit frames ~3.5 ms. The remainder of the first frame is the cabin layer build (layers are not prewarmed for players who have not used the cockpit) and first-use world textures. A recurring 80–100 ms frame about 4.8 s into the countdown was also present with the countdown build disabled, so it is not caused by this change.
- **Cost:** CPU time around `drawCockpit` has a median of ~0.1 ms at 1280×720 and 1680×720 (DPR 2; timer resolution is 0.1 ms). GPU-synced A/B (300 renders of the same frame, with and without the overlay): about 0.2–0.3 ms per frame, the same range as the previous overlay. No per-frame `shadowBlur`. With `?debug` the race shows separate 60-frame medians for the cabin and for mirror + minimap (e.g. `cabin 0.20 ms · mirror 1.20 ms` at 1280×720 in the harness); the 1 ms budget applies to the cabin figure.

Not done / limits: no live in-browser fps reading at the target sizes (the browser pane was hidden during measurement, which stops `requestAnimationFrame`); no cold playtester has re-run the three Done-when questions on this version. In stacked layouts the `?debug` text panel covers the mirror; without `?debug` the mirror is clear of the HUD strip.
