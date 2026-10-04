import { useEffect } from 'react'


const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The focus contract of a modal panel: focus moves into it when it opens, Tab
 * stays inside it, Esc closes it, and focus goes back to what opened it.
 */
export function useDialogFocus (open: boolean, panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const panel = panelRef.current
    if (!open || !panel)
      return

    const opener = document.activeElement as HTMLElement | null
    panel.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab')
        return

      const items = [ ...panel.querySelectorAll<HTMLElement>(FOCUSABLE) ]
      if (items.length === 0) {
        e.preventDefault()
        return
      }

      const first = items[0]
      const last  = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault()
        last.focus()
      }
      else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [ open, panelRef, onClose ])
}
