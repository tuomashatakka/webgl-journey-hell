import { describe, expect, test } from 'bun:test'
import {
  BANK_GAIN,
  SECTIONS,
  bankAt,
  bankGainAt,
  buildRoute,
  sectionWeights,
  signedCurvature,
  speedParamsAt,
  sunElevationAt,
} from './course.ts'
import { SIGNAL_LOSS_LAP, ScenicRide } from './kinematics.ts'


const D     = Math.PI / 180
const route = buildRoute()

/** Worst |Δf|/Δs of f over the loop at 2 cm. The one gate an image cannot be. */
function worstRate (f, step = 0.02) {
  let worst = 0
  for (let s = 0; s < route.length; s += step)
    worst = Math.max(worst, Math.abs(f(s + step) - f(s)) / step)
  return worst
}

function ride (seconds, dt = 1 / 60) {
  const sim = new ScenicRide()
  let t     = 0
  for (let i = 0; i < seconds / dt; i++) {
    t += dt
    sim.step(dt, t)
  }
  return sim
}

describe('scenic route — the table', () => {
  test('seven sections tile a lap of about three kilometres', () => {
    expect(SECTIONS).toHaveLength(7)
    expect(route.spans).toHaveLength(7)
    expect(route.length).toBeGreaterThan(2700)
    expect(route.length).toBeLessThan(3400)
    for (let i = 1; i < route.spans.length; i++)
      expect(route.spans[i].s0).toBeCloseTo(route.spans[i - 1].s1, 6)
    expect(route.spans[6].s1).toBeCloseTo(route.length, 6)
  })

  test('the spline passes through its control points and never tears', () => {
    // Dense step lengths: the largest must not be a multiple of the typical.
    let maxJump = 0
    let sum     = 0
    let n       = 0
    let prev    = route.curve.pointAtDistance(0)
    for (let s = 0.25; s <= route.length; s += 0.25) {
      const p = route.curve.pointAtDistance(s)
      const d = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)
      maxJump = Math.max(maxJump, d)
      sum    += d
      n++
      prev = p
    }
    expect(maxJump).toBeLessThan(sum / n * 1.5)
  })

  test('grade is continuous everywhere, the fall included', () => {
    const grade = s => Math.asin(Math.max(-1, Math.min(1, route.curve.frameAtDistance(s).forward.y)))
    // Reference: the authored table's own rate. A tear reads as hundreds here.
    expect(worstRate(grade) / D).toBeLessThan(6)
  })

  test('the fall leaves the lip nose-down and arrives at the mouth', () => {
    const fall  = route.spans[4]
    const exit  = route.curve.frameAtDistance(fall.s1 - 0.5)
    const pitch = Math.asin(exit.forward.y) / D
    expect(pitch).toBeLessThan(-35)
    expect(pitch).toBeGreaterThan(-58)

    // Speed strictly increasing through the fall, no asymptote.
    const mouth = route.curve.pointAtDistance(fall.s1)
    expect(mouth.y).toBeGreaterThan(15)
    expect(mouth.y).toBeLessThan(35)
  })

  test('lateral load at the target speeds stays inside the contract', () => {
    for (const sp of route.spans) {
      let worst = 0
      for (let s = sp.s0; s < sp.s1; s += 1)
        worst = Math.max(worst, sp.section.vTarget ** 2 * Math.abs(signedCurvature(route.curve, s)) / 9.81)
      expect(worst).toBeLessThan(sp.section.name === 'DOWNTOWN' ? 3.5 : 2.2)
    }
  })

  test('section weights are a partition of unity', () => {
    const w = new Float32Array(7)
    for (let s = -20; s < route.length + 20; s += 3.7) {
      sectionWeights(route, s, w)

      let sum = 0
      for (let i = 0; i < 7; i++) {
        expect(w[i]).toBeGreaterThanOrEqual(0)
        sum += w[i]
      }
      expect(sum).toBeCloseTo(1, 4)
    }
  })

  test('every speed parameter is continuous along the loop', () => {
    const w = new Float32Array(7)
    const o = { vTarget: 0, tau: 0, throttle: 0, gW: 0, cD: 0 }
    for (const k of [ 'vTarget', 'tau', 'throttle', 'gW', 'cD' ]) {
      const f = s => speedParamsAt(route, s, 0, w, o)[k]
      // A jump at 2 cm reads as Δ/0.02 — fifty times the value. Smooth ramps
      // over the 30 m window are two orders below that.
      expect(worstRate(f)).toBeLessThan(k === 'cD' ? 0.01 : 5)
    }
  })
})

describe('scenic route — the bank', () => {
  test('is smooth on every lap, within an order of magnitude of lap 0', () => {
    const ref = worstRate(s => bankAt(route, s, 0))
    expect(ref / D).toBeLessThan(2)
    for (const lapF of [ 0.5, 1, 2, 3, 6 ]) {
      const w = worstRate(s => bankAt(route, s, lapF))
      expect(w).toBeLessThanOrEqual(ref * 10 + 1e-9)
      // And it is exactly the affine gain, nothing else.
      expect(w).toBeCloseTo(ref * bankGainAt(lapF), 6)
    }
  })

  test('agrees with the curve about which way every turn goes', () => {
    let mismatches = 0
    for (let s = 0; s < route.length; s += 2) {
      const b = bankAt(route, s, 0)
      const k = signedCurvature(route.curve, s)
      if (Math.abs(b) > 8 * D && Math.abs(k) > 1 / 400 && Math.sign(b) !== Math.sign(k))
        mismatches++
    }
    expect(mismatches).toBe(0)
  })

  test('the helix reaches forty degrees on lap 0 and a full roll by lap 3', () => {
    const helix = route.spans[2]
    let peak    = 0
    for (let s = helix.s0; s < helix.s1; s += 1)
      peak = Math.max(peak, Math.abs(bankAt(route, s, 0)))
    expect(peak / D).toBeGreaterThan(36)
    expect(peak / D).toBeLessThan(44)
    expect(peak * (1 + 2 * BANK_GAIN) / D).toBeGreaterThan(340)
  })
})

describe('scenic route — the ride', () => {
  test('lap 0 takes between 160 and 230 seconds and later laps are shorter', () => {
    const sim   = new ScenicRide()
    const dt    = 1 / 60
    const times = []
    let t   = 0
    let lap = 0
    while (times.length < 3 && t < 900) {
      t += dt
      sim.step(dt, t)
      if (sim.state.lap !== lap) {
        lap = sim.state.lap
        times.push(t)
      }
    }
    expect(times).toHaveLength(3)
    expect(times[0]).toBeGreaterThan(160)
    expect(times[0]).toBeLessThan(230)
    expect(times[1] - times[0]).toBeLessThan(times[0])
    expect(times[2] - times[1]).toBeLessThan(times[1] - times[0])
  })

  test('the float does not snap at the lap seam', () => {
    // The float phases run on distance travelled, not on s: s wraps at the
    // seam while the water weight is still one half, and phases on s snapped
    // the yaw by 0.3 rad there. The worst step of heave and yaw over lap 1
    // and its seam into lap 2 must be a step, not a jump.
    const sim = new ScenicRide()
    const dt  = 1 / 60
    let t      = 0
    let prev   = null
    let worstH = 0
    let worstY = 0
    while (sim.state.lap < 2 && t < 900) {
      t += dt
      sim.step(dt, t)

      const u = sim.uniforms().uFloat
      if (prev && sim.state.lap >= 1) {
        worstH = Math.max(worstH, Math.abs(u[1] - prev[1]))
        worstY = Math.max(worstY, Math.abs(u[2] - prev[2]))
      }
      prev = u
    }
    expect(sim.state.lap).toBe(2)
    expect(worstH).toBeLessThan(0.06)
    expect(worstY).toBeLessThan(0.01)
  })

  test('speed climbs monotonically through the fall and settles in the river', () => {
    const sim  = new ScenicRide()
    const dt   = 1 / 60
    const fall = route.spans[4]
    const cave = route.spans[6]
    let t      = 0
    let last   = -1
    let inFall = false
    while (sim.state.lap === 0 && sim.state.s < cave.s1 - 40) {
      t += dt
      sim.step(dt, t)

      const st = sim.state
      if (st.s > fall.s0 + 5 && st.s < fall.s1 - 5) {
        if (inFall)
          expect(st.v).toBeGreaterThan(last)
        inFall = true
        last   = st.v
      }
      else
        inFall = false
    }
    // Within 8 % of the current at the end of the undertow.
    expect(Math.abs(sim.state.v - SECTIONS[6].vTarget) / SECTIONS[6].vTarget).toBeLessThan(0.2)
  })

  test('is a pure function of its inputs', () => {
    const a = ride(400)
    const b = ride(400)
    expect(a.uniforms()).toEqual(b.uniforms())
    expect(a.label()).toBe(b.label())
  })

  test('the signal only starts to go after three laps', () => {
    const sim = new ScenicRide()
    const dt  = 1 / 60
    let t     = 0
    while (sim.state.lap < SIGNAL_LOSS_LAP && t < 900) {
      t += dt
      sim.step(dt, t)
      if (sim.state.lap < SIGNAL_LOSS_LAP)
        expect(sim.state.signalAge).toBe(0)
    }
    expect(sim.state.lap).toBe(SIGNAL_LOSS_LAP)
    // The step that crossed the seam already counts: the loss is a property of
    // being in the fourth lap, not of having been noticed there.
    expect(sim.state.signalAge).toBeGreaterThan(0)

    const before = sim.state.signalAge
    sim.step(dt, t + dt)
    expect(sim.state.signalAge).toBeGreaterThan(before)
    expect(sim.marks().signalAge).toBeGreaterThan(0)
  })

  test('every lap is worse: the sun sinks and the bank gains', () => {
    for (let l = 0; l < 3; l++) {
      expect(sunElevationAt(l + 1)).toBeLessThan(sunElevationAt(l))
      expect(1 + (l + 1) * BANK_GAIN).toBeGreaterThan(1 + l * BANK_GAIN)
    }
    expect(sunElevationAt(0) / D).toBeCloseTo(12, 5)
    expect(sunElevationAt(3) / D).toBeCloseTo(-6, 5)
  })

  test('marks and label describe the same place', () => {
    const sim = ride(30)
    const m   = sim.marks()
    expect(m.sectionCount).toBe(7)
    expect(m.loop).toBe(0)
    expect(sim.label()).toContain(SECTIONS[m.section].name)
    expect(sim.label()).toMatch(/^LAP 1 · [A-Z ]+$/)
    expect(sim.detail()).toMatch(/^\d+ KM\/H$/)
  })
})
