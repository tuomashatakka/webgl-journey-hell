# the stillwater service

A municipal water slide that was built out over a sea with no shore. One
fibreglass flume, running water in it, threads six rooms of a service
building whose pieces stand on piles in open water. Between the rooms the
flume runs outside, on trestles, over a flat grey sea that fades into haze in
every direction: no horizon, no coast, no sky that is not also the sea. You
ride it, seated in the water, three times. Each time round the building is
less sure of its own shape. On the third arrival at the top of the lift the
flume stops, the rooms dissolve, and only the sea is left.

## The common theme

Every act is the same three things in a different proportion: **the flume**
under you, **a room** built for something else, and **the sea** that every
room is open to. Every room has at least one side that gives onto the haze,
and the sea's colour is the fog's colour, so whichever way the rider looks the
world ends the same way: it fades out, evenly, at the same distance. The water
in the flume is the same water as the pool, the flood in the annex, the swell
under the trestles and the sea over the drowned lounge. Nothing in the
journey is dry.

## Experience contract

The camera rides one continuous closed route: a single spline with no cuts,
no shutters and no fades. A lap is 144 s and the route is the same every lap;
the act boundaries are places on it. The rider sits in the water at the
bottom of the trough (eye 0.78 m above the flume floor), banks up the outer
wall on bends at the angle the speed and curvature give, and looks a little
ahead along the route. Pointer, touch and keyboard look change gaze only.

All times are journey-clock seconds at 1×. Lap 2 starts at 2:24, lap 3 at
4:48; the ride stops at 7:12.

| act | lap time | where the flume runs | what is seen | motion |
| --- | ---: | --- | --- | --- |
| I. the lesson pool | 0–26 s | a raised tiled channel along the deck of a pool hall | a shallow teaching pool with lane ropes and a black lane line, white tile walls, a glazed roof; the east side is an open colonnade and the pool's north end is an infinity edge that spills into the sea | lazy, 1.5 m/s; a right-angle bend out through the colonnade |
| II. the annex | 26–48 s | out over the sea in a steep drop, then a channel cut through the floor of a flooded open-plan office | carpet under standing water, cubicle partitions, square columns, a lay-in ceiling with lamp panels, a curtain wall of fogged glass on every side | two tight banked right angles, about 3 m/s |
| III. the spiral | 48–68 s | a helix of two and a quarter turns round a shuttered-concrete core standing in the sea | the core's lit slots, the cantilever brackets, the turns of the flume above and below; the sea opening on every quarter | 5 m/s, banked hard on the outer wall |
| IV. the breakwater | 68–100 s | a steel trestle 3.5 m above the sea beside a ruined concrete breakwater | tetrapods, broken sea, spray; three colossal silhouettes 1.4–3.2 km out (a split fork, a ring on legs, a stepped blade) that the haze never resolves | fast, an S of long bends |
| V. the drowned lounge | 100–120 s | the flume closes into a clear acrylic tube and dives under the sea | a tiled spectators' lounge on the sea bed: benches, stepped bleachers, lane targets, drowned lamps, an open roof light; the underside of the sea, caustics | dive, glide through, climb out of a sump in the next hall's floor |
| VI. lost property | 120–144 s | a lazy channel round a baggage carousel in a white sorting hall at sea level, then a conveyor lift up through the roof | wire cages, numbered shelves, benches, a single wet tile riding the carousel; the open roller door onto the sea; the lift's gallery climbing back to the pool | slow, then the conveyor at about 2.7 m/s |

The lift lands in the lesson pool's south end at the lap seam, so lap 2 and
lap 3 begin without a cut.

## Three iterations

The route never changes; the world around it does. Distortion is a single
journey-time amount `warp` that rises continuously (0 on lap 1, 0.62 from the
middle of lap 2, 1.2 through lap 3, more in the ending, with a slow ±22 %
pulse), so there is no step at a lap seam. It bends everything except the few metres of flume around the rider (it fades
in from 2.5 m to 24 m):

* **twist**: the world rotates about the line of sight, more the further away
  it is, so the route ahead corkscrews;
* **curl**: distant geometry lifts as the square of its distance, so the sea
  stops being a floor and becomes a bowl, then walls, then a sphere that the
  rider is inside;
* **breathing**: low-frequency waves travel through every wall and column;
* **telescope**: depth along the line of sight stretches and shrinks with a
  slow pulse, and the field of view dolly-zooms against it;
* **image**: chromatic separation, a ghosted second image of the picture and
  barrel distortion in the composite, all scaled by `warp`.

| act | 1 · inspection | 2 · misregistration | 3 · after closing |
| --- | --- | --- | --- |
| lesson pool | still water, all lamps, clean lane line | the pool brims to the deck, one roof bay dark | the pool is over the deck, emergency red, the hall corkscrews ahead |
| annex | dry carpet, lit grid | standing water across the carpet, alternate lamps out | water to the desks, only low red light, the floor curls up into the far windows |
| spiral | grey core, every slot lit | half the slots dark | the turns above and below twist out of register with each other |
| breakwater | moderate swell | heavier swell, spray over the trestle | swells over the trestle deck; the sea curls up on both sides into walls |
| drowned lounge | clear, legible | murkier, the far end lost | almost black but for the roof light and the shafts |
| lost property | lit hall, the tile rides the belt | a bank of lamps dead, wet traces | the hall telescopes; on the last lift the ride slows to a stop at the top |

## The ending

The lap 3 lift decelerates with continuous speed to a stop at the top
(432 s). From 422 s the buildings, the trestles and then the flume itself
dissolve, distance first, until by 444 s only the sea and the haze remain
round the held camera, curled by the warp into every direction at once. The
transport still seeks and replays; the shared signal loss counts from the stop.

## Construction (settled constants)

* **Route**: a turtle path (straights, arcs, a helix) in metres, sampled every
  2 m into a closed Catmull-Rom curve (`@wjh/geometry/curve`). Turns sum to
  three full turns; the two free straights (the dive's level run, the lift) are
  solved so the path closes exactly. Heights are eased per leg with
  smootherstep, so grade is continuous everywhere and zero at every leg end.
  Sea level is y = 0; the pool deck channel at y = 14, the annex at 11, the
  helix from 11 to 3.5, the trestle at 3.5, the dive to -4.6, the sorting hall
  at 0.6.
* **Timing**: leg seconds are authored; s(t) is a monotone cubic (Fritsch–
  Carlson) through the leg ends, periodic across the lap seam, so the rider's
  speed is continuous. On lap 3 the last leg's end speed is zero.
* **Flume**: radius 0.62 m, open 95° each side of the bottom (lip 0.67 m),
  the rider's eye 0.78 m up, sitting up by 0.3 m where the speed is under
  2.6 m/s,
  3 cm shell, a bolted flange every 2.4 m, swept with `@wjh/geometry/sweep`.
  The lounge closes the profile to a full circle (the acrylic tube); the
  pool's is tiled; the lift's floor is a cleated belt. The water ribbon is a
  separate sweep tilted to the rider's bank at that s.
* **Bank**: `-atan(v² κ / g)` with κ signed toward the frame's right,
  windowed over ±3 m, clamped to ±70°.
* **Surfaces**: Δ library materials throughout (subway tile, quarry tile,
  terrazzo, shuttered and spalled concrete, weathered and corrugated steel,
  timber, plaster, hazard plate) under GGX; gelcoat, carpet, ceiling tile and
  glass are procedural. The sky and every reflection are Δ's fog morning.
* **Light**: outside, a low hazy sun and the sky's irradiance; inside each
  room, its own lamp grid evaluated as the four nearest point lights, with
  per-lap failures. Fog is the horizon colour of the sky, so sea and sky are
  the same colour where they meet.
* **Sea**: a 224-cell grid (128 on the low tier) with cubic spacing to 6 km,
  eight Gerstner swells plus fragment ripples, foam on crests, Fresnel sky
  reflection; seen from below, a Snell window. Swell grows each lap.
* **Frame**: HDR scene with MSAA by tier, a bloom pyramid, ACES, then the
  warp's image effects; the shared CRT pass and signal loss follow.

## Verification

* `bun run check`, `bun run build`, `node tools/journey.mjs glsl
  stillwater-service --bare`.
* A contact sheet across each lap; `scan` across every act boundary and both
  lap seams at a fine step: no boundary may stand out from the ride's own
  motion, since there are no cuts.
* The route's closure, grade and speed continuity are unit-tested
  (`route.test.mjs`).
