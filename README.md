<div align="center">
<img alt="GHBanner" src="./lib/Screenshot 2026-05-26 at 7.10.55.png" />
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
  JourneyCard.tsx           # poster + hover-to-live preview
  ShaderPreviewLayer.tsx    # ONE shared WebGL canvas for all card previews
lib/
  shaderQuad.ts             # reusable full-screen-quad shader runner
```

### adding a new journey

1. Create `app/journeys/<slug>/page.tsx` — a `'use client'` route that renders
   your shader (use `lib/shaderQuad.ts` for a simple full-screen fragment shader).
2. Append an entry to `JOURNEYS` in `app/journeys/registry.ts` (title, tagline,
   tags, accent, gradient, and a compact `previewShader` for the hover preview).
3. (Optional) Drop a poster image at `public/journeys/<slug>.jpg` and set
   `poster` in the registry; otherwise the card falls back to its CSS gradient.

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
