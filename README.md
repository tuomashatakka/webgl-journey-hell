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
    signal-bloom/           # SIGNAL BLOOM (iridescent plasma)
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
  orientation after a permission prompt, which is requested once, on your first
  tap on the page.
* **tweening** — small moves follow the pointer immediately; a *jump* (a tap
  landing far from the last touch, a finger lifted and re-planted) is eased over
  a distance-scaled 0.16–0.5 s instead of teleporting the camera.

### adding a new journey

1. Create `app/journeys/<slug>/page.tsx` — a `'use client'` route that renders
   your shader (use `lib/shaderQuad.ts` for a simple full-screen fragment shader).
2. Append an entry to `JOURNEYS` in `app/journeys/registry.ts` (title, tagline,
   tags, accent, gradient, and a compact `previewShader` for the hover preview).
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
