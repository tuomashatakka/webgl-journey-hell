'use client'

// The tape deck at the bottom of every journey.
//
//   [⏮][◀◀][❚❚][▶▶][⏭]  ▶ PLAY  LOOP 1 · II · PROTEAN WEATHER BRIDGE     00:42
//   [==========|========|=====--------------------------------------------]
//
// The play state and the section it is in read as one line, so the section
// is always named somewhere once its heading has faded from the middle. On a
// narrow screen that line drops under the buttons.
//
// React renders the structure; the shell pushes the live state in through
// `update()` every frame, which writes straight to the few DOM nodes that
// change — text only when it differs, the fill as a compositor-only transform.
//
// The track is a slider: press (or touch) anywhere on it and drag to scrub
// through the current lap; arrow keys step it when focused.

import { CONFIG } from '@wjh/config/config'

import { useCallback, useImperativeHandle, useRef } from 'react'

import type { TransportAction, TransportMode } from '@wjh/journey/transport'

import { useJourneyRuntimeContext } from './JourneyRuntimeContext'


const MODE_TEXT: Record<TransportMode | 'paused', string> = {
  play:   '▶ PLAY',
  paused: '❚❚ PAUSED',
  flash:  '▸│ SKIP',
  scrub:  '◀▶ SCRUB',
}

const BACK: { act: TransportAction; glyph: string; title: string }[] = [
  { act: 'prev-lap', glyph: '⏮', title: 'Back to the start of the lap' },
  { act: 'prev', glyph: '◀◀', title: 'Previous chapter' },
]

const FORWARD: { act: TransportAction; glyph: string; title: string }[] = [
  { act: 'next', glyph: '▶▶', title: 'Next chapter' },
  { act: 'next-lap', glyph: '⏭', title: 'Next lap' },
]

interface Written {
  label:    string;
  mode:     string;
  counter:  string;
  sections: string;
  progress: number;
}

/** mm:ss — a tape counter, not a timestamp. */
function counter (t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Text only when it differs from what is already there. */
function writeText (el: HTMLElement | null, last: Written, key: 'label' | 'mode' | 'counter', value: string): void {
  if (!el || value === last[key])
    return
  el.textContent = value
  last[key]      = value
}

/**
 * The fill as a compositor-only transform, and the section dividers as one
 * custom property the track's own background reads.
 */
function writeTrack (fill: HTMLElement | null, track: HTMLElement | null, last: Written, p: number, sections: number): void {
  if (Math.abs(p - last.progress) > 1e-4) {
    fill?.style.setProperty('transform', `scaleX(${p})`)
    track?.setAttribute('aria-valuenow', String(Math.round(p * 100)))
    last.progress = p
  }
  if (String(sections) !== last.sections) {
    track?.style.setProperty('--sections', String(sections))
    last.sections = String(sections)
  }
}

export default function JourneyTransport () {
  const { paused, togglePause: onTogglePause, act: onAction, scrub: onScrub, release: onRelease, transportRef } = useJourneyRuntimeContext()

  const rootRef    = useRef<HTMLElement>(null)
  const labelRef   = useRef<HTMLSpanElement>(null)
  const modeRef    = useRef<HTMLSpanElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const fillRef    = useRef<HTMLSpanElement>(null)
  const trackRef   = useRef<HTMLDivElement>(null)

  const last        = useRef({ label: '', mode: '', counter: '', sections: '', progress: -1 })
  const progressRef = useRef(0)

  useImperativeHandle(transportRef, () => ({
    update (view) {
      const p             = Math.min(1, Math.max(0, view.progress))
      const mode          = view.paused && view.mode === 'play' ? 'paused' : view.mode
      progressRef.current = p

      const l = last.current
      writeText(labelRef.current, l, 'label', view.label || '—')
      writeText(modeRef.current, l, 'mode', MODE_TEXT[mode])
      writeText(counterRef.current, l, 'counter', counter(view.time))
      rootRef.current?.setAttribute('data-mode', mode)
      writeTrack(fillRef.current, trackRef.current, l, p, view.hasMarks ? Math.max(1, view.sectionCount) : 1)
    },
  }), [])

  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0)
      return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0)
      return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    onScrub(fractionAt(e.clientX))
  }, [ onScrub ])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      onScrub(fractionAt(e.clientX))
  }, [ onScrub ])

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    onRelease()
  }, [ onRelease ])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? CONFIG.ui.transportKeyStep : e.key === 'ArrowLeft' ? -CONFIG.ui.transportKeyStep : 0
    if (!step)
      return
    e.preventDefault()
    onScrub(progressRef.current + step)
    onRelease()
  }, [ onScrub, onRelease ])

  type PropsType = { act: TransportAction; glyph: string; title: string }

  const button = ({ act, glyph, title }: PropsType) =>
    <button key={ act } className="jt-btn" aria-label={ title } type="button" title={ title } onClick={ () => onAction(act) }>
      {glyph}
    </button>

  return <aside ref={ rootRef } className="hud journey-transport" id="journey-transport" data-mode="play">
    <header className="jt-head">
      <nav className="jt-buttons" aria-label="Transport">
        {BACK.map(button)}

        <button
          className="jt-btn jt-pause"
          aria-label={ paused ? 'Play' : 'Pause' }
          aria-pressed={ paused }
          type="button"
          title={ paused ? 'Play (space)' : 'Pause (space)' }
          onClick={ onTogglePause }>
          {paused ? '▶' : '❚❚'}
        </button>

        {FORWARD.map(button)}
      </nav>

      <span className="jt-state">
        <span ref={ modeRef } className="jt-mode">{MODE_TEXT.play}</span>
        <span ref={ labelRef } className="jt-label">—</span>
      </span>

      <span ref={ counterRef } className="jt-counter">00:00</span>
    </header>

    <div
      ref={ trackRef }
      className="jt-track"
      aria-label="Position in the lap — drag to scrub"
      aria-valuemin={ 0 }
      aria-valuemax={ 100 }
      aria-valuenow={ 0 }
      role="slider"
      tabIndex={ 0 }
      onPointerDown={ onPointerDown }
      onPointerMove={ onPointerMove }
      onPointerUp={ onPointerEnd }
      onPointerCancel={ onPointerEnd }
      onKeyDown={ onKeyDown }>
      <span ref={ fillRef } className="jt-fill" />
    </div>
  </aside>
}
