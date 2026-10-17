# Petrol Rush: arcade grip driving model (spec)

Branch: `feature/grip-model` (from main 1a2098f). Status: proposal. Constants are prototype-validated, not final.
Lab code (prototype, not game code): `scratchpad/grip-lab/` (`grip.ts` model, `planner.ts` AI planner, `*.lab.ts` measurements).
Run any lab with: `cd scratchpad/grip-lab && ./node_modules/.bin/vitest run --root . --disableConsoleIntercept <name>`.

Certainty markers used below:
- **[measured]**: the number comes from a headless script in grip-lab.
- **[code]**: read from main (file:line).
- **[reasoned]**: follows from the equations, not run.
- **[uncertain]**: needs a playtest or more measurement.

---

## 0. Where we are today (verified in code and measured)

### 0.1 What limits track design [code]

| Area | Where | What it assumes |
|---|---|---|
| Turn detection | `track.ts:223` `inTurn(x) = x < CX_L \|\| x > CX_R` | Two oval half-circles. Main has no `cornerAt`; that exists only on feature/grand-prix (`common.ts` `Track.cornerAt`, `distToCorner`). |
| Corner limit | `physics.ts:141-164`, `config.ts:40-45` | `over = round(speed) − SPIN_MPH(150)`. If `inTurn` and 0 < over < 8, the car slides (yaw × 0.65, −30 mph/s, floor 146). A slide longer than 1 s spins. In a turn with over ≥ 8 the car spins after 0.15 s. The rule ignores the radius. |
| Steering | `physics.ts:139-146` | Yaw rate = `steer × min(2.9, v/34)`. At 150 mph the car can turn on an 88 px radius (740 px/s²), so the radius never limits it. |
| Lateral slip | `physics.ts:154` | `moveAngle = heading` every step outside a spin. The car has no slip state. |
| Corner assist | `physics.ts:65-73`, `state.ts:325-329` | Oval centre `CX_L/CX_R, CY`. Always negative, so left turns only. Player only. |
| Straight assist | `physics.ts:147-153` | `!inTurn` and `trackHeadingAt`. |
| SKID warning | `physics.ts:75-78` | 1 = above 150 anywhere; 2 = above 150 and `inTurn`. |
| Speed bar | `view.ts:47-68` | `speed − SPIN_MPH`, orange up to +8 (`SLIDE_SPIN_OVER`), red beyond. |
| Speedo red arc | `hud.ts:313-327` | Static at `SPIN_MPH`. |
| Cabin LEDs and tell-tale | `cabin.ts:166-175, 195` | `SPIN_MPH − 36 + 4i` ramp, `skid`, `slideTime > 0.5 × SLIDE_MAX_S`. |
| Sound and smoke | `sound.ts:31`, `particles.ts:84` | `slideTime > 0`. |
| Settings and README text | `settings.ts:118`, `README.md:121` | "above 150 MPH". |
| AI corner speed | `ai.ts:85-86, 299-301`, `config.ts:83`, `race.ts:119` | `turnMph ∈ [141,149]` in a turn. `distToTurn` comes from `S_TURN1/S_TURN2`. |
| AI lane changes | `ai.ts:260` | Not in or near turns (`distToTurn > 160`). |
| AI pit entry | `ai.ts:92-128` | Oval-specific dive at `S_TURN2`, island hull. |
| Collisions | `physics.ts:358` | `REAR_SPIN_TURN_MPH(14)` if `inTurn(v.x)`, else 22. |
| Walls | `physics.ts:225-235` | A glancing contact snaps `heading = moveAngle`. |

### 0.2 Baseline numbers [measured] (`baseline.lab.ts`, `spins.lab.ts`, `calib.lab.ts`)

Track: `TRACK_LEN` 4571.6 px, `RC` 147, `TURN_LEN` 461.8, `STRAIGHT` 1824.

**Braking and acceleration**

| Manoeuvre | Time | Distance |
|---|---|---|
| Brake 180 → 150 | 0.42 s | 117 px |
| Brake 180 → 135 | 0.63 s | 169 px |
| Brake 180 → 0 | 2.80 s | 405 px |
| Brake 150 → 0 | 2.38 s | 290 px |
| Accelerate 0 → 150 | 7.50 s | 1094 px |
| Accelerate 150 → 175 | 2.28 s | 633 px |

**Solo AI flying lap**, lane × turnMph (current model):

| turnMph | lane −28.5 (inside) | −9.5 | +9.5 | +28.5 (outside) |
|---|---|---|---|---|
| 141 | 15.65 | 16.08 | 16.52 | 16.93 |
| 145 | 15.40 | 15.82 | 16.23 | 16.65 |
| 149 | 15.18 | 15.58 | 15.98 | 16.38 |
| 150 | 15.13 | 15.52 | 15.92 | 16.33 |

The lane spread is about 1.5 s per lap. The outside lane is heavily penalised.

**Best possible clean line today** (quasi-steady-state, 150 in turns, inside kerb d = −40): **15.07 s**.

**20 cars, 18 laps:**

| Seed | Race time | Spins |
|---|---|---|
| 1234 | 434.3 s | 126 (53 car contact, 3 wall, 70 other, i.e. oil chains) |
| 7 | 383.7 s | 99 |
| 99 | 353.9 s | 32 |

- No AI spin comes from cornering.
- Median lap 22.2 s in traffic (seed 1234).
- The variance between seeds is large, so acceptance must use several seeds.

**Performance:** `stepCar` × 20 = 9.6 µs per tick.

---

## 1. Model

### 1.1 Principle

The physics step stops asking "am I in a corner?". It only knows:
- the speed `v`,
- the curvature the driver asks for with the steering,
- a grip budget `GRIP` (px/s²) shared between cornering and braking or accelerating (friction ellipse).

The cornering limit therefore falls out as `v_lim = sqrt(GRIP × r)` for any radius, on any track. The physics core needs no track query beyond `constrain` (walls), the same as today.

### 1.2 State (Car fields)

| Field | Status | Meaning |
|---|---|---|
| `heading` | existing | Body or nose direction. The cockpit camera keeps using it, so it still "turns exactly with the car". |
| `moveAngle` | existing, new meaning | Velocity direction, now a real state outside spins too. **slip** `β = wrapAngle(heading − moveAngle)`. No new field is needed for slip. |
| `speed` | existing, signed | Unchanged semantics. |
| `gripUse: number` | new | Last step's combined usage, 0…~2. It drives warnings, collisions, sound and LEDs. |
| `gripOver: number` | new | `max(0, demand − 1)` from the last step. |
| `rearLoose: boolean` | new | The rear has let go (oversteer phase). |
| `overTime` | reused | Time with demand > `U_SLIDE`. Same role as today's "over the limit" timer. |
| `slideTime` | reused | Time in a slide. Same consumers as today (smoke, screech, cabin). Reset in `startSpin` (today it stays stale during a spin). |

### 1.3 Equations (one step, forward motion, not spinning)

Units: `PXM = PX_PER_MPH = 1.7`, so `v [px/s] = speed [mph] × 1.7`. Accelerations are in px/s².

```
1. Longitudinal: exactly today's code (brake, throttle, COAST_MPH_S 8, reverse rules, fuel).
   aLong = |Δspeed| / dt × PXM               // what the tyres transmitted this step

2. If speed ≤ 0 || reverse || v < MIN_V (20 px/s ≈ 12 mph):
   use today's kinematic steering (heading += steer·rate·dt·sign), moveAngle = heading,
   gripUse = gripOver = 0, rearLoose = false.
   This branch serves reverse, the pit box and stopped cars.

3. Grip budget (friction ellipse):
   fLong = aLong / (BRAKE_MPH_S_HIGH × PXM)          // 0..1, full braking at top speed = 1
   muAv  = GRIP × surface × sqrt(max(0, 1 − (FC_K·fLong)²))

4. Driver demand:
   kMax = min(1/MIN_TURN_RADIUS, MAX_TURN_RATE / v, STEER_CAP·GRIP / v²)
   kCmd = steer · kMax                               // signed curvature asked for
   aCmd = v² · kCmd
   u    = |aCmd| / muAv,   over = max(0, u − 1)
   overTime = u > U_SLIDE ? overTime + dt : 0

5. Course (velocity direction): the tyres turn the velocity with at most muAv
   aLat = clamp(aCmd + ALIGN · v · β, −muAv, +muAv)  // ALIGN term: a slipping car's velocity is pulled toward the nose
   moveAngle += aLat / v · dt

6. Yaw (nose):
   rearLoose = |β| > LOOSE_SLIP || (over > 0 && (brake || !gas)) || overTime > SPIN_GRACE_S
   yaw = sign(kCmd) · min(|v·kCmd|, muAv / v)           // the front is grip-limited: the nose never out-turns the front tyres
   if rearLoose:
       yaw += sign(kCmd) · OS_KICK · min(over, 0.5)                          // rear steps out
       yaw += sign(β) · LOOSE_GAIN · max(0, |β| − LOOSE_SLIP)                // a loose rear feeds itself
   heading += yaw · dt
   β = wrapAngle(heading − moveAngle)

7. Scrub (tyres sliding cost speed):
   drag = muAv · (SCRUB · min(over, 1) + SLIP_DRAG · |sin β|)
   speed = max(0, speed − drag / PXM · dt)

8. Bookkeeping:
   gripOver = over
   gripUse  = max(u, hypot(|aLat|/(GRIP·surface), FC_K·fLong))
   sliding  = over > SLIDE_OVER_MIN (0.05) || |β| > SLIDE_SLIP_MIN (0.08)
   slideTime = sliding ? slideTime + dt : 0
   if |β| > SPIN_SLIP → startSpin(car, SPIN_RATE, sign(β))   // existing startSpin, crashes++, oil, events
```

The position update (`x += cos(moveAngle)·dist`), fuel, `constrainPos` and `applyWall` stay as they are.

### 1.4 How it behaves

**Under the limit** (`u ≤ 1`):
- The nose and the velocity turn together.
- Any leftover β decays with time constant `1/ALIGN` (≈ 0.17 s).

**Understeer:**
- When `aCmd > muAv` with the rear holding, the velocity turns at most at `muAv/v`, and the nose follows it, so β stays about 0.
- The car runs wide and scrubs speed. That is the default outcome of "too fast for this radius".

**Oversteer:**
- The rear lets go if you lift or brake while over the limit, if you stay above `U_SLIDE` for more than `SPIN_GRACE_S`, or if β is already beyond `LOOSE_SLIP`.
- β then grows: tail out, smoke, screech.

**Countersteer catch:**
- Steering against β gives a yaw of the opposite sign, up to `muAv/v` (≈ 1.8 rad/s at 160 mph). That beats the `LOOSE_GAIN` growth while |β| is moderate.
- Once |β| < `LOOSE_SLIP`, ALIGN pulls the velocity back to the nose.

**Spin:**
- Happens only when |β| exceeds `SPIN_SLIP` (43°).
- Measured outcomes are in 6.2.

**Braking and throttle and grip:**
- Full braking at top speed leaves `sqrt(1 − 0.6²) = 80 %` lateral grip. At 100 mph it leaves about 88 %. Full throttle leaves ≥ 97 %.
- Trail-braking at the limit therefore pushes you over it, and the rear steps out (lift-off or brake oversteer).
- Braking in a straight line before the corner costs nothing.

### 1.5 Constants (proposed defaults)

| Constant | Value | Notes |
|---|---|---|
| `GRIP` | **500** px/s² | See 1.6. |
| `FC_K` | 0.6 | Share of grip that full braking takes. |
| `ALIGN` | 6 /s | |
| `STEER_CAP` | 1.5 | Full lock never asks for more than 1.5 × GRIP. Binds only above about 165 mph; below that, `MAX_TURN_RATE` binds. See open question Q3. |
| `U_SLIDE` | 1.35 | |
| `SPIN_GRACE_S` | 0.35 | |
| `OS_KICK` | 1.5 rad/s | |
| `LOOSE_SLIP` | 0.22 rad (12.6°) | |
| `LOOSE_GAIN` | 3 /s | |
| `SPIN_SLIP` | 0.75 rad (43°) | |
| `SCRUB` | 0.25 | |
| `SLIP_DRAG` | 0.35 | |
| `MIN_V` | 20 px/s | |
| `SLIDE_OVER_MIN` | 0.05 | |
| `SLIDE_SLIP_MIN` | 0.08 | |
| `WARN_USE` | 0.9 | |

**Kept unchanged:**
- `MIN_TURN_RADIUS` 34: needed for the pit box at low speed.
- `MAX_TURN_RATE` 2.9.
- All longitudinal constants.
- `SPIN_*` spin mechanics, `startSpin` and `endSpin`.

**Removed** after migration: `SPIN_MPH`, `SPIN_GRACE_S` (old meaning), `SLIDE_SPIN_OVER`, `SLIDE_GRIP`, `SLIDE_DECEL_MPH_S`, `SLIDE_MAX_S`, `CORNER_ASSIST_MIN_MPH` (kept as the assist gate, see 2), `AI_TURN_MPH` (kept as the RNG source, see 4.4).

### 1.6 Calibration: limit speed vs radius

Formula:

```
V_lim(r) [mph] = sqrt(GRIP · r) / PX_PER_MPH        (capped by MAX_MPH 180)
```

**Table at GRIP = 500** [reasoned from the formula; sim column measured with `circle.lab.ts`, "ideal" driver holding radius ±4 px, no slide]:

| Radius (px) | V_lim formula | Sim max clean | Note |
|---|---|---|---|
| 60 | 101.9 mph | 100.0 | GP-style hairpin (not on GP today; GP R_MIN 120) |
| 100 | 131.5 | 126.0 | |
| 150 | 161.1 | 153.0 | ≈ oval centre line (147: 159.5) |
| 250 | 208.0 → **180** (flat out) | 180 | |
| 400 | 263.1 → **180** (flat out) | 180 | |

**Oval lines at GRIP 500:**

| Line | Radius | Limit |
|---|---|---|
| Inside kerb (car centre) | 107 | 136.0 mph |
| Inside lane | 118.5 | 143.2 |
| Centre | 147 | 159.5 |
| Outside lane | 175.5 | 174.3 |
| Outside wall (car centre) | 187 | 179.9 |

So the outer lane is **not** above `MAX_MPH` (the critic's concern holds only for a GRIP of about 600).

The sim runs 2–5 % under the formula because the test driver's radius feedback adds demand. Acceptance allows −6 %…0 %.

**Lap time vs GRIP** [measured, `calib.lab.ts`, quasi-steady-state with today's accel and brake curves; best line = outside → inside apex at 40 % of the turn → outside, 200 px transitions]:

| GRIP | V(147) | Lanes d = −40 … +40 (s) | Best line (s) | Apex speed | vs today's best 15.07 |
|---|---|---|---|---|---|
| 442 | 149.9 | 16.39 … 16.08 | 15.67 | 146.9 | +4.0 % |
| 480 | 156.3 | 16.02 … 15.85 | 15.36 | 153.1 | +1.9 % |
| **500** | **159.5** | **15.85 15.72 15.60 15.58 15.67 15.76** | **15.22** | **156.2** | **+1.0 %** |
| 520 | 162.6 | 15.68 … 15.76 | 15.09 | 159.3 | +0.1 % |

**Choice: 500.** It is a compromise between "corner ~150 mph" (apex 156) and lap-time parity (+1 %).
- Calibrating exactly to 150 at the centre line (442) costs +4 % per lap. That is outside the ±3 % target.
- This is decision **Q1** for the user.

**Fuel:** fuel use is distance-based (`physics.ts:170`), so fuel strategy is unchanged. A racing line is about 1 % longer than the inside lane; that is a negligible change in range.

---

## 2. Steering for digital input (keyboard and touch)

Touch steering is digital too (hold buttons, `touch.ts:52-53`), so one path serves both.

1. **SteerRamp stays** (`physics.ts:39-63`, tested in `physics.test:85`).
   - Its `turn` flag becomes `|κ_road(s)| > 0` from the curvature table (2.4) instead of `inTurn(x)`.
2. **Corner assist becomes curvature feed-forward**, which is track-shape independent:
   ```
   κ_lane = laneCurvature(track.curvatureAt(s), d)      // d = car.d
   assist = clamp(CORNER_ASSIST · κ_lane / kMax(v), −1, 1)
   ```
   - Same gates as today: speed ≥ `CORNER_ASSIST_MIN_MPH` 40, not reverse, not spinning, not on the pit side in the pit lane.
   - Same `CORNER_ASSIST` 0.3 and `CORNER_ASSIST_IN_S` blend.
   - The sign comes from κ, so right-hand corners work. Today the assist is left-only.
   - It needs no corner centre.
3. **Straight assist**:
   - Condition: `steer == 0`, `κ_road(s) == 0`, |heading error| < 7°.
   - It rotates **both** heading and moveAngle by the same step, so a slip in progress is not erased.
4. **`MIN_TURN_RADIUS` and `MAX_TURN_RATE`** remain the steering envelope (`kMax`). `STEER_CAP` adds the speed cap.
5. **Measured with a keyboard bot** (`keys.lab.ts`): bang-bang keys, dead-band 0.35, ramp and assist on the −9.5 lane, braking to the planner at grip fraction f.
   - 0 spins for f = 0.95 … 1.2.
   - Laps 16.3 → 15.9 s.
   - The bot micro-slides about 12 % of the lap. Warnings and sound therefore need the hysteresis above (`SLIDE_OVER_MIN`, `SLIDE_SLIP_MIN`), and the screech should scale with `gripUse`, not switch on with `slideTime > 0`.
   - [uncertain] whether a human finds the full-lock behaviour (STEER_CAP 1.5) too punishing. That is decision **Q3**.

---

## 3. Warnings (SKID lamp, cockpit LEDs and tell-tale, speed bar, speedo)

The user earlier said "leave SKID logic alone", but its definition is corner-based, so it cannot survive unchanged. The minimal equivalent (**decision Q4**) keeps the two levels and the visuals and only redefines the triggers:

| Level | Today | Proposed |
|---|---|---|
| 0 | ≤ 150, or spinning | Not 1 or 2, or spinning. |
| 1 (steady red) | > 150 anywhere | "Too fast for the next corner": `speed > V_ref + 0.5`, where `V_ref = V_lim` of the tightest curvature on the car's current d within the look-ahead `L = max(300, v²/(2·b)+60)` (same table walk as the AI planner, grip fraction 1.0). On a straight above the next corner's speed this is lit, like today's "above 150 on the straight". If no corner lies ahead, `V_ref = MAX_MPH`. |
| 2 (blinking) | > 150 and `inTurn` | Over the limit now: `slideTime > 0` (hysteresis as in 1.3). |

**Speed bar** (`view.ts:47-68`):
- `over = speed − V_ref` (same mph units).
- Orange band = 0 … `SLIDE_BAND = 0.05·V_ref` (≈ 8 mph at 160, the same as today's 8).
- Red beyond it. In 6.2, ≥ +10 % with full lock spins, so 5 % is the honest "recoverable" band.

**Speedo red arc** (`hud.ts:313-327`):
- Starts at `V_ref`, smoothed (0.3 s), instead of the static 150.
- Alternative: keep it static as decoration. **Q5**.

**Cabin LEDs** (`cabin.ts:173`):
- `mph ≥ V_ref − 36 + 4i`, i.e. the same ramp relative to `V_ref`.
- The edge amber flash becomes `slideTime > 0.5` s (new constant `CABIN_SLIDE_FLASH_S`).
- Skid tell-tale unchanged (it reads `skid`).

**Texts:** `settings.ts:118`, `README.md:121` and help get rewritten from "above 150 MPH" to "faster than the next corner allows".

`V_ref` is computed once per frame for the player in `state.ts` and passed where `skid` is passed today. Cost: one table walk (≈ 1.4 µs).

---

## 4. AI

### 4.1 Speed planning from curvature (replaces `turnMph` caps, `ai.ts:85-86, 299-301`)

```
b = BRAKE_MPH_S · BRAKE_FRAC(0.75)          // same planning decel as today
range = max(120, v²/(2·b·PXM) + 60)  px
target = MAX_MPH
for ds in 0..range step 8 px:
    k = table.at(s + ds); if k == 0 continue
    d = ds < 40 ? car.d : laneD
    dIn = d − sign(k)·... (PATH_MARGIN 12 px toward the inside; the pursuit steering cuts the chord)
    vc = sqrt(GRIP · f / |laneCurvature(k, dIn)|) / PXM
    target = min(target, sqrt(vc² + 2·b·ds/PXM))
```

- `f` is the driver's grip fraction (4.4).
- The result is combined with the existing traffic, oil and pit targets through `min()`, as today.
- **Lane changes** (`ai.ts:260`): the condition `!turnNow && distToTurn > 160` becomes "no curvature within 160 px ahead and none at the car".
- **Line choice:**
  - Phase 1 keeps the four lanes. With grip, the lane lap times are much closer (spread 0.5–0.6 s vs today's 1.5 s), so overtaking around the outside becomes viable.
  - An optional racing-line offset (outside → apex → outside when no traffic) is phase 2. **Q7**.

### 4.2 Measured with the prototype [measured, `race-grip.lab.ts`, GRIP 500]

**Solo AI flying laps** (s):

| turnMph | lane −28.5 | −9.5 | +9.5 | +28.5 |
|---|---|---|---|---|
| 141 | 17.00 | 16.70 | 16.50 | 16.37 |
| 145 | 16.73 | 16.43 | 16.25 | 16.13 |
| 149 | 16.47 | 16.18 | 16.00 | 15.93 |

- Mean at turnMph 145: today 16.03 → new 16.39 (**+2.3 %**).
- Max grip use 0.86–0.99, zero slide frames, zero spins.

**20 cars, 18 laps:**

| Seed | Today | New | Pit stops | Unfinished | Wall violations | Spins (contact / wall / oil / grip) | Slide frames |
|---|---|---|---|---|---|---|---|
| 1234 | 434.3 s | 357.2 s | 21 | 0 | 0 | 29 / 2 / 23 / **0** | ≈ 1 % |
| 7 | 383.7 s | 381.3 s | 21 | 0 | 0 | 36 / 1 / 32 / **0** | ≈ 1 % |
| 99 | 353.9 s | 343.8 s | 20 | 0 | 0 | 19 / 0 / 23 / **0** | ≈ 1 % |

- Races get shorter mostly because there are fewer contact and oil chains (today 126 / 99 / 32 spins, new 54 / 69 / 42).
- [uncertain] Part of that comes from more even lane speeds (less closing speed at turn entry). It needs a check that racing is not duller. Playtest item P8.
- **Determinism:** the same seed gives identical x, y, heading and moveAngle after 18 laps [measured].
- **Performance:** grip `stepCar` × 20 = 9.9 µs vs 9.6 µs today. `planSpeed` × 20 = 27 µs at 8 px sampling (can be halved with 16 px sampling or a precomputed per-lane brake envelope).
  - Physics makes one track query per car per step (`constrain`).
  - The planner, assist and warnings read a precomputed `Float32Array`, which is not a track query.
  - This is within the critic's budget (< 50 µs, ≤ 2 queries).

### 4.3 Pit entry and autopilot (`ai.ts:92-128`)

**Finding [measured]:** 439 of 38,939 pit-phase frames slid (1.1 %). Cause: the `entering` dive to `−HALF_W+9` and then to `pitPathR` starts at `S_TURN2` at up to 149 mph. A lane change inside a corner adds path curvature that lane-based planning does not see.

Fix:
- (a) Move the pit decision and the inside-lane move onto the straight before the turn: a `decideAt` window ending ≥ 200 px before the curvature starts. On GP this is `pit.decideAt`.
- (b) While `entering`, plan speed with the pit path's own radius (`pitPathR(phi)` on the oval; on GP, `pit.plan` returns its own radius) using the same `V_lim` formula at f × 0.9.

Acceptance: 0 slide frames and 0 spins in pit phases.

Pit-lane speeds (≤ 75 mph) are far below the limit for r ≥ 44 px (`V_lim(44) = 87 mph`), and the low-speed kinematic branch covers the box manoeuvres.

The player pit autopilot (`race.ts:189-210`) uses the same `aiInput` and inherits both fixes.

### 4.4 Driver skill and the RNG order (critic point 4)

**Decision: preserve the RNG call order.**
- `race.ts:119` keeps drawing `turnMph` from `AI_TURN_MPH [141,149]`.
- The AI derives `f = (turnMph / 150)²`, which is 0.884–0.987.
- Grid, top speed, pit fuel laps and reaction stay identical for every seed. Races still differ because the physics differs.
- The field can be renamed later (`gripFrac` computed at creation, same draw) without touching the order.

### 4.5 Track contract (works for the grand-prix segment tracks)

```ts
interface Track {
  // existing on GP: len, wrapS, deltaS, pointAt, project, headingAt, constrain, pit, ...
  /** Signed centre-line curvature (1/px) at s; + = heading increases (clockwise on screen). 0 on straights. */
  curvatureAt(s: number): number;
}
// shared (src/track/curvature.ts):
export function laneCurvature(k: number, d: number): number { return k / (1 - k * d); } // d + = right of travel
export class CurvatureTable { constructor(len, curvatureAt, step = 4); at(s): number }  // built once per track
```

**Oval:** `−1/RC` for `s ∈ [S_TURN1, S_TURN1+TURN_LEN) ∪ [S_TURN2, S_TURN2+TURN_LEN)`, else 0 [code: turns are left, heading decreases, `pointAt` `track.ts:183-196`].

**GP SegmentTrack:**
- `arc → dir / r`, `line → 0`.
- Sign verified against `segPoint`: heading = `phi + dir·π/2`, `phi = phi0 + dir·u/r`.
- d is positive to the right of travel on both tracks: oval left turns put d+ outward, GP `rad = r − dir·d`.

`cornerAt` and `distToCorner` are no longer needed by physics, the assist or the AI. They can stay on GP for the pit or renderer, or be deleted.

**Limitation:** curvature is piecewise-constant (no clothoids), so demand jumps at arc entry. The 0.15 s assist blend and the planner's look-ahead absorb it. Tracks with transitions would need to implement `curvatureAt` as a ramp; the table handles any function.

---

## 5. Collisions, walls, oil, spins

- **Slip and car contact:**
  - `velocity()` / `setVelocity()` (`physics.ts:241-253`) already use `moveAngle`, so slip is handled correctly.
  - A non-spinning car keeps its course and loses the lateral impulse, as today. Decision: keep it.
  - `zoneOf` uses `heading` (the body), which is correct with slip.
- **Rear-hit threshold** (`physics.ts:358`): replace `inTurn(v.x)` with "the car is loaded":
  ```
  closing > (v.gripUse ≥ REAR_SPIN_LOADED_USE (0.7) ? REAR_SPIN_TURN_MPH : REAR_SPIN_MPH)
  ```
  On the oval, AI corner use is 0.86–0.99 and straight use is about 0, so this matches today's behaviour [measured use values].
  - Alternative (phase 2, **Q8**): turn hits into a yaw or slip kick and let the grip model decide whether the car spins. More emergent, but it changes collision balance.
- **Walls:** keep the glancing snap `heading = moveAngle = tangent` (`physics.ts:225-235`). A wall graze therefore straightens the car and kills slip.
  - Arcade-friendly, and it guarantees no wall-induced grip spins.
  - The hard-impact rule `WALL_CRASH_MPH` 45 is unchanged.
  - Running wide in understeer meets the outer wall at a glancing angle. Prototype: 0–3 wall spins per race, same as today.
- **Spins:** `startSpin` and `endSpin` are unchanged. `endSpin` sets `moveAngle = heading`, so slip is 0 after a spin. `startSpin` also zeroes `slideTime`, `overTime` and `rearLoose`. The spin's rising edge still triggers oil and events (`race.ts:167-173`).
- **Oil:** unchanged. A slick still calls `startSpin` and the owner is immune (`race.ts:232`, user requirement).
  - Alternative (**Q9**): oil as a low-grip surface (`surface = 0.3` while inside the slick). A straight-line crossing then survives, and cornering on oil spins. The hook (`surface`) is already in the equations.
- **Reverse:** kinematic branch as today. Holding Down/S → brake → reverse (`state.ts:106-122`) is untouched, and so is coasting with `COAST_MPH_S` 8.
- **Cockpit camera:** unchanged. It follows `heading` (`fpv/view.ts:707`), so during a slide the view points along the nose and the world slides sideways. During spins it still turns exactly with the car.

---

## 6. Test plan

### 6.1 Harness (no GP port needed)

- `stepCar(car, input, dt, constrain = constrainPos)`: an optional wall function. Tests pass `() => null` for open-plane curves.
- `tests/sim/curves.ts`: a minimal `CurveTrack` that implements `curvatureAt`, `pointAt` and `project` for a list of `{len, k}` pieces. Fixtures:

| Fixture | Pieces |
|---|---|
| circle(r) | r ∈ {60, 100, 120, 147, 200, 250, 400} |
| hairpin | r 60, 180° |
| chicane | r 120 left 60°, 40 px straight, r 120 right 60° |
| S-bend | r 150, ±90° |

- Drivers:
  - **ideal**: feed-forward + radius feedback.
  - **insist**: same, saturating.
  - **keys**: full lock held.
  - **catch**: countersteer when |β| > 0.1.
  - **ai**: the real planner and pursuit.
  - **keyboard bot**: SteerRamp + assist, bang-bang.
- Lab scripts in `scratchpad/grip-lab` are the reference implementations.

### 6.2 Acceptance numbers (prototype results in brackets)

| # | Test | Accept | Prototype |
|---|---|---|---|
| A1 | Max clean speed vs formula, r ≤ 200 | −6 %…0 % | −1.7…−5.2 % |
| A2 | r ≥ 250 | Flat out at 180, no slide | yes |
| A3 | 0.95 × V_lim, ideal driver | 0 slide frames, radius error < 1 px | 0, 0.3 px |
| A4 | 1.05 ×, insisting or full lock, throttle held, 4 s | Slides, **no spin**, runs wide ≤ 30 px | slip 22–28°, wide 15–19 px |
| A5 | ≥ 1.10 ×, full lock or insisting, throttle held or lifted | Spin within 0.6–1.5 s | 0.70–1.20 s |
| A6 | Countersteer driver, entry 0.95–1.25 ×, any throttle | 0 spins | 0 of 18 |
| A7 | At limit, full lock + lift or brake | Visible oversteer, β ≥ 8°, no spin | 13.6–17.6°, no spin |
| A8 | Chicane, hairpin, S-bend with the AI driver | 0 spins, max `gripUse` ≤ 1.0, no wall contact | to run |
| A9 | Narrow corridor (wall at r + 20): entering 1.1 × must not beat 1.0 × (slide costs time) | t(1.1) ≥ t(1.0) | to run |
| A10 | Oval solo AI lap, mean over lanes at turnMph 145 | Within ±3 % of 16.03 s | 16.39 (+2.3 %) |
| A11 | Best clean line (QSS) | Within ±3 % of 15.07 | 15.22 (+1.0 %) |
| A12 | 20 cars × 18 laps, seeds 1234/7/99/42/2024 | 0 unfinished, 0 out-of-bounds, 20–40 pit stops, 0 grip spins by AI, race time ≤ today + 5 % per seed | 0/0/20–21/0, −18…−1 % |
| A13 | Pit phases | 0 spins, 0 slide frames | 439 slide frames, so fix 4.3 is needed |
| A14 | Determinism | Same seed gives bit-identical x, y, heading, moveAngle, speed after 20 s and after a full race | yes |
| A15 | Perf guard | `stepCar` × 20 ≤ 15 µs; `planSpeed` × 20 ≤ 30 µs (not CI-strict; log it) | 9.9 / 27 |
| A16 | Braking 180 → 150 | < 0.5 s (existing test) | unchanged |
| A17 | Preserved user requests | Coast rate, reverse-by-hold, own-oil immunity, cockpit spin turn: existing tests pass unchanged | n/a |

### 6.3 Existing tests (from the critic's list, re-checked)

**Keep unchanged:**
- Determinism `race.test:106`.
- Coasting `physics:101`, brake and reverse `physics:59/68/114/126`, top speed, out of fuel.
- Own oil (race), pit autopilot (race), straight-line collisions, classification, traffic jam.
- Cockpit spin flash, particles.

**Change on purpose:**

| Test | Change |
|---|---|
| `physics:29` (slight overspeed slides) | Becomes A4 on the oval at 1.05 × V_lim(car.d). |
| `physics:44` (165 spins) | Becomes A5. |
| `physics:48` (corner assist) | Becomes: assist sign follows κ; 0 on straights; 0 below 40 mph; right-hand curve gives positive assist. |
| `physics:55` (no slide at 150) | Becomes: no slide at 0.95 × V_lim. |
| `physics:78` (skid lamp) | Becomes the new level-1 and level-2 definitions. |
| `fpv:122` (LEDs) | Relative to `V_ref`. |

**At risk (re-run and adjust only if the intent still holds):**
- `physics:181` (stays turned after a crash): still true, because the straight assist only acts below 7°.
- `physics:204` (corner rear hit): must set `gripUse` or step the car first.
- `physics:219` (lane-change blame).
- `physics:85` (ramp).
- `physics:94` (straightening): must still pass with both angles rotated.
- `race:69` (20-car race), `race:149`, `race:246`.

### 6.4 Playtest checklist (designer or tester; both cameras, keyboard and touch)

- **P1:** Flat out into turn 1 without braking: the car runs wide, scrubs and brushes the wall or spins. It must be clearly slower than braking.
- **P2:** Brake late, turn in hard: oversteer is visible. A quick countersteer catches it; holding the steer spins it.
- **P3:** Lift mid-corner at the limit: the tail steps out a little and is catchable.
- **P4:** Tap-steering through the oval turns: you can hold a line at about 150–156 mph. The SKID lamp blinks only when you are really sliding, not on every tap.
- **P5:** Outside-lane overtake in a turn is possible against an AI on the inside.
- **P6:** Cockpit view: a slide reads as the world sliding sideways, no nausea. A spin still turns exactly with the car.
- **P7:** HUD and cockpit: lamp, speed bar, speedo arc and LEDs agree with each other and with what the car does.
- **P8:** A 20-car race is still eventful (contact, oil). It is not a procession.
- **P9:** Pit in: the autopilot dives smoothly, no slide.
- **P10:** Reverse by holding Down/S, coasting off-throttle and your own oil all feel as before.
- **P11:** Touch: same as P2–P4 on a phone.

---

## 7. Risks, alternatives, migration, merge plan

### 7.1 Risks

| Risk | Mitigation |
|---|---|
| Feel regressions with keyboard (micro-slides, screech spam) | Hysteresis, use-scaled screech, playtest P4. Q3 decides STEER_CAP. |
| Races get calmer (fewer spins) | Measure P8. Tune `REAR_SPIN_LOADED_USE` or oil. |
| Lane equalisation changes race dynamics | Positive per the user's goal, but watch it. |
| The GP branch has its own 150-mph assumptions | `segment.ts:42 R_MIN 120`, the physics test "every corner at 150 on the inside lane, 165 spins", bit-exact oval golden snapshots. See 7.4. |
| Hidden users of `moveAngle == heading` | Grep found collisions, walls and particles (`cvx`). Particles use velocity, which is fine. Cars rendered by `heading` show the slip angle, which is intended. |
| Tuning constants interact (scrub vs spin timing) | Keep all constants in `CONFIG.GRIP_MODEL`. The lab scripts are the regression harness. |

### 7.2 Alternatives considered

**A. Proposed:** slip-state "bicycle-lite" (course vs nose), grip budget plus friction ellipse.
- Works well for: radius independence, real understeer / oversteer / catch, AI planning from one formula, cheap (+0.3 µs).
- Struggles with: more constants to tune, and the keyboard micro-slide noise needs hysteresis.

**B. Minimal: radius-aware speed rule.**
- Keep today's kinematic car and slide/spin bands, but replace `SPIN_MPH` with `V_lim(r)`, where `r = v / yawRate` is measured from the actual path.
- Works well for: tiny diff, today's feel and tests mostly kept, track independent.
- Struggles with: still rule-based (no understeer drift or countersteer catch; spin direction from steer sign), noisy r estimate on keyboard taps. Does not meet "can be caught with countersteer".

**C. Full dynamic bicycle model** (tyre slip angles, Pacejka-lite, yaw inertia, load transfer).
- Works well for: realism, emergent behaviour.
- Struggles with: digital input (needs fine modulation), stability at 60 Hz with small radii, hard AI control, much harder tuning. Overkill for an arcade top-down game.

**D. Limit-normalised steering only** (full key = exactly the grip limit, never over).
- Works well for: keyboard and touch, simplest to learn.
- Struggles with: no consequences except running wide, so it makes driving easier, which the user explicitly does not want. Available as `STEER_CAP ≈ 1.1` inside A (Q3).

### 7.3 Migration (small commits on feature/grip-model; never push main without asking)

Each commit must pass the existing tests unless it says otherwise.

1. **Track curvature.**
   - `curvatureAt` on the oval, `laneCurvature`, `CurvatureTable`.
   - Tests for sign and values; d+ is right of travel.
   - No behaviour change.
2. **Physics harness.**
   - Optional `constrain` parameter on `stepCar`, `tests/sim/curves.ts`.
   - Golden snapshot of the current model (x, y, heading, moveAngle per car at t = 20 s, seed 99), so the "classic" path is pinned.
3. **Grip model behind a flag.**
   - `CONFIG.DRIVE_MODEL: 'grip' | 'classic'` (default `'classic'`), the new Car fields, `stepCar` lateral branch, `startSpin` reset.
   - Circle tests A1–A7.
4. **AI planner.**
   - `planSpeed` from the table, grip fraction from `turnMph` (RNG order kept), lane-change gate on curvature, pit-entry fix 4.3.
   - Race tests A10–A14 run under `'grip'`.
5. **Player input.** Curvature assist, ramp flag, straight assist on both angles.
6. **Collisions.** `REAR_SPIN_LOADED_USE`.
7. **Warnings and UI.** `V_ref`, `skidWarning`, speed bar, speedo arc, LEDs, screech scaling, texts.
8. **Flip default to `'grip'`.**
   - Update the intentional tests (6.3).
   - Re-record the golden snapshot.
9. **Tuning pass** after playtest P1–P11.
10. **Remove `'classic'` and the dead constants** (only after user sign-off, Q2).

### 7.4 Sequencing with feature/grand-prix

- Land the grip model on main first; the oval is enough to calibrate.
- Then merge main into feature/grand-prix.
- Expected conflicts: `physics.ts`, `ai.ts`, `state.ts`, `config.ts`, tests.

Resolution on GP:

| Item | Resolution |
|---|---|
| `SegmentTrack` | Implements `curvatureAt` (arc: dir/r, line: 0). |
| `cornerAt` / `distToCorner` | Users switch to the table. |
| `R_MIN = 120` (`segment.ts:42`) | Loses its "150 on the inside lane" meaning. Replace it with a geometric minimum (e.g. 60 px: the inside-lane car centre stays off the kerb and the planner gives ≥ 100 mph) or keep 120 as a design guideline. **Q6.** |
| GP test "every corner at 150 on inside lane / 165 spins" | Replaced by "AI completes each GP circuit, 0 grip spins, max use ≤ 1.0" plus the circle fixtures. |
| Oval golden bit-exact snapshots | Re-recorded on purpose in the merge commit, with a note. |
| GP pit (`straightPit.ts`) | Implements `decideAt` before curvature, per 4.3. |

---

## 8. The critic's "must answer" list: decisions

| Item | Decision / answer |
|---|---|
| State: slip or kinematic clamp? | **Slip.** `moveAngle` becomes the true velocity direction. Kinematic only below 12 mph, in reverse, or at speed ≤ 0. Walls keep the glancing snap. Collisions keep `setVelocity` along `moveAngle`. `endSpin` sets slip to 0. |
| Grip constant and outer-lane speed | **GRIP 500 px/s².** V(147) = 159.5. Inside lane 143.2, outside lane 174.3, outer wall 179.9 (≤ MAX 180). Best lap +1.0 %, AI +2.3 %. Q1 for the user (442 / 480 / 500 / 520 table in 1.6). |
| Understeer / oversteer / spin thresholds and triggers | 1.3 + 1.5: understeer when demand > budget with the rear holding. The rear lets go on lift or brake while over, on demand > 1.35 for 0.35 s, or on |β| > 12.6°. Spin at |β| > 43°. Measured outcomes A3–A7. |
| Track contract | `curvatureAt(s)` only, plus shared `laneCurvature` and `CurvatureTable`. Physics stays track-agnostic apart from `constrain` (keep the current import on main; on GP, `stepCar(car, input, dt, track.constrain)`). |
| Assist / ramp / straight assist / MIN_TURN_RADIUS | All kept, made curvature-based (section 2). MIN_TURN_RADIUS and MAX_TURN_RATE kept as the envelope, plus STEER_CAP. |
| AI | `f = (turnMph/150)²`, RNG order kept. Planner from curvature look-ahead with today's 0.75 × BRAKE decel. Lanes kept; racing line is phase 2 (Q7). Pit-entry fix. |
| Collisions with slip | Correct already via `moveAngle`. Rear-hit threshold by `gripUse ≥ 0.7`. Yaw-kick variant is Q8. |
| HUD / cockpit semantics and texts | Section 3, decision Q4 / Q5. |
| Sequencing with grand-prix | 7.4: main first, then merge into GP, with `R_MIN` decision Q6. |
| Acceptance numbers | 6.2. |
| Budget | Measured 9.9 µs physics + 27 µs planner for 20 cars; 1 track query per car per step. |

---

## 9. Open questions for the user

- **Q1. Grip level.**
  - Options:
    - 500 (recommended: apex about 156 mph, best lap +1 %, AI +2.3 %).
    - 442 (exactly 150 on the centre line, laps +4 %).
    - 520 (lap parity, corners about 160 mph).
  - Which matters more to you: the "150 in the corner" number or the lap times?
- **Q2. Flag.** Ship behind `DRIVE_MODEL` for A/B playtests and delete `'classic'` after sign-off, or switch over hard?
- **Q3. Full-lock punishment (keyboard and touch).**
  - `STEER_CAP` 1.5 (recommended): holding full lock above about 10 % over the limit spins in about 1 s. Same severity as today's "above 158 mph".
  - 1.1–1.2: holding the key can never spin you; you only run wide.
- **Q4. SKID semantics.** Accept the minimal re-definition: level 1 = faster than the next corner allows, level 2 = sliding now? Or prefer "brake now" (predictive) or a pure grip-usage lamp?
- **Q5. Speedo red arc.** Dynamic (starts at the next corner's limit speed), or static decoration?
- **Q6. Grand-prix `R_MIN`.** Keep 120 as a design rule, or allow tighter corners (60–100 px hairpins at about 100–130 mph), which the new model makes possible?
- **Q7. AI racing line.** Phase 1 keeps the four lanes, now nearly equal in time. Add an AI racing line (outside, apex, outside) later?
- **Q8. Collisions.** Keep spin-by-threshold (now "loaded car" instead of "in turn"), or move to hits that add slip and let the grip model decide?
- **Q9. Oil.** Keep "oil = instant spin" (as now), or make oil a low-grip surface (straight crossing survivable, cornering on oil spins)?
- **Q10. Fewer AI spins.** The prototype races have about 45 % fewer spins (no grip spins; fewer contact chains). Is a calmer field acceptable, or should contact or oil sensitivity be raised to keep today's chaos level?
