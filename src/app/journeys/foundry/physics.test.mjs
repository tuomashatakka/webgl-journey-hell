import { describe, expect, test } from 'bun:test'
import {
  CYCLE_LEN,
  FURNACE_HALF_W,
  LAP_ARC,
  LIFT_BRAKE_Y,
  MAX_SQUEEZE,
  MODE_OBLIVION,
  OBLIVION_LOOP,
  OBLIVION_PERIOD,
  PIT_Y,
  SPAN_ARC,
  SPAN_EXTRA,
  SPAN_HALF_W,
  SPAN_TILES,
  TILE,
  TILE_HALF,
  WALK_START,
  advance,
  brakeYFor,
  liftTopFor,
  shaftHeadFor,
  createFoundryState,
  routeAt,
  tileArc,
  tileX,
  tileZ,
} from './physics.ts'


const pt = () => ({ x: 0, z: 0, dx: 0, dz: 1 })

/** decayFor caps here, so this is the tightest the corridor ever gets. */
const MAX_DECAY = 0.85


describe('the stepping stones', () => {
  test('every step is one tile, in one axis, and never backwards', () => {
    for (let i = 1; i < SPAN_TILES; i++) {
      const dx = Math.abs(tileX(i) - tileX(i - 1))
      const dz = tileZ(i) - tileZ(i - 1)

      // Edge-adjacency is what makes the flip possible at all: the plate rotates
      // a half turn about the edge it shares with its predecessor, and there is
      // no shared edge unless the centres are exactly one tile apart.
      expect(dx + dz).toBeCloseTo(TILE, 9)
      expect(Math.min(dx, Math.abs(dz))).toBe(0)
      expect(dz).toBeGreaterThanOrEqual(0)
    }
  })

  test('turns both ways and finishes on the far side of the hall', () => {
    const xs = []
    for (let i = 0; i < SPAN_TILES; i++)
      xs.push(tileX(i))

    expect(Math.min(...xs)).toBeLessThan(0)
    expect(Math.max(...xs)).toBeGreaterThan(0)
    expect(xs[0]).toBe(0)
    expect(Math.abs(xs[SPAN_TILES - 1])).toBe(Math.max(...xs.map(Math.abs)))
  })

  test('fits inside the hall it crosses, on the worst lap', () => {
    // This is the check that was missing when the route first turned: the walls
    // come *in* as the world decays, and the tiles do not.
    const tightest = FURNACE_HALF_W * (1 - MAX_DECAY * MAX_SQUEEZE)
    expect(SPAN_HALF_W).toBeLessThan(tightest)
    expect(SPAN_HALF_W).toBe(Math.max(...Array.from(
      { length: SPAN_TILES }, (_, i) => Math.abs(tileX(i)))) + TILE_HALF)
  })
})


describe('the route', () => {
  test('is the hall centreline until the span, and again after it', () => {
    const p = pt()
    routeAt(0, p)
    expect(p.x).toBe(0)
    expect(p.z).toBeCloseTo(WALK_START, 9)

    routeAt(tileArc(0) - 5, p)
    expect(p.x).toBe(0)

    routeAt(LAP_ARC, p)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(WALK_START + CYCLE_LEN, 6)
  })

  test('lands on each tile it passes', () => {
    const p = pt()
    for (let i = 0; i < SPAN_TILES; i++) {
      routeAt(tileArc(i), p)
      // The spline approximates rather than interpolates, so it cuts the corners
      // — but it has to cut them by less than a tile, or the walk leaves the
      // plate at exactly the four places there is nothing under it.
      expect(Math.abs(p.x - tileX(i))).toBeLessThan(TILE_HALF * 0.6)
      expect(Math.abs(p.z - tileZ(i))).toBeLessThan(TILE_HALF * 0.6)
    }
  })

  test('never goes backwards, and never stands still', () => {
    const p = pt()
    let prevZ = -1e9
    for (let a = 0; a <= LAP_ARC; a += 0.02) {
      routeAt(a, p)
      expect(p.z).toBeGreaterThanOrEqual(prevZ - 1e-9)
      prevZ = p.z

      // Speed along the route dips through the corners (a B-spline cuts them,
      // so you slow to turn) but must never reach zero — a zero-length tangent
      // has no heading, and the yaw would be undefined for a frame.
      expect(Math.hypot(p.dx, p.dz)).toBeGreaterThan(0.5)
    }
  })

  /**
   * The sweep that matters.
   *
   * Screenshots cannot see a discontinuity in a derivative — this repo has
   * shipped one before, and every image-level check missed it. So walk the route
   * at a fine step and look at the *rate of turn*: a polyline route, or a route
   * whose ends do not meet the centreline tangentially, shows up here as a spike
   * orders of magnitude above the rest and nowhere else.
   */
  test('turns smoothly — no corner anywhere in the lap', () => {
    const p    = pt()
    const step = 0.005
    let prevHead = null
    let worst    = 0
    let worstAt  = 0

    for (let a = 0; a <= LAP_ARC; a += step) {
      routeAt(a, p)

      const head = Math.atan2(p.dx, p.dz)
      if (prevHead !== null) {
        const rate = Math.abs(head - prevHead) / step
        if (rate > worst) {
          worst   = rate
          worstAt = a
        }
      }
      prevHead = head
    }

    // The tightest legitimate turn is a quarter turn taken over about a tile, so
    // ~0.65 rad/m. A hard corner would read as thousands.
    expect(worst).toBeLessThan(1.2)
    expect(worstAt).toBeGreaterThan(0)
  })

  test('a turning lap is longer to walk than it is round', () => {
    expect(SPAN_EXTRA).toBeGreaterThan(0)
    expect(LAP_ARC).toBeCloseTo(CYCLE_LEN + SPAN_EXTRA, 9)
    expect(SPAN_ARC).toBe((SPAN_TILES - 1) * TILE)
  })
})


describe('the drop', () => {
  test('gets longer every run, until it stops being a drop', () => {
    expect(brakeYFor(0)).toBe(LIFT_BRAKE_Y)
    for (let loop = 1; loop < OBLIVION_LOOP; loop++)
      expect(brakeYFor(loop)).toBeLessThan(brakeYFor(loop - 1))

    // On the last run the gear still fires where it always did. It is not the
    // trip that fails, it is the shoes.
    expect(brakeYFor(OBLIVION_LOOP)).toBe(LIFT_BRAKE_Y)
    expect(brakeYFor(OBLIVION_LOOP + 4)).toBe(LIFT_BRAKE_Y)
  })

  test('there is more of it to fall through every run', () => {
    // The trip point alone cannot do this: it buys free-fall metres and gives
    // them back as braking seconds. The shaft has to get taller too, and the
    // free fall is the difference between the two.
    let prev = -1
    for (let loop = 0; loop <= OBLIVION_LOOP; loop++) {
      const drop = liftTopFor(loop) - brakeYFor(loop)
      expect(drop).toBeGreaterThan(prev)
      expect(shaftHeadFor(loop)).toBeGreaterThan(liftTopFor(loop))
      prev = drop
    }

    // ...and it stops growing once there is nothing left to grow into.
    expect(liftTopFor(OBLIVION_LOOP + 3)).toBe(liftTopFor(OBLIVION_LOOP))
  })
})


describe('oblivion', () => {

  /** Drive a fresh sim until `done`, or give up after `limit` seconds. */
  function run (done, limit) {
    const s = createFoundryState()
    let carry = 0
    for (let t = 0; t < limit; t += 1 / 60) {
      carry = advance(s, 1 / 60, carry)
      if (done(s))
        return s
    }
    return null
  }

  test('every lap starts back at the boarding point', () => {
    // A lap is LAP_ARC of walking but only CYCLE_LEN of ground. Wrapping the
    // distance instead of writing the boarding point down starts each lap
    // SPAN_EXTRA further along than the last.
    for (let lap = 1; lap <= 2; lap++) {
      const s = run(x => x.loop === lap, 900)
      expect(s).not.toBeNull()
      expect(s.z).toBeCloseTo(WALK_START, 6)
      expect(s.lateral).toBe(0)
      expect(s.lapEnd - s.dist).toBeCloseTo(LAP_ARC, 6)
    }
  })

  test('the fourth run has no bottom, and stays representable', () => {
    const s = run(x => x.mode === MODE_OBLIVION, 2400)
    expect(s).not.toBeNull()
    expect(s.loop).toBe(OBLIVION_LOOP)

    // ...and then keeps falling. The wrap is what makes that survivable: `y`
    // stays inside one period no matter how long this runs, while `fallen` is
    // the number that actually counts up.
    let carry = 0
    for (let t = 0; t < 600; t += 1 / 60) {
      carry = advance(s, 1 / 60, carry)
      expect(s.mode).toBe(MODE_OBLIVION)
      expect(s.y).toBeLessThanOrEqual(PIT_Y)
      expect(s.y).toBeGreaterThan(PIT_Y - OBLIVION_PERIOD * 2)
    }
    expect(s.fallen).toBeGreaterThan(5_000)

    // Terminal velocity, not an unbounded number: the fall stops getting faster
    // and then never stops.
    expect(Math.abs(s.cageV)).toBeGreaterThan(30)
    expect(Math.abs(s.cageV)).toBeLessThan(60)
  })
})
