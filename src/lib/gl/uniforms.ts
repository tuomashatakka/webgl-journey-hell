// The per-frame inputs every renderer receives, and the one place that knows
// how to upload an arbitrary uniform map.

/**
 * Extra per-frame uniforms, keyed by GLSL name. The value's length picks the
 * setter, so the same map covers scalars, vectors and vec4 arrays:
 *   number            -> uniform1f
 *   number[] len 2..4 -> uniform2f / uniform3f / uniform4f
 *   number[] len > 4  -> uniform4fv (length must be a multiple of 4)
 * Unknown names are ignored, so a shader may consume any subset.
 */
export type CustomUniforms = Record<string, number | number[]>

/**
 * How much a renderer may spend, decided by lib/quality. Renderers read what
 * they can use and ignore the rest: a raymarch keys its step budget off
 * `heavy`, a rasterizer its MSAA and bloom depth off `tier`.
 */
export interface QualityHints {

  /** 0 low (phones), 1 medium, 2 high. */
  tier: 0 | 1 | 2;

  /** MSAA samples a geometry journey should ask for (clamped to the device's). */
  msaa: number;

  /** Bloom mip levels a post chain should build. */
  bloomLevels: number;
}

/** The default when nothing has been measured: desktop behaviour. */
export const HIGH_QUALITY: QualityHints = { tier: 2, msaa: 4, bloomLevels: 5 }

export interface FrameUniforms {
  time:     number;
  pointer?: { x: number; y: number };

  /** 1.0 enables heavyEffects-gated branches (dispersion, deep marches); 0.0 keeps them cheap. */
  heavy?: number;

  /** Simulation-driven uniforms; see CustomUniforms for the size dispatch. */
  custom?: CustomUniforms;

  /** What the device can afford this frame. Absent means HIGH_QUALITY. */
  quality?: QualityHints;
}

/** Resolves a uniform location by name; null when the shader has none. */
export type UniformLocator = (name: string) => WebGLUniformLocation | null

/**
 * Upload a CustomUniforms map. `scratch` holds one reusable Float32Array per
 * array length, so a vec4[] uniform costs no allocation per frame.
 */
export function uploadCustomUniforms (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  locate: UniformLocator,
  custom: CustomUniforms | undefined,
  scratch: Map<number, Float32Array>,
): void {
  if (!custom)
    return
  for (const name in custom) {
    const loc = locate(name)
    if (!loc)
      continue

    const value = custom[name]
    if (typeof value === 'number')
      gl.uniform1f(loc, value)
    else if (value.length === 2)
      gl.uniform2f(loc, value[0], value[1])
    else if (value.length === 3)
      gl.uniform3f(loc, value[0], value[1], value[2])
    else if (value.length === 4)
      gl.uniform4f(loc, value[0], value[1], value[2], value[3])
    else {
      let buf = scratch.get(value.length)
      if (!buf) {
        buf = new Float32Array(value.length)
        scratch.set(value.length, buf)
      }
      buf.set(value)
      gl.uniform4fv(loc, buf)
    }
  }
}
