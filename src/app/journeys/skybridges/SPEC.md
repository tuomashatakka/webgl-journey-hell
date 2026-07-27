# SKYBRIDGES — Scene Specification

A first-person run across a continuous chain of luminous glass skybridges suspended
above a cloud sea, with skyscrapers rising from the haze in the distance. The path
is **one unbroken journey** that morphs through **nine themed sections**, linked by
physically-grounded vertical maneuvers (climbs, jumps, a fall). Implemented as a
single-pass raymarched WebGL 1.0 / GLSL ES 1.00 fragment shader (`shader.ts`).

---

## 1. Conventions

| Quantity | Value | Notes |
|----------|-------|-------|
| Units | 1 unit ≈ 1 metre | |
| Forward speed | `SPEED = 7.5` u/s | constant along the path Z axis |
| Loop length | `LOOP_Z = 540` | nine 60-unit sections; seams crossfade |
| Section time | `(z - startZ) / SPEED` ≈ 8 s | per section |
| Gravity | `g ≈ 18 u/s²` | snappy-but-plausible (≈1.8× Earth for game feel) |
| Eye height | `1.6` u above the deck | first-person |
| Deck width | `3.2` u (half 1.6) | main path |

**Camera model — FIRST PERSON.** The camera *is* the runner. Position
`ro = (laneSway, camY(z), playerZ())`; `camY` is authored piecewise (Section 4).
Forward heading follows the path; scripted glances (look back at a collapse, look
down on a jump, snap up on a climb) layer on top, plus subtle run-bob and
pointer free-look (`uPointer`).

**World-Z band geometry.** Each section's signature structure lives in a fixed Z
band of world space. As the camera advances it physically enters each scene; the
raymarch only reaches `MAX_DIST` ahead, so each frame evaluates just the local
band — no per-pixel blend of nine geometries.

**Collapse-behind.** Every main-deck segment the runner passes begins to fall on
a per-segment delay (`segmentFall`): a whole-slab tip far away, a shattering glass
shard-field up close. Glancing back reveals the deck dropping into the cloud sea.

---

## 2. Lighting, sky & material

### Sky
- Rich vertical gradient (warm horizon → deep cool zenith), mood-tinted per section.
- Sun disc + glow in the key direction; broad atmospheric bloom.
- Drifting FBM cloud bands above the horizon, lit on the sun-facing side.
- **Cloud sea** below the horizon: a luminous FBM floor the bridges float over.
- **Distant skyline:** skyscraper silhouettes rising out of the cloud sea on the
  horizon (parallax heightfield in `skyBg`), plus a few real far SDF towers that
  the runner passes near junctions.

### Glass (see-through)
- **Refraction**: `refract(rd, n, 1/IOR)`, IOR ≈ 1.45.
- **True see-through (heavyEffects ON)**: a short secondary raymarch along the
  refracted ray hits real scene geometry / sky behind the glass — you see *through*
  it. (heavyEffects OFF → refracts the environment/sky only.)
- **Chromatic dispersion** (heavy): 3 refracted taps at IOR ± `gDisp` → rainbow edges.
- **Fresnel** reflect/refract mix; low diffuse floor so glass stays transparent.
- **Beer–Lambert** body tint from thickness; **thin-film iridescence** at grazing.
- **Frost** (Section 7): roughness biases mip LOD → milky, still see-through.
- Blown specular highlight toward the key light; shatter glints on collapsing shards.

---

## 3. The Nine Sections

> Each entry: **theme · palette/light · geometry/setpiece · transition in→out · glass.**

### 1 · DAWN APPROACH  (z 0–60)
- **Theme:** quiet establishing breath; the journey begins.
- **Light:** low warm sun, soft gold; long shadows; calm.
- **Geometry:** single straight clear-glass deck with thin rails + posts. Distant
  skyline glowing on the horizon; crossing bridges hinted far ahead.
- **Transition:** opens at the loop seam (fades up from Skylight Release). Flat run.
- **Glass:** clear, polished, low dispersion — the reference "clean glass."

### 2 · THE CONVERGENCE  (z 60–120)
- **Theme:** a junction where many spans meet.
- **Light:** cool blue-white, hard key; prismatic.
- **Geometry:** **crossing bridges** sweep *over and under* the main deck at
  **30°–135°** yaw, at staggered heights (some pass below through the cloud gap,
  some arc overhead). 3–4 crossings spaced through the band.
- **Transition:** flat in; flat out (level unchanged). Heading stays straight; the
  crossings provide the drama.
- **Glass:** strong chromatic dispersion — rainbow fringing on every crossing edge.

### 3 · THE ASCENT  (z 120–180)
- **Theme:** climbing to an upper tier.
- **Light:** opening high sky, brighter, cool.
- **Geometry:** the deck **ramps upward** from level L0 (y 0) to L1 (y +10) over the
  section as an inclined glass stair-ramp; crossing bridges recede below as you rise.
- **Transition (PHYSICS — climb):** `camY` follows the ramp with an **eased
  accel→decel** (ease-in-out) — reads as running up a slope, slight forward pitch,
  breath/bob increases. Ends standing on the upper deck (L1).
- **Glass:** clear with faint warm refraction of the climbing sky.

### 4 · HIGH SPAN → THE DROP  (z 180–240)
- **Theme:** a narrow exposed catwalk, then a leap to a lower span.
- **Light:** teal, thin, high-altitude; vertigo.
- **Geometry:** narrow high catwalk (L1, y +10), no rails on one side; crossing
  bridges far below in the cloud sea. Near z≈225 the catwalk **ends at an edge**;
  a lower deck (L0, y 0) resumes ~10 u below and ahead.
- **Transition (PHYSICS — jump down):** at the edge the camera leaves the deck with
  a small forward hop velocity and falls under gravity: `y(τ)=yEdge + v0·τ − ½g·τ²`
  (τ = time since edge). Camera **pitches down** to watch the approaching deck,
  lands with a **head-dip** recoil, resumes the run on L0.
- **Glass:** clear; the drop reveals the cloud sea refracting through the deck edge.

### 5 · THE TRAIN  (z 240–300)
- **Theme:** the set-piece — board a moving train, ride it, ride it off a cliff.
- **Light:** dramatic side light, motion-blur energy; sparks.
- **Geometry & beats:**
  1. **Leap on (240–256):** the main deck gaps; **below and crossing at an angle**
     runs a **train** on its own lower bridge, moving fast. The camera **jumps down
     onto the train roof** (parabola, as Section 4), landing on a flat car.
  2. **Ride (256–288):** camera rides atop the train cars (boxcar SDF chain) as the
     train's bridge carries it forward; cars sway; wind/sparks; the main glass world
     streaks past. Run-bob replaced by **train rock** (low-freq sway).
  3. **Dead end + free fall (288–300):** the train's bridge **ends abruptly** —
     sheared off. The train rolls off the edge and **pitches into free fall**;
     camera Y accelerates downward (`−½g·τ²`, larger g), strong **pitch-down**,
     the broken bridge stub recedes upward. Section ends mid-plunge.
- **Glass:** the surrounding skybridges are clear; the train is dark metal+glass
  (distinct material), reflective.

### 6 · THE CATCH  (z 300–360)
- **Theme:** salvation — out of the fall onto a rising bridge, climb back to the path.
- **Light:** warm relief flare, golden.
- **Geometry:** a glass bridge **sweeps up from below** to meet the falling camera;
  the fall **decelerates** as the camera arcs onto it (parabola easing to the deck),
  then the deck **climbs** back from the low fall altitude to L0.
- **Transition (PHYSICS — catch + climb):** decelerating arc (fall velocity bleeds
  off as the rising deck matches it) → eased climb (as Section 3) back to L0.
- **Glass:** warm-tinted, see-through, relief.

### 7 · FROST GALLERY  (z 360–420)
- **Theme:** a cold gallery of frosted crossings.
- **Light:** dim cold blue, diffuse; storm shear.
- **Geometry:** crossing bridges return (over/under, like Section 2) but **rimed /
  frosted**; storm wind shears the path side-to-side (lateral sway).
- **Transition:** flat level; lateral storm sway in and out.
- **Glass:** **frosted** — high roughness, milky but still see-through (LOD-blurred
  refraction); rain streaks.

### 8 · AURORA HELIX  (z 420–480)
- **Theme:** a spiralling iridescent ascent.
- **Light:** sweeping aurora bands, green-magenta; ethereal.
- **Geometry:** the path **spirals/banks** (gentle roll + climb); crossing bridges
  arc as helical ribbons.
- **Transition (PHYSICS — bank + climb):** gentle continuous roll and rise; camera
  banks into the spiral.
- **Glass:** maximal **thin-film iridescence** — glory/oil-slick sheen.

### 9 · SKYLIGHT RELEASE  (z 480–540)
- **Theme:** release — the structure dissolves to light, loops back to dawn.
- **Light:** brilliant skylight, blooming, fades toward the warm dawn at the seam.
- **Geometry:** deck thins and dissolves into bloom; crossings fade out; the cloud
  sea brightens. Crossfades into Section 1 across the loop seam.
- **Glass:** transmission → white bloom; near-total see-through.

---

## 4. Camera height profile `camY(z)` (physics summary)

Piecewise, continuous at every section join (z in section-local seconds τ = (z−startZ)/SPEED):

| z band | behaviour | curve |
|--------|-----------|-------|
| 0–120  | level L0 (eye 1.6) | constant |
| 120–180| climb L0→L1 (+10) | ease-in-out (accel→decel) |
| 180–225| level L1 (eye +11.6) | constant (narrow catwalk) |
| 225–240| **jump down** L1→L0 | parabola `y0+v0τ−½gτ²`, head-dip on land |
| 240–256| **leap onto train** L0→train-roof (≈ −6) | parabola |
| 256–288| ride train roof | low-freq sway |
| 288–300| **free fall** | accelerating `−½g'τ²`, pitch-down, g'≈26 |
| 300–330| **catch** (fall→rising deck) | decelerating arc onto deck |
| 330–360| climb back to L0 | ease-in-out |
| 360–420| level, storm lateral sway | constant Y, sin lateral |
| 420–480| helix bank + gentle climb/descend | sin roll + slow rise |
| 480–540| level, dissolve | constant, fades to seam |

Glance scripting (`pitch`/`yaw` offsets): look-back at the collapse (periodic +
strong at 288–300), look-down on jumps (225–240, 240–256, 288–300), snap-up on
climbs (120–180, 330–360), bank into helix (420–480).

---

## 5. Performance

- Two `#define` variants: full (route page, env map bound) and preview (hover
  thumbnail, procedural env fallback, fewer steps/octaves).
- See-through secondary refraction march gated behind `uHeavy` (heavyEffects).
- World-Z bands keep per-frame SDF cost local; crossing bridges / train evaluated
  only inside their bands via cheap Z-range guards.
- Collapse shard-field only near camera; far segments fall as whole slabs.
- Distant skyline is a background heightfield (no marching) + a few far towers.

---

## 6. Files

- `app/journeys/skybridges/shader.ts` — the scene (this spec realised).
- `app/journeys/skybridges/kinematics.ts` — section names/Z windows (HUD); must
  mirror the nine bands above.
- `app/journeys/skybridges/page.tsx` — wires `envMapUrl`.
- `lib/shaderQuad.ts`, `components/withShaderJourney.tsx` — uniforms plumbing
  (`uEnv`, `uEnvLoaded`, `uHeavy`).
