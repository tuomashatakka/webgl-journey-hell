import { describe, expect, test } from 'bun:test'
import {
  SIGNAL_GRACE,
  SIGNAL_METER_DELAY,
  SIGNAL_PEAK,
  SIGNAL_RAMP,
  dbAt,
  signalLossAt,
} from './signalLoss.ts'


describe('signal loss timeline', () => {
  test('holds off until the journey has been in its ending a while', () => {
    for (const t of [ 0, 1, 4, SIGNAL_GRACE - 0.01 ]) {
      const s = signalLossAt(t)
      expect(s.level).toBe(0)
      expect(s.meter).toBe(0)
      expect(s.age).toBe(0)
    }
    expect(signalLossAt(SIGNAL_GRACE).level).toBe(0)
    expect(signalLossAt(SIGNAL_GRACE + 0.5).level).toBeGreaterThan(0)
  })

  // The ask was "at least 15 seconds before reaching its peak". Assert the
  // *slowness* rather than the shape: at the two-thirds mark it must still have
  // a visible way to go, which a ramp that secretly finished early would fail.
  test('takes the full ramp to arrive', () => {
    const at = a => signalLossAt(SIGNAL_GRACE + a).level

    expect(SIGNAL_RAMP).toBeGreaterThanOrEqual(15)
    expect(at(SIGNAL_RAMP * 0.5)).toBeLessThan(SIGNAL_PEAK * 0.6)
    expect(at(SIGNAL_RAMP * 0.67)).toBeLessThan(SIGNAL_PEAK * 0.85)
    expect(at(SIGNAL_RAMP - 0.5)).toBeLessThan(SIGNAL_PEAK)
    expect(at(SIGNAL_RAMP)).toBeCloseTo(SIGNAL_PEAK, 6)
  })

  test('eases in, so the onset is not a cut', () => {
    const at = a => signalLossAt(SIGNAL_GRACE + a).level

    // smootherstep leaves flat: the first second must move far less than the
    // middle of the ramp does, or the picture snaps when it starts failing.
    const first = at(1) - at(0)
    const mid   = at(SIGNAL_RAMP / 2 + 0.5) - at(SIGNAL_RAMP / 2 - 0.5)
    expect(first).toBeLessThan(mid * 0.25)

    // ...and arrives flat too.
    const last = at(SIGNAL_RAMP) - at(SIGNAL_RAMP - 1)
    expect(last).toBeLessThan(mid * 0.25)
  })

  test('never clears and never reaches nothing', () => {
    for (const a of [ SIGNAL_RAMP, 60, 600, 36_000 ]) {
      const s = signalLossAt(SIGNAL_GRACE + a)
      expect(s.level).toBeCloseTo(SIGNAL_PEAK, 6)
      expect(s.level).toBeLessThan(1)
    }
  })

  test('brings the meter in after the loss has been running a while', () => {
    const at = a => signalLossAt(SIGNAL_GRACE + a).meter

    expect(at(SIGNAL_METER_DELAY - 0.01)).toBe(0)
    expect(at(SIGNAL_METER_DELAY + 1.25)).toBeGreaterThan(0.2)
    expect(at(SIGNAL_METER_DELAY + 4)).toBe(1)
  })

  test('the readout falls, unsteadily, and settles', () => {
    expect(dbAt(0)).toBe(-12)

    const early = dbAt(1)
    const late  = dbAt(SIGNAL_RAMP)
    expect(late).toBeLessThan(early - 30)

    // The needle has to get *less* steady as the signal weakens, or the readout
    // says nothing a static number would not.
    const spread = range => {
      const vs = []
      for (let a = range[0]; a < range[1]; a += 1 / 12)
        vs.push(dbAt(a))
      return Math.max(...vs) - Math.min(...vs)
    }
    expect(spread([ 0.5, 3 ])).toBeLessThan(spread([ SIGNAL_RAMP, SIGNAL_RAMP + 2.5 ]))
  })

  // The load-bearing property: ?t= replays a simulation and redraws, so every
  // number the picture depends on must come back identical.
  test('is a pure function — the same instant twice is the same frame', () => {
    for (const t of [ 0, 9.37, 18.5, 23.0001, 91.7 ]) {
      const a = signalLossAt(t)
      const b = signalLossAt(t)
      expect(a).toEqual(b)
    }
  })
})
