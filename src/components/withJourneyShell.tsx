'use client'

// withJourneyShell(definition) — every journey route.
//
// A journey is declared once (src/journeys/<slug>/journey.ts) and its page is
// one line: `export default withJourneyShell(definition)`. Everything that runs
// it lives in hooks/use-journey-runtime; this file is only the view over that
// engine — the canvas, the HUD, the transport, the overlays.
//
// A page opens in three beats:
//
//   1. the loading bar — prerendered, so it is up before any script has run
//   2. the title card, once the journey is loaded and its clock has started
//   3. the journey, with a heading glitching in whenever the section changes
//
// None of them under ?t= or ?hud=0: a driver's frame must be the journey, not
// the chrome over it.
//
// Fullscreen is the picture alone: every piece of chrome fades and stops
// taking the pointer (keyboard focus still brings a control back). Space
// pauses and resumes everywhere but a text field; Esc leaves fullscreen.
//
// Global graphics settings arrive through the runtime:
//   • resolution  → AUTO hands the render scale to the adaptive governor
//   • speed       → the time base the simulation steps on
//   • brightness / contrast → the CRT pass's display grade
//   • maxFrameRate→ the shared frame loop's cap, and the governor's target
//   • gyroscope   → device-orientation camera panning
//   • crt         → the tube treatment (and the CSS scanline layer)
//
// The debug query parameters (web/debugParams) are honoured here for every
// journey at once: ?t= freezes an instant, ?debug publishes state, ?hud=0
// strips the chrome, ?w=&h= fix the backing store.

import Link from 'next/link'
import type { JourneyDefinition } from '@wjh/journey/definition'
import { getJourney } from '✦/journeys/registry'
import { useJourneyRuntime } from '✦/hooks/use-journey-runtime'
import { detectDevice } from '@wjh/quality/device'
import { useMounted } from '✦/hooks/use-mounted'
import { useOpening } from '✦/hooks/use-opening'
import { usePauseKey } from '✦/hooks/use-pause-key'
import { useSettings } from './SettingsProvider'
import SettingsButton from './SettingsButton'
import JourneyDebugPanel from './JourneyDebugPanel'
import JourneyTransport from './JourneyTransport'
import JourneyLoader from './JourneyLoader'
import { SectionHeading, TitleCard } from './GlitchTitle'


export function withJourneyShell (definition: JourneyDefinition) {
  const meta = getJourney(definition.slug)

  function JourneyShell () {
    const { settings }              = useSettings()
    const rt                        = useJourneyRuntime(definition)
    const { dbg, loading, section } = rt
    const accent                    = meta?.accent ?? '#ffffff'

    // The opening sequence plays once per mount.
    const staged  = dbg.hud && dbg.t === null
    const opening = useOpening({ staged, hasCard: !!meta, loading, sectionKey: section.key, sectionNamed: !!section.name })

    usePauseKey(rt.togglePause, dbg.t === null && opening.opened)

    // The CSS scanline layer is part of the look where the CRT is on; on a
    // low-tier phone it is a full-screen blend at native resolution that the
    // GL pass's own scanlines already cover. Decided after mount: the saved
    // settings and the device are client facts, and the prerendered HTML has
    // to match the first client render.
    const mounted = useMounted()

    const scanlines = !mounted || settings.crt && detectDevice().tier > 0

    const accentStyle = meta?.accent
      ? ({ ['--accent' as string]: meta.accent } as React.CSSProperties)
      : undefined

    return <main id="app-container" style={ accentStyle } data-fullscreen={ rt.fullscreen ? '1' : undefined }>
      <canvas id="gl-canvas" ref={ rt.canvasRef } />
      {scanlines && <section id="crt-overlay" />}

      {dbg.hud &&
        <Link id="back-btn" className="hud" href="/">
          ← INDEX
        </Link>
      }

      {opening.showHeading &&
        <SectionHeading
          key={ section.key }
          title={ section.name }
          accent={ accent }
          onDone={ opening.finishHeading } />
      }

      {dbg.hud &&
        <button id="fullscreen-btn" className="hud" onClick={ rt.toggleFullscreen }>
          {rt.fullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
        </button>
      }

      {dbg.hud && definition.createAudio &&
        <button id="audio-btn" className="hud" onClick={ rt.audio.toggle }>
          {rt.audio.isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
        </button>
      }

      {dbg.hud && <aside id="fps-display" className="hud" ref={ rt.statsRef }>— FPS</aside>}
      {dbg.hud && <SettingsButton />}

      {/* Frozen ?t= mode gets no transport: the frame is a pure function of the URL. */}
      {dbg.hud && dbg.t === null &&
        <JourneyTransport
          ref={ rt.transportRef }
          paused={ rt.paused }
          onTogglePause={ rt.togglePause }
          onAction={ rt.act }
          onScrub={ rt.scrub }
          onRelease={ rt.release } />
      }

      {opening.showIntro && meta &&
        <TitleCard
          title={ meta.title }
          subtitle={ meta.tagline }
          accent={ meta.accent }
          onDone={ opening.finishIntro } />
      }

      {opening.showLoader && <JourneyLoader { ...loading } />}
      {dbg.debug && <JourneyDebugPanel getState={ () => window.__journeyDebug ?? rt.debugState() } />}
    </main>
  }

  JourneyShell.displayName = `JourneyShell(${definition.slug})`
  return JourneyShell
}
