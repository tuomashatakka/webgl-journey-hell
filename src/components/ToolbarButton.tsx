'use client'

// One toolbar control: an inline SVG icon and nothing else, named for assistive
// tech by aria-label and for everyone else by a tooltip that shows on hover and
// on keyboard focus. The tooltip is a manual popover anchored to the button
// where the browser supports it (hooks/use-tooltip); otherwise the stylesheet
// draws a plain CSS one.

import { useCallback, useId } from 'react'
import Link from 'next/link'
import { useTooltip } from '✦/hooks/use-tooltip'


interface ToolbarButtonProps {
  label:    string;
  icon:     React.ReactNode;
  id?:      string;
  href?:    string;
  pressed?: boolean;
  onClick?: () => void;

  /** Which side of the button the tooltip opens on. */
  side?: 'top' | 'bottom';

  /** Which edge of the button the tooltip lines up with; the default centres it. */
  align?: 'start' | 'center' | 'end';
}

export default function ToolbarButton ({ label, icon, id, href, pressed, onClick, side = 'bottom', align = 'center' }: ToolbarButtonProps) {
  const anchor                = `--tb-${useId().replace(/\W/g, '')}`
  const { tipRef, hostProps } = useTooltip()

  // Each button anchors its own tooltip (CSS anchor positioning): the name is
  // per instance, so it is set on the element rather than in the stylesheet.
  const host = useCallback((el: HTMLSpanElement | null) => el?.style.setProperty('--tb-anchor', anchor), [ anchor ])

  return <span
    ref={ host }
    className="tb-item"
    data-side={ side }
    data-align={ align }
    { ...hostProps }>
    {href
      ? <Link id={ id } className="tb-btn" aria-label={ label } href={ href }>{icon}</Link>
      : <button id={ id } className="tb-btn" aria-label={ label } aria-pressed={ pressed } type="button" onClick={ onClick }>{icon}</button>
    }

    <span ref={ tipRef } className="tb-tip" aria-hidden="true" popover="manual">{label}</span>
  </span>
}
