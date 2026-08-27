'use client'

// The tape deck at the bottom of every journey.
//
// Sampled on an interval rather than driven from the frame loop, for the same
// reason JourneyDebugPanel is: a journey redraws sixty times a second, and
// putting React's reconciler on that path costs frames for a readout nobody can
// read that fast. 60ms is quick enough that the fill still reads as continuous
// once the CSS transition smooths between samples — and the transition is
// switched off while shuttling, because there the bar is *supposed* to jump.

import { useEffect, useRef, useState } from 'react'
import type { TransportAction, TransportMode } from '@/lib/journeyTransport'


const SAMPLE_MS = 60

export interface TransportView {
  mode:         TransportMode;
  loop:         number;
  section:      number;
  sectionCount: number;
  progress:     number;
  time:         number;
  label:        string;
  hasMarks:     boolean;
}

const MODE_TEXT: Record<TransportMode, string> = {
  play:  '▶  PLAY',
  ff:    '▶▶ F.FWD',
  rew:   '◀◀ REW',
  flash: '▸│ SKIP',
}

const CONTROLS: { act: TransportAction; glyph: string; title: string }[] = [
  { act: 'prev', glyph: '⏮', title: 'Previous section' },
  { act: 'rew', glyph: '◀◀', title: 'Rewind to the start of the loop' },
  { act: 'ff', glyph: '▶▶', title: 'Fast-forward to the start of the next loop' },
  { act: 'next', glyph: '⏭', title: 'Next section' },
]

/** mm:ss — a tape counter, not a timestamp. */
function counter (t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface Props {
  getView:  () => TransportView;
  onAction: (action: TransportAction) => void;
}

export default function JourneyTransport ({ getView, onAction }: Props) {
  const [ view, setView ] = useState<TransportView | null>(null)
  const getViewRef        = useRef(getView)
  getViewRef.current      = getView

  useEffect(() => {
    const tick = () => setView(getViewRef.current())
    tick()

    const id = window.setInterval(tick, SAMPLE_MS)
    return () => window.clearInterval(id)
  }, [])

  if (!view)
    return null

  const pct = `${Math.round(Math.min(1, Math.max(0, view.progress)) * 1000) / 10}%`

  // One divider per internal section boundary. Journeys that report a single
  // section get a plain bar rather than a bar with a redundant tick at 0.
  const ticks = view.hasMarks && view.sectionCount > 1
    ? Array.from({ length: view.sectionCount - 1 }, (_, i) => (i + 1) / view.sectionCount)
    : []

  return <aside id="journey-transport" data-mode={ view.mode }>
    <div className="jt-head">
      <div className="jt-buttons">
        {CONTROLS.map(({ act, glyph, title }) =>
          <button
            key={ act }
            className="jt-btn"
            type="button"
            title={ title }
            aria-label={ title }
            onClick={ () => onAction(act) }>
            {glyph}
          </button>,
        )}
      </div>

      <span className="jt-label">{view.label || '—'}</span>

      <span className="jt-state">
        <span className="jt-mode">{MODE_TEXT[view.mode]}</span>
        <span className="jt-counter">{counter(view.time)}</span>
      </span>
    </div>

    <div
      className="jt-track"
      role="progressbar"
      aria-label="Loop position"
      aria-valuemin={ 0 }
      aria-valuemax={ 100 }
      aria-valuenow={ Math.round(view.progress * 100) }>
      <div className="jt-fill" style={{ width: pct }} />

      {ticks.map(t =>
        <span key={ t } className="jt-tick" style={{ left: `${t * 100}%` }} />,
      )}
    </div>
  </aside>
}
