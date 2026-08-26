// A minimal WebGL2 mesh builder and drawable with built-in support for pre-
// fracturing geometry into shards.
//
// The pipeline is two-phase: build on the CPU, then upload to the GPU.
// MeshBuilder accumulates triangles (or higher-level primitives) into a flat
// interleaved array of 12 floats per vertex — position(3), normal(3), uv(2),
// shard(4) — and a Uint32 index buffer. Nothing touches WebGL until you call
// createMesh, so the builder is useful for offline geometry processing and
// testing without a GL context.
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
// createMesh builds a VAO, an interleaved VBO, and a Uint32 IBO. WebGL2
// supports 32-bit indices natively — no OES_element_index_uint extension
// needed, unlike WebGL1 — which lets us draw meshes with more than 65 k
// vertices without splitting. The instance VBO is created lazily on the first
// call to setInstances and uses bufferSubData when the new payload fits
// inside the current allocation, only calling bufferData to reallocate when
// the data has grown. This avoids thrashing the driver on every frame when
// the instance list grows incrementally (e.g. a train gaining cars each lap).
//
// Vertex arrays are grown by doubling: we start at a reasonable capacity and
// double it whenever it is exceeded. This gives amortised O(1) appends,
// which matters because a complex mesh can reach hundreds of thousands of
// floats and naive push-then-convert would reallocate and copy on every
// triangle.


/** Interleaved vertex: position(3) normal(3) uv(2) shard(4) = 12 floats, stride 48 bytes. */
export const VERTEX_FLOATS = 12


export interface MeshBuilder {

  /** Append one triangle by three positions; the normal is computed from the winding. */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, u?: number, v?: number): void;

  /** Append a quad as two triangles, wound a-b-c-d. */
  quad(a: number[], b: number[], c: number[], d: number[]): void;

  /** Append a box centred at (cx,cy,cz) with half-extents (hx,hy,hz). */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void;

  /** Append a tube swept along `path` with `radialSegments` sides and radius r. Each path entry is [x,y,z, upx,upy,upz]. */
  tube(path: number[][], radius: number, radialSegments: number): void;
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


export function createMeshBuilder (): MeshBuilder {
  let verts   = new Float32Array(1024)
  let indices = new Uint32Array(1024)
  let vLen    = 0
  let iLen    = 0

  const growV = (need: number) => {
    if (vLen + need <= verts.length)
      return

    let cap = verts.length
    while (cap < vLen + need)
      cap *= 2

    const next = new Float32Array(cap)
    next.set(verts.subarray(0, vLen))
    verts = next
  }

  const growI = (need: number) => {
    if (iLen + need <= indices.length)
      return

    let cap = indices.length
    while (cap < iLen + need)
      cap *= 2

    const next = new Uint32Array(cap)
    next.set(indices.subarray(0, iLen))
    indices = next
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

      const base                                  = vLen / VERTEX_FLOATS | 0
      const fwd                                   = [ 0, 0, 0 ]
      const rt                                    = [ 0, 0, 0 ]
      const up                                    = [ 0, 0, 0 ]
      const ring: Array<[number, number, number]> = []

      for (let pi = 0; pi < path.length; pi++) {
        const [ px, py, pz, ux, uy, uz ] = path[pi]

        // Tangent from consecutive path entries.
        if (pi < path.length - 1) {
          fwd[0] = path[pi + 1][0] - px
          fwd[1] = path[pi + 1][1] - py
          fwd[2] = path[pi + 1][2] - pz
        }
        else {
          fwd[0] = px - path[pi - 1][0]
          fwd[1] = py - path[pi - 1][1]
          fwd[2] = pz - path[pi - 1][2]
        }

        let fl = Math.sqrt(fwd[0] * fwd[0] + fwd[1] * fwd[1] + fwd[2] * fwd[2])
        if (fl < 1e-10) {
          fwd[0] = 0
          fwd[1] = 1
          fwd[2] = 0
          fl = 1
        }
        fwd[0] /= fl
        fwd[1] /= fl
        fwd[2] /= fl

        // Right = fwd x up.
        rt[0] = fwd[1] * uz - fwd[2] * uy
        rt[1] = fwd[2] * ux - fwd[0] * uz
        rt[2] = fwd[0] * uy - fwd[1] * ux

        let rl = Math.sqrt(rt[0] * rt[0] + rt[1] * rt[1] + rt[2] * rt[2])
        if (rl < 1e-10) {
          // Fwd ≈ up; pick an arbitrary perpendicular.
          if (Math.abs(fwd[1]) < 0.9) {
            rt[0] = -fwd[2]
            rt[1] = 0
            rt[2] = fwd[0]
          }
          else {
            rt[0] = 1
            rt[1] = 0
            rt[2] = 0
          }
          rl = Math.sqrt(rt[0] * rt[0] + rt[1] * rt[1] + rt[2] * rt[2])
        }
        rt[0] /= rl
        rt[1] /= rl
        rt[2] /= rl

        // Up = right x fwd (re-orthogonalised).
        up[0] = rt[1] * fwd[2] - rt[2] * fwd[1]
        up[1] = rt[2] * fwd[0] - rt[0] * fwd[2]
        up[2] = rt[0] * fwd[1] - rt[1] * fwd[0]

        ring.length = 0
        for (let r = 0; r < radialSegments; r++) {
          const a  = 2 * Math.PI * r / radialSegments
          const ca = Math.cos(a)
          const sa = Math.sin(a)
          ring.push([
            px + radius * (rt[0] * ca + up[0] * sa),
            py + radius * (rt[1] * ca + up[1] * sa),
            pz + radius * (rt[2] * ca + up[2] * sa),
          ])
        }

        // Emit vertices for this ring.
        for (const pt of ring) {
          // Normal points outward from the tube axis.
          const nx_ = (pt[0] - px) / radius
          const ny_ = (pt[1] - py) / radius
          const nz_ = (pt[2] - pz) / radius
          pushVert(pt[0], pt[1], pt[2], nx_, ny_, nz_, 0, 0, 0, 0, 0, 0)
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
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  for (let i = 0; i < verts.length; i += VERTEX_FLOATS) {
    if (verts[i] < minX)
      minX = verts[i]
    if (verts[i + 1] < minY)
      minY = verts[i + 1]
    if (verts[i + 2] < minZ)
      minZ = verts[i + 2]
  }

  const cellOf = (x: number, y: number, z: number): string =>
    `${Math.floor((x - minX) / cellSize)},` +
    `${Math.floor((y - minY) / cellSize)},` +
    `${Math.floor((z - minZ) / cellSize)}`

  // Bucket triangles by cell index → { centroid, count, seed }.
  const shards = new Map<string, { cx: number; cy: number; cz: number; n: number; seed: number }>()

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3] * VERTEX_FLOATS
    const i1 = idx[t * 3 + 1] * VERTEX_FLOATS
    const i2 = idx[t * 3 + 2] * VERTEX_FLOATS

    // Triangle centroid.
    const tcx = (verts[i0] + verts[i1] + verts[i2]) / 3
    const tcy = (verts[i0 + 1] + verts[i1 + 1] + verts[i2 + 1]) / 3
    const tcz = (verts[i0 + 2] + verts[i1 + 2] + verts[i2 + 2]) / 3

    const key = cellOf(tcx, tcy, tcz)

    let shard = shards.get(key)
    if (!shard) {
      shard = { cx: 0, cy: 0, cz: 0, n: 0, seed: rand() }
      shards.set(key, shard)
    }
    shard.cx += tcx
    shard.cy += tcy
    shard.cz += tcz
    shard.n  += 1
  }

  // Compute shard centroids.
  for (const shard of shards.values()) {
    shard.cx /= shard.n
    shard.cy /= shard.n
    shard.cz /= shard.n
  }

  // Write shard attributes into every vertex.
  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3] * VERTEX_FLOATS
    const i1 = idx[t * 3 + 1] * VERTEX_FLOATS
    const i2 = idx[t * 3 + 2] * VERTEX_FLOATS

    const tcx = (verts[i0] + verts[i1] + verts[i2]) / 3
    const tcy = (verts[i0 + 1] + verts[i1 + 1] + verts[i2 + 1]) / 3
    const tcz = (verts[i0 + 2] + verts[i1 + 2] + verts[i2 + 2]) / 3

    const key   = cellOf(tcx, tcy, tcz)
    const shard = shards.get(key)!

    for (const vi of [ i0, i1, i2 ]) {
      verts[vi + 8]  = shard.cx
      verts[vi + 9]  = shard.cy
      verts[vi + 10] = shard.cz
      verts[vi + 11] = shard.seed
    }
  }
}


export interface Mesh {
  readonly indexCount: number;

  /** Bind the VAO and issue drawElements. */
  draw(gl: WebGL2RenderingContext): void;

  /** Bind the VAO and issue drawElementsInstanced. */
  drawInstanced(gl: WebGL2RenderingContext, count: number): void;

  /** Upload/replace the per-instance buffer: 8 floats per instance (xform vec4 + params vec4). */
  setInstances(gl: WebGL2RenderingContext, data: Float32Array): void;
  dispose(gl: WebGL2RenderingContext): void;
}


/**
 * Attribute locations are fixed by layout(location=N) in the shader:
 *   0 aPos vec3, 1 aNormal vec3, 2 aUv vec2, 3 aShard vec4,
 *   4 iXform vec4 (divisor 1), 5 iParams vec4 (divisor 1)
 */
export function createMesh (
  gl: WebGL2RenderingContext, builder: MeshBuilder,
): Mesh {
  const vao   = gl.createVertexArray()!
  const vbo   = gl.createBuffer()!
  const ibo   = gl.createBuffer()!
  const vData = builder.vertices()
  const iData = builder.indices()

  gl.bindVertexArray(vao)

  // Interleaved VBO: position(3) normal(3) uv(2) shard(4) = 12 floats × 4 = 48 bytes.
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, vData, gl.STATIC_DRAW)

  const STRIDE = VERTEX_FLOATS * 4

  // layout(location = 0) aPos vec3
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0)

  // layout(location = 1) aNormal vec3
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12)

  // layout(location = 2) aUv vec2
  gl.enableVertexAttribArray(2)
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 24)

  // layout(location = 3) aShard vec4
  gl.enableVertexAttribArray(3)
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STRIDE, 32)

  // Uint32 IBO — WebGL2 supports 32-bit indices natively, no extension needed.
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iData, gl.STATIC_DRAW)

  gl.bindVertexArray(null)

  // Lazily-created instance VBO with two vec4 attributes (divisor 1 each).
  let instanceVBO: WebGLBuffer | null = null
  let instanceCap                     = 0

  return {
    get indexCount () {
      return iData.length
    },

    draw (gl) {
      gl.bindVertexArray(vao)
      gl.drawElements(gl.TRIANGLES, iData.length, gl.UNSIGNED_INT, 0)
      gl.bindVertexArray(null)
    },

    drawInstanced (gl, count) {
      gl.bindVertexArray(vao)
      gl.drawElementsInstanced(gl.TRIANGLES, iData.length, gl.UNSIGNED_INT, 0, count)
      gl.bindVertexArray(null)
    },

    /**
     * Upload per-instance data: 8 floats per instance (xform vec4 + params vec4).
     * Uses bufferSubData when the new data fits inside the current allocation
     * to avoid reallocation; only calls bufferData when the payload has grown.
     * This keeps the driver from thrashing when the instance list grows
     * incrementally (e.g. a train gaining cars each lap).
     */
    setInstances (gl, data) {
      if (!instanceVBO) {
        instanceVBO = gl.createBuffer()!
        instanceCap = data.length
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceVBO)
        gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW)

        gl.bindVertexArray(vao)

        // layout(location = 4) iXform vec4
        gl.enableVertexAttribArray(4)
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0)
        gl.vertexAttribDivisor(4, 1)

        // layout(location = 5) iParams vec4
        gl.enableVertexAttribArray(5)
        gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16)
        gl.vertexAttribDivisor(5, 1)

        gl.bindVertexArray(null)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, instanceVBO)
      if (data.length > instanceCap) {
        instanceCap = data.length
        gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW)
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
    },

    dispose (gl) {
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(vbo)
      gl.deleteBuffer(ibo)
      if (instanceVBO)
        gl.deleteBuffer(instanceVBO)
    },
  }
}
