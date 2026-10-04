# Gotchas

Traps that have already cost time, in the order you are likely to hit them. The long explanations live in `docs/`; this is the checklist. Per-journey constants are in `docs/journeys/<slug>.md`.

## Repo and tooling

* **bun, not npm.** One lockfile (`bun.lock`); a second one desyncs and breaks CI. Next is not on PATH: `bunx next dev`. Audit with `bun audit`; the GitHub alert count is not the truth. Fix stale transitives by regenerating `bun.lock`.
* **The site lives under a basePath.** Local routes are `http://localhost:3000/webgl-journey-hell/...`; without the prefix they 404. A plain string handed to `new Image()`, `fetch()` or a CSS `url()` is not prefixed by Next: use `staticUrl` / `assetUrl` (`@wjh/web/assetUrl`). An unoptimized `next/image` skips the basePath for the same reason.
* **There is no `public/` directory.** Every image is in `assets/` and statically imported (posters in `src/journeys/registry.ts`, the skybridges env map in its `journey.ts`, the delta files in `delta/urls.ts`). Do not recreate `public/` and do not reference `/journeys/<slug>.jpg`.
* **An AI Studio sync can mutate the working tree** while you edit (it resurrects old files and strips dependencies). `metadata.json` belongs to it. Commit early, and re-check `git status` and `package.json`/`bun.lock` after structural work. A build can pass with stripped dependencies because `node_modules` is still populated.
* **Packages ship TypeScript source.** `next.config.ts` derives `transpilePackages` from the `@wjh/*` dependencies. A new package must be added to the root `package.json` and `bun install` re-run, or Next will not transpile it. Each package's `package.json` `exports` must list every module by hand; a module that is not listed cannot be imported as `@wjh/<pkg>/<module>`.
* **`knip --fix` is not safe on `src/app`.** It strips `export default` from route files. If you run it, `git checkout` the route files afterwards.
* **Tools import the config by relative `.ts` path** (`tools/*.mjs` use Node's type stripping, Node 22.18 or later). The `@wjh/*` alias is not available to plain Node.
* **`journey.mjs` waits for `html[data-journey-ready="1"]` with `state: 'attached'`.** The `html` element has zero size, so the default `visible` wait never resolves.
* **Dev server on port 3000 for the tools** (`CONFIG.tools.devOrigin`). `--bare` needs no server.

## Shaders

* **Never put a backtick in a GLSL comment.** Every shader is inside a JS template literal; a backtick ends it, and the error (Next's "Expected a semicolon") points at a comment line. Use asterisks or plain quotes. This has broken the build three times.
* **`pow(x, 2.0)` on a negative `x` is NaN.** The NaN reaches `gl_FragColor` and the frame is completely black, indistinguishable from a dark scene, with nothing logged. Square by multiplication. After editing a `shader*.ts`, grep the diff for backticks on comment lines and for `pow(` whose first argument is not wrapped in `abs`/`max`/`clamp`.
* **Journey shaders are GLSL ES 1.00** (raymarched ones) or ES 3.00 (the rasterized journeys and the stairwell). Previews on the index are always ES 1.00 and must be self-driving from `iTime` alone.
* **Large shaders are split into concatenated template strings** (`glsl/<pass>.ts` pieces joined in `shader.ts`). Splitting must not change a single byte of the assembled source: compare an md5 of every exported shader string before and after.
* **A shader that fails to compile still leaves a black frame.** `node tools/journey.mjs glsl <slug>` reports the errors and exits 1; run it after every shader edit.
* **Hash on a wrapped clock.** `tickAt` in the CRT pass exists because `sin()` of an unwrapped hour-long clock stops varying and the noise freezes into a constant that subtracts the whole picture.
* **Phone compilers inline and unroll everything.** The liminal `LITE` build exists because the full raymarcher did not compile on some phones. Anything with many `map()` call sites needs a light build.
* **The CRT capture texture must be `RGB`**, not `RGBA`, because the contexts are created `alpha: false`; the wrong format is a silent `INVALID_OPERATION` and every journey goes black.
* Route-bending traps (min vs smin, bounds that reach zero, quantised fields through a pinhole, resolve-the-owner rules) are in `docs/routes.md`.

## Rasterized scenes

* **A height field cannot tunnel**, so carve with a per-fragment discard from a signed value in an unused attribute. **A displaced surface cannot make a hole**: holes are fragment discards.
* **Knee under the exposure.** A luminance cap before the composite is multiplied by the section exposure and then tonemapped; a cap that looks sane in linear reads as a flat cream wall. Cap at about 0.2 * 2^-EV.
* A rasterizer without a depth buffer draws its rooms in submission order and you see through the walls: geometry renderers request `depth: true`.

## Verifying

* **`?t=` implies `debug=1`.** A seeked URL shows the debug panel unless you add `&debug=0`; the poster tool does.
* **Wait 5 to 7 s after an edit before shooting** against the dev server (Turbopack lag): a shot taken sooner can render the previous build. When a frame looks unchanged, diff the PNGs numerically before suspecting the code. `--bare` rebuilds the bundle per page load and has no such lag.
* **Probe diff is the regression gate for refactors.** `node tools/journey.mjs probe <slug> --bare --from=0 --to=120 --step=8 --json` is deterministic: capture a baseline, change code, capture again, `cmp` the files. Pure refactors must be byte-identical.
* **Sweep the derivative, not the image.** `probe`, `scan`, `shot` and a route-table assertion all passed on a 1018 deg/m grade discontinuity that made the switchback unridable. When motion comes from an authored curve, the acceptance gate is a derivative sweep: walk the function at about 2 cm and assert the worst `|df|/ds` stays within an order of magnitude of the reference lap's. Piecewise-by-sign (`if (g >= 0) ... else ...` on a quantity that crosses zero) is the smell; an affine map cannot produce the bug. Saturating functions (`atan2` pinned at its limit) stutter the same way. Confirm a new test fails against the old code before believing it.
* **Paint before theorising.** Patch each fragment shader's last output to a flat colour with a script, shoot, restore. One round trip names the mesh. Sample block maxima, not single pixels: the CRT pass darkens alternate rows.
* **Build the affordance, not the sleep.** If verification is awkward (a state reachable only by waiting), the missing feature is a deterministic way to reach it (`?t=`, `?pointer=`, a debug uniform). Build that instead of adding timing hacks.
* **Do not trust a delegate's verification.** Subagents pass checks on broken code and silently no-op. Check `git status` and run the gate yourself.
* **Verify the geometry primitives with checks a wrong implementation cannot pass** (`bun tools/verify-geometry.ts`): the curve goes through its control points, step lengths have no outlier, the turning of a closed planar loop is exactly 2*pi, no triangle straddles two shards. A check that measures a curve through its own arc-length LUT proves nothing.

## Runtime

* **Journeys are integrators, not timelines.** A time cannot be jumped to, only replayed (`seekSimulation`). Forward seeks step the live simulation; backward seeks replay from a recorded log. Anything keyed to wall-clock time breaks `?t=`: signal loss counts simulation seconds (`JourneyMarks.signalAge`).
* **The simulation's `step` must be deterministic**: no `Math.random`, no `Date.now`. Use `@wjh/math/rng`.
* **The CRT caption is composited in GL**, not DOM, or it would sit flat and square on a curved, torn picture.
* **Pan inversion** is in `use-journey-runtime` (the view swings away from the pointer sideways); the shaders all look toward `uPointer`.
* **Resize is applied just before the next draw**, because resizing clears the canvas and a cleared canvas between a frame and its paint is a flash.
* **Lost contexts come back**: the runtime asks for the context back and rebuilds the renderer.
* **The index previews share ONE WebGL context** (`ShaderPreviewLayer`) to stay under the browser's context cap.
* **Signal-loss laps differ per journey** (`CONFIG.signal.lossLaps`: loop line 5, skybridges 2, scenic route 3, natatorium 5); the four journeys with a persistent ending trigger on entering it.

## UI

* **The first key press of a journey skips the title card**, and the key bindings are off until the opening is over. A driver must wait for `#journey-title-intro` to disappear before sending keys.
* **A held frame publishes no debug state.** `togglePause` publishes it explicitly; anything else that changes while paused has to as well, or `window.__journeyDebug` goes stale.
* **A toolbar button's tooltip is a popover and a stacking context traps panels.** The toolbar is positioned with a z-index, so anything that must cover the page (the settings panel) is portalled to the body.
* **Slider, field and dialog keys belong to them.** `isKeyCaptured` (`@wjh/web/keyboard`) is what keeps arrows on a slider from seeking the journey and space on a dialog button from pausing it.

## Engine facts

* The journeys are raymarched or rasterized by hand: zero 3D dependencies. "Real geometry" means a new renderer path (`geometryRenderer`), not a new shader.
* Before reading about a Next.js API, read the matching guide in `node_modules/next/dist/docs/`: this Next.js version has breaking changes (see `AGENTS.md`).
* **Browser tools need full Chromium, not the headless shell.** Without a GPU process a live journey never paints and the headless shell exits cleanly after ~30 s. `tools/chromium.mjs` picks the full build; see `docs/tooling.md`. `data-journey-ready` is raised only by the debug overlay (`?t=` / `debug=1`), so do not wait on it for a live page.
