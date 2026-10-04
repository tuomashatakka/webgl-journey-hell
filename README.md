# webgl-journey-hell

An index of WebGL shader **journeys**: nine raymarched or rasterized descents, each a route you ride through rooms that should not connect, with a CPU simulation under it, a synthesised soundtrack, a tape-deck transport, and a signal that eventually fails. No three.js, no 3D dependencies: every pixel is a hand-written GLSL program.

Next.js (App Router, static export), React 19, TypeScript, bun workspaces.

## Run it

```bash
bun install
bun run dev                 # http://localhost:3000/webgl-journey-hell
bun run build               # static pages, nothing server side
bun run check               # tsc, eslint, knip, bun test: the gate for every commit
```

## The journeys

| slug | what it is |
| --- | --- |
| `liminal` | raymarched descent through shifting poolrooms |
| `stairwell` | six acts joined through walls, lit by the asset library |
| `skybridges` | collapsing glass spans over a cloud sea |
| `foundry` | seven halls, rigid-body physics, a terminal fall |
| `hollow-orchard` | a fungal descent |
| `natatorium` | flooded poolrooms along a turning route |
| `switchback` | a mine railway that tips over, then falls |
| `loop-line` | a rasterized closed circuit, nine bays, lit by the asset library |
| `scenic-route` | a rasterized coaster road with a cockpit and a mouth at the end |

`/` is the index grid, `/assets` is the Δ asset library, `/journeys/<slug>` is a journey.

## Where things are

```
src/app/         Next routes, layout, icons, CSS (styles/)
src/components/  React views
src/hooks/       React hooks: every useState and useEffect lives here or in a provider
src/journeys/    framework-free journey content, one folder per journey + registry
src/packages/    bun workspaces, framework-free, never import react or next
assets/          posters, screenshots, textures: every image in the repo
docs/            architecture, design system, tooling, runtime, per-journey specs
tools/           CLI: journey.mjs, shoot-posters.mjs, verify-geometry.ts, harness/
```

## Read next

* `docs/architecture.md`: layers, packages, the one data flow.
* `docs/design-system.md`: the rules code and CSS are written to, and how they are enforced.
* `docs/tooling.md`: driving a journey from a shell, probing, the bare harness.
* `docs/adding-a-journey.md`, `docs/runtime.md`, `docs/routes.md`, `docs/asset-library.md`.
* `docs/journeys/<slug>.md`: each journey's spec, with its settled constants.
* `gotchas.md`: the traps that have already cost time. Read before touching a shader or a simulation.
* `AGENTS.md`: instructions for coding agents.

## Deployment

The site is deployed under `/webgl-journey-hell` (`CONFIG.site.basePath`). `metadata.json` belongs to the AI Studio sync that mirrors this repo; leave it alone.
