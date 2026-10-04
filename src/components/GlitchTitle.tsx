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
  title: string;

  /** Where it is, both from zero: the section's index in the lap, and the lap. */
  index:  number;
  loop:   number;
  accent: string;
  onDone: () => void;
}

/** The name as the heading's title, and where it is as its tagline. */
type SplitLabelReturnType = { title: string; subtitle: string }

function GlitchTitleCanvas ({ id, skippable, maxScale = 2, onDone, onOut, ...options }: CanvasProps) {
  const canvasRef = useGlitchTitle(options, { skippable, maxScale, onDone, onOut })

  // Black until the card's first frame when it has a backdrop: the journey's
  // compile can hold that frame up, and the card has to cover it.
  return <canvas
    ref={ canvasRef }
    className={ `${id} ${options.backdrop === false ? 'gt-clear' : 'gt-black'}` }
    id={ id }
    aria-hidden="true" />
}

/** The card every journey opens on: out of black, held, torn away. */
export function TitleCard (props: TitleCardProps) {
  return <GlitchTitleCanvas id="journey-title-intro" skippable { ...props } />
}

/**
 * Every journey's label in one format: the place's name, and "SECTOR x /
 * ITERATION y" under it. Journeys say "SECTION 3:", "SECTOR 3:", "LOOP 2",
 * "LAP 2"; the heading says none of that differently. A number the label gives
 * its section is the one shown (the abyss is sector 666), else the index's.
 */
function splitLabel (label: string, index: number, loop: number): SplitLabelReturnType {
  const parts  = label.toUpperCase().split(' · ')
  const named  = (/^SECT(?:ION|OR)\s+(\d+)\s*:\s*/).exec(parts[parts.length - 1])
  const title  = named ? parts[parts.length - 1].slice(named[0].length) : parts[parts.length - 1]
  const sector = named ? named[1] : String(index + 1)
  return { title, subtitle: `SECTOR ${sector} / ITERATION ${loop + 1}` }
}

/**
 * The card's type, smaller and quicker, over the running journey: no
 * backdrop, no skip, and gone entirely once it has torn out.
 */
export function SectionHeading ({ title, index, loop, accent, onDone }: SectionHeadingProps) {
  const fontScale = useHeadingFontScale()

  return <GlitchTitleCanvas
    id="journey-section-heading"
    accent={ accent }
    backdrop={ false }
    fontScale={ fontScale }
    timing={{ in: 0.55, hold: 2.4, out: 3.3 }}
    maxScale={ 1.5 }
    { ...splitLabel(title, index, loop) }
    onDone={ onDone } />
}
