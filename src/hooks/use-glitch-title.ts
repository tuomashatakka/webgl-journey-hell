'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createGlitchTitle } from '@wjh/web/glitchTitle'
import type { GlitchTitleOptions } from '@wjh/web/glitchTitle'
import { detectDevice } from '@wjh/quality/device'
import useLatestRef from './use-latest-ref'


export interface GlitchTitleBehavior {

  /** A tap, a click or a key cuts straight to the tear-out. */
  skippable?: boolean;

  /** Cap on backing pixels per CSS pixel. */
  maxScale: number;

  onDone: () => void;

  /** The card has started tearing away. */
  onOut?: () => void;
}

/**
 * Run a glitch title on the returned canvas ref: sizes it, drives its own
 * requestAnimationFrame clock and calls onDone when the card has torn out.
 */
export function useGlitchTitle (options: Omit<GlitchTitleOptions, 'calm'>, { skippable, maxScale, onDone, onOut }: GlitchTitleBehavior): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef   = useLatestRef(onDone)
  const outRef    = useLatestRef(onOut)

  const { title, subtitle, accent, backdrop, fontScale } = options
  const timing                                           = options.timing ? `${options.timing.in}:${options.timing.hold}:${options.timing.out}` : ''

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    const card = createGlitchTitle(canvas, { ...options, calm })
    // The type is what matters here, but a phone at 3x has no use for nine
    // pixels per point of a title that is about to tear.
    const scale  = Math.min(window.devicePixelRatio || 1, detectDevice().mobile ? Math.min(1.25, maxScale) : maxScale)
    const resize = () => card.resize(
      Math.round(canvas.clientWidth * scale),
      Math.round(canvas.clientHeight * scale),
    )
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    // The clock is the card's own frames, each capped: the journey compiles
    // its shaders around the time this mounts, which can block for seconds on
    // a phone, and a card timed from mount would be over before its first
    // frame. Until that frame the canvas is black via CSS when it has a
    // backdrop, so the hitch is covered.
    let t    = 0
    let last = 0
    let raf  = 0
    let out  = false
    const tick = (now: number) => {
      if (last === 0)
        canvas.dataset.live = '1'
      else
        t += Math.min(Math.max(0, (now - last) / 1000), 1 / 20)
      last = now
      if (!out && card.isOut(t)) {
        out = true
        outRef.current?.()
      }
      if (card.draw(t))
        raf = requestAnimationFrame(tick)
      else
        doneRef.current()
    }
    raf = requestAnimationFrame(tick)

    const skip = () => card.skip(t)
    if (skippable) {
      window.addEventListener('pointerdown', skip)
      window.addEventListener('keydown', skip)
    }
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      if (skippable) {
        window.removeEventListener('pointerdown', skip)
        window.removeEventListener('keydown', skip)
      }
    }
    // `options` is rebuilt every render; its contents are the dependencies.
  }, [ title, subtitle, accent, backdrop, fontScale, timing, skippable, maxScale ])

  return canvasRef
}

/**
 * Type size for a section heading. On a phone the width is what limits the
 * type, and the card's proportion of it would leave a heading too small to
 * read at a glance. Fixed at mount, on the client, so the window is there to ask.
 */
export function useHeadingFontScale (): number {
  const [ fontScale ] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700 ? 0.82 : 0.55)
  return fontScale
}
