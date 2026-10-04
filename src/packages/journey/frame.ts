// What a journey shows at an instant, evaluated the same way everywhere.
//
// The shell's live frame, its frozen `?t=` frame and the bare harness all used
// to assemble this themselves — and a harness that disagreed with the shell
// would lie about what a URL renders. One function now.

import type { CustomUniforms } from '@wjh/gl/uniforms'
import { signalLossAt } from './signalLoss'
import type { JourneyDefinition } from './definition'
import type { JourneyMarks, JourneySimulation } from './types'


export interface FrameState {

  /** The uniform map to draw with (the simulation's, plus uSignalLoss). */
  custom?: CustomUniforms;
  marks:   JourneyMarks | null;

  /** Section title. */
  label: string;

  /** Live readout for the transport bar (speed, altitude). */
  detail: string;
}

/**
 * Evaluate a journey at `time`. The signal-loss level rides along as a uniform
 * because a journey whose world reacts to the failing signal (skybridges' sun)
 * has to be told: the CRT pass degrades the picture and knows nothing about the
 * world in it. A journey without a simulation has no uniform map of its own,
 * so one is made for it.
 */
export function evaluateFrame (
  definition: Pick<JourneyDefinition, 'marksAt' | 'sectionNameAt'>,
  sim: JourneySimulation | null,
  time: number,
): FrameState {
  const marks = marksOf(definition, sim, time)
  return {
    custom: withSignal(sim?.uniforms(), marks),
    marks,
    label:  labelOf(definition, sim, time),
    detail: sim?.detail?.() ?? '',
  }
}

function marksOf (definition: Pick<JourneyDefinition, 'marksAt'>, sim: JourneySimulation | null, time: number): JourneyMarks | null {
  return sim?.marks?.() ?? definition.marksAt?.(time) ?? null
}

function labelOf (definition: Pick<JourneyDefinition, 'sectionNameAt'>, sim: JourneySimulation | null, time: number): string {
  return sim?.label?.() ?? definition.sectionNameAt?.(time) ?? ''
}

/** The uniform map, with the signal-loss level added once the signal is going. */
function withSignal (custom: CustomUniforms | undefined, marks: JourneyMarks | null): CustomUniforms | undefined {
  if (!marks?.signalAge)
    return custom
  return { ...custom, uSignalLoss: signalLossAt(marks.signalAge).level }
}

/** Title plus the live detail, the way the transport bar shows them. */
export function hudLabel (label: string, detail?: string): string {
  return detail ? `${label} · ${detail}` : label
}
