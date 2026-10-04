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

## the decay you can see

`decay()` is the geometry's: the corridor squeezes by it, and that squeeze has
to agree with the walker's (the physics tests hold the span inside the
tightest hall). `decayVis()` is what the eye gets — the cracks, the dead lamps,
the lens, the grade — and it does not wait for the slow geometric curve: from
the second lap the walls are visibly splitting (≈0.3), by the third they are
coming apart (≈0.6).

from the second lap the cracks also **leak red into the air**: the march gathers
`leakAt` on its way through the hall — sheets of light off the splits in the
walls, falling off with distance from the wall, and columns up out of the
floor — and it lands as red in-scatter, stronger every lap (`leakI`).

## materials and light

every surface is a Δ scan (`delta/`), sampled triplanar in loop-local space so
the textures repeat with the ring: brick in the loading bay and the furnace
floor, shuttered concrete in the piston gallery, spalled concrete in the long
run, subway tile in the coolant tier, corrugated sheet in the gearworks, steel
in the brake run; steel and quarry tile underfoot, concrete overhead; hazard
paint on frames and power packs, timber crates, painted drums and pipes (the
paint chipped back to the scan wherever its own AO says it gets knocked),
rubber hoses. rust comes out of the wear field and the decay on top.

lit the way the loop line lights its bays: the three nearest lamps through a
GGX BRDF, the hall's bounce as the ambient, and every nearby lamp's glow in the
air in closed form (Macklin's single scattering) — this hall's five and the
next hall's, so the halos never pop at a bulkhead. linear light throughout,
ACES at the end.

the webgl 2 build is the route's; the index's channel is still a GLSL ES 1.00
sketch of the drop (`foundryPreviewFrag`).

## the clutter

crates, drums (one always on its side) and hydraulic power packs — tank, motor,
accumulator, hoses climbing to the service pipes — stand along the walls on a
per-hall lattice that falls *between* the machine stations, so nothing stands
where a ram drives out or a gear rises; never against a bulkhead, never in the
brake run (too narrow) or on the furnace floor (a hole). two flanged service
pipes run under the ceiling on brackets, and about a third of the flanges leak:
a jet of steam that slows, spreads and rises, gathered by the march like the
leaks and lit by the hall.

## the drop, looking down

while the cage falls the head goes down — further the faster it falls — so the
shaft comes up through the mesh floor; in oblivion it stays down.

## gates

```bash
bun test src/journeys/foundry/physics.test.mjs
bun tools/journey.mjs probe foundry --from=0 --to=440 --step=8
bun tools/journey.mjs scan  foundry --from=94 --to=114 --step=0.25   # the crossing
bun tools/journey.mjs fps   foundry --at=20,100,390
node tools/journey.mjs glsl foundry --bare
```
