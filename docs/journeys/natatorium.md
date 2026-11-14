# the natatorium

## the motive

a municipal pool building carved out of solid rock and left to flood. you walk
its floor along a turning route through tiled halls, service runs, a locker
row, a plant room and a cistern; the route only ever goes downhill, and every
lap the water is higher. the building rots as the laps pile up (tiles let go,
the holes they leave glow red) and the signal fails on lap 5.

the route, the simulation and the section table live in `kinematics.ts` and
`kinematics/route.ts`; the spec for those is the code's own comments and
`docs/routes.md`. this file settles the look.

## the shader

GLSL ES 1.00, one pass, built from `glsl/` pieces in this order:
`foundation` (uniforms, SDF helpers, decay, broken tile), `route` (section air,
aisle, joins), `fittings` (lane ropes, ladders, planters, columns, the flume,
conduit, lockers, pumps), `waterSurfaces` (water, caustics, tile, props, lamps,
motes, fish), `dressing` (everything below), then the camera, march, water
split and post in `shader.ts`.

march budget, unchanged by the detailing: 96 primary steps at 0.95, 20 for
the reflection off the water, 4 AO taps, 4 normal taps. all detail is shading,
evaluated at the hit point only, never in the map.

## the surfaces

every edge below fades to its mean through `lodFade(feature)` (no mip chain,
no derivatives in ES 1.00).

* **tile.** walls 0.22 m, floor and ceiling 0.30 m, on the lattice the broken
  tile geometry uses. each tile is tilted by up to 0.035 off flat
  (`tilt`, 0.07 peak to peak) so tube reflections step from tile to tile.
* **mosaic course** at the water line: quarter-tile mosaic in three blues
  (0.10/0.20/0.42, 0.14/0.32/0.52, 0.22/0.46/0.58), mean 0.16/0.32/0.50.
* **basin floor**: aqua glaze (x 0.78/0.95/0.98) in the tiled halls, grey white
  elsewhere. lane lines in navy (0.05/0.08/0.22) down the middle of each 2.4 m
  lane (the ropes run between them), 0.10 m half width, a T 1.5 m short of each
  end. sump grates 0.22 m square against both walls every 9 m. silt banked into
  the cove, scaled by grime and decay.
* **walls**: a dark cove course to 0.14 m, a frieze course at
  `min(2.10, H - 0.75)` (teal in tiled halls, blue in gutters and the vault,
  ochre in the rest) with a cream bead over it, three ragged tide lines at
  0.24 / 0.47 / 0.70 m above the present water, rust runs from the soffit
  fading toward the water, shadow under the soffit and into the cove, and
  slatted vent grilles 0.76 x 0.34 m, 0.62 m under the ceiling, one every
  second lamp, in rooms taller than 2.7 m.
* **soffit**: damp blooms with a darker rim, dark enamel housings a hand wider
  than each diffuser, shadow into the ceiling corners. diffusers have ribs,
  two brighter tube bars and dimmer cathode ends.
* **concrete fittings**: a lift joint every 1.2 m, shuttering grain, a dark
  wet foot to 0.9 m.
* **the raw rooms** (THE STAIR DOWN, THE DRAIN, THE CISTERN, THE RISER) are
  below the tile line and untiled: `concreteSurface` in place of
  `tileSurface`. walls and soffit board-formed in 0.15 m boards (each its own
  tone and grain, staggered butts, a leaked fin on every seam), pour lifts every
  1.2 m with bleed under them, form ties on a 0.6 m grid with rust rings and
  white weeps, efflorescence under the lifts above the water, noise cracks that
  glow late like the tile's; the floor a trowelled slab saw-cut every 3 m.
  concrete drinks water (0.78 wet, rough 0.82 dry). no cove, no frieze, no
  proud tiles; only the side walls spall into tileBreak's pockets, and only
  they spill red. THE CISTERN's columns and vault are below.

## the cistern

THE CISTERN (the one RAW section wider than 6 m) is a hall of columns under
groined brick vaults, carried on the board-formed walls.

* **bays**: columns on a 5.2 m grid across (`CIST_PX`; the outermost line
  falls on the side walls at x = ±13 as half columns) and 6 m along
  (`CIST_PZ`; columns at z = 3, 9 .. 27, so both end walls meet the crown of a
  transverse barrel). No column within 1.98 m of the walked line.
* **vault**: per bay, the union of a barrel across (radius `CIST_RX` 2.6) and
  a barrel along, stilted to the same crown (`CIST_RZ` 3.0, scaled along z by
  2.6/3, which only shortens steps); the brick is everything above both.
  springing at H - 2.72 = 4.78, crown 0.12 under the slab. bounded by the
  springing line, so it costs nothing below it.
* **columns**: square plinth (0.62 half, 0.42 tall), a torus at the foot, a
  shaft tapering 0.42 to 0.39, an astragal, a basket capital widening 0.40 to
  0.56 (held by its 1.05 Lipschitz), an impost block 0.64 half; bounded on a
  0.68 square.
* **materials**: `MAT_STONE` limestone, a vein per column, drum joints every
  1.1 m, a calcite crust at the water line, weed below it and a silt-dark foot;
  `MAT_BRICK` 0.25 x 0.075 brick in courses round each barrel (running bond),
  lime mortar, bloom down the groins thickening with decay.
* **floor**: a blanket of silt over the tile, rippled, drifted against the
  plinths, worn through to the tile in patches, thicker every lap.

## the water

above the surface the water absorbs per channel, Beer-Lambert,
`exp(-(path + 0.18) * (0.62, 0.17, 0.12))` toward (0.020, 0.085, 0.100), so
even ankle deep it reads as water rather than glass. the ripple normal bends
the floor's light (brighter under crests). at the contact line with anything
(one `mapScene` per water pixel) the meniscus catches a thin line of light and
a hand's width of shadow collects. the Schlick reflection, the scum film and
the submerged path (fog, shafts, motes, fish, Snell's window) are as before.

## the grade

after the Reinhard shoulder (white point 2.6) and the 0.92 gamma, exposure is
1.14 into it, then a soft S (0.38 of a smoothstep), saturation 1.18 and a teal
lean in the shadows (0.90/1.02/1.05 at black, neutral by 0.55 luminance).
probe `blown` must stay at or under the pre-facelift numbers (0.019 peak, in
THE LANE POOL at t=16).

## the preview

`glsl/preview.ts`, exported as `natatoriumPreviewFrag`. one bay of a lane pool
with no march at all: the hall is a box (half width 5.6, ceiling 6.4, pool
1.75 deep) with pilasters every 6 m and beams across the ceiling, solved in
closed form per ray (the two-plane trick in `hallHit`). arched clerestory
windows in every bay, two runs of fluorescent fittings, tiled walls with a
mosaic course, a frieze and tide lines, lane ropes as exact cylinders, lane
lines and grates on the floor, a doorway with an exit sign at the end of the
hall 34 m ahead. the water reflects and refracts one hall solve each, with
Schlick fresnel and per-channel absorption. ACES at the end.
