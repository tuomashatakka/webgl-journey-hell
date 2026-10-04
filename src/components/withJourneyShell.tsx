'use client'

// withJourneyShell(definition) — every journey route.
//
// A journey is declared once (app/journeys/<slug>/journey.ts) and its page is
// one line: `export default withJourneyShell(definition)`. Everything that runs
// it lives in hooks/use-journey-runtime; this file is only the view over that
// engine — the canvas, the HUD, the transport, the title card.
//
// Global graphics settings arrive through the runtime:
//   • resolution  → AUTO hands the render scale to the adaptive governor
//   • speed       → the time base the simulation steps on
//   • brightness / contrast → the CRT pass's display grade
//   • maxFrameRate→ the shared frame loop's cap, and the governor's target
//   • gyroscope   → device-orientation camera panning
//   • crt         → the tube treatment (and the CSS scanline layer)
//
// The debug query parameters (lib/debugParams) are honoured here for every
// journey at once: ?t= freezes an instant, ?debug publishes state, ?hud=0
// strips the chrome, ?w=&h= fix the backing store.

import { useState } from 'react'
import Link from 'next/link'
import type { JourneyDefinition } from '✦/lib/journey'
import { getJourney } from '✦/app/journeys/registry'
import { useJourneyRuntime } from '✦/hooks/use-journey-runtime'
import { detectDevice } from '✦/lib/quality'
import { useSettings } from './SettingsProvider'
import SettingsButton from './SettingsButton'
import JourneyDebugPanel from './JourneyDebugPanel'
import JourneyTransport from './JourneyTransport'
import JourneyTitleIntro from './JourneyTitleIntro'


export function withJourneyShell (definition: JourneyDefinition) {
  const meta = getJourney(definition.slug)

  function JourneyShell () {
    const { settings } = useSettings()
    const rt           = useJourneyRuntime(definition)
    const { dbg }      = rt

    // The title card plays once per mount, and never under ?t= or without a
    // HUD: a driver's frame must be the journey, not the card over it.
    const [ introDone, setIntroDone ] = useState(false)
    const showIntro                   = !introDone && dbg.hud && dbg.t === null && !!meta

    // The CSS scanline layer is part of the look where the CRT is on; on a
    // low-tier phone it is a full-screen blend at native resolution that the
    // GL pass's own scanlines already cover.
    const scanlines = settings.crt && detectDevice().tier > 0

    const accentStyle = meta?.accent
      ? ({ ['--accent' as string]: meta.accent } as React.CSSProperties)
      : undefined

    return <main id="app-container" style={ accentStyle }>
      <canvas id="gl-canvas" ref={ rt.canvasRef } />
      {scanlines && <section id="crt-overlay" />}

      {dbg.hud &&
        <Link id="back-btn" href="/">
          ← INDEX
        </Link>
      }

      {dbg.hud && rt.sectionName && !showIntro &&
        <header
          key={ rt.sectionKey }
          id="sector-title"
          className={ definition.sectionTitleClassName }
          data-text={ rt.sectionName }>
          {rt.sectionName}
        </header>
      }

      {dbg.hud &&
        <button id="fullscreen-btn" onClick={ rt.toggleFullscreen }>
          FULLSCREEN
        </button>
      }

      {dbg.hud && definition.createAudio &&
        <button id="audio-btn" onClick={ rt.audio.toggle }>
          {rt.audio.isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
        </button>
      }

      {dbg.hud && <aside id="fps-display" ref={ rt.statsRef }>— FPS</aside>}
      {dbg.hud && <SettingsButton />}

      {/* Frozen ?t= mode gets no transport: the frame is a pure function of the URL. */}
      {dbg.hud && dbg.t === null &&
        <JourneyTransport
          ref={ rt.transportRef }
          onAction={ rt.act }
          onScrub={ rt.scrub }
          onRelease={ rt.release } />
      }

      {showIntro &&
        <JourneyTitleIntro
          title={ meta.title }
          subtitle={ meta.tagline }
          accent={ meta.accent }
          onDone={ () => setIntroDone(true) } />
      }

      {dbg.debug && <JourneyDebugPanel getState={ () => window.__journeyDebug ?? rt.debugState() } />}
    </main>
  }

  JourneyShell.displayName = `JourneyShell(${definition.slug})`
  return JourneyShell
}

export default withJourneyShell
