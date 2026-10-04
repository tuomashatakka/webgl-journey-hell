import { useCallback, useRef } from 'react'


/**
 * A tooltip is a manual popover anchored to its button with CSS anchor
 * positioning. Where either is unsupported the stylesheet's plain CSS tooltip
 * takes over and these handlers do nothing: no state, no effect.
 */
function supportsAnchoredPopover (): boolean {
  return typeof CSS !== 'undefined' &&
    CSS.supports('anchor-name: --a') &&
    typeof HTMLElement !== 'undefined' &&
    'showPopover' in HTMLElement.prototype
}

export function useTooltip () {
  const tipRef = useRef<HTMLElement>(null)

  const show = useCallback(() => {
    if (supportsAnchoredPopover())
      tipRef.current?.showPopover()
  }, [])

  const hide = useCallback(() => {
    if (tipRef.current?.matches(':popover-open'))
      tipRef.current.hidePopover()
  }, [])

  const showOnKeyboardFocus = useCallback((e: React.FocusEvent) => {
    if (e.target.matches(':focus-visible'))
      show()
  }, [ show ])

  return {
    tipRef,
    hostProps: { onPointerEnter: show, onPointerLeave: hide, onFocus: showOnKeyboardFocus, onBlur: hide },
  }
}
