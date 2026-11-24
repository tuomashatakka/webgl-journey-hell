// The index uses WebGL 1 with no journey state. The same print as the ride:
// down the throat of the flume, the water running ahead, and either side of
// the lips a sea that fades into the haze with no line where it stops.
export const stillwaterPreview = /* glsl */`
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution) / iResolution.y;
    float sway = sin(iTime * 0.4) * 0.12;
    uv.x += sway * (0.4 - uv.y);
    vec3 haze = mix(vec3(0.64, 0.6, 0.62), vec3(0.42, 0.46, 0.55), smoothstep(-0.05, 0.9, uv.y));
    haze += vec3(0.25, 0.16, 0.08) * exp(-length(uv - vec2(0.15, 0.05)) * 3.0);
    vec3 c = haze;

    // The sea under the haze: darker toward the viewer, gone at the horizon.
    if (uv.y < 0.0) {
      float d = 0.35 / max(-uv.y, 0.001);
      float swell = sin(uv.x * d * 2.0 + d * 0.8 - iTime * 1.3) * 0.5 + 0.5;
      vec3 sea = mix(vec3(0.05, 0.11, 0.13), vec3(0.2, 0.27, 0.3), swell * 0.4);
      c = mix(sea, haze, smoothstep(2.0, 18.0, d));
    }

    // The trough: a U opening up toward the camera.
    float r = length(vec2(uv.x * 0.9, uv.y + 0.95));
    float ang = atan(uv.x * 0.9, -(uv.y + 0.95));
    if (r < 0.95 && abs(ang) < 1.62 && uv.y < -0.02) {
      float z = 0.9 / max(0.95 - r, 0.02);
      float joint = smoothstep(0.46, 0.5, abs(fract(z * 0.4 - iTime * 1.1) - 0.5));
      vec3 shell = mix(vec3(0.28, 0.56, 0.62), vec3(0.62, 0.8, 0.82), 0.5 + 0.5 * cos(ang * 1.4));
      shell *= 1.0 - joint * 0.35;
      float water = smoothstep(0.35, 0.18, abs(ang)) * (0.6 + 0.4 * sin(z * 3.0 - iTime * 6.0 + ang * 9.0));
      shell = mix(shell, vec3(0.75, 0.88, 0.9), water * 0.35);
      c = mix(shell, haze, smoothstep(6.0, 40.0, z));
    }
    c *= 1.0 - 0.18 * dot(uv, uv);
    gl_FragColor = vec4(pow(c, vec3(0.95)), 1.0);
  }
`
