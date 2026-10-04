import { useEffect } from 'react'
import { isKeyCaptured } from '@wjh/web/keyboard'
import { bindingFor, isLookKey, lookDirection } from '@wjh/web/keymap'
import type { KeyBinding } from '@wjh/web/keymap'
import type { JourneyRuntime } from '✦/hooks/use-journey-runtime'
import { useSettings } from '✦/components/SettingsProvider'


/**
 * The journey's keyboard, bound on window (the map is CONFIG.keys, the meaning
 * of a press is @wjh/web/keymap). Keys that belong to a field, a slider or an
 * open dialog are left alone; every key handled here is preventDefault-ed.
 * Space acts on keydown and is swallowed on keyup, so a focused button does not
 * also read the press as a click.
 */
export function useJourneyKeys (rt: Pick<JourneyRuntime, 'togglePause' | 'skip' | 'act' | 'look'>, enabled: boolean) {
  const { update }                       = useSettings()
  const { togglePause, skip, act, look } = rt

  useEffect(() => {
    if (!enabled)
      return

    const held = new Set<string>()

    const run = (binding: KeyBinding) => {
      switch (binding.kind) {
        case 'pause':
          togglePause()
          break
        case 'seek':
          skip(binding.seconds)
          break
        case 'loop':
          act(binding.action)
          break
        case 'speed':
          update({ speed: binding.value })
          break
      }
    }

    const pushLook = () => {
      const dir = lookDirection(held)
      look(dir.x, dir.y)
    }

    const down = (e: KeyboardEvent) => {
      if (isKeyCaptured(e.target))
        return

      if (isLookKey(e)) {
        e.preventDefault()
        held.add(e.code)
        pushLook()
        return
      }

      const binding = bindingFor(e)
      if (!binding)
        return
      e.preventDefault()
      if (!e.repeat || binding.kind === 'seek')
        run(binding)
    }

    const up = (e: KeyboardEvent) => {
      if (held.delete(e.code))
        pushLook()
      if (!isKeyCaptured(e.target) && bindingFor(e)?.kind === 'pause')
        e.preventDefault()
    }

    // A window that loses focus never sees the keyup: let go of everything.
    const release = () => {
      held.clear()
      pushLook()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      release()
    }
  }, [ enabled, togglePause, skip, act, look, update ])
}
