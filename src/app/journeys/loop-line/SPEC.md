# THE LOOP LINE

A driverless people-mover on a closed circuit of nine bays, with no terminus.
It never stops running because the timetable has no last train, and it comes back
round a little more broken every time.

This is the repo's rasterized journey: actual triangles through a WebGL2 context
with a depth buffer (`components/withGeometryJourney`), shaded from the Δ library
— photographed CC0 surfaces and skies from ambientCG (`delta/`, see the README).

## Why a closed loop is allowed to cheat

| journey | approach |
| --- | --- |
| `stairwell` | joins acts in space, each in its own coordinates, through a wall |
| `natatorium` | moves the section table to the CPU and uploads an affine transform per section |
| `switchback` | rectifies: the camera never moves, the world shears around it |

All three exist because their routes are *unbounded*. A closed circuit is not. It
is 2.08 km long and then it is the same 2.08 km again — so this journey builds the
whole thing, once, and lets an ordinary camera move through it. No turn-radius
floor, no coordinate drift, and a track that could cross itself.

## The circuit

| # | bay | the room | the light | how it fails |
| --- | --- | --- | --- | --- |
| 1 | PLATFORM SIX | cream subway tile, a platform with a yellow line, columns, benches, roundels, posters | warm fluorescent strips | the edge crumbles |
| 2 | THE RUNNING TUNNEL | a bored tube, cast-iron rings, cable runs | a bulkhead every 16 m | the rings crack and slip |
| 3 | THE CONCOURSE | a vaulted hall, terrazzo walkways, mezzanine galleries, shuttered shops; **the points** | big pendant globes | the vault comes loose |
| 4 | THE CUT | a ten-metre cutting under the day, overbridges, fences on the crest | the noon sky (Δ `DAY`) and its sun | the sky comes down |
| 5 | THE ANNEX | a low flooded interchange, rows of columns, beams | flickering green tubes | the water rises a step per lap |
| 6 | THE VIADUCT | a brick viaduct on arches over a city at dusk | sodium lamps on the parapets, a thousand windows | the city goes dark |
| 7 | THE STACKS | a machine hall through a corrugated building | cold strips and server LEDs | the racks advance |
| 8 | THE DEPOT | a night yard: sidings, parked sets with lit windows, a shed | floodlight masts (Δ `NIGHT`) | the yard empties |
| 9 | THE TURNBACK | a plate-girder trestle over nothing, ending in a cliff | red signal lamps, a deep-field sky | the structure leaves one member at a time |

Every open bay is fenced off from every other open bay by an enclosed one —
noon, dusk and night do not agree, and the only way a sky can change without
anyone seeing it change is while nobody can see the sky. DEPOT and TURNBACK are
the one adjacent pair; they share a night and crossfade across sixty metres.

The plan is a polar radius table, elevation keyed by loop fraction (two passes
— flat to learn each control point's arc fraction, then real), and the whole
design curve is resampled every 9 m. Both circuits are splines through that one
dense resampling.

## The chord

`ALT` leaves `MAIN` inside THE CONCOURSE, is pulled toward the straight line to
the rejoin and bowed further inward, sags into a shallow dip, and merges inside
THE ANNEX: THE CHORD, an unlined brick bore with no light of its own. It skips
THE CUT — the only daylight on the circuit. On lap one you ride past the point
machine and see the chord's mouth in the concourse end wall beside the daylight
portal; on lap three (`SWITCH_LAP = 2`, zero-based) it throws.

Because both splines run through the same points outside the detour, and
Catmull-Rom is local, they are the *same segments* there:

```
before the points    altS = mainS
after the rejoin     altS = altLength - (mainLength - mainS)
```

The handover therefore needs no rebase at all — the points sit at the same arc
length on both circuits — and every alt bay boundary is carried across exactly,
without a nearest-point search that could snap a boundary onto the wrong branch.
The chord's own span runs between the two portal planes it crosses (found by
bisection), so the HUD says CONCOURSE until you are actually in the bore.

`bun tools/verify-geometry.ts` checks the identity (50 µm before the points,
1e-12 m after the rejoin), that the chord clears the daylight portal in both
walls (13.8 m and 10.2 m), and that no grade exceeds 10% or radius falls below
50 m.

## Seamless rooms

The old renderer gave each draw its own bay's fog and cleared to the camera's,
so a doorway showed a hard line where one fog met the other and crossing a
boundary changed the colour of everything at once. Now:

* **The medium is a function of arc length.** Every vertex computes fog colour,
  density, ambient and openness from its own `s`, blended across ±15 m of every
  boundary from uniforms for its bay and both neighbours; the camera's medium
  comes from the CPU by the same function. Fog is integrated as two
  half-segments — the camera's air near, the surface's far — which is
  continuous everywhere and right at both ends.
* **Portals are cut per pixel.** Where a bay ends against a smaller mouth, a
  facade or a cliff, a single quad carries the wall and the fragment shader cuts
  the opening(s) from a polygon distance field, antialiased through
  alpha-to-coverage. The concourse end wall has two: daylight, and the chord's
  skewed mouth, projected onto the wall along the chord's own direction.
* **The sky changes only where it cannot be seen**: an enclosed bay shows the
  sky of the next open bay ahead, except for its first 25 m.
* **Exposure is authored per bay** and blended across ±25 m — not metered,
  because `?t=` must reproduce.

`node tools/journey.mjs scan loop-line --bare` across every boundary measures
the worst frame-to-frame change at 2.6–3.2× the baseline, exactly where the
camera passes through a mouth and the walls sweep past — motion, not a pop.

## Materials and light

* Shells are profiles swept along the curve, one draw per surface. Texture `u`
  runs along the track in metres, `v` up a wall and across a floor (so courses
  stay horizontal on both walls), round a vault by perimeter.
* **Ambient occlusion is baked into the sections**: concave corners are found
  from the turn direction, extra points carry the gradient out into the face,
  and the value rides in the *length* of the vertex normal. A crack in a wall
  shows the **rock layer** — the main section pushed outward and left whole —
  not the sky map behind everything.
* Every Δ map is used: colour, normal (with a derivative-built tangent frame),
  roughness (GGX), displacement (parallax occlusion close up), AO (on indirect
  light only), metalness.
* 24 lamps per draw — the bay's nearest to the camera, lamps ahead counted
  nearer than lamps behind — plus the headlight, plus sky irradiance from the
  map's mip chain and the map's own sun where the bay is open.
* The eight lamps nearest the camera scatter into the air with Miles Macklin's
  closed form (atan difference over closest approach), capped per lamp so a
  floodlight does not turn the yard to soup.
* Procedural surfaces where a photograph cannot do it: lit and dark windows by
  instance seed (fading to their mean with distance), server LEDs blinking on
  their own clocks, carriage window bands, posters and shop signs, a polished
  running surface on the rails.
* The flood is a level plane, not a track-following one: the annex is the bottom
  of a dip, so the water lies only where the floor is below it.
* A slim cab — a dashboard band and two pillars at the frame's edges — rides
  with the car, lit by whatever it is passing.
* HDR (`RGBA16F`, 4× MSAA) where `EXT_color_buffer_float` exists, Reinhard-
  encoded RGBA8 otherwise; a five-level bloom (13-tap down, tent up), a radial
  speed smear at the frame's edges, ACES.

## One scalar

Everything that goes wrong is a function of `lapF` — the lap count plus a
fractional part ramped across THE TURNBACK (`decayOf` in `kinematics.ts`). Shard
displacement, dead lamps (a fitting and its light share one roll, so they die
together, flickering for a while first), rot, chatter, speed, the flood, the
city's windows, whether the points have thrown.

Meshes are pre-fractured at build time and displaced per shard in the vertex
shader from that one number, so the last lap renders at the price of the first
and `?t=320` reproduces it exactly. The spin is small on purpose: a slab that has
turned five degrees reads as a wall that is failing; one that has turned thirty
reads as confetti, and there is nowhere left for the next lap to go.

## Things that cost a debugging session

* **A draw's arc length must come from its vertices, not its instance.** The
  flood was fogged by `s = 0` — THE CUT's daylight air — and rendered as a
  white sheet.
* **A fixed canvas at z-index 0 paints over in-flow text.** (The asset page.)
* **`centroid`, `patch`, `active` and `sample` are reserved in GLSL ES 3.00.**
* **Implicit derivatives inside a branch on a varying are undefined** — the sky
  reflection is sampled by LOD for that reason.
* **A prop basis built on the curve's `right` is a reflection.** Props use
  left = up × forward.
* **A backtick in a GLSL comment ends the template literal.**

## Files

```
stations.ts    the plan, the profile, the nine bays, both circuits, the chord
kinematics.ts  JourneySimulation: integrates the train, owns lapF, packs uniforms
geometry.ts    surfaces, the cross-sections, the sweep, baked AO, rock layers, unit props
dressing.ts    where every prop, lamp, building and headwall goes
scene.ts       the renderer: build once, then medium, sky, lamps, draws, post
shader.ts      GLSL ES 3.00 (geometry, sky, bloom, composite) + the ES 1.00 preview
audio.ts       traction motor, rail joints, room tones, degrading announcements
```

The audio engine's rooms are *sounds*, not bays: `Bay.sound` maps nine bays onto
its seven room tones (the tube sounds like the chord, the viaduct like the cut),
and `uLoop[3]` carries the sound.
