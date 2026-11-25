# the liminal journey

## the motive

the first journey and the plainest: a walk down a corridor that keeps being
somewhere else. poolrooms, a glass slide down into the dark, a crystal cave,
iron hydraulics, a labyrinth of stairs after Escher's *Relativity*, a hall back up to the pools; then the
same again, lower in the water and redder, with sector 666 where the hall was.
after the third traversal the fourth does not end: the abyss, and the signal
goes.

the route, the sector table and the sector 666 set pieces live in
`kinematics.ts` and are mirrored literal for literal in `glsl/core.ts`
(`getSegmentData`); the spec for those is the code's own comments. this file
settles the march and the look of the tiled halls.

## the shader

GLSL ES 1.00, two passes (`renderer.ts`): the scene into an 8-bit target, then
`fsPost` (fisheye, chromatic split, flares, the loop fades). the scene is
built from `glsl/` pieces in this order: `core` (uniforms, the segment table,
the camera's path), `palette` (biome colours, the abyss palette, helpers),
`setpieces` (sector 666), `labyrinth` (sector 5: its solid, its lamps
and its shading), `cave` (sector 3: its solid, its lamp and its shading),
`hydraulics` (sector 4: its solid, its lamps and its shading), `march` (the map), `shading` (normals, AO, the tiled
halls, the camera and `main`).

two builds: the full one (120 primary steps, 5 AO taps, two 40-step reflection
marches) and `LITE` for phones and wherever the full one will not compile (50
steps, 3 AO taps, no reflection march).

**the map builds a sector only where it is seen.** sectors cross-fade by
smoothstep weights on the loop-local z (115..145, 200..220, 270..290,
340..370); each sector's field is evaluated only inside the support of its
weight, so a sample costs one sector, two across a join. sectors 1 and 2 share
a block (gone by 145), 3 is built on 115..220, 4 on 200..290, 5 on 270..370,
6 from 340.

## the tiled halls

sector 1 (the poolrooms) and sector 6 (the hall back up to them) are one
material. `hallWeight(z)` says how much of it a position has: 1 to loop-local
z 50, gone by 66; on the first traversal only, in again over 345..365. every
hit is shaded the old way and the hall's way and mixed by that weight, so
neither join has an edge. all of it is shading at the hit point: the map did
not change.

* **light.** three rows of ceiling panels, at x = 0 and +-8.25 m (scaled by
  the lap's squeeze), one panel a 6 m bay between the columns, 2.4 x 3.6 m.
  each row lights the hall as a line light: `n.l / (0.7 + d)`, gain 3.4, with
  a half-strength term for faces that look along the hall; the soffit gets the
  panels' spill instead (`exp(-1.1 d)` from the panel's edge). ambient is a
  cool bounce, 0.20/0.27/0.29 from below to 0.30/0.31/0.32 from above. the
  lamp is 1.0/0.98/0.93 and reddens with the laps.
* **the panels fail.** a panel is dead when its hash is under `1.25 * decay`
  (`decay` = 0.15 a lap) and stutters at 14 Hz within `0.07 + 0.5 * decay`
  above that: a few stutter on the first lap, most are out by the fourth.
* **tile.** 0.25 m on walls, floor and columns, grout 0.6 of the tile, each
  tile toned by up to 10 % and set up to 0.025 off flat, 7 % of them a shade
  of pool blue. a blue course round the walls at 1.5..1.75 m, damp to 0.35 m
  over the water, a tide mark at 0.42 m, run-off under the soffit. grout,
  tone and tilt fade to their mean with the pixel's footprint. the soffit is
  paint in 1.2 m boards.
* **glaze.** every tiled face mirrors the panels: the reflected ray is solved
  against the ceiling plane and reads the panel mask there, Schlick from 0.04.
* **water.** the pool lies level, so its normal takes no map taps: four trains
  of ripples, analytic, fading with distance. the floor is seen through it:
  the refracted ray meets the floor plane in closed form, the tile there is
  lit like any other, dimmed where a column stands in it, multiplied by the
  caustics and absorbed per channel, `exp(-(path + 0.35) * (0.60, 0.13, 0.09))`.
  Schlick from 0.02 mixes in the reflection: the 40-step march as before, its
  hit lit as hall, and where the march runs out short of a surface (or in
  `LITE`, always) the hall solved in closed form (`hallEnv`: the ceiling plane
  or a side wall).
* **caustics.** two ridged sine webs. on the floor under the water, and thrown
  up the walls and columns for 3.5 m above it, falling off as `exp(-0.8 h)`.
* **decay.** the blood and the glowing cracks the laps bring are laid on the
  tile as on any matte surface (`decayDecals`).

## the crystal cave

sector 3 (loop-local z 130..210, `glsl/cave.ts`) is a limestone cave the
route slides down, 100 m in 80, lit by nothing but the rider's lamp. the
route, the camera and the speeds are as `kinematics.ts` has them.

* **the chamber.** an elliptical bore round the eye's line, 6.2 x 5 m
  half-axes swelling and narrowing by up to a third along the route, its
  centre 1.8 m over the eye and wandering 1.4 m side to side; the walls
  lumped and scalloped on oblique warped axes, so nothing rings the
  descent.
* **the chute.** a water-worn flowstone floor 1 m under the eye (the
  camera's offset), dished as `0.06 x^2` across, filleted into the walls
  (smin 1.2). the camera's carve tightens from 2.0 to 0.7 m over 126..134
  (`caveTight`) and opens again over 208..216, so the floor stands under
  the eye instead of being cut into a trench.
* **the quartz.** hexagonal prisms with six-faced pyramid points 1.6 x
  the apothem tall, out of the walls in 3.2 m cells of eight sectors
  (turned per cell): 80 % of the sectors that do not face the floor hold
  a crystal 1.4..5.2 m long, leaning up to 0.35 rad across and 0.1 along,
  twisted about its axis, with a sibling half as long leaning toward the
  sector's middle. no point comes within 2.4 m of the eye's line. the
  field takes the cell a point is in and the nearer neighbour; the
  sector's edge bounds the rest, and the 2.3 m clear round the eye's line
  lets a ray down the middle run.
* **the beams.** in 60 % of 9 m cells a giant prism (apothem 0.35..0.6)
  crosses the chamber 3.3..4.3 m over the eye, yawed up to 0.35 rad,
  never lower than 2.1 m over it, its ends in the walls.
* **light.** the lamp is 0.2 m over the eye: 1.0/0.91/0.78, gain 9,
  `1 / (1 + 0.008 d^2)`, a beam down the view (0.70..0.95 of the cone)
  in a spill of 0.3. ambient 0.05..0.08. no shadow march: a lamp at the
  eye hides its own shadows.
* **rock.** limestone 0.30/0.27/0.24, faint strata, mottled, darkened in
  streaks where water ran; cream flowstone 0.52/0.45/0.36 where it lies
  flat, wet (a sharper glint on the flat). the laps redden it and lay on
  the blood and cracks (`decayDecals`).
* **quartz.** milky to clear, some smoky, some faintly violet. the body
  carries the lamp from any side, each flat face its own brightness
  (light caught inside), a faint glow in its depth so a far crystal still
  reads; Schlick from 0.045 over the dark, a hard glint of the lamp. the
  laps turn it red. it is its own material (`MAT_CRYSTAL`) and marches no
  reflection.
* **the dark.** fog 0.02..0.025 with the lamp scattered down the view,
  density 0.022. a ray that runs out of steps (a grazing look down the
  chute) is shaded as the rock it is short of. `caveWeight` (in over
  122..136, out over 204..216) mixes all of it with the old shading, so
  neither join has an edge.

## the iron hydraulics

sector 4 (loop-local z 210..280, `glsl/hydraulics.ts`) is a pumping hall
the route crosses on an iron footbridge: the bridge is the route's own arch
(7.5 m up and down again over 70 m) and its sway, as `kinematics.ts` has
them; past the sector the deck runs on level at -125, into the labyrinth's
first landing.

* **the bridge.** a chequer-plate deck 2.6 m wide on the walked line, an
  edge beam each side and a cross girder every 2.4 m under it; the parapet
  is a Warren truss 1.1 m high (a round top chord, flat diagonals, a post
  every 2.4 m). tie rods 1.5 m out from the line every 4.8 m go up into the
  roof; every 9.6 m a bar between them carries an enamel lamp 3.25 m over
  the deck. two flanged mains run under the deck.
* **the clearance.** the camera's carve tightens from 2.0 to 1.1 m over
  208..214 (`hydTight`) and opens again over 282..288, so the deck stands
  under the eye.
* **the hall.** pit floor at -134, an iron roof at -97 on transverse
  trusses and girders over the columns. cast-iron columns at x = +-9 every
  10 m (fluted, on a plinth, under a capital), each with an arc lamp on a
  bracket facing the bridge. brick walls at x = +-16 (squeezed with the laps,
  never under 11 m) in running bond with a glazed cream band at the bridge's
  height, two flanged pipes along them, and between the columns a blind
  arched window 3.2 m wide, grey light behind iron glazing bars.
* **the machines.** in 20 m bays, mirrored bay to bay: a weighted
  accumulator 6.5 m off the axis (a casing, a steel ram, a red crown of
  ballast riding 3.5 m up and down, a guide frame to -102) and, across the
  bridge, a flywheel engine 7 m off it (a 6.2 m red rim on eight spokes
  turning across the hall's length, tapered pedestals, a crank, a rod and a
  crosshead working a pump on the bridge side). each machine has a bounding
  box, a point takes only its own bay, and nothing comes within 3.8 m of the
  axis, so the deck (3.34 m at most, rods included) is always clear.
* **light.** the lamps over the walk: 1.0/0.74/0.46, gain 10,
  `1 / (d^2 + 1)`, thrown downward by the shade; they fail with the laps as
  the halls' panels do. the arc lamps: gain 90, `1 / (d^2 + 4)`, the nearer
  two each side. ambient 0.035..0.044. no shadow march; the AO darkens what
  is tucked in. both kinds of lamp leave a halo in the haze (`hydGlow`).
* **iron.** deck plate worn bright and glossy down the middle; the bridge
  and columns green paint, rusting; machines black cast iron with an oil
  sheen; rams and rods bright steel that sees the haze; mains, crowns and
  rims red oxide; wet stone flags in the pit. the laps redden it all and the
  lamps, and lay on the blood and cracks (`decayDecals`).
* **haze.** density 0.02, dark and warm, a little brighter looking up.
  `hydWeight` (in over 198..208, out over 284..294) mixes all of it with
  the old shading, so neither join has an edge. the field is marched at 0.9
  of its value (the gears and pneumatics it replaced needed 0.4).

## the stair labyrinth

sector 5 (loop-local z 280..360, `glsl/labyrinth.ts`) is a hall after M. C.
Escher's *Relativity* (1953): one enclosed, daylit space under three
gravities, its stairs, landings, doorways and balustrades each true to their
own up, all of it white plaster and stone drawn as an engraving. the route,
the camera and the speeds are as `kinematics.ts` has them: sixteen storeys
of 3.44 m, each a 1.95 m landing and a 1.3 m rise, climbed at 1.6 m/s, then
the drop to -180 at 18 m/s and the wade into sector 6.

* **the walked stair.** limestone, 5 m wide (scaled by the squeeze), swaying
  with the route. each landing is a 0.35 m slab; each flight twelve risers
  of 0.287 m on 0.118 m treads with a soffit 0.3 m under the inner corners.
  an iron rail 0.95 m over the landings and the pitch line both sides,
  balusters every 0.36 m, a newel with a ball at the head of every landing
  on both sides. the first landing reaches 12 m back into the hydraulics;
  the seventeenth is broken off over the drop.
* **the clearance.** the camera's carve tightens from 2.0 to 1.1 m over
  280..292 (`labTight`) and opens again by 332, so the treads stand under
  the eye.
* **the courtyard.** two plastered walls at x = +-13 m (not squeezed), open
  above and below. the walls are cut into bays 26 m along (centred on
  z5 = 0, 26, 52) by 27.52 m up (eight storeys, centred on y = -122 + 27.52 n),
  so the climb runs corner to corner through the middle of the bays on the
  diagonal. each bay keeps one of five gravities by its hash: up the hall
  (35 %), along it either way (15 % each), upside down (15 %) or out of the
  wall (20 %), and is mirrored along the wall half the time.
* **a bay in the wall's plane.** in its own frame (h along, v up, from the bay
  centre): an arched doorway 2.4 m wide, 2.6 m to the springing, recessed
  0.9 m at h = -5 on v = -6; a balcony 6 x 3 m before it with a balustrade
  on its edge; a flight along the wall from h = -2, fourteen risers of
  0.2 m on 0.28 m treads, 1.6 m wide, to a landing, a balustrade on its
  outer side; an arched window 2 m wide at h = 4 over v = -1, 1.5 m deep,
  onto a garden (a pale sky and the dark of trees, unlit and unshadowed).
* **a bay whose floor is the wall.** a solid flight rising out of the wall,
  thirteen risers of 0.2 m on 0.28 m treads, 2.4 m wide, with a balustrade
  both sides, to a 2.8 m plinth, and an arched portal beyond it: piers to
  3.4 m and a semicircle of 1.45 m. nothing reaches past 5 m from the wall,
  so the climb (within 6 m of the axis) stays clear.
* **the double stairs.** across the courtyard, wall to wall: a flight of 57
  risers of 0.2 m on 0.281 m over 16 m, treads on top and treads on the
  underside 0.7 m below, a balustrade over each, a 5 m landing on each wall,
  2.4 m wide. two below and ahead of the climb (z5 = 8 and 34, 9 m under the
  bay centre), two above and behind it (z5 = 18 and 44, 9 m over it), the
  rise alternating in x. each is at least 11 m from the climb.
* **the cross walls.** at z5 = 13 and 39, a wall 1.4 m thick from wall to
  wall with a round-arched opening 18 m wide, its springing 1 m under the
  climb's line there, so the walked stair passes under the arch.
* **every bay's furniture stays 5 m inside its edges**, so the field takes
  only the bay a point is in; the double stairs and the cross walls take
  only the nearest.
* **light.** daylight from high over the left wall and behind the climb
  (`labSun`, (-0.45, 0.80, -0.40)), so the right wall and the risers ahead
  are in the sun, with a 28-step soft shadow march (not in `LITE`); sky
  0.20..0.42 from below to above, 0.10 thrown back off the sunlit wall onto
  faces that look at it. the laps halve the sun and redden the stone.
* **the engraving.** the colour is taken 60 % to grey, then hatched: lines
  0.15 m apart, horizontal on walls and risers and diagonal on floors and
  treads, as wide as the face is dark (none above 0.6 luminance), fading
  to the face's tone where they would fall under a pixel.
* **stone and plaster.** the walked stair toned per tread and per
  1.25 x 0.975 m landing slab, worn pale down the middle; plaster faintly
  stained; the laps lay the blood and cracks on it (`decayDecals`).
* **haze.** density 0.011, from 0.40 looking down to 0.80 looking up,
  reddened by the laps. `labWeight` (in over 282..292, out over 352..362)
  mixes all of it with the old shading, so neither join has an edge.
