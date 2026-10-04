# Adding a journey

A journey is **declared once**, in `src/journeys/<slug>/journey.ts`, and
everything that runs journeys reads that declaration: the page, the bare harness,
the tools. `src/components/withJourneyShell` (a view over `src/hooks/use-journey-runtime`)
owns all the route machinery — context, resize, adaptive resolution, pointer,
settings, the frame loop, `?t=` seeking, loading bar, HUD, transport and pause,
title card, section headings, fullscreen, debug panel.

```ts
// src/journeys/<slug>/journey.ts
export default defineJourney({
  slug:             '<slug>',
  renderer:         shaderRenderer(frag),          // or geometryRenderer / passRenderer
  createSimulation: createMySimulation,             // optional
  createAudio:      createMyAudio,                  // optional: renders the mute button
})

// src/app/journeys/<slug>/page.tsx
'use client'
import { withJourneyShell } from '✦/components/withJourneyShell'
import journey from '✦/journeys/<slug>/journey'
export default withJourneyShell(journey)
```

Pick the renderer by what the journey is (`src/packages/journey/definition.ts`):

* **`shaderRenderer(frag, { envMapUrl })`** — one GLSL ES 1.00 fragment shader on a
  full-screen quad, WebGL 1, no depth buffer. Six of the journeys are this.
* **`geometryRenderer(createScene)`** — triangles: WebGL 2 with `depth: true`; hand
  back your own scene object. Reach for `src/packages/math/mat4.ts`, `src/packages/geometry/curve.ts`, `src/packages/geometry/meshBuilder.ts` and `src/packages/gl/mesh.ts`, and
  `src/packages/gl`'s `createPostChain` for the MSAA → resolve → bloom frame. `loop-line` is
  the worked example. (A rasterizer without a depth buffer draws its rooms in
  submission order and you see straight through the walls.)
* **`passRenderer(create)`** / **`passRendererWebGL1(create)`** — a hand-built
  multi-pass renderer (raymarch into a target, then post): `stairwell/` on WebGL 2,
  `liminal/` on WebGL 1.

The rest of the definition:

* `createSimulation()` — a CPU simulation, stepped once per frame on the
  speed-scaled delta; its `uniforms()` go straight to the renderer and its
  `label()` drives the HUD. Use it whenever speed varies by section, because then
  position is an *integral* and has no closed form.
* `marks()` on the simulation — or `marksAt(time)` in the definition, for a
  journey with no simulation (`sectionNameAt(time)` for its label). Which lap,
  which section, how far through: the transport navigates by *structure*.
* `createAudio()` — a soundtrack: extend `JourneyAudio` (`src/packages/audio`), build the
  graph in `build()`, and modulate it from the frame's uniforms in `update()`.
* Shared GLSL comes from `src/packages/glsl` (`${HASH21}`, `${valueNoise2('hash21')}`,
  `${SD_BOX}`, `${ACES}`…); shared scalar maths from `src/packages/math`; HUD labels from
  `lapLabel`.

Then register it:

1. Add it to `src/journeys/definitions.ts`.
2. Append an entry to `JOURNEYS` in `src/journeys/registry.ts` (title, tagline,
   tags, accent, gradient, and a compact `previewShader` for the hover preview).
   Export the preview shader from your own `shader.ts` and import it here. Keep it
   cheap and **self-driving from `iTime` alone** — the grid attaches no simulation,
   so a preview that reads `uStage`/`uCam` renders a black card.

   A preview is **always GLSL ES 1.00**, even for a geometry journey whose own
   renderer is WebGL2: every card's preview shares one WebGL 1.0 context, so the
   preview cannot be the journey's real renderer and has to fake the shot.
3. Add a poster screenshot at `assets/posters/<slug>.jpg`, import it statically
   in the registry and wrap it in `staticUrl(...)` (posters are bundled assets,
   there is no `public/` directory) — `node tools/shoot-posters.mjs` captures
   one from the running route. The card's art falls back screenshot-first: live preview on hover,
   the screenshot wherever WebGL or hover isn't available (phones, mostly), the
   CSS gradient only if the image itself fails to load.

The landing grid picks it up automatically from the registry; the journey's title
card takes its title, tagline and accent from the same entry.

> **Note:** the card hover previews all share a **single** WebGL context
> (`ShaderPreviewLayer`) so the page never trips the browser's per-document
> context limit, no matter how many journeys are listed.

## Develop

```bash
bun install
bun run dev      # http://localhost:3000/webgl-journey-hell
bun run build
```
