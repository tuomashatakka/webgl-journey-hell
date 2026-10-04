'use client'

import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Journey } from '✦/journeys/registry'
import { usePreview } from '✦/components/ShaderPreviewLayer'


interface JourneyCardState {
  mountRef:      RefObject<HTMLDivElement | null>;
  posterFailed:  boolean;
  onPosterError: () => void;
  onEnter:       () => void;
  onLeave:       () => void;
}

/**
 * A grid card's behaviour: hover or focus docks the shared preview canvas in
 * the card's mount slot, and a poster that 404s drops the art to the gradient.
 */
export function useJourneyCard (journey: Journey): JourneyCardState {
  const preview  = usePreview()
  const mountRef = useRef<HTMLDivElement>(null)

  const [ posterFailed, setPosterFailed ] = useState(false)

  const onEnter = () => {
    if (mountRef.current)
      preview?.activate(journey, mountRef.current)
  }
  const onLeave = () => preview?.deactivate(journey.slug)

  return { mountRef, posterFailed, onPosterError: () => setPosterFailed(true), onEnter, onLeave }
}
