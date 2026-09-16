// THE SCENIC ROUTE — the land.
//
// The height field, the chunks it is cut into, and the rule that pulls it to
// the road. Everything in here is CPU-side and built once; the GPU sees plain
// meshes. Nothing reads a clock or Math.random — the field is a function of
// (x, z) and the route, so it is the same field on every machine.
//
// ---------------------------------------------------------------------------
// The lie of the land
// ---------------------------------------------------------------------------
//
// West to east: a valley floor at −60 (the county road runs down it at −55),
// rising to a ridge at 125, descending to a cliff-top shelf at 85 that the
// coast road runs along, and then the cliff, near vertical, into a seabed at
// −28. North-east of the ridge the plateau is flattened to 78 under downtown,
// so the helix is a ramp in the air above a plaza rather than a road cut into
// alternating hillsides — the nearest-spine pull that shapes every other
// corridor cannot be trusted where the spine passes over itself.
//
// The coastline is a smoothed knot curve forty metres seaward of the coast
// road, wobbled by noise so it reads as a coast and not as an offset.
//
// ---------------------------------------------------------------------------
// The corridor pull
// ---------------------------------------------------------------------------
//
// Within eight metres of the spine the ground *is* the road's own level (less a
// shoulder); between eight and twenty-six it blends to the natural height.
// That one rule produces a cutting where the hill is above the road and an
// embankment where it is below, which is what roads do to hills. It applies
// only on the sections that run on the ground — the fall, the throat and the
// cave are elsewhere, and downtown is the plaza.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { hash2 } from '@/lib/rng'
import type { Route } from './course'


// --- noise ---------------------------------------------------------------------

function vnoise (x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  let fx = x - ix
  let fz = z - iz
  fx = fx * fx * (3 - 2 * fx)
  fz = fz * fz * (3 - 2 * fz)

  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
}

/** Five octaves, 0..1. */
export function fbm (x: number, z: number): number {
  let amp = 0.5
  let sum = 0
  let px  = x
  let pz  = z
  for (let i = 0; i < 5; i++) {
    sum += amp * vnoise(px, pz)
    px   = px * 2.03 + 17.1
    pz   = pz * 2.03 + 9.7
    amp *= 0.5
  }
  return sum
}

function smoothstep (e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// --- the coastline -------------------------------------------------------------

/** (z, x) knots of the sea's edge, forty metres seaward of the coast road. */
const COAST: [ number, number ][] = [
  [ -400, 430 ], [ 0, 425 ], [ 100, 445 ], [ 150, 490 ], [ 190, 560 ], [ 215, 572 ],
  [ 226, 552 ], [ 242, 524 ], [ 280, 492 ], [ 335, 468 ], [ 400, 454 ], [ 470, 448 ],
  [ 540, 446 ], [ 700, 446 ], [ 1200, 440 ],
]

/** x of the cliff edge at z, smoothed and wobbled. */
export function cliffX (z: number): number {
  let i = 0
  while (i < COAST.length - 2 && z > COAST[i + 1][0])
    i++

  const [ z0, x0 ] = COAST[i]
  const [ z1, x1 ] = COAST[i + 1]
  const t          = smoothstep(z0, z1, z)
  return x0 + (x1 - x0) * t + (fbm(z * 0.011, 3.3) - 0.5) * 22
}

// --- the height field ----------------------------------------------------------

export const SEA_LEVEL   = 0
export const SEABED      = -28
export const PLAZA_Y     = 78
export const PLAZA       = { x: 385, z: 665, r0: 130, r1: 210 }
export const VALLEY_Y    = -60
export const RIDGE_Y     = 125
export const SHELF_Y     = 85

/** The land before anything is built on it. */
export function naturalHeight (x: number, z: number): number {
  // Valley to ridge to shelf.
  let h = VALLEY_Y + (RIDGE_Y - VALLEY_Y) * smoothstep(0, 340, x)
  h    -= (RIDGE_Y - SHELF_Y) * smoothstep(340, 480, x)

  // Rolling relief: gentle on the valley floor, hilly on the ridge's flank.
  const amp = 4 + 28 * smoothstep(50, 260, x) * (1 - smoothstep(300, 440, x))
  h += (fbm(x * 0.0041 + 3.1, z * 0.0041) - 0.5) * 2 * amp
  h += (fbm(x * 0.021, z * 0.021 + 7.7) - 0.5) * 2 * 1.6

  // Downtown's plaza.
  const dPlaza = Math.hypot(x - PLAZA.x, z - PLAZA.z)
  h = h + (PLAZA_Y - h) * (1 - smoothstep(PLAZA.r0, PLAZA.r1, dPlaza))

  // The cliff. Ten metres of horizontal for the whole drop.
  const d   = x - cliffX(z)
  const sea = smoothstep(-3, 7, d)
  h = h + (SEABED + (fbm(x * 0.03, z * 0.03) - 0.5) * 3 - h) * sea
  return h
}

// --- nearest spine -------------------------------------------------------------

export interface SpineIndex {
  cell:    number;
  grid:    Map<number, number[]>; // cell key -> [x, y, z, s, x, y, z, s, ...]
  /**
   * Spines that run under the sea bed (the throat, the river). The bed is dug
   * out beneath them, seaward of the cliff, so it cannot slice through the
   * cave; the stored height is already the trench floor.
   */
  trench?: SpineIndex;
}

/**
 * Samples of the spine every two metres on the ground sections, bucketed into
 * cells, so the corridor pull is an O(1) lookup at every terrain vertex.
 */
export function buildSpineIndex (
  route: Route, sections: number[], cell = 32,
  lift?: (section: number, s: number) => number,
): SpineIndex {
  const grid = new Map<number, number[]>()
  const key  = (cx: number, cz: number) => cx * 73856093 ^ cz * 19349663
  for (const i of sections) {
    const sp = route.spans[i]
    for (let s = sp.s0; s < sp.s1; s += 2) {
      const p  = route.curve.pointAtDistance(s)
      const cx = Math.floor(p.x / cell)
      const cz = Math.floor(p.z / cell)
      const k  = key(cx, cz)
      let arr  = grid.get(k)
      if (!arr) {
        arr = []
        grid.set(k, arr)
      }
      arr.push(p.x, p.y + (lift ? lift(i, s) : 0), p.z, s)
    }
  }
  return { cell, grid }
}

const near = { d: 0, y: 0, s: 0 }

/** Horizontal distance to the nearest spine sample within the 3×3 cells, and its height. */
export function nearestSpine (idx: SpineIndex, x: number, z: number): typeof near {
  const cx = Math.floor(x / idx.cell)
  const cz = Math.floor(z / idx.cell)
  near.d   = Infinity
  near.y   = 0
  near.s   = 0
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const arr = idx.grid.get((cx + i) * 73856093 ^ (cz + j) * 19349663)
      if (!arr)
        continue
      for (let k = 0; k < arr.length; k += 4) {
        const d = Math.hypot(arr[k] - x, arr[k + 2] - z)
        if (d < near.d) {
          near.d = d
          near.y = arr[k + 1]
          near.s = arr[k + 3]
        }
      }
    }
  return near
}

/**
 * Does any spine sample pass within `r` metres horizontally of (x, z) with its
 * height inside [y0, y1], other than the stretch within `sExclude` ± 40 m? The
 * clearance test for everything that stands near the road: a pier must not
 * land on the deck below it, a post must not stand in a crossing road.
 */
export function spineHits (idx: SpineIndex, x: number, z: number, r: number, y0: number, y1: number, sExclude = -1e9): boolean {
  const cx = Math.floor(x / idx.cell)
  const cz = Math.floor(z / idx.cell)
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const arr = idx.grid.get((cx + i) * 73856093 ^ (cz + j) * 19349663)
      if (!arr)
        continue
      for (let k = 0; k < arr.length; k += 4) {
        if (Math.abs(arr[k + 3] - sExclude) < 40)
          continue
        if (arr[k + 1] < y0 || arr[k + 1] > y1)
          continue
        if (Math.hypot(arr[k] - x, arr[k + 2] - z) < r)
          return true
      }
    }
  return false
}

/** The land with the road pressed into it. */
export function terrainHeight (idx: SpineIndex, x: number, z: number): number {
  let h     = naturalHeight(x, z)
  const cx  = cliffX(z)
  const sea = smoothstep(cx - 9, cx - 1, x)

  if (idx.trench && sea > 0) {
    const t = nearestSpine(idx.trench, x, z)
    if (t.d < 44) {
      const w = (1 - smoothstep(14, 44, t.d)) * sea
      h += (Math.min(h, t.y) - h) * w
    }
  }

  const n = nearestSpine(idx, x, z)
  // A wide embankment: the incline climbs well above the natural hill and
  // must stand on land, not float over it.
  if (n.d > 60)
    return h

  let w = 1 - smoothstep(10, 60, n.d)
  // The embankment stops at the cliff: the sea side keeps its drop and its
  // seabed, or the corridor would lay a shelf over the water.
  w *= 1 - sea
  return h + (n.y - 0.28 - h) * w
}

// --- chunks --------------------------------------------------------------------

export interface TerrainChunk {
  builder: MeshBuilder;
  cx:      number;
  cy:      number;
  cz:      number;
  radius:  number;
}

/**
 * One square chunk of heightfield, `cells` × `cells` quads of `cell` metres,
 * smooth-shaded from central differences of the field itself. uv carries the
 * world xz for the material, and the shard attribute is unused.
 */
export function buildTerrainChunk (
  idx: SpineIndex, x0: number, z0: number, cells: number, cell: number,
  heightAt: (x: number, z: number) => number = (x, z) => terrainHeight(idx, x, z),
): TerrainChunk {
  const b   = createMeshBuilder()
  const n   = cells + 1
  const ids = new Int32Array(n * n)
  let minY = Infinity
  let maxY = -Infinity
  const e   = cell * 0.5

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x  = x0 + i * cell
      const z  = z0 + j * cell
      const h  = heightAt(x, z)
      const hx = heightAt(x + e, z) - heightAt(x - e, z)
      const hz = heightAt(x, z + e) - heightAt(x, z - e)
      let nx = -hx
      let ny = 2 * e
      let nz = -hz
      const l  = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      ids[j * n + i] = b.vertex(x, h, z, nx, ny, nz, x, z)
      minY = Math.min(minY, h)
      maxY = Math.max(maxY, h)
    }

  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const a = ids[j * n + i]
      const c = ids[j * n + i + 1]
      const d = ids[(j + 1) * n + i + 1]
      const f = ids[(j + 1) * n + i]
      // Counter-clockwise seen from above (+y): a, f, d then a, d, c.
      b.face(a, f, d)
      b.face(a, d, c)
    }

  const half = cells * cell * 0.5
  return {
    builder: b,
    cx:      x0 + half,
    cy:      (minY + maxY) * 0.5,
    cz:      z0 + half,
    radius:  Math.hypot(half, half, (maxY - minY) * 0.5),
  }
}

/** The near field: 100 m chunks at 4 m over the route's bounding box. */
export const NEAR = { x0: -300, z0: -320, nx: 11, nz: 13, size: 100, cell: 4 }

/** The far field: one coarse mesh to the horizon with the near field cut out. */
export const FAR = { x0: -2700, z0: -2700, size: 6000, cell: 60 }

export function buildNearChunks (idx: SpineIndex): TerrainChunk[] {
  const out: TerrainChunk[] = []
  const cells               = NEAR.size / NEAR.cell
  for (let j = 0; j < NEAR.nz; j++)
    for (let i = 0; i < NEAR.nx; i++)
      out.push(buildTerrainChunk(idx, NEAR.x0 + i * NEAR.size, NEAR.z0 + j * NEAR.size, cells, NEAR.cell))
  return out
}

export function buildFarMesh (idx: SpineIndex): TerrainChunk {
  const b      = createMeshBuilder()
  const cells  = FAR.size / FAR.cell
  const n      = cells + 1
  const ids    = new Int32Array(n * n)
  const nearX1 = NEAR.x0 + NEAR.nx * NEAR.size
  const nearZ1 = NEAR.z0 + NEAR.nz * NEAR.size
  const inside = (x: number, z: number) =>
    x > NEAR.x0 + 1 && x < nearX1 - 1 && z > NEAR.z0 + 1 && z < nearZ1 - 1

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x        = FAR.x0 + i * FAR.cell
      const z        = FAR.z0 + j * FAR.cell
      const h        = terrainHeight(idx, x, z)
      const e        = FAR.cell * 0.5
      const hx       = naturalHeight(x + e, z) - naturalHeight(x - e, z)
      const hz       = naturalHeight(x, z + e) - naturalHeight(x, z - e)
      const l        = Math.hypot(hx, 2 * e, hz) || 1
      ids[j * n + i] = b.vertex(x, h, z, -hx / l, 2 * e / l, -hz / l, x, z)
    }
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const x = FAR.x0 + i * FAR.cell
      const z = FAR.z0 + j * FAR.cell
      // Skip cells fully inside the near field; the seam is hidden by the near
      // chunks' own vertices lying on the same function.
      if (inside(x, z) && inside(x + FAR.cell, z + FAR.cell))
        continue

      const a = ids[j * n + i]
      const c = ids[j * n + i + 1]
      const d = ids[(j + 1) * n + i + 1]
      const f = ids[(j + 1) * n + i]
      b.face(a, f, d)
      b.face(a, d, c)
    }
  return { builder: b, cx: FAR.x0 + FAR.size / 2, cy: 0, cz: FAR.z0 + FAR.size / 2, radius: FAR.size }
}

/** The sea surface: one big quad at sea level east of the valley. */
/** A fine square of sea for the waves, centred where the fall lands. */
export function buildSeaPatch (
  cx: number, cz: number, half: number, cells: number,
  skip?: (x: number, z: number) => boolean,
): MeshBuilder {
  const b   = createMeshBuilder()
  const ids = new Int32Array((cells + 1) * (cells + 1))
  for (let j = 0; j <= cells; j++)
    for (let i = 0; i <= cells; i++) {
      const x                  = cx - half + 2 * half * (i / cells)
      const z                  = cz - half + 2 * half * (j / cells)
      ids[j * (cells + 1) + i] = b.vertex(x, SEA_LEVEL, z, 0, 1, 0, x, z)
    }
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      if (skip) {
        const x = cx - half + 2 * half * ((i + 0.5) / cells)
        const z = cz - half + 2 * half * ((j + 0.5) / cells)
        if (skip(x, z))
          continue
      }

      const a = ids[j * (cells + 1) + i]
      const c = ids[j * (cells + 1) + i + 1]
      const d = ids[(j + 1) * (cells + 1) + i + 1]
      const f = ids[(j + 1) * (cells + 1) + i]
      b.face(a, f, d)
      b.face(a, d, c)
    }
  return b
}

export const SEA_PATCH = { x: 640, z: 190, half: 520, cells: 110 }

export function buildSeaQuad (): MeshBuilder {
  const b  = createMeshBuilder()
  const x0 = 380
  const x1 = 3400
  const z0 = -2800
  const z1 = 3400
  const y  = SEA_LEVEL
  // Tessellated a little so a vertex-shader wave has something to move later.
  const n   = 24
  const ids = new Int32Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x              = x0 + (x1 - x0) * (i / n)
      const z              = z0 + (z1 - z0) * (j / n)
      ids[j * (n + 1) + i] = b.vertex(x, y, z, 0, 1, 0, x, z)
    }

  // Cells fully under the fine patch are left out; the patch's wave amplitude
  // fades to zero before its edge so the two meet flat.
  const inPatch = (x: number, z: number) =>
    Math.abs(x - SEA_PATCH.x) < SEA_PATCH.half && Math.abs(z - SEA_PATCH.z) < SEA_PATCH.half
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const xa = x0 + (x1 - x0) * (i / n)
      const za = z0 + (z1 - z0) * (j / n)
      const xb = x0 + (x1 - x0) * ((i + 1) / n)
      const zb = z0 + (z1 - z0) * ((j + 1) / n)
      if (inPatch(xa, za) && inPatch(xb, zb))
        continue

      const a = ids[j * (n + 1) + i]
      const c = ids[j * (n + 1) + i + 1]
      const d = ids[(j + 1) * (n + 1) + i + 1]
      const f = ids[(j + 1) * (n + 1) + i]
      b.face(a, f, d)
      b.face(a, d, c)
    }
  return b
}
