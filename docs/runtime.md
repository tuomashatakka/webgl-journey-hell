# Runtime behaviour

What the page does around a journey: input, frame rate, chrome, the opening, the transport, the CRT pass and the signal going. The code is `src/packages/journey/engine.ts` (framework-free) behind `src/hooks/use-journey-runtime.ts`.

## Looking around

Every journey steers its camera from one normalized `uPointer` (-1..1, y up),
fed by `src/packages/web/panControl.ts`:

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

## Phones, and frame rate

The journeys are fragment-bound raymarches and HDR rasterizers, and a phone's GPU
is a tenth of a desktop's driving a screen with as many pixels, so the render
scale is not a constant (`src/packages/quality`):

* **AUTO resolution** (the default) hands the backing-store scale to a governor.
  It measures windows of real frame times, steps the scale down by √(budget /
  frame time) when a window runs over (fragment cost is proportional to pixel
  count), and probes back up 10% at a time once frames have held the budget for a
  while. A probe that costs more than there was is reverted and the next waits
  twice as long, so a device exactly at its limit settles instead of hunting.
* **Device tiers** set the starting point and the knobs a renderer reads from
  `frame.quality`: on a phone the scale starts around half of CSS resolution, MSAA
  is off and the bloom chain is three levels deep; heavy effects default off.
* **The frame loop** delivers real elapsed time even when capped — it used to
  hand a fixed 1/fps step to every frame, so a device managing 20 fps under a 60
  cap played every journey at a third of its speed — and tolerates rAF jitter, so
  a 60 cap on a 60 Hz display no longer drops frames that arrive 0.1 ms early.
* **Nothing composites that need not.** The display grade rides on the CRT pass
  instead of a CSS filter on the canvas (a full-screen compositing pass per frame
  at native resolution); a section heading's canvas is unmounted once it has torn
  out; the scanline layer is left off on a low-tier phone; the transport bar and
  the FPS readout write to the DOM directly instead of re-rendering React sixteen
  times a second; and a paused journey stops drawing until something it shows
  actually changes (the last frame stays on the canvas).
* **The heaviest shader has a light build.** Phone compilers inline every call
  and unroll every short loop, so the liminal raymarcher, whose `map()` is
  reached from thirty-odd places once its normals, AO taps and two reflection
  marches are counted, came out too big for some of them to build at all (a
  black screen on Chrome for Android). Phones get its `LITE` build: the march
  only as long as heavy-effects-off already made it, three AO taps shared by
  every lit branch, and reflections taken from the room's own colour instead of
  marched for. About eight copies of `map()`, and three times the frame rate.
  Anything else builds the full shader and falls back to `LITE` if its compiler
  refuses.
* **A shader that will not compile says so.** The loading bar shows the
  compiler's own first line (`src/packages/gl`'s `takeGlFailure`), selectable, so a phone
  with no console can still say what went wrong.
* **A lost context comes back.** A phone takes the GL context back when it wants
  the memory; the runtime asks for it back and rebuilds the renderer when it
  returns, instead of leaving the canvas black.

## The page

The canvas is always the viewport — `100vw` × `100vh` (the dynamic height where a
browser has one, so a phone's toolbars never cover it) — and a `ResizeObserver`
re-fits the backing store whenever that box changes: a rotation, a resized window,
fullscreen. The resize is applied by the next frame, just before it draws, since
resizing clears the canvas and a cleared canvas between a frame and its paint is a
flash.

**Fullscreen is the picture alone**: every piece of chrome (`.hud`) fades out and
stops taking the pointer, which is for looking around. Keyboard focus brings a
control back; Esc brings them all back.

**Panning is the same everywhere**, the way the poolrooms always did it: the view
swings away from the pointer sideways (pointer or phone to the right, and it turns
left) and follows it up and down. The shaders all look *toward* `uPointer`; the
one inversion is in `use-journey-runtime`.

**Pause** (❚❚ on the transport, or space anywhere but a text field) holds the
clock: the simulation stops stepping, the audio context is suspended where it
is, and the frame stays up — it can still be looked around, and the transport
still jumps and scrubs while paused.

## The opening, and the headings

A journey's page opens in three beats, none of them under `?t=` or `?hud=0`:

1. **the loading bar** (`src/components/JourneyLoader`). It is in the prerendered
   HTML, so it is up before any script has run, and it moves by stage — the
   scripts, then *compiling shaders* (painted first, then the context and the
   renderer are built: the stretch that blocks the main thread, which is why a
   highlight sweeps the bar as a compositor-only animation), then *loading
   textures* by the renderer's `progress()` while its `ready()` is false, then a
   few frames *warming up* at t = 0. The journey's clock holds at zero until then,
   so it starts when it can be seen.
2. **the title card** (`src/components/GlitchTitle`, `src/packages/web/glitchTitle.ts`): the name fades
   up out of black with the tagline under it, holds, and then the signal carrying
   it fails — the black tears away in bands, the title's channels separate and its
   slices slide sideways, and its bytes go bad (copies at offsets that are not
   multiples of four rotate the channels, rows smear, bits flip, 8×8 blocks
   posterise like a codec that lost its residuals). The corrupted variants are
   built one per frame during the hold, so the card never stalls a frame, and its
   clock is its own frames. A tap or a key skips to the tear-out; reduced motion
   gets a plain fade.
3. **the journey**, with a **section heading** each time the section changes —
   the same type and the same failure, smaller and quicker, with no black behind
   it: the section's name, and its lap under it as the tagline. It is announced on
   play and on a jump, never mid-scrub, and once it has torn out it is gone from
   the middle entirely; the section stays named on the transport, next to the play
   state.

## Keyboard

Bound on `window` by `JourneyKeys` (`src/hooks/use-journey-keys.ts`) while the journey is live (not under `?t=`, and not during the opening). The key map is `CONFIG.keys` (physical key codes); what a press means is `@wjh/web/keymap`. A key whose target is a field, a slider or an open dialog is left alone; every key that is handled is `preventDefault`-ed.

| key | does |
| --- | --- |
| Space | pause / resume (acts on keydown; keyup is swallowed so a focused button is not clicked too) |
| ArrowLeft / ArrowRight | seek back / forward `CONFIG.keys.seekSeconds` (5 s) |
| Meta + ArrowLeft / ArrowRight | previous / next loop. "Loop" is the transport's lap (`prev-lap` / `next-lap`). Checked before the plain arrows |
| 1 2 3 4 | playback speed 0.5, 1, 1.5, 2 (the same values the settings panel offers) |
| W A S D | look around: up, left, down, right |

Seeking forward steps the live simulation; seeking back replays a fresh one (`transport.skip`), like every other jump. Looking is a third input to the pan control beside the pointer and the gyroscope: held keys push the offset toward `CONFIG.keys.lookLimit` at `lookPushRate` and it eases back at `lookReturnRate` on release. The offset is added in output space, so D looks right regardless of the pointer inversion.

`?debug=1` publishes `window.__journeyDebug` every live frame with `time`, `paused`, `speed` and `pan` (the look input as the shaders receive it), which is how every binding is checked from a driver.

## The toolbar and the settings panel

The top bar (`JourneyToolbar`) holds the back link, mute (journeys with a soundtrack), fullscreen and settings, then the FPS readout. Every button is an inline SVG icon with an `aria-label` and a tooltip (`ToolbarButton`): a manual popover anchored to the button with CSS anchor positioning where the browser supports it, a plain CSS tooltip otherwise. It shows on hover and on keyboard focus. The bar is `.hud`, so fullscreen hides it and keyboard focus brings it back; at phone width the buttons keep a 40 px hit area and the bar respects the safe-area insets.

The settings panel is an `<aside role="dialog">` fixed to the right edge over a fixed full-viewport backdrop, portalled to the body so nothing on the page can sit above it. A click on the backdrop closes it, Esc closes it, focus moves in on open, Tab is trapped inside it and focus returns to the gear (`use-dialog-focus`).

## The transport, and the CRT

Every journey carries a tape deck (`src/components/JourneyTransport`), driven by
`src/packages/journey/transport.ts`:

* **❚❚** — pause / play (space does the same). The line beside the buttons reads
  the state and the section: `▶ PLAY  LAP 2 · THE VIADUCT`.
* **◀◀ / ▶▶** — previous / next *chapter*: a cut to the start of the section, never
  a shuttle through time. ◀◀ restarts the chapter you are in, or goes one further
  if you have only just entered it.
* **⏮ / ⏭** — the start of this lap / the next lap.
* **the bar** — press, drag, or tap anywhere on it to scrub through the lap; arrow
  keys step it when focused. The ticks are the section boundaries.

The hard part is that a journey is an *integrator*, not a timeline — `z += speed(z)
* dt`, with speed depending on where you already are — so a time cannot be jumped
to, only replayed (`seekSimulation`, `src/packages/journey/seek.ts`). The transport decides
which `t` to replay to, and forward and backward are asymmetric on purpose:

* **forward** — the destination is not known in advance, so the live simulation is
  stepped fast, in one frame, while `marks()` is watched until it gets there.
* **backward** — the destination *is* known, because time only ever starts at
  zero. Everything behind the playhead was watched on the way out: a log of when
  each section began, and a track of where along the lap every instant was. Going
  back reads the log (or interpolates the track, for a scrub) and replays a fresh
  simulation to that time.

A cut lands on exactly the timestamp it left from, because the seek divides `t`
into equal steps rather than stepping until it overshoots. A scrub applies at most
once per frame, the latest pointer position winning, so a fast drag never queues
replays.

`src/packages/gl/crtPass.ts` is the one post-process every journey shares: tube curvature,
chromatic offset, aperture mask, vignette, the tape treatment the transport
plays over the top — and the display grade (brightness, contrast), so the canvas
never needs a CSS filter. It does **not** re-plumb the renderers to draw into an FBO —
every journey already finishes its frame on the default framebuffer, so the pass
copies that back buffer into a texture mid-frame and draws over it. Nothing
upstream knows it exists. Two constraints worth knowing before touching it: the
capture texture must be `RGB`, not `RGBA` (the shell asks for `alpha: false`
contexts, and copying into a format that needs a component the read buffer lacks
is a silent `INVALID_OPERATION` that leaves every journey black), and the shader
is GLSL ES 1.00 because the shell hands out both `webgl` and `webgl2` contexts.

Both are suppressed under `?t=` and `?hud=0`, so `tools/journey.mjs` stays
deterministic. The CRT pass can be switched off in Settings.

## The signal going

Every journey now either ends somewhere it never leaves — the stairwell's
purgatory, the switchback's fall, liminal's abyss, the orchard's compost — or laps
until the lapping has stopped meaning anything. All of them used to just continue
at full picture quality, which reads as "the demo is still running" rather than as
the end of something. `src/packages/journey/signalLoss.ts` is what marks it.

Eight seconds into that state the picture starts to fail; it takes fifteen more to
arrive; and it never recovers, settling at a weak, torn, colourless signal rather
than at black. A warning caption fades up, and eight seconds later a dB meter
drops in under it with the reception falling away.

Three things about it are worth knowing before touching it.

**The caption is composited in GL, not DOM.** `src/packages/gl/crtPass.ts` works by reading the
canvas back buffer and drawing over it, so anything in DOM ends up flat and square
on top of a curved, torn, fringed picture — which gives the whole effect away in
one frame. `src/packages/journey/signalOverlay.ts` draws to a 2D canvas instead, and the pass samples
it at the same warped uv and through the same chromatic offset as the scene. It
takes only a third of the tearing and none of the lost vertical lock, because a
warning is generated at the receiver rather than transmitted, and at full amplitude
the words stop being words.

**Everything is a pure function of simulation state, because `?t=` is.** The
obvious implementation — a wall-clock accumulator in the shell — cannot work:
`seekSimulation` replays a simulation from zero without the shell observing, so the
loss would vanish on every seek. Instead each simulation counts its own seconds in
its own `step` and reports them as `JourneyMarks.signalAge`; the dB trace is
sampled from `dbAt()` per column rather than kept as a scrolling history for the
same reason. Two `shot`s of the same `?t=` are byte-identical, graph included.

**It is not behind the CRT setting.** The pass runs whenever the signal is going,
with the tube's curvature and scanlines zeroed (`CRT_BYPASS`) if the setting is
off. The setting governs a display treatment; this is a story beat.

Which journeys, and when: the four with a persistent ending trigger on entering it;
the four that lap forever trigger on a per-journey lap count in
`CONFIG.signal.lossLaps` (loop line 5, skybridges 2, scenic route 3, natatorium 5)
standing in for an ending they do not have.

One trap, already paid for: anything that hashes on time must wrap the clock
first (`tickAt` in `src/packages/gl/crtPass.ts`). These journeys run for an hour, and `hash()` takes
`sin()` of a dot product — feed it an unwrapped clock and the argument runs past
what a highp float carries, `sin()` stops varying, and the noise freezes into a
constant. A constant offset does not read as noise; at signal-loss amplitudes it
subtracts the entire picture.
