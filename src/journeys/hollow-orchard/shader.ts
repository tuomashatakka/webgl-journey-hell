// THE HOLLOW ORCHARD — twelve stages of a fungal descent, one raymarch.
//
// Single-pass via lib/gl/shaderQuad.ts, driven by createHollowOrchardSimulation in
// kinematics.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch,
// no dynamic array indexing, no bitwise ops.
//
// The shader owns *geometry and light, nothing else*. Pacing, palette, camera
// and the stage crossfade all arrive as uniforms, so — unlike app/journeys/liminal,
// which hand-mirrors its keyframe tables in GLSL — there is no table here to keep
// in sync. Everything below is a function of what the simulation already decided.
//
// Uniforms (packed; see kinematics.ts `uniforms()`):
//   uStage  (stageA, stageB, blend, localZ)
//   uWalk   (loopZ, loop, descent, rot)
//   uCam    (camX, eyeY, fall, stageLen)
//   uLook   (yaw, pitch, roll, bob)
//   uPulse  (breath, spore, wet, glow)
//   uBg / uKey / uTint — CPU-lerped palette
//
// The camera works in *floor-relative* space: the local floor is always y = 0 and
// the eye sits at uCam.y above it. Descent is sold by pitch, speed and palette
// rather than an absolute Y ramp — which is precisely what lets the CPU own the
// timeline without the shader duplicating it.

import { HASH21 } from '@wjh/glsl/hash'
import { foundationGlsl } from './glsl/foundation'
import { stagesGlsl } from './glsl/stages'
import { dispatchGlsl } from './glsl/dispatch'


const COMMON = foundationGlsl + stagesGlsl + dispatchGlsl

// Shading, camera and the folded-in post chain. Split from COMMON only so the
// preview below can pull in the noise helpers without any of the raymarch.
const SCENE = `
  // Spore motes. Screen-space and additive — cheaper than geometry and it reads
  // better, because real spores are out of focus at every distance.
  vec3 spores(vec2 uv, float t) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      if (fi > 4.0 + uHeavy * 7.0) break;
      float depth = 0.35 + fi * 0.22;
      vec2  g     = uv * (2.0 + fi * 1.6) + vec2(sin(t * 0.07 + fi) * 0.4, -t * 0.05 / depth);
      vec2  id    = floor(g);
      vec2  f     = fract(g) - 0.5;
      float rnd   = hash21(id + fi * 17.0);
      if (rnd < 0.62) continue;
      vec2  off   = vec2(sin(t * 0.6 + rnd * 30.0), cos(t * 0.5 + rnd * 21.0)) * 0.22;
      float m     = smoothstep(0.16, 0.0, length(f - off));
      acc += uTint * m * (0.5 / depth) * (0.4 + 0.6 * rnd);
    }
    return acc * uPulse.y;
  }

  vec3 shadeSurface(vec3 p, vec3 rd, vec3 n, float t, float mat, float wet, float glow) {
    vec3 keyDir = normalize(vec3(-0.45, 0.72, -0.30));

    vec3 base;
    if (mat < 0.5)      base = uTint * 0.55 + vec3(0.10, 0.06, 0.05);   // flesh / fungus
    else if (mat < 1.5) base = vec3(0.78, 0.74, 0.66);                  // bark / bone
    else if (mat < 2.5) base = vec3(0.20, 0.15, 0.11);                  // root / soil
    else if (mat < 3.5) base = uTint * 0.85 + vec3(0.12, 0.02, 0.04);   // wet fruit
    else                base = vec3(0.62, 0.66, 0.78);                  // spore crust

    // Rot mottling, and gills where a cap is facing down.
    float mott = fbm3(p * 2.4);
    base *= mix(1.0, 0.55 + mott * 0.9, 0.35 + 0.5 * uWalk.w);
    if (mat < 0.5) {
      float gill = 0.5 + 0.5 * sin(atan(p.z, p.x) * 36.0);
      base *= mix(1.0, 0.72 + gill * 0.5, clamp(-n.y, 0.0, 1.0));
    }

    float ndl = clamp(dot(n, keyDir), 0.0, 1.0);
    float ao  = calcAO(p, n);
    vec3  col = base * uKey * (0.12 + 0.9 * ndl) * ao;

    // Hemisphere ambient — the ground is dead, the air above it glows a little.
    col += base * mix(uBg * 0.5, uKey * 0.18, 0.5 + 0.5 * n.y) * ao;

    // Fake subsurface: how thick is the thing we just hit? Backlit translucency
    // is what makes fungus read as alive instead of as painted plastic.
    if (uHeavy > 0.5) {
      float thick = max(0.0, -mapScene(p - n * 0.4));
      float back  = pow(clamp(dot(rd, -keyDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
      col += uTint * exp(-thick * 3.5) * back * (0.35 + 0.55 * wet);
    }

    // Wet specular + rim.
    vec3  h    = normalize(keyDir - rd);
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), mix(12.0, 64.0, wet));
    col += uKey * spec * wet * 0.6;
    col += uTint * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * (0.18 + 0.5 * glow);

    // Mycelial filament tracery, heavy-effects only.
    if (uHeavy > 0.5)
      col += uTint * pow(ridge(p * 3.2 + vec3(0.0, 0.0, iTime * 0.06)), 6.0) * glow * 0.7;

    return col;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // Barrel distortion applied to the *ray*, not to a rendered image. Same lens
    // read as a CRT post pass, but there is no second pass here to sample from.
    // Scanlines and the RGB column split come free from #crt-overlay in CSS.
    float r2 = dot(uv, uv);
    uv *= 1.0 + r2 * (0.09 + 0.16 * uWalk.w);

    float fall  = uCam.z;
    float yaw   = uLook.x - uPointer.x * 0.42; // right = cross(fwd, Y) is -x facing +z: negative yaw turns right
    float pitch = uLook.y + uPointer.y * 0.26;

    // The camera rides the bent centreline, so its world x carries pathX. gRo is
    // deliberately the *straight-frame* position instead: lodAt() compares it
    // against points that mapScene has already unbent, and mixing the two frames
    // would fade displacement in and out with the turn rather than with distance.
    gRo     = vec3(uCam.x, uCam.y + uLook.w, uWalk.x);
    vec3 ro = gRo + vec3(pathX(uWalk.x), 0.0, 0.0);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);

    float roll = uLook.z;
    float cr = cos(roll), sr = sin(roll);
    vec3 rgt2 = rgt * cr - up * sr;
    up        = rgt * sr + up * cr;
    rgt       = rgt2;

    // Wider the harder you are falling.
    float focal = mix(1.05, 0.52, fall) * mix(1.0, 0.86, uWalk.w);
    vec3  rd    = normalize(uv.x * rgt + uv.y * up + focal * fwd);

    // --- march ---
    float t = 0.05;
    float d = 0.0;
    bool  hit = false;
    for (int i = 0; i < 92; i++) {
      vec3 p = ro + rd * t;
      d = mapScene(p);
      if (d < 0.0015 * t + 0.0012) { hit = true; break; }
      if (t > 120.0) break;
      // Undershoot: fbm displacement breaks the Lipschitz bound, and the route's
      // shear inflates the estimate by up to ~1.8x on top of that (see the note
      // on PATH_A1 in kinematics.ts). 0.48 stays under the reciprocal of both.
      t += d * 0.48;
    }

    vec3 col = uBg;
    if (hit) {
      vec3  p    = ro + rd * t;
      float mat  = gMat, wet = gWet, glow = gGlow;   // save before extra map() taps
      vec3  n    = calcNormal(p, t);
      col        = shadeSurface(p, rd, n, t, mat, wet, glow);
    }

    // Exponential fog into the stage's own colour, thickened by rot and by the
    // crossfade — every stage change arrives inside a wall of spores, which is
    // also what hides the geometry morph underneath it.
    // (Named xfade, not cross -- cross() is a GLSL builtin called above in this scope.)
    float xfade = sin(uStage.z * PI);
    float den   = 0.016 + 0.030 * uWalk.w + 0.05 * xfade + 0.02 * uPulse.z;
    col = mix(uBg, col, exp(-t * den));

    // Cheap wavelength split in the haze only — the one chromatic effect a
    // single pass can afford, since it needs no resampling of the scene.
    float haze = 1.0 - exp(-t * den);
    col += vec3(0.030, 0.0, -0.022) * haze * uWalk.w;

    col += spores(uv, iTime) * (0.6 + 0.8 * xfade);
    col += uTint * uPulse.w * 0.10 * (0.5 + 0.5 * sin(uPulse.x * TAU));   // glow pulse

    // --- folded post ---
    col *= 1.0 - smoothstep(0.42, 1.10, length(uv)) * (0.55 + 0.25 * uWalk.w);  // vignette
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.5, lum) * 0.5;                              // bloom
    col  = pow(clamp(col, 0.0, 1.7), vec3(0.90));
    col  = mix(col, col * vec3(1.08, 0.90, 1.06), uWalk.w);                     // sickness grade
    col *= 0.94 + 0.06 * uPulse.x;                                              // it breathes
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.035;       // grain

    gl_FragColor = vec4(col, 1.0);
  }
`

export const hollowOrchardFrag = COMMON + SCENE

// Hover preview. Self-driving on iTime alone: the index's CRT attaches no
// simulation, so uStage/uCam would all read zero and the real shader would
// render a black frame. No raymarch either — every card in the grid shares one
// GL context, so this has to compile fast and stay branch-light.
export const hollowOrchardPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH21}

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.10;

    const float HORIZON = 0.20;
    const float FOCAL   = 0.9;

    // Bruised violet above, sick amber ground below.
    vec3 col = mix(vec3(0.11, 0.055, 0.15), vec3(0.03, 0.02, 0.05),
                   smoothstep(-0.05, 0.45, uv.y));
    if (uv.y < HORIZON) {
      float gd = 1.0 / max(HORIZON - uv.y, 0.004);   // ground distance at this pixel
      col = vec3(0.17, 0.115, 0.055) * clamp(2.2 / gd, 0.06, 1.0) + vec3(0.02, 0.012, 0.02);
    }

    // Rows of saplings as discrete depth layers, painted far to near. Doing it
    // per-layer (rather than per-pixel off a y-varying depth) is what keeps the
    // trunks actually vertical — the cheap way streaks them into diagonals.
    for (int i = 0; i < 8; i++) {
      float fi    = float(i);
      float zi    = fract(iTime * 0.09 + fi / 8.0);
      // Linear in zi = constant world speed. Stops at 1.9 so the nearest row
      // never swallows the card, and fades out before it would.
      float depth = mix(9.5, 1.9, zi);
      float yG    = HORIZON - 1.15 / depth;            // where this row meets the ground
      if (uv.y < yG) continue;

      float worldX = uv.x * depth / FOCAL;
      float cellF  = worldX / 2.4;
      float rnd    = hash21(vec2(floor(cellF), floor(zi * 90.0)));
      float wdist  = abs(fract(cellF) - 0.5) * 2.4;    // world units from trunk axis
      float halfW  = 0.15 + 0.06 * rnd;
      float hgt    = (2.6 + 2.0 * rnd) / depth;
      float top    = yG + hgt;
      if (uv.y > top) continue;

      float bar   = smoothstep(halfW, halfW * 0.55, wdist);
      float shade = clamp(3.5 / depth, 0.08, 1.0);
      // Fade in at the far plane, back out before the row reaches the lens.
      float fade  = smoothstep(0.0, 0.14, zi) * smoothstep(1.0, 0.82, zi);
      col = mix(col, vec3(0.62, 0.55, 0.41) * shade, bar * fade * 0.95);

      // The cap on top of it.
      vec2  cp   = vec2(uv.x - (floor(cellF) + 0.5) * 2.4 * FOCAL / depth, uv.y - top);
      float capR = (0.55 + 0.3 * rnd) / depth;
      float cap  = smoothstep(capR, capR * 0.7, length(cp * vec2(1.0, 2.6)));
      col = mix(col, vec3(0.78, 0.52, 0.24) * shade, cap * fade * 0.92);
    }

    // One enormous cap arcing overhead, above all of it.
    float arc = smoothstep(0.07, 0.0, abs(length(uv - vec2(0.0, -0.62)) - 0.92));
    col += vec3(0.58, 0.36, 0.17) * arc * 0.6;

    // Spore motes.
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      vec2  g  = uv * (3.0 + fi * 1.4) + vec2(sin(iTime * 0.1 + fi), -iTime * 0.06);
      vec2  f  = fract(g) - 0.5;
      float rn = hash21(floor(g) + fi * 13.0);
      if (rn < 0.7) continue;
      col += vec3(0.95, 0.66, 0.30) * smoothstep(0.17, 0.0, length(f)) * 0.35 / (1.0 + fi * 0.3);
    }

    col *= 1.0 - smoothstep(0.35, 1.05, length(uv)) * 0.7;      // vignette
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`
