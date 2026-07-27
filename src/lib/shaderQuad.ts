// Reusable full-screen-quad fragment-shader runner for raw WebGL 1.0.
//
// Shared by the landing-page hover previews (one program per journey, all in a
// single GL context) and by lightweight standalone journey routes. Keeps the
// quad/compile/uniform boilerplate that used to live inline in LiminalJourney
// in one place. Fragment shaders are driven by these optional uniforms:
//   uniform vec2      iResolution;  // canvas pixel size
//   uniform float     iTime;        // seconds
//   uniform vec2      uPointer;     // normalized pointer, -1..1 (y up)
//   uniform float     uHeavy;       // 1.0 when heavyEffects is on, else 0.0
//   uniform sampler2D uEnv;         // optional equirect environment map (unit 0)
//   uniform float     uEnvLoaded;   // 1.0 once uEnv's image has uploaded
//
// The env map is opt-in (createShaderQuad's `envUrl`); shaders that don't sample
// uEnv simply ignore it. It loads asynchronously — uEnvLoaded gates use so the
// first frames before the image arrives fall back to a procedural environment.

import { assetUrl } from './assetUrl'

const QUAD_VS = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const QUAD_VERTS = new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ])

/**
 * Extra per-frame uniforms, keyed by GLSL name. The value's length picks the
 * setter, so the same map covers scalars, vectors and vec4 arrays:
 *   number            -> uniform1f
 *   number[] len 2..4 -> uniform2f / uniform3f / uniform4f
 *   number[] len > 4  -> uniform4fv (length must be a multiple of 4)
 * Locations are resolved once and cached; unknown names are silently ignored,
 * so a shader may consume any subset.
 */
export type CustomUniforms = Record<string, number | number[]>

export interface QuadFrameUniforms {
  time:     number;
  pointer?: { x: number; y: number };

  /** 1.0 enables heavyEffects-gated branches (dispersion, frost blur); 0.0 keeps them cheap. */
  heavy?: number;

  /** Simulation-driven uniforms; see CustomUniforms for the size dispatch. */
  custom?: CustomUniforms;
}

export interface ShaderQuadOptions {

  /** Optional equirectangular environment map URL, bound to sampler `uEnv` on texture unit 0. */
  envUrl?: string;
}

export interface ShaderQuad {

  /** Render one frame at the canvas's current pixel size. */
  draw(uniforms: QuadFrameUniforms): void;

  /** Release GL resources (program, shaders, buffer). */
  dispose(): void;
}

function compileShader (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader)
    return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // A null/empty info log on a failed compile almost always means the GL
    // context was lost or exhausted (e.g. a reused canvas whose context was
    // previously released) rather than a genuine source error.
    const log    = gl.getShaderInfoLog(shader)
    const reason = gl.isContextLost()
      ? 'context lost — cannot compile'
      : log || 'no info log (context likely lost or unavailable)'
    console.error('[shaderQuad] compile error:', reason)
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Build a renderable full-screen quad from a fragment shader. Returns null if
 * compilation/linking fails (callers should fall back to a static poster).
 * Multiple quads can share one WebGLRenderingContext — each owns its own
 * program + tiny vertex buffer, so switching previews is just a useProgram.
 */
export function createShaderQuad (
  gl: WebGLRenderingContext,
  fragmentSource: string,
  options: ShaderQuadOptions = {},
): ShaderQuad | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, QUAD_VS)
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
    console.error('[shaderQuad] link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW)

  const posLoc       = gl.getAttribLocation(program, 'position')
  const resLoc       = gl.getUniformLocation(program, 'iResolution')
  const timeLoc      = gl.getUniformLocation(program, 'iTime')
  const pointerLoc   = gl.getUniformLocation(program, 'uPointer')
  const heavyLoc     = gl.getUniformLocation(program, 'uHeavy')
  const envLoc       = gl.getUniformLocation(program, 'uEnv')
  const envLoadedLoc = gl.getUniformLocation(program, 'uEnvLoaded')

  // Optional equirect environment map. Starts as a 1x1 mid-grey placeholder so
  // the sampler is always valid; the real image uploads asynchronously and flips
  // uEnvLoaded to 1.0. The 1024x512 map is power-of-two, so REPEAT wrap (for
  // longitude seamlessness) + mipmaps (for cheap roughness blur via LOD bias) work.
  let envTex: WebGLTexture | null = null
  let envLoaded                   = 0
  if (options.envUrl) {
    envTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, envTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                  new Uint8Array([ 40, 44, 52 ]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const img       = new Image()
    img.crossOrigin = 'anonymous'
    img.onload      = () => {
      if (gl.isContextLost())
        return
      gl.bindTexture(gl.TEXTURE_2D, envTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      envLoaded = 1
    }
    // Raw <img> loads bypass Next's basePath rewriting, so resolve the public
    // path explicitly — otherwise every env map 404s under a sub-path deploy.
    const envSrc = assetUrl(options.envUrl)
    img.onerror = () => console.error('[shaderQuad] env map failed to load:', envSrc)
    img.src     = envSrc
  }

  // Lazily-resolved locations for simulation uniforms. `null` is a cached miss
  // (name absent or optimised out), so a shader that ignores the simulation
  // costs one failed lookup rather than one per frame.
  const customLocs = new Map<string, WebGLUniformLocation | null>()
  const customLoc  = (name: string): WebGLUniformLocation | null => {
    if (customLocs.has(name))
      return customLocs.get(name) ?? null

    // GLSL ES 1.00 arrays are addressed through their first element.
    const loc = gl.getUniformLocation(program, name) ??
      gl.getUniformLocation(program, `${name}[0]`)
    customLocs.set(name, loc)
    return loc
  }

  // Reused upload buffers, one per array length — no per-frame allocation.
  const arrayBuffers = new Map<number, Float32Array>()
  const arrayBuffer  = (length: number): Float32Array => {
    let buf = arrayBuffers.get(length)
    if (!buf) {
      buf = new Float32Array(length)
      arrayBuffers.set(length, buf)
    }
    return buf
  }

  return {
    draw ({ time, pointer, heavy, custom }: QuadFrameUniforms) {
      const canvas = gl.canvas as HTMLCanvasElement
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      if (resLoc)
        gl.uniform2f(resLoc, canvas.width, canvas.height)
      if (timeLoc)
        gl.uniform1f(timeLoc, time)
      if (pointerLoc)
        gl.uniform2f(pointerLoc, pointer?.x ?? 0, pointer?.y ?? 0)
      if (heavyLoc)
        gl.uniform1f(heavyLoc, heavy ?? 0)
      if (envTex && envLoc) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, envTex)
        gl.uniform1i(envLoc, 0)
      }
      if (envLoadedLoc)
        gl.uniform1f(envLoadedLoc, envLoaded)

      if (custom)
        for (const name in custom) {
          const loc = customLoc(name)
          if (!loc)
            continue

          const value = custom[name]
          if (typeof value === 'number')
            gl.uniform1f(loc, value); else if (value.length === 2)
            gl.uniform2f(loc, value[0], value[1]); else if (value.length === 3)
            gl.uniform3f(loc, value[0], value[1], value[2]); else if (value.length === 4)
            gl.uniform4f(loc, value[0], value[1], value[2], value[3]); else {
            const buf = arrayBuffer(value.length)
            buf.set(value)
            gl.uniform4fv(loc, buf)
          }
        }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    dispose () {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (envTex)
        gl.deleteTexture(envTex)
    },
  }
}
