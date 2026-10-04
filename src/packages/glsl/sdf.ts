// Signed distance primitives and operators (iq's formulations), shared by the
// raymarched journeys.

export const SD_SPHERE = /* glsl */`
float sdSphere (vec3 p, float r) {
  return length(p) - r;
}
`

export const SD_BOX = /* glsl */`
float sdBox (vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
`

export const SD_BOX2 = /* glsl */`
float sdBox2 (vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
`

/** Needs SD_BOX. */
export const SD_ROUND_BOX = /* glsl */`
float sdRoundBox (vec3 p, vec3 b, float r) {
  return sdBox(p, b - r) - r;
}
`

/** Polynomial smooth minimum. */
export const SMIN = /* glsl */`
float smin (float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
`

/** Needs SMIN. */
export const SMAX = /* glsl */`
float smax (float a, float b, float k) {
  return -smin(-a, -b, k);
}
`

/** 2D rotation by `a` radians. */
export const ROT = /* glsl */`
mat2 rot (float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
`
