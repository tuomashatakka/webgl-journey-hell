import { useEffect } from 'react'
import { isTyping } from '@wjh/web/keyboard'


/**
 * Space pauses and resumes, wherever focus is — the way a player's space bar
 * does. Taken on keyup as well as keydown, so a focused button does not also
 * read the press as a click (the pause button would toggle twice).
 */
export function usePauseKey (toggle: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled)
      return

    const isSpace = (e: KeyboardEvent) =>
      (e.code === 'Space' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)

    const down = (e: KeyboardEvent) => {
      if (!isSpace(e))
        return
      e.preventDefault()
      if (!e.repeat)
        toggle()
    }
    const up = (e: KeyboardEvent) => {
      if (isSpace(e))
        e.preventDefault()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [ toggle, enabled ])
}
