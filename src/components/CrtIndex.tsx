'use client'

// The index: the heading over a CRT in a dark room, tuned to one journey at a
// time (packages/web/crtRoom). ◀ / ▶ change the channel (←/→ too), MENU lays
// every journey over the picture (M; Esc closes it), and ENTER — or a click on
// the picture, or a pick from the menu — dollies into the tube while the
// picture fails, and lands in the journey. Without WebGL the tube shows the
// channel's poster instead.

import Image from 'next/image'
import { useRouter } from 'next/navigation'

import type { CrtChannel } from '@wjh/web/crtRoom'

import { JOURNEYS } from '✦/journeys/registry'

import type { Journey } from '✦/journeys/registry'

import { useCrtControls, useCrtRoom } from '✦/hooks/use-crt-room'


const CHANNELS: CrtChannel[] = JOURNEYS.map(j => ({ preview: j.previewShader, accent: j.accent }))

interface OsdProps {
  index:   number;
  journey: Journey;
  onEnter: () => void;
}

interface ItemProps {
  index:   number;
  journey: Journey;
  current: boolean;
  onPick:  (index: number) => void;
}

interface MenuProps {
  current: number;
  onPick:  (index: number) => void;
}

const channelNumber = (i: number) => String(i + 1).padStart(2, '0')

/** The on-screen display: the channel, the journey's name and tagline. The picture is the way in. */
function Osd ({ index, journey, onEnter }: OsdProps) {
  return <button className="crt-osd" aria-label={ `Enter ${journey.title}` } type="button" onClick={ onEnter }>
    <span className="crt-ch" aria-live="polite">CH {channelNumber(index)}</span>
    <span className="crt-name">{journey.title}</span>
    <span className="crt-tag">{journey.tagline}</span>
  </button>
}

function MenuItem ({ index, journey, current, onPick }: ItemProps) {
  return <li>
    <button className="crt-item" aria-current={ current ? 'true' : undefined } type="button" onClick={ () => onPick(index) }>
      <span className="crt-item-ch">{channelNumber(index)}</span>
      {journey.title}
    </button>
  </li>
}

/** Every journey, on the tube. */
function Menu ({ current, onPick }: MenuProps) {
  return <nav className="crt-menu" aria-label="All journeys">
    <ol>
      {JOURNEYS.map((j, i) => <MenuItem key={ j.slug } index={ i } journey={ j } current={ i === current } onPick={ onPick } />)}
    </ol>
  </nav>
}

export default function CrtIndex () {
  const router                                     = useRouter()
  const { canvasRef, overlayRef, roomRef, failed } = useCrtRoom(CHANNELS)
  const tv                                         = useCrtControls(roomRef, JOURNEYS.length, i => router.push(`/journeys/${JOURNEYS[i].slug}`))

  return <section className="crt-index" aria-label="Journeys" data-going={ tv.going ? '1' : undefined } data-failed={ failed ? '1' : undefined }>
    <canvas ref={ canvasRef } className="crt-canvas" aria-hidden="true" />

    <article ref={ overlayRef } className="crt-screen" data-menu={ tv.menu ? '1' : undefined }>
      {failed && <Image className="crt-poster" alt="" src={ JOURNEYS[tv.channel].poster } fill sizes="80vw" />}

      {tv.menu
        ? <Menu current={ tv.channel } onPick={ tv.enter } />
        : <Osd index={ tv.channel } journey={ JOURNEYS[tv.channel] } onEnter={ () => tv.enter(tv.channel) } />
      }
    </article>

    <nav className="crt-controls" aria-label="Channels">
      <button className="crt-btn" aria-label="Previous channel" type="button" title="Previous channel (←)" onClick={ () => tv.tune(tv.channel - 1) }>◀ CH</button>
      <button className="crt-btn" aria-pressed={ tv.menu } type="button" title="All journeys (M)" onClick={ () => tv.toggle(!tv.menu) }>MENU</button>
      <button className="crt-btn" type="button" title="Go in (Enter)" onClick={ () => tv.enter(tv.channel) }>ENTER ▸</button>
      <button className="crt-btn" aria-label="Next channel" type="button" title="Next channel (→)" onClick={ () => tv.tune(tv.channel + 1) }>CH ▶</button>
    </nav>
  </section>
}
