import { describe, expect, test } from 'bun:test'
import {
  FALL_BLOCK,
  FALL_LAPS,
  FALL_START,
  LAP_LEN,
  PITCH_LAPS,
  SECTIONS,
  assertRouteSane,
  createSwitchbackSimulation,
  gradeAt,
  lapFAt,
  pitchAt,
} from './kinematics.ts'


const D = Math.PI / 180

/**
 * Grades sampled at the same places on a given lap.
 *
 * Every offset sits before THE OVERLOOK, which is deliberate: the pitch-over
 * ramps *across* that section — the same seam everything else in this journey
 * degrades over — so a sample taken inside it is already part way into the next
 * lap's steepness and two samples on nominally the same lap would not share a t.
 */
function profile (lap) {
  const base = lap * LAP_LEN
  return [ 10, 100, 200, 300, 390 ].map(o => gradeAt(base + o))
}

describe('switchback route', () => {
  test('is still a sane six-room cyclic railway', () => {
    expect(assertRouteSane()).toEqual([])
    expect(SECTIONS).toHaveLength(6)
  })

  // The reference the rest of the ride is heard against. Steepening it would
  // make the railway steep rather than make it *get* steep.
  test('leaves the first lap exactly as authored', () => {
    expect(pitchAt(0)).toBe(0)
    for (const g of profile(0))
      expect(Math.abs(g) / D).toBeLessThanOrEqual(30.001)
  })

  test('tips further over on every lap, keeping the shape of the ride', () => {
    const laps = [ 0, 1, 2, 3 ].map(profile)

    // Every descent is steeper than the same descent one lap earlier.
    for (let lap = 1; lap < laps.length; lap++)
      for (let i = 0; i < laps[0].length; i++)
        if (laps[0][i] < 0)
          expect(laps[lap][i]).toBeLessThan(laps[lap - 1][i] + 1e-9)

    // Ordering survives: the gentlest authored descent is still the gentlest on
    // the last lap. This is what working in angle space rather than slope space
    // buys, and it is the whole reason the lap still reads as the same lap.
    const drops      = laps[0].map((g, i) => [ g, laps[3][i] ]).filter(([ g ]) => g < 0)
    const byAuthored = [ ...drops ].sort((a, b) => b[0] - a[0])
    const byFinal    = [ ...drops ].sort((a, b) => b[1] - a[1])
    expect(byFinal).toEqual(byAuthored)
  })

  /**
   * The one test that catches a pitch-over which is steep but not *smooth*.
   *
   * The first version of steepen() ran descents and climbs through different
   * formulas, so a grade crossing zero — five times a lap in the authored table
   * — jumped instantly by tens of degrees. Every image-level check passed: the
   * frames were not black, the route assertions held, the grades were steeper
   * every lap and in the right order. It read as a stutter on every section
   * boundary from the second lap on, and only a derivative sweep sees it.
   */
  test('turns smoothly on every lap, not just the first', () => {
    const STEP = 0.02

    const worst = lap => {
      const base = lap * LAP_LEN
      let max = 0
      for (let o = 0; o < LAP_LEN; o += STEP)
        max = Math.max(max, Math.abs(gradeAt(base + o + STEP) - gradeAt(base + o)) / STEP)
      return max / D // degrees per metre
    }

    const first = worst(0)
    expect(first).toBeLessThan(3)

    // Within an order of magnitude of the authored lap's own rate. A jump shows
    // up here as hundreds or thousands, never as a near miss.
    for (const lap of [ 1, 2, 3 ])
      expect(worst(lap)).toBeLessThan(Math.max(first, 1) * 10)
  })

  test('is almost a free fall by the fourth lap', () => {
    const steepest = Math.min(...profile(PITCH_LAPS))
    expect(steepest / D).toBeLessThan(-70)
    expect(steepest / D).toBeGreaterThan(-89)
  })
})

describe('switchback fall', () => {
  test('the rails end exactly four laps in', () => {
    expect(FALL_START).toBe(LAP_LEN * FALL_LAPS)
    expect(lapFAt(FALL_START - 1e-6)).toBeCloseTo(FALL_LAPS, 6)
    expect(lapFAt(FALL_START + 500)).toBe(FALL_LAPS)
  })

  // A discontinuous tangent is a derailment, and this is the one seam where two
  // different formulas meet rather than one formula meeting itself.
  test('crosses into the shaft without a step in the tangent', () => {
    const before = gradeAt(FALL_START - 1e-4)
    const after  = gradeAt(FALL_START + 1e-4)
    expect(Math.abs(after - before) / D).toBeLessThan(0.01)
  })

  test('goes vertical, and stays there', () => {
    expect(gradeAt(FALL_START + 400) / D).toBeLessThan(-88)
    expect(gradeAt(FALL_START + 90_000) / D).toBeLessThan(-88)
  })

  test('accelerates without any ceiling on it', () => {
    const sim = createSwitchbackSimulation()
    for (let i = 0; i < 13_000; i++)
      sim.step(1 / 60, i / 60)

    const entry = sim.uniforms().uCart[1]
    expect(sim.marks().section).toBe(6)

    const speeds = []
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 1800; i++)
        sim.step(1 / 60, 0)
      speeds.push(sim.uniforms().uCart[1])
    }

    // Strictly increasing, every sample, with no asymptote in sight — the last
    // thirty seconds must add as much speed as the first thirty did.
    expect(speeds[0]).toBeGreaterThan(entry)
    for (let k = 1; k < speeds.length; k++)
      expect(speeds[k]).toBeGreaterThan(speeds[k - 1])
    expect(speeds.at(-1) - speeds.at(-2)).toBeGreaterThan(
      (speeds[1] - speeds[0]) * 0.95)
    expect(speeds.at(-1)).toBeGreaterThan(1000)
  })

  test('reports each block of shaft as another lap, so the transport still works', () => {
    const sim = createSwitchbackSimulation()
    for (let i = 0; i < 13_000; i++)
      sim.step(1 / 60, i / 60)

    const a = sim.marks()
    expect(a.loop).toBeGreaterThanOrEqual(FALL_LAPS)
    expect(a.sectionCount).toBe(1)
    expect(a.progress).toBeGreaterThanOrEqual(0)
    expect(a.progress).toBeLessThan(1)

    for (let i = 0; i < 600; i++)
      sim.step(1 / 60, 0)
    expect(sim.marks().loop).toBeGreaterThan(a.loop)
  })

  test('the fissures open every lap and saturate in the shaft', () => {
    const sim  = createSwitchbackSimulation()
    const seen = []
    for (let i = 0; i < 13_000; i++) {
      sim.step(1 / 60, i / 60)
      if (i % 2600 === 0)
        seen.push(sim.uniforms().uFall[3])
    }
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[0]).toBe(0)
    expect(sim.uniforms().uFall[3]).toBeCloseTo(1, 2)
    expect(FALL_BLOCK).toBeGreaterThan(0)
  })
})
