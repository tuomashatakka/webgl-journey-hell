// The full-screen quad every pass in the repo draws.
//
// Four vertices as a triangle strip, on attribute 0 (lib/gl/program binds
// `position` there before linking). On WebGL 2 the attribute state lives in its
// own vertex array, so drawing a quad can never disturb the vertex array a
// rasterizer left bound — the bug class that "only breaks on one driver".

import type { AnyGl } from './context'
import { isWebGL2 } from './context'


const QUAD_VERTICES = new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ])

/** GLSL ES 1.00 pass-through for a full-screen fragment shader. */
export const QUAD_VS_100 = `
attribute vec2 position;
void main () {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

/** The same, GLSL ES 3.00. */
export const QUAD_VS_300 = `#version 300 es
layout(location = 0) in vec2 position;
void main () {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

/** GLSL ES 1.00 pass-through with a 0..1 uv varying, for post passes. */
export const QUAD_UV_VS_100 = `
attribute vec2 position;
varying vec2 vUv;
void main () {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export interface FullscreenQuad {

  /** Draw the quad with whatever program is in use. */
  draw(): void;
  dispose(): void;
}

export function createFullscreenQuad (gl: AnyGl): FullscreenQuad {
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW)

  if (isWebGL2(gl)) {
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    return {
      draw () {
        gl.bindVertexArray(vao)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        gl.bindVertexArray(null)
      },
      dispose () {
        gl.deleteVertexArray(vao)
        gl.deleteBuffer(buffer)
      },
    }
  }

  return {
    draw () {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      // Hand the attribute back; a stale enabled pointer into this buffer is
      // harmless until some other draw forgets to set its own.
      gl.disableVertexAttribArray(0)
    },
    dispose () {
      gl.deleteBuffer(buffer)
    },
  }
}
