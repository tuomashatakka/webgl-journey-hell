// A minimal CPU mesh builder with built-in support for pre-fracturing geometry
// into shards. gl/mesh uploads what it builds.
//
// The pipeline is two-phase: build on the CPU, then upload to the GPU.
// MeshBuilder accumulates triangles (or higher-level primitives) into a flat
// interleaved array of 12 floats per vertex — position(3), normal(3), uv(2),
// shard(4) — and a Uint32 index buffer. Nothing here touches WebGL, so
// the builder is useful for offline geometry processing and testing without a
// GL context.
//
// The shard attribute (aShard) carries per-vertex data that the vertex shader
// uses to rotate and translate individual shards independently. Its contract
// with the shader is:
//
//   aShard.xyz  = the *centroid* of the triangle's shard, in world space.
//                 The vertex shader subtracts this to pivot the shard about
//                 its own centre, rotates it, then adds the offset back.
//   aShard.w    = a per-shard random seed in [0, 1), generated from a
//                 caller-supplied RNG. The shader uses this to pick a
//                 unique rotation axis and angular velocity for each shard
//                 so they don't all tumble in lockstep.
//
// fracture() assigns shard IDs by spatial hashing: each triangle's centroid
// is floored into a cell of size `cellSize`, two triangles in the same cell
// share a shard, and adjacent shards therefore have adjacent (but distinct)
// IDs. This is a simple spatial hash — not a connected-component analysis —
// which is intentional: for a visual effect the exact shard boundaries matter
// less than uniform size and O(n) cost.
//
//
// Vertex arrays are grown by doubling: we start at a reasonable capacity and
// double it whenever it is exceeded. This gives amortised O(1) appends,
// which matters because a complex mesh can reach hundreds of thousands of
// floats and naive push-then-convert would reallocate and copy on every
// triangle.


import { grownTo } from '@wjh/math/arrays'

/** Interleaved vertex: position(3) normal(3) uv(2) shard(4) = 12 floats, stride 48 bytes. */
export const VERTEX_FLOATS = 12

/** The standard interleaved layout: position(3) normal(3) uv(2) shard(4). */
export const STANDARD_LAYOUT: AttribSpec[] = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 3, offset: 3 },
  { location: 2, size: 2, offset: 6 },
  { location: 3, size: 4, offset: 8 },
]

export interface MeshBuilder {

  /** Append one triangle by three positions; the normal is computed from the winding. */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, u?: number, v?: number): void;

  /** Append a quad as two triangles, wound a-b-c-d. */
  quad(a: number[], b: number[], c: number[], d: number[]): void;

  /** Append a box centred at (cx,cy,cz) with half-extents (hx,hy,hz). */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void;

  /** Append a tube swept along `path` with `radialSegments` sides and radius r. Each path entry is [x,y,z, upx,upy,upz]. */
  tube(path: number[][], radius: number, radialSegments: number): void;

  /**
   * Append one vertex with an explicit normal and uv and return its index, for
   * callers that build smooth-shaded or texture-mapped surfaces themselves.
   * `tri`/`quad` compute a flat normal and give all three corners one uv, which
   * is right for a box and wrong for a swept road that wants arc length in `v`.
   */
  vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number): number;

  /** Append one triangle by vertex indices from `vertex`. */
  face(a: number, b: number, c: number): void;
  readonly vertexCount: number;
  readonly indexCount:  number;

  /** Interleaved vertex data built so far. */
  vertices(): Float32Array;
  indices(): Uint32Array;

  /**
   * Split every shared vertex so each triangle owns its own three. Required
   * before `fracture`: a vertex shared by two triangles can only carry one
   * shard, so a shared vertex on a shard boundary is dragged by whichever shard
   * wrote it last and the two shards stay stitched together by it — a rigid
   * break comes out stringy. Triples the vertex count of a welded mesh, which
   * is why it is opt-in rather than the builder's default.
   */
  unweld(): void;
}

/** One vertex attribute of a custom layout: `size` floats at `offset` floats into the vertex. */
export interface AttribSpec {
  location: number;
  size:     number;
  offset:   number;
}

type V3 = [ number, number, number ]

/** Unit tangent of a tube's path at entry `pi`, from its neighbour (up, if they coincide). */
function pathTangent (path: number[][], pi: number): V3 {
  const [ px, py, pz ] = path[pi]
  const last           = pi === path.length - 1
  const [ qx, qy, qz ] = path[last ? pi - 1 : pi + 1]
  const s              = last ? -1 : 1
  const d: V3          = [ (qx - px) * s, (qy - py) * s, (qz - pz) * s ]
  const l              = Math.hypot(...d)
  return l < 1e-10 ? [ 0, 1, 0 ] : [ d[0] / l, d[1] / l, d[2] / l ]
}

/** A ring's right (fwd × up, or any perpendicular when fwd ≈ up) and its re-orthogonalised up. */
function ringBasis (fwd: V3, ux: number, uy: number, uz: number): [ V3, V3 ] {
  let rt: V3 = [ fwd[1] * uz - fwd[2] * uy, fwd[2] * ux - fwd[0] * uz, fwd[0] * uy - fwd[1] * ux ]
  if (Math.hypot(...rt) < 1e-10)
    rt = Math.abs(fwd[1]) < 0.9 ? [ -fwd[2], 0, fwd[0] ] : [ 1, 0, 0 ]

  const rl = Math.hypot(...rt)
  rt       = [ rt[0] / rl, rt[1] / rl, rt[2] / rl ]
  return [ rt, [ rt[1] * fwd[2] - rt[2] * fwd[1], rt[2] * fwd[0] - rt[0] * fwd[2], rt[0] * fwd[1] - rt[1] * fwd[0] ]]
}

export function createMeshBuilder (): MeshBuilder {
  let verts   = new Float32Array(1024)
  let indices = new Uint32Array(1024)
  let vLen    = 0
  let iLen    = 0

  const growV = (need: number) => {
    verts = grownTo(verts, vLen, need, 0)
  }

  const growI = (need: number) => {
    indices = grownTo(indices, iLen, need, 0)
  }

  const pushVert = (
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    sx: number, sy: number, sz: number, sw: number,
  ) => {
    growV(VERTEX_FLOATS)

    const o       = vLen
    verts[o]      = px
    verts[o + 1]  = py
    verts[o + 2]  = pz
    verts[o + 3]  = nx
    verts[o + 4]  = ny
    verts[o + 5]  = nz
    verts[o + 6]  = u
    verts[o + 7]  = v
    verts[o + 8]  = sx
    verts[o + 9]  = sy
    verts[o + 10] = sz
    verts[o + 11] = sw
    vLen += VERTEX_FLOATS
  }

  const pushIdx = (a: number, b: number, c: number) => {
    growI(3)
    indices[iLen]     = a
    indices[iLen + 1] = b
    indices[iLen + 2] = c
    iLen += 3
  }

  return {
    get vertexCount () {
      return vLen / VERTEX_FLOATS | 0
    },
    get indexCount () {
      return iLen
    },

    tri (ax, ay, az, bx, by, bz, cx, cy, cz, u = 0, v = 0) {
      const e1x = bx - ax,
        e1y     = by - ay,
        e1z     = bz - az
      const e2x = cx - ax,
        e2y     = cy - ay,
        e2z     = cz - az
      let nx = e1y * e2z - e1z * e2y
      let ny = e1z * e2x - e1x * e2z
      let nz = e1x * e2y - e1y * e2x
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (len > 1e-10) {
        nx /= len
        ny /= len
        nz /= len
      }
      else {
        nx = 0
        ny = 1
        nz = 0
      }

      const base = vLen / VERTEX_FLOATS | 0
      pushVert(ax, ay, az, nx, ny, nz, u, v, 0, 0, 0, 0)
      pushVert(bx, by, bz, nx, ny, nz, u, v, 0, 0, 0, 0)
      pushVert(cx, cy, cz, nx, ny, nz, u, v, 0, 0, 0, 0)
      pushIdx(base, base + 1, base + 2)
    },

    quad (a, b, c, d) {
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2])
    },

    vertex (px, py, pz, nx, ny, nz, u, v) {
      const idx = vLen / VERTEX_FLOATS | 0
      pushVert(px, py, pz, nx, ny, nz, u, v, 0, 0, 0, 0)
      return idx
    },

    face (a, b, c) {
      pushIdx(a, b, c)
    },

    box (cx, cy, cz, hx, hy, hz) {
      const faces = [
        { n: [ 0, 0, 1 ], v: [[ -1, -1, 1 ], [ 1, -1, 1 ], [ 1, 1, 1 ], [ -1, 1, 1 ]]},
        { n: [ 0, 0, -1 ], v: [[ 1, -1, -1 ], [ -1, -1, -1 ], [ -1, 1, -1 ], [ 1, 1, -1 ]]},
        { n: [ 0, 1, 0 ], v: [[ -1, 1, 1 ], [ 1, 1, 1 ], [ 1, 1, -1 ], [ -1, 1, -1 ]]},
        { n: [ 0, -1, 0 ], v: [[ -1, -1, -1 ], [ 1, -1, -1 ], [ 1, -1, 1 ], [ -1, -1, 1 ]]},
        { n: [ 1, 0, 0 ], v: [[ 1, -1, 1 ], [ 1, -1, -1 ], [ 1, 1, -1 ], [ 1, 1, 1 ]]},
        { n: [ -1, 0, 0 ], v: [[ -1, -1, -1 ], [ -1, -1, 1 ], [ -1, 1, 1 ], [ -1, 1, -1 ]]},
      ]
      const base = vLen / VERTEX_FLOATS | 0
      let idx = 0
      for (const face of faces) {
        for (const corner of face.v)
          pushVert(
            cx + corner[0] * hx, cy + corner[1] * hy, cz + corner[2] * hz,
            face.n[0], face.n[1], face.n[2],
            0, 0,
            0, 0, 0, 0,
          )
        pushIdx(base + idx, base + idx + 1, base + idx + 2)
        pushIdx(base + idx, base + idx + 2, base + idx + 3)
        idx += 4
      }
    },

    tube (path, radius, radialSegments) {
      if (path.length < 2 || radialSegments < 3)
        return

      const base = vLen / VERTEX_FLOATS | 0
      for (let pi = 0; pi < path.length; pi++) {
        const [ px, py, pz, ux, uy, uz ] = path[pi]
        const [ rt, up ]                 = ringBasis(pathTangent(path, pi), ux, uy, uz)
        for (let r = 0; r < radialSegments; r++) {
          // The normal points outward from the tube axis.
          const a  = 2 * Math.PI * r / radialSegments
          const nx = rt[0] * Math.cos(a) + up[0] * Math.sin(a)
          const ny = rt[1] * Math.cos(a) + up[1] * Math.sin(a)
          const nz = rt[2] * Math.cos(a) + up[2] * Math.sin(a)
          pushVert(px + radius * nx, py + radius * ny, pz + radius * nz, nx, ny, nz, 0, 0, 0, 0, 0, 0)
        }
      }

      // Connect consecutive rings with quads.
      for (let pi = 0; pi < path.length - 1; pi++)
        for (let r = 0; r < radialSegments; r++) {
          const n  = (r + 1) % radialSegments
          const i0 = base + pi * radialSegments + r
          const i1 = base + pi * radialSegments + n
          const i2 = base + (pi + 1) * radialSegments + n
          const i3 = base + (pi + 1) * radialSegments + r
          pushIdx(i0, i1, i2)
          pushIdx(i0, i2, i3)
        }
    },

    unweld () {
      const triCount = iLen / 3 | 0
      const outV     = new Float32Array(triCount * 3 * VERTEX_FLOATS)
      const outI     = new Uint32Array(triCount * 3)

      for (let t = 0; t < triCount * 3; t++) {
        const src = indices[t] * VERTEX_FLOATS
        const dst = t * VERTEX_FLOATS
        for (let k = 0; k < VERTEX_FLOATS; k++)
          outV[dst + k] = verts[src + k]
        outI[t] = t
      }

      verts   = outV
      indices = outI
      vLen    = outV.length
      iLen    = outI.length
    },

    vertices () {
      return verts.subarray(0, vLen)
    },

    indices () {
      return indices.subarray(0, iLen)
    },
  }
}

/**
 * Assign every triangle a shard: an integer id, the shard centroid, and a
 * seeded unit axis, written into the per-vertex `shard` attribute as
 * (centroidX, centroidY, centroidZ, seed).
 *
 * The vertex shader contract: aShard.xyz is the pivot point (shard centroid)
 * about which the shard is rotated and translated. aShard.w is the per-shard
 * random seed in [0, 1) used to derive a unique rotation axis and angular
 * velocity.
 */
export function fracture (
  builder: MeshBuilder, cellSize: number, rand: () => number,
): void {
  // Un-weld first, unconditionally. Fracture is precisely the operation that
  // requires per-triangle independence, so doing it here rather than trusting
  // the caller to remember is the difference between a rigid break and a
  // stringy one.
  builder.unweld()

  const idx      = builder.indices()
  const verts    = builder.vertices()
  const triCount = idx.length / 3 | 0

  // Cells are measured from the mesh's own minimum corner rather than from the
  // world origin. Flooring an absolute coordinate puts a cell boundary on every
  // axis plane through zero, so a prop modelled symmetrically about its own
  // origin — which is most of them — splits into eight octants however large a
  // cell is asked for. Offsetting by the bound makes `cellSize` mean what it
  // says: cells of that size, laid out across this mesh.
  const min    = meshMin(verts)
  const cellOf = ([ x, y, z ]: V3): string =>
    `${Math.floor((x - min[0]) / cellSize)},${Math.floor((y - min[1]) / cellSize)},${Math.floor((z - min[2]) / cellSize)}`

  // Bucket triangles by cell: summed centroids, count, seed.
  const shards = new Map<string, { c: V3; n: number; seed: number }>()
  for (let t = 0; t < triCount; t++) {
    const c   = triCentroid(verts, idx, t)
    const key = cellOf(c)
    const sh  = shards.get(key) ?? { c: [ 0, 0, 0 ], n: 0, seed: rand() }
    shards.set(key, sh)
    sh.c = [ sh.c[0] + c[0], sh.c[1] + c[1], sh.c[2] + c[2] ]
    sh.n += 1
  }
  for (const sh of shards.values())
    sh.c = [ sh.c[0] / sh.n, sh.c[1] / sh.n, sh.c[2] / sh.n ]

  // Every vertex of a triangle carries its shard: pivot xyz, seed w.
  for (let t = 0; t < triCount; t++) {
    const sh = shards.get(cellOf(triCentroid(verts, idx, t)))!
    for (let k = 0; k < 3; k++)
      verts.set([ sh.c[0], sh.c[1], sh.c[2], sh.seed ], idx[t * 3 + k] * VERTEX_FLOATS + 8)
  }
}

/** The smallest x, y and z over every vertex. */
function meshMin (verts: Float32Array): V3 {
  const min: V3 = [ Infinity, Infinity, Infinity ]
  for (let i = 0; i < verts.length; i += VERTEX_FLOATS)
    for (let a = 0; a < 3; a++)
      min[a] = Math.min(min[a], verts[i + a])
  return min
}

/** Centroid of triangle `t`. */
function triCentroid (verts: Float32Array, idx: Uint32Array, t: number): V3 {
  const c: V3 = [ 0, 0, 0 ]
  for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k] * VERTEX_FLOATS
    for (let a = 0; a < 3; a++)
      c[a] += verts[v + a] / 3
  }
  return c
}
