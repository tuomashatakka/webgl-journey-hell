// Scalar helpers shared by every simulation, renderer and audio graph.
//
// Each journey used to carry its own copy of these (six clamp01s, nine
// smoothsteps, eight smoothersteps), all the same function under different
// parameter names. They live here once now, written to match GLSL's built-ins
// exactly, so a curve computed on the CPU and the same curve in a shader agree.

/** Clamp `x` into [lo, hi]. */
export function clamp (x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Clamp into [0, 1] — GLSL's `saturate`. */
export function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * GLSL's `mix`. Written as `a·(1 − t) + b·t` rather than `a + (b − a)·t`: the
 * two differ in the last bit, and the kinematics tests pin values computed
 * this way.
 */
export function mix (a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

/** Hermite step from 0 at `edge0` to 1 at `edge1`, clamped — GLSL's `smoothstep`. */
export function smoothstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Ken Perlin's quintic step: zero first *and* second derivative at both ends. */
export function smootherstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** GLSL's `fract`: always in [0, 1), negative inputs included. */
export function fract (x: number): number {
  return x - Math.floor(x)
}

/** Linear remap of `x` from [a0, a1] onto [b0, b1], unclamped. */
export function remap (x: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + (b1 - b0) * (x - a0) / (a1 - a0)
}

/**
 * The classic shader hash, `fract(sin(n · 127.1) · 43758.5453)`. Fixed places
 * (rail joints, lamp rolls) are hashed on position with it, so the same
 * thing is in the same metre forever.
 */
export function hash1 (n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

/** Cubic ease-in-out over [0, 1]. */
export function easeInOutCubic (t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * Frame-rate independent exponential approach: move `current` toward `target`
 * as a first-order lag with time constant `tau` seconds.
 */
export function approach (current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}
