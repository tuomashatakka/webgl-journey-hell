import { ACES } from '@wjh/glsl/color'
import { HASH_SIN } from '@wjh/glsl/hash'

// ---------------------------------------------------------------------------
// post chain
// ---------------------------------------------------------------------------

export const brightFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uThreshold;
out vec4 fragColor;
void main () {
  vec3 c = texture(uSrc, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(c * max(l - uThreshold, 0.0) / max(l, 1e-4), 1.0);
}
`

export const blurFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 fragColor;
void main () {
  float w[5];
  w[0] = 0.2270; w[1] = 0.1946; w[2] = 0.1216; w[3] = 0.0540; w[4] = 0.0162;
  vec3 sum = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i);
    sum += texture(uSrc, vUv + o).rgb * w[i];
    sum += texture(uSrc, vUv - o).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}
`

/**
 * Composite: bloom, exposure, the ACES fit (Narkowicz 2016), a speed blur that
 * only bites in the fall, a light vignette, sRGB. lib/gl/crtPass adds the tube and
 * the signal loss on top of whatever comes out of here.
 */
export const compositeFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;   // linear multiplier
uniform float uSpeedBlur;  // 0..1
uniform float uTime;
out vec4 fragColor;
${ACES}
void main () {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  vec3 col;
  if (uSpeedBlur > 0.001) {
    // Radial blur toward the centre: eight taps along the ray, weighted in.
    col = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      float t = float(i) / 7.0;
      float wgt = 1.0 - t * 0.6;
      col += texture(uScene, uv - c * t * uSpeedBlur * 0.35).rgb * wgt;
      total += wgt;
    }
    col /= total;
  }
  else
    col = texture(uScene, uv).rgb;

  col += texture(uBloom, uv).rgb * 0.55;
  col *= uExposure;
  col = aces(col);
  col *= 1.0 - smoothstep(0.45, 1.15, length(c * vec2(1.0, 1.1))) * 0.30;
  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------
// the hover preview (GLSL ES 1.00 — the index's WebGL1 CRT)
// ---------------------------------------------------------------------------

/**
 * Self-driving from iTime alone: a road running at the viewer under a low sun,
 * the horizon rolling like the helix, and the dashboard's arc at the bottom with
 * a needle climbing. No uniforms from the ride — the grid attaches none.
 */
export const scenicRoutePreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH_SIN}

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;

    // The world rolls: the helix, slowly.
    float roll = sin(iTime * 0.35) * 0.35;
    float cr = cos(roll), sr = sin(roll);
    vec2 w = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);

    // Sky: warm at the horizon, blue up.
    float horizon = 0.02;
    vec3 sky = mix(vec3(0.98, 0.62, 0.32), vec3(0.28, 0.42, 0.68), smoothstep(horizon, 0.6, w.y));
    float sun = smoothstep(0.08, 0.0, length(w - vec2(-0.32, 0.09)));
    sky += vec3(1.0, 0.85, 0.6) * sun * 0.9;

    // Ground with a road converging on the vanishing point.
    float depth = max(0.01, horizon - w.y);
    float persp = 0.06 / depth;
    float lane = abs(w.x) * persp;
    vec3 grass = vec3(0.16, 0.22, 0.09) * (0.7 + 0.3 * hash(floor(vec2(w.x * persp * 6.0, persp * 2.0 + iTime * 6.0))));
    vec3 road = vec3(0.09, 0.09, 0.10);
    float onRoad = smoothstep(0.36, 0.30, lane);
    float dash = step(0.5, fract(persp * 0.8 + iTime * 4.0)) * smoothstep(0.03, 0.0, lane);
    road += dash * 0.5;
    vec3 ground = mix(grass, road, onRoad);
    ground *= smoothstep(0.0, 0.12, depth) * 0.9 + 0.1;
    vec3 col = mix(ground, sky, step(horizon, w.y));
    col = mix(col, sky, smoothstep(0.0, 0.25, depth) * (1.0 - step(horizon, w.y)) * 0.55);

    // Dashboard: a dark hood and a dial with a needle.
    float hood = smoothstep(-0.34, -0.36, uv.y + uv.x * uv.x * 0.35);
    col = mix(col, vec3(0.02, 0.02, 0.025), hood);
    vec2 dc = uv - vec2(0.0, -0.52);
    float dial = smoothstep(0.17, 0.165, length(dc)) * hood;
    col = mix(col, vec3(0.05, 0.045, 0.04), dial);
    float ang = -2.4 + 3.6 * (0.55 + 0.45 * sin(iTime * 0.6));
    vec2 nd = vec2(cos(ang), sin(ang));
    float needle = smoothstep(0.006, 0.0, abs(dot(dc, vec2(-nd.y, nd.x)))) * step(0.0, dot(dc, nd)) * step(dot(dc, nd), 0.14) * hood;
    col = mix(col, vec3(1.0, 0.45, 0.15), needle);
    float ring = smoothstep(0.012, 0.0, abs(length(dc) - 0.15)) * hood;
    col += vec3(1.0, 0.66, 0.3) * ring * 0.35;

    col *= smoothstep(1.1, 0.35, length(uv));
    col -= sin(gl_FragCoord.y * 1.5 + iTime * 10.0) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
