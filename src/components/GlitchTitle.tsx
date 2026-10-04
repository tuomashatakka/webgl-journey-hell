'use client'

// Glitching type over a journey: the opening title card, and the section
// headings, which share its look. See lib/glitchTitle for the renderer.
//
// Each runs on its own requestAnimationFrame rather than the shared frame loop:
// it has nothing to do with the journey's clock (neither the speed setting nor
// a pause may stretch it), and it unmounts itself — completely, not faded to a
// ghost — when it is done.

import type { GlitchTitleOptions } from '@wjh/web/glitchTitle'
import { useGlitchTitle, useHeadingFontScale } from '✦/hooks/use-glitch-title'


interface CanvasProps extends Omit<GlitchTitleOptions, 'calm'> {
  id: string;

  /** A tap, a click or a key cuts straight to the tear-out. */
  skippable?: boolean;

  /** Cap on backing pixels per CSS pixel. */
  maxScale?: number;

  onDone: () => void;
  onOut?: () => void;
}

interface TitleCardProps {
  title:     string;
  subtitle?: string;
  accent:    string;
  onDone:    () => void;

  /** The card has started tearing away: the journey's clock may run. */
  onOut?: () => void;
}

interface SectionHeadingProps {

  /** The section's HUD label: "LAP 2 · THE VIADUCT", or the bare name. */
  title:  string;
  accent: string;
  onDone: () => void;
}

/** The name as the heading's title, and the lap under it as its tagline. */
type SplitLabelReturnType = { title: string; subtitle?: string }

function GlitchTitleCanvas ({ id, skippable, maxScale = 2, onDone, onOut, ...options }: CanvasProps) {
  const canvasRef = useGlitchTitle(options, { skippable, maxScale, onDone, onOut })

  // Black until the card's first frame when it has a backdrop: the journey's
  // compile can hold that frame up, and the card has to cover it.
  return <canvas
    ref={ canvasRef }
    className={ options.backdrop === false ? 'gt-clear' : 'gt-black' }
    id={ id }
    aria-hidden="true" />
}

/** The card every journey opens on: out of black, held, torn away. */
export function TitleCard (props: TitleCardProps) {
  return <GlitchTitleCanvas id="journey-title-intro" skippable { ...props } />
}

function splitLabel (label: string): SplitLabelReturnType {
  const at = label.lastIndexOf(' · ')
  return at < 0 ? { title: label } : { title: label.slice(at + 3), subtitle: label.slice(0, at) }
}

/**
 * The card's type, smaller and quicker, over the running journey: no
 * backdrop, no skip, and gone entirely once it has torn out.
 */
export function SectionHeading ({ title, accent, onDone }: SectionHeadingProps) {
  const fontScale = useHeadingFontScale()

  return <GlitchTitleCanvas
    id="journey-section-heading"
    accent={ accent }
    backdrop={ false }
    fontScale={ fontScale }
    timing={{ in: 0.55, hold: 2.4, out: 3.3 }}
    maxScale={ 1.5 }
    { ...splitLabel(title) }
    onDone={ onDone } />
}
