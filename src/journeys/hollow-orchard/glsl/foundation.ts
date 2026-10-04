import { HASH11, HASH21 } from '@wjh/glsl/hash'
import { SD_BOX, SD_SPHERE, SMAX, SMIN } from '@wjh/glsl/sdf'


export const foundationGlsl = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;     // 1.0 = heavyEffects (extra fbm octaves, SSS, filaments)

  uniform vec4 uStage;      // stageA, stageB, blend, localZ
  uniform vec4 uWalk;       // loopZ, loop, descent, rot
  uniform vec4 uCam;        // camX, eyeY, fall, stageLen
  uniform vec4 uLook;       // yaw, pitch, roll, bob
  uniform vec4 uPulse;      // breath, spore, wet, glow
  uniform vec4 uPath;       // A1, k1, A2, k2 — the route's two harmonics
  uniform vec4 uAisle;      // swayAmp, radius, centreY, halfHeight
  uniform vec3 uBg;
  uniform vec3 uKey;
  uniform vec3 uTint;

  const float PI  = 3.14159265;
  const float TAU = 6.28318531;

  // Written by the SDF at the nearest hit, read by shading. Saved off before any
  // extra map() taps (normals, AO, SSS) clobber them.
  float gMat;   // 0 flesh · 1 bark/bone · 2 root/soil · 3 wet fruit · 4 spore crust
  float gWet;
  float gGlow;

  // Ray origin, published by main() so the SDFs can cheapen themselves with
  // distance. Every fbm tap costs ~32 hashes and the far field is where the
  // march spends its steps, so fading displacement out past ~16 units is the
  // single biggest win available — and fading (not clipping) keeps the distance
  // field continuous, which a hard cutoff would not.
  vec3 gRo;

  float lodAt(vec3 p) {
    return 1.0 - smoothstep(16.0, 30.0, length(p - gRo));
  }

  // --- the route -----------------------------------------------------------
  // Coefficients, not a table: kinematics.ts owns the shape and uploads it, and
  // this evaluates it at any marched z. Every stage below is authored around a
  // straight axis and mapScene bends the domain underneath them, so the whole
  // world snakes and no SDF has to know the route exists.
  float pathX(float z) {
    return sin(z * uPath.y) * uPath.x + sin(z * uPath.w) * uPath.z;
  }

  // Where the camera sits *within* the bent frame. Same expression the CPU uses
  // for camX, so the aisle below is centred on the line actually walked rather
  // than on the axis the camera only averages out to.
  float trackX(float z) {
    return sin(z * 0.055) * uAisle.x + sin(z * 0.017) * uAisle.x * 0.6;
  }

  // --- hash / noise --------------------------------------------------------
  ${HASH11}
  ${HASH21}
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    float a = mix(hash11(n),         hash11(n + 1.0),   f.x);
    float b = mix(hash11(n + 57.0),  hash11(n + 58.0),  f.x);
    float c = mix(hash11(n + 113.0), hash11(n + 114.0), f.x);
    float d = mix(hash11(n + 170.0), hash11(n + 171.0), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
  // Octave count rides uHeavy: 2 octaves light, 4 heavy. The bound stays constant
  // (ES 1.00 requirement) — only the early break moves.
  float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      if (float(i) > 1.0 + uHeavy * 2.0) break;
      s += a * vnoise3(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  // Ridged noise — filaments and veins. Shading only, never the SDF.
  float ridge(vec3 p) {
    return 1.0 - abs(fbm3(p) * 2.0 - 1.0);
  }

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }
  // Signed domain repetition that behaves for negative coordinates.
  float repS(float x, float s) {
    return mod(x + 0.5 * s, s) - 0.5 * s;
  }
  ${SMIN}
  ${SMAX}

  // --- primitives ----------------------------------------------------------
  ${SD_SPHERE}
  float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
  }
  ${SD_BOX}
  float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float sdVertCone(vec3 p, float h, float r0, float r1) {
    float t = clamp(p.y / h, 0.0, 1.0);
    float r = mix(r0, r1, t);
    float d = length(p.xz) - r;
    return max(d, max(-p.y, p.y - h));
  }
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  // --- organic operators ---------------------------------------------------
  // The rooms inhale. Phase comes from the CPU so the audio can lock to it.
  float breathe(vec3 p) {
    return sin(uPulse.x * TAU + p.z * 0.28) * (0.06 + 0.22 * uPulse.z);
  }
  // Subtractive decay: eats holes rather than adding lumps. Amplitude is clamped
  // because fbm breaks the SDF's Lipschitz bound and the march has to survive it.
  float rotDisp(vec3 p, float amt) {
    return fbm3(p * 1.7 + vec3(0.0, 0.0, iTime * 0.04)) * min(amt, 0.45);
  }
  // A mushroom cap: squashed dome, hollowed underside, rim softened.
  // Gills are a *shading* term (see shadeSurface) — putting them in the SDF
  // costs the distance bound and the march falls apart on grazing rays.
  float sdCap(vec3 p, float r, float h) {
    float dome   = sdEllipsoid(p, vec3(r, h, r));
    float hollow = sdEllipsoid(p - vec3(0.0, -h * 0.35, 0.0), vec3(r * 0.86, h * 0.8, r * 0.86));
    return smax(dome, -hollow, 0.06 * r);
  }

`
