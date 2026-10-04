// Replaying a journey to an instant.

/** Upper bound on seek iterations, so `?t=1e9` cannot hang the tab. */
export const MAX_SEEK_STEPS = 200_000

/** Anything a seek can drive: the JourneySimulation subset it needs. */
export interface Steppable {
  step(dt: number, time: number): void;
}

/**
 * Walk a simulation from zero to `t` in fixed increments.
 *
 * Replayed rather than jumped to, because an integrating journey cannot be
 * jumped: natatorium advances `dist += speed * dt` and its speed depends on how
 * deep the water is where it already is, so the only way to know where t
 * seconds puts you is to walk it. The increment is derived by dividing t into a
 * whole number of steps rather than by stepping `dt` until it overshoots — that
 * way the final step is the same size as every other one, and t lands exactly.
 *
 * Returns the number of steps taken, which is capped so `?t=1e9` cannot hang.
 */
export function seekSimulation (sim: Steppable | null, t: number, dt: number): number {
  const steps = Math.min(Math.ceil(t / dt), MAX_SEEK_STEPS)
  if (steps <= 0)
    return 0

  const step = t / steps
  let acc    = 0
  for (let i = 0; i < steps; i++) {
    acc += step
    sim?.step(step, acc)
  }
  return steps
}
