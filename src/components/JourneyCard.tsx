'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRef } from 'react'
import type { Journey } from '@/app/journeys/registry'
import { usePreview } from './ShaderPreviewLayer'


type JourneyCardProps = { journey: Journey }

export default function JourneyCard ({ journey }: JourneyCardProps) {
  const preview  = usePreview()
  const mountRef = useRef<HTMLDivElement>(null)

  const onEnter = () => {
    if (mountRef.current)
      preview?.activate(journey, mountRef.current)
  }
  const onLeave = () => preview?.deactivate(journey.slug)

  return <Link
    href={ `/journeys/${journey.slug}` }
    className="journey-card"
    style={{ ['--accent' as string]: journey.accent }}
    onMouseEnter={ onEnter }
    onMouseLeave={ onLeave }
    onFocus={ onEnter }
    onBlur={ onLeave }>
    <div
      className="journey-card__poster"
      style={{
        background: `linear-gradient(135deg, ${journey.gradient[0]}, ${journey.gradient[1]})`,
      }}>
      {journey.poster &&
          <Image
            src={ journey.poster }
            alt={ journey.title }
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="journey-card__img" />
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
