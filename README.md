<div align="center">
<img alt="GHBanner" src="./liminal.jpg" />
</div>

𖤐𖤐𖤐𖤐𖤐

# [∳void ∂t]₂ ∩ [hell]ˣ ∉ [⦰∞]

to face death for the first time at the very moment it's come knoking on your door,
how i've come to believe it would feel. this shader, a journey to simulating that horror.

__watch 3 iterations and you'll see.__

<img width="1200" height="475" alt="GHBanner" src="./lib/Screenshot 2026-05-26 at 15.24.31.png" />
<img width="1200" height="475" alt="GHBanner" src="./lib/Screenshot 2026-05-26 at 15.24.43.png" />

---

## journeys

The landing page (`/`) is an index grid of shader **journeys**. Each journey is
its own route under `app/journeys/<slug>/`.

```
app/
  page.tsx                  # index grid landing
  journeys/
    registry.ts             # journey metadata (single source of truth for the grid)
    liminal/                # THE LIMINAL JOURNEY (raymarched descent + audio)
    stairwell/              # THE STAIRWELL (impossible brutalist descent + audio)
    skybridges/             # SKYBRIDGES (collapsing glass spans over a cloud sea)
    foundry/                # THE FOUNDRY (seven halls, rigid-body physics)
    hollow-orchard/         # THE HOLLOW ORCHARD (fungal descent + audio)
    natatorium/             # THE NATATORIUM (flooded poolrooms, turning route + audio)
components/
  JourneyGrid.tsx           # grid + shared-preview host
  JourneyCard.tsx           # screenshot poster + hover-to-live preview
  ShaderPreviewLayer.tsx    # ONE shared WebGL canvas for all card previews
  withShaderJourney.tsx     # HOC template: one fragment shader -> a full route
hooks/
  use-pan-control.ts        # pointer + gyroscope view panning (tweened)
  use-journey-runtime.ts    # settings ref, display filter, resize, FPS, fullscreen
  use-audio-engine.ts       # lazy per-journey audio + mute button state
lib/
  shaderQuad.ts             # reusable full-screen-quad shader runner
  frameLoopManager.ts       # ONE frame-capped rAF shared by every templated journey
  panControl.ts             # framework-free pan controller behind use-pan-control
tools/
  shoot-posters.mjs         # re-capture public/journeys/<slug>.jpg from the live routes
```

### looking around

Every journey steers its camera from one normalized `uPointer` (-1..1, y up),
fed by `lib/panControl.ts`:

* **pointer / touch** — absolute position over the viewport.
* **gyroscope** — device orientation is summed on top wherever the device
  reports it, so a phone pans by tilting as well as dragging. Tilt is measured
  against the pose you were holding when the readings started (and re-zeroed on
  rotation or when the tab comes back), and mapped through the screen
  orientation so "right" is right in landscape too. iOS only hands out
  orientation after a permission prompt. Gyroscope look can be enabled or
  disabled in **GRAPHICS & CONTROLS**; enabling it requests permission directly,
  while the default-on first visit still requests once on the first page tap.
* **tweening** — small moves follow the pointer immediately; a *jump* (a tap
  landing far from the last touch, a finger lifted and re-planted) is eased over
  a distance-scaled 0.16–0.5 s instead of teleporting the camera.

### routes that turn

Most journeys are a straight `+Z` scroll with the scenery changing around them.
Two are not, and they solve it differently:

* **stairwell** re-anchors. Its `map()` evaluates only the current section plus
  its two neighbours, each rotated into the camera's frame, so turn #500 costs
  exactly what turn #1 did and no coordinate ever drifts far from the origin.
  The turn table lives in GLSL.
* **natatorium** takes that idea and moves the table to the CPU. `kinematics.ts`
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
  * **Shading resolves the owning slot**, which is the rule above applied to the
    GPU. `mapAir`'s union tells the march how far the concrete is and then throws
    away *whose* concrete it is, so every shading term downstream used to assume
    the answer was the camera's own section — and a room seen through a doorway
    was lit with the wrong width, ceiling height and lamp pitch, in a frame that
    rotated out from under it the moment the slot window advanced. `resolveSlot`
    re-runs the loop once at the hit point (one evaluation, against ninety-six)
    and returns the point, the normal and the view ray in the winner's own
    coordinates. A point's coordinates in a section's own frame do not change
    when the camera crosses a join, and that invariance is the whole fix.
  * **Nothing added to the SDF may enter the walked tube.** Fittings and join
    dressing are intersected with the complement of a cylinder swept along the
    walked line. It cannot fail to clear the camera, because it is defined by
    where the camera goes. (hollow-orchard bores the same aisle with a capsule.)
  * **Animated offsets are functions of a uniform, never of position.** The
    blocks that reconfigure each doorway ride a single CPU-computed deploy
    scalar. An offset that varied with `p` would add its own derivative to the
    gradient, and in a *negated* field over-estimating is not an artifact — it is
    a grazing ray leaving the building. This is why the step factor here is still
    0.95 where foundry, which morphs geometry across its boundaries, has to cut
    to 0.78. Corollary: the deploy curve is quintic rather than the obvious
    damped hinge, because a hinge rings above 1 and settles back through it, and
    the shader culls the whole block set on `deploy >= 1`.

### adding a new journey

1. Create `app/journeys/<slug>/page.tsx` — a `'use client'` route that hands one
   fragment shader to `withShaderJourney`. That HOC owns *all* the WebGL
   boilerplate (context, resize, pointer, FPS, fullscreen, settings, frame loop),
   so the route itself is about ten lines. Options:

   * `accent` — the `--accent` CSS var for the route
   * `getSectionName(time)` — HUD label, when pacing is a pure function of time
   * `createSimulation()` — a CPU simulation instead, when it isn't: it is stepped
     once per capped frame, its `uniforms()` go straight to the shader and its
     `label()` drives the HUD. Use this whenever speed varies by section, because
     then position is an *integral* and has no closed form.
   * `createAudioEngine()` — a Web Audio engine (see `hooks/use-audio-engine.ts`).
     Passing it is what renders the mute button; its optional `update(time, state)`
     is fed the same uniforms the shader is drawn with, so sound and geometry stay
     on one clock.
   * `sectionTitleClassName`, `envMapUrl`

   `liminal/` and `stairwell/` predate the HOC and still hand-roll their own
   two-pass routes — don't copy them for new work; `foundry/`, `skybridges/` and
   `hollow-orchard/` are the current reference.
2. Append an entry to `JOURNEYS` in `app/journeys/registry.ts` (title, tagline,
   tags, accent, gradient, and a compact `previewShader` for the hover preview).
   Export the preview shader from your own `shader.ts` and import it here. Keep it
   cheap and **self-driving from `iTime` alone** — the grid attaches no simulation,
   so a preview that reads `uStage`/`uCam` renders a black card.
3. Add a poster screenshot at `public/journeys/<slug>.jpg` and set `poster` in
   the registry — `node tools/shoot-posters.mjs` captures one from the running
   route. The card's art falls back screenshot-first: live preview on hover,
   the screenshot wherever WebGL or hover isn't available (phones, mostly), the
   CSS gradient only if the image itself fails to load.

The landing grid picks it up automatically from the registry.

> **Note:** the card hover previews all share a **single** WebGL context
> (`ShaderPreviewLayer`) so the page never trips the browser's per-document
> context limit, no matter how many journeys are listed.

### develop

```bash
bun install
bun run dev      # http://localhost:3000
bun run build
```
