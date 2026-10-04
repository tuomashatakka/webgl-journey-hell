'use client'

// The journey's top bar: back to the index, fullscreen, mute, settings. Icons
// only (ToolbarButton names each one); the FPS readout sits at the far end.

import { ArrowLeft, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react'
import { useJourneyRuntimeContext } from './JourneyRuntimeContext'
import SettingsButton from './SettingsButton'
import ToolbarButton from './ToolbarButton'


const ICON = { 'size': 18, 'strokeWidth': 1.75, 'aria-hidden': true } as const

export default function JourneyToolbar () {
  const rt = useJourneyRuntimeContext()

  return <nav id="journey-toolbar" className="hud" aria-label="Journey controls">
    <ToolbarButton id="back-btn" label="Back to the index" href="/" align="start" icon={ <ArrowLeft { ...ICON } /> } />
    <span className="tb-spacer" />

    {rt.hasAudio &&
      <ToolbarButton
        id="audio-btn"
        align="end"
        label={ rt.audio.isMuted ? 'Unmute audio' : 'Mute audio' }
        pressed={ !rt.audio.isMuted }
        icon={ rt.audio.isMuted ? <VolumeX { ...ICON } /> : <Volume2 { ...ICON } /> }
        onClick={ rt.audio.toggle } />
    }

    <ToolbarButton
      id="fullscreen-btn"
      align="end"
      label={ rt.fullscreen ? 'Exit fullscreen' : 'Fullscreen' }
      pressed={ rt.fullscreen }
      icon={ rt.fullscreen ? <Minimize { ...ICON } /> : <Maximize { ...ICON } /> }
      onClick={ rt.toggleFullscreen } />

    <SettingsButton align="end" />
    <span ref={ rt.statsRef } id="fps-display">— FPS</span>
  </nav>
}
