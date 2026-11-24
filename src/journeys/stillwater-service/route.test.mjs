import { describe, expect, test } from 'bun:test'
import { levelFrame } from '@wjh/geometry/sweep'
import { newFrame } from '@wjh/geometry/curve'
import { getRoute } from './route'
import { ACTS, LAP_SECONDS, momentAt, warpAt } from './timeline'


const route = getRoute()

describe('stillwater route', () => {
  test('legs fill each act exactly and the lap', () => {
    for (const act of ACTS) {
      const seconds = route.legs.filter(leg => leg.act === act.id).reduce((t, leg) => t + leg.seconds, 0)
      expect(seconds).toBeCloseTo(act.seconds, 6)
    }
    expect(route.legs.reduce((t, leg) => t + leg.seconds, 0)).toBeCloseTo(LAP_SECONDS, 6)
  })

  test('the path closes: the last leg ends where the first begins', () => {
    const end   = route.curve.pointAtDistance(route.length - 0.01)
    const start = route.curve.pointAtDistance(0)
    expect(Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)).toBeLessThan(0.05)
    for (const leg of route.legs)
      expect(leg.s1).toBeGreaterThan(leg.s0)
  })

  test('the rider never jumps: position and speed are continuous across the lap', () => {
    let worstDv = 0
    let prev    = route.travel(0, 0)
    for (let t = 0.01; t <= LAP_SECONDS; t += 0.01) {
      const now = route.travel(t, 0)
      expect(now.s).toBeGreaterThanOrEqual(prev.s - 1e-9)
      worstDv = Math.max(worstDv, Math.abs(now.v - prev.v))
      prev    = now
    }
    expect(worstDv).toBeLessThan(0.05)

    const seamEnd   = route.travel(LAP_SECONDS, 0)
    const seamStart = route.travel(0, 1)
    expect(seamEnd.s).toBeCloseTo(route.length, 3)
    expect(seamStart.s).toBeCloseTo(0, 6)
    expect(seamEnd.v).toBeCloseTo(seamStart.v, 6)
  })

  test('the last lift stops dead at the top', () => {
    expect(route.travel(LAP_SECONDS, 2).v).toBeCloseTo(0, 6)
    expect(route.travel(LAP_SECONDS - 0.5, 2).v).toBeGreaterThan(0)
  })

  test('grade is continuous: no kink anywhere on the loop', () => {
    const a = newFrame()
    const b = newFrame()
    let worst = 0
    for (let s = 0; s < route.length - 0.1; s += 0.05) {
      levelFrame(route.curve, s, a)
      levelFrame(route.curve, s + 0.05, b)
      worst = Math.max(worst, Math.abs(b.forward.y - a.forward.y) / 0.05)
    }
    expect(worst).toBeLessThan(0.25)
  })

  test('bank stays within the trough and changes smoothly', () => {
    let worst = 0
    for (let s = 0; s < route.length; s += 0.02) {
      expect(Math.abs(route.bankAt(s))).toBeLessThan(70 * Math.PI / 180)
      worst = Math.max(worst, Math.abs(route.bankAt(s + 0.02) - route.bankAt(s)) / 0.02)
    }
    expect(worst).toBeLessThan(0.15)
  })

  test('the warp is zero on lap 1 and continuous everywhere', () => {
    for (let t = 0; t < LAP_SECONDS; t += 1)
      expect(warpAt(t)).toBe(0)

    let worst = 0
    for (let t = 0; t < 460; t += 0.01)
      worst = Math.max(worst, Math.abs(warpAt(t + 0.01) - warpAt(t)))
    expect(worst).toBeLessThan(0.01)
    expect(momentAt(LAP_SECONDS * 2.5).warp).toBeGreaterThan(0.8)
  })
})
