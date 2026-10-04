'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CONFIG } from '@wjh/config/config'
import { detectDevice } from '@wjh/quality/device'
import { createCrtRoom } from '@wjh/web/crtRoom'
import type { CrtChannel, CrtRoom } from '@wjh/web/crtRoom'
import { frameLoopManager } from '@wjh/web/frameLoopManager'
import type { FrameLoopManager } from '@wjh/web/frameLoopManager'


/** Lay the overlay over the tube face: four custom properties, written straight to the element. */
function place (overlay: HTMLElement | null, room: CrtRoom): void {
  const r = room.screenRect()
  overlay?.style.setProperty('--sx', `${r.x}px`)
  overlay?.style.setProperty('--sy', `${r.y}px`)
  overlay?.style.setProperty('--sw', `${r.w}px`)
  overlay?.style.setProperty('--sh', `${r.h}px`)
}

/**
 * The index's CRT room on the returned canvas ref, drawn on the shared frame
 * loop, with the overlay ref kept over the tube face as the canvas resizes.
 * `failed` is true where WebGL (or the room's shader) is not to be had.
 */
export function useCrtRoom (channels: CrtChannel[]) {
  const canvasRef             = useRef<HTMLCanvasElement>(null)
  const overlayRef            = useRef<HTMLElement>(null)
  const roomRef               = useRef<CrtRoom | null>(null)
  const [ failed, setFailed ] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const room   = canvas && createCrtRoom(canvas, channels)
    if (!canvas || !room) {
      setFailed(true)
      return
    }

    roomRef.current               = room

    const { renderScale, maxDpr } = CONFIG.index
    const scale                   = Math.min(window.devicePixelRatio || 1, maxDpr) * renderScale[detectDevice().tier]
    const fit                     = () => {
      room.resize(canvas.clientWidth, canvas.clientHeight, scale)
      place(overlayRef.current, room)
    }
    const observer = new ResizeObserver(fit)
    const tick     = (m: FrameLoopManager) => room.frame(m.deltaTime)
    observer.observe(canvas)
    fit()
    frameLoopManager.registerSyncCallback(tick)

    return () => {
      frameLoopManager.unregisterSyncCallback(tick)
      observer.disconnect()
      room.dispose()
      roomRef.current = null
    }
  }, [ channels ])

  return { canvasRef, overlayRef, roomRef, failed }
}

/**
 * Channel, menu and the way in, as state for the view and as keys: ←/→ change
 * channel, M opens the menu (Esc closes it), Enter goes into the channel.
 * `enter` dollies into the tube and calls `onEnter` once the picture has failed.
 */
export function useCrtControls (roomRef: React.RefObject<CrtRoom | null>, count: number, onEnter: (index: number) => void) {
  const [ channel, setChannel ] = useState(0)
  const [ menu, setMenu ]       = useState(false)
  const [ going, setGoing ]     = useState(false)

  const tune   = useCallback((index: number) => {
    const next = (index % count + count) % count
    roomRef.current?.tune(next)
    setChannel(next)
  }, [ count, roomRef ])
  const toggle = useCallback((open: boolean) => {
    roomRef.current?.setMenu(open)
    setMenu(open)
  }, [ roomRef ])
  const enter  = useCallback((index: number) => {
    if (going)
      return
    tune(index)
    toggle(false)
    setGoing(true)

    const room = roomRef.current
    if (room)
      room.zoom(() => onEnter(index))
    else
      onEnter(index)
  }, [ going, onEnter, roomRef, toggle, tune ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (going || e.metaKey || e.ctrlKey || e.altKey)
        return

      const act: Record<string, () => void> = {
        ArrowRight: () => tune(channel + 1),
        ArrowLeft:  () => tune(channel - 1),
        Enter:      () => enter(channel),
        m:          () => toggle(!menu),
        Escape:     () => toggle(false),
      }
      const run = act[e.key]
      if (!run || e.key === 'Enter' && (e.target as HTMLElement | null)?.closest('button, a'))
        return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ channel, enter, going, menu, toggle, tune ])

  return { channel, menu, going, tune, toggle, enter }
}
