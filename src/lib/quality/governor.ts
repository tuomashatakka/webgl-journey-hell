// Adaptive resolution: hold the frame rate by moving the render scale.
//
// Fragment cost is proportional to pixel count, so the scale that would turn a
// frame time `t` into the budget `b` is √(b / t). The governor measures a
// window of frames, steps down by that (clamped) when it is over budget, and
// steps back up carefully — vsync quantises frame times, so a GPU with headroom
// and a GPU exactly at the budget both read as 16.7 ms. The only way to find
// headroom is to try a little more and see. A probe that fails is reverted and
// the next one waits twice as long, so a device that is exactly at its limit
// settles instead of oscillating.

import { clamp } from '../math'


export interface GovernorOptions {

  /** Render scale bounds and starting point (multiples of CSS pixels). */
  min:   number;
  max:   number;
  start: number;

  /** Frame rate to hold. */
  targetFps: number;
}

export interface Governor {
  readonly scale: number;

  /** Feed one real frame time. True when the scale changed. */
  sample(dt: number): boolean;

  /** Retarget (the frame cap changed) and re-measure from where it is. */
  setTarget(fps: number): void;
}

/** Frames per measurement window. */
const WINDOW = 24

/** Scale steps are quantised so a reallocation is never for a rounding error. */
const QUANTUM = 0.05

/** Over budget by more than this fraction → step down. */
const OVER = 1.2

/** Within this fraction of budget → the window counts as "holding". */
const HOLD = 1.06

/** Holding windows before the first probe up, and its ceiling after backoff. */
const PROBE_AFTER     = 4
const PROBE_AFTER_MAX = 32

const PROBE_STEP = 1.1

export function createGovernor (opts: GovernorOptions): Governor {
  const frames = new Float32Array(WINDOW)
  const sorted = new Float32Array(WINDOW)
  let count                    = 0
  let budget                   = 1 / Math.max(1, opts.targetFps)
  let scale                    = quantise(clamp(opts.start, opts.min, opts.max))
  let holding                  = 0
  let probeWait                = PROBE_AFTER
  let probeFrom: number | null = null

  function quantise (s: number): number {
    return Math.round(s / QUANTUM) * QUANTUM
  }

  /** Mean of the middle of the window: one hitch must not move the scale. */
  const trimmedMean = (): number => {
    sorted.set(frames)
    sorted.sort()

    const lo = Math.floor(WINDOW * 0.2)
    const hi = Math.ceil(WINDOW * 0.8)
    let sum  = 0
    for (let i = lo; i < hi; i++)
      sum += sorted[i]
    return sum / (hi - lo)
  }

  const set = (next: number): boolean => {
    const q = quantise(clamp(next, opts.min, opts.max))
    if (Math.abs(q - scale) < QUANTUM * 0.5)
      return false
    scale = q
    return true
  }

  return {
    get scale () {
      return scale
    },

    sample (dt) {
      // A hidden tab or a breakpoint is not a slow GPU.
      if (!(dt > 0) || dt > 0.25)
        return false
      frames[count++] = dt
      if (count < WINDOW)
        return false
      count = 0

      const mean = trimmedMean()

      if (mean > budget * OVER) {
        holding = 0
        if (probeFrom !== null) {
          // The probe cost more than there was: go back, wait longer next time.
          const back = probeFrom
          probeFrom  = null
          probeWait  = Math.min(PROBE_AFTER_MAX, probeWait * 2)
          return set(back)
        }
        return set(scale * clamp(Math.sqrt(budget / mean), 0.72, 0.95))
      }

      if (mean <= budget * HOLD) {
        probeFrom = null
        holding  += 1
        if (holding >= probeWait && scale < opts.max) {
          holding   = 0
          probeFrom = scale
          return set(scale * PROBE_STEP)
        }
      }
      return false
    },

    setTarget (fps) {
      budget    = 1 / Math.max(1, fps)
      count     = 0
      holding   = 0
      probeFrom = null
      probeWait = PROBE_AFTER
    },
  }
}
