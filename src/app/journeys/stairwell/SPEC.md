# the stairwell

## experience contract

the stairwell is a 500-unit anthology repeated four times, and then it stops
repeating. every act keeps a walkable descending stair or service path in view,
but the surrounding landscape, machinery, light, atmosphere and sound language
must be recognisably different. the fourth shear horizon is a terminal authored
fall — and the fall now *delivers* rather than ends: past 2000 units the route
enters purgatory and never leaves it.

| distance | act | visual contract |
| ---: | --- | --- |
| 0–70 | spillway threshold | mass-concrete flood control: dam wall, ogee chute, sluice bays with lift screws, baffle blocks, cold dawn |
| 70–155 | protean weather bridge | nothing but structure and weather — suspension catenary, deck truss, wind fencing, no ground |
| 155–235 | turbine canyon | stratified rock walls, three-blade rotors in housings, service gantry, cable trays |
| 235–325 | conveyor escarpment | warm quarry benches, roofed conveyor gallery on trestles, bucket wheel, transfer tower |
| 325–410 | cooling field | hyperboloid towers on raked column rings, pipe racks with expansion loops, banded chimneys, pale chemical air |
| 410–500 | shear horizon | cosmic-industrial rift: torn strata, suspended stair fragments, rings, the loop rupture |
| 2000+ | **purgatory** | the residue. the six acts recurring as monochrome ghosts, endlessly |

each act must be recognisable from silhouette alone, because the veil over the
handoff means the next one is usually visible before any of its detail is. so
each is built in three tiers: a far mass that fixes the skyline, a mid-field
structure that fixes the rhythm, and near work that fixes the scale. where two
acts would otherwise share a language — the bridge and the conveyor are both
trusses — the cadence and the section are deliberately pulled apart.

the next act begins blending at 52% progress, on a **quintic** ease
(`smootherstep`) rather than smoothstep: zero first *and* second derivative at
both ends, so neither the opening nor the closing of the blend shows a kick.
camera basis and sky palette blend continuously; an atmospheric veil conceals the
discrete sdf first-hit ownership handoff. stepped geometry uses `pathY`, while the
camera, look target and rails use the continuous `railY`. do not attach the camera
directly to the tread function.

## traversal rupture

`uRupture` is 0, 1/3, 2/3 and 1 on the four traversals and remains the headline
number the audio graph reads. underneath it, `uDecay` is the **continuous** eased
traversal counter, 0..4 — `loop + smootherstep` over the closing fifth of the
loop, the same shape liminal uses (`smoothLoop = loop + smoothstep(400, 500, z)`).
every rupture effect scales off `uDecay`, so the damage arrives as a ramp rather
than as a step at the reset.

the rupture language is ported from liminal's *decay*, because displacement alone
reads as wind rather than as damage:

- **cracks in the field**, not in the shading — `crackField` is liminal's
  `getFloorCrack`: a signed vein noise widened by decay and gated by a much lower
  frequency patch mask, subtracted from the tread distance;
- **field corruption** so surfaces seethe, bounded well under the march's step
  factor and enveloped by surface proximity (an unbounded version overshoots the
  first hit and punches holes in the world);
- **material replacement** above a decay-scaled hash threshold — a machine face
  stops being a machine face. roughly a third of them by the fourth traversal;
- **crack emission** crossfading from cold rift blue to liminal's furnace core.
  applied as a `mix`, never `+=`: the additive version blows the whole frame out;
- **two-tier post interference** — hash-gated per-band displacement *and*,
  independently, an injected red flash. one stronger mechanism only reads as more
  shake.

the stair also **pitches over** each traversal: rise grows and run shortens, so
the first traversal walks a ~13° ramp and the fourth falls down something near
48°. both come from one `treadOf` pair, which is why the camera follows.

`uFinale` is non-zero only during the fourth shear horizon and drives the broken
path, camera pitch, fall and terminal signal. it releases across the first units
of purgatory rather than cutting.

## purgatory

`uPurgatory` is one number doing two jobs, because they are the same process seen
at two points along it:

- **the bleed** — `clamp01(decay / 4) * 0.73` across the four traversals. the
  first is clean; by the fourth the world is two thirds gone. desaturation and a
  bounded contrast crush, applied last in both passes.
- **the terminal act** — from 2000 units it ramps to 1 over 60 units and stays.

purgatory's geometry is not a seventh environment. `purgatoryResidue` cycles the
six acts on an 88-unit block, pushed back and thickened, stripped to one material:
it is made of what you already walked through, which is the point. it is also
**still** — `animTime()` stops the scenery clock as the residue takes hold, and
the post interference is *calmed* rather than raised (liminal's `calm` term). fog
closes in so the residue changes out of sight. nothing falls here; the debris
field is gated off.

the route no longer terminates. `purgatoryLap` counts circuits and feeds the
label; the transport treats each circuit as another lap.

## rendering and audio

the route uses `withJourneyShell` with a custom raw-webgl two-pass renderer:

1. `fsScene` raymarches the active environment, common path, machinery, rupture
   debris and the weather volume into a resized framebuffer.
2. `fsPost` applies the display treatment and rupture-dependent image shear.

the shared CRT pass (`lib/crtPass`) then composites tube curvature and the tape
treatment over the presented frame; it is not part of this journey and needs no
cooperation from this renderer.

the weather field is an original deformed-periodic volume with density-aware
march steps, technically inspired by nimitz's
[protean clouds](https://www.shadertoy.com/view/3l23Rh). the implementation does
not copy its constants, field equation, camera or palette. the referenced work is
licensed cc by-nc-sa 3.0; retain this attribution when redistributing the journey.

the web-audio graph shares the simulation uniforms. wind dominates the weather
bridge and cooling field, machine tones dominate the turbine and conveyor acts,
impacts plus sub pressure grow with rupture and finale state — and all of it
fades out as `uPurgatory` rises, leaving one detuned sub. purgatory has nothing
in it that could be making a noise.

## deterministic verification

```bash
bun test src/app/journeys/stairwell/kinematics.test.mjs
bun tools/journey.mjs probe stairwell --from=0 --to=560 --step=20
bun tools/journey.mjs scan stairwell --from=96 --to=106 --step=0.25
bun tools/journey.mjs scan stairwell --from=430 --to=440 --step=0.25
bun tools/journey.mjs hud stairwell --from=0 --to=440 --step=110
bun tools/journey.mjs fps stairwell --at=20,75,127,235,342,430,475 --w=1280 --h=720
```

acceptance gates:

- no black or blown frames anywhere in the route probe, purgatory included;
- no discontinuity spike at a loop boundary or at the purgatory seam — the eased
  decay and the entry are both continuous in value and in first derivative;
- every hud control remains pixel-fixed (the transport bar is hidden under
  `?t=`, so `hud` cannot measure it — check it by hand);
- the simulation passes 2000 units and keeps walking, indefinitely;
- both shader programs compile in the live route and the static export builds.
