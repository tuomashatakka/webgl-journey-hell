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
// taking the pointer (keyboard focus still brings a control back). The
// keyboard is JourneyKeys (CONFIG.keys); Esc leaves fullscreen. Components
// under the shell read the runtime from context rather than through props.
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

import type { JourneyDefinition } from '@wjh/journey/definition'

import { getJourney } from '✦/journeys/registry'

import type { Journey } from '✦/journeys/registry'

import { useJourneyRuntime } from '✦/hooks/use-journey-runtime'

import { detectDevice } from '@wjh/quality/device'

import { useMounted } from '✦/hooks/use-mounted'

import { useOpening } from '✦/hooks/use-opening'

import { useSettings } from './SettingsProvider'

import JourneyKeys from './JourneyKeys'

import JourneyToolbar from './JourneyToolbar'

import { JourneyRuntimeProvider, useJourneyRuntimeContext } from './JourneyRuntimeContext'

import JourneyDebugPanel from './JourneyDebugPanel'

import JourneyTransport from './JourneyTransport'

import JourneyLoader from './JourneyLoader'

import { SectionHeading, TitleCard } from './GlitchTitle'

/** The journey's accent as the --accent all the chrome reads — in the prerendered HTML too. */
type AccentStyleProps = { accent?: string }

interface OpeningProps {
  meta:    Journey | undefined;
  opening: ReturnType<typeof useOpening>;
}

function AccentStyle ({ accent }: AccentStyleProps) {
  return accent ? <style>{`#app-container { --accent: ${accent}; }`}</style> : null
}

/**
 * The CSS scanline layer is part of the look where the CRT is on; on a
 * low-tier phone it is a full-screen blend at native resolution that the GL
 * pass's own scanlines already cover. Decided after mount: the saved settings
 * and the device are client facts, and the prerendered HTML has to match the
 * first client render.
 */
function Scanlines () {
  const { settings } = useSettings()
  const mounted      = useMounted()
  return !mounted || settings.crt && detectDevice().tier > 0 ? <section className="crt-overlay" id="crt-overlay" /> : null
}

/** The title card (which starts the clock as it tears away) over the loading bar. */
function Opening ({ meta, opening }: OpeningProps) {
  const { loading, begin } = useJourneyRuntimeContext()
  return <>
    {opening.showIntro && meta &&
      <TitleCard title={ meta.title } subtitle={ meta.tagline } accent={ meta.accent } onDone={ opening.finishIntro } onOut={ begin } />
    }

    {opening.showLoader && <JourneyLoader { ...loading } />}
  </>
}

export function withJourneyShell (definition: JourneyDefinition) {
  const meta = getJourney(definition.slug)

  function JourneyShell () {
    const rt                        = useJourneyRuntime(definition)
    const { dbg, loading, section } = rt
    const staged                    = dbg.hud && dbg.t === null
    const opening                   = useOpening({ staged, hasCard: !!meta, begin: rt.begin, loading, sectionKey: section.key, sectionNamed: !!section.name })

    return <JourneyRuntimeProvider value={ rt }>
      <main className="app-container" id="app-container" data-fullscreen={ rt.fullscreen ? '1' : undefined }>
        <AccentStyle accent={ meta?.accent } />
        <canvas ref={ rt.canvasRef } className="gl-canvas" id="gl-canvas" />
        <Scanlines />

        {opening.showHeading &&
        <SectionHeading
          key={ section.key }
          title={ section.name }
          accent={ meta?.accent ?? '#ffffff' }
          onDone={ opening.finishHeading } />
        }

        {dbg.hud && <JourneyToolbar />}
        {/* Frozen ?t= mode gets no transport: the frame is a pure function of the URL. */}
        {dbg.hud && dbg.t === null && <JourneyTransport />}
        <Opening meta={ meta } opening={ opening } />
        {dbg.debug && <JourneyDebugPanel getState={ () => window.__journeyDebug ?? rt.debugState() } />}
        <JourneyKeys enabled={ dbg.t === null && opening.opened } />
      </main>
    </JourneyRuntimeProvider>
  }

  JourneyShell.displayName = `JourneyShell(${definition.slug})`
  return JourneyShell
}
