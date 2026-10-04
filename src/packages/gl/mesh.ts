// The drawable half of the mesh pipeline: a VAO, an interleaved VBO and a Uint32
// IBO built from what geometry/meshBuilder produced.
//
// createMesh builds a VAO, an interleaved VBO, and a Uint32 IBO. WebGL2
// supports 32-bit indices natively — no OES_element_index_uint extension
// needed, unlike WebGL1 — which lets us draw meshes with more than 65 k
// vertices without splitting. The instance VBO is created lazily on the first
// call to setInstances and uses bufferSubData when the new payload fits
// inside the current allocation, only calling bufferData to reallocate when
// the data has grown. This avoids thrashing the driver on every frame when
// the instance list grows incrementally (e.g. a train gaining cars each lap).


import { STANDARD_LAYOUT, VERTEX_FLOATS } from '@wjh/geometry/meshBuilder'
import type { AttribSpec, MeshBuilder } from '@wjh/geometry/meshBuilder'


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
 *
 * `instanceVec4s` is how many consecutive vec4 instance attributes to bind from
 * location 4 up; the default two is the (xform, params) pair every loop-line
 * prop uses. A prop that also has to carry the road frame it sits on asks for
 * four, and then `setInstances` expects 16 floats per instance.
 */
export function createMesh (
  gl: WebGL2RenderingContext, builder: MeshBuilder, instanceVec4s = 2,
): Mesh {
  return createMeshFromArrays(
    gl, builder.vertices(), builder.indices(), STANDARD_LAYOUT, VERTEX_FLOATS, instanceVec4s,
  )
}

/**
 * The same drawable over a caller-owned vertex format. A swept road wants its
 * spine position, the level frame, and its profile offsets per vertex so the
 * vertex shader can roll it live; that does not fit position/normal/uv/shard,
 * so it packs its own floats and describes them here.
 */
export function createMeshFromArrays (
  gl: WebGL2RenderingContext,
  vData: Float32Array,
  iData: Uint32Array,
  layout: AttribSpec[],
  vertexFloats: number,
  instanceVec4s = 2,
): Mesh {
  const vao = gl.createVertexArray()!
  const vbo = gl.createBuffer()!
  const ibo = gl.createBuffer()!

  gl.bindVertexArray(vao)

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, vData, gl.STATIC_DRAW)

  const STRIDE = vertexFloats * 4
  for (const a of layout) {
    gl.enableVertexAttribArray(a.location)
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, STRIDE, a.offset * 4)
  }

  // Uint32 IBO — WebGL2 supports 32-bit indices natively, no extension needed.
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iData, gl.STATIC_DRAW)

  gl.bindVertexArray(null)

  // Lazily-created instance VBO with `instanceVec4s` vec4 attributes (divisor 1 each).
  const instanceStride                = instanceVec4s * 16
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

        // layout(location = 4) iXform vec4, 5 iParams vec4, then any extra.
        for (let i = 0; i < instanceVec4s; i++) {
          gl.enableVertexAttribArray(4 + i)
          gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, instanceStride, i * 16)
          gl.vertexAttribDivisor(4 + i, 1)
        }

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
