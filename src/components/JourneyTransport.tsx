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
import { useCallback, useImperativeHandle, useRef, useState } from 'react'
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


/** mm:ss — a tape counter, not a timestamp. */
function counter (t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function JourneyTransport () {
  const { paused, togglePause: onTogglePause, act: onAction, scrub: onScrub, release: onRelease, transportRef } = useJourneyRuntimeContext()

  const rootRef    = useRef<HTMLElement>(null)
  const labelRef   = useRef<HTMLSpanElement>(null)
  const modeRef    = useRef<HTMLSpanElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const fillRef    = useRef<HTMLDivElement>(null)
  const trackRef   = useRef<HTMLDivElement>(null)

  // Only the tick layout goes through React; it changes once per journey.
  const [ ticks, setTicks ] = useState<number[]>([])
  const last                = useRef({ label: '', mode: '', counter: '', ticks: '', progress: -1 })
  const progressRef         = useRef(0)

  useImperativeHandle(transportRef, () => ({
    update (view) {
      const l             = last.current
      const p             = Math.min(1, Math.max(0, view.progress))
      progressRef.current = p

      const label = view.label || '—'
      if (label !== l.label && labelRef.current) {
        labelRef.current.textContent = label
        l.label                      = label
      }

      const mode = view.paused && view.mode === 'play' ? 'paused' : view.mode
      if (mode !== l.mode) {
        if (modeRef.current)
          modeRef.current.textContent = MODE_TEXT[mode]
        rootRef.current?.setAttribute('data-mode', mode)
        l.mode = mode
      }

      const count = counter(view.time)
      if (count !== l.counter && counterRef.current) {
        counterRef.current.textContent = count
        l.counter                      = count
      }
      if (Math.abs(p - l.progress) > 1e-4) {
        if (fillRef.current)
          fillRef.current.style.transform = `scaleX(${p})`
        trackRef.current?.setAttribute('aria-valuenow', String(Math.round(p * 100)))
        l.progress = p
      }

      // One divider per internal section boundary.
      const key = view.hasMarks ? String(view.sectionCount) : '0'
      if (key !== l.ticks) {
        l.ticks = key
        setTicks(view.hasMarks && view.sectionCount > 1
          ? Array.from({ length: view.sectionCount - 1 }, (_, i) => (i + 1) / view.sectionCount)
          : [])
      }
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

  return <aside ref={ rootRef } id="journey-transport" className="hud" data-mode="play">
    <div className="jt-head">
      <div className="jt-buttons">
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
      </div>

      <span className="jt-state">
        <span ref={ modeRef } className="jt-mode">{MODE_TEXT.play}</span>
        <span ref={ labelRef } className="jt-label">—</span>
      </span>

      <span ref={ counterRef } className="jt-counter">00:00</span>
    </div>

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
      <div ref={ fillRef } className="jt-fill" />

      {ticks.map(t =>
        <span key={ t } className="jt-tick" style={{ left: `${t * 100}%` }} />,
      )}
    </div>
  </aside>
}
