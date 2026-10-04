'use client'

// The engine under every journey page: everything that is not markup.
//
// Given a journey definition it owns the WebGL context and the renderer, the
// simulation and its clock, the transport, the adaptive resolution governor,
// the CRT pass and the signal-loss caption, and the one frame callback that
// ties them together. components/withJourneyShell is the view over it.
//
// Two paths through the frame:
//
//   live    — the transport observes and may move the clock; the simulation
//             steps on the speed-scaled delta; the governor watches real frame
//             times and moves the render scale; audio follows the uniforms.
//   frozen  — `?t=`: seek once, then redraw that instant every frame. No
//             integration, no pan tween, no audio, no governor: the frame is a
//             pure function of the URL, which is the whole contract a
//             screenshot driver relies on.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFrameLoop } from '✦/lib/frameLoopManager'
import type { FrameLoopManager } from '✦/lib/frameLoopManager'
import usePanControl from '✦/hooks/use-pan-control'
import useAudioEngine from '✦/hooks/use-audio-engine'
import type { AudioEngineHandle } from '✦/hooks/use-audio-engine'
import { useSettings } from '✦/components/SettingsProvider'
import { NO_DEBUG, publishDebugState, readDebugParams } from '✦/lib/debugParams'
import type { DebugParams, JourneyDebugState } from '✦/lib/debugParams'
import { CRT_BYPASS, CRT_DEFAULTS, createContext, createCrtPass } from '✦/lib/gl'
import type { CrtPass, CustomUniforms, QualityHints } from '✦/lib/gl'
import { createJourneyTransport, evaluateFrame, hudLabel, seekSimulation } from '✦/lib/journey'
import type {
  JourneyAudioEngine,
  JourneyDefinition,
  JourneyRenderer,
  JourneySimulation,
  JourneyTransport,
  TransportAction,
  TransportState
} from '✦/lib/journey'
import { createGovernor, detectDevice, qualityForTier, scaleRange } from '✦/lib/quality'
import type { Governor } from '✦/lib/quality'
import { AUTO_RESOLUTION } from '✦/lib/settings'
import type { GraphicsSettings } from '✦/lib/settings'
import { signalLossAt } from '✦/lib/signalLoss'
import { createSignalOverlay } from '✦/lib/signalOverlay'
import type { SignalOverlay } from '✦/lib/signalOverlay'
import type { TransportHandle } from '✦/components/JourneyTransport'


/** Backing-store cap for the fixed resolution choices, as before AUTO. */
const MAX_DPR = 2

/**
 * Stand-in for journeys with no soundtrack. useAudioEngine has to be called
 * unconditionally (hook order) but only builds on the first unmute — which,
 * with no mute button rendered, never happens.
 */
const SILENT_ENGINE: JourneyAudioEngine = { toggleMute: () => true, destroy: () => {} }

/**
 * Mirror a changing value into a ref. Render loops are registered once and
 * must not be re-created when settings change; they read through the ref.
 */
export function useLatestRef<T> (value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [ value ])
  return ref
}

/** Toggle fullscreen on the document element. */
export function useFullscreenToggle (): () => void {
  return useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err)
      })
    else
      void document.exitFullscreen()
  }, [])
}

export interface JourneyRuntime {
  dbg:       DebugParams;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;

  /** The transport bar, attached by the view; fed every frame. */
  transportRef: React.RefObject<TransportHandle | null>;

  /** The "W×H · N FPS" readout, attached by the view; written once a second. */
  statsRef: React.RefObject<HTMLElement | null>;

  /** Section title and a key that changes whenever it does (re-runs its CSS). */
  sectionName: string;
  sectionKey:  number;

  audio:            AudioEngineHandle<JourneyAudioEngine>;
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

  const [ sectionName, setSectionName ] = useState(() => definition.sectionNameAt?.(0) ?? '')
  const [ sectionKey, setSectionKey ]   = useState(0)
  const sectionRef                      = useRef(sectionName)

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

  const { pointerRef, updatePan } = usePanControl({
    gyroscope: settings.gyroscope,
    invertX:   definition.invertPanX,
  })
  const audio            = useAudioEngine<JourneyAudioEngine>(() => definition.createAudio?.() ?? SILENT_ENGINE)
  const audioRef         = audio.engineRef
  const toggleFullscreen = useFullscreenToggle()

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

  // --- resize ----------------------------------------------------------------
  const sizeRef = useRef({ w: 0, h: 0 })
  const resize  = useCallback(() => {
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
      w = Math.max(1, Math.floor(window.innerWidth * scale))
      h = Math.max(1, Math.floor(window.innerHeight * scale))
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w
      canvas.height = h
    }
    sizeRef.current = { w, h }
  }, [ dbgRef, settingsRef ])

  useEffect(resize, [ resize, settings.resolution, dbg.w, dbg.h, dbg.res ])

  // --- GL setup / teardown (once) --------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    // Read straight from the query string: this runs a render before `dbg`
    // lands, and context attributes cannot change afterwards.
    // preserveDrawingBuffer is what lets a driver read the frame back at all,
    // and costs a copy per frame — on only while something is debugging.
    const boot = readDebugParams()
    const spec = definition.renderer
    const gl   = createContext(canvas, spec.context, {
      ...spec.attributes,
      preserveDrawingBuffer: boot.debug || boot.t !== null,
    })
    if (!gl) {
      console.error(`${spec.context} not supported`)
      return
    }

    resize()

    const renderer      = spec.create(gl, canvas)
    rendererRef.current = renderer
    if (!renderer)
      return

    // Failing to build the CRT pass is not fatal: the journey underneath is a
    // complete image on its own.
    crtRef.current     = createCrtPass(gl)
    overlayRef.current = createSignalOverlay()

    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
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
  }, [ settings.brightness, settings.contrast ])

  // --- per-frame helpers -----------------------------------------------------
  const setSection = useCallback((label: string, animate: boolean) => {
    if (label === sectionRef.current)
      return
    sectionRef.current = label
    setSectionName(label)
    if (animate)
      setSectionKey(k => k + 1)
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

  // --- the frame ---------------------------------------------------------------
  const onFrame = useCallback((manager: FrameLoopManager) => {
    const renderer = rendererRef.current
    if (!renderer)
      return

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
      setSection(frame.label, false)
      countFrame()

      // Published after draw() returns: "the seeked frame is on the canvas".
      publishDebugState({ ...debugState(), seeking: true, ready: renderer.ready?.() ?? true })
      return
    }

    const tr = transport.current!

    // Log where we are *before* moving, so every boundary ever crossed has a
    // recorded time to go back to.
    tr.observe(iTimeRef.current, sim?.marks?.() ?? definition.marksAt?.(iTimeRef.current) ?? null)

    const ts: TransportState = tr.tick(manager.deltaTime)
    const moving             = ts.mode !== 'play'

    // Input is tweened on the real delta — the speed setting must not change
    // how the camera feels to move.
    updatePan(manager.deltaTime)

    if (ts.mode !== 'scrub') {
      const dt = manager.deltaTime * s.speed
      iTimeRef.current += dt
      // Step before the draw, so the frame shows the state just integrated.
      simRef.current?.step(dt, iTimeRef.current)
    }

    // Resolution follows the frame rate, when it is the governor's to decide.
    if (s.resolution === AUTO_RESOLUTION && d.res === null && !(d.w && d.h) &&
      governor.current!.sample(manager.deltaTime))
      resize()

    const liveSim = simRef.current
    const frame   = evaluateFrame(definition, liveSim, iTimeRef.current)

    // A tape has no audio at speed, and a rewound clock makes a graph click.
    if (!moving)
      audioRef.current?.update?.(iTimeRef.current, frame.custom)

    renderer.draw({
      time:    iTimeRef.current,
      pointer: pointerRef.current,
      heavy:   s.heavyEffects ? 1 : 0,
      custom:  frame.custom,
      quality,
    })
    composite(iTimeRef.current, ts.scrub, ts.scrubMix, frame.marks?.signalAge ?? 0)

    debugRef.current = frame.custom ?? {}
    labelRef.current = hudLabel(frame.label, frame.detail)
    setSection(frame.label, true)

    transportRef.current?.update({
      mode:         ts.mode,
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
  }, [ audioRef, composite, countFrame, dbgRef, debugState, pointerRef, quality, resize, setSection, settingsRef, updatePan ])
  useFrameLoop(onFrame)

  const act     = useCallback((action: TransportAction) => transport.current?.request(action), [])
  const scrub   = useCallback((fraction: number) => transport.current?.scrub(fraction), [])
  const release = useCallback(() => transport.current?.release(), [])

  return {
    dbg,
    canvasRef,
    transportRef,
    statsRef,
    sectionName,
    sectionKey,
    audio,
    toggleFullscreen,
    act,
    scrub,
    release,
    debugState,
  }
}

/** For callers that only need the settings type alongside the runtime. */
export type { GraphicsSettings }
