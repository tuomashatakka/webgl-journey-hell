'use client'

// The opening title card, over every journey. See lib/glitchTitle for the look.
//
// It runs on its own requestAnimationFrame rather than the shared frame loop:
// the card is a few seconds long, has nothing to do with the journey's clock
// (the speed setting must not stretch it), and unmounts itself when done. A tap,
// a click or a key cuts straight to the tear-out.

import { useEffect, useRef } from 'react'
import { createGlitchTitle } from '✦/lib/glitchTitle'
import { detectDevice } from '✦/lib/quality'


interface Props {
  title:     string;
  subtitle?: string;
  accent:    string;
  onDone:    () => void;
}

export default function JourneyTitleIntro ({ title, subtitle, accent, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef   = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    const card = createGlitchTitle(canvas, { title, subtitle, accent, calm })
    // The card is type: crisp matters more than on the journey under it, but a
    // phone at 3x has no use for nine pixels per point of a title that tears.
    const scale = Math.min(window.devicePixelRatio || 1, detectDevice().mobile ? 1.25 : 2)

    const resize = () => card.resize(
      Math.round(window.innerWidth * scale),
      Math.round(window.innerHeight * scale),
    )
    resize()

    // The card's clock is its own frames, each capped: the journey compiles
    // its shaders right after this mounts, which can block for seconds on a
    // phone, and a card timed from mount would be over before its first frame.
    // Until that first frame the canvas is plain black via CSS, so the hitch
    // is covered too.
    let t    = 0
    let last = 0
    let raf  = 0
    const tick = (now: number) => {
      if (last === 0)
        canvas.style.background = 'transparent'
      else
        t += Math.min(Math.max(0, (now - last) / 1000), 1 / 20)
      last = now
      if (card.draw(t))
        raf = requestAnimationFrame(tick)
      else
        doneRef.current()
    }
    raf = requestAnimationFrame(tick)

    const skip = () => card.skip(t)
    window.addEventListener('resize', resize)
    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [ title, subtitle, accent ])

  return <canvas id="journey-title-intro" ref={ canvasRef } aria-hidden="true" style={{ background: '#000' }} />
}
