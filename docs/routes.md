# Routes that turn

How each journey bends a route that is longer than any geometry could cover, and what each approach costs. Per-journey constants live in `docs/journeys/<slug>.md`.

Most journeys are a straight `+Z` scroll with the scenery changing around them.
Three are not, and all three solve it differently:

* **stairwell** keeps each act in its own coordinates and joins them *in space*:
  every act ends in a wall — a ribbed dam or a stratified cliff — with the stair
  running through a strip-lit portal tunnel, and the next act stands beyond it,
  shifted to meet the stair, visible through the far mouth. Which side of the
  wall a ray ends on decides its sun, sky and air; the slope blends through the
  tunnel with the rail height as its closed-form integral, so the camera is C¹
  across the switch of coordinate systems at the wall's midline. Anything sampled
  by position is sampled in a frame that does not change there, and three acts
  are always built — this one, the next, and the next one's far wall — so
  nothing arrives at the switch. See `docs/journeys/stairwell.md`.
* **switchback** rectifies instead: the track is always straight ahead in the
  cart's own frame and the *world* bends around it, fitted to a quadratic in
  depth. Grade therefore lives in the up vector rather than in the geometry,
  which is what lets the railway tip further over on every lap — by the fourth it
  is descending at nearly eighty degrees, and then the rails stop altogether. See
  `docs/journeys/switchback.md`.
* **natatorium** takes that idea and moves the table to the CPU. `kinematics.ts` (per journey)
  owns an authored chain of sections and uploads, every frame, the affine
  transform carrying a point from the camera's current section into each
  neighbour's — so turns are *data* and can be any angle, and the shader holds no
  route table at all. Five things make it work:
  * **`min`, never `smin`.** Rooms are carved by unioning air boxes and negating.
    Inside a union `min` under-estimates distance to the boundary, which is the
    safe direction for a sphere trace; `smin` returns up to `k/4` *below* its
    inputs, so negating it over-estimates and a grazing ray at a door jamb
    punches through the wall. Corners are rounded with `sdRoundBox` instead —
    which is also what real tiled halls have, since coved corners are moppable.
  * **Every per-section quantity goes through the corner blend**, not just
    position. The camera pose is a weighted mix of both frames' predictions
    across a window straddling each boundary, so the path *and its tangent* are
    continuous and the camera arcs through a corner instead of doglegging. Miss
    one term — the lateral sway amplitude, say, which scales with room width —
    and that single scalar snaps the camera sideways at the join.
  * **Shading resolves the owning slot** — and so does anything else swept
    through the scene. This is the rule above applied to the GPU. `mapAir`'s
    union tells the march how far the concrete is and then throws away *whose*
    concrete it is, so every shading term downstream used to assume
    the answer was the camera's own section — and a room seen through a doorway
    was lit with the wrong width, ceiling height and lamp pitch, in a frame that
    rotated out from under it the moment the slot window advanced. `resolveSlot`
    re-runs the loop once at the hit point (one evaluation, against ninety-six)
    and returns the point, the normal and the view ray in the winner's own
    coordinates. A point's coordinates in a section's own frame do not change
    when the camera crosses a join, and that invariance is the whole fix. The
    lamp *halos* are the same rule and were missed for a long time: they are
    swept along a ray that goes wherever you look, so they must sum over all
    three slots, not the camera's — otherwise every halo on screen jumps the
    instant the slot window advances, while nothing in the picture behind them
    moves at all.
  * **Nothing added to the SDF may enter the walked tube.** Fittings and join
    dressing are intersected with the complement of a cylinder swept along the
    walked line. It cannot fail to clear the camera, because it is defined by
    where the camera goes. (hollow-orchard bores the same aisle with a capsule.)
  * **A bound is not a distance.** Every fitting and every join block bails
    early by handing back how far the point still is from the volume that
    encloses it, which is what makes a twenty-two metre pool affordable to
    cross. But the march cannot tell a bound from a surface: if one is allowed
    to reach zero the ray stops on it and it is *shaded as tile*. The flume's
    bounding sphere appeared as a tiled ball hanging over THE GRAND HALL, the
    slab around the lane ropes as a black lid twelve centimetres above the
    water, and the join zone's z-plane sealed the doorway it was dressing. Bail
    only while the bound is clear of the hit epsilon; everything a bound
    protects is thin, so the band this costs is thin too.
  * **Damage is geometry, decoration is shading, and they share one lattice.**
    A missing tile is a recess unioned into the air, cut on exactly the grid
    `tileSurface` draws grout on — same cell size, same per-face salt, same
    hash. A painted hole has no depth to be dark inside, no lip for a strip
    light to rake across and nowhere for the red to come out of. Only the cell
    the point is in is ever evaluated, which *over*-states the air and therefore
    under-states the concrete, the one direction a sphere trace may be wrong in.
    Tiles left standing are pushed proud by a non-negative offset *added* to the
    shell, which can only shorten a step.
  * **A quantised field through a pinhole draws the quantisation.** The red
    volumetric used to ask the tile lattice where the holes were. Adjacent
    pixels' taps land in the same cell, the per-cell answer is constant across a
    tile face, and what appeared on screen was a flat tile-shaped red rectangle
    — not a shaft, a decal. A term accumulated along a ray has to be continuous
    in space. The surface half of the effect knows about individual holes; the
    air half only needs to know it is near a wall.
  * **Detail must fade to its mean, not to zero.** Fourteen millimetres of grout
    on a 220mm tile is a third of a pixel at the far end of a twenty-two metre
    hall, and a third of a pixel of pure black sampled once per pixel is not a
    grout line, it is moiré — which is why every far wall in this building read
    as corduroy. There is no mip chain (nothing is textured) and no derivatives
    (ES 1.00 has no `dFdx` without an extension), so the footprint is estimated
    from distance and the grout *widens* as it fades. Widening keeps the wall
    reading as tiled; fading stops it shimmering.
  * **Animated offsets are functions of a uniform, never of position.** The
    blocks that reconfigure each doorway ride a single CPU-computed deploy
    scalar. An offset that varied with `p` would add its own derivative to the
    gradient, and in a *negated* field over-estimating is not an artifact — it is
    a grazing ray leaving the building. This is why the step factor here is still
    0.95 where foundry, which morphs geometry across its boundaries, has to cut
    to 0.78. Corollary: the deploy curve is quintic rather than the obvious
    damped hinge, because a hinge rings above 1 and settles back through it, and
    the shader culls the whole block set on `deploy >= 1`.

* **switchback** does not move the camera at all. Both of the above model a
  route as a *chain of straight rooms*; a rail is not that. A railway's defining
  quantity is curvature — continuous, and the thing that banks the car — so
  chopping it into segments with joins is precisely what you must not do. So the
  shader marches in a **rectified** space where the track is the +Z axis, dead
  straight, with the cart at the origin, and the real curve arrives as four
  floats: `bend(z) = (ax*z + bx*z^2, ay*z + by*z^2)`, fitted every frame and
  applied by looking a point up at `p.xy - bend(p.z)`. Rails, sleepers, trestle
  bents and lamps become lattices along a straight axis, which is as cheap as
  geometry gets, and there is **no world position at all** — not a small one like
  natatorium's section-local coordinates, none — so `?t=100000` is as exact as
  `?t=1`. Four things make *that* work:
  * **A bend is a shear, so it stretches distance.** For `T(p) = (p.xy - bend(z), z)`
    the Jacobian is the identity plus `bend'(z)` in one column, so
    `|grad(f o T)| <= 1 + |bend'(z)|` and dividing the whole map by that is
    provably conservative. It is a function of z, so near geometry marches at
    full speed and only the far end of a hard turn pays for it.
  * **Rectification has a range limit.** A track that turns 90 degrees inside the
    view distance leaves the +Z half-space and no quadratic can follow it out.
    That is what `MAX_CURV` is, and the route table asserts against it —
    pointwise for the shear's cost, and windowed for the correctness. It is not
    much of a constraint, because a coaster's turns are wide *because* it is
    fast: 44 metres of radius at 20 m/s is still 0.9g in your ribs.
  * **The fit is pinned by camera-space depth, not by arc length.** In a hard
    turn the track's depth grows far slower than its length — 88 metres of rail
    through a 60 degree sweep only reaches 56 metres ahead — so pinning by length
    puts the far knot outside the range the shader marches and lets the quadratic
    extrapolate across the part of the picture you can see.
  * **The car is bolted to the rail, so a bank rotates the world, not the rider.**
    Bent space is the track's frame and the bank is carried entirely by where
    `uUp` and `uSun` point. The honest consequence is that a banked turn is
    invisible inside a tunnel, exactly as it is in a real POV video, and the
    moment the walls fall away over the void the whole sky rolls.

  Two bugs this cost, both worth knowing because neither looks like its cause.
  **Iteration exhaustion is not a miss:** a ray down a long narrow bore grazes
  the wall for its whole length, burns all its steps on small useful-looking
  positive ones, and rendering that as sky put a wing-shaped hole through the
  roof of the chalk drift, in exactly the shape of the drift. **The fog has to be
  complete at the march limit, not merely thick:** either side of `T_MAX` the
  shader renders two different things, so any surface still showing through there
  draws the set of directions that just barely reach something — which over the
  overlook was a perfect dark arc hanging in the sunset with no object anywhere
  near it.

  A third, in the same family as natatorium's halo bug: **a room is a range of
  *depth*, and a ray not looking down the track covers less depth than distance.**
  Resolving the room from `t` rather than from `rd.z * t` says a ray fired
  sideways at ninety metres is ninety metres down the line, and lights the drift
  with the lamps of the room two portals away.

## The fourth way of turning

There is a fourth, and it is the one that cheats.

* **loop-line** just builds the whole thing: nine bays and a chord, 2.08 km. The
  three approaches above all exist because the route is *unbounded* — a descent, a corridor chain, a railway that
  runs forever — so no amount of geometry can cover it and the world has to be
  generated around a moving observer. A **closed circuit is not unbounded**. It is
  2.08 km long and then it is the same 2.08 km again. So the entire loop is built
  once, out of actual triangles, in real world space, and an ordinary camera moves
  through it.

  Everything the other three work hardest at evaporates. There is no turn-radius
  floor, because nothing is being fitted to a quadratic. There is no coordinate
  drift, because arc length wraps at the loop length and the world never
  translates. And the track can cross over itself, which not one of the SDF
  journeys can express, because it is just vertices.

  What it buys beyond that is rupture you can afford. Meshes are pre-fractured at
  build time and displaced per-shard in the *vertex* shader from one uniform, so
  the world comes apart with nothing re-uploaded and no instruction added to the
  frame: the last lap costs exactly what the first did. See
  `docs/journeys/loop-line.md`.

