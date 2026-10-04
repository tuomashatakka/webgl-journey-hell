// Keyboard helpers shared by every key binding.

/** A key press that belongs to a field being typed in, not to the journey. */
export function isTyping (target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
