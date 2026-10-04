'use client'

// The loading bar every journey shows before its title card.
//
// It is in the prerendered HTML, so it is on screen before the scripts have
// run. The fill moves by stage (scripts, shaders, textures, first frames; see
// hooks/use-journey-runtime), and a highlight sweeps the bar the whole time as
// a compositor-only animation — which keeps moving even while the main thread
// is blocked compiling shaders, the one stretch of the load that cannot
// report progress.

import type { JourneyLoading } from '@wjh/journey/engine'


export default function JourneyLoader ({ progress, status, done, failed, detail }: JourneyLoading) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100)

  return <section
    className="journey-loader"
    id="journey-loader"
    data-done={ done ? '1' : undefined }
    data-failed={ failed ? '1' : undefined }
    aria-label="Loading">
    <span className="jl-track">
      <svg
        className="jl-bar"
        aria-valuemax={ 100 }
        aria-valuemin={ 0 }
        aria-valuenow={ pct }
        aria-valuetext={ status }
        role="progressbar"
        viewBox="0 0 100 1"
        preserveAspectRatio="none">
        <rect width={ pct } height={ 1 } />
      </svg>
    </span>

    <p className="jl-status">
      <span>{status}</span>
      {/* Padded with figure spaces — a digit's width — so the % stays put. */}
      {!failed && <span className="jl-pct">{String(pct).padStart(3, ' ')}%</span>}
    </p>

    {failed && detail && <p className="jl-detail">{detail}</p>}
  </section>
}
