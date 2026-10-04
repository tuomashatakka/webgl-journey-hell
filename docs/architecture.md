# Architecture

## Layers

Dependencies point down. Nothing lower knows anything about what is above it.

```
src/app/          Next routes: layout, pages, icons, styles/*.css          (React, Next)
src/components/   views: markup and CSS hooks, no state of their own       (React)
src/hooks/        every useState / useEffect / useRef in the app           (React)
src/journeys/     registry + one folder per journey: content               (no React)
src/packages/*    generic engine code, one workspace package per concern   (no React, no Next)
```

* **`src/packages/` is framework-free.** `grep -rnE "from '(react|react-dom|next)" src/packages` finds nothing, and no package contains a `.tsx` file. A package can run under bun, in the bare harness or in a worker without a framework.
* **`src/journeys/` is content, not engine.** A journey's route table, physical constants, audio patches and GLSL are authored work: they are not generic and are not packages. They are also framework-free, so the bare harness bundles them without Next.
* **React lives only in `src/app`, `src/components`, `src/hooks`.** Routes are one line: `export default withJourneyShell(journey)`.
* **No barrel files.** There is no `index.ts` and no `export *`. Every import names the module that defines the symbol (`@wjh/math/scalar`, not `@wjh/math`). Each package's `package.json` `exports` maps `./<module>` to a concrete file.
* **One config file.** `src/packages/config/config.ts` exports `CONFIG`. See the boundary in its header: anything a person might turn (paths, budgets, input feel, timings, defaults, tool defaults) is there; authored content (route tables, sim constants, audio patches, GLSL constants, the delta manifest, the journey registry) stays beside the code that owns it.

## Packages

| package | owns |
| --- | --- |
| `@wjh/config` | `CONFIG`: the one config file |
| `@wjh/math` | `scalar` (clamp, mix, smoothstep, hash1), `rng` (mulberry32, hash2), `mat4`, `arrays` |
| `@wjh/geometry` | `curve` (closed Catmull-Rom, arc-length LUT, transported frames), `sweep` (profile sweeps), `meshBuilder` (CPU mesh + pre-fracturing) |
| `@wjh/gl` | `context`, `program`, `quad`, `shaderQuad`, `targets` (+ post chain), `texture`, `uniforms`, `mesh` (VAO/VBO), `crtPass` |
| `@wjh/glsl` | shared GLSL source: `hash`, `noise`, `sdf`, `color` |
| `@wjh/audio` | `engine` (`JourneyAudio` base), `nodes`, `room` (the shared reverb) |
| `@wjh/journey` | `definition`, `types`, `frame`, `seek`, `transport`, `label`, `signalLoss`, `signalOverlay`, `engine` |
| `@wjh/quality` | `device`, `tiers`, `governor`, `settings` |
| `@wjh/web` | `assetUrl`, `debugParams`, `frameLoopManager`, `panControl`, `glitchTitle`, `canvasText`, `keyboard` |
| `@wjh/delta` | the CC0 asset library: manifest, loaders, GLSL, the asset-browser renderer, `build.mjs` |

Each package.json lists every module in `exports` and the `@wjh/*` packages it imports in `dependencies`; both are maintained by hand. `knip` fails if a module is unused, so a package never carries a file nobody imports.

## The one data flow

A journey page is a loop with one direction. Nothing in the UI reaches into the engine's state; the engine reports what the UI needs through callbacks.

```
settings (SettingsProvider, localStorage)  --\
pan input (pointer, touch, gyro, look keys)     ---+-->  EngineHost  -->  createJourneyEngine(definition, host)
transport actions (buttons, keys, seek, scrub)   --/                         |
                                                                       v
                                       frame loop tick --> engine.frame(dt)
                                                           simulation.step -> uniforms -> renderer -> canvas
                                                                       |
                         onLoading / onSection / onPaused / stats <----+   (callbacks, never a store)
                                                                       v
                         use-journey-runtime: React state for what is *shown* (loading bar, section heading, paused)
                                                                       v
                         withJourneyShell: markup only
```

* `src/packages/journey/engine.ts` (`createJourneyEngine`) owns the GL context, renderer, simulation and its clock, transport, pause, governor, CRT pass, signal-loss overlay and loading stages. It is framework-free and testable without a DOM framework.
* `src/hooks/use-journey-runtime.ts` is the glue: it builds the `EngineHost` from the settings, the pan control and the transport ref, forwards the frame loop's ticks, and exposes the few facts the view displays. Per-frame readouts (FPS, the transport tape) are written to the DOM through refs, never through React state.
* `src/components/withJourneyShell.tsx` is the view: canvas, HUD, transport, overlays. Its flags (`useOpening`) and mount check (`useMounted`) are hooks; the keyboard is `JourneyKeys`; the runtime reaches the toolbar, the transport and the keys through `JourneyRuntimeContext`, not through props.
* Two frame paths. **Live**: the transport observes, the simulation steps on the speed-scaled delta, the governor moves the render scale, audio follows the uniforms. **Frozen** (`?t=`): seek once, redraw that instant every frame; no integration, no audio, no governor. The frame is a pure function of the URL, which is what every shot and probe relies on.

## State rules

1. A component renders. It receives data and callbacks; it does not own `useState` or `useEffect`.
2. State and side effects live in a hook (`src/hooks/`), a provider (`SettingsProvider`), or the framework-free engine.
3. A child that needs settings reads them from context (`useSettings`) rather than receiving them as props through a parent that does not use them.
4. Anything that changes per frame bypasses React.
5. A client-only fact (device tier, saved settings) is read after mount (`useMounted`), so the prerendered HTML matches the first client render.

## Journeys

A journey is declared once in `src/journeys/<slug>/journey.ts` (`defineJourney`) and everything reads that declaration: the page, the bare harness, the tools. See `docs/adding-a-journey.md`. Long modules are split by section: a shader is a `glsl/` folder of passes concatenated by `shader.ts` (or a `shader/` folder of programs), a simulation is a `kinematics/` folder (route table, constants, state, check) behind a short `kinematics.ts`.

## Assets

Every image is in `assets/`: `posters/` (the index's fallback pictures), `screenshots/` (kebab-case, `<journey>-<subject>-<n>`), `textures/`. There is no `public/` directory. Posters and the skybridges environment map are statically imported, so the bundler hashes them and applies the basePath; a runtime URL built from a string must go through `staticUrl` / `assetUrl` (`@wjh/web/assetUrl`). The delta library's files are the same: `delta/urls.ts` is generated static imports.
