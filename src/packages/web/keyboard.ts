// Keyboard helpers shared by every key binding.

/**
 * A key press that belongs to something else than the journey: a field being
 * typed in, a slider (it owns the arrows), or an open dialog (it owns space and
 * the arrows for its own controls).
 */
export function isKeyCaptured (target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el)
    return false

  return el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    !!el.closest?.('[role="slider"], [role="dialog"]')
}
