// The signal going. Shared by every journey; see components/withJourneyShell.
//
// A journey either ends somewhere it never leaves — the stairwell's purgatory,
// the switchback's fall, liminal's abyss, the orchard's compost — or it laps
// until the lapping has stopped meaning anything. Both used to just continue at
// full picture quality, which reads as "the demo is still running" rather than
// as the end of something. This is what marks it.
//
// The whole timeline is one pure function of one number: how many seconds the
// journey has spent in that state. That is not tidiness, it is the only shape
// that works here — `?t=` seeks by replaying a simulation from zero
// (lib/debugParams), so anything the picture depends on has to be derivable from
// simulation state rather than accumulated by whoever happened to be watching.
// The seconds themselves are counted inside each journey's own `step`, and
// arrive here through JourneyMarks.signalAge.

import { CONFIG } from '@wjh/config/config'
import { smootherstep } from '@wjh/math/scalar'


export interface SignalLoss {

  /** 0..CONFIG.signal.peak. 0 while the picture is still fine. */
  level: number;

  /** 0..1, how far the dB readout has faded in. */
  meter: number;

  /** Signal strength for that readout. */
  db: number;

  /** Seconds since onset; 0 before it. Every bit of noise is keyed off this. */
  age: number;
}

/** Deterministic, and deliberately not Math.random: a seek has to reproduce it. */
export function signalHash (n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return v - Math.floor(v)
}

/**
 * Reception at `age` seconds into the loss.
 *
 * Quantised to twelve steps a second because that is how often the overlay
 * redraws: sampling it at some other rate would draw a trace that disagrees with
 * the number printed beside it.
 */
export function dbAt (age: number): number {
  if (age <= 0)
    return CONFIG.signal.dbStart

  const k    = smootherstep(0, CONFIG.signal.rampSeconds, age)
  const base = CONFIG.signal.dbStart + (CONFIG.signal.dbFloor - CONFIG.signal.dbStart) * k

  // The needle gets less steady as the signal gets weaker, which is the one
  // thing a static readout would fail to say.
  const jitter = (signalHash(Math.floor(age * 12)) - 0.5) * (1.5 + k * 9)
  return base + jitter
}

/**
 * The whole sequence, from the seconds a journey has spent in its ending.
 *
 * Eased with smootherstep rather than linearly: a linear ramp has a corner at
 * both ends, and a corner at the exact moment the picture starts to fail reads
 * as a bug in the renderer rather than as a signal going.
 */
export function signalLossAt (signalAge: number): SignalLoss {
  const age = Math.max(0, signalAge - CONFIG.signal.graceSeconds)

  if (age <= 0)
    return { level: 0, meter: 0, db: CONFIG.signal.dbStart, age: 0 }

  return {
    level: CONFIG.signal.peak * smootherstep(0, CONFIG.signal.rampSeconds, age),
    meter: smootherstep(CONFIG.signal.meterDelaySeconds, CONFIG.signal.meterDelaySeconds + CONFIG.signal.meterFadeSeconds, age),
    db:    dbAt(age),
    age,
  }
}
