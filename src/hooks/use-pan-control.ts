'use client'

// React wrapper around lib/panControl — pointer + gyroscope view panning with
// jump tweening. Every journey drives `uPointer` from this, so the input feel
// (and the iOS orientation-permission dance) lives in exactly one place.
//
//   const { pointerRef, updatePan } = usePanControl({ gyroscope: true })
//   ...
//   updatePan(dt)                                    // once per rendered frame
//   gl.uniform2f(loc, pointerRef.current.x, pointerRef.current.y)

import { useCallback, useEffect, useRef } from 'react'
import { createPanControl } from '@/lib/panControl'
import type { PanControl, PanControlOptions, PanVector } from '@/lib/panControl'


export interface PanControlHandle {

  /**
   * Latest tweened pan value. The ref (and the object inside it) keep a stable
   * identity for the lifetime of the component, so render loops can capture it
   * once and keep reading.
   */
  pointerRef: React.RefObject<PanVector>;

  /** Advance the tweens by `dt` seconds. Call once per rendered frame. */
  updatePan: (dt: number) => PanVector;

  /** Adopt the device's current pose as the neutral one. */
  recenterPan: () => void;
}

export function usePanControl (options: PanControlOptions = {}): PanControlHandle {
  const { invertX, invertY, gyroscope, getRect } = options

  const controlRef = useRef<PanControl | null>(null)
  const pointerRef = useRef<PanVector>({ x: 0, y: 0 })

  // Held in a ref so a caller passing an inline arrow doesn't re-create the
  // controller (and re-run the permission flow) on every render.
  const getRectRef = useRef(getRect)
  useEffect(() => {
    getRectRef.current = getRect
  }, [ getRect ])

  useEffect(() => {
    const control = createPanControl({
      invertX,
      invertY,
      gyroscope,
      getRect: () => getRectRef.current?.(),
    })
    controlRef.current = control

    return () => {
      control.dispose()
      controlRef.current = null
    }
  }, [ invertX, invertY, gyroscope ])

  const updatePan = useCallback((dt: number) => {
    const next = controlRef.current?.update(dt)
    if (next) {
      pointerRef.current.x = next.x
      pointerRef.current.y = next.y
    }
    return pointerRef.current
  }, [])

  const recenterPan = useCallback(() => controlRef.current?.recenter(), [])

  return { pointerRef, updatePan, recenterPan }
}

export default usePanControl
