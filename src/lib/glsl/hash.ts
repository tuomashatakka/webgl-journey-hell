// Hashes. Each is a named function, version-agnostic (GLSL ES 1.00 and 3.00),
// written once; journeys interpolate the ones they use into their sources.
//
// The names say what goes in and what comes out (hash12: vec2 in, one float
// out). The two vec2 → float hashes below are *different functions* and both
// stay: swapping one for the other would move every window, crack and star
// that is placed by them.

/** Dave Hoskins' float → float. */
export const HASH11 = /* glsl */`
float hash11 (float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`

/** Dave Hoskins' vec2 → float. */
export const HASH12 = /* glsl */`
float hash12 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

/** The cheap vec2 → float the raymarched journeys share. */
export const HASH21 = /* glsl */`
float hash21 (vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
`

/** The classic sine hash, as the previews and the scenic route use it. */
export const HASH_SIN = /* glsl */`
float hash (vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`
