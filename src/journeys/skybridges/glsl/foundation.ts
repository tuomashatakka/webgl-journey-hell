// The ground floor of the skybridges shader: uniforms, the clock, the route the
// runner follows and the height of their eye along it. Everything else builds
// on the per-pixel state declared here and filled in once by main().

import { HASH21 } from '@wjh/glsl/hash'
import { ROT, SD_BOX, SMIN } from '@wjh/glsl/sdf'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'
import { ACES } from '@wjh/glsl/color'


/** The numbers the shader shares with kinematics.ts, baked in as constants. */
export interface SkybridgesTimeline {
  speed:  number;
  loopZ:  number;
  blastT: number;
}

const f = (n: number) => n.toFixed(3)

export function foundationGlsl ({ speed, loopZ, blastT }: SkybridgesTimeline): string {
  return /* glsl */`
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavy effects: the view carries on through glass
  uniform sampler2D uEnv;      // equirectangular environment map (unit 0)
  uniform float uEnvLoaded;    // 1.0 once uEnv's image has uploaded

  const float PI = 3.14159265359;
  const float SPEED = ${f(speed)};
  const float LOOP_Z = ${f(loopZ)};
  const float LAP_T = ${f(loopZ / speed)};
  const float BLAST_T = ${f(blastT)};   // the detonation: the lap-three boundary
  const float EYE = 1.6;
  const float LOOKAHEAD = 14.0;          // how far ahead the head turns into a bend
  const float SEG = 9.0;                 // the steel skeleton falls in segments this long
  const float PANE_W = 1.0667;           // three panes across the standard deck
  const float PANE_L = 1.5;
  const float SEA_Y = -120.0;            // cloud tops
  const float GRAV = 18.0;

  const float M_GLASS = 0.0;
  const float M_STEEL = 1.0;
  const float M_FACADE = 2.0;
  const float M_TRAIN = 3.0;
  const float M_CONCRETE = 4.0;
  const float M_FROST = 5.0;

  // The nearest surface. Each structure writes its candidate (c*); the scene
  // map keeps the winner (g*). gInfo and the box are material-specific.
  float gMat, cMat;
  vec4 gInfo, cInfo;
  vec3 gBoxC, cBoxC, gBoxH, cBoxH;

  // Per pixel, set once by main() before anything is marched.
  float gZ;        // the runner's canonical z, unwrapped
  float gZL;       // ...and within the lap
  float gCamH;     // true-world heading of the route at the runner
  float gDamage;   // 0..1, how far the city has come apart over the run
  float gE;        // seconds since the detonation; negative before it
  float gArrive;   // seconds after the detonation at which the shockfront reaches the runner
  float gTm;       // a wrapped clock for anything that only animates
  vec2 gCamW;      // the runner's true-world position (xz, metres)
  vec2 gGZ;        // ground zero (xz, metres)
  float gW1, gW2, gW3, gW4, gW5, gW6, gW7, gW8, gW9;   // section weights, sum 1

  // Light, blended across sections (atmosphere.ts). *W are true-world.
  vec3 gSunW, gSun, gSunCol, gZenith, gHorizon;
  vec3 gBlastW, gBlastDir, gBlastCol;
  float gHaze, gExposure, gNight, gFrost, gCloud, gBloom, gAurora;

  ${HASH21}
  ${valueNoise2('hash21')}
  ${fbm2({ octaves: 'FBM_OCTAVES', next: 'p = p * 2.03 + vec2(1.7, 9.2);' })}
  ${ROT}
  ${SD_BOX}
  ${SMIN}
  ${ACES}

  float sdSeg(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  /** Rotate an xz vector by heading h: +z swings towards +x (right) as h grows. */
  vec2 turnXZ(vec2 v, float h) {
    float c = cos(h), s = sin(h);
    return vec2(v.x * c + v.y * s, v.y * c - v.x * s);
  }

  float easeIO(float u) { u = clamp(u, 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
  float win(float z, float a, float b, float c, float d) { return smoothstep(a, b, z) - smoothstep(c, d, z); }
  float bandW(float z, float a, float b) { return smoothstep(a - 6.0, a + 6.0, z) - smoothstep(b - 6.0, b + 6.0, z); }

  /** A section's weight at lap-local z, wrapping across the lap seam. */
  float sectionW(float z, float a, float b) {
    return bandW(z, a, b) + bandW(z + LOOP_Z, a, b) + bandW(z - LOOP_Z, a, b);
  }

  float playerZ() { return iTime * SPEED; }

  // --- the route -------------------------------------------------------------
  // Authored straight along +z and bent around the runner by unbend(). Four
  // turns a lap, never through a set piece, summing to one full turn so the lap
  // seam carries no yaw jump: a heading of 2pi rotates exactly like 0.
  float turnHeading(float z) {
    z = mod(z, LOOP_Z);
    return -PI / 3.0 * smoothstep(188.0, 224.0, z)
      + PI * 2.0 / 3.0 * smoothstep(366.0, 414.0, z)
      + PI * smoothstep(420.0, 480.0, z)
      + PI * 2.0 / 3.0 * smoothstep(488.0, 532.0, z);
  }

  /** Render space -> canonical: undo the route's heading change between the runner and w. */
  vec3 unbend(vec3 w) {
    float a = turnHeading(w.z) - gCamH;
    vec2 o = turnXZ(w.xz - vec2(0.0, gZ), -a);
    return vec3(o.x, w.y, o.y + gZ);
  }

  vec3 toWorld(vec3 d) { vec2 t = turnXZ(d.xz, gCamH); return vec3(t.x, d.y, t.y); }
  vec3 toRender(vec3 d) { vec2 t = turnXZ(d.xz, -gCamH); return vec3(t.x, d.y, t.y); }

  // The route's true-world track, for the things that need real distance:
  // the cloud sea's parallax and the shockfront. Each turn is integrated as an
  // arc of constant curvature, which the smoothstep headings above approximate.
  void leg(float zl, float z1, inout vec2 p, inout float z0, float h) {
    p += max(0.0, min(zl, z1) - z0) * vec2(sin(h), cos(h));
    z0 = z1;
  }
  void arc(float zl, float hw, float a, inout vec2 p, inout float z0, inout float h) {
    float len = 2.0 * hw;
    float da = a * clamp(zl - z0, 0.0, len) / len;
    float r = len / a;
    p += r * vec2(cos(h) - cos(h + da), sin(h + da) - sin(h));
    h += da;
    z0 += len;
  }
  vec2 routeLocal(float zl) {
    vec2 p = vec2(0.0);
    float h = 0.0, z0 = 0.0;
    leg(zl, 188.0, p, z0, h);
    arc(zl, 18.0, -PI / 3.0, p, z0, h);
    leg(zl, 366.0, p, z0, h);
    arc(zl, 24.0, PI * 2.0 / 3.0, p, z0, h);
    leg(zl, 420.0, p, z0, h);
    arc(zl, 30.0, PI, p, z0, h);
    leg(zl, 488.0, p, z0, h);
    arc(zl, 22.0, PI * 2.0 / 3.0, p, z0, h);
    leg(zl, LOOP_Z, p, z0, h);
    return p;
  }
  vec2 routeW(float z) {
    float lap = floor(z / LOOP_Z);
    return lap * routeLocal(LOOP_Z) + routeLocal(z - lap * LOOP_Z);
  }

  // --- the runner's eye ------------------------------------------------------
  /** A hop off an edge: up at first, then gravity, landing on y1 at u = 1. */
  float hop(float y0, float y1, float u, float lift) {
    u = clamp(u, 0.0, 1.0);
    return y0 + (y1 - y0) * u * u + lift * u * (1.0 - u);
  }

  /** Eye height at canonical z. Continuous at every join (spec section 5). */
  float pathY(float z) {
    z = mod(z, LOOP_Z);
    if (z < 120.0) return EYE;
    if (z < 180.0) return mix(EYE, 11.6, easeIO((z - 120.0) / 60.0));          // 3 the climb
    if (z < 225.0) return 11.6;                                               // 4 the wire
    if (z < 240.0) return hop(11.6, EYE, (z - 225.0) / 15.0, 2.0);           // 4 the jump
    if (z < 248.0) return EYE;                                                // 5 landing deck
    if (z < 260.0) return hop(EYE, -2.3, (z - 248.0) / 12.0, 1.4);           // 5 onto the train
    if (z < 288.0) return -2.3 + sin(z * 0.9) * 0.05;                         // 5 the ride
    if (z < 300.0) { float u = (z - 288.0) / 12.0; return -2.3 - 21.7 * u * u; }  // 5 off the end
    if (z < 306.0) { float s = z - 300.0; return -24.0 - 3.617 * s + 0.3014 * s * s; } // 6 caught
    if (z < 356.0) return mix(-34.85, -18.4, easeIO((z - 306.0) / 50.0));     // 6 climbing out
    if (z < 420.0) return -18.4;                                              // 7 the tube
    if (z < 480.0) return mix(-18.4, 9.6, easeIO((z - 420.0) / 60.0));        // 8 the helix climbs
    if (z < 526.0) return 9.6;                                                // 9 the crown
    return mix(9.6, EYE, easeIO((z - 526.0) / 14.0));                         // down to the dawn
  }

  /** The main deck's top at canonical z, or 1e4 where there is none. */
  float deckTop(float z) {
    float zl = mod(z, LOOP_Z);
    if (zl >= 225.0 && zl < 236.0) return 1e4;    // the wire has snapped
    if (zl >= 236.0 && zl < 248.0) return 0.0;    // the landing deck
    if (zl >= 248.0 && zl < 300.0) return 1e4;    // the train has the route
    return pathY(z) - EYE;
  }

  /** How far along z to the nearest deck where there is none (a safe step). */
  float deckGap(float zl) {
    if (zl >= 225.0 && zl < 236.0) return min(zl - 225.0, 236.0 - zl);
    if (zl >= 248.0 && zl < 300.0) return min(zl - 248.0, 300.0 - zl);
    return 0.0;
  }

  float deckHalfW(float zl) {
    float w = 1.6;
    w = mix(w, 0.7, win(zl, 180.0, 184.0, 224.0, 226.0));      // the wire
    w = mix(w, 6.0, win(zl, 484.0, 494.0, 526.0, 536.0));      // the crown's plaza
    return w;
  }
`
}
