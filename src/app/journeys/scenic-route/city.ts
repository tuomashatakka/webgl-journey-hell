// THE SCENIC ROUTE — downtown.
//
// Towers are one unit box, instanced. Each instance carries where it stands,
// how big it is, and how it bends: a direction in the plane, a curvature
// coefficient and a twist. The vertex shader does the bending live so the lap
// gain can grow it without touching a buffer — by the third lap the skyline
// leans over the road like grass over a path.
//
// Placement is a jittered grid over the plaza disc with the road corridor
// carved out, a tall core inside the helix the road spirals around, and lower
// blocks wherever the elevated road passes overhead.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { levelFrame, newFrame } from '@/lib/sweep'
import { signedCurvature } from './course'
import type { Route } from './course'
import { PLAZA, buildSpineIndex, nearestSpine, terrainHeight } from './geometry'
import type { SpineIndex } from './geometry'


export const TOWER_FLOATS = 12

/** How much the bend grows per lap: 1, 1.8, 2.6 at the lap boundaries. */
export function bendGainAt (lapF: number): number {
  return 1 + lapF * 0.8
}

export interface TowerSet {
  builder:   MeshBuilder;
  instances: Float32Array;
  count:     number;
}

function hash (n: number): number {
  const x = Math.sin(n * 91.17 + 7.31) * 43758.5453
  return x - Math.floor(x)
}

/** The unit tower: x,z in [-0.5, 0.5], y in [0, 1], uv per face with v up. */
function unitBox (): MeshBuilder {
  const b = createMeshBuilder()
  type V3 = [ number, number, number ]

  const face = (p0: V3, p1: V3, p2: V3, p3: V3, n: V3) => {
    const a = b.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], 0, 0)
    const c = b.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], 1, 0)
    const d = b.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], 1, 1)
    const e = b.vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], 0, 1)
    b.face(a, c, d)
    b.face(a, d, e)
  }
  const h = 0.5
  face([ -h, 0, h ], [ h, 0, h ], [ h, 1, h ], [ -h, 1, h ], [ 0, 0, 1 ])
  face([ h, 0, -h ], [ -h, 0, -h ], [ -h, 1, -h ], [ h, 1, -h ], [ 0, 0, -1 ])
  face([ h, 0, h ], [ h, 0, -h ], [ h, 1, -h ], [ h, 1, h ], [ 1, 0, 0 ])
  face([ -h, 0, -h ], [ -h, 0, h ], [ -h, 1, h ], [ -h, 1, -h ], [ -1, 0, 0 ])
  face([ -h, 1, h ], [ h, 1, h ], [ h, 1, -h ], [ -h, 1, -h ], [ 0, 1, 0 ])
  return b
}

/** The largest lap gain the bend is ever drawn with: `bendGainAt(3)`. */
const BEND_GAIN_MAX = bendGainAt(3)

export function buildCity (route: Route, land: SpineIndex): TowerSet {
  const downtown       = buildSpineIndex(route, [ 2 ], 32)
  // Clearance is against every road near the plaza, not only the helix: the
  // incline arrives across the north edge and the coast road leaves south.
  const roads          = buildSpineIndex(route, [ 1, 2, 3 ], 32)
  const frame          = newFrame()
  const data: number[] = []
  const helix          = { x: 360, z: 685 }

  const add = (
    x: number, z: number, w: number, d: number, h: number, yaw: number, seed: number,
    dirX: number, dirZ: number, k: number, twist: number,
  ) => {
    const y = terrainHeight(land, x, z) - 0.4
    data.push(x, y, z, yaw, w, h, d, seed, dirX, dirZ, k, twist)
  }

  /**
   * The bend leans the top toward the road by k·h² per unit gain. Cap k so the
   * top never crosses into the deck at the last lap's gain: the tower may lean
   * to `room` metres short of the road's edge and no further.
   */
  const leanCap = (k: number, h: number, room: number) =>
    Math.min(k, Math.max(0, room) / Math.max(1, h * h * BEND_GAIN_MAX))

  /** Bend parameters from the nearest stretch of road. */
  const bendFor = (x: number, z: number, seed: number) => {
    const n = nearestSpine(downtown, x, z)
    const f = levelFrame(route.curve, n.s, frame)
    let dx = f.pos.x - x
    let dz = f.pos.z - z
    const l  = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l

    const kappa = Math.abs(signedCurvature(route.curve, n.s))
    const k     = 0.0007 + kappa * 0.03 + hash(seed + 3) * 0.0004
    const twist = (0.12 + hash(seed + 4) * 0.3) * (hash(seed + 5) < 0.5 ? -1 : 1)
    return { dx, dz, k, twist, d: n.d, roadY: n.y }
  }

  // The core: what the helix wraps.
  add(helix.x, helix.z, 24, 24, 128, 0.2, 1, 0, 0, leanCap(0.0006, 128, 45 - 12 - 3.2 - 4), 0.35)
  add(helix.x - 22, helix.z + 14, 10, 12, 62, 0.9, 2, 0.7, -0.7, leanCap(0.0011, 62, 10), -0.2)
  add(helix.x + 20, helix.z - 16, 11, 10, 54, -0.4, 3, -0.7, 0.7, leanCap(0.0011, 54, 10), 0.25)

  // The grid over the plaza.
  const step = 30
  let seed   = 10
  for (let gz = -PLAZA.r0 - 20; gz <= PLAZA.r0 + 20; gz += step)
    for (let gx = -PLAZA.r0 - 20; gx <= PLAZA.r0 + 20; gx += step) {
      seed++

      const x = PLAZA.x + gx + (hash(seed) - 0.5) * 14 + (gz / step % 2 ? step / 2 : 0)
      const z = PLAZA.z + gz + (hash(seed + 1) - 0.5) * 14
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) > PLAZA.r0 + 30)
        continue
      if (Math.hypot(x - helix.x, z - helix.z) < 66)
        continue

      const w         = 12 + hash(seed + 2) * 14
      const d         = 12 + hash(seed + 6) * 14
      const b         = bendFor(x, z, seed)
      const road      = nearestSpine(roads, x, z)
      const half      = Math.max(w, d) * 0.5
      const clearance = 3.2 + 8 + half
      if (road.d < clearance)
        continue

      // Taller toward the centre, and never up into an overhead road.
      const centre = 1 - Math.min(1, Math.hypot(x - PLAZA.x, z - PLAZA.z) / (PLAZA.r0 + 30))
      const base   = terrainHeight(land, x, z)
      let h        = 22 + hash(seed + 7) * 40 + centre * 55
      if (road.d < 26 + half)
        h = Math.min(h, Math.max(14, road.y - base - 7))
      add(x, z, w, d, h, (hash(seed + 8) - 0.5) * 0.5, seed, b.dx, b.dz, leanCap(b.k, h, road.d - clearance), b.twist)
    }

  return {
    builder:   unitBox(),
    instances: new Float32Array(data),
    count:     data.length / TOWER_FLOATS,
  }
}
