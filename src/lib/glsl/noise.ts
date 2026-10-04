// Noise built on the hashes in ./hash — generators rather than constants,
// because the journeys share the *shape* of their noise but not its hash or
// its octave walk, and the walk is what gives each sky and each rock its grain.

/**
 * 2D value noise with a smoothstep fade, over `hash` (which must already be
 * defined — e.g. HASH21 or HASH12).
 */
export function valueNoise2 (hash: 'hash21' | 'hash12'): string {
  return /* glsl */`
float vnoise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(${hash}(i), ${hash}(i + vec2(1.0, 0.0)), f.x),
             mix(${hash}(i + vec2(0.0, 1.0)), ${hash}(i + vec2(1.0, 1.0)), f.x), f.y);
}
`
}

export interface FbmOptions {

  /** Octave count: a number, or the name of a #define. */
  octaves: number | string;

  /** The domain walk between octaves, as GLSL statements on `p`. */
  next: string;
}

/**
 * Fractal sum of `vnoise` (which must already be defined): amplitude halves
 * each octave from 0.5, the domain walks by `next`.
 */
export function fbm2 ({ octaves, next }: FbmOptions): string {
  return /* glsl */`
float fbm (vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < ${octaves}; i++) {
    s += a * vnoise(p);
    ${next}
    a *= 0.5;
  }
  return s;
}
`
}
