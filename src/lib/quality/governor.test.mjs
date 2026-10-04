import { describe, expect, test } from 'bun:test'
import { createGovernor } from './governor'


const feed = (g, dt, frames) => {
  let changed = false
  for (let i = 0; i < frames; i++)
    changed = g.sample(dt) || changed
  return changed
}

describe('resolution governor', () => {
  test('steps the scale down when frames run over budget', () => {
    const g = createGovernor({ min: 0.3, max: 1.5, start: 1, targetFps: 60 })
    expect(feed(g, 1 / 30, 24)).toBe(true)
    expect(g.scale).toBeLessThan(1)
    expect(g.scale).toBeGreaterThanOrEqual(0.3)
  })

  test('holds steady at the budget, then probes up, and reverts a probe that fails', () => {
    const g = createGovernor({ min: 0.3, max: 1.5, start: 1, targetFps: 60 })
    feed(g, 1 / 60, 24 * 4)

    const probed = g.scale
    expect(probed).toBeGreaterThan(1)
    feed(g, 1 / 30, 24)
    expect(g.scale).toBeCloseTo(1, 5)
  })

  test('never leaves its bounds', () => {
    const g = createGovernor({ min: 0.4, max: 0.8, start: 0.6, targetFps: 60 })
    feed(g, 1 / 5, 24 * 20)
    expect(g.scale).toBeGreaterThanOrEqual(0.4)
    feed(g, 1 / 120, 24 * 200)
    expect(g.scale).toBeLessThanOrEqual(0.8)
  })

  test('ignores a hidden tab or a breakpoint', () => {
    const g = createGovernor({ min: 0.3, max: 1.5, start: 1, targetFps: 60 })
    expect(feed(g, 2, 48)).toBe(false)
    expect(g.scale).toBe(1)
  })
})
