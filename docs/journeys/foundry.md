# the foundry

## experience contract

seven machine halls on a ring, walked between drops down a hoist shaft whose
cable has already parted. the ring is walked four times. the fourth drop does
not stop.

the physics is real (`physics.ts`): the lift is semi-implicit euler under
gravity, quadratic drag, coulomb brake friction with wedge seating and a
stribeck speed curve, a governed lowering servo and a nonlinear hydraulic
buffer. six free rigid bodies ride loose in the cage. the walk is an
inverted-pendulum gait whose camera pose is the *output* of the gait, never a
sine. nothing here is authored as an easing curve.

## the drop, run by run

`liftTopFor` × `brakeYFor`. two knobs, because one cannot do it: lowering the
trip point alone buys free-fall metres and gives them straight back as braking
seconds, so the drop comes out flat. the shaft has to get taller as well, which
is why the shaft head is a uniform (`uFall.z`) and not a constant.

| run | top | shoes bite | free fall |
| ---: | ---: | ---: | ---: |
| 1 | 120 m | 44 m | 76 m |
| 2 | 146 m | 39 m | 107 m |
| 3 | 172 m | 34 m | 138 m |
| 4 | 198 m | 44 m | 154 m, then nothing |

run 3 arrives with barely the stopping distance it needs and touches the
buffers. the tests assert the free fall is strictly increasing.

## the last run

`OBLIVION_LOOP = 3`, labelled `LOOP 4`. the trip gear still fires where it
always did — it is not the trip that fails, it is the shoes. three arrivals have
polished the rails flat, so the wedges cannot seat: they jam, weld, tear free,
and bite again with less behind them each time (`OBLIVION_BITE` × a stick-slip
`grab` × a decaying `grip`). for about two seconds it very nearly holds, which
is the point. then it does not, and the pit it was meant to stop short of has no
floor in it.

`MODE_OBLIVION` is terminal. it is also the journey's `signalAge` source — the
foundry used to borrow the lap-count stand-in every looping journey uses, and no
longer needs to, because it has a real ending now.

**the fall is periodic.** `y` wraps inside `OBLIVION_PERIOD = 64 m` and the
shader's machine repeats on the same period; `fallen` keeps the real number. an
unbounded `y` is a float that runs out of mantissa in about four minutes, and it
would do it while the camera is the only thing in shot. the debris are carried
in world height, so they are lifted by the same amount on every wrap or the
contents of the cage are left behind in a place that no longer exists.

drag is higher down there (`OBLIVION_DRAG`) — the cage is tumbling broadside
through a machine rather than dropping down a clean hoistway. terminal velocity
lands at ~46 m/s, which is also the fastest the gear rims can pass and still
read as gear rims.

## the stepping stones

the furnace floor is cut away over the melt. the crossing is **one plate**, not
a line of them: tile *i* is tile *i−1* rotated a half turn about the edge the
two share, so the thing tumbles end over end and the tile under your boots is
the hinge for the next one. that is why every step is exactly one tile and the
route lives on a grid — edge-adjacency is what makes the flip possible, and a
flip about a *side* edge instead of the leading one is how the path turns.

16 tiles, 2.4 m each: forward twice, hard left out to the wall, forward twice,
four tiles straight across the hall, five more up the far side. 36 m of walking
for 21.6 m of ground. it starts on the centreline and finishes against the
opposite wall.

one `sdBox` per tile instead of a six-panel unfolding cube, so sixteen of them
cost less than the eight they replace.

### the route

a uniform cubic B-spline through the tile centres, with the control sequence
extended straight at both ends so it joins the hall centreline with matching
value *and* tangent.

three properties earn it:

- **it rounds the corners.** a polyline puts a step change in lateral velocity
  at every turn and the camera snaps sideways. C² spline ⇒ C¹ heading ⇒ nothing
  to jitter. the derivative sweep in `physics.test.mjs` fails against a polyline
  and passes against this, which is the only evidence worth having — a
  discontinuity in an authored derivative is invisible to every screenshot.
- **the corner it cuts is one sixth of a step**, 0.4 m, against a 1.2 m tile
  half-width. the rounding stays on the plate.
- **z cannot go backwards.** the derivative is a quadratic B-spline over the
  forward differences, every `iz` difference is 0 or +TILE, and the basis is
  non-negative. structural, not tuned.

speed along the route dips to ~0.71 through a corner, so you slow to turn. that
is a consequence, not a decision.

### two clocks

a lap is `LAP_ARC` (266.4 m) of *walking* but `CYCLE_LEN` (252 m) of *ground*.
everything that measures distance walked uses the first; everything that
measures where you are uses the second. conflating them walks the route off the
tiles, and wrapping the distance to find the boarding point starts every lap
`SPAN_EXTRA` further down the loading bay than the last — which it did, once.

the route's lateral offset travels in `uGait.y` alongside the sway, because the
shader's only consumer of that slot is the eye's x.

### it has to fit

`SPAN_HALF_W < FURNACE_HALF_W × (1 − maxDecay × MAX_SQUEEZE)`. the walls come
*in* as the world decays and the tiles do not, so the clearance is asserted by a
test rather than eyeballed. the furnace hall is 7.8 m to the wall for this
reason.

## the decay

the lap used to come apart by bending — a low-frequency sin/cos through the
sample point. it read as wind. nothing that only leans ever reads as damage.

it now uses the liminal journey's vocabulary instead: `crackField` splits the
plate along a vein field whose zero set is the crack, `fieldBoil` corrupts the
distance function itself, and the split is shaded by `mix` toward a furnace core
— never `+=`, which is the term that blows the whole frame out once the decay
saturates.

**the crack term adds to a positive-inside field**, i.e. it over-estimates the
distance to the wall, and a sphere trace cannot survive an over-estimate: it
steps through the plate and the corridor fills with holes. the march step comes
down with the decay to absorb it, and that is what it costs.

## materials

no image textures. every surface is a height field, and that field does three
jobs — tints the albedo, drives the roughness, and perturbs the normal.

three scales, triplanar-blended: `bloom` for the corrosion a whole wall is read
at, the weld/rivet/pit layer a step away, and `micro` within arm's reach, the
last faded out by `detailFade` because past a few metres it is noise in a pixel
that cannot resolve it. `cavity` darkens the crevices and occludes both the
specular and the fresnel rim — a rim highlight surviving inside a pit is the
single most plastic-looking thing a metal shader can do.

triplanar rather than pick-one-axis: the old projection swapped abruptly across
every rounded box corner and the texture visibly sheared.

## gates

```bash
bun test src/app/journeys/foundry/physics.test.mjs
bun tools/journey.mjs probe foundry --from=0 --to=440 --step=8
bun tools/journey.mjs scan  foundry --from=94 --to=114 --step=0.25   # the crossing
bun tools/journey.mjs fps   foundry --at=20,100,390
```
