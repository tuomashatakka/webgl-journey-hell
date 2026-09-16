# THE SCENIC ROUTE

Seven miles of the prettiest road in the county, driven from behind the wheel.
It goes off the cliff at the end, something down there has its mouth open, and
the road comes out the other side of it. Three laps, and then the picture goes.

This is the second rasterized journey in the repo (after `loop-line`), built on
`components/withGeometryJourney`: a WebGL2 context with a depth buffer, real
triangles, GLSL ES 3.00, MSAA + a post chain. It is **not** three.js — the repo
has zero 3D dependencies and `lib/curve`, `lib/mesh`, `lib/mat4`, `lib/glProgram`
already cover everything a swept-road, instanced-city, lathe-monster scene needs.
The `threejs-scenes` skill's patterns (on-rails path camera, path tubes, triplanar
materials, instancing, bloom → grade → tonemap post chain, per-quality-tier
gating) are applied on raw WebGL2 without the library.

## Experience contract

A closed 3.1 km circuit, one Catmull-Rom spline (`lib/curve`, `createClosedCurve`)
through seven sections. The lap closes in space, in tangent (spline), in bank
(authored C¹ table) and in every material and lighting parameter (all blended
along arc length). The car is bolted to the spline like a coaster car to its
rail; the *world* is what makes it read as a road, a city, a sea and a stomach.

| # | section | len | y (start→end) | contract |
| --- | --- | ---: | --- | --- |
| I | THE COUNTY ROAD | 505 | −55 → −55 | valley floor at golden hour: fields, hedgerows, fence posts, telegraph poles, wind turbines on the ridge, a barn. Rolling crests with airtime. The tunnel portal behind you. |
| II | THE INCLINE | 480 | −55 → +120 | the lift hill. A steady 26° climb (r 230 arc) through a rock cutting, then retaining walls, then the first facades. Engine labouring, gearbox hunting, the city rising over the crest. |
| III | DOWNTOWN | 545 | +120 → +80 | the drop. A spiral ramp (r = 45 m, 1.25 turns) descending between towers whose upper floors **bend and twist along the progression** — leaning into the turn, corkscrewing with height. Lap 1 the helix banks 40°; by lap 3 the road rolls the full 360°. |
| IV | THE COAST ROAD | 370 | +80 → +100 | out of the city onto the cliff-top. Guardrail, sea below, sun on the water, speed building. The guardrail is already bent open at the end. |
| V | THE FALL | 145 | +100 → +25 | the asphalt ends in a broken edge. Ballistic arc off the lip at 30 m/s, 3.9 s of free fall, nose pitching down to 45°, the sea rushing up, and **the maw**: a breaching fish the size of a ferry, jaw open toward you. The camera goes straight down its throat. |
| VI | THE GULLET | 285 | +25 → −40 | ribbed flesh, peristalsis moving *toward* you, wet specular, red subsurface, headlights the only light. A pull-out from the dive, then a 180° turn back under the headland. Flesh turns to rock along the way — in patches, never a line. |
| VII | THE UNDERTOW | 775 | −40 → −55 | a rock cave with a river in it. The car floats: heave, roll, a slow yaw drift on the eddies, stalactites, bioluminescent algae at the water line, a waterfall. Daylight ahead; the passage becomes a concrete culvert; the wheels touch; you roll out onto the county road. |

Lengths are what the built spline reports (`course.ts`), lap 3 103 m; the
first lap takes about 215 s.

The only climb on the lap is the lift hill. Water flows downhill everywhere it is
seen, which is why the valley floor sits below the cave and the cave sits below
the sea: the elevation table is a coaster's, not a map's.

### Three laps, then the signal

Everything that gets worse is a function of one scalar, `lapF` — the lap count
plus a smooth ramp across **THE UNDERTOW**, the section with no sky and the least
on screen to slide (loop-line's rule, same reasoning). Per lap:

| what | lap 1 | lap 2 | lap 3 | rule |
| --- | --- | --- | --- | --- |
| sun elevation | 12° golden hour | 3° sunset | −6° civil dusk, city lights | monotonic in lapF, slid inside the cave |
| building bend gain | 1.0 | 1.8 | 2.6 | affine in lapF |
| helix roll amplitude | 40° | 180° | 360° | `bank(s) · (1 + lapF · k)` — gain only, so continuity and ordering survive |
| the maw's jaw | 70 m wide | 85 m | 100 m | jaw angle affine in lapF; the throat radius follows |
| undertow water level | axle | sill | window line | `+0.45 m / lap` |
| road surface | clean | cracked | potholed, missing guardrail panels | fragment-level from `lapF`; guardrail cull by `hash(seed) < lapF · k` |
| speeds | authored | +8 % | +16 % | target speeds ·(1 + 0.08 lapF), drag ·(1 − 0.2 lapF) |
| dashboard | — | CHECK ENGINE | + OIL, TEMP in the red | warning lamps, pure function of lapF |
| radio | a station | static creeping in | mostly static | audio only |

`SIGNAL_LOSS_LAP = 3`: once the lap counter reaches three, `signalAge` accrues
inside `step()` and `lib/signalLoss` does the rest — the fourth lap starts on the
county road at night and the picture fails there, eight seconds in. The
simulation reports it through `JourneyMarks.signalAge`, never through a clock in
the shell, because `?t=` replays from zero (see `lib/signalLoss`'s header).

## The road, the ride

### One spline, seven spans

`course.ts` authors absolute 3D control points grouped by section. As in
`loop-line/stations.ts`, the spline is built once to *learn* each section
boundary's arc-length fraction and once for real, so `SPANS[i] = { s0, s1 }` is
exact. The lap length is whatever the spline says (~3100 m), never a constant.

### Bank

Parallel transport gives a twist-free frame; a road also has camber and a coaster
has bank, so `bankAt(s, lapF)` is authored as a table of `(s, angle)` knots
interpolated with a C¹ Catmull-Rom over arc length, applied as a roll about the
tangent to the frame *and* to the swept road profile. The camera and the asphalt
therefore agree by construction.

The per-lap amplification is `bank · (1 + min(lapF, 2.25) · BANK_GAIN)`: gain and
no bias. This is the switchback lesson — an affine map in angle space cannot jump,
cannot reorder two authored bank values, and keeps two sections that agreed on a
bank agreeing. **Piecewise-by-sign is the smell**; there is none of it here. The
cap keeps the worst bank rate inside one order of magnitude of the authored lap
(the gate below) once the picture is already going.

Knots marked `auto` take their sign from the built curve's curvature, averaged
over ±12 m. Turn direction is a property of the geometry; typing it by hand is a
class of error the table does not need to have.

The whole table is one `Float32Array` at 0.5 m, read by the camera on the CPU
and by every vertex shader through an R32F texture with a manual `mix` between
`texelFetch`es — so the asphalt and the eye roll by the same number to the bit,
and the corkscrew deepens per lap for the price of one uniform.

### Speed

The car is an integrator, which is why `?t=` has to seek it. Per section, six
parameters, every one of them blended across a 30 m window at each boundary so
they are continuous functions of `s`:

```
a = throttle · (vTarget − v) / tau      the driver
  − gW · g · sin(grade)                 gravity along the tangent, weight 0..1
  − cD · v²                             air / slime / water
v = clamp(v, vMin, vMax)
```

| section | vTarget | tau | throttle | gW | cD | note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| I county road | 22 | 2.5 | 1 | 0.15 | 0.0020 | 80 km/h, the crests give it airtime |
| II incline | 15 | 3.0 | 1 | 0.20 | 0.0020 | gravity and throttle meet at ~12.4 m/s — labouring in second |
| III downtown | 32 | 3.0 | 0.3 | 1.00 | 0.0012 | gravity owns the drop; ~115 km/h |
| IV coast road | 28 | 2.5 | 1 | 0.30 | 0.0016 | 100 km/h, building to the edge |
| V the fall | 28 | — | 0 | 1.00 | 0.0004 | free fall; ~50 m/s at the mouth. vTarget equals the coast's so the blend cannot brake at the lip |
| VI gullet | 14 | 1.2 | 1 | 0.30 | 0.0090 | the throat takes the speed off |
| VII undertow | 13 | 3.0 | 1 | 0.00 | 0.0060 | the current, with a surge on top |

The fall is the honest part: no throttle, no cap, gravity and thin air. The mouth
is placed where a ballistic arc from the cliff lip at 30 m/s lands — 115 m out,
75 m down — and the throat axis continues the arc's tangent, so entering it is
not an event in the integrator at all. The deceleration is the gullet's `cD`.

The equilibrium speeds matter more than the targets. On the incline the throttle
term `(15 − v) / 3` meets gravity's `0.2 · g · sin 26°` at about 12.4 m/s; the
first version had the target at 12 with a heavier gravity weight and crawled up
the hill at 6, which added forty seconds to the lap without anyone authoring
them.

### Pose

From the frame: `pos + up · CAM_H + right · sway`, with

* **head roll** = `HEAD_ROLL · bank` eased at 0.28 s — a rider's head does not
  follow the car exactly, and a shot in which it does looks like a flight sim;
* **sway** — a damped spring driven by the lateral acceleration the bank is not
  cancelling (`v²κ − g sin bank`), loop-line's understeer you feel not see;
* **heave** — a spring driven by vertical acceleration: airtime lifts the head
  off the seat and the dashboard drops a few centimetres in frame;
* **suspension** — hashed on distance travelled (fixed bumps in fixed places),
  amplitude by surface and by `lapF`;
* **float** (VII only) — heave from the water strip's wave function at the car's
  `s`, roll from its slope, and a yaw drift `±25°` on a slow seeded eddy, so the
  camera looks along the cave rather than always down it. Blended in over the
  last 20 m of VI and out over the culvert.

The cockpit is drawn in the *car's* frame, not the camera's: head roll, sway and
heave move the view against the dashboard. That relative motion is most of what
makes a dash-mounted POV read as a person driving.

### Gearbox

Six ratios, shift up at 6200 rpm, down at 2300, a 180 ms clutch dip. RPM is the
tachometer needle and the engine pitch. In the fall the wheels spin free and the
needle pins; in the water the engine stalls; it restarts on the culvert ramp.
All pure functions of `v` and `s`, so a seek reproduces the needle.

## The world

### Materials and light — what "hyper realistic" costs here

Realism in this repo's terms is *consistency*, not texture resolution: the fog
is the sky, the reflection is the sky, every surface is lit by the same sun with
the same BRDF, and the shadows are real. Concretely:

* **BRDF** — Cook-Torrance with GGX distribution, Smith-Schlick geometry and
  Schlick Fresnel, per learnopengl's [theory](https://learnopengl.com/PBR/Theory)
  and [lighting](https://learnopengl.com/PBR/Lighting) chapters. Metallic /
  roughness are procedural per material. Ambient is the sky function sampled at
  the normal, not a constant.
* **Sky and aerial perspective** — single-scattering Rayleigh + Mie, the
  Nishita model as in [GPU Gems 2 ch. 16](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering),
  Alan Zucconi's [series](https://www.alanzucconi.com/2017/10/10/atmospheric-scattering-7/)
  and [gboisse/glsl-atmosphere](https://github.com/gboisse/glsl-atmosphere) as
  compact references. One GLSL chunk `atmosphere(ro, rd, sun)` is used three
  ways: the sky dome, the in-scatter term of every surface (fog *is* sky), and the
  reflected direction on water and glass. `heavy = 0` drops to 4 view samples ×
  2 light samples. Clouds are a 2D fbm layer at 1800 m lit by the sun's phase.
* **Sun shadow** — one 2048² depth texture (1024² when `heavy = 0`), an
  orthographic frustum fitted to ~220 m ahead of the camera, hardware compare
  through `sampler2DShadow` with a 3×3 PCF, per learnopengl's
  [shadow mapping](https://learnopengl.com/Advanced-Lighting/Shadows/Shadow-Mapping)
  and the [CSM guest article](https://learnopengl.com/Guest-Articles/2021/CSM)
  (one cascade is enough at these view distances; MJP's
  [survey](https://therealmjp.github.io/posts/shadow-maps/) for the biases). The
  shadow pass is skipped entirely while the camera's section has `sky = 0`.
* **Surfaces** — procedural, triplanar where there is no natural UV (iq's
  [box mapping](https://www.shadertoy.com/view/MtsGWH)), fbm and domain warping
  per iq's [fbm](https://iquilezles.org/articles/fbm/) and
  [warp](https://iquilezles.org/articles/warp/) articles. Asphalt: aggregate
  speckle, tyre-polished lanes, wet patches, lane paint from arc-length UV.
  Grass / soil / rock by slope and height. Concrete with formwork stripes.
  Facades: window grid with per-cell lit state from a hash, curtain-wall glass
  reflecting the sky. Flesh: warped fbm veins, wrap-lit red subsurface. Fish
  skin: cellular scales, high specular, wet. Detail fades to its *mean* with
  distance, never to zero (natatorium's moiré lesson).
* **Sea** — a radial grid centred on the fall point, six Gerstner waves in the
  vertex shader after Finch's
  [GPU Gems ch. 1](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models),
  analytic normals, fbm ripple detail in the fragment, Schlick Fresnel against the
  sky function, sun glitter, depth-tinted body, foam on crests and in a ring
  around the maw.
* **Headlights** — two spot lights in the car frame with a procedural cookie.
  Irrelevant in daylight, the whole picture in VI–VII. With `heavy = 1` the
  gullet and cave add an 8-step in-scatter along the view ray inside the tube.
* **Post** — MSAA resolve → half-res bright → 2× separable blur → composite:
  bloom, authored per-section exposure (blended along `s`; the gullet is +1.3 EV
  over daylight), ACES fit after
  [Narkowicz](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/),
  a speed-driven radial blur that only bites in the fall, a light vignette. The
  shared `lib/crtPass` then adds curvature, aberration and the signal loss on top
  without knowing any of this exists.

The sun is drawn as a small emissive disc *in the geometry pass*, depth-tested,
and bloom does the flare — which is how a flare gets occluded by a tower for free.

### The surface owns its `s`

loop-line's most repeated bug is shading a surface with the camera's section
parameters. Here every vertex knows its own arc length: the swept meshes carry
`s` in `uv.y`, and every instance carries the `s` of its anchor. The fragment
shader indexes a 7-entry `uSec[]` table by `s` and blends across the boundary
windows, so a facade seen from the incline is lit as downtown and a rock face
seen from the gullet is fogged as cave. The camera's `s` is consulted for exactly
two things: the clear colour, and which draws to issue.

### Downtown bends

Each tower is one instance of one of eight unit meshes. The instance carries its
anchor `s`, the road frame's `right`/`up` there, the curvature `κ(s)` and a seed.
In the vertex shader, for a vertex `h` metres up:

```
lean  = κ · h² · K_LEAN · gain                      into the turn
twist = rotateY(h · K_TWIST · gain · sin(s · ω + seed))  about its own axis
shear = right · bank(s) · h · K_FOLLOW · gain         the tops follow the camber
gain  = 1 + lapF · BEND_LAP
```

Nothing is re-uploaded; the city bends for the price of a uniform, the same
argument loop-line makes for its rupture. Windows stay on the facade because the
same transform is applied to the normal.

### The maw

A lathe body (revolution profile, 140 m long, mostly underwater) with two jaw
half-shells hinged at the corner of the mouth, teeth as ~90 instanced cones on
each lip, two emissive eyes, gill slits as dark recesses. Jaw angle is
`JAW_0 + lapF · JAW_LAP` plus a slow breathing term on `time`. The body breaches
at 50° so the open mouth faces the falling car; the throat interior is the first
30 m of the gullet tube, open to the sky behind you as you enter, so the sky
recedes rather than cuts — no event, just a tube closing.

### The gullet and the cave

One swept tube, inward-facing, radius `r(s)` from 14 m at the lips to 6 m in the
throat to a 25 m cavern, built once. The vertex shader adds ribs (`sin` along `s`),
peristalsis (a travelling wave toward the camera on `time`), and fbm lumps, all
scaled by a flesh weight `w(s)` that goes 1 → 0 through VI with a noisy threshold
(`smoothstep(t − 0.25, t + 0.25, fbm(p) )`) so rock arrives as islands in flesh
and then flesh becomes islands in rock. The same `w` selects material, the wet
specular level, and the emissive mucus / algae.

The river is a second swept strip below the tube axis with a Gerstner-lite
surface, flow lines advected along `s`, and its own reflection of the headlights.
Stalactites, boulders and the waterfall are instanced props placed by the seeded
rng in the cave's own `s` range.

### The terrain

Two heightfield rings around the whole circuit (4 m cells to 120 m, 16 m cells
to 900 m), built once from fbm, with the road corridor pulled to the road: a
build-time spatial hash of curve samples at 2 m gives nearest-`s` in O(1), and
`h = mix(fbm, roadY(s*) − shoulder, smoothstep(24, 6, d))`. The cutting through
THE INCLINE and the tunnel portal at the seam are the same rule with the sign
flipped (terrain forced *above* the tube). Fields, hedgerows, fence posts,
telegraph poles, hay bales, a barn, wind turbines (rotating in the VS), and
mid-distance trees as crossed alpha-tested quads with fbm canopies.

### The cockpit

Drawn last in the car frame with its own near/far (0.05–6 m) and a cleared depth
buffer: dashboard, binnacle, steering wheel (turns with yaw rate), A-pillars,
roof line, rear-view mirror (the sky function in the backward direction — cheap
and convincing), the bonnet (Fresnel reflection of the sky, the single strongest
"this is a real car" cue), wipers at rest. Dial faces are one Canvas2D texture
drawn at boot; needles are geometry rotated by uniform; warning lamps are
emissive quads gated by `lapF`. No hands: a POV with hands that are not quite
right reads worse than a dashcam, and there is no budget for right.

## What a frame costs

Built once at construction: the road, the terrain rings, the tube, the sea grid,
eight tower units, ~14 prop units, the maw, the cockpit. A frame is then:

* shadow pass over the resident sections (skipped in VI–VII);
* sky (one fullscreen triangle at far depth);
* per resident section (at most three, sphere-culled): road strip, terrain
  chunks in range, one instanced draw per prop family present;
* sea, maw, tube segments in range;
* cockpit;
* resolve, bright, blur ×2, composite.

Around 70–110 draw calls, nothing uploaded per frame but uniforms. Target: 60 fps
at 1400×860 on the dev machine with `heavy = 1`; `heavy = 0` halves the shadow
map, drops the atmosphere samples and the in-scatter, and skips the cloud layer.

## Determinism

Every placement goes through `lib/rng`'s `mulberry32` with a section-salted seed.
Nothing reads a clock or `Math.random`. Every animated quantity is a function of
`s`, `lapF`, or the journey `time` the shell hands over. Two shots of the same
`?t=` are byte-identical, dial needles and eddies included.

## Files

```
course.ts            sections, control points, bank knots, speed table, exposure/palette per section; buildRoute(), spanAt()
kinematics.ts        JourneySimulation — integrator, lapF, gearbox, pose, float; uniforms(), label(), marks(); SIGNAL_LOSS_LAP
geometry.ts          road sweep, terrain rings, tower + prop units, the maw, tube + river, sea grid, cockpit, dial texture
scene.ts             JourneyRenderer — programs, targets (msaa, scene, bloom, shadow), the frame order above
shader.ts            GLSL ES 3.00 chunks (noise, brdf, atmosphere, fog, shadow), world/sea/sky/cockpit/shadow/post programs; the ES 1.00 hover preview
audio.ts             engine, tyres, wind, radio, the fall, the gullet, the cave — driven by the frame's uniforms
kinematics.test.mjs  the derivative sweeps and invariants below
```

Generalised from loop-line into `lib/` rather than copied: `lib/sweep.ts`
(`sweepProfile` with a per-`s` profile function, `s` written to `uv.y`, and a
`lathe`) and `lib/shadowMap.ts` (depth target + fitted ortho). loop-line keeps
importing its own copy; it is not touched, and the probe-diff on it stays
byte-identical.

## Implementation plan

Each phase ends with `bunx tsc --noEmit`, `bun run lint`, and a `probe`. Commit at
the end of every phase — an external sync process mutates this tree.

0. **Skeleton** — folder, `SPEC.md`, registry entry + hover preview, `page.tsx`,
   `.scenic-route-sector-title`, route + kinematics stubs on a flat spline. The
   route renders a sky and a grey ribbon.
1. **The ride** — `course.ts` table, `kinematics.ts`, `kinematics.test.mjs`. Tune
   the motion against a wireframe road with `?debug=1` before any world exists.
2. **Ground and air** — road sweep + materials, terrain rings + props, atmosphere,
   sun shadow, post chain. Sections I, II, IV look like a place.
3. **Downtown** — tower units, bending VS, facades, the helix, lap gain.
4. **The sea and the maw** — sea grid, the fish, the broken edge, the fall's
   radial blur, the entry.
5. **Inside** — tube + flesh→rock, river strip, headlights + in-scatter, float
   dynamics, the culvert and the seam.
6. **Cockpit** — meshes, dials, gearbox, warning lamps.
7. **Hell** — every `lapF` rule in the table, `SIGNAL_LOSS_LAP`, audio.
8. **Ship** — verification suite below, poster (`tools/shoot-posters.mjs`),
   README + registry docs.

## Deterministic verification

```bash
bun test src/app/journeys/scenic-route/kinematics.test.mjs
bun tools/verify-geometry.ts                      # extended for lib/sweep
bun tools/journey.mjs probe scenic-route --from=0 --to=620 --step=10
bun tools/journey.mjs scan  scenic-route --from=118 --to=132 --step=0.25   # the fall
bun tools/journey.mjs shot  scenic-route --t=12 --w=1400 --h=860 --out=/tmp/county.png
bun tools/journey.mjs fps   scenic-route --at=12,70,125,170 --w=1200 --h=760
bun tools/journey.mjs hud   scenic-route --from=0 --to=400 --step=40
```

Acceptance gates — the ones an image cannot check come first, because those are
the ones this repo has been bitten by:

* **the spline passes through its control points** (max error < 1e-6 m) and
  dense step lengths have no outlier (`verify-geometry`'s two checks);
* **bank is smooth on every lap.** Sweep `bankAt(s, lapF)` at 2 cm for
  `lapF ∈ {0, 1, 2, 3}`; the worst `|Δbank|/Δs` stays within an order of
  magnitude of lap 0's own rate. Same sweep for the six speed parameters and the
  exposure table as functions of `s`: no jump anywhere, boundaries included;
* **grade is continuous** — `|Δgrade|/Δs` from the curve tangent at 2 cm has no
  outlier, and the fall's entry tangent matches the throat axis to within 2°;
* **the fall lands in the mouth**: the spline point at the end of V lies inside
  the jaw aperture at lap 0 and lap 3 both;
* **lateral load** `v²κ` at the target speeds is ≤ 2.2 g everywhere but the
  helix, and ≤ 3.5 g there;
* **speed is strictly increasing through the fall** with no asymptote, and
  converges to within 5 % of the current in the undertow before the culvert;
* **lap 0 takes 160–230 s**; every lap after is shorter;
* **determinism**: two simulations fed the same fixed `dt` agree on every uniform
  at `t = 400` to the bit; `signalAge` is 0 until the lap counter reads 3 and
  increases every step after;
* **per-lap monotonicity**: bend gain, bank gain, jaw angle, water level and speed
  scale strictly increase with `lapF`; sun elevation strictly decreases;
* **no black or blown frames** in the probe, the gullet included — its exposure
  is authored so the headlit tube keeps a mean luminance above 12;
* **scan spikes only at authored events** — the impact at the mouth and the
  culvert's daylight — and never at a section boundary;
* **loop-line's probe is byte-identical** before and after the `lib/` additions.
