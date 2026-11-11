# the stairwell

## experience contract

the stairwell is a 500-unit anthology repeated four times, and then it stops
repeating. every act keeps a walkable descending stair in view — a real flight
now, stepped treads with nosings, a soffit, steel stringers and a balustrade —
but the landscape, machinery, light, sky and sound language must be recognisably
different. the fourth shear horizon is a terminal authored fall, and past 2000
units the route enters purgatory and never leaves it.

| distance | act | sky (Δ) | visual contract |
| ---: | --- | --- | --- |
| 0–70 | spillway threshold | `DAWN` | mass-concrete flood control: dam wall, ogee chute, sluice bays, baffle blocks, a basin of still water |
| 70–155 | protean weather bridge | `OVERCAST` | nothing but structure and weather — portal pylons, suspension catenary and hangers, an open grating deck on a truss, low wind fencing, a cloud deck and a cloud sea below |
| 155–235 | turbine canyon | `DAY` | a stratified canyon wide enough for its machines: three-blade rotors on pedestals, penstocks, a gantry |
| 235–325 | conveyor escarpment | `EVENING` | warm quarry benches, a roofed conveyor gallery on trestles, bucket wheel, transfer tower |
| 325–410 | cooling field | `HAZE` | hyperboloid towers on raked column rings, pipe racks, banded chimneys, cooling ponds |
| 410–500 | shear horizon | `AURORA` | torn strata, suspended stair fragments, rings, the rift |
| 2000+ | **purgatory** | `OVERCAST`, drained | the six acts recurring as monochrome ghosts, endlessly |

## seams, not crossfades

the first version handed one act to the next by mixing their distance fields over
the closing 48% of each act and hiding the morph behind a veil of fog. a mixed
distance field is a blob that is neither place, and half of every act was soup.

now every act ends in a **wall** — two hundred-odd units across and fifty high, a
dam with buttress ribs and a parapet where the act is built of concrete, a
stratified cliff where it is built of rock — with the stair running through a
strip-lit portal tunnel 18 units long. the next act is *there*, beyond the wall,
in its own coordinates shifted to meet the stair, and you see it framed in the
far mouth long before you reach it.

everything that differs between two acts is decided by which side of the wall a
ray ends on:

- a ray that hits geometry past the seam is shaded with the next act's sun, sky
  light and air; one that hits before it, with this act's; one that carries on
  through the next act's far bore, with the act beyond that;
- a ray that escapes takes the sky beyond a wall only if it crossed that seam's
  plane *below the top of the wall* — through the portal — so the sky above a
  wall is never split;
- the air is integrated in pieces, each act's over its own stretch of the ray.

**the stair is continuous across the seam.** rise and run differ per act, so the
slope is blended through the tunnel by smoothstep and the rail height is its
integral in closed form — a smoothstep integrates to u³ − u⁴/2 — which gives an
exact landing at any z and a camera height that is C¹ across the switch of
coordinate systems. the x wiggle is blended the same way.

**the act changes at the wall's midline**, where the old act's coordinates and the
new one's describe the same point. so what is in view must not depend on which
act the camera is in — only on where things are:

- **three acts are always built**: this one, the next, and the next one's far
  wall, with the act after that framed in its bore; the joined path runs through
  both seams ahead. the first build stopped at the next act, so its far wall —
  fifty units high, straight down the line of the stair — came out of the haze
  on exactly the switch frame;
- the scene is cut into **stretches** at the walls' midlines, and one environment
  call draws whichever stretch a point is in, in that act's own coordinates;
- everything sampled by position is sampled in its stretch's frame: textures,
  rupture noise, water ripples, the tread grid, the balustrade posts. a wall is
  drawn in the coordinates of the act beyond it (which become the current ones
  as the camera passes through, so a tunnel does not change pattern under it)
  and in the material of the act it closes. debris and the residue's ghost cycle
  hash on distance along the whole route (`gZ0`); act II's cloud deck lies in act
  II's own coordinates wherever act II is in view;
- the walking pace leaves each tunnel at the speed it went in and settles to the
  new act's over its first stretch, so pace and its rate of change are
  continuous too.

`journey.mjs scan` at a 10 ms step found each of these as a spike on exactly the
switch frame — 3.2× the motion baseline for the wall alone. every switch now
measures inside the motion itself.

scenery stops at the walls' faces: inside a seam there is only the wall and its
bore. (a quarry stockpile happens to sit on the path at act IV's origin and
filled the tunnel until it did.)

the route table in `kinematics.ts` (per journey) is the single source for act lengths and the
seam half-length (`SEAM_HALF`): the shader generates `actLen` from it and the
renderer imports it, so the shader, the simulation and the exposure blend agree
about where every seam is. the simulation also names each act's neighbours
(`uPrevSection`, `uNextSection`, `uFarSection`), because the fourth shear
horizon's far wall opens on the residue, not on the spillway.

## light and material

- each act stands under a photographed sky from Δ, and its sun comes from where
  that photograph puts it, turned by a per-act yaw so the light rakes across the
  stair — never from lower than 18°, because a true dawn sun at 4° lights only
  faces square to it and every tread goes flat.
- sun: GGX against the act's sun with iq's soft shadow along the light. sky:
  irradiance from the map's mip chain (about a fifth of the sun on a clear act —
  what makes the overcast act soft is its small sun, not a large sky). bounce
  from the sunlit ground. a reflection from the map at a roughness-scaled LOD.
- the haze is the sky's own horizon colour in that direction, with a sun glow,
  denser low than high.
- surfaces sample every Δ map triplanar with explicit gradients (the hit/miss
  test is a branch, and implicit derivatives inside it are undefined at exactly
  the silhouettes). the displacement map does two jobs: crevices hold dirt and
  shadow, and on rock it decides where the second material shows through.
- water (the spillway basin, the cooling ponds) is a dark rippled mirror of its
  own sky: two octaves of ripple and a wind-gust pattern that roughens and
  lightens it in patches, the fine octaves faded by the pixel's footprint so
  the far basin is a calm mirror.

### surface detail (`glsl/detail.ts`)

the field and its march are untouched by detail: everything below is analytic,
evaluated once per pixel at the hit, in the stretch's own coordinates (so it
does not slide at a switch), and every pattern finer than a few pixels fades to
its own average by the pixel's world footprint.

- **concrete** (dams, piers, the cooling shells, the concrete walls): board-formed
  lifts — 1.5 units, 1.0 on the cooling shells — with staggered panel joints at
  2.4 and tie holes at 0.6, the boards printed faintly in each lift, run-off
  streaks, efflorescence bleeding out under each lift line, dust and dark
  puddle stains on tops; in the spillway basin and the cooling ponds, damp and
  algae below a tide line.
- **steel**: plate seams, bolt rows either side of each seam with domed heads,
  rust run from every joint and patches where the coat has gone. the weather
  bridge's members carry a dark grey coat; the conveyor's steel rusts least.
- **the flight**: a signal-yellow anti-slip nosing stripe on every tread, worn
  back to grey where feet land, a bright arris, grime against the riser behind,
  a polished worn path down the middle and dirty margins; bar grating on the
  steel flights (acts II and VI). the tread grid is recomputed exactly as
  `stair()` lays it. the balustrade gained a knee rail and a toe board; its
  top rail is worn signal yellow, its stringers dark oxide with bolts, its
  posts galvanised.
- **rock**: strata in the colour as well as the shape, desert varnish down the
  faces, thin dark bedding partings every 2.3 units; in the shear horizon,
  sparse lit faults running with the bedding, brighter with `uRupture` and
  `uFinale`, and an up-light from the rift on every underside.
- **machines**: the conveyor's and the turbines' plant takes the steel
  treatment; the cooling field's pipes are clad in aluminium lagging with a
  strap every 1.2 units.
- **cooling plumes**: each tower breathes a vapour column, a Gaussian density
  integrated across the ray in closed form at its closest approach, leaning
  downwind and widening as it climbs — six evaluations, no march — in act V's
  own coordinates wherever act V is in view, starting and stopping with the
  act's scenery like the cloud deck.

## act II, the weather bridge

act II is the index preview's scape built for real: an open suspension deck seen
down its own flight.

- **structure**: portal pylons every 22 units — legs from the pier cap to 12.6
  over the line, a portal beam at the top and a strut under the cables, a red
  beacon on each leg — on piers that go down into the cloud. main cables hang
  between the saddles as a parabola from 12.3 at a pylon to 5.2 at mid-span,
  with a hanger every 2.75 down to the deck edge (4.6 off the line). either
  side of the flight a bar-grating deck on a warren truss and floor beams;
  wind fencing is three slats, knee high, at the deck edge, so nothing closes
  the view. the members carry a dark coat so they stand against the weather.
  the whole act lies within 5.4 of the line and under 13.3 over it, and past
  that the act returns the bound itself, so rays out over the cloud cost one
  evaluation.
- **the cloud sea** (`seaHit`, `seaColor`): the marched cloud deck carried out
  to the walls as a surface — a plane `SEA_DEPTH` (7) under the flight that
  descends with it, intersected in closed form in act II's own coordinates
  wherever act II is in view, and like the scenery it stops at the walls'
  faces. billows on two scales, keyed to the sky's own horizon colour, lit
  warm toward the sun. a ray that meets it takes act II's air over its length.
- **the light**: act II's haze is 0.009 (was 0.011), and its air is lit warm
  in a broad forward scatter toward the sun and a little cold away from it.
  the photograph's sun sits low and almost dead ahead, so from anywhere in the
  act it is behind the far wall (whose top is never under 26 degrees from the
  eye); the sky still carries a veiled disc and its glow where the light comes
  from, for a view that clears the wall.
- **the rupture** (`bridgeRupture`, `saturate(uDecay * 0.45)`, nothing on the
  first traversal, gone in the residue): faults split across the deck and the
  flight every 13 units — a dark gap, a lit core, a halo, cold at first and
  hot as the decay climbs — and two faults torn through the air in direction
  space, over whatever lies more than about 18 units off, with a dark lip, a
  white core and a cold halo. they are drawn over the air rather than only in
  the sky because from inside the act the far wall fills the view.
- the preview's cooling towers on the horizon are not brought over: the walls
  hide the horizon over the whole forward view.

## traversal rupture

`uRupture` is 0, 1/3, 2/3 and 1 on the four traversals and remains the headline
number the audio graph reads. underneath it, `uDecay` is the continuous eased
traversal counter, 0..4 — `loop + smoothstep` over the closing fifth of the loop.

the rupture language is ported from liminal's decay:

- **cracks in the field** (`crackField`, liminal's `getFloorCrack`) — thinner than
  before, because under real light a vein network covering every surface reads as
  a pink grid laid over the picture;
- **field corruption**, bounded well under the step factor and enveloped by
  surface proximity;
- **material replacement** above a decay-scaled hash threshold;
- **crack emission** from cold rift blue to liminal's furnace core, mixed not
  added;
- **two-tier post interference** — band displacement and, independently, a red
  flash.

the stair also **pitches over** each traversal: the first walks a ~13° flight,
the fourth falls down something near 48°, from one `treadOf` pair.

`uFinale` is non-zero only during the fourth shear horizon and drives the broken
path, camera pitch and the terminal signal. it releases across the first units of
purgatory.

## purgatory

`uPurgatory` is one number doing two jobs: **the bleed** (`clamp01(decay / 4) *
0.73` across the four traversals — desaturation and a bounded contrast crush) and
**the terminal act** (from 2000 units it ramps to 1 over 60 units and stays).
purgatory's geometry is the six acts recurring as ghosts on an 88-unit cycle, one
material, still — `animTime()` stops the scenery clock — and quiet: the post
interference is calmed rather than raised. a residue wall stands every 260 units
like any other seam. eight seconds in, the signal starts to go (`src/packages/journey/signalLoss.ts`).

## rendering and audio

WebGL2. the scene is raymarched into a half-float target (encoded RGBA8 where
float targets are unavailable), its mip chain is rebuilt, and the post pass takes
bloom from the wider mips, applies the authored exposure (blended across each
seam by camera position, half-and-half at the midline from either side), ACES, a
light print curve, the rupture interference and the purgatory grade. the shared
CRT pass goes over the top.

the weather bridge's cloud volume is technically inspired by nimitz's
[protean clouds](https://www.shadertoy.com/view/3l23Rh) (cc by-nc-sa 3.0); the
implementation does not copy its constants, field equation, camera or palette.
retain this attribution when redistributing the journey.

the web-audio graph shares the simulation uniforms. inside a seam's tunnel
(`uSeam`) the weather drops away and the machines are muffled — the tunnel is the
one quiet place on the route, and it is where the soundscape changes over.

## index preview

`stairwellPreviewFrag` (in `shaders.ts`, imported by the registry) is act II
seen down its own flight: nosed treads with a worn path and a balustrade of
posts, knee rail and signal-yellow top rail, descending onto the weather
bridge — pylons with beacons and catenary with hangers over a cloud sea —
under a cold zenith and a low warm sun, with cooling towers breathing on the
far haze. the rupture is two broken polyline faults with spurs, white at the
core: a cold one through the sky and a hot one across the flight. GLSL ES
1.00, from `iTime` alone, everything in closed form per pixel (a six-pylon and
a three-tower loop and a few octaves of value noise) for the shared index
context.

## deterministic verification

```bash
bun test src/journeys/stairwell/kinematics.test.mjs
node tools/journey.mjs glsl stairwell --bare
node tools/journey.mjs contact stairwell --bare --at=5,20,40,56,75,95 --cols=3
node tools/journey.mjs scan stairwell --bare --from=11.50 --to=11.60 --step=0.01
node tools/journey.mjs scan stairwell --bare --from=31.98 --to=32.08 --step=0.01
```

acceptance gates:

- both programs compile; the static export builds;
- no spike at an act switch beyond the motion through the tunnel itself, at a
  10 ms step;
- the simulation passes 2000 units and keeps walking, indefinitely.
