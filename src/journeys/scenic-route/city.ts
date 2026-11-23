// THE SCENIC ROUTE — downtown.
//
// Towers are one massing mesh, instanced. Each instance carries where it
// stands, how big it is, how it bends (a direction in the plane, a curvature
// coefficient and a twist) and how it is massed: a podium, a setback crown, a
// parapet, a plant room on the roof and sometimes a mast. The vertex shader
// does the bending live so the lap gain can grow it without touching a buffer
// — by the third lap the skyline leans over the road like grass over a path.
//
// The mesh is not to scale. Every vertex names a level (ground, podium top,
// setback, roof, parapet top, plant top, mast top) and an inset (none, podium,
// crown, parapet, plant, mast) instead of a position, and the vertex shader
// resolves both in metres from the instance, so a 1.1 m parapet is 1.1 m on a
// 14 m block and on the 128 m core alike. A part an instance does not have
// collapses to nothing (zero height or zero width) or sinks under the roof.
//
// Placement is a jittered grid over the plaza disc with the road corridor
// carved out, a tall core inside the helix the road spirals around, and lower
// blocks wherever the elevated road passes overhead.

import { VERTEX_FLOATS } from '@wjh/geometry/meshBuilder'
import { levelFrame } from '@wjh/geometry/sweep'
import { newFrame } from '@wjh/geometry/curve'
import { signedCurvature } from './course'
import type { Route } from './course'
import { PLAZA, buildSpineIndex, nearestSpine, terrainHeight } from './geometry'
import type { SpineIndex } from './geometry'


const TOWER_FLOATS = 16

/** Levels and insets the vertex shader resolves in metres (`towerVert`). */
const LEVEL = { GROUND: 0, PODIUM: 1, SETBACK: 2, ROOF: 3, PARAPET: 4, PLANT: 5, MAST: 6 }
const INSET = { NONE: 0, PODIUM: 1, CROWN: 2, PARAPET: 3, PLANT: 4, MAST: 5 }

/** What a face is made of: facade, parapet, plant-room louvres, mast steel. */
const PART = { WALL: 0, PARAPET: 1, PLANT: 2, MAST: 3 }

/** The largest lap gain the bend is ever drawn with: `bendGainAt(3)`. */
const BEND_GAIN_MAX = bendGainAt(3)

interface TowerMesh {
  vertices: Float32Array;
  indices:  Uint32Array;
}

export interface TowerSet {
  vertices:  Float32Array;
  indices:   Uint32Array;
  instances: Float32Array;
  count:     number;
}

/** How much the bend grows per lap: 1, 1.8, 2.6 at the lap boundaries. */
export function bendGainAt (lapF: number): number {
  return 1 + lapF * 0.8
}

function hash (n: number): number {
  const x = Math.sin(n * 91.17 + 7.31) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The massing mesh. A vertex is (x sign, level, z sign) with the inset and the
 * part in the shard slot; corners are ±0.5 and the shader scales each axis by
 * its width less twice the inset. Sides run round the footprint in one
 * direction, so a wall, a ring and a cap all wind outward or upward alike.
 */
function towerMesh (): TowerMesh {
  const v: number[]   = []
  const idx: number[] = []
  const h             = 0.5
  // Each side: start corner, end corner, outward normal.
  const sides: [ number, number, number, number, number, number ][] = [
    [ -h, h, h, h, 0, 1 ],
    [ h, h, h, -h, 1, 0 ],
    [ h, -h, -h, -h, 0, -1 ],
    [ -h, -h, -h, h, -1, 0 ],
  ]

  const vert = (x: number, level: number, z: number, nx: number, ny: number, nz: number, u: number, inset: number, part: number) => {
    v.push(x, level, z, nx, ny, nz, u, 0, inset, part, 0, 0)
    return v.length / VERTEX_FLOATS - 1
  }
  const quad = (a: number, b: number, c: number, d: number) => {
    idx.push(a, b, c, a, c, d)
  }

  /** Four walls from level l0 up to l1 at an inset, facing out or (for a parapet's back) in. */
  const walls = (l0: number, l1: number, inset: number, part: number, inward = false) => {
    for (const [ x0, z0, x1, z1, nx, nz ] of sides) {
      const [ ax, az, bx, bz ] = inward ? [ x1, z1, x0, z0 ] : [ x0, z0, x1, z1 ]
      const sn                 = inward ? -1 : 1
      quad(
        vert(ax, l0, az, nx * sn, 0, nz * sn, 0, inset, part),
        vert(bx, l0, bz, nx * sn, 0, nz * sn, 1, inset, part),
        vert(bx, l1, bz, nx * sn, 0, nz * sn, 1, inset, part),
        vert(ax, l1, az, nx * sn, 0, nz * sn, 0, inset, part),
      )
    }
  }

  /** A flat ring at one level between an outer and an inner inset. */
  const ring = (level: number, outer: number, inner: number, part: number) => {
    for (const [ x0, z0, x1, z1 ] of sides)
      quad(
        vert(x0, level, z0, 0, 1, 0, 0, outer, part),
        vert(x1, level, z1, 0, 1, 0, 1, outer, part),
        vert(x1, level, z1, 0, 1, 0, 1, inner, part),
        vert(x0, level, z0, 0, 1, 0, 0, inner, part),
      )
  }

  /** A flat cap at one level over an inset. */
  const cap = (level: number, inset: number, part: number) => {
    quad(
      vert(-h, level, h, 0, 1, 0, 0, inset, part),
      vert(h, level, h, 0, 1, 0, 1, inset, part),
      vert(h, level, -h, 0, 1, 0, 1, inset, part),
      vert(-h, level, -h, 0, 1, 0, 0, inset, part),
    )
  }

  walls(LEVEL.GROUND, LEVEL.PODIUM, INSET.NONE, PART.WALL)
  ring(LEVEL.PODIUM, INSET.NONE, INSET.PODIUM, PART.WALL)
  walls(LEVEL.PODIUM, LEVEL.SETBACK, INSET.PODIUM, PART.WALL)
  ring(LEVEL.SETBACK, INSET.PODIUM, INSET.CROWN, PART.WALL)
  walls(LEVEL.SETBACK, LEVEL.PARAPET, INSET.CROWN, PART.WALL)
  ring(LEVEL.PARAPET, INSET.CROWN, INSET.PARAPET, PART.PARAPET)
  walls(LEVEL.ROOF, LEVEL.PARAPET, INSET.PARAPET, PART.PARAPET, true)
  cap(LEVEL.ROOF, INSET.PARAPET, PART.WALL)
  walls(LEVEL.ROOF, LEVEL.PLANT, INSET.PLANT, PART.PLANT)
  cap(LEVEL.PLANT, INSET.PLANT, PART.PLANT)
  walls(LEVEL.PLANT, LEVEL.MAST, INSET.MAST, PART.MAST)
  cap(LEVEL.MAST, INSET.MAST, PART.MAST)
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) }
}

/**
 * How a tower is massed, in metres: podium height (0 for none), setback height
 * (the roof's for none), the crown's inset, and the mast and plant room packed
 * as mast + plant / 10 (whole metres of mast, 0 for none; plant under 4 m, 0
 * for none). A tower held down under an overhead road keeps a bare roof.
 */
function massFor (w: number, d: number, h: number, seed: number, capped: boolean): number[] {
  const m     = Math.min(w, d)
  const podH  = h > 25 && hash(seed + 11) < 0.55 ? 4.5 + hash(seed + 12) * 3 : 0
  const insA  = podH > 0 ? Math.min(1.6, 0.08 * m) : 0
  const set   = h > 34 && hash(seed + 13) < 0.65
  const setY  = set ? h * (0.6 + hash(seed + 14) * 0.25) : h
  const insB  = insA + (set ? Math.min(0.22 * m, 2 + hash(seed + 15) * 2.5) : 0)
  const plant = capped ? 0 : 2.6 + hash(seed + 16) * 1.2
  const mast  = !capped && h > 60 && hash(seed + 17) < 0.4 ? Math.round(6 + hash(seed + 18) * 14) : 0
  return [ podH, setY, insB, mast + plant / 10 ]
}

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
    dirX: number, dirZ: number, k: number, twist: number, capped = false,
  ) => {
    const y = terrainHeight(land, x, z) - 0.4
    data.push(x, y, z, yaw, w, h, d, seed, dirX, dirZ, k, twist, ...massFor(w, d, h, seed, capped))
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
      const tall   = 22 + hash(seed + 7) * 40 + centre * 55
      const capped = road.d < 26 + half
      const h      = capped ? Math.min(tall, Math.max(14, road.y - base - 7)) : tall
      add(x, z, w, d, h, (hash(seed + 8) - 0.5) * 0.5, seed, b.dx, b.dz, leanCap(b.k, h, road.d - clearance), b.twist, capped)
    }

  return {
    ...towerMesh(),
    instances: new Float32Array(data),
    count:     data.length / TOWER_FLOATS,
  }
}
