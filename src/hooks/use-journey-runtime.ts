'use client'

// The engine under every journey page: everything that is not markup.
//
// Given a journey definition it owns the WebGL context and the renderer, the
// simulation and its clock, the transport and the pause, the adaptive
// resolution governor, the CRT pass and the signal-loss caption, the loading
// state, and the one frame callback that ties them together.
// components/withJourneyShell is the view over it.
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
// Loading, stage by stage, as the bar shows it:
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

import { useCallback, useEffect, useRef, useState } from 'react'
import useFrameLoop from '✦/hooks/use-frame-loop'
import type { FrameLoopManager } from '@wjh/web/frameLoopManager'
import usePanControl from '✦/hooks/use-pan-control'
import useAudioEngine from '✦/hooks/use-audio-engine'
import type { AudioEngineHandle } from '✦/hooks/use-audio-engine'
import { useSettings } from '✦/components/SettingsProvider'
import { NO_DEBUG, publishDebugState, readDebugParams } from '@wjh/web/debugParams'
import type { DebugParams, JourneyDebugState } from '@wjh/web/debugParams'
import { CRT_BYPASS, CRT_DEFAULTS, createCrtPass } from '@wjh/gl/crtPass'
import { createContext } from '@wjh/gl/context'
import { takeGlFailure } from '@wjh/gl/program'
import type { CrtPass } from '@wjh/gl/crtPass'
import type { CustomUniforms, QualityHints } from '@wjh/gl/uniforms'
import { createJourneyTransport } from '@wjh/journey/transport'
import { evaluateFrame, hudLabel } from '@wjh/journey/frame'
import { seekSimulation } from '@wjh/journey/seek'
import type { JourneyAudioEngine, JourneyRenderer, JourneySimulation } from '@wjh/journey/types'
import type { JourneyDefinition } from '@wjh/journey/definition'
import type { JourneyTransport, TransportAction, TransportState } from '@wjh/journey/transport'
import { createGovernor } from '@wjh/quality/governor'
import { detectDevice } from '@wjh/quality/device'
import { qualityForTier, scaleRange } from '@wjh/quality/tiers'
import type { Governor } from '@wjh/quality/governor'
import { AUTO_RESOLUTION } from '@wjh/quality/settings'
import type { GraphicsSettings } from '@wjh/quality/settings'
import { signalLossAt } from '@wjh/journey/signalLoss'
import { createSignalOverlay } from '@wjh/journey/signalOverlay'
import type { SignalOverlay } from '@wjh/journey/signalOverlay'
import type { TransportHandle } from '✦/components/JourneyTransport'


const MAX_DPR       = 2 // Backing-store cap for the fixed resolution choices, as before AUTO.
const WARM_FRAMES   = 3 // Frames drawn at t = 0 once the assets are in, before the clock starts.
const ASSET_TIMEOUT = 20 // Seconds to wait on a renderer's assets before starting without them.
const PAN_EPSILON   = 1e-4 // Pan movement too small to be worth redrawing a paused frame for.

/**
 * Stand-in for journeys with no soundtrack. useAudioEngine has to be called
 * unconditionally (hook order) but only builds on the first unmute — which,
 * with no mute button rendered, never happens.
 */
const SILENT_ENGINE: JourneyAudioEngine = {
  toggleMute: () => true,
  destroy:    () => {}
}

/**
 * What the prerendered page shows, before any script has run.
 */
const LOADING_BOOT: JourneyLoading = {
  progress: 0.04,
  status:   'LOADING',
  done:     false,
  failed:   false,
}

/** The loading bar, as the runtime reports it. */
export interface JourneyLoading {
  progress: number; /** 0..1. */
  status:   string;
  done:     boolean; /** Everything is up and the clock is running: the bar can go. */
  failed:   boolean; /** The journey cannot run here; the bar stays, saying why. */
  detail?:  string; /** With `failed`: the compiler's own words, when it gave any. */
}


/** The section to announce, and a key that changes whenever it does. */
interface SectionAnnouncement {
  name: string;
  key:  number;
}

/**
 * Mirror a changing value into a ref. Render loops are registered once and
 * must not be re-created when settings change; they read through the ref.
 */
function useLatestRef<T> (value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [ value ])
  return ref
}

/** Fullscreen on the document element, and whether it is on right now. */
type UseFullscreenReturnType = { isFullscreen: boolean; toggle: () => void }

function useFullscreen (): UseFullscreenReturnType {
  const [ isFullscreen, setIsFullscreen ] = useState(false)

  // Followed rather than assumed: Esc, the browser's own UI and a phone's back
  // gesture all leave fullscreen without asking the button.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    sync()
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err)
      })
    else
      void document.exitFullscreen()
  }, [])

  return { isFullscreen, toggle }
}

export interface JourneyRuntime {
  dbg:       DebugParams;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;

  /** The transport bar, attached by the view; fed every frame. */
  transportRef: React.RefObject<TransportHandle | null>;

  /** The "W×H · N FPS" readout, attached by the view; written once a second. */
  statsRef: React.RefObject<HTMLElement | null>;

  /** The bar shown before the title card. */
  loading: JourneyLoading;

  /**
   * The section heading to show. Moves when the section changes in play or on
   * a jump — never mid-scrub, where the tape crosses sections by the dozen.
   */
  section: SectionAnnouncement;

  /** The clock is held; the frame stays up, and can still be looked around. */
  paused:      boolean;
  togglePause: () => void;

  audio:            AudioEngineHandle<JourneyAudioEngine>;
  fullscreen:       boolean;
  toggleFullscreen: () => void;

  act:     (action: TransportAction) => void;
  scrub:   (fraction: number) => void;
  release: () => void;

  /** Debug panel feed. */
  debugState: () => JourneyDebugState;
}

export function useJourneyRuntime (definition: JourneyDefinition): JourneyRuntime {
  const { settings } = useSettings()
  const settingsRef  = useLatestRef(settings)

  // Parsed on mount rather than during render: this is a static export, so the
  // prerender has no query string.
  const [ dbg, setDbg ] = useState<DebugParams>(NO_DEBUG)
  useEffect(() => setDbg(readDebugParams()), [])

  const dbgRef = useLatestRef(dbg)

  const [ section, setSection ] = useState<SectionAnnouncement>(() => ({ name: definition.sectionNameAt?.(0) ?? '', key: 0 }))
  const announcedRef            = useRef(section.name)

  const [ loading, setLoading ] = useState<JourneyLoading>(LOADING_BOOT)
  const loadRef                 = useRef({ shown: LOADING_BOOT, done: false, warm: 0, since: 0 })

  const [ paused, setPausedState ] = useState(false)
  const pausedRef                  = useRef(false)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const transportRef = useRef<TransportHandle | null>(null)
  const statsRef     = useRef<HTMLElement | null>(null)
  const rendererRef  = useRef<JourneyRenderer | null>(null)
  const crtRef       = useRef<CrtPass | null>(null)
  const overlayRef   = useRef<SignalOverlay | null>(null)
  const iTimeRef     = useRef(0)
  const seekedRef    = useRef<number | null>(null)
  const debugRef     = useRef<CustomUniforms>({})
  const labelRef     = useRef('')

  // Built lazily once per mount; StrictMode's mount/unmount/remount tears the
  // first instance down without an intervening render, so the effect below
  // rebuilds it too.
  const simRef = useRef<JourneySimulation | null>(null)
  if (definition.createSimulation && !simRef.current)
    simRef.current = definition.createSimulation()

  // Every journey pans the way the poolrooms always has: the view swings away
  // from the pointer sideways — pointer (or phone) to the right, and it turns
  // left — and follows it up and down. The shaders all look *toward* uPointer,
  // so the one inversion lives here rather than in each of them.
  const { pointerRef, updatePan } = usePanControl({
    gyroscope: settings.gyroscope,
    invertX:   true,
  })

  // An engine built while paused (the first unmute) starts out paused, so its
  // context is never resumed only to be suspended a moment later.
  const audio = useAudioEngine<JourneyAudioEngine>(() => {
    const engine = definition.createAudio?.() ?? SILENT_ENGINE
    engine.setPaused?.(pausedRef.current)
    return engine
  })
  const audioRef   = audio.engineRef
  const fullscreen = useFullscreen()

  // --- quality ---------------------------------------------------------------
  const device   = useRef(detectDevice()).current
  const quality  = useRef<QualityHints>(qualityForTier(device.tier)).current
  const governor = useRef<Governor | null>(null)
  if (!governor.current) {
    const range      = scaleRange(device)
    governor.current = createGovernor({ ...range, targetFps: settings.maxFrameRate || 60 })
  }
  useEffect(() => {
    governor.current?.setTarget(settings.maxFrameRate || 60)
  }, [ settings.maxFrameRate ])

  // --- transport -------------------------------------------------------------
  const transport = useRef<JourneyTransport | null>(null)
  if (!transport.current)
    transport.current = createJourneyTransport({
      createSimulation: () => definition.createSimulation?.() ?? null,
      adopt:            (sim, time) => {
        simRef.current?.dispose?.()
        simRef.current   = sim as JourneySimulation | null
        iTimeRef.current = time
      },
      current: () => ({ sim: simRef.current, time: iTimeRef.current }),
      marksAt: definition.marksAt,
      advance: dt => {
        iTimeRef.current += dt
        simRef.current?.step(dt, iTimeRef.current)
      },
    })

  // --- pause -----------------------------------------------------------------
  const togglePause = useCallback(() => {
    const next        = !pausedRef.current
    pausedRef.current = next
    setPausedState(next)
    audioRef.current?.setPaused?.(next)
  }, [ audioRef ])

  // --- loading ---------------------------------------------------------------
  /** Hand the bar a new state — whole percents only, React hears no more. */
  const report = useCallback((next: JourneyLoading) => {
    const l    = loadRef.current
    const prev = l.shown
    if (Math.round(next.progress * 100) === Math.round(prev.progress * 100) &&
      next.status === prev.status && next.done === prev.done && next.failed === prev.failed)
      return
    l.shown = next
    setLoading(next)
  }, [])

  /** Once per live frame until done: where the renderer's assets are. */
  const pollLoading = useCallback((renderer: JourneyRenderer) => {
    const l      = loadRef.current
    const ready  = renderer.ready?.() ?? true
    const waited = (performance.now() - l.since) / 1000

    if (!ready && waited < ASSET_TIMEOUT) {
      const p = renderer.progress?.() ?? 0
      report({ progress: 0.6 + 0.32 * p, status: 'LOADING TEXTURES', done: false, failed: false })
      return
    }
    if (!ready && l.warm === 0)
      console.warn(`${definition.slug}: assets still loading after ${ASSET_TIMEOUT}s; starting without them`)

    l.warm += 1
    if (l.warm < WARM_FRAMES) {
      report({ progress: 0.94, status: 'WARMING UP', done: false, failed: false })
      return
    }
    l.done = true
    report({ progress: 1, status: 'SIGNAL ACQUIRED', done: true, failed: false })
  }, [ report ])

  // --- resize ----------------------------------------------------------------
  // The canvas is laid out at the full viewport by CSS; this matches its
  // backing store to that box (times the render scale). A ResizeObserver only
  // marks it due and the next frame applies it, just before drawing: resizing
  // clears the canvas, and between a frame and its paint is the one moment a
  // cleared canvas would be seen.
  const sizeRef   = useRef({ w: 0, h: 0 })
  const resizeDue = useRef(true)
  const resize    = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const d = dbgRef.current
    let w: number
    let h: number
    if (d.w && d.h) {
      // An exact size beats everything: a screenshot compared against another
      // cannot be at the mercy of the window.
      w = d.w
      h = d.h
    }
    else {
      const res   = d.res ?? settingsRef.current.resolution
      const scale = res === AUTO_RESOLUTION
        ? governor.current!.scale
        : Math.min(window.devicePixelRatio || 1, MAX_DPR) * res
      w = Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth) * scale))
      h = Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight) * scale))
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w
      canvas.height = h
    }
    sizeRef.current = { w, h }
  }, [ dbgRef, settingsRef ])

  useEffect(() => {
    resizeDue.current = true
  }, [ settings.resolution, dbg.w, dbg.h, dbg.res ])

  // --- GL setup / teardown (once) --------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    let teardown: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const fail = (status: string) =>
      report({ progress: 0, status, done: false, failed: true, detail: takeGlFailure() ?? undefined })

    const setup = (): (() => void) | null => {
      // Read straight from the query string: this can run before `dbg` lands,
      // and context attributes cannot change afterwards. preserveDrawingBuffer
      // is what lets a driver read the frame back at all, and costs a copy per
      // frame — on only while something is debugging.
      const boot = readDebugParams()
      const spec = definition.renderer
      takeGlFailure()

      const gl   = createContext(canvas, spec.context, {
        ...spec.attributes,
        preserveDrawingBuffer: boot.debug || boot.t !== null,
      })
      if (!gl) {
        console.error(`${spec.context} not supported`)
        fail(`NO SIGNAL · ${spec.context.toUpperCase()} UNAVAILABLE`)
        return null
      }

      resize()

      const renderer      = spec.create(gl, canvas)
      rendererRef.current = renderer
      if (!renderer) {
        fail('NO SIGNAL · RENDERER FAILED')
        return null
      }

      // Failing to build the CRT pass is not fatal: the journey underneath is
      // a complete image on its own.
      crtRef.current     = createCrtPass(gl)
      overlayRef.current = createSignalOverlay()

      // A rebuild after a lost context is not a load: the bar is long gone.
      if (!loadRef.current.done) {
        loadRef.current.since = performance.now()
        report({ progress: 0.6, status: renderer.ready ? 'LOADING TEXTURES' : 'WARMING UP', done: false, failed: false })
      }

      const observer = new ResizeObserver(() => {
        resizeDue.current = true
      })
      observer.observe(canvas)

      return () => {
        observer.disconnect()
        crtRef.current?.dispose()
        crtRef.current = null
        overlayRef.current?.dispose()
        overlayRef.current = null
        renderer.dispose()
        rendererRef.current = null
        // NOTE: never WEBGL_lose_context here. A canvas hands back the same
        // context on every getContext(), so losing it would poison the next
        // mount (StrictMode/HMR reuse the canvas) and every compile after it
        // would fail with a null info log.
      }
    }

    // Say what is about to happen, and let it be painted before doing it: the
    // compile blocks the main thread, and a bar that sat at "loading" through
    // it would read as a hang. rAF then a task is "after the next paint".
    report({ progress: 0.15, status: 'COMPILING SHADERS', done: false, failed: false })

    const raf = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        teardown = setup()
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
      teardown = setup()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      teardown?.()
    }
  }, [])

  // Simulation lifetime (see simRef).
  useEffect(() => {
    if (definition.createSimulation && !simRef.current)
      simRef.current = definition.createSimulation()
    return () => {
      simRef.current?.dispose?.()
      simRef.current = null
    }
  }, [])

  // The display grade rides on the CRT pass; the canvas only falls back to a
  // CSS filter — a full-screen compositing pass per frame — if that pass could
  // not be built and the grade is not the identity.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const graded        = settings.brightness !== 1 || settings.contrast !== 1
    canvas.style.filter = !crtRef.current && graded
      ? `brightness(${settings.brightness}) contrast(${settings.contrast})`
      : ''
  }, [ settings.brightness, settings.contrast, loading.done ])

  // --- per-frame helpers -----------------------------------------------------
  const announce = useCallback((label: string) => {
    if (label === announcedRef.current)
      return
    announcedRef.current = label
    setSection(s => ({ name: label, key: s.key + 1 }))
  }, [])

  /** The CRT treatment and the display grade, over what the renderer drew. */
  const composite = useCallback((time: number, scrub: number, scrubMix: number, signalAge: number) => {
    const crt = crtRef.current
    if (!crt)
      return

    const s      = settingsRef.current
    const loss   = signalLossAt(signalAge)
    const graded = s.brightness !== 1 || s.contrast !== 1

    // The CRT setting governs the *display treatment*, not whether the story
    // beat happens: once the signal is going, the pass runs either way.
    if (!s.crt && !graded && loss.level <= 0.001 && scrubMix <= 0)
      return

    const canvas  = canvasRef.current
    const overlay = overlayRef.current
    if (overlay && canvas && overlay.update(loss, canvas.width, canvas.height))
      crt.setOverlay(loss.level > 0.001 ? overlay.canvas : null)

    crt.draw({
      time,
      ...s.crt ? CRT_DEFAULTS : CRT_BYPASS,
      scrub,
      scrubMix,
      signal:     loss.level,
      brightness: s.brightness,
      contrast:   s.contrast,
    })
  }, [ settingsRef ])

  // FPS readout, written straight into the element once a second.
  const fps        = useRef({ frames: 0, since: 0, value: 0 })
  const countFrame = useCallback(() => {
    const f   = fps.current
    const now = performance.now()
    f.frames += 1
    if (f.since === 0)
      f.since = now
    if (now - f.since >= 1000) {
      f.value  = Math.round(f.frames * 1000 / (now - f.since))
      f.frames = 0
      f.since  = now
      if (statsRef.current)
        statsRef.current.textContent = `${sizeRef.current.w}×${sizeRef.current.h} · ${f.value} FPS`
    }
  }, [])

  const debugState = useCallback((): JourneyDebugState => ({
    journey:  definition.slug,
    time:     iTimeRef.current,
    label:    labelRef.current,
    seeking:  dbgRef.current.t !== null,
    ready:    rendererRef.current?.ready?.() ?? true,
    width:    sizeRef.current.w,
    height:   sizeRef.current.h,
    fps:      fps.current.value,
    uniforms: debugRef.current,
  }), [ dbgRef ])

  // What the last live frame was drawn with — a paused frame that would come
  // out the same is not drawn again.
  const drawnRef = useRef({ x: NaN, y: NaN, time: NaN, w: 0, h: 0, held: false, settings: null as GraphicsSettings | null })

  // --- the frame ---------------------------------------------------------------
  const onFrame = useCallback((manager: FrameLoopManager) => {
    const renderer = rendererRef.current
    if (!renderer)
      return

    if (resizeDue.current) {
      resizeDue.current = false
      resize()
    }

    const d   = dbgRef.current
    const sim = simRef.current
    const s   = settingsRef.current

    if (d.t !== null) {
      if (seekedRef.current !== d.t) {
        seekSimulation(sim, d.t, d.dt)
        iTimeRef.current  = d.t
        seekedRef.current = d.t
      }
      if (d.pointer)
        pointerRef.current = { x: d.pointer[0], y: d.pointer[1] }

      const frame = evaluateFrame(definition, sim, d.t)
      renderer.draw({ time: d.t, pointer: pointerRef.current, heavy: s.heavyEffects ? 1 : 0, custom: frame.custom })
      composite(d.t, 0, 0, frame.marks?.signalAge ?? 0)

      debugRef.current = frame.custom ?? {}
      labelRef.current = hudLabel(frame.label, frame.detail)
      countFrame()
      if (!loadRef.current.done)
        pollLoading(renderer)

      // Published after draw() returns: "the seeked frame is on the canvas".
      publishDebugState({ ...debugState(), seeking: true, ready: renderer.ready?.() ?? true })
      return
    }

    const loaded = loadRef.current.done
    const held   = pausedRef.current
    const tr     = transport.current!

    // Log where we are *before* moving, so every boundary ever crossed has a
    // recorded time to go back to.
    tr.observe(iTimeRef.current, sim?.marks?.() ?? definition.marksAt?.(iTimeRef.current) ?? null)

    const ts: TransportState = tr.tick(manager.deltaTime)
    const moving             = ts.mode !== 'play'

    // Input is tweened on the real delta — the speed setting must not change
    // how the camera feels to move.
    const pan = updatePan(manager.deltaTime)

    // The clock runs once everything is up, and not while paused. Jumps and
    // scrubs move it either way: those are the transport's own moves, made
    // inside tick() and request().
    if (loaded && !held && ts.mode !== 'scrub') {
      const dt = manager.deltaTime * s.speed
      iTimeRef.current += dt
      // Step before the draw, so the frame shows the state just integrated.
      simRef.current?.step(dt, iTimeRef.current)
    }

    const canvas = canvasRef.current!
    const drawn  = drawnRef.current
    if (held && loaded && !moving && ts.scrubMix === 0 && drawn.held &&
      drawn.time === iTimeRef.current && drawn.settings === s &&
      drawn.w === canvas.width && drawn.h === canvas.height &&
      Math.abs(drawn.x - pan.x) < PAN_EPSILON && Math.abs(drawn.y - pan.y) < PAN_EPSILON) {
      // Paused and nothing has moved: the last frame is still on the canvas
      // (an undrawn frame is not cleared), and the GPU gets to rest.
      countFrame()
      return
    }

    // Resolution follows the frame rate, when it is the governor's to decide —
    // from frames that are actually being made, so neither the load's hitches
    // nor a paused frame's idling skews it.
    if (loaded && !held && s.resolution === AUTO_RESOLUTION && d.res === null && !(d.w && d.h) &&
      governor.current!.sample(manager.deltaTime))
      resize()

    const liveSim = simRef.current
    const frame   = evaluateFrame(definition, liveSim, iTimeRef.current)

    // A tape has no audio at speed, and a rewound clock makes a graph click.
    if (!moving && !held)
      audioRef.current?.update?.(iTimeRef.current, frame.custom)

    renderer.draw({
      time:    iTimeRef.current,
      pointer: pointerRef.current,
      heavy:   s.heavyEffects ? 1 : 0,
      custom:  frame.custom,
      quality,
    })
    composite(iTimeRef.current, ts.scrub, ts.scrubMix, frame.marks?.signalAge ?? 0)
    drawn.x        = pan.x
    drawn.y        = pan.y
    drawn.time     = iTimeRef.current
    drawn.w        = canvas.width
    drawn.h        = canvas.height
    drawn.held     = held
    drawn.settings = s

    if (!loaded)
      pollLoading(renderer)

    debugRef.current = frame.custom ?? {}
    labelRef.current = hudLabel(frame.label, frame.detail)
    if (ts.mode !== 'scrub')
      announce(frame.label)

    transportRef.current?.update({
      mode:         ts.mode,
      paused:       held,
      loop:         frame.marks?.loop ?? 0,
      section:      frame.marks?.section ?? 0,
      sectionCount: frame.marks?.sectionCount ?? 1,
      progress:     frame.marks?.progress ?? 0,
      time:         iTimeRef.current,
      label:        labelRef.current,
      hasMarks:     frame.marks !== null,
    })

    countFrame()
    if (d.debug)
      publishDebugState(debugState())
  }, [ announce, audioRef, composite, countFrame, dbgRef, debugState, pointerRef, pollLoading, quality, resize, settingsRef, updatePan ])
  useFrameLoop(onFrame)

  const act     = useCallback((action: TransportAction) => transport.current?.request(action), [])
  const scrub   = useCallback((fraction: number) => transport.current?.scrub(fraction), [])
  const release = useCallback(() => transport.current?.release(), [])

  return {
    dbg,
    canvasRef,
    transportRef,
    statsRef,
    loading,
    section,
    paused,
    togglePause,
    audio,
    fullscreen:       fullscreen.isFullscreen,
    toggleFullscreen: fullscreen.toggle,
    act,
    scrub,
    release,
    debugState,
  }
}

/** For callers that only need the settings type alongside the runtime. */

