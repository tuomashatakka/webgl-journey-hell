'use client'

// The overlay behind ?debug=1 — see packages/web/debugParams for the parameters.
//
// Deliberately not wired into React state per frame. A journey redraws sixty
// times a second and every uniform in it changes on every one of those frames;
// setState at that rate would put React's reconciler on the critical path of a
// GPU-bound loop and measurably cost frames. Instead the frame callback writes
// into a ref, and this samples that ref on its own slow interval — the numbers
// are for reading, and nobody can read sixty updates a second anyway.

import { CONFIG } from '@wjh/config/config'
import { useState } from 'react'
import { useSampled } from '✦/hooks/use-sampled'
import type { JourneyDebugState } from '@wjh/web/debugParams'


interface Props {
  getState: () => JourneyDebugState;
}

/** Enough precision to tell two frames apart, not so much that it is unreadable. */
function fmt (v: number): string {
  if (!Number.isFinite(v))
    return String(v)

  const a = Math.abs(v)
  if (a !== 0 && a < 0.001)
    return v.toExponential(1)
  return v.toFixed(a >= 100 ? 1 : 3)
}

function fmtValue (v: number | number[]): string {
  if (typeof v === 'number')
    return fmt(v)

  // Uniform arrays are packed as flat runs of vec4 (see packages/gl/uniforms), so
  // grouping them in fours is what makes them legible as what they actually are.
  if (v.length > 4) {
    const rows: string[] = []
    for (let i = 0; i < v.length; i += 4)
      rows.push(`[${Math.floor(i / 4)}] ` + v.slice(i, i + 4).map(fmt)
        .join('  '))
    return rows.join('\n')
  }
  return v.map(fmt).join('  ')
}

export default function JourneyDebugPanel ({ getState }: Props) {
  const state             = useSampled(getState, CONFIG.ui.debugPanelSampleMs)
  const [ open, setOpen ] = useState(true)

  if (!state)
    return null

  const entries = Object.entries(state.uniforms)

  return <aside className="journey-debug" id="journey-debug" data-open={ open ? '1' : '0' }>
    <button className="journey-debug-toggle" id="journey-debug-toggle" type="button" onClick={ () => setOpen(v => !v) }>
      {open ? '▾' : '▸'} DEBUG
    </button>

    {open &&
      <div className="journey-debug-body" id="journey-debug-body">
        <dl>
          <dt>time</dt>
          <dd>{state.time.toFixed(3)}s {state.seeking && '(frozen)'}</dd>
          <dt>label</dt>
          <dd>{state.label || '—'}</dd>
          <dt>buffer</dt>
          <dd>{state.width}×{state.height}</dd>
          <dt>fps</dt>
          <dd>{state.fps}</dd>
          <dt>ready</dt>
          <dd>{state.ready ? 'yes' : 'no'}</dd>
        </dl>

        {entries.length > 0 &&
          <>
            <h2>uniforms</h2>

            <dl>
              {entries.map(([ k, v ]) =>
                <div key={ k }>
                  <dt>{k}</dt>

                  <dd>
                    <pre>{fmtValue(v)}</pre>
                  </dd>
                </div>,
              )}
            </dl>
          </>
        }
      </div>
    }
  </aside>
}
