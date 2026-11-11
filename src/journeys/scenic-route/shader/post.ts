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
 *
 * And the lens it was shot through: shafts of sun dragged out of the bloom
 * toward the sun's place on screen (so a tower, a tree or a pillar cuts them),
 * flare ghosts strung through the centre and an anamorphic streak through
 * every bright thing, a little chromatic fringe toward the edges, a grade with
 * teal in the shadows and warmth in the highlights, and grain.
 */
export const compositeFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;   // linear multiplier
uniform float uSpeedBlur;  // 0..1
uniform float uTime;
uniform float uRedRays;    // 0 until the second lap, then more every lap
uniform vec3  uSun;        // the sun on screen: uv, visibility
uniform float uAspect;
uniform float uRain;       // 0..1 rain outdoors (from the second lap)
uniform float uStorm;      // 0..1 the third lap's storm, outdoors
uniform float uSplash;     // 0..1 the waterfall's spray on the glass
out vec4 fragColor;
${ACES}
float grainHash (vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
// Drops on the windscreen: two layers of cells, some holding a drop, each
// drop sliding down at its own pace and bending what is behind it.
vec2 dropOffset (vec2 uv, float wet, float t) {
  vec2 off = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float size = fl == 0.0 ? 0.05 : 0.028;
    vec2 g = uv * vec2(uAspect, 1.0) / size + vec2(fl * 17.0, 0.0);
    vec2 id = floor(g);
    float h = grainHash(id + fl * 31.0);
    if (h > wet * 0.75) continue;
    float slide = fract(t * (0.05 + 0.25 * h) + h * 7.0);
    vec2 centre = vec2(0.3 + 0.4 * grainHash(id + 3.0), 0.85 - slide * 0.7);
    vec2 d = (fract(g) - centre) * vec2(1.0, 0.8);
    float r = 0.18 + 0.12 * h;
    float m = smoothstep(r, r * 0.6, length(d));
    off += d * m * size * 1.4;
  }
  return off;
}

void main () {
  vec2 uv = vUv;
  float wet = max(uRain, uSplash);
  if (wet > 0.001)
    uv += dropOffset(vUv, wet, uTime);
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
  else {
    // A little chromatic fringe, growing toward the corners.
    vec2 ca = c * dot(c, c) * 0.012;
    col = vec3(texture(uScene, uv + ca).r, texture(uScene, uv).g, texture(uScene, uv - ca).b);
  }

  col += texture(uBloom, uv).rgb * 0.55;

  if (uSun.z > 0.001) {
    // How much sun gets through: the bloom at the sun's own place on screen,
    // so a tower, a crown or the A-pillar in front of it shuts it all off.
    vec2 su = clamp(uSun.xy, 0.0, 1.0);
    float open = dot(texture(uBloom, su).rgb, vec3(0.3333));
    float onScreen = 1.0 - smoothstep(0.0, 0.35, max(max(-uSun.x, uSun.x - 1.0), max(-uSun.y, uSun.y - 1.0)));
    float sunAmt = uSun.z * onScreen;

    // Shafts: the bloom dragged toward the sun, so only what is bright and
    // unblocked streams; everything in front of the sky cuts a shadow in it.
    vec2 d = uv - uSun.xy;
    vec3 shafts = vec3(0.0);
    float jit = grainHash(uv * 731.0 + uTime) * 0.04;
    for (int i = 0; i < 24; i++) {
      float t = (float(i) + jit * 24.0) / 24.0;
      shafts += texture(uBloom, uv - d * t * 0.85).rgb * (1.0 - t);
    }
    shafts /= 24.0;
    float near = exp(-length(d * vec2(uAspect, 1.0)) * 1.6);
    col += shafts * vec3(1.0, 0.82, 0.58) * 1.6 * sunAmt * near;

    // Ghosts: discs strung from the sun through the centre, each its own tint.
    float flare = clamp(open * 1.5, 0.0, 1.0) * sunAmt;
    if (flare > 0.002) {
      vec2 axis = vec2(0.5) - uSun.xy;
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float at = fk == 0.0 ? 0.55 : fk == 1.0 ? 0.9 : fk == 2.0 ? 1.25 : fk == 3.0 ? 1.6 : 2.1;
        float rad = fk == 0.0 ? 0.03 : fk == 1.0 ? 0.07 : fk == 2.0 ? 0.045 : fk == 3.0 ? 0.11 : 0.06;
        vec3 tint = fk == 0.0 ? vec3(1.0, 0.6, 0.3) : fk == 1.0 ? vec3(0.3, 0.8, 0.6) : fk == 2.0 ? vec3(0.8, 0.4, 0.9) : fk == 3.0 ? vec3(0.3, 0.5, 1.0) : vec3(1.0, 0.8, 0.4);
        vec2 g = uSun.xy + axis * at;
        float r = length((uv - g) * vec2(uAspect, 1.0));
        float disc = smoothstep(rad, rad * 0.7, r) * (0.6 + 0.4 * smoothstep(rad * 0.4, rad, r));
        col += tint * disc * 0.05 * flare;
      }
      // The sun's own starburst and halo ring.
      vec2 sd = (uv - uSun.xy) * vec2(uAspect, 1.0);
      float rr = (length(sd) - 0.22) * 30.0;
      float ring = exp(-rr * rr);
      col += vec3(0.6, 0.7, 1.0) * ring * 0.04 * flare;
    }
  }

  // Anamorphic streak: every bright thing smeared sideways, cold blue.
  vec3 streak = vec3(0.0);
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    streak += texture(uBloom, uv + vec2(fi * 0.018, 0.0)).rgb * (1.0 - abs(fi) / 9.0);
  }
  float sl = dot(streak / 9.0, vec3(0.3333));
  col += vec3(0.35, 0.55, 1.0) * max(sl - 0.25, 0.0) * 0.5;

  // Red light shafts: the glow the road's cracks leak, dragged up the frame
  // from a point under it, keeping only what is red. From the second lap.
  if (uRedRays > 0.001) {
    vec2 dir = uv - vec2(0.5, -0.15);
    float acc = 0.0;
    for (int i = 0; i < 16; i++) {
      float t = float(i) / 16.0;
      vec3 b = texture(uBloom, uv - dir * t * 0.5).rgb;
      acc += max(b.r - max(b.g, b.b) * 1.3, 0.0) * (1.0 - t);
    }
    float flick = 0.85 + 0.15 * sin(uTime * 2.3 + uv.x * 9.0);
    col += vec3(1.0, 0.07, 0.02) * acc / 16.0 * uRedRays * 18.0 * flick;
  }
  // Rain: thin slanting streaks in the air, catching what light there is.
  if (uRain > 0.001) {
    vec2 rq = vec2(vUv.x * uAspect * 90.0 + vUv.y * 14.0, vUv.y * 2.0 + uTime * 9.0);
    float rh = grainHash(vec2(floor(rq.x), 3.0));
    float line = 1.0 - smoothstep(0.0, 0.12, abs(fract(rq.x) - 0.5));
    float seg = smoothstep(0.86, 1.0, fract(rq.y * (0.3 + rh * 0.4) + rh * 13.0));
    col += vec3(0.5, 0.55, 0.6) * line * seg * step(0.45, rh) * uRain * 0.12;
  }
  // The storm: the light goes grey and flat, and lightning whites it out in
  // a double flicker every few seconds.
  if (uStorm > 0.001) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(l) * vec3(0.85, 0.9, 1.0), 0.45 * uStorm) * (1.0 - 0.3 * uStorm);
    float k = floor(uTime / 3.7);
    float ph = uTime - k * 3.7;
    float bolt = step(0.55, grainHash(vec2(k, 9.0))) * exp(-ph * 5.0) * (0.55 + 0.45 * sin(ph * 70.0));
    col = col * (1.0 + bolt * 2.5 * uStorm) + vec3(0.6, 0.65, 0.8) * bolt * 0.35 * uStorm;
  }
  col *= uExposure;
  col = aces(col);
  // The grade: teal pushed into the shadows, warmth into the highlights, a
  // gentle S for contrast and a touch more colour. Then the vignette.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += vec3(-0.012, 0.004, 0.018) * (1.0 - luma) * (1.0 - luma);
  col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), smoothstep(0.35, 0.9, luma));
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.08);
  col *= 1.0 - smoothstep(0.4, 1.1, length(c * vec2(1.0, 1.1))) * 0.38;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // Grain, finer in the light than in the dark, as on film.
  float gr = grainHash(uv * 1031.0 + fract(uTime * 7.13) * 91.0) - 0.5;
  col += gr * mix(0.045, 0.02, luma);
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
