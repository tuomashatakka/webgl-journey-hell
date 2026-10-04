'use client'

// The React side of a journey page: the glue between the view
// (components/withJourneyShell) and the framework-free engine
// (@wjh/journey/engine), which owns the context, renderer, simulation, clock,
// transport, governor, loading sequence and the frame itself.
//
// This hook holds only what React has to hold: the settings and debug
// parameters the engine reads, the pan and audio handles it is given, the three
// pieces of state the UI renders (loading, section, paused) and the effects
// that attach the engine to the canvas and tell it when its inputs changed.

import { useEffect, useRef, useState } from 'react'
import { createJourneyEngine, LOADING_BOOT } from '@wjh/journey/engine'
import type { EngineHost, JourneyEngine, JourneyLoading, SectionAnnouncement, TransportView } from '@wjh/journey/engine'
import type { JourneyDefinition } from '@wjh/journey/definition'
import type { JourneyAudioEngine } from '@wjh/journey/types'
import type { TransportAction } from '@wjh/journey/transport'
import { NO_DEBUG, readDebugParams } from '@wjh/web/debugParams'
import type { DebugParams, JourneyDebugState } from '@wjh/web/debugParams'
import { useSettings } from '✦/components/SettingsProvider'
import useAudioEngine from '✦/hooks/use-audio-engine'
import type { AudioEngineHandle } from '✦/hooks/use-audio-engine'
import useFrameLoop from '✦/hooks/use-frame-loop'
import useFullscreen from '✦/hooks/use-fullscreen'
import useLatestRef from '✦/hooks/use-latest-ref'
import usePanControl from '✦/hooks/use-pan-control'


/**
 * Stand-in for journeys with no soundtrack. useAudioEngine has to be called
 * unconditionally (hook order) but only builds on the first unmute — which,
 * with no mute button rendered, never happens.
 */
const SILENT_ENGINE: JourneyAudioEngine = {
  toggleMute: () => true,
  destroy:    () => {}
}

export interface JourneyRuntime {
  dbg:       DebugParams;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;

  /** The transport bar, attached by the view; fed every frame. */
  transportRef: React.RefObject<{ update(view: TransportView): void } | null>;

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
  const [ loading, setLoading ] = useState<JourneyLoading>(LOADING_BOOT)
  const [ paused, setPaused ]   = useState(false)
  const pausedRef               = useRef(false)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const transportRef = useRef<{ update(view: TransportView): void } | null>(null)
  const statsRef     = useRef<HTMLElement | null>(null)

  // Every journey pans the way the poolrooms always has: the view swings away
  // from the pointer sideways — pointer (or phone) to the right, and it turns
  // left — and follows it up and down. The shaders all look *toward* uPointer,
  // so the one inversion lives here rather than in each of them.
  const { pointerRef, updatePan } = usePanControl({ gyroscope: settings.gyroscope, invertX: true })

  // An engine built while paused (the first unmute) starts out paused, so its
  // context is never resumed only to be suspended a moment later.
  const audio = useAudioEngine<JourneyAudioEngine>(() => {
    const engine = definition.createAudio?.() ?? SILENT_ENGINE
    engine.setPaused?.(pausedRef.current)
    return engine
  })
  const audioRef   = audio.engineRef
  const fullscreen = useFullscreen()

  // Built once per mount. Everything it reads comes through the host, whose
  // members read refs, so settings changes never rebuild it.
  const engineRef = useRef<JourneyEngine | null>(null)
  if (!engineRef.current) {
    const host: EngineHost = {
      settings: () => settingsRef.current,
      debug:    () => dbgRef.current,
      pan:      {
        update:  updatePan,
        pointer: () => pointerRef.current,
        hold:    (x, y) => {
          pointerRef.current.x = x
          pointerRef.current.y = y
        },
      },
      audio:         () => audioRef.current,
      stats:         () => statsRef.current,
      transportView: () => transportRef.current,
      onLoading:     setLoading,
      onSection:     setSection,
      onPaused:      next => {
        pausedRef.current = next
        setPaused(next)
      },
    }
    engineRef.current = createJourneyEngine(definition, host)
  }

  const engine = engineRef.current

  useEffect(() => {
    const canvas = canvasRef.current
    return canvas ? engine.attach(canvas) : undefined
  }, [ engine ])

  useEffect(() => {
    engine.inputsChanged()
  }, [ engine, settings.resolution, settings.maxFrameRate, settings.brightness, settings.contrast, dbg.w, dbg.h, dbg.res ])

  useFrameLoop(engine.frame)

  return {
    dbg,
    canvasRef,
    transportRef,
    statsRef,
    loading,
    section,
    paused,
    togglePause:      engine.togglePause,
    audio,
    fullscreen:       fullscreen.isFullscreen,
    toggleFullscreen: fullscreen.toggle,
    act:              engine.act,
    scrub:            engine.scrub,
    release:          engine.release,
    debugState:       engine.debugState,
  }
}
