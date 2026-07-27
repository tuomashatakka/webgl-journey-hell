'use client'

// The gear button + settings panel, wired to the global SettingsProvider.
// Reused by the landing grid and by every templated journey (via withShaderJourney).

import { useEffect, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { useSettings } from './SettingsProvider'
import SettingsView from './SettingsView'


export default function SettingsButton () {
  const { settings, setSettings } = useSettings()
  const [ isOpen, setIsOpen ]     = useState(false)

  // Close on Escape or a click outside the dialog — only while open, and never
  // when the click lands inside the panel or on the gear itself.
  useEffect(() => {
    if (!isOpen)
      return

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t?.closest('#settings-dialog') && !t?.closest('#settings-btn'))
        setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        setIsOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [ isOpen ])

  return <>
    <button
      id="settings-btn"
      onClick={ () => setIsOpen(true) }
      title="Settings"
      aria-label="Open graphics settings">
      <SettingsIcon size={ 16 } />
    </button>

    <SettingsView
      isOpen={ isOpen }
      onClose={ () => setIsOpen(false) }
      settings={ settings }
      onChange={ setSettings } />
  </>
}
