'use client'

import { useJourneyKeys } from '✦/hooks/use-journey-keys'
import { useJourneyRuntimeContext } from './JourneyRuntimeContext'


/** Binds the journey's keyboard while mounted. Renders nothing. */
type JourneyKeysProps = { enabled: boolean }

export default function JourneyKeys ({ enabled }: JourneyKeysProps) {
  useJourneyKeys(useJourneyRuntimeContext(), enabled)
  return null
}
