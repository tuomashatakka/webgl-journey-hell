// The index uses WebGL 1 with no journey state. Two planes sell the pool in
// the same print: above, the skylight ribs; below, their rippled reflection.
export const stillwaterPreview = /* glsl */`
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution) / iResolution.y;
    float y = uv.y + 0.18;
    float water = 1.0 - step(0.0, y);
    float d = 1.5 / (abs(y) + 0.14);
    float x = uv.x * d + 0.58 + water * (sin(d * 3.8 - iTime) * 0.027);
    float z = d + iTime * 0.32;
    float rib = smoothstep(0.35, 0.49, abs(fract(z * 0.81) - 0.5));
    float lane = smoothstep(0.43, 0.49, abs(fract(x * 0.47) - 0.5));
    float wall = smoothstep(2.3, 2.5, abs(x));
    vec3 c = mix(vec3(0.58, 0.71, 0.66), vec3(0.19, 0.34, 0.32), rib * 0.7 + wall * 0.3);
    vec3 w = mix(vec3(0.15, 0.54, 0.48), vec3(0.045, 0.19, 0.23), lane * 0.63 + wall * 0.31);
    w += rib * vec3(0.15, 0.22, 0.18);
    c = mix(c, w, water);
    c = mix(c, vec3(0.15, 0.31, 0.30), smoothstep(4.0, 13.0, d));
    c *= 1.0 - 0.14 * dot(uv, uv);
    gl_FragColor = vec4(c, 1.0);
  }
`
