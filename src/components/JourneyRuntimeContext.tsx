'use client'

// The running journey, for the components under withJourneyShell that need it
// (the toolbar, the transport, the key bindings): they read it from here
// instead of having it handed down prop by prop.

import { createContext, useContext } from 'react'
import type { JourneyRuntime } from '✦/hooks/use-journey-runtime'


const RuntimeCtx = createContext<JourneyRuntime | null>(null)

export const JourneyRuntimeProvider = RuntimeCtx.Provider

export function useJourneyRuntimeContext (): JourneyRuntime {
  const rt = useContext(RuntimeCtx)
  if (!rt)
    throw new Error('useJourneyRuntimeContext must be used within a journey page')
  return rt
}
