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
- **Instruments** (segmented, no needles): 9-LED strip on the cowl lip (114→146 mph, skid red/blink in phase with the HUD SKID lamp, slide pre-warning, spin chase, pit limiter, start lights, green flash at lights out, finish cascade); 18-segment 0–180 mph ring with 20 px digits; 12-segment fuel arc, one segment per lap of fuel, with a laps-of-fuel readout; race pod with position and the interval to the car ahead (LEAD / FINAL / FINISH); tell-tales PIT · FUEL · SKID · PEN · REV. RPM dial removed. Captions are dropped on touch; no cockpit text is below 8 px (9 px on touch, where only the 9–20 px readouts remain).
- **Low fuel** uses the shared `CONFIG.LOW_FUEL = 0.12` (HUD, sound, race message and cockpit). The cockpit FUEL lamp and arc blink with the HUD fuel gauge (`time * 3`); the LOW FUEL race message keeps its own `time * 2` rhythm.
- **Wheel** is a cached sprite: rim, stitch, three spokes, livery 12-o'clock marker, livery-tinted gloves at 10 and 2 with teal cuffs. Both hands and the marker are on screen at steer 0 in every layout. Rotation is unchanged (steer × 1.4 rad).
- **Glass soil** lives per race (`cabinFor(race)`): it builds while the player drives through an oil slick (`oilRadius`) and on wall/contact hits, and clears over about 8 s. Fleck layout is fixed (seeded once).
- **Floodlights:** masts within 176 px ahead add a warm streak on the roof or down the pillar, alpha ≤ 0.08, plus a faint dash-lip glint. Subtle by design (WCAG 2.3.1 limit); easy to miss on a dark pillar.
- **Impact jolt:** wall/contact hits and spin entry shift the cabin overlay (never the world camera) by ≤ 3 px and kick the wheel, decaying in ~0.35 s. Off when `prefers-reduced-motion: reduce` matches.
- **Left HUD panel kept** in cockpit mode: it is ≥ 300 px from the gaze point on wide layouts and below the view when stacked, so the cockpit repeats only speed and fuel, the two values that decide the next second.
- **Cost:** CPU time around `drawCockpit` has a median of ~0.1 ms at 1280×720 and 1680×720 (DPR 2; timer resolution is 0.1 ms). GPU-synced A/B (300 renders of the same frame, with and without the overlay): about 0.2–0.3 ms per frame, the same range as the previous overlay. No per-frame `shadowBlur`.

Not done / limits: no live in-browser fps reading at the target sizes (the browser pane was hidden during measurement, which stops `requestAnimationFrame`); the floodlight streaks are faint; no cold playtester has re-run the three Done-when questions on this version.
