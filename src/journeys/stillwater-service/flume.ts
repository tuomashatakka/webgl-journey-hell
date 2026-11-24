// The flume: shell, flanges and the water in it, swept along the route; and
// what holds it up, built as props.

import { newFrame } from '@wjh/geometry/curve'
import { finishSweep, levelFrame, SWEEP_FLOATS, SWEEP_LAYOUT, sweepProfile } from '@wjh/geometry/sweep'
import type { ProfilePoint, SweepArrays } from '@wjh/geometry/sweep'
import { createMeshFromArrays } from '@wjh/gl/mesh'
import type { Mesh } from '@wjh/gl/mesh'
import { smoothstep } from '@wjh/math/scalar'
import { RIGS } from './rooms'
import { FLUME, getRoute, SECTION } from './route'
import type { Stage } from './stage'


const ARC     = 18
const FLANGE  = 4
const SEABED  = -8.4
const WATER_W = 0.55

type V3 = [number, number, number]

function arc (out: ProfilePoint[], radius: number, from: number, to: number): void {
  for (let i = 0; i <= ARC; i++) {
    const a = from + (to - from) * i / ARC
    out.push([ radius * Math.sin(a), FLUME.radius - radius * Math.cos(a) ])
  }
}

/** Where the trough closes over into the clear tube, as an opening angle. */
function opening (s: number): number {
  const route = getRoute()
  const clear = route.legs.filter(leg => leg.section === SECTION.acrylic)
  const a     = clear[0].s0
  const b     = clear[clear.length - 1].s1
  const close = smoothstep(a - 0.5, a + 4, s) * (1 - smoothstep(b - 4, b + 0.5, s))
  return FLUME.open + (Math.PI - FLUME.open) * close
}

function sectionAt (s: number): number {
  const route = getRoute()
  const clear = route.legs.filter(leg => leg.section === SECTION.acrylic)
  if (s > clear[0].s0 - 0.6 && s < clear[clear.length - 1].s1 + 0.6)
    return SECTION.acrylic
  return route.sectionAt(s)
}

function upload (gl: WebGL2RenderingContext, arrays: SweepArrays): Mesh {
  const done = finishSweep(arrays)
  return createMeshFromArrays(gl, done.vertices, done.indices, SWEEP_LAYOUT, SWEEP_FLOATS)
}

export function buildFlume (gl: WebGL2RenderingContext) {
  const route = getRoute()
  const R     = FLUME.radius

  const shell = sweepProfile(route.curve, {
    s0:      0,
    s1:      route.length,
    step:    0.3,
    closed:  true,
    sectionAt,
    profile: s => {
      const a                     = opening(s)
      const points: ProfilePoint[] = []
      arc(points, R, -a, a)
      arc(points, R + FLUME.shell, a, -a)
      return points
    },
  })

  let flanges: SweepArrays | undefined
  for (let s = 0; s < route.length - 0.2; s += FLUME.flange) {
    const section = sectionAt(s)
    if (section !== SECTION.fibreglass && section !== SECTION.belt)
      continue
    flanges = sweepProfile(route.curve, {
      s0:        s,
      s1:        s + 0.07,
      step:      0.07,
      closed:    true,
      into:      flanges,
      sectionAt: () => FLANGE,
      profile:   () => {
        const points: ProfilePoint[] = []
        arc(points, R + FLUME.shell + 0.035, FLUME.open + 0.02, -FLUME.open - 0.02)
        arc(points, R + FLUME.shell - 0.002, -FLUME.open - 0.02, FLUME.open + 0.02)
        return points
      },
    })
  }

  // The water: a flat chord across the trough, tilted with the rider.
  const lift  = route.legs.find(leg => leg.section === SECTION.belt)!
  const water = sweepProfile(route.curve, {
    s0:        0.2,
    s1:        lift.s0 - 1.5,
    step:      0.3,
    sectionAt: () => SECTION.fibreglass,
    profile:   s => {
      const bank = route.bankAt(s)
      const a    = [ R * Math.sin(bank - WATER_W), R - R * Math.cos(bank - WATER_W) ]
      const b    = [ R * Math.sin(bank + WATER_W), R - R * Math.cos(bank + WATER_W) ]
      const pts: ProfilePoint[] = []
      for (let i = 0; i <= 6; i++)
        pts.push([ a[0] + (b[0] - a[0]) * i / 6, a[1] + (b[1] - a[1]) * i / 6 + 0.004 ])
      return pts
    },
  })

  return { shell: upload(gl, shell), flanges: upload(gl, flanges!), water: upload(gl, water) }
}

function inside (p: V3): boolean {
  return RIGS.some(rig => p[0] > rig.min[0] && p[0] < rig.max[0] && p[2] > rig.min[2] && p[2] < rig.max[2] &&
    p[1] > rig.min[1] - 0.5 && p[1] < rig.max[1])
}

/** Ties on the floors, brackets to the spiral core, trestles over the sea. */
export function buildSupports (stage: Stage): void {
  const route = getRoute()
  const frame = newFrame()
  const helix = route.legs.find(leg => leg.act === 'spiral')!
  const lift  = route.legs.find(leg => leg.section === SECTION.belt)!
  const at    = (o: V3, rx: number, uy: number): V3 => [
    o[0] + frame.right.x * rx + frame.up.x * uy,
    o[1] + frame.right.y * rx + frame.up.y * uy,
    o[2] + frame.right.z * rx + frame.up.z * uy,
  ]

  let k = 0
  for (let s = FLUME.flange * 0.5; s < route.length; s += FLUME.flange, k++) {
    levelFrame(route.curve, s, frame)
    const p: V3   = [ frame.pos.x, frame.pos.y, frame.pos.z ]
    const leg     = route.legAt(s)
    const section = sectionAt(s)
    if (section === SECTION.acrylic) {
      if (k % 2 || p[1] < SEABED + 1)
        continue
      for (const side of [ -0.35, 0.35 ]) {
        const foot = at(p, side * 1.6, 0)
        foot[1]    = SEABED
        stage.bar('galvanised', at(p, side, -0.02), foot, 0.07, 8)
      }
      continue
    }
    if (inside(p)) {
      stage.bar('steel', at(p, -0.72, -0.03), at(p, 0.72, -0.03), 0.045, 6)
      continue
    }
    if (leg === helix) {
      const dx = helix.centerX - p[0]
      const dz = helix.centerZ - p[2]
      const d  = Math.hypot(dx, dz)
      const tx = helix.centerX - dx / d * 4.1
      const tz = helix.centerZ - dz / d * 4.1
      stage.bar('galvanised', at(p, 0, -0.06), [ tx, p[1] - 0.25, tz ], 0.09, 6)
      stage.bar('galvanised', [ p[0] - dx / d * 0.7, p[1] + 0.05, p[2] - dz / d * 0.7 ], [ tx, p[1] - 1.9, tz ], 0.055, 6)
      continue
    }
    if (k % 2)
      continue
    // A trestle bent: cross head, two legs to the sea bed, an X between them.
    const a = at(p, -0.85, -0.12)
    const b = at(p, 0.85, -0.12)
    stage.bar('galvanised', a, b, 0.09, 4)
    stage.bar('galvanised', at(p, -0.35, -0.06), at(p, -0.35, -0.12), 0.06, 4)
    stage.bar('galvanised', at(p, 0.35, -0.06), at(p, 0.35, -0.12), 0.06, 4)
    const footA: V3 = [ a[0], SEABED, a[2] ]
    const footB: V3 = [ b[0], SEABED, b[2] ]
    stage.bar('galvanised', a, footA, 0.11, 8)
    stage.bar('galvanised', b, footB, 0.11, 8)
    const mid = Math.max(SEABED + 1, a[1] - 3.2)
    if (a[1] - mid > 1.2) {
      stage.bar('galvanised', a, [ b[0], mid, b[2] ], 0.04, 6)
      stage.bar('galvanised', b, [ a[0], mid, a[2] ], 0.04, 6)
    }
  }

  // The lift has a service stair alongside, its treads and its handrail.
  const tread = newFrame()
  for (let s = lift.s0 + 0.5; s < lift.s1 - 4; s += 0.32) {
    levelFrame(route.curve, s, tread)
    if (inside([ tread.pos.x, tread.pos.y, tread.pos.z ]))
      continue
    const x = tread.pos.x + 1.5
    const y = tread.pos.y - 0.05
    stage.span('steel', [ x - 0.45, y - 0.04, tread.pos.z - 0.14 ], [ x + 0.45, y, tread.pos.z + 0.14 ])
  }
  for (let s = lift.s0 + 2; s < lift.s1 - 6; s += 2.4) {
    levelFrame(route.curve, s, tread)
    const a: V3 = [ tread.pos.x + 2.0, tread.pos.y + 1.0, tread.pos.z ]
    levelFrame(route.curve, s + 2.4, tread)
    const b: V3 = [ tread.pos.x + 2.0, tread.pos.y + 1.0, tread.pos.z ]
    stage.bar('yellow', a, b, 0.025, 6)
    stage.bar('yellow', a, [ a[0], a[1] - 1.0, a[2] ], 0.02, 6)
  }
}
