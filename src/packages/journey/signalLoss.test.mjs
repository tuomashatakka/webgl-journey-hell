import { CONFIG } from '@wjh/config/config'
import { describe, expect, test } from 'bun:test'
import { dbAt, signalLossAt } from './signalLoss'


describe('signal loss timeline', () => {
  test('holds off until the journey has been in its ending a while', () => {
    for (const t of [ 0, 1, 4, CONFIG.signal.graceSeconds - 0.01 ]) {
      const s = signalLossAt(t)
      expect(s.level).toBe(0)
      expect(s.meter).toBe(0)
      expect(s.age).toBe(0)
    }
    expect(signalLossAt(CONFIG.signal.graceSeconds).level).toBe(0)
    expect(signalLossAt(CONFIG.signal.graceSeconds + 0.5).level).toBeGreaterThan(0)
  })

  // The ask was "at least 15 seconds before reaching its peak". Assert the
  // *slowness* rather than the shape: at the two-thirds mark it must still have
  // a visible way to go, which a ramp that secretly finished early would fail.
  test('takes the full ramp to arrive', () => {
    const at = a => signalLossAt(CONFIG.signal.graceSeconds + a).level

    expect(CONFIG.signal.rampSeconds).toBeGreaterThanOrEqual(15)
    expect(at(CONFIG.signal.rampSeconds * 0.5)).toBeLessThan(CONFIG.signal.peak * 0.6)
    expect(at(CONFIG.signal.rampSeconds * 0.67)).toBeLessThan(CONFIG.signal.peak * 0.85)
    expect(at(CONFIG.signal.rampSeconds - 0.5)).toBeLessThan(CONFIG.signal.peak)
    expect(at(CONFIG.signal.rampSeconds)).toBeCloseTo(CONFIG.signal.peak, 6)
  })

  test('eases in, so the onset is not a cut', () => {
    const at = a => signalLossAt(CONFIG.signal.graceSeconds + a).level

    // smootherstep leaves flat: the first second must move far less than the
    // middle of the ramp does, or the picture snaps when it starts failing.
    const first = at(1) - at(0)
    const mid   = at(CONFIG.signal.rampSeconds / 2 + 0.5) - at(CONFIG.signal.rampSeconds / 2 - 0.5)
    expect(first).toBeLessThan(mid * 0.25)

    // ...and arrives flat too.
    const last = at(CONFIG.signal.rampSeconds) - at(CONFIG.signal.rampSeconds - 1)
    expect(last).toBeLessThan(mid * 0.25)
  })

  test('never clears and never reaches nothing', () => {
    for (const a of [ CONFIG.signal.rampSeconds, 60, 600, 36_000 ]) {
      const s = signalLossAt(CONFIG.signal.graceSeconds + a)
      expect(s.level).toBeCloseTo(CONFIG.signal.peak, 6)
      expect(s.level).toBeLessThan(1)
    }
  })

  test('brings the meter up with the caption, slowly', () => {
    const at = a => signalLossAt(CONFIG.signal.graceSeconds + a).meter

    // It arrives with the loss rather than after it, so there is no delay left
    // to sit through — but it takes most of the ramp to become readable.
    expect(CONFIG.signal.meterDelaySeconds).toBe(0)
    expect(at(0)).toBe(0)
    expect(at(0.5)).toBeGreaterThan(0)

    expect(at(CONFIG.signal.meterFadeSeconds * 0.5)).toBeCloseTo(0.5, 6)
    expect(at(CONFIG.signal.meterFadeSeconds - 0.01)).toBeLessThan(1)
    expect(at(CONFIG.signal.meterFadeSeconds)).toBe(1)

    // A long fade was the point: half of it must still be short of a quarter.
    expect(CONFIG.signal.meterFadeSeconds).toBeGreaterThanOrEqual(10)
    expect(at(CONFIG.signal.meterFadeSeconds * 0.25)).toBeLessThan(0.25)
  })

  test('the readout falls, unsteadily, and settles', () => {
    expect(dbAt(0)).toBe(-12)

    const early = dbAt(1)
    const late  = dbAt(CONFIG.signal.rampSeconds)
    expect(late).toBeLessThan(early - 30)

    // The needle has to get *less* steady as the signal weakens, or the readout
    // says nothing a static number would not.
    const spread = range => {
      const vs = []
      for (let a = range[0]; a < range[1]; a += 1 / 12)
        vs.push(dbAt(a))
      return Math.max(...vs) - Math.min(...vs)
    }
    expect(spread([ 0.5, 3 ])).toBeLessThan(spread([ CONFIG.signal.rampSeconds, CONFIG.signal.rampSeconds + 2.5 ]))
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
