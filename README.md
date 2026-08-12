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
