// Colour: tone mapping and the small helpers every grade needs.

/** Krzysztof Narkowicz's ACES filmic fit. */
export const ACES = /* glsl */`
vec3 aces (vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`

export const SATURATE = /* glsl */`
float saturate (float x) {
  return clamp(x, 0.0, 1.0);
}
`
