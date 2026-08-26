import { describe, expect, test } from 'bun:test'
import {
  FINALE_DISTANCE,
  LOOP_LENGTH,
  STAIRWELL_SECTIONS,
  TERMINAL_DISTANCE,
  assertStairwellRoute,
  createStairwellSimulation,
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

  test('eases each handoff across the closing 42 percent of an act', () => {
    const section = STAIRWELL_SECTIONS[0]
    const at      = progress => getStairwellState(
      section.start + (section.end - section.start) * progress,
    ).transition

    expect(at(0.58)).toBe(0)
    expect(at(0.79)).toBeCloseTo(0.5, 8)
    expect(at(0.999)).toBeGreaterThan(0.999)
    expect(at(0.581)).toBeLessThan(0.001)
  })

  test('returns to the same section with stronger rupture', () => {
    const positions = [ 20, 520, 1020, 1520 ].map(getStairwellState)
    expect(positions.map(state => state.section.id)).toEqual([ 0, 0, 0, 0 ])
    expect(positions.map(state => state.rupture)).toEqual([ 0, 1 / 3, 2 / 3, 1 ])
  })

  test('enters the authored finale only in the fourth shear horizon', () => {
    expect(getStairwellState(1490).finale).toBe(0)
    expect(getStairwellState(1915).finale).toBeGreaterThan(0)
    expect(getStairwellState(FINALE_DISTANCE).terminal).toBe(true)
  })

  test('walk speed stays finite and decelerates into the terminal frame', () => {
    for (let z = 0; z < FINALE_DISTANCE; z += 0.25)
      expect(Number.isFinite(getWalkSpeed(z))).toBe(true)
    expect(getWalkSpeed(TERMINAL_DISTANCE)).toBe(0)
  })

  test('simulation reaches and holds the terminal state', () => {
    const simulation = createStairwellSimulation()
    for (let i = 0; i < 100_000; i++)
      simulation.step(1 / 30, i / 30)

    const uniforms = simulation.uniforms()
    expect(uniforms.uPlayerZ).toBe(TERMINAL_DISTANCE)
    expect(uniforms.uFinale).toBeGreaterThan(0.99)
    simulation.step(10, 10_000)
    expect(simulation.uniforms().uPlayerZ).toBe(TERMINAL_DISTANCE)
  })
})
