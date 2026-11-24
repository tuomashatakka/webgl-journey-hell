import { lapLabel } from '@wjh/journey/label'

import type { JourneyMarks } from '@wjh/journey/types'
import { smoothstep } from '@wjh/math/scalar'


export const ACTS = [
  { id: 'pool', title: 'THE LESSON POOL', seconds: 26 },
  { id: 'annex', title: 'THE ANNEX', seconds: 22 },
  { id: 'spiral', title: 'THE SPIRAL', seconds: 20 },
  { id: 'breakwater', title: 'THE BREAKWATER', seconds: 32 },
  { id: 'lounge', title: 'THE DROWNED LOUNGE', seconds: 20 },
  { id: 'carousel', title: 'LOST PROPERTY', seconds: 24 },
] as const

export const LAP_COUNT   = 3

export const LAP_SECONDS = ACTS.reduce((t, act) => t + act.seconds, 0)

const END         = LAP_COUNT * LAP_SECONDS

const STARTS = ACTS.map((_, i) => ACTS.slice(0, i).reduce((t, act) => t + act.seconds, 0))

export type Act = typeof ACTS[number]['id']


/**
 * How far the world has come apart: 0 through lap 1, rising across lap 2,
 * full through lap 3 and past it in the ending. Continuous in time, so no lap
 * seam shows; the slow pulse keeps it from ever settling.
 */
export function warpAt (time: number): number {
  const laps  = time / LAP_SECONDS
  const base  = 0.62 * smoothstep(1, 1.55, laps) + 0.58 * smoothstep(1.97, 2.3, laps) + 0.45 * smoothstep(END, END + 14, time)
  const pulse = 1 + 0.22 * Math.sin(time * 0.37) * Math.sin(time * 0.113 + 1.3)
  return base * pulse
}

/** The ending: buildings, trestles and flume dissolve, distance first. */
function dissolveAt (time: number): number {
  return smoothstep(END - 10, END + 12, time)
}

export function momentAt (time: number) {
  const clamped = Math.min(Math.max(0, time), END)
  const lap     = Math.min(LAP_COUNT - 1, Math.floor(clamped / LAP_SECONDS))
  const within  = clamped - lap * LAP_SECONDS
  let section   = STARTS.length - 1
  while (STARTS[section] > within)
    section--

  const act   = ACTS[section]
  const local = within - STARTS[section]
  return {
    id:        act.id,
    title:     act.title,
    lap,
    section,
    local,
    within,
    phase:     local / act.seconds,
    terminal:  time >= END,
    signalAge: Math.max(0, time - END),
    warp:      warpAt(time),
    dissolve:  dissolveAt(time),
  }
}

export function stillwaterMarksAt (time: number): JourneyMarks {
  const cue = momentAt(time)
  return {
    loop:         cue.lap,
    section:      cue.section,
    sectionCount: ACTS.length,
    progress:     cue.within / LAP_SECONDS,
    terminal:     cue.terminal,
    signalAge:    cue.signalAge,
  }
}

export function stillwaterLabelAt (time: number): string {
  const cue = momentAt(time)
  return lapLabel(cue.lap, cue.title)
}
