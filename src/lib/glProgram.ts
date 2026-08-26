// lightweight webgl2 program wrapper with lazy uniform/attribute caching.
//
// this is the webgl2 counterpart of shaderQuad (which is webgl1-flavoured).
// it wraps a compiled+linked program and provides convenience setters for
// every common uniform type, plus a cached attrib locator. all locations
// are resolved lazily on first use and cached — including negative misses,
// so a shader that ignores a uniform costs one failed lookup rather than one
// per frame.
//
// the pattern mirrors shaderQuad's `customLoc` closure: a Map keyed by
// GLSL name that falls back to looking up `name[0]` when `name` itself
// misses (the glsl es 3.00 convention for array uniforms).
//
// compile and link errors are logged with a `[glProgram]` prefix. a null
// or empty info log on a failed compile almost always means the gl context
// was lost or exhausted (e.g. a reused canvas whose context was previously
// released) rather than a genuine source error — the same diagnosis that
// shaderQuad applies.


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
  attrib(name: string): number; // cached getAttribLocation
  dispose(): void;
}


function compileShader (
  gl:     WebGL2RenderingContext,
  type:   number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader)
    return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // a null/empty info log on a failed compile almost always means the gl
    // context was lost or exhausted (e.g. a reused canvas whose context was
    // previously released) rather than a genuine source error.
    const log    = gl.getShaderInfoLog(shader)
    const reason = gl.isContextLost()
      ? 'context lost — cannot compile'
      : log || 'no info log (context likely lost or unavailable)'
    console.error('[glProgram] compile error:', reason)
    gl.deleteShader(shader)
    return null
  }
  return shader
}


export function createGlProgram (
  gl:             WebGL2RenderingContext,
  vertexSource:   string,
  fragmentSource: string,
): GlProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vs || !fs)
    return null

  const program = gl.createProgram()
  if (!program)
    return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[glProgram] link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  const uniformLocs = new Map<string, WebGLUniformLocation | null>()
  const attribLocs  = new Map<string, number>()

  const resolveLoc = (name: string): WebGLUniformLocation | null => {
    if (uniformLocs.has(name))
      return uniformLocs.get(name) ?? null

    // glsl es 3.00 arrays are addressed through their first element.
    const loc = gl.getUniformLocation(program, name) ??
      gl.getUniformLocation(program, `${name}[0]`)
    uniformLocs.set(name, loc)
    return loc
  }

  return {
    program,

    use () {
      gl.useProgram(program)
    },

    loc (name: string): WebGLUniformLocation | null {
      return resolveLoc(name)
    },

    uniform1f (name: string, x: number) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform1f(loc, x)
    },

    uniform1i (name: string, x: number) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform1i(loc, x)
    },

    uniform2f (name: string, x: number, y: number) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform2f(loc, x, y)
    },

    uniform3f (name: string, x: number, y: number, z: number) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform3f(loc, x, y, z)
    },

    uniform4f (name: string, x: number, y: number, z: number, w: number) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform4f(loc, x, y, z, w)
    },

    uniform1fv (name: string, v: Float32Array) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform1fv(loc, v)
    },

    uniform4fv (name: string, v: Float32Array) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniform4fv(loc, v)
    },

    uniformMatrix4fv (name: string, v: Float32Array) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniformMatrix4fv(loc, false, v)
    },

    uniformMatrix3fv (name: string, v: Float32Array) {
      const loc = resolveLoc(name)
      if (loc)
        gl.uniformMatrix3fv(loc, false, v)
    },

    attrib (name: string): number {
      if (attribLocs.has(name))
        return attribLocs.get(name)!

      const loc = gl.getAttribLocation(program, name)
      attribLocs.set(name, loc)
      return loc
    },

    dispose () {
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
}
