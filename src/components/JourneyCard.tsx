'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { Journey } from '✦/journeys/registry'
import { useJourneyCard } from '✦/hooks/use-journey-card'


type JourneyCardProps = { journey: Journey }

export default function JourneyCard ({ journey }: JourneyCardProps) {
  // Fallback chain for the tile art: live shader preview (hover, WebGL only) →
  // journey screenshot → the journey's CSS gradient. The screenshot is what a
  // touch device or a WebGL-less browser actually sees, so it is never merely
  // decorative; `posterFailed` drops to the gradient if the file 404s.
  //
  // The poster URL comes from a static import (staticUrl), so it already carries
  // the basePath: an unoptimized next/image emits its src verbatim, which is why
  // a raw '/journeys/x.jpg' string 404ed under the sub-path deploy.
  const { mountRef, posterFailed, onPosterError, onEnter, onLeave } = useJourneyCard(journey)

  return <Link
    className="journey-card"
    style={{ ['--accent' as string]: journey.accent }}
    href={ `/journeys/${journey.slug}` }
    onMouseEnter={ onEnter }
    onMouseLeave={ onLeave }
    onFocus={ onEnter }
    onBlur={ onLeave }>
    <div
      className="journey-card__poster"
      style={{
        background: `linear-gradient(135deg, ${journey.gradient[0]}, ${journey.gradient[1]})`,
      }}>
      {journey.poster && !posterFailed &&
          <Image
            className="journey-card__img"
            src={ journey.poster }
            alt={ `${journey.title} — still from the journey` }
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            onError={ onPosterError } />
      }

      {/* Empty mount point — the shared preview canvas docks here on hover.
            Kept childless so React never reconciles away the appended canvas. */}
      <div ref={ mountRef } className="journey-card__mount" />
      <span className="journey-card__scan" aria-hidden />
    </div>

    <div className="journey-card__body">
      <h2 className="journey-card__title" data-text={ journey.title }>
        {journey.title}
      </h2>

      <p className="journey-card__tagline">{journey.tagline}</p>

      <ul className="journey-card__tags">
        {journey.tags.map(t =>
          <li key={ t } className="journey-card__tag">
            {t}
          </li>
        )}
      </ul>
    </div>
  </Link>
}
