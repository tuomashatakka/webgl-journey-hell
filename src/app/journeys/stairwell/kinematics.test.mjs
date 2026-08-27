import { describe, expect, test } from 'bun:test'
import {
  FINALE_DISTANCE,
  LOOP_COUNT,
  LOOP_LENGTH,
  PURGATORY_LENGTH,
  PURGATORY_START,
  STAIRWELL_SECTIONS,
  assertStairwellRoute,
  createStairwellSimulation,
  getSectionLabel,
  getStairwellState,
  getWalkSpeed,
} from './kinematics.ts'


describe('stairwell route', () => {
  test('is one contiguous 500-unit anthology', () => {
    expect(assertStairwellRoute()).toEqual([])
    expect(STAIRWELL_SECTIONS).toHaveLength(6)
    expect(STAIRWELL_SECTIONS.at(-1)?.end).toBe(LOOP_LENGTH)
  })

  test('selects every section at its exact boundary', () => {
    for (const section of STAIRWELL_SECTIONS) {
      const state = getStairwellState(section.start)
      expect(state.section.id).toBe(section.id)
      expect(state.sectionProgress).toBe(0)
    }
  })

  test('eases each handoff across the closing 48 percent of an act', () => {
    const section = STAIRWELL_SECTIONS[0]
    const at      = progress => getStairwellState(
      section.start + (section.end - section.start) * progress,
    ).transition

    expect(at(0.52)).toBe(0)
    expect(at(0.76)).toBeCloseTo(0.5, 8)
    expect(at(0.999)).toBeGreaterThan(0.999)

    // The point of the quintic: it leaves and arrives flat, so neither end of
    // the blend shows a kick. smoothstep is ~4x steeper here.
    expect(at(0.53)).toBeLessThan(0.0002)
    expect(at(0.99)).toBeGreaterThan(0.9995)
  })

  test('returns to the same section with stronger rupture', () => {
    const positions = [ 20, 520, 1020, 1520 ].map(getStairwellState)
    expect(positions.map(state => state.section.id)).toEqual([ 0, 0, 0, 0 ])
    expect(positions.map(state => state.rupture)).toEqual([ 0, 1 / 3, 2 / 3, 1 ])
  })

  // The point of the eased decay counter: the reset has to be a slide, not a
  // step, or the traversal boundary reads as a cut.
  test('carries decay continuously across every loop boundary', () => {
    for (let loop = 1; loop < LOOP_COUNT; loop++) {
      const before = getStairwellState(loop * LOOP_LENGTH - 0.01).decay
      const after  = getStairwellState(loop * LOOP_LENGTH + 0.01).decay
      expect(Math.abs(after - before)).toBeLessThan(0.01)
      expect(before).toBeCloseTo(loop, 2)
    }
  })

  test('enters the authored finale only in the fourth shear horizon', () => {
    expect(getStairwellState(1490).finale).toBe(0)
    expect(getStairwellState(1915).finale).toBeGreaterThan(0)
  })
})

describe('stairwell purgatory', () => {
  test('bleeds into every traversal before it is somewhere you are', () => {
    const bleed = [ 20, 520, 1020, 1520 ].map(z => getStairwellState(z).purgatory)

    expect(bleed[0]).toBe(0)
    for (let i = 1; i < bleed.length; i++)
      expect(bleed[i]).toBeGreaterThan(bleed[i - 1])

    // Two thirds gone by the last traversal, and none of it is the terminal act.
    expect(bleed.at(-1)).toBeGreaterThan(0.5)
    expect(bleed.at(-1)).toBeLessThan(0.8)
    expect([ 20, 520, 1020, 1520 ].every(z => !getStairwellState(z).inPurgatory)).toBe(true)
  })

  test('takes hold at the end of the fourth traversal and never lets go', () => {
    expect(getStairwellState(PURGATORY_START - 1).inPurgatory).toBe(false)
    expect(getStairwellState(PURGATORY_START).inPurgatory).toBe(true)
    expect(getStairwellState(PURGATORY_START + 500).inPurgatory).toBe(true)
    expect(getStairwellState(PURGATORY_START + 200).purgatory).toBeCloseTo(1, 3)
  })

  test('crosses the seam continuously in both depth and pace', () => {
    const before = getStairwellState(PURGATORY_START - 0.01)
    const after  = getStairwellState(PURGATORY_START + 0.01)

    expect(Math.abs(after.purgatory - before.purgatory)).toBeLessThan(0.01)
    expect(Math.abs(after.finale - before.finale)).toBeLessThan(0.01)
    expect(Math.abs(getWalkSpeed(PURGATORY_START + 0.01) - getWalkSpeed(PURGATORY_START - 0.01)))
      .toBeLessThan(0.02)
  })

  test('counts circuits rather than terminating', () => {
    const lapAt = z => getStairwellState(z).purgatoryLap
    expect(lapAt(PURGATORY_START)).toBe(0)
    expect(lapAt(PURGATORY_START + PURGATORY_LENGTH)).toBe(1)
    expect(lapAt(PURGATORY_START + PURGATORY_LENGTH * 5)).toBe(5)
    expect(getSectionLabel(getStairwellState(PURGATORY_START + PURGATORY_LENGTH)))
      .toBe('VII · PURGATORY · ∞02')
  })

  test('walk speed stays finite and positive for the whole route', () => {
    for (let z = 0; z < FINALE_DISTANCE + PURGATORY_LENGTH * 3; z += 0.25) {
      const speed = getWalkSpeed(z)
      expect(Number.isFinite(speed)).toBe(true)
      expect(speed).toBeGreaterThan(0)
    }
  })
})

describe('stairwell simulation', () => {
  test('walks past the fourth traversal and keeps walking', () => {
    const simulation = createStairwellSimulation()
    for (let i = 0; i < 100_000; i++)
      simulation.step(1 / 30, i / 30)

    const uniforms = simulation.uniforms()
    expect(uniforms.uPlayerZ).toBeGreaterThan(PURGATORY_START)
    expect(uniforms.uPurgatory).toBeCloseTo(1, 3)
    expect(uniforms.uSection).toBe(6)

    const before = uniforms.uPlayerZ
    simulation.step(10, 10_000)
    expect(simulation.uniforms().uPlayerZ).toBeGreaterThan(before)
  })

  test('reports marks the transport can navigate by', () => {
    const simulation = createStairwellSimulation()
    expect(simulation.marks()).toEqual({
      loop:         0,
      section:      0,
      sectionCount: 6,
      progress:     0,
      signalAge:    0,
    })

    // Each purgatory circuit is another lap, so fast-forward keeps working
    // after the anthology has stopped repeating.
    for (let i = 0; i < 100_000; i++)
      simulation.step(1 / 30, i / 30)

    const marks = simulation.marks()
    expect(marks.loop).toBeGreaterThanOrEqual(LOOP_COUNT)
    expect(marks.section).toBe(6)
    expect(marks.sectionCount).toBe(1)
  })
})
