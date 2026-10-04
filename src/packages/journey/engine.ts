// The engine under every journey page: everything that is not markup.
//
// Given a journey definition it owns the WebGL context and the renderer, the
// simulation and its clock, the transport and the pause, the adaptive
// resolution governor, the CRT pass and the signal-loss caption, the loading
// state, and the one frame callback that ties them together. It is framework
// free: the React side (hooks/use-journey-runtime) only supplies an `EngineHost`
// — how to read settings, where the pan input is, where to report state — and
// forwards the frame loop's ticks. Data flows one way: the host's inputs go in,
// the frame comes out on the canvas, and what the UI needs to show comes back
// through the host's `on*` callbacks.
//
// Two paths through the frame:
//
//   live    — the transport observes and may move the clock; the simulation
//             steps on the speed-scaled delta unless paused or still loading;
//             the governor watches real frame times and moves the render
//             scale; audio follows the uniforms.
//   frozen  — `?t=`: seek once, then redraw that instant every frame. No
//             integration, no pan tween, no audio, no governor: the frame is a
//             pure function of the URL, which is the whole contract a
//             screenshot driver relies on.
//
// Loading, stage by stage, as the bar shows it (CONFIG.runtime.loading):
//
//   LOADING            the prerendered page, while the scripts arrive
//   COMPILING SHADERS  painted first; then the context and the renderer are
//                      built, the stretch that blocks the main thread
//   LOADING TEXTURES   while the renderer's `ready()` is false, by `progress()`
//   WARMING UP         a few frames drawn at t = 0, where lazily linked
//                      programs and first texture uploads land
//
// The clock holds at zero until the last of those, so a journey starts when it
// can be seen rather than wherever it had got to behind the bar.

import { CONFIG } from '@wjh/config/config'
import { createCrtPass } from '@wjh/gl/crtPass'
import type { CrtPass } from '@wjh/gl/crtPass'
import { createContext } from '@wjh/gl/context'
import { takeGlFailure } from '@wjh/gl/program'
import type { CustomUniforms, QualityHints } from '@wjh/gl/uniforms'
import { createGovernor } from '@wjh/quality/governor'
import type { Governor } from '@wjh/quality/governor'
import { detectDevice } from '@wjh/quality/device'
import type { GraphicsSettings } from '@wjh/quality/settings'
import { qualityForTier, scaleRange } from '@wjh/quality/tiers'
import { publishDebugState, readDebugParams } from '@wjh/web/debugParams'
import type { DebugParams, JourneyDebugState } from '@wjh/web/debugParams'
import type { PanVector } from '@wjh/web/panControl'
import type { FrameLoopManager } from '@wjh/web/frameLoopManager'
import type { JourneyDefinition } from './definition'
import { evaluateFrame, hudLabel } from './frame'
import type { FrameState } from './frame'
import { seekSimulation } from './seek'
import { signalLossAt } from './signalLoss'
import { createSignalOverlay } from './signalOverlay'
import type { SignalOverlay } from './signalOverlay'
import { createJourneyTransport } from './transport'
import type { JourneyTransport, TransportAction, TransportMode, TransportState } from './transport'
import type { JourneyMarks, JourneyRenderer, JourneySimulation } from './types'


const { runtime } = CONFIG

/** What the prerendered page shows, before any script has run. */
export const LOADING_BOOT: JourneyLoading = {
  ...runtime.loading.boot,
  done:   false,
  failed: false,
}

/** The loading bar, as the engine reports it. */
export interface JourneyLoading {
  progress: number; /** 0..1. */
  status:   string;
  done:     boolean; /** Everything is up and the clock is running: the bar can go. */
  failed:   boolean; /** The journey cannot run here; the bar stays, saying why. */
  detail?:  string; /** With `failed`: the compiler's own words, when it gave any. */
}

/** The section to announce, and a key that changes whenever it does. */
export interface SectionAnnouncement {
  name: string;
  key:  number;

  /** The section's index in the lap and the lap's own, both from zero. */
  index: number;
  loop:  number;
}

/** What the transport bar shows, pushed every live frame. */
export interface TransportView {
  mode:         TransportMode;
  paused:       boolean;
  loop:         number;
  section:      number;
  sectionCount: number;
  progress:     number;
  time:         number;
  label:        string;
  hasMarks:     boolean;
}

/** What the UI hands the engine, and what the engine hands back. */
export interface EngineHost {

  /** Current graphics settings. */
  settings(): GraphicsSettings;

  /** Current debug query parameters. */
  debug(): DebugParams;

  /** The pan input: advance its tweens, read it, or pin it (`?pointer=`). */
  pan: {
    update(dt: number): PanVector;
    pointer(): PanVector;
    hold(x: number, y: number): void;
  };

  /** The soundtrack, once it has been built (null before the first unmute). */
  audio(): { update?(time: number, state?: CustomUniforms): void; setPaused?(paused: boolean): void } | null;

  /** The "W×H · N FPS" readout element, written once a second. */
  stats(): HTMLElement | null;

  /** The transport bar, fed every live frame. */
  transportView(): { update(view: TransportView): void } | null;

  onLoading(loading: JourneyLoading): void;
  onSection(section: SectionAnnouncement): void;
  onPaused(paused: boolean): void;
}

export interface JourneyEngine {

  /** Build the context and renderer on `canvas`. Returns the teardown. */
  attach(canvas: HTMLCanvasElement): () => void;

  /** One frame-loop tick. */
  frame(manager: Pick<FrameLoopManager, 'deltaTime'>): void;

  /** The settings or the debug parameters changed. */
  inputsChanged(): void;

  readonly paused: boolean;
  togglePause(): void;

  /** The title card has started tearing away, or there is none: the clock may run. */
  begin(): void;

  act(action: TransportAction): void;
  skip(seconds: number): void;
  scrub(fraction: number): void;
  release(): void;

  /** Snapshot for the debug panel and `window.__journeyDebug`. */
  debugState(): JourneyDebugState;
}

/** Real pixel size for the backing store: an exact `?w=&h=`, or the viewport times the scale. */
type BackingSizeReturnType = { w: number; h: number }

const stage = (progress: number, status: string): JourneyLoading =>
  ({ progress, status, done: false, failed: false })

function backingSize (
  debug: DebugParams, settings: GraphicsSettings, governorScale: number, canvas: HTMLCanvasElement,
): BackingSizeReturnType {
  // An exact size beats everything: a screenshot compared against another
  // cannot be at the mercy of the window.
  if (debug.w && debug.h)
    return { w: debug.w, h: debug.h }

  const res   = debug.res ?? settings.resolution
  const scale = res === CONFIG.settings.autoResolution
    ? governorScale
    : Math.min(window.devicePixelRatio || 1, runtime.maxDpr) * res
  return {
    w: Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth) * scale)),
    h: Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight) * scale)),
  }
}

export function createJourneyEngine (definition: JourneyDefinition, host: EngineHost): JourneyEngine {
  // --- state ---------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = null
  let renderer: JourneyRenderer | null = null
  let crt: CrtPass | null              = null
  let overlay: SignalOverlay | null    = null
  let sim: JourneySimulation | null    = definition.createSimulation?.() ?? null

  let iTime  = 0
  let paused = false

  // The title card is tearing away (or there is none): the clock may run.
  let started                       = false
  let seeked: number | null         = null
  let debugUniforms: CustomUniforms = {}
  let label                         = ''
  let size                          = { w: 0, h: 0 }
  let resizeDue                     = true

  const load = { shown: LOADING_BOOT, done: false, warm: 0, since: 0 }
  let section: SectionAnnouncement = { name: definition.sectionNameAt?.(0) ?? '', key: 0, index: 0, loop: 0 }

  const fps = { frames: 0, since: 0, value: 0 }

  // What the last live frame was drawn with — a paused frame that would come
  // out the same is not drawn again.
  const drawn = { x: NaN, y: NaN, time: NaN, w: 0, h: 0, held: false, settings: null as GraphicsSettings | null }

  const device                = detectDevice()
  const quality: QualityHints = qualityForTier(device.tier)
  const governor: Governor    = createGovernor({ ...scaleRange(device), targetFps: host.settings().maxFrameRate || 60 })

  // --- transport -------------------------------------------------------------
  const transport: JourneyTransport = createJourneyTransport({
    createSimulation: () => definition.createSimulation?.() ?? null,
    adopt:            (next, time) => {
      sim?.dispose?.()
      sim   = next as JourneySimulation | null
      iTime = time
    },
    current: () => ({ sim, time: iTime }),
    marksAt: definition.marksAt,
    advance: dt => {
      iTime += dt
      sim?.step(dt, iTime)
    },
  })

  // --- loading ---------------------------------------------------------------
  /** Hand the bar a new state — whole percents only, React hears no more. */
  const report = (next: JourneyLoading) => {
    const prev = load.shown
    if (Math.round(next.progress * 100) === Math.round(prev.progress * 100) &&
      next.status === prev.status && next.done === prev.done && next.failed === prev.failed)
      return
    load.shown = next
    host.onLoading(next)
  }

  /** Once per live frame until done: where the renderer's assets are. */
  const pollLoading = (r: JourneyRenderer) => {
    const ready                       = r.ready?.() ?? true
    const waited                      = (performance.now() - load.since) / 1000
    const { textures, warming, done } = runtime.loading

    if (!ready && waited < runtime.assetTimeoutSeconds) {
      report(stage(textures.from + textures.span * (r.progress?.() ?? 0), textures.status))
      return
    }
    if (!ready && load.warm === 0)
      console.warn(`${definition.slug}: assets still loading after ${runtime.assetTimeoutSeconds}s; starting without them`)

    load.warm += 1
    if (load.warm < runtime.warmFrames) {
      report(stage(warming.progress, warming.status))
      return
    }
    load.done = true
    report({ ...stage(done.progress, done.status), done: true })
  }

  // --- resize ----------------------------------------------------------------
  // The canvas is laid out at the full viewport by CSS; this matches its
  // backing store to that box (times the render scale). A ResizeObserver only
  // marks it due and the next frame applies it, just before drawing: resizing
  // clears the canvas, and between a frame and its paint is the one moment a
  // cleared canvas would be seen.
  const resize = () => {
    if (!canvas)
      return

    const next = backingSize(host.debug(), host.settings(), governor.scale, canvas)
    if (canvas.width !== next.w || canvas.height !== next.h) {
      canvas.width  = next.w
      canvas.height = next.h
    }
    size = next
  }

  // The display grade rides on the CRT pass; the canvas only falls back to a
  // CSS filter — a full-screen compositing pass per frame — if that pass could
  // not be built and the grade is not the identity.
  const applyDisplayFilter = () => {
    if (!canvas)
      return

    const s             = host.settings()
    const graded        = s.brightness !== 1 || s.contrast !== 1
    canvas.style.filter = !crt && graded ? `brightness(${s.brightness}) contrast(${s.contrast})` : ''
  }

  // --- per-frame helpers -----------------------------------------------------
  const announce = (name: string, m: JourneyMarks | null) => {
    if (name === section.name)
      return
    section = { name, key: section.key + 1, index: m?.section ?? 0, loop: m?.loop ?? 0 }
    host.onSection(section)
  }

  /** The CRT treatment and the display grade, over what the renderer drew. */
  const composite = (time: number, scrub: number, scrubMix: number, signalAge: number) => {
    if (!crt)
      return

    const s      = host.settings()
    const loss   = signalLossAt(signalAge)
    const graded = s.brightness !== 1 || s.contrast !== 1

    // The CRT setting governs the *display treatment*, not whether the story
    // beat happens: once the signal is going, the pass runs either way.
    if (!s.crt && !graded && loss.level <= 0.001 && scrubMix <= 0)
      return

    if (overlay && canvas && overlay.update(loss, canvas.width, canvas.height))
      crt.setOverlay(loss.level > 0.001 ? overlay.canvas : null)

    crt.draw({
      time,
      ...s.crt ? CONFIG.crt.idle : CONFIG.crt.bypass,
      scrub,
      scrubMix,
      signal:     loss.level,
      brightness: s.brightness,
      contrast:   s.contrast,
    })
  }

  /** FPS readout, written straight into the element once a second. */
  const countFrame = () => {
    const now = performance.now()
    fps.frames += 1
    if (fps.since === 0)
      fps.since = now
    if (now - fps.since < 1000)
      return

    fps.value  = Math.round(fps.frames * 1000 / (now - fps.since))
    fps.frames = 0
    fps.since  = now

    const el = host.stats()
    if (el)
      el.textContent = `${size.w}×${size.h} · ${fps.value} FPS`
  }

  const debugState = (): JourneyDebugState => ({
    journey:  definition.slug,
    time:     iTime,
    label,
    seeking:  host.debug().t !== null,
    ready:    renderer?.ready?.() ?? true,
    width:    size.w,
    height:   size.h,
    fps:      fps.value,
    paused,
    speed:    host.settings().speed,
    pan:      [ host.pan.pointer().x, host.pan.pointer().y ],
    uniforms: debugUniforms,
  })

  // --- GL setup / teardown ----------------------------------------------------
  const setup = (target: HTMLCanvasElement): (() => void) | null => {
    // Read straight from the query string: this can run before the host's
    // debug state lands, and context attributes cannot change afterwards.
    // preserveDrawingBuffer is what lets a driver read the frame back at all,
    // and costs a copy per frame — on only while something is debugging.
    const boot = readDebugParams()
    const spec = definition.renderer
    takeGlFailure()

    const fail = (status: string) =>
      report({ progress: 0, status, done: false, failed: true, detail: takeGlFailure() ?? undefined })

    const gl = createContext(target, spec.context, {
      ...spec.attributes,
      preserveDrawingBuffer: boot.debug || boot.t !== null,
    })
    if (!gl) {
      console.error(`${spec.context} not supported`)
      fail(`NO SIGNAL · ${spec.context.toUpperCase()} UNAVAILABLE`)
      return null
    }

    resize()

    renderer = spec.create(gl, target)
    if (!renderer) {
      fail('NO SIGNAL · RENDERER FAILED')
      return null
    }

    const built = renderer

    // Failing to build the CRT pass is not fatal: the journey underneath is
    // a complete image on its own.
    crt     = createCrtPass(gl)
    overlay = createSignalOverlay()
    applyDisplayFilter()

    // A rebuild after a lost context is not a load: the bar is long gone.
    if (!load.done) {
      load.since                  = performance.now()

      const { textures, warming } = runtime.loading
      report(built.ready ? stage(textures.from, textures.status) : stage(textures.from, warming.status))
    }

    const observer = new ResizeObserver(() => {
      resizeDue = true
    })
    observer.observe(target)

    return () => {
      observer.disconnect()
      crt?.dispose()
      crt = null
      overlay?.dispose()
      overlay = null
      built.dispose()
      renderer = null
      // NOTE: never WEBGL_lose_context here. A canvas hands back the same
      // context on every getContext(), so losing it would poison the next
      // mount (StrictMode/HMR reuse the canvas) and every compile after it
      // would fail with a null info log.
    }
  }

  const attach = (target: HTMLCanvasElement): () => void => {
    canvas = target
    sim ??= definition.createSimulation?.() ?? null

    let teardown: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    // Say what is about to happen, and let it be painted before doing it: the
    // compile blocks the main thread, and a bar that sat at "loading" through
    // it would read as a hang. rAF then a task is "after the next paint".
    report(stage(runtime.loading.compiling.progress, runtime.loading.compiling.status))

    const raf = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        teardown = setup(target)
      }, 0)
    })

    // A phone takes the context back when it wants the memory (another app,
    // a long spell in the background) and the canvas goes black for good
    // unless someone asks for it back: preventDefault is the asking. The
    // frame loop idles with no renderer, and everything is rebuilt on return.
    const onLost = (e: Event) => {
      e.preventDefault()
      teardown?.()
      teardown = null
    }
    const onRestored = () => {
      teardown?.()
      teardown = setup(target)
    }
    target.addEventListener('webglcontextlost', onLost)
    target.addEventListener('webglcontextrestored', onRestored)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      target.removeEventListener('webglcontextlost', onLost)
      target.removeEventListener('webglcontextrestored', onRestored)
      teardown?.()
      sim?.dispose?.()
      sim    = null
      canvas = null
    }
  }

  // --- the frame ---------------------------------------------------------------
  /** `?t=`: seek once, then redraw that instant. A pure function of the URL. */
  const frozenFrame = (r: JourneyRenderer, d: DebugParams, s: GraphicsSettings, t: number) => {
    if (seeked !== t) {
      seekSimulation(sim, t, d.dt)
      iTime  = t
      seeked = t
    }
    if (d.pointer)
      host.pan.hold(d.pointer[0], d.pointer[1])

    const frame = evaluateFrame(definition, sim, t)
    r.draw({ time: t, pointer: host.pan.pointer(), heavy: s.heavyEffects ? 1 : 0, custom: frame.custom })
    composite(t, 0, 0, frame.marks?.signalAge ?? 0)

    debugUniforms = frame.custom ?? {}
    label         = hudLabel(frame.label, frame.detail)
    countFrame()
    if (!load.done)
      pollLoading(r)

    // Published after draw() returns: "the seeked frame is on the canvas".
    publishDebugState({ ...debugState(), seeking: true, ready: r.ready?.() ?? true })
  }

  /** The transport, the pan and the clock, before a frame is drawn. */
  const advance = (s: GraphicsSettings, deltaTime: number) => {
    // Log where we are *before* moving, so every boundary ever crossed has a
    // recorded time to go back to.
    transport.observe(iTime, sim?.marks?.() ?? definition.marksAt?.(iTime) ?? null)

    const ts = transport.tick(deltaTime)

    // Input is tweened on the real delta — the speed setting must not change
    // how the camera feels to move.
    const pan = host.pan.update(deltaTime)

    // The clock runs once the journey is up and revealed, and not while
    // paused. Jumps and scrubs move it either way: those are the transport's
    // own moves, made inside tick() and request().
    if (load.done && started && !paused && ts.mode !== 'scrub') {
      const dt = deltaTime * s.speed
      iTime += dt

      // Step before the draw, so the frame shows the state just integrated.
      sim?.step(dt, iTime)
    }
    return { ts, pan }
  }

  /**
   * Paused, and nothing it shows has moved: the last frame is still on the
   * canvas (an undrawn frame is not cleared), and the GPU gets to rest.
   */
  const idle = (ts: TransportState, pan: PanVector, s: GraphicsSettings, target: HTMLCanvasElement) =>
    paused && load.done && ts.mode === 'play' && ts.scrubMix === 0 && drawn.held &&
    drawn.time === iTime && drawn.settings === s && drawn.w === target.width && drawn.h === target.height &&
    Math.abs(drawn.x - pan.x) < runtime.panEpsilon && Math.abs(drawn.y - pan.y) < runtime.panEpsilon

  /**
   * Resolution follows the frame rate when it is the governor's to decide —
   * from frames actually being made, so neither the load's hitches nor a
   * paused frame's idling skews it.
   */
  const governs = (d: DebugParams, s: GraphicsSettings) =>
    load.done && !paused && s.resolution === CONFIG.settings.autoResolution && d.res === null && !(d.w && d.h)

  /** The HUD's share of a live frame: the label, the heading, the transport, the stats. */
  const publishLive = (ts: TransportState, frame: FrameState, d: DebugParams) => {
    const m       = frame.marks
    debugUniforms = frame.custom ?? {}
    label         = hudLabel(frame.label, frame.detail)
    if (ts.mode !== 'scrub')
      announce(frame.label, m)

    host.transportView()?.update({
      mode:         ts.mode,
      paused,
      loop:         m?.loop ?? 0,
      section:      m?.section ?? 0,
      sectionCount: m?.sectionCount ?? 1,
      progress:     m?.progress ?? 0,
      time:         iTime,
      label,
      hasMarks:     m !== null,
    })
    countFrame()
    if (d.debug)
      publishDebugState(debugState())
  }

  const liveFrame = (r: JourneyRenderer, d: DebugParams, s: GraphicsSettings, deltaTime: number) => {
    const { ts, pan } = advance(s, deltaTime)
    const target      = canvas!
    if (idle(ts, pan, s, target)) {
      countFrame()
      return
    }
    if (governs(d, s) && governor.sample(deltaTime))
      resize()

    const frame = evaluateFrame(definition, sim, iTime)

    // A tape has no audio at speed, and a rewound clock makes a graph click.
    if (ts.mode === 'play' && !paused)
      host.audio()?.update?.(iTime, frame.custom)

    r.draw({ time: iTime, pointer: host.pan.pointer(), heavy: s.heavyEffects ? 1 : 0, custom: frame.custom, quality })
    composite(iTime, ts.scrub, ts.scrubMix, frame.marks?.signalAge ?? 0)
    Object.assign(drawn, { x: pan.x, y: pan.y, time: iTime, w: target.width, h: target.height, held: paused, settings: s })
    if (!load.done)
      pollLoading(r)
    publishLive(ts, frame, d)
  }

  const frame = (manager: Pick<FrameLoopManager, 'deltaTime'>) => {
    if (!renderer)
      return

    if (resizeDue) {
      resizeDue = false
      resize()
    }

    const d = host.debug()
    const s = host.settings()
    if (d.t !== null)
      frozenFrame(renderer, d, s, d.t)
    else
      liveFrame(renderer, d, s, manager.deltaTime)
  }

  return {
    attach,
    frame,

    inputsChanged () {
      resizeDue = true
      governor.setTarget(host.settings().maxFrameRate || 60)
      applyDisplayFilter()
    },

    get paused () {
      return paused
    },

    begin () {
      started = true
    },

    togglePause () {
      paused = !paused
      host.onPaused(paused)
      host.audio()?.setPaused?.(paused)

      // A held frame draws nothing, so nothing else would tell the debug readout.
      if (host.debug().debug)
        publishDebugState(debugState())
    },

    act:     action => transport.request(action),
    skip:    seconds => transport.skip(seconds),
    scrub:   fraction => transport.scrub(fraction),
    release: () => transport.release(),
    debugState,
  }
}
