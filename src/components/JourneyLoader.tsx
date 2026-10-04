'use client'

// The loading bar every journey shows before its title card.
//
// It is in the prerendered HTML, so it is on screen before the scripts have
// run. The fill moves by stage (scripts, shaders, textures, first frames; see
// hooks/use-journey-runtime), and a highlight sweeps the bar the whole time as
// a compositor-only animation — which keeps moving even while the main thread
// is blocked compiling shaders, the one stretch of the load that cannot
// report progress.

import { CONFIG } from '@wjh/config/config'
import type { JourneyLoading } from '✦/hooks/use-journey-runtime'


export default function JourneyLoader ({ progress, status, done, failed, detail }: JourneyLoading) {
  const p   = Math.min(1, Math.max(0, progress))
  const pct = Math.round(p * 100)

  return <div
    id="journey-loader"
    data-done={ done ? '1' : undefined }
    data-failed={ failed ? '1' : undefined }
    role="progressbar"
    aria-label="Loading"
    aria-valuemin={ 0 }
    aria-valuemax={ 100 }
    aria-valuenow={ pct }
    aria-valuetext={ status }>
    <div className="jl-bar">
      <div className="jl-fill" style={{ transform: `scaleX(${p})` }} />
    </div>

    <p className="jl-status">
      <span>{status}</span>
      {/* Padded with figure spaces — a digit's width — so the % stays put. */}
      {!failed && <span className="jl-pct">{String(pct).padStart(3, ' ')}%</span>}
    </p>

    {failed && detail && <p className="jl-detail">{detail}</p>}
  </div>
}
