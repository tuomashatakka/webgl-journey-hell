# SKYBRIDGES — Scene Specification

A first-person sprint across glass skybridges strung between glass supertalls,
a cloud sea a hundred metres below. Everything here is glass and all of it is
failing: the deck crazes under every footfall and drops away behind you, the
towers' curtain walls spiderweb and shed their panes as the run goes past, and
at the end of the second lap something detonates on the horizon. The flash, a
fireball, a shockfront that crosses the cloud sea and blows the city's glass
out, and a mushroom cloud that climbs for most of a minute before the signal
goes.

One unbroken route, nine sections. Each section is its own place — its own
architecture, its own time of day, its own way of breaking — joined by the
physical moves between them (a climb, a jump, a train, a fall, a catch).
Implemented as a single-pass raymarched WebGL 1.0 / GLSL ES 1.00 fragment
shader (`shader.ts` and `glsl/`).

---

## 1. Conventions

| Quantity | Value | Notes |
|----------|-------|-------|
| Units | 1 unit = 1 metre | the blast is authored in km |
| Forward speed | `SPEED = 5` m/s | `kinematics.ts` exports it; the shader is built from it |
| Lap | `LOOP_Z = 540` m, 108 s | nine 60 m sections, 12 s each |
| Eye height | 1.6 m above the deck | first person |
| Deck | 3.2 m wide (half 1.6) unless a section says otherwise | three panes across |
| Pane | 1.07 × 1.5 m laminated glass, 0.16 m with its frame | the unit everything cracks in |
| Cloud sea | cloud tops 120 m below deck level | a lit heightfield, not a backdrop |
| Gravity | 18 m/s² | ~1.8 g, for game feel |

**Camera model — first person.** The camera is the runner:
`ro = (lateral sway, pathY(z) + bob, z)`. The world is authored straight along
+z (canonical space) and bent around the camera by `unbend`, which rotates every
point about the runner by the route's heading change between the runner and the
point. The camera yaws by the same heading change `LOOKAHEAD` metres ahead, so
it looks *into* each bend (it used to look away from it).

**The sky is world-fixed.** Sky, sun, clouds, skyline and the blast are looked
up in true-world directions: the render frame is rotated by the route's heading
at the camera. When the route turns, the sun swings across the sky with it.

**Route turns.** Placed between set pieces, never through one, so a radially
symmetric structure is never sheared by `unbend`. Net +360° a lap, so the lap
seam carries no yaw jump.

| Centre z | Turn | Where |
|----------|------|-------|
| 206 | −60° (left) | at the pylon of The Wire |
| 390 | +120° (right) | inside the Frost Gallery's tube |
| 450 | +180° (right) | the Night Helix, around its tower |
| 510 | +120° (right) | across the Crown's plaza |

**World-Z bands.** Each section's set piece lives in a fixed band of canonical z,
guarded by a cheap range test, so a sample only ever pays for the structures
near it. Generic towers repeat every 36 m along both flanks (two cells and one
side per sample) and are switched off where a set piece owns the flank.

---

## 2. Glass, everywhere

### The deck
Laminated panes in a steel frame: three panes across, 1.5 m long, on two
longitudinal stringers with a cross beam every 3 m. Frameless glass balustrades
(1.1 m) with a steel handrail and base shoe. Pane edges read green (iron in the
glass, Beer–Lambert through the edge).

- **Flat glass does not distort.** The transmitted ray carries on along the view
  ray; only a crack, a sag or frost bends it.
- **Reflection:** Fresnel (Schlick, n = 1.5) of the world-fixed sky, so the
  blast reflects in every pane once it exists.
- **See-through:** with heavy effects the ray continues through the pane into the
  scene behind it (stringers, decks below, towers); without, the background is the
  sky and the cloud sea, which is most of what is under a skybridge anyway.

### How the deck breaks
Every pane the runner crosses cracks at the instant the foot lands on it:

- a **spiderweb** around the impact point (alternate feet, ±0.2 m): 7–12 jagged
  radial cracks that reach the frame in about 0.12 s, then concentric chords
  between neighbouring radials that keep appearing for seconds as the load
  creeps. A white crush zone at the impact.
- **Shards tilt.** Each cell between radials and chords gets its own small normal
  tilt, so the sky reflection breaks into facets — the cue that reads as broken
  glass rather than lines drawn on glass. The cracked pane sags a few
  centimetres towards the impact.
- **Running cracks.** In later sections a longitudinal crack outruns the
  runner along the deck, stalls, and runs again.
- **The panes fall.** About a second after cracking, each pane splits along a
  random line into two pieces that drop and tumble independently; the steel frame
  hangs on for a few more seconds and then goes as whole 9 m segments. Glance
  back and the bridge is a skeleton raining glass into the cloud sea.
- **Pressure.** Damage grows with the run: lap one starts pristine, lap two
  starts already crazed, and side panes crack sympathetically after the centre
  pane. Every crack pop under the foot jolts the camera.

### The towers
Glass supertalls: chamfered boxes with setbacks and crowns, in four glass tints.
The curtain wall is a mullion grid (1.5 m), floor lines and spandrels every
3.6 m, and *oil-canning* — every pane a fraction of a degree off true, so
reflections break up pane by pane the way real curtain walls do. Behind the
vision glass, **interior mapping**: a room per three panes, ceiling light
panels, lit or dark, seen through the reflection at normal incidence and
glowing at night.

The towers crack along the journey. As the runner approaches, a crack front
spreads across the facade facing the route from a point near bridge height;
panes inside it spiderweb, a fraction blow out (a hole onto the room, jagged
remnants at the frame), and the burst sheds glitter. Damage accumulates over
the laps, and the blast's shockfront finishes the job.

---

## 3. Light and sky

- A Rayleigh-ish sky gradient driven by the sun's elevation, a Mie glow around
  the sun, horizon haze, a sun disc; clouds above the horizon.
- **The cloud sea** is a heightfield 120 m below the deck, intersected per ray
  (so it streams past underneath with real parallax), lit from the sun's side,
  shadowed in its hollows, fading into haze at distance. Tower bases sink into it.
- **The skyline** to the horizon: glass towers as a heightfield silhouette, haze
  graded, catching the sun.
- **Shadows** are analytic: tower boxes along the sun's projection (a ray–box
  test per nearby tower), balustrades and handrails as lines projected on the
  deck, the Crown's space frame as a grid. No shadow march.
- **ACES** tone map; exposure per section.

---

## 4. The nine sections

> Each entry: **place · light · structure · how it breaks · the move out.**

### 1 · DAWN APPROACH (z 0–60)
- **Place:** a long straight bridge between two rows of slender glass towers.
- **Light:** sun 4° up, ahead-left, gold; long tower shadows across the deck; the
  towers' west faces on fire with reflected dawn.
- **Structure:** the reference deck — clear panes, glass balustrades, stringers.
- **Breaks:** the first footfalls crack the centre panes; lap one barely, lap two
  everywhere.
- **Out:** flat, straight on into the Interchange.

### 2 · THE INTERCHANGE (z 60–120)
- **Place:** a round glass hall (r 8 m, z 82–98) where bridges meet: a glass
  rotunda with steel ribs every 15° and a glass dome, spokes leaving it at deck
  level at ±70°, one span crossing overhead (+6.5 m) and one below (−7.5 m).
- **Light:** cool white midday, sun 28°; prismatic dispersion — rainbow
  caustics on the hall floor, coloured fringes on every rib.
- **Breaks:** the dome panes crack in sequence over your head as you cross the
  hall; the overhead span shatters and rains.
- **Out:** straight through the far door.

### 3 · THE CURTAIN WALL (z 120–180)
- **Place:** a colossal tower's face, 4.5 m to the left, filling half the view —
  the run climbs a glass stair-ramp cantilevered from it on steel brackets, 10 m
  up over the section.
- **Light:** high and bright (sun 45°, from the right), so the facade is a mirror
  of the sky and of the bridge on it.
- **Breaks:** a crack front races across the facade beside you, panes blooming
  into spiderwebs in sequence and popping out to fall past you.
- **Out:** onto The Wire at the top of the climb.

### 4 · THE WIRE (z 180–240)
- **Place:** a narrow (1.4 m) cable-stayed catwalk at +10 m between tower crowns.
  A steel mast to the left at z 206 rises to +52 m, six stays fan down to the
  catwalk; a single cable handrail, nothing on the right. The route turns −60°
  at the mast.
- **Light:** thin high-altitude teal, sun 62°, deep blue zenith; the cloud sea
  far below.
- **Breaks:** each step spiderwebs the catwalk and a running crack outruns you;
  at z 225 the catwalk snaps. The crowns around shed their glass in sheets.
- **Out (jump):** off the broken end with a forward hop,
  `y(τ) = y₀ + v₀τ − ½gτ²`, pitch down to the lower deck at y 0, head-dip on
  landing.

### 5 · THE GLASS LINE (z 240–300)
- **Place:** a short landing deck, then a leap onto the roof of a train on a
  lower viaduct (−6.6 m) that runs *through* a glass tower's atrium station
  (z 262–284): a tall hall cut through the tower, floor slabs and lit balconies
  either side, then out the far facade to where the viaduct is sheared off.
- **Light:** low side light from the right (sun 12°), hard and dramatic; sparks
  under the cars.
- **Breaks:** the station's facade shatters outward as the train punches through.
- **Out (fall):** the train rolls off the sheared end at z 288; free fall at
  g' = 26, pitch hard down, the stub receding.

### 6 · THE CANYON (z 300–360)
- **Place:** a slot 14 m wide between two towers (z 282–340): the fall drops
  between their facades, window grids streaming up past you; a glass bridge
  sweeps up from below between them and takes you.
- **Light:** golden, sun 3° ahead-right, bounced between the facades.
- **Breaks:** the catch cracks the rising deck from end to end; the facades
  craze around the impact.
- **Out (catch):** the fall decelerates onto the rising deck (z 300–330), then
  climbs back to y 0 and runs out of the slot.

### 7 · FROST GALLERY (z 360–420)
- **Place:** an enclosed tube bridge (r 2.6 m, steel rings every 3 m), its glass
  frosted and rimed; snow outside; the world beyond only blurred shapes. The tube
  curves +120°.
- **Light:** overcast, cold, diffuse; the sun a pale smear.
- **Breaks:** white fracture lines run through the frost layer, crystalline, as
  the tube flexes in the wind.
- **Out:** level, storm sway in and out.

### 8 · NIGHT HELIX (z 420–480)
- **Place:** night. The route coils +180° around a cylindrical glass tower whose
  floors are lit; its facade is the wall on your right, the ramp climbs and banks
  into the curve. Aurora overhead, the moon, the city glowing orange through the
  cloud sea.
- **Light:** moonlight and the tower's own windows.
- **Breaks:** the lit panes beside you crack and the light spills through.
- **Out:** the ramp crests and levels onto the Crown.

### 9 · THE CROWN (z 480–540)
- **Place:** the top of the city: a wide glass plaza (12 m) under a steel space
  frame, the rest of the towers far below. The plaza curves +120°.
- **Light:** brilliant noon, sun 70°, the space frame's grid shadow on the glass;
  the light blooms towards white and fades to dawn across the lap seam.
- **Breaks:** the plaza's panes craze outward from your path in every direction.
- **Out:** across the seam into the Dawn Approach.

---

## 5. Camera height `pathY(z)`

| z band | behaviour | curve |
|--------|-----------|-------|
| 0–120 | level (eye 1.6) | constant |
| 120–180 | climb to +10 | ease-in-out |
| 180–225 | level at +10 (eye 11.6) | constant |
| 225–240 | jump down to 0 | gravity from the edge |
| 240–248 | landing deck | constant |
| 248–260 | leap onto the train roof (eye −2.3) | gravity |
| 260–288 | ride | low-frequency sway |
| 288–300 | free fall to −39.5 | `−½g'τ²` |
| 300–330 | catch, climb back to 0 | decelerating arc |
| 330–420 | level; storm sway in the tube | constant |
| 420–480 | helix: rise and fall ±4, bank right | sine |
| 480–540 | level | constant |

**Glances.** Look down at the cracking deck every ~9 s; look back at the
collapse every ~13 s; look down on every jump and the fall; up on the climbs;
bank into the helix. During the blast the head turns to the cloud and keeps
looking, tilting up as it climbs, and every scripted glance stands down.

---

## 6. The end: the detonation

The run laps forever, so like every looping journey it borrows a lap count as
its ending: `CONFIG.signal.lossLaps.skybridges = 2` (3 min 36 s). The lap-three
boundary is the detonation, `T0 = 2 × 108 s`, and the shader keys the whole
event off its own clock, `e = iTime − T0` — the route is a pure function of the
clock, so this seeks like everything else.

The picture holds at full quality while the event plays:
`CONFIG.signal.holdSeconds.skybridges = 40` delays the journey's `signalAge`,
so the signal starts going at e ≈ 48 s and is gone by e ≈ 63 s, with the cloud
still climbing.

Ground zero is 24 km out at a true-world heading of +24° (ahead-right for the
first 42 s, when the route still runs straight).

| e (s) | beat |
|-------|------|
| 0–1.6 | **the flash** — a total white-out for a quarter second, the whole scene lit from the blast side, then recovering |
| 0–6 | **the fireball** — white, then yellow, then orange, rising; a condensation ring flickers round it (0.5–3.5 s) |
| 1–10 | **the shockfront** crosses the cloud sea towards you at 2.4 km/s: a bright ring that lifts and flattens the cloud tops, dust behind it; towers' glass bursts as it reaches them |
| 10 | **arrival** — one hard shove and a ring-down, every pane on the deck cracks at once, the nearby facades blow out, glass glitters in the air |
| 3–60 | **the mushroom cloud** — the fireball becomes the cap and keeps rising (to ~11 km), a stem of dust drawn up under it, the cap rolling outward as a torus with an ice-cap pileus above (6–26 s); a base surge spreads across the cloud sea; the cap's underside glows and cools from orange to red to brown |
| 12– | **the aftermath** — ash falling, the sky browning under the spreading pall, the sun dimmed; the head stays on the cloud |
| 48–63 | the signal goes |

The cloud is an impostor in the sky function: a 2D signed field (cap with
toroidal lobes and a concave underside, stem, base surge, pileus, condensation
ring) in the plane through ground zero, its edges displaced by domain-warped fbm
that rolls round the cap's lobes and climbs the stem. Lit from the sun with a
pseudo-normal from the field, self-lit from its hot core, graded into the haze.
Because it is in the sky, it shows in every reflection.

Things to keep true:

- **The flash is a pulse, not a step.** A step on the intensity multiplies every
  surface by the flash for the rest of the run.
- **Author the sky in the scene's exposure,** not the event's: this is a daylit
  scene whose whites already sit near 1.0.
- **Never `pow(x, y)` on a signed `x`** — undefined in GLSL, NaN on some GPUs,
  and a NaN frame is black, indistinguishable from a very dark explosion. Square
  by multiplication.

---

## 7. Performance

- Two `#define` variants: full (route page, env map bound) and preview (the
  index's channel: fewer steps and octaves, no env map, no heavy effects).
- Heavy effects (`uHeavy`) add the see-through continuation march; everything
  else is the same at every tier.
- Set pieces sit behind band tests; towers are two cells on one side per sample,
  with the far flank bounded by its distance.
- Falling panes are a domain repetition clamped to their cell, so a march never
  steps over a neighbour.
- The mushroom cloud is skipped outside its bounding box; the blast costs nothing
  before `T0`.
- Shadows are closed-form; there is no secondary march for them.

---

## 8. Files

- `shader.ts` — the two variants; `glsl/foundation.ts` (uniforms, timeline,
  route, path), `glsl/atmosphere.ts` (light per section, sky, cloud sea,
  skyline), `glsl/blast.ts` (the detonation), `glsl/cracks.ts` (spiderweb and
  running cracks), `glsl/structures.ts` (deck, set pieces, towers),
  `glsl/materials.ts` (scene, normals, shading), `glsl/camera.ts` (choreography,
  main).
- `kinematics.ts` — speed, lap, section names and bands (HUD and the shader both
  read them).
- `journey.ts` — wires the env map.
