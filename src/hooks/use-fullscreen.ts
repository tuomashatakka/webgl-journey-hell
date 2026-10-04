'use client'

import { useCallback, useEffect, useState } from 'react'


type UseFullscreenReturnType = { isFullscreen: boolean; toggle: () => void }

/** Fullscreen on the document element, and whether it is on right now. */
export default function useFullscreen (): UseFullscreenReturnType {
  const [ isFullscreen, setIsFullscreen ] = useState(false)

  // Followed rather than assumed: Esc, the browser's own UI and a phone's back
  // gesture all leave fullscreen without asking the button.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    sync()
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err)
      })
    else
      void document.exitFullscreen()
  }, [])

  return { isFullscreen, toggle }
}
