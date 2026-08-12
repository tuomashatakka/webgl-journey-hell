'use client'

// The boilerplate every journey route repeats around its WebGL loop, factored
// into one place: mirroring React state into refs the loop can read, applying
// the display filter, re-sizing the backing store when the resolution setting
// changes, the fullscreen button, and the FPS/resolution HUD counters.
//
// Used by the templated journeys (components/withShaderJourney) and by the two
// hand-written two-pass routes (liminal, stairwell) alike, so all three behave
// identically.

import { useCallback, useEffect, useRef, useState } from 'react'
import { displayFilter } from '@/lib/settings'
import type { GraphicsSettings } from '@/lib/settings'


/**
 * Mirror a changing value into a ref.
 *
 * Render loops are registered once and must not be re-created when settings
 * change; they read the latest value through the returned ref instead.
 */
export function useLatestRef<T> (value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [ value ])
  return ref
}

export interface DisplayFilterOptions {

  /**
   * Set when the shader already applies brightness itself (liminal and
   * stairwell hand it to the post pass as `uBrightness`), so the CSS filter
   * carries contrast alone and the two don't compound.
   */
  brightnessInShader?: boolean;
}

/** Keep a journey's canvas in sync with the brightness/contrast settings. */
export function useDisplayFilter (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  settings: Pick<GraphicsSettings, 'brightness' | 'contrast'>,
  options: DisplayFilterOptions = {},
) {
  const { brightness, contrast } = settings
  const { brightnessInShader }   = options

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return
    canvas.style.filter = brightnessInShader
      ? `contrast(${contrast})`
      : displayFilter({ brightness, contrast })
  }, [ canvasRef, brightness, contrast, brightnessInShader ])
}

/**
 * Re-run a journey's resize when anything affecting the backing-store size
 * changes — the resolution setting, or a debug override that forces an exact
 * size. Takes an opaque key rather than a number so callers can combine several
 * inputs into one dependency.
 *
 * The returned ref is assigned by the GL effect once it knows how to resize;
 * changing the key then re-scales the backing store in place instead of tearing
 * down and rebuilding the GL context.
 */
export function useResolutionResize (key: number | string): React.RefObject<() => void> {
  const resizeRef = useRef<() => void>(() => {})
  useEffect(() => {
    resizeRef.current()
  }, [ key ])
  return resizeRef
}

/** Toggle fullscreen on the document element (the journeys' FULLSCREEN button). */
export function useFullscreenToggle (): () => void {
  return useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err)
      }); else
      document.exitFullscreen()
  }, [])
}

export interface FpsMeter {

  /** Frames per second, republished once a second. */
  fps: number;

  /** Backing-store size, for the HUD. Journeys set it from their resize. */
  renderRes:    { w: number; h: number };
  setRenderRes: (res: { w: number; h: number }) => void;

  /** Count one rendered frame. Call from the render loop. */
  sampleFrame: () => void;
}

/** FPS + render-resolution readout shared by every journey's HUD. */
export function useFpsMeter (): FpsMeter {
  const [ fps, setFps ]             = useState(0)
  const [ renderRes, setRenderRes ] = useState({ w: 0, h: 0 })

  const framesRef = useRef(0)
  const lastRef   = useRef(0)

  const sampleFrame = useCallback(() => {
    framesRef.current += 1

    const now = performance.now()
    if (lastRef.current === 0)
      lastRef.current = now

    const elapsed = now - lastRef.current
    if (elapsed >= 1000) {
      setFps(Math.round(framesRef.current * 1000 / elapsed))
      framesRef.current = 0
      lastRef.current   = now
    }
  }, [])

  return { fps, renderRes, setRenderRes, sampleFrame }
}
