'use client'

// Glitching type over a journey: the opening title card, and the section
// headings, which share its look. See lib/glitchTitle for the renderer.
//
// Each runs on its own requestAnimationFrame rather than the shared frame loop:
// it has nothing to do with the journey's clock (neither the speed setting nor
// a pause may stretch it), and it unmounts itself — completely, not faded to a
// ghost — when it is done.

import { useEffect, useRef, useState } from 'react'
import { createGlitchTitle } from '@wjh/web/glitchTitle'
import type { GlitchTitleOptions } from '@wjh/web/glitchTitle'
import { detectDevice } from '@wjh/quality/device'


interface CanvasProps extends Omit<GlitchTitleOptions, 'calm'> {
  id: string;

  /** A tap, a click or a key cuts straight to the tear-out. */
  skippable?: boolean;

  /** Cap on backing pixels per CSS pixel. */
  maxScale?: number;

  onDone: () => void;
}

function GlitchTitleCanvas ({ id, skippable, maxScale = 2, onDone, ...options }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef   = useRef(onDone)
  doneRef.current = onDone

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

  return <canvas
    id={ id }
    ref={ canvasRef }
    aria-hidden="true"
    style={{ background: backdrop === false ? 'transparent' : '#000' }} />
}

interface TitleCardProps {
  title:     string;
  subtitle?: string;
  accent:    string;
  onDone:    () => void;
}

/** The card every journey opens on: out of black, held, torn away. */
export function TitleCard (props: TitleCardProps) {
  return <GlitchTitleCanvas id="journey-title-intro" skippable { ...props } />
}

interface SectionHeadingProps {

  /** The section's HUD label: "LAP 2 · THE VIADUCT", or the bare name. */
  title:  string;
  accent: string;
  onDone: () => void;
}

/** The name as the heading's title, and the lap under it as its tagline. */
type SplitLabelReturnType = { title: string; subtitle?: string }

function splitLabel (label: string): SplitLabelReturnType {
  const at = label.lastIndexOf(' · ')
  return at < 0 ? { title: label } : { title: label.slice(at + 3), subtitle: label.slice(0, at) }
}

/**
 * The card's type, smaller and quicker, over the running journey: no
 * backdrop, no skip, and gone entirely once it has torn out.
 */
export function SectionHeading ({ title, accent, onDone }: SectionHeadingProps) {
  // On a phone the width is what limits the type, and the card's proportion
  // of it would leave a heading too small to read at a glance. Mounted only
  // on the client (after the title card), so the window is there to ask.
  const [ fontScale ] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700 ? 0.82 : 0.55)

  return <GlitchTitleCanvas
    id="journey-section-heading"
    { ...splitLabel(title) }
    accent={ accent }
    backdrop={ false }
    fontScale={ fontScale }
    timing={{ in: 0.55, hold: 2.4, out: 3.3 }}
    maxScale={ 1.5 }
    onDone={ onDone } />
}
