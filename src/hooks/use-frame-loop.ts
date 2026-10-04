'use client'

import { useEffect } from 'react'
import { frameLoopManager } from '✦/lib/frameLoopManager'
import type { FrameLoopManager } from '✦/lib/frameLoopManager'


/**
 * Register a callback that runs once per (capped) frame for the component's
 * lifetime — synchronously inside the rAF callback, so a frame is drawn in the
 * frame it was scheduled for rather than in a microtask after it.
 */
const useFrameLoop = (callback: (manager: FrameLoopManager) => void) => {
  useEffect(() => {
    frameLoopManager.registerSyncCallback(callback)
    return () => {
      frameLoopManager.unregisterSyncCallback(callback)
    }
  }, [ callback ])
}

export default useFrameLoop
