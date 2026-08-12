'use client'

// Lazily-constructed journey audio, shared by every route that has a soundtrack.
//
// The engines are built on first unmute (an AudioContext may only start from a
// user gesture) and torn down with the component, so a journey page needs only:
//
//   const audio = useAudioEngine(() => new StairwellAudioEngine())
//   ...
//   audio.engineRef.current?.updateState(currentZ)   // from the render loop
//   <button onClick={ audio.toggle }>{ audio.isMuted ? 'UNMUTE' : 'MUTE' }</button>

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomUniforms } from '@/lib/shaderQuad'


/** Minimum surface a journey audio engine has to expose. */
export interface JourneyAudioEngine {

  /** Flip mute and return the new muted state. */
  toggleMute: () => boolean;

  /** Release the AudioContext and any scheduled timers. */
  destroy: () => void;

  /**
   * Optional per-frame modulation, called by withShaderJourney. Receives the
   * journey's accumulated (speed-scaled) shader time and, for journeys that run
   * a simulation, the very uniform map the shader is about to be drawn with —
   * so the mix can follow the same state the geometry does.
   *
   * Deliberately *not* named `updateState`: the two hand-written journeys
   * (liminal, stairwell) already expose a concrete `updateState(z)` with a
   * different signature, and they must keep satisfying this interface.
   */
  update?: (time: number, state?: CustomUniforms) => void;
}

export interface AudioEngineHandle<T extends JourneyAudioEngine> {

  /** Null until the first unmute — the render loop should optional-chain it. */
  engineRef: React.RefObject<T | null>;
  isMuted:   boolean;
  toggle:    () => void;
}

export function useAudioEngine<T extends JourneyAudioEngine> (
  create: () => T,
): AudioEngineHandle<T> {
  const engineRef   = useRef<T | null>(null)
  const createRef   = useRef(create)
  createRef.current = create

  const [ isMuted, setIsMuted ] = useState(true)

  const toggle = useCallback(() => {
    if (!engineRef.current)
      engineRef.current = createRef.current()
    setIsMuted(engineRef.current.toggleMute())
  }, [])

  useEffect(() => () => {
    engineRef.current?.destroy()
    engineRef.current = null
  }, [])

  return { engineRef, isMuted, toggle }
}

export default useAudioEngine
