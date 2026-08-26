# THE LOOP LINE

A driverless people-mover on a closed circuit of six stations, with no terminus.
It never stops running because the timetable has no last train, and it comes back
round a little more broken every time.

This is the first journey in the repo made of **actual triangles**. Everything
else here is a raymarched SDF on a full-screen quad; this one rasterizes real
geometry through a WebGL2 context with a depth buffer, via
`components/withGeometryJourney`.

## Why a closed loop is allowed to cheat

The repo has three answers to "how do you turn forever without cost or float
precision growing":

| journey | approach |
| --- | --- |
| `stairwell` | re-anchors in GLSL — three sections resident, each rotated into the camera's frame |
| `natatorium` | moves that table to the CPU and uploads an affine transform per section |
| `switchback` | rectifies: the camera never moves, the world shears around it |

All three exist because the route is *unbounded*. A closed circuit is not. It is
1.26 km long and then it is the same 1.26 km again — so this journey builds the
whole thing, once, and lets an ordinary camera move through it.

Everything the other three work hardest at simply evaporates. No turn-radius
floor, because nothing is fitted to a quadratic. No coordinate drift, because arc
length wraps at the loop length and the world never translates. And the track can
cross over itself, which not one of the SDF journeys can express.

## The circuit

Authored in `stations.ts` as a polar radius table (readable as a diagram while
tuning) plus an elevation profile keyed by loop fraction. Those two cannot be
indexed the same way — one by bearing, one by arc length — so the curve is built
twice: once flat, purely to learn each control point's arc-length fraction, and
once for real with heights sampled at those fractions. Adding ±20 m to a 1260 m
loop changes its length by well under a percent, so it is a fixed point reached
in one step.

| # | bay | the room | how it fails |
| --- | --- | --- | --- |
| 1 | PLATFORM SIX | cream tile, sodium light, benches, a platform you could stand on | the edge crumbles into the trackbed |
| 2 | THE CONCOURSE | vaulted retail mezzanine, shuttered units | the vault detaches and rotates |
| 3 | THE CUT | a trench under a blown-white sky — the only daylight | the sky comes down |
| 4 | THE ANNEX | flooded lower interchange, water to the axle boxes | the water rises a step per lap |
| 5 | THE STACKS | a cold aisle through a machine hall, lit only by equipment | the racks advance inward |
| 6 | THE TURNBACK | open steel trestle over black, no walls | the structure leaves one member at a time |

`THE TURNBACK` is where the lap counter advances, and it is chosen for that: no
walls, no ceiling, nothing but signal lamps, so a bay whose parameters are
sliding is a bay with almost nothing on screen to slide.

## The chord

There are **two** circuits, both built and drawn from the first frame. `MAIN`
runs all six bays. `ALT` replaces the arc through THE CUT with a bowed chord at
tunnel depth that never surfaces — `THE CHORD`, an unlined brick bore with no
lighting of its own.

A real point machine sits at the divergence, and on lap one you ride past it and
see the chord's mouth curving away into the dark. On lap 3 it throws, and the
line loses THE CUT: the switch trades the only daylight on the circuit for the
only darkness. That is the entire argument for putting the chord *there* and not
somewhere cheaper.

The handover rebases arc length by the difference between the junction's distance
on each circuit. Get that wrong by a metre and the train teleports a metre, which
at twenty metres a second is a frame you will absolutely see.

## One scalar

Everything that goes wrong is a function of `lapF` — the lap count plus a
fractional part ramped smoothly across THE TURNBACK rather than stepped at the
seam. From that one number: shard displacement, how many lamps have failed, how
far the colour has rotted, bogie chatter, speed, and whether the switch has
thrown.

Nothing keeps its own clock. Six subsystems each ageing on their own timer drift
apart, and the moment they drift the ride stops reading as one place falling
apart and starts reading as six effects.

The **rates** matter more than the effects. At three times the shipped numbers
the line was unrecognisable rubble by lap 4 — technically "more ruptured",
actually just over, because a room that has stopped being a room cannot decay
further and there is nowhere for lap 5 to go. As shipped, lap 2 is a place with
something wrong with it, lap 4 is a place coming apart, and total collapse sits
around lap 8, which nobody will reach. What has to be true is only that the next
lap is always worse than this one.

Measured, same bay, successive laps (`probe`, mean luminance):

```
LAP 1  84.5      LAP 4  61.4
LAP 2  79.7      LAP 5  43.0
LAP 3  72.4      LAP 6  40.3
```

## Why the rupture is vertex maths

Meshes are pre-fractured at build time (`lib/mesh`'s `fracture`), which tags every
triangle with its shard's centroid and a seeded axis. A single `uDecay` uniform
then rotates and throws each shard about its own centroid **in the vertex
shader**.

Nothing is re-uploaded, ever. The consequence is measurable: 120 fps at
1400×860 on lap 1, lap 3 and lap 5 alike. The world can come apart without the
frame getting a single instruction more expensive, and because the displacement
is a pure function of one uniform, `?t=320` reproduces it exactly.

`fracture` un-welds first, unconditionally. A vertex shared by two triangles can
only carry one shard, so a shared vertex on a shard boundary is dragged by
whichever shard wrote it last and the two stay stitched together by it — a rigid
break comes out stringy.

## Resolving the owning bay

`natatorium`'s `resolveSlot` and `switchback`'s `roomAt` both exist because of one
mistake made twice: shading a surface with the *camera's* section parameters
instead of the section the surface belongs to.

A rasterizer makes this easy to get right — bay parameters are per-draw-call
uniforms, and a bay's geometry is only ever submitted with its own — and just as
easy to get wrong. The lamp arrays are the part that bites, and did: `MAX_LAMPS`
originally uploaded the *first* 24 lamps of a bay, and THE STACKS carries 71 at
3 m pitch, so mean luminance fell off a cliff from 111 to 9 halfway through a bay
whose geometry had not changed. It now takes the nearest 24, found by one linear
scan over an arc-length-ordered list.

## Things that cost a debugging session

* **`centroid` is a reserved interpolation qualifier in GLSL ES 3.00.** A
  variable named it is a syntax error, and the shader silently fails to compile.
* **Interior winding is the flipped case.** A profile traced left-to-right along
  the floor and back along the ceiling, swept forward, produces quads whose front
  faces point *away* from the axis — correct for a solid, inside-out for a bore.
* **Profile point order is the whole content of a room.** Tracing the platform
  riser outward before climbing the wall builds an interior wall standing in
  front of the platform, hiding the thing the bay is named for.
* **A backtick in a GLSL comment ends the template literal.** Twice.

## Files

```
stations.ts    the polar layout, elevation profile, the six bays, both circuits
kinematics.ts  JourneySimulation — integrates the train, owns lapF, packs uniforms
geometry.ts    sweepProfile, the per-bay cross-sections, the unit props
scene.ts       the JourneyRenderer — programs, culling, the frame, the post chain
shader.ts      GLSL ES 3.00 geometry pass + post chain, and the WebGL1 hover preview
audio.ts       traction motor, rail joints, per-bay beds, degrading announcements
```

Note that `shader.ts` holds two different versions of GLSL on purpose: the journey
is ES 3.00, but the landing-grid hover preview must be **ES 1.00**, because every
card's preview shares one WebGL 1.0 context (`ShaderPreviewLayer`). The preview
also has to self-drive from `iTime` alone — the grid attaches no simulation, so a
preview reading `uRide` or `uDecay` renders a black card.
