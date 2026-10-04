# Tooling

## Debugging a journey

A journey is a clock, so everything interesting about it — which room you are in,
how flooded it is, how far a doorway has assembled — is a function of elapsed
time. Every journey therefore accepts a set of query parameters, honoured
centrally by `withJourneyShell`, that let you ask for one exact moment:

| param | meaning |
| --- | --- |
| `?t=42.5` | seek to 42.5s of journey time and hold there |
| `?debug=1` | overlay the live state and publish `window.__journeyDebug` (on by default with `?t=`) |
| `?dt=0.008` | the seek's fixed timestep (default 1/60) |
| `?hud=0` | hide the chrome, for a clean plate |
| `?w=1600&h=900` | exact backing-store size, ignoring dpr and the resolution setting |
| `?res=1` | resolution scale override |
| `?pointer=0.3,-0.2` | hold the pan offset, to look somewhere other than straight ahead |

```
/journeys/natatorium?t=30&w=1200&h=760          # the frame 7m before a join
/journeys/natatorium?t=30&hud=0&debug=0         # ...as a clean plate
```

`?t=` **seeks rather than jumps**, replaying the simulation from zero in fixed
increments. An integrating journey cannot be jumped — natatorium advances
`dist += speed * dt` and its speed depends on how deep the water is where it
already is — so the only way to know where `t` seconds puts you is to walk it,
and a fixed `dt` is what makes walking it reproducible. The same URL renders
byte-identical pixels across reloads and machines.

`document.documentElement.dataset.journeyReady` flips to `"1"` only once the
seeked frame is actually on the canvas, so a driver can wait on it instead of
sleeping and hoping:

```js
await page.goto(url)
await page.waitForSelector('html[data-journey-ready="1"]')
await page.screenshot({ path: 'shot.png' })
```

The overlay prints the uniforms grouped as the `vec4`s they are uploaded as,
which is usually the fastest way to find out that a value you believed was
varying is in fact pinned.

`tools/journey.mjs` drives all of this from a shell. It finds any Chromium
already in a Playwright cache — macOS's, Linux's, or `PLAYWRIGHT_BROWSERS_PATH`
— rather than insisting on the exact pinned build, and on Linux, where it is
almost always running in a container with no GPU, it asks for SwiftShader
(`JOURNEY_GL=gpu|swiftshader` overrides the guess):

```
node tools/journey.mjs shot    natatorium --t=30 --out=/tmp/a.png
node tools/journey.mjs film    natatorium --from=26 --to=34 --step=0.5
node tools/journey.mjs probe   natatorium --from=0 --to=60 --step=2 [--json]
node tools/journey.mjs scan    natatorium --from=4 --to=24 --step=0.4
node tools/journey.mjs uv      natatorium --t=30
node tools/journey.mjs hud     natatorium --from=0 --to=60 --step=2
node tools/journey.mjs fps     natatorium --at=11,24,48 --w=1200 --h=760
node tools/journey.mjs contact loop-line --bare --from=0 --to=140 --step=12 --cols=4
node tools/journey.mjs glsl    stairwell --bare
```

**`--bare` needs no dev server.** `tools/harness/serve.mjs` bundles the
journey's own renderer and simulation with bun (the `✦` alias and the workspace packages resolve, Δ's images go through bun's file loader) and serves them on a plain
canvas that speaks the same protocol — `?t=&w=&h=&pointer=&dt=`, `window.__journeyDebug`,
`data-journey-ready` — so every command works against it unchanged. It starts
in about a second where a Next dev server compiles for a minute, and the bundle
is rebuilt on every page load, so an edited shader is in the next shot. It
covers every journey — it runs the same definitions the pages do — plus
`previews`, which compiles every landing-page preview shader. `node
tools/harness/serve.mjs` runs it standalone for a browser.

* **contact** is the cheap way to *look*: many instants in one image, each tile
  labelled with its time and section. Twelve 320×180 tiles cost about what one
  full-size screenshot does, and answer "does every section read as itself" in
  a glance.
* **glsl** loads one instant and reports every error raised while building the
  programs — a shader that fails to compile still leaves a black frame, so
  pixels cannot tell you — and exits 1 on any, so it can gate a commit.

* **probe** prints mean luminance, the fraction of pure-black pixels and the
  fraction of blown-out ones per timestamp. `blown` is the one to watch: a wall
  that clips to white has lost its grout, its mosaic course and its cracks, and
  the number says so long before the eye admits it.
* **scan** walks time finely and reports where the image *jumps* between
  neighbouring frames, normalised against the median so it reads as a multiple
  of the journey's own baseline motion. Turning a corner at 5 m/s legitimately
  changes most of the frame, so absolute deltas mean nothing — the multiple is
  what separates "sharp turn" from "something popped".
* **uv** reports horizontal against vertical detail, for the class of bug where
  the image is stable but wrong: a surface that picked the wrong projection axis
  smears into stripes and one of the two collapses.
* **hud** measures the DOM overlays instead of the canvas, printing each one's
  box per timestamp and flagging any that moves. Chrome is laid out by CSS and
  CSS is not on the journey's clock, so this is the only reliable way to tell an
  overlay that is genuinely drifting from one that merely looks like it because
  the picture behind it changed. "The overlays jump on each section change" was
  settled this way in a minute: every box pinned to the pixel, every label — so
  the thing moving was a *shader* overlay, the lamp halos, still being evaluated
  in the camera's section while pointing anywhere.
* **fps** holds an instant and counts frames. The journey caps itself at 60, so
  pass `--w/--h` above the default resolution to measure what the shader
  actually costs; a locked 60 tells you it is affordable but not by how much.

The honest way to use these is against a baseline. Check out the last known-good
commit over the journey's own files, probe, restore, probe again, and compare —
the two columns settle arguments that screenshots do not. `probe --bare --json`
is deterministic, so two runs on identical code are byte-identical: diff them.

The rewrites of the loop line and the stairwell were developed almost entirely
this way: `glsl` after every shader edit, a `contact` sheet per round of
changes, a `shot` only when a tile needed a closer look, and `scan` across every
boundary to prove a transition before calling it smooth. To test a single
switch, scan it at a fine step (`--step=0.01`): a pop is a fixed amount of
change while motion shrinks with the step, so a pop that hides at 0.1 s stands
out at 10 ms. Note that `scan` rebuilds the bundle per frame in `--bare` mode —
do not edit while one runs.

## Posters and screenshots

With `bun run dev` running:

```bash
node tools/shoot-posters.mjs [slug…]   # assets/posters/<slug>.jpg, the index's picture where WebGL is not to be had
node tools/shoot-ui.mjs                # assets/screenshots/app-*.png, the README's shots of the chrome
```

Both launch a fresh browser per shot and find it through `tools/chromium.mjs`, which prefers a full Playwright Chromium (`Google Chrome for Testing.app`) over the headless shell. The headless shell has no GPU process: a live journey in it never paints and the browser exits after ~30 s with code 0, so a missing full build looks like a silent hang, not an error. Install it with `bunx playwright install chromium`; `JOURNEY_CHROMIUM` overrides the lookup. Posters are shot with the CRT pass off (`CONFIG.tools.posters.settings`), seeded under the current settings key.

## Verifying the geometry primitives

```bash
bun tools/verify-geometry.ts
```

Everything else here is verified by *looking* at it, and for a shader that is the
right instrument, because a wrong SDF looks wrong. `src/packages/geometry/curve.ts` and `src/packages/geometry/meshBuilder.ts` and `src/packages/gl/mesh.ts` are
not like that: they are pure maths with no picture of their own, they sit
underneath the thing you can see, and their failures stay invisible until they are
catastrophic. A spline that misses its own control points still produces a
perfectly plausible screenshot of the wrong track.

That is not hypothetical. The first cut of `src/packages/geometry/curve.ts` multiplied centripetal knot
spacing into a *uniform* Catmull-Rom basis, so it interpolated nothing and tore at
every segment join — and it passed a suite of seven checks, because every one of
them measured the curve *through* its own arc-length LUT, and the LUT happily
resamples whatever shape it is handed.

So the checks in this file are chosen to be ones a wrong implementation cannot
pass: the curve must go through its control points; densely-sampled step lengths
must have no outlier; the total turning of a closed planar loop must be exactly
2*pi (a *pointwise* curvature check cannot catch a wrong differentiation variable,
because a coarse spline through circle points is legitimately not a circle); and
no triangle may straddle two fracture shards.
