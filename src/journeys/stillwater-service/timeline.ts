import { lapLabel } from '@wjh/journey/label'
import type { JourneyMarks } from '@wjh/journey/types'
import { smootherstep } from '@wjh/math/scalar'


const DOOR = { overhead: 0, freight: 1, hatch: 2 } as const

export const ACTS = [
  { id: 'pool', title: 'THE LESSON POOL', seconds: 24, door: DOOR.overhead },
  { id: 'annex', title: 'THE ANNEX', seconds: 21, door: DOOR.freight },
  { id: 'lift', title: 'THE SERVICE LIFT', seconds: 18, door: DOOR.overhead },
  { id: 'breakwater', title: 'THE BREAKWATER', seconds: 34, door: DOOR.freight },
  { id: 'lounge', title: 'THE DROWNED LOUNGE', seconds: 23, door: DOOR.hatch },
  { id: 'carousel', title: 'LOST PROPERTY', seconds: 24, door: DOOR.freight },
] as const

const LAP_COUNT       = 3
const STARTS          = ACTS.map((_, i) => ACTS.slice(0, i).reduce((t, act) => t + act.seconds, 0))
const LAP_SECONDS     = ACTS.reduce((t, act) => t + act.seconds, 0)
const END             = LAP_COUNT * LAP_SECONDS
const SHUTTER_SECONDS = 0.72

export type Act = typeof ACTS[number]['id']

export function momentAt (time: number) {
  const lap    = Math.min(LAP_COUNT - 1, Math.floor(Math.max(0, time) / LAP_SECONDS))
  const within = Math.min(LAP_SECONDS, Math.max(0, time - lap * LAP_SECONDS))
  let section = STARTS.length - 1
  while (STARTS[section] > within)
    section--

  const act       = ACTS[section]
  const local     = within - STARTS[section]
  const arrival   = section === 0 && lap === 0 ? 0 : 1 - smootherstep(0, SHUTTER_SECONDS, local)
  const incoming  = ACTS[(section + ACTS.length - 1) % ACTS.length].door
  const departure = smootherstep(act.seconds - SHUTTER_SECONDS, act.seconds, local)
  return {
    id:        act.id,
    title:     act.title,
    lap,
    section,
    local,
    within,
    phase:     local / act.seconds,
    shutter:   Math.max(arrival, departure),
    door:      arrival > departure ? incoming : act.door,
    terminal:  time >= END,
    signalAge: Math.max(0, time - END),
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
