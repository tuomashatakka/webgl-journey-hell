// Compile, link, and a cached-uniform wrapper around the result.
//
// The one copy of this in the repo. There used to be four (shaderQuad,
// glProgram, crtPass, and liminal's page), each logging under its own prefix
// and each diagnosing a null info log differently.
//
// Uniform and attribute locations are resolved lazily and cached — negative
// misses included, so a shader that ignores a uniform costs one failed lookup
// rather than one per frame. A name that misses falls back to `name[0]`, the
// GLSL convention for array uniforms.

import type { AnyGl } from './context'
import type { CustomUniforms, FrameUniforms } from './uniforms'
import { uploadCustomUniforms } from './uniforms'


/**
 * Compile one stage. A failed compile with a null or empty info log almost
 * always means the context was lost (a reused canvas whose context had been
 * released), not a source error, and it is reported as such.
 */
export function compileShader (gl: AnyGl, type: number, source: string, tag = 'gl'): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader)
    return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log    = gl.getShaderInfoLog(shader)
    const reason = gl.isContextLost()
      ? 'context lost — cannot compile'
      : log || 'no info log (context likely lost or unavailable)'
    console.error(`[${tag}] compile error:`, reason)
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export interface LinkedProgram {
  program: WebGLProgram;
  vs:      WebGLShader;
  fs:      WebGLShader;
}

/**
 * Compile both stages and link them. `position` is bound to attribute 0 before
 * the link, so a GLSL ES 1.00 full-screen pass and a 3.00 one with
 * `layout(location = 0)` can share one quad and one vertex array.
 */
export function linkProgram (gl: AnyGl, vertexSource: string, fragmentSource: string, tag = 'gl'): LinkedProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, tag)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, tag)
  if (!vs || !fs) {
    if (vs)
      gl.deleteShader(vs)
    if (fs)
      gl.deleteShader(fs)
    return null
  }

  const program = gl.createProgram()
  if (!program)
    return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'position')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[${tag}] link error:`, gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  return { program, vs, fs }
}

export interface GlProgram {
  program: WebGLProgram;
  use(): void;

  /** Cached uniform location; null (and cached as such) when absent or optimised out. */
  loc(name: string): WebGLUniformLocation | null;
  uniform1f(name: string, x: number): void;
  uniform1i(name: string, x: number): void;
  uniform2f(name: string, x: number, y: number): void;
  uniform3f(name: string, x: number, y: number, z: number): void;
  uniform4f(name: string, x: number, y: number, z: number, w: number): void;
  uniform1fv(name: string, v: Float32Array): void;
  uniform4fv(name: string, v: Float32Array): void;
  uniformMatrix4fv(name: string, v: Float32Array): void;
  uniformMatrix3fv(name: string, v: Float32Array): void;

  /** Upload a whole uniform map; see CustomUniforms for the size dispatch. */
  uniforms(custom: CustomUniforms | undefined): void;

  /**
   * The frame inputs every full-screen journey shader reads: iResolution,
   * iTime, uPointer, uHeavy, then the custom map. `heavyDefault` is what an
   * unset `heavy` means — the shader quad has always read it as off, the
   * WebGL 2 renderers as on.
   */
  frame(frame: FrameUniforms, width: number, height: number, heavyDefault?: number): void;

  /** Cached getAttribLocation. */
  attrib(name: string): number;
  dispose(): void;
}

export function createGlProgram (
  gl: AnyGl,
  vertexSource: string,
  fragmentSource: string,
  tag = 'glProgram',
): GlProgram | null {
  const linked = linkProgram(gl, vertexSource, fragmentSource, tag)
  if (!linked)
    return null

  const { program, vs, fs } = linked

  const uniformLocs = new Map<string, WebGLUniformLocation | null>()
  const attribLocs  = new Map<string, number>()
  const scratch     = new Map<number, Float32Array>()

  const loc = (name: string): WebGLUniformLocation | null => {
    if (uniformLocs.has(name))
      return uniformLocs.get(name) ?? null

    const l = gl.getUniformLocation(program, name) ?? gl.getUniformLocation(program, `${name}[0]`)
    uniformLocs.set(name, l)
    return l
  }

  const self: GlProgram = {
    program,
    use: () => gl.useProgram(program),
    loc,
    uniform1f (name, x) {
      const l = loc(name)
      if (l)
        gl.uniform1f(l, x)
    },
    uniform1i (name, x) {
      const l = loc(name)
      if (l)
        gl.uniform1i(l, x)
    },
    uniform2f (name, x, y) {
      const l = loc(name)
      if (l)
        gl.uniform2f(l, x, y)
    },
    uniform3f (name, x, y, z) {
      const l = loc(name)
      if (l)
        gl.uniform3f(l, x, y, z)
    },
    uniform4f (name, x, y, z, w) {
      const l = loc(name)
      if (l)
        gl.uniform4f(l, x, y, z, w)
    },
    uniform1fv (name, v) {
      const l = loc(name)
      if (l)
        gl.uniform1fv(l, v)
    },
    uniform4fv (name, v) {
      const l = loc(name)
      if (l)
        gl.uniform4fv(l, v)
    },
    uniformMatrix4fv (name, v) {
      const l = loc(name)
      if (l)
        gl.uniformMatrix4fv(l, false, v)
    },
    uniformMatrix3fv (name, v) {
      const l = loc(name)
      if (l)
        gl.uniformMatrix3fv(l, false, v)
    },
    uniforms (custom) {
      uploadCustomUniforms(gl, loc, custom, scratch)
    },
    frame (f, width, height, heavyDefault = 0) {
      self.uniform2f('iResolution', width, height)
      self.uniform1f('iTime', f.time)
      self.uniform2f('uPointer', f.pointer?.x ?? 0, f.pointer?.y ?? 0)
      self.uniform1f('uHeavy', f.heavy ?? heavyDefault)
      uploadCustomUniforms(gl, loc, f.custom, scratch)
    },
    attrib (name) {
      let a = attribLocs.get(name)
      if (a === undefined) {
        a = gl.getAttribLocation(program, name)
        attribLocs.set(name, a)
      }
      return a
    },
    dispose () {
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
  return self
}
