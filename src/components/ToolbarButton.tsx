'use client'

// One toolbar control: an inline SVG icon and nothing else, named for assistive
// tech by aria-label and for everyone else by a tooltip that shows on hover and
// on keyboard focus. The tooltip is a manual popover anchored to the button
// where the browser supports it (hooks/use-tooltip); otherwise the stylesheet
// draws a plain CSS one.

import { useId } from 'react'
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

  return <span
    className="tb-item"
    data-side={ side }
    data-align={ align }
    style={{ ['--tb-anchor' as string]: anchor } as React.CSSProperties}
    { ...hostProps }>
    {href
      ? <Link id={ id } className="tb-btn" href={ href } aria-label={ label }>{icon}</Link>
      : <button id={ id } className="tb-btn" type="button" aria-label={ label } aria-pressed={ pressed } onClick={ onClick }>{icon}</button>
    }

    <span ref={ tipRef } className="tb-tip" popover="manual" aria-hidden="true">{label}</span>
  </span>
}
