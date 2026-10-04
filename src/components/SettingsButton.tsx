'use client'

// The gear + the settings panel, wired to the global SettingsProvider. Reused
// by the landing grid's footer and by every journey's toolbar.

import { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { useSettings } from './SettingsProvider'
import SettingsView from './SettingsView'
import ToolbarButton from './ToolbarButton'


type SettingsButtonProps = { side?: 'top' | 'bottom'; align?: 'start' | 'center' | 'end' }

export default function SettingsButton ({ side, align }: SettingsButtonProps) {
  const { settings, setSettings } = useSettings()
  const [ isOpen, setIsOpen ]     = useState(false)

  return <>
    <ToolbarButton
      id="settings-btn"
      label="Graphics and controls"
      side={ side }
      align={ align }
      onClick={ () => setIsOpen(true) }
      icon={ <SettingsIcon size={ 18 } strokeWidth={ 1.75 } aria-hidden /> } />

    <SettingsView
      isOpen={ isOpen }
      onClose={ () => setIsOpen(false) }
      settings={ settings }
      onChange={ setSettings } />
  </>
}
