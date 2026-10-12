<div align="center">

# 🏁 PETROL RUSH

**An old-school arcade night race under floodlights – 20 cars, fuel strategy, pit stops and crashes that matter.**

### [▶ Play in your browser](https://luke-moonweb.github.io/Petrol-Rush/)

![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Canvas 2D](https://img.shields.io/badge/Canvas-2D-E34F26?logo=html5&logoColor=white)
![Web Audio](https://img.shields.io/badge/Web%20Audio-procedural-FFB627)
![Zero assets](https://img.shields.io/badge/asset%20files-0-12B5A6)
![Tests](https://img.shields.io/badge/tests-Vitest-6E9F18?logo=vitest&logoColor=white)

<img src="docs/screenshots/title.png" alt="Petrol Rush title screen – a live demo race runs behind an F1-style menu" width="720">

</div>

Petrol Rush is a top-down 2D racing game written in TypeScript with plain Canvas 2D and Web Audio.
You race up to 19 AI drivers on a four-lane night oval, manage fuel, dive into the pit lane and try to
stay out of the pile-ups. **Every pixel and every sound is generated in code at start-up** – there
are no image, audio or font files in the project.

## ✨ Highlights

- 🏎️ **20-car races** with F1-style grid, five-light start and live timing tower with sector gaps.
- ⛽ **Fuel & pit stops** – a full tank lasts about 12 laps. Cross the yellow PIT LANE line and the
  game drives you to your box, refuels and takes you back out.
- 💥 **Crashes that matter** – hit someone in the rear and *they* spin; spinning cars spill
  oil slicks; the culprit gets a **+2 s time penalty**.
- 🛢️ **Oil on track** – any car that drives into a slick spins. AI drivers avoid oil even more than
  each other (but react with a human-like delay).
- 🚦 **Smart, beatable AI** – lane changes, overtaking, avoiding wrecks, staggered pit stops.
- 📻 **Radio spotter** – "Caution! Crash ahead!" through the browser's speech synthesis with a
  radio squelch, plus a yellow-flag banner in the HUD.
- 🔊 **Four engine sounds** to choose from: V8 MUSCLE, JET TURBINE, 8-BIT ARCADE and RC TOY, with
  stereo panning and Doppler for passing rivals.
- 🎥 **Cockpit view** – press C (or CAM on touch screens) to drive from the driver's seat: flat-shaded
  pseudo-3D night track, rivals with working tail and brake lights, a live rear-view mirror and a
  steering wheel that follows your inputs.
- 📺 **Live-on-air title screen** – a silent 20-car demo race plays behind the menu, filmed like a
  TV broadcast.
- ⌨️ **Fully rebindable keys** (primary + alternate per action), saved in the browser.
- 📱 **Touch controls on phones and tablets** – on-screen steering, pedals and menu buttons appear
  automatically; menu items can also be tapped directly.

<table>
  <tr>
    <td><img src="docs/screenshots/race.png" alt="Race HUD: timing tower, semicircular speedometer and fuel gauge, night track"></td>
    <td><img src="docs/screenshots/crash.png" alt="Crash ahead: yellow caution banner, oil slicks and a penalty in the timing tower"></td>
  </tr>
  <tr>
    <td align="center"><sub>Packed night oval – live tower, fuel on the edge, one bad corner from disaster</sub></td>
    <td align="center"><sub>Crash ahead – caution flag, oil slicks, penalties</sub></td>
  </tr>
</table>

## 🚀 Quick start

Requires [Node.js](https://nodejs.org/) 22.12+, 24, or 26+. The version used by CI is pinned in `.nvmrc`
(`nvm use` picks it up).

```bash
npm install
npm run dev
```

Open the address printed by Vite (by default http://localhost:5173).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite (Vitest) |
| `npm run typecheck` | TypeScript check only |
| `npm run lint` | Lint and check formatting (Biome) |
| `npm run lint:fix` | Apply safe lint fixes and format the code |

The production build is a static site – `dist/` can be hosted on any static hosting.

## 🎮 Controls

| Key | Action | Alternate |
|---|---|---|
| ← / → | Steer | |
| ↑ | Throttle | W |
| Space | Brake | ↓ |
| Shift | Reverse on/off (only when almost stopped) | |
| C | Camera: top-down ↔ cockpit | |
| P | Pause | |
| Tab | Race menu (Esc always works) | |
| F1 | Controls & tips | H |
| M | Sound on/off | |
| F | Scaling: fit window ↔ integer scale | |

All driving keys can be changed in **SETTINGS → KEYS**. Arrows, Enter and Esc always navigate menus.

Menus also work with the **mouse**: hovering highlights an item, clicking chooses it, and clicking the
left or right half of a setting row changes its value down or up.

### 📱 Touch screens

On a phone or tablet (detected via `(hover: none) and (pointer: coarse)`) the game shows on-screen
controls next to the picture in landscape, or under it in portrait. Nothing covers the race view.

| Where | Race | Menus |
|---|---|---|
| Left thumb | ◀ ▶ steer – slide between them without lifting | ▲ ▼ ◀ ▶ pad (hold to repeat) |
| Right thumb | BRAKE · GAS – slide between them | BACK · OK |
| Small buttons | REV (reverse), CAM (camera), pause, race menu, sound, fullscreen* | sound, fullscreen* |

Menu items, setting rows and buttons can also be tapped directly on the game screen; tapping the left
or right half of a setting row changes its value down or up. *Fullscreen is hidden where the
browser does not support it (iPhone Safari).

## 🏆 How to race

- **Corners are taken at 150 mph or less.** Go a little faster and the car slides wide and scrubs
  speed; go much faster and it spins. The **SKID** lamp (top right) and the red-dashed zone on the
  speedometer warn you, and an optional bar above your car shows how far over the limit you are.
- **Throttle works like cruise control** – release it and the car holds its speed. Braking is
  stronger at high speed and never engages reverse by itself.
- **Overtake on the straights.** Steering builds up while you hold a key: tap for small corrections,
  hold for a full turn.
- **The car ahead has right of way.** If you run into a car in front of you – even one that just
  changed lanes – the crash is your fault and costs you **+2 s**. The timing tower shows track
  order; penalised cars get a red `+2s` tag, and if you are penalised the top bar shows your
  projected position, e.g. `PEN +2s → P6`. Penalties count in the final classification.
- **Hit a wall head-on and you stop dead** – back out with reverse and straighten up; only light
  glancing contacts let you slide along the barrier.
- **Pit when the fuel gauge gets low.** Take the funnel at the bottom-left of the oval, follow the
  PIT arrows, and the pit crew does the rest.

## ⚙️ Settings

| Option | Choices |
|---|---|
| Engine sound | V8 MUSCLE · JET TURBINE · 8-BIT ARCADE · RC TOY |
| Crash penalties | On / Off |
| Speed warning bar | On / Off |
| Collisions | **Realistic** – the car hit in the rear or rear side spins, the hitter does not · **Classic** – in a hard crash both cars spin |
| Race | Number of cars (up to 20), laps (1–100), your car colour, starting position (last / middle / pole / random) |

Settings and key bindings are stored in `localStorage`.

## 🔗 URL parameters

Handy for testing and tuning:

| Parameter | Effect |
|---|---|
| `?quick` | Skip the menus and start a race |
| `?cars=20&laps=3` | Race options |
| `?seed=123` | Repeatable race |
| `?debug` | Debug overlay, `]` speeds up time ×4/×8, `window.__game` and `window.__race` in the console |
| `?overlay=URL` | Semi-transparent 640×480 image over the screen for layout comparison |
| `?touch` / `?touch=0` | Force touch controls on / off, regardless of the device |

## 🧱 How it's built

- **Fixed 60 Hz simulation** with interpolated rendering; logical resolution 640×480, scaled to the
  window and drawn at device resolution, so text stays sharp and pixel art stays crisp.
- **Track in Frenet coordinates** (`s` along the lap, `d` across it) – lane keeping, lap counting,
  sectors and AI all work in that space.
- **Cars are pre-rendered** from tiny 3D models into 32 rotation sprites per livery at start-up.
- **Procedural audio** – engines, tyres, crashes, radio and UI sounds are synthesised with Web Audio.
- **Tunable** – almost every gameplay constant (grip, braking, slide thresholds, AI, collisions,
  penalties, oil, fuel range) lives in `src/config.ts`.

```
src/
  main.ts          game loop (fixed 60 Hz step), scaling
  config.ts        tuning constants and race options
  meta.ts          author and repository links
  input.ts         keyboard, rebindable keys, virtual (touch) actions
  touch.ts         phone detection, on-screen controls and their layout
  prefs.ts         SETTINGS → GAME options
  states/          title (with demo race), controls, settings, credits
    race/          race screen: flow, sound, race-only drawing
  track/           oval geometry, walls, pit road
  race/            cars, physics & collisions, AI, oil, pit stops, race logic & classification
  ui/              HUD, race overlays, text, palette
    menus/         title, controls, settings and credits screens
  gfx/             3D-to-sprite renderer, liveries, particles, world drawing
    fpv/           cockpit view: tiny Canvas 2D polygon renderer, 3D night scene, mirror, dashboard
    track/         night track pre-render: tarmac, pit road, paddock, infield
  audio/           Web Audio effects and four engine voices
docs/screenshots/  images used in this README
tests/             Vitest: track geometry, lap counting, physics, collisions, penalties,
                   oil, pit autopilot and full headless 20-car races
```

## 🧪 Tests

```bash
npm test
```

The suite includes headless simulations of complete 20-car, 18-lap races to make sure every AI
driver finishes without getting stuck or leaving the track.

---

<div align="center"><sub>All team and driver names in the paddock are fictional.</sub></div>
