# the liminal journey

## the motive

the first journey and the plainest: a walk down a corridor that keeps being
somewhere else. poolrooms, a glass slide down into the dark, a crystal cave,
iron hydraulics, a labyrinth of stairs, a hall back up to the pools; then the
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
`setpieces` (sector 666), `march` (the map), `shading` (normals, AO, the tiled
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
