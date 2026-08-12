'use client'

// withShaderJourney(fragmentShader) — the pluggable journey template.
//
// A higher-order component that turns a single-pass fragment shader into a full
// journey route. It owns all the WebGL boilerplate that used to be copy-pasted
// into every journey page (context, full-screen quad, resize, pointer, cleanup)
// and wires in the global graphics settings:
//   • resolution  → canvas backing-store scale
//   • speed       → iTime accumulation rate
//   • brightness  → CSS filter on the canvas
//   • contrast    → CSS filter on the canvas
//   • maxFrameRate→ honored globally by the shared frameLoopManager
//   • gyroscope   → device-orientation contribution to camera panning
//
// Rendering runs on the shared, frame-capped loop (lib/frameLoopManager, vendored
// from @tuomashatakka/canvas-loop-framecapper) via useFrameLoop, so every
// templated journey shares one rAF and one FPS cap.
//
// Usage (a journey page is now three lines):
//   'use client';
//   import { withShaderJourney } from '@/components/withShaderJourney';
//   import { skybridgesFrag } from './shader';
//   export default withShaderJourney(skybridgesFrag);

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createShaderQuad } from '@/lib/shaderQuad'
import type { CustomUniforms, ShaderQuad } from '@/lib/shaderQuad'
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
export interface JourneySimulation {

  /** Advance by `dt` seconds. `time` is the accumulated shader time. */
  step(dt: number, time: number): void;

  /** State for this frame, uploaded verbatim to the shader. */
  uniforms(): CustomUniforms;

  /** Optional HUD section label derived from simulation state, not time. */
  label?(): string;

  /** Optional teardown for anything the simulation allocated. */
  dispose?(): void;
}

interface ShaderJourneyOptions {

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

export function withShaderJourney (fragmentShader: string, options: ShaderJourneyOptions = {}) {
  function ShaderJourney () {
    const { settings } = useSettings()

    // Bottom-right HUD: render resolution (backing-store px) + measured FPS.
    const { fps, renderRes, setRenderRes, sampleFrame } = useFpsMeter()

    const [ sectionName, setSectionName ] = useState(
      () => options.getSectionName?.(0) ?? '',
    )
    const [ sectionGlitchKey, setSectionGlitchKey ] = useState(0)

    const toggleFullscreen = useFullscreenToggle()

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const quadRef   = useRef<ShaderQuad | null>(null)
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

    // Latest settings for the (stable) frame callback + resize, without re-registering.
    const settingsRef = useLatestRef(settings)

    // Resize is stored here so the resolution setting can re-trigger it.
    const resizeRef = useResolutionResize(settings.resolution)

    // --- GL setup / teardown (once) ---
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas)
        return

      const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false })
      if (!gl) {
        console.error('WebGL not supported')
        return
      }

      const quad      = createShaderQuad(gl, fragmentShader, { envUrl: options.envMapUrl })
      quadRef.current = quad
      if (!quad)
        return // compile/link failed — leave the canvas blank

      const resize = () => {
        const dpr     = Math.min(window.devicePixelRatio || 1, MAX_DPR)
        const scale   = dpr * settingsRef.current.resolution
        canvas.width  = Math.max(1, Math.floor(window.innerWidth * scale))
        canvas.height = Math.max(1, Math.floor(window.innerHeight * scale))
        setRenderRes({ w: canvas.width, h: canvas.height })
      }
      resizeRef.current = resize

      window.addEventListener('resize', resize)
      resize()

      return () => {
        window.removeEventListener('resize', resize)
        quad.dispose()
        quadRef.current = null
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

    const onFrame = useCallback((manager: ManagerType) => {
      const quad = quadRef.current
      if (!quad)
        return

      const dt = manager.deltaTime * settingsRef.current.speed
      iTimeRef.current += dt

      // Input is tweened on the *real* delta — panning shouldn't slow down or
      // speed up with the time-scale setting.
      updatePan(manager.deltaTime)

      // Step the simulation before the draw so the frame renders the state the
      // integrator just produced, not last frame's.
      const sim = simRef.current
      sim?.step(dt, iTimeRef.current)

      // Evaluated once and shared: the mix hears exactly what the frame shows.
      const custom = sim?.uniforms()
      audioRef.current?.update?.(iTimeRef.current, custom)

      quad.draw({
        time:    iTimeRef.current,
        pointer: pointerRef.current,
        heavy:   settingsRef.current.heavyEffects ? 1 : 0,
        custom,
      })

      const getLabel = sim?.label
        ? () => sim.label!()
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

      sampleFrame()
      // NOTE: audio.isMuted is deliberately absent — reading it here would
      // re-register the frame callback on every toggle. audioRef is stable.
    }, [ audioRef, pointerRef, sampleFrame, settingsRef, updatePan ])
    useFrameLoop(onFrame)

    const containerStyle = options.accent
      ? ({ ['--accent' as string]: options.accent } as React.CSSProperties)
      : undefined

    return <main id="app-container" style={ containerStyle }>
      <canvas id="gl-canvas" ref={ canvasRef } />
      <section id="crt-overlay" />

      <Link id="back-btn" href="/">
        ← INDEX
      </Link>

      {sectionName &&
          <header
            key={ sectionGlitchKey }
            id="sector-title"
            className={ options.sectionTitleClassName }
            data-text={ sectionName }>
            {sectionName}
          </header>
      }

      <button id="fullscreen-btn" onClick={ toggleFullscreen }>
        FULLSCREEN
      </button>

      {options.createAudioEngine &&
          <button id="audio-btn" onClick={ audio.toggle }>
            {audio.isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
          </button>
      }

      <aside id="fps-display">
        {renderRes.w}×{renderRes.h} · {fps} FPS
      </aside>

      <SettingsButton />
    </main>
  }

  ShaderJourney.displayName = 'ShaderJourney'
  return ShaderJourney
}

export default withShaderJourney
