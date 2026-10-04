import { describe, expect, test } from 'bun:test'
import { createJourneyTransport } from './transport'


// A route with five 10-unit sections to a 50-unit lap, walked at 2 units/s.
const SPEED = 2

function createSim () {
  let z = 0
  return {
    get z () {
      return z
    },
    step (dt) {
      z += SPEED * dt
    },
    marks () {
      const local = z % 50
      return { loop: Math.floor(z / 50), section: Math.floor(local / 10), sectionCount: 5, progress: local / 50 }
    },
  }
}

function rig () {
  let sim  = createSim()
  let time = 0
  const transport = createJourneyTransport({
    createSimulation: () => createSim(),
    adopt:            (s, t) => {
      sim  = s
      time = t
    },
    current: () => ({ sim, time }),
    advance: dt => {
      time += dt
      sim.step(dt, time)
    },
  })
  // Live playback, observed every frame the way the shell does it.
  const play = seconds => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      transport.observe(time, sim.marks())
      transport.tick(1 / 60)
      time += 1 / 60
      sim.step(1 / 60, time)
    }
  }
  return { transport, play, now: () => ({ time, marks: sim.marks(), z: sim.z }) }
}

describe('journey transport', () => {
  test('next chapter cuts to the start of the next section, not a fixed time ahead', () => {
    const r = rig()
    r.play(1)
    r.transport.request('next')
    const { marks, z } = r.now()
    expect(marks.section).toBe(1)
    expect(z).toBeGreaterThanOrEqual(10)
    expect(z).toBeLessThan(10.2)
    expect(r.transport.tick(1 / 60).mode).toBe('flash')
  })

  test('next lap cuts to the next lap', () => {
    const r = rig()
    r.play(2)
    r.transport.request('next-lap')
    expect(r.now().marks.loop).toBe(1)
    expect(r.now().marks.section).toBe(0)
  })

  test('previous chapter restarts the chapter, or goes one further inside the grace', () => {
    const r = rig()
    r.play(13) // z = 26: section 2, 3 s in
    r.transport.request('prev')
    expect(r.now().z).toBeCloseTo(20, 1)

    r.transport.tick(1)
    r.play(0.5) // just inside section 2 again
    r.transport.request('prev')
    expect(r.now().marks.section).toBe(1)
    expect(r.now().z).toBeCloseTo(10, 1)
  })

  test('previous lap goes back to where the lap began', () => {
    const r = rig()
    r.play(30) // z = 60: lap 1, 5 s in
    r.transport.request('prev-lap')
    expect(r.now().marks.loop).toBe(1)
    expect(r.now().z).toBeCloseTo(50, 1)
  })

  test('scrubbing moves the playhead to a fraction of the lap, both ways', () => {
    const r = rig()
    r.play(5) // progress 0.2
    r.transport.scrub(0.7)
    expect(r.transport.tick(1 / 60).mode).toBe('scrub')
    expect(r.now().marks.progress).toBeGreaterThanOrEqual(0.7)
    expect(r.now().marks.progress).toBeLessThan(0.71)

    // Back, through the track recorded on the way out.
    r.transport.scrub(0.4)
    r.transport.tick(1 / 60)
    expect(r.now().marks.progress).toBeCloseTo(0.4, 1)

    r.transport.release()
    expect(r.transport.tick(1 / 60).mode).toBe('play')
    expect(r.now().marks.loop).toBe(0)
  })

  test('a scrub only applies once per frame, the latest position winning', () => {
    const r = rig()
    r.play(1)
    r.transport.scrub(0.9)
    r.transport.scrub(0.3)
    r.transport.tick(1 / 60)
    expect(r.now().marks.progress).toBeCloseTo(0.3, 1)
  })
})
