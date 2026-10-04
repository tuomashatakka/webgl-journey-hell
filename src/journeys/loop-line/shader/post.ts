import { ACES } from '@wjh/glsl/color'
import { HASH12 } from '@wjh/glsl/hash'
import { HEADER } from './header'

// --- post chain ---------------------------------------------------------------------

export const postVert = HEADER + /* glsl */`
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * First bloom level: a soft-knee bright pass with a 13-tap downsample (Jimenez,
 * "Next Generation Post Processing in Call of Duty: Advanced Warfare", 2014),
 * which is what stops a single hot pixel from blinking as the train moves.
 */
export const bloomDownFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;   // < 0 for plain downsample levels
uniform float uDecode;      // 1 when the source is the Reinhard-encoded LDR fallback
out vec4 fragColor;

vec3 fetch (vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

void main () {
  vec2 t = uTexel;
  vec3 a = fetch(vUv + t * vec2(-2.0, -2.0));
  vec3 b = fetch(vUv + t * vec2(0.0, -2.0));
  vec3 c = fetch(vUv + t * vec2(2.0, -2.0));
  vec3 d = fetch(vUv + t * vec2(-1.0, -1.0));
  vec3 e = fetch(vUv + t * vec2(1.0, -1.0));
  vec3 f = fetch(vUv + t * vec2(-2.0, 0.0));
  vec3 g = fetch(vUv);
  vec3 h = fetch(vUv + t * vec2(2.0, 0.0));
  vec3 i = fetch(vUv + t * vec2(-1.0, 1.0));
  vec3 j = fetch(vUv + t * vec2(1.0, 1.0));
  vec3 k = fetch(vUv + t * vec2(-2.0, 2.0));
  vec3 l = fetch(vUv + t * vec2(0.0, 2.0));
  vec3 m = fetch(vUv + t * vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 +
    (b + f + h + l) * 0.0625 + g * 0.125;
  if (uThreshold >= 0.0) {
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(60.0));
  }
  fragColor = vec4(col, 1.0);
}
`

/** Tent-filter upsample, added onto the level above. */
export const bloomUpFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 fragColor;
void main () {
  vec2 t = uTexel * uRadius;
  vec3 c = texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb
    + texture(uSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb
    + texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0
    + texture(uSrc, vUv).rgb * 4.0
    + texture(uSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0
    + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb
    + texture(uSrc, vUv + vec2(0.0, t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}
`

/**
 * The composite: exposure, a radial speed blur, chromatic aberration, bloom,
 * ACES, vignette, grain, the power cuts. Everything that is a property of the
 * picture rather than of a surface.
 */
export const compositeFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec4 uDecay;
uniform vec4 uRide;
uniform float uTime;
uniform float uExposure;
uniform float uDecode;
uniform float uHeavy;
uniform vec2 uAspect;
out vec4 fragColor;

${HASH12}

vec3 fetch (vec2 uv) {
  vec3 c = texture(uScene, uv).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

// Narkowicz's fitted ACES curve.
${ACES}

void main () {
  vec2 c = vUv - 0.5;
  float r = length(c * uAspect);

  // Speed: a radial smear that only touches the edges of the frame, the way
  // the eye loses the periphery and keeps the vanishing point.
  float speed = clamp(uRide.x / 26.0, 0.0, 1.0);
  float amount = speed * speed * smoothstep(0.18, 0.75, r) * 0.045;
  int taps = uHeavy > 0.5 ? 7 : 3;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  float ca = (0.0009 + uDecay.z * 0.006) * (0.4 + speed);
  for (int i = 0; i < 7; i++) {
    if (i >= taps) break;
    float k = float(i) / float(max(taps - 1, 1));
    vec2 uv = vUv - c * amount * k;
    vec3 s;
    s.r = fetch(uv + c * ca).r;
    s.g = fetch(uv).g;
    s.b = fetch(uv - c * ca).b;
    float w = 1.0 - k * 0.6;
    col += s * w;
    wsum += w;
  }
  col /= wsum;

  col += texture(uBloom, vUv).rgb * (0.075 + uDecay.z * 0.05);
  col *= uExposure;

  // Power cuts, arriving a lap at a time, on a 15 Hz clock so they read as a
  // supply fault rather than as an animation.
  col *= 1.0 - uDecay.y * 0.35 * step(0.965, hash12(vec2(floor(mod(uTime, 997.0) * 15.0), 3.0)));

  col = aces(col);
  col *= 1.0 - smoothstep(0.42, 1.05, r) * (0.42 + speed * 0.2);

  // Rot reaches the grade last.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(1.02, 1.0, 0.96), uDecay.z * 0.55);

  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * 0.02;
  fragColor = vec4(col, 1.0);
}
`

// --- the hover preview -----------------------------------------------------------------

// GLSL ES 1.00, one pass, self-driving from iTime. A tiled platform rushing
// past a train window — tiles on the far wall, lamps overhead, the next
// tunnel mouth glowing at the end — by nearest-plane intersection, so the
// perspective is exact and every band lands crisply on its depth.
export const loopLinePreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.05;
    float run = iTime * 6.5;

    const float HW = 0.46;
    const float HH = 0.28;
    float tF = uv.y < -0.0015 ? HH / -uv.y : 1e9;
    float tC = uv.y >  0.0015 ? HH /  uv.y : 1e9;
    float tW = abs(uv.x) > 0.0015 ? HW / abs(uv.x) : 1e9;
    float z = min(min(tF, tC), tW);
    float depth = z + run;
    float lat = uv.x * z / HW;
    float vert = uv.y * z / HH;
    bool onFloor = tF <= tC && tF <= tW;
    bool onCeil = tC < tF && tC <= tW;
    float shade = clamp(1.9 / z, 0.04, 1.0);

    vec3 col;
    if (onCeil) {
      col = vec3(0.10, 0.10, 0.11);
      float tube = smoothstep(0.08, 0.0, abs(abs(lat) - 0.45)) * step(0.4, fract(depth * 0.32));
      col += vec3(1.2, 1.1, 0.9) * tube;
    } else if (onFloor) {
      col = vec3(0.12, 0.11, 0.10);
      float tie = step(fract(depth * 1.34), 0.38);
      col += vec3(0.07, 0.06, 0.05) * tie;
      float rail = smoothstep(0.05, 0.0, abs(abs(lat) - 0.32));
      col = mix(col, vec3(0.75, 0.76, 0.8), rail * 0.8);
    } else {
      // Subway tile in running bond, cream glaze with a gloss line.
      vec2 t = vec2(depth * 6.0, vert * 9.0);
      t.x += step(1.0, mod(floor(t.y), 2.0)) * 0.5;
      vec2 q = fract(t);
      float grout = step(0.06, q.x) * step(0.08, q.y);
      col = mix(vec3(0.25, 0.23, 0.2), vec3(0.86, 0.80, 0.66), grout);
      col *= 0.85 + hash(floor(t)) * 0.15;
      col *= vert < -0.35 ? 0.6 : 1.0;
      float poster = step(abs(fract(depth * 0.18) - 0.5), 0.12) * step(abs(vert + 0.05), 0.28);
      col = mix(col, vec3(0.7, 0.12, 0.08) * (0.6 + 0.4 * step(0.0, vert)), poster * 0.85);
    }
    col *= shade;
    float pool = pow(0.5 + 0.5 * cos(fract(depth * 0.32) * 6.2831), 3.0) * shade;
    col += vec3(1.0, 0.85, 0.6) * pool * 0.22;

    float r = max(abs(uv.x) / HW, abs(uv.y) / HH);
    col = mix(col, vec3(0.9, 0.8, 0.6), smoothstep(0.12, 0.03, r) * 0.7);

    col = col / (1.0 + col);
    col *= 1.0 - smoothstep(0.4, 1.1, length(uv * vec2(0.9, 1.1))) * 0.6;
    col = pow(col, vec3(0.85));
    col += (hash(gl_FragCoord.xy + fract(iTime)) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
