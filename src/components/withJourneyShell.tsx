'use client'

// withJourneyShell(createRenderer) — the pluggable journey template.
//
// A higher-order component that turns *any* per-frame renderer into a full
// journey route. It owns all the boilerplate that used to be copy-pasted into
// every journey page (context, resize, pointer, cleanup) and wires in the global
// graphics settings:
//   • resolution  → canvas backing-store scale
//   • speed       → iTime accumulation rate
//   • brightness  → CSS filter on the canvas
//   • contrast    → CSS filter on the canvas
//   • maxFrameRate→ honored globally by the shared frameLoopManager
//   • gyroscope   → device-orientation contribution to camera panning
//
// It is also where the debug query parameters are honoured (see lib/debugParams),
// which is the point of putting them here: every journey routes through this one
// component, so ?t=/?debug=/?w= work on all of them without any journey knowing
// they exist.
//
// Rendering runs on the shared, frame-capped loop (lib/frameLoopManager, vendored
// from @tuomashatakka/canvas-loop-framecapper) via useFrameLoop, so every
// templated journey shares one rAF and one FPS cap.
//
// A renderer is anything with { draw(uniforms), dispose() }. lib/shaderQuad's
// ShaderQuad already satisfies that, which is why withShaderJourney is now a
// five-line wrapper around this file rather than a copy of it. A rasterized
// journey asks for contextType 'webgl2' and hands over its own scene object
// instead — see components/withGeometryJourney.
//
// Usage (a journey page is still three lines):
//   'use client';
//   import { withShaderJourney } from '@/components/withShaderJourney';
//   import { skybridgesFrag } from './shader';
//   export default withShaderJourney(skybridgesFrag);

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { CustomUniforms, QuadFrameUniforms } from '@/lib/shaderQuad'
import { useFrameLoop } from '@/lib/frameLoopManager'
import usePanControl from '@/hooks/use-pan-control'
import useAudioEngine from '@/hooks/use-audio-engine'
import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import {
  useDisplayFilter,
  useFpsMeter,
  useFullscreenToggle,
  useLatestRef,
  useResolutionResize

} from '@/hooks/use-journey-runtime'
import { useSettings } from './SettingsProvider'
import SettingsButton from './SettingsButton'
import JourneyDebugPanel from './JourneyDebugPanel'
import { NO_DEBUG, publishDebugState, readDebugParams, seekSimulation } from '@/lib/debugParams'
import type { DebugParams } from '@/lib/debugParams'
import { CRT_BYPASS, CRT_DEFAULTS, createCrtPass } from '@/lib/crtPass'
import type { CrtPass } from '@/lib/crtPass'
import { signalLossAt } from '@/lib/signalLoss'
import { createSignalOverlay } from '@/lib/signalOverlay'
import type { SignalOverlay } from '@/lib/signalOverlay'
import { createJourneyTransport } from '@/lib/journeyTransport'
import type { JourneyMarks, JourneyTransport as Transport, TransportState } from '@/lib/journeyTransport'
import JourneyTransport from './JourneyTransport'
import type { TransportView } from './JourneyTransport'


const MAX_DPR = 2

// Stand-in for journeys with no soundtrack. useAudioEngine has to be called
// unconditionally (hook order), but it only invokes the factory on the first
// unmute — which, with no #audio-btn rendered, never happens. So this is never
// actually constructed; it exists to keep `toggle` total.
const SILENT_ENGINE: JourneyAudioEngine = { toggleMute: () => true, destroy: () => {} }

/**
 * A CPU-side simulation driving a journey's shader. Journeys whose motion is
 * authored as easing curves in GLSL don't need one; journeys that actually
 * integrate physics (see app/journeys/foundry) implement this and return the
 * integrated state as uniforms.
 *
 * `step` receives the settings-scaled delta — the same time base that feeds
 * iTime — so the speed control slows the simulation and the shader together.
 */
/** Title plus the live detail, the way the transport bar shows them. */
function hudLabel (label: string, detail?: string): string {
  return detail ? `${label} · ${detail}` : label
}

export interface JourneySimulation {

  /** Advance by `dt` seconds. `time` is the accumulated shader time. */
  step(dt: number, time: number): void;

  /** State for this frame, uploaded verbatim to the shader. */
  uniforms(): CustomUniforms;

  /** Optional HUD section label derived from simulation state, not time. */
  label?(): string;

  /**
   * Optional live detail (speed, altitude) shown after the label in the
   * transport bar only. Kept out of `label` so the section title does not
   * re-animate every time the number changes.
   */
  detail?(): string;

  /**
   * Optional structural position — which lap, which section, how far through.
   * Implementing it is what makes the transport controls move by *structure*
   * rather than by the clock; see lib/journeyTransport.
   */
  marks?(): JourneyMarks;

  /** Optional teardown for anything the simulation allocated. */
  dispose?(): void;
}

/**
 * Anything that can put one frame on the canvas. ShaderQuad satisfies this
 * structurally, so the shader path needs no adapter at all; a geometry journey
 * returns its own scene object with the same two methods.
 */
export interface JourneyRenderer {

  /** Render one frame at the canvas's current pixel size. */
  draw(uniforms: QuadFrameUniforms): void;

  /** Release every GL resource the renderer owns. */
  dispose(): void;
}

/**
 * Built once per mount, after the context exists and before the first resize.
 * Returning null means "it could not be built" — the shell then leaves the
 * canvas blank rather than throwing, exactly as a failed compile always has.
 */
export type JourneyRendererFactory = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
) => JourneyRenderer | null

export interface ShaderJourneyOptions {

  /** Optional accent color, exposed as the `--accent` CSS var on the container. */
  accent?: string;

  /** Optional timeline label, evaluated from the same accumulated shader time as iTime. */
  getSectionName?: (time: number) => string;

  /** Optional class for journey-specific section-title typography. */
  sectionTitleClassName?: string;

  /** Optional equirectangular environment map URL (sampled as `uEnv` for IBL/refraction). */
  envMapUrl?: string;

  /**
   * Optional per-mount CPU simulation. Instantiated on mount (never shared
   * between mounts, so remounting restarts the physics), stepped once per
   * capped frame before the draw, and disposed with the GL resources. When it
   * provides a `label`, that takes precedence over `getSectionName`.
   */
  createSimulation?: () => JourneySimulation;

  /**
   * Structural position for a journey whose motion is authored in GLSL and has
   * no simulation at all (skybridges). Same contract as JourneySimulation.marks,
   * evaluated from the accumulated shader time rather than integrated state.
   * Ignored when a simulation supplies marks of its own.
   */
  getMarks?: (time: number) => JourneyMarks;

  /**
   * Optional per-mount audio engine. Built lazily on the first unmute (an
   * AudioContext may only start from a user gesture) and destroyed with the
   * component. Passing this is what renders the mute button — journeys without
   * a soundtrack get no #audio-btn and never touch Web Audio.
   *
   * When the journey also has a simulation, the engine's optional `update` is
   * fed the same uniforms the shader is drawn with, so sound and geometry stay
   * on one clock.
   */
  createAudioEngine?: () => JourneyAudioEngine;
}

export interface JourneyShellOptions extends ShaderJourneyOptions {

  /**
   * Which context to request. Defaults to 'webgl': every SDF journey here is
   * written against GLSL ES 1.00, and asking for a WebGL2 context would change
   * what their shaders compile against for no gain. A rasterized journey wants
   * 'webgl2' — for vertex array objects, instanced draws and blitFramebuffer.
   */
  contextType?: 'webgl' | 'webgl2';

  /**
   * Merged over the shell's defaults, which are tuned for a full-screen quad
   * (no depth, no antialias). A geometry journey passes { depth: true }.
   * preserveDrawingBuffer is deliberately not overridable — a screenshot driver
   * depends on the debug rule below.
   */
  contextAttributes?: WebGLContextAttributes;
}

export function withJourneyShell (
  createRenderer: JourneyRendererFactory,
  options: JourneyShellOptions = {},
) {
  function JourneyShell () {
    const { settings } = useSettings()

    // Parsed once on mount rather than during render: this is a static export,
    // so the prerender has no query string and reading location during render
    // would disagree with the server's HTML.
    const [ dbg, setDbg ]                 = useState<DebugParams>(NO_DEBUG)
    const [ journeyName, setJourneyName ] = useState('')
    useEffect(() => {
      setDbg(readDebugParams())
      setJourneyName(window.location.pathname.split('/').filter(Boolean)
        .pop() ?? '')
    }, [])

    const dbgRef = useLatestRef(dbg)

    // Cleared whenever the seek target changes, so editing ?t= in the address
    // bar re-seeks instead of holding the old frame.
    const seekedRef     = useRef<number | null>(null)
    const debugStateRef = useRef<Record<string, number | number[]>>({})

    // Bottom-right HUD: render resolution (backing-store px) + measured FPS.
    const { fps, renderRes, setRenderRes, sampleFrame } = useFpsMeter()

    const [ sectionName, setSectionName ] = useState(
      () => options.getSectionName?.(0) ?? '',
    )
    const [ sectionGlitchKey, setSectionGlitchKey ] = useState(0)

    const toggleFullscreen = useFullscreenToggle()

    const canvasRef   = useRef<HTMLCanvasElement>(null)
    const rendererRef = useRef<JourneyRenderer | null>(null)
    const crtRef      = useRef<CrtPass | null>(null)
    const overlayRef  = useRef<SignalOverlay | null>(null)
    // Lazily built once per mount; useRef's initializer would run on every
    // render, so guard it instead of calling createSimulation() inline.
    const simRef = useRef<JourneySimulation | null>(null)
    if (options.createSimulation && !simRef.current)
      simRef.current = options.createSimulation()

    // Pointer + gyroscope panning, tweened across sudden jumps (see lib/panControl).
    const { pointerRef, updatePan } = usePanControl({ gyroscope: settings.gyroscope })

    // Lazily built on first unmute; a no-op engine stands in when the journey is silent.
    const audio = useAudioEngine(() => options.createAudioEngine?.() ?? SILENT_ENGINE)

    const audioRef       = audio.engineRef
    const iTimeRef       = useRef(0)
    const sectionNameRef = useRef(sectionName)
    const fpsRef         = useLatestRef(fps)

    // Latest settings for the (stable) frame callback + resize, without re-registering.
    const settingsRef = useLatestRef(settings)

    // --- transport ---
    // The host is four closures over the refs above: the transport owns the
    // *policy* (which t to move to) and nothing else, so it stays testable and
    // the shell keeps sole ownership of the live simulation and clock.
    const transportRef = useRef<Transport | null>(null)
    if (!transportRef.current)
      transportRef.current = createJourneyTransport({
        createSimulation: () => options.createSimulation?.() ?? null,

        adopt: (sim, time) => {
          simRef.current?.dispose?.()
          simRef.current   = (sim as JourneySimulation | null)
          iTimeRef.current = time
        },

        current: () => ({ sim: simRef.current, time: iTimeRef.current }),

        marksAt: options.getMarks,

        advance: dt => {
          iTimeRef.current += dt
          simRef.current?.step(dt, iTimeRef.current)
        },
      })

    // Written every frame, sampled by the transport bar on its own slow
    // interval — same reasoning as JourneyDebugPanel.
    const transportViewRef = useRef<TransportView>({
      mode:         'play',
      loop:         0,
      section:      0,
      sectionCount: 1,
      progress:     0,
      time:         0,
      label:        '',
      hasMarks:     false,
    })

    // Resize is stored here so the resolution setting can re-trigger it. Keyed
    // on the debug overrides too, since those arrive one render after mount.
    const resizeRef = useResolutionResize(
      `${settings.resolution}:${dbg.w}:${dbg.h}:${dbg.res}`,
    )

    // --- GL setup / teardown (once) ---
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas)
        return

      // Read straight from the query string rather than from `dbg` state: this
      // effect runs on mount, one render before the state lands, and context
      // attributes cannot be changed afterwards.
      //
      // preserveDrawingBuffer is what lets a driver read the frame back at all
      // (readPixels and toDataURL both return an empty buffer once the compositor
      // has taken it otherwise). It costs a copy per frame, so it is on only when
      // something is actually debugging.
      const boot = readDebugParams()
      const type = options.contextType ?? 'webgl'
      const gl   = canvas.getContext(type, {
        antialias:             false,
        depth:                 false,
        alpha:                 false,
        ...options.contextAttributes,
        preserveDrawingBuffer: boot.debug || boot.t !== null,
      }) as WebGLRenderingContext | WebGL2RenderingContext | null
      if (!gl) {
        console.error(`${type} not supported`)
        return
      }

      const renderer      = createRenderer(gl, canvas)
      rendererRef.current = renderer
      if (!renderer)
        return // could not be built — leave the canvas blank

      // Failing to build the CRT pass is not fatal: the journey underneath is
      // a complete image on its own, so a null pass just means no treatment.
      crtRef.current     = createCrtPass(gl)
      overlayRef.current = createSignalOverlay()

      const resize = () => {
        const d = dbgRef.current

        // An exact size beats everything else: a screenshot that has to be
        // compared against another one cannot be at the mercy of the window.
        if (d.w && d.h) {
          canvas.width  = d.w
          canvas.height = d.h
          setRenderRes({ w: canvas.width, h: canvas.height })
          return
        }

        const dpr     = Math.min(window.devicePixelRatio || 1, MAX_DPR)
        const scale   = dpr * (d.res ?? settingsRef.current.resolution)
        canvas.width  = Math.max(1, Math.floor(window.innerWidth * scale))
        canvas.height = Math.max(1, Math.floor(window.innerHeight * scale))
        setRenderRes({ w: canvas.width, h: canvas.height })
      }
      resizeRef.current = resize

      window.addEventListener('resize', resize)
      resize()

      return () => {
        window.removeEventListener('resize', resize)
        crtRef.current?.dispose()
        crtRef.current = null
        overlayRef.current?.dispose()
        overlayRef.current = null
        renderer.dispose()
        rendererRef.current = null
        // NOTE: do NOT call WEBGL_lose_context.loseContext() here. A canvas
        // hands back the same context on every getContext() call, so losing it
        // would poison the next mount (StrictMode/HMR reuse the same canvas
        // node) — the re-acquired context is already lost and every shader
        // compile fails with a null info log. The context is freed when the
        // canvas node is removed on real unmount.
      }
    }, [])

    // Simulation lifetime. Re-created here as well as at render time because
    // StrictMode's mount/unmount/remount cycle tears the first instance down
    // without an intervening render.
    useEffect(() => {
      if (options.createSimulation && !simRef.current)
        simRef.current = options.createSimulation()
      return () => {
        simRef.current?.dispose?.()
        simRef.current = null
      }
    }, [])

    // Brightness + contrast as a CSS filter (works for any shader, no uniforms needed).
    useDisplayFilter(canvasRef, settings)

    // One draw per (capped) frame, on the shared loop. Stable callback reading refs.
    type ManagerType = { deltaTime: number }

    /**
     * Composite the CRT treatment over the frame the renderer just presented.
     * Runs after draw() and reads the back buffer, so no renderer has to know
     * it exists — see lib/crtPass for why it is done that way round.
     */
    const applyCrt = useCallback((
      time: number,
      scrub: number,
      scrubMix: number,
      signalAge: number,
    ) => {
      const crt = crtRef.current
      if (!crt)
        return

      const loss = signalLossAt(signalAge)
      const tube = settingsRef.current.crt

      // The CRT setting governs the *display treatment*, not whether the story
      // beat happens — so once the signal is going the pass runs either way, and
      // the setting only decides whether there is a tube around it.
      if (!tube && loss.level <= 0.001)
        return

      const canvas  = canvasRef.current
      const overlay = overlayRef.current
      if (overlay && canvas && overlay.update(loss, canvas.width, canvas.height))
        crt.setOverlay(loss.level > 0.001 ? overlay.canvas : null)

      crt.draw({
        time,
        ...tube ? CRT_DEFAULTS : CRT_BYPASS,
        scrub,
        scrubMix,
        signal: loss.level,
      })
    }, [ settingsRef ])

    // The ?t= path: seek once, then redraw the same instant every frame. Split
    // out of onFrame because it shares nothing with the live path but the draw
    // call — it does not integrate, does not tween the pan, and does not touch
    // the audio, which has no meaning at a standstill.
    const drawFrozen = useCallback((
      d: DebugParams,
      sim: JourneySimulation | null,
      renderer: JourneyRenderer,
    ) => {
      if (seekedRef.current !== d.t) {
        seekSimulation(sim, d.t!, d.dt)
        iTimeRef.current  = d.t!
        seekedRef.current = d.t
      }

      if (d.pointer)
        pointerRef.current = { x: d.pointer[0], y: d.pointer[1] }

      // The seeked frame carries the caption too, or every screenshot of an
      // ending would be of a journey that is somehow still receiving — and it
      // carries uSignalLoss for the same reason. Read *before* the draw: a
      // journey whose world reacts to the failing signal (skybridges' sun) would
      // otherwise render the moment before the event at every ?t= after it, and
      // the seek would silently disagree with the live run.
      const frozenMarks = sim?.marks?.() ?? options.getMarks?.(d.t!) ?? null

      let custom = sim?.uniforms()
      if (frozenMarks?.signalAge)
        (custom ??= {}).uSignalLoss = signalLossAt(frozenMarks.signalAge).level

      renderer.draw({
        time:    d.t!,
        pointer: pointerRef.current,
        heavy:   settingsRef.current.heavyEffects ? 1 : 0,
        custom,
      })

      applyCrt(d.t!, 0, 0, frozenMarks?.signalAge ?? 0)

      if (custom)
        debugStateRef.current = custom

      const label = sim?.label?.() ?? options.getSectionName?.(d.t!) ?? ''
      if (label !== sectionNameRef.current) {
        sectionNameRef.current = label
        setSectionName(label)
      }
      transportViewRef.current.label = hudLabel(label, sim?.detail?.())

      sampleFrame()

      // Published only after draw() has returned, so the flag a driver waits on
      // means "the seeked frame is on the canvas", not "the seek finished".
      publishDebugState({
        journey:  journeyName,
        time:     d.t!,
        label:    transportViewRef.current.label,
        seeking:  true,
        ready:    true,
        width:    canvasRef.current?.width ?? 0,
        height:   canvasRef.current?.height ?? 0,
        fps:      fpsRef.current,
        uniforms: debugStateRef.current,
      })
    }, [ applyCrt, fpsRef, journeyName, pointerRef, sampleFrame, settingsRef ])

    const onFrame = useCallback((manager: ManagerType) => {
      const renderer = rendererRef.current
      if (!renderer)
        return

      const d   = dbgRef.current
      const sim = simRef.current

      if (d.t !== null) {
        drawFrozen(d, sim, renderer)
        return
      }

      // Log where we are *before* moving, so every boundary the journey has
      // ever crossed has a recorded time to rewind to.
      const transport = transportRef.current!
      transport.observe(iTimeRef.current,
                        sim?.marks?.() ?? options.getMarks?.(iTimeRef.current) ?? null)

      // The transport does its own integration while shuttling, so the normal
      // step is skipped for the duration — otherwise a rewind would be fighting
      // a forward frame every frame.
      const ts: TransportState = transport.tick(manager.deltaTime)
      const scrubbing          = ts.mode !== 'play'

      // Input is tweened on the *real* delta — panning shouldn't slow down or
      // speed up with the time-scale setting.
      updatePan(manager.deltaTime)

      if (!scrubbing) {
        const dt = manager.deltaTime * settingsRef.current.speed
        iTimeRef.current += dt

        // Step the simulation before the draw so the frame renders the state
        // the integrator just produced, not last frame's.
        sim?.step(dt, iTimeRef.current)
      }

      // Re-read: the transport may have replaced the simulation outright.
      const liveSim = simRef.current

      const marks = liveSim?.marks?.() ?? options.getMarks?.(iTimeRef.current) ?? null

      // Evaluated once and shared: the mix hears exactly what the frame shows.
      let custom = liveSim?.uniforms()

      // How far the signal has gone, as a uniform.
      //
      // The CRT pass degrades the *picture* and knows nothing about the world in
      // it, so a journey that wants its own world to react has to be told — and
      // skybridges does: its sun goes off. Note the `??=`: a journey with no
      // simulation has no uniforms object of its own, and before this it simply
      // never received the value.
      if (marks?.signalAge)
        (custom ??= {}).uSignalLoss = signalLossAt(marks.signalAge).level

      // Silence during a shuttle. A tape has no audio at speed either, and
      // feeding an audio graph a rewound clock makes it click.
      if (!scrubbing)
        audioRef.current?.update?.(iTimeRef.current, custom)
      if (custom)
        debugStateRef.current = custom

      renderer.draw({
        time:    iTimeRef.current,
        pointer: pointerRef.current,
        heavy:   settingsRef.current.heavyEffects ? 1 : 0,
        custom,
      })

      applyCrt(iTimeRef.current, ts.scrub, ts.scrubMix, marks?.signalAge ?? 0)

      const view        = transportViewRef.current
      view.mode         = ts.mode
      view.loop         = marks?.loop ?? 0
      view.section      = marks?.section ?? 0
      view.sectionCount = marks?.sectionCount ?? 1
      view.progress     = marks?.progress ?? 0
      view.time         = iTimeRef.current
      view.hasMarks     = marks !== null

      const getLabel = liveSim?.label
        ? () => liveSim.label!()
        : options.getSectionName
          ? () => options.getSectionName!(iTimeRef.current)
          : null
      if (getLabel) {
        const nextSectionName = getLabel()
        if (nextSectionName !== sectionNameRef.current) {
          sectionNameRef.current = nextSectionName
          setSectionName(nextSectionName)
          setSectionGlitchKey(value => value + 1)
        }
      }
      transportViewRef.current.label = hudLabel(sectionNameRef.current, liveSim?.detail?.())

      sampleFrame()

      if (d.debug)
        publishDebugState({
          journey:  journeyName,
          time:     iTimeRef.current,
          label:    transportViewRef.current.label,
          seeking:  false,
          ready:    true,
          width:    canvasRef.current?.width ?? 0,
          height:   canvasRef.current?.height ?? 0,
          fps:      fpsRef.current,
          uniforms: debugStateRef.current,
        })
      // NOTE: audio.isMuted is deliberately absent — reading it here would
      // re-register the frame callback on every toggle. audioRef is stable.
    }, [ applyCrt, audioRef, dbgRef, drawFrozen, journeyName, pointerRef, sampleFrame, settingsRef, updatePan ])
    useFrameLoop(onFrame)

    const containerStyle = options.accent
      ? ({ ['--accent' as string]: options.accent } as React.CSSProperties)
      : undefined

    return <main id="app-container" style={ containerStyle }>
      <canvas id="gl-canvas" ref={ canvasRef } />
      <section id="crt-overlay" />

      {dbg.hud &&
          <Link id="back-btn" href="/">
            ← INDEX
          </Link>
      }

      {dbg.hud && sectionName &&
          <header
            key={ sectionGlitchKey }
            id="sector-title"
            className={ options.sectionTitleClassName }
            data-text={ sectionName }>
            {sectionName}
          </header>
      }

      {dbg.hud &&
          <button id="fullscreen-btn" onClick={ toggleFullscreen }>
            FULLSCREEN
          </button>
      }

      {dbg.hud && options.createAudioEngine &&
          <button id="audio-btn" onClick={ audio.toggle }>
            {audio.isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
          </button>
      }

      {dbg.hud &&
          <aside id="fps-display">
            {renderRes.w}×{renderRes.h} · {fps} FPS
          </aside>
      }

      {dbg.hud && <SettingsButton />}

      {/* Frozen ?t= mode gets no transport: the driver's whole contract is that
          the frame is a pure function of the URL. */}
      {dbg.hud && dbg.t === null &&
          <JourneyTransport
            getView={ () => ({ ...transportViewRef.current }) }
            onAction={ action => transportRef.current?.request(action) } />
      }

      {dbg.debug &&
          <JourneyDebugPanel
            getState={ () => window.__journeyDebug ?? {
              journey:  journeyName,
              time:     iTimeRef.current,
              label:    sectionNameRef.current,
              seeking:  dbg.t !== null,
              ready:    false,
              width:    renderRes.w,
              height:   renderRes.h,
              fps,
              uniforms: debugStateRef.current,
            } } />
      }
    </main>
  }

  JourneyShell.displayName = 'JourneyShell'
  return JourneyShell
}
