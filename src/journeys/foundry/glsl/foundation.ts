import { HASH11, HASH21 } from '@wjh/glsl/hash'
import { ROT, SD_BOX, SD_BOX2 } from '@wjh/glsl/sdf'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'
import { ACES } from '@wjh/glsl/color'


export const foundationGlsl = `
  precision highp float;
  out vec4 fragColor;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (steam volumetrics, extra sparks)

  uniform vec4 uWalk;          // cyclicZ, smoothLoop, decay, headRoll
  uniform vec4 uGait;          // eyeY, swayX, headYaw, headPitch
  uniform vec4 uRide;          // riding, shutterClosed, gateOpen, phaseSeconds
  uniform vec4 uCage;          // floorY, velocity, acceleration, mode
  uniform vec4 uSim;           // shakeX, shakeY, brakeSpark, cableIntact
  uniform vec4 uMech;          // crank, pistonExtension, hookAngle, chainAngle
  uniform vec4 uDebris[6];     // xz = cage-frame position, y = world height, w = scale
  uniform vec4 uDebrisQ[6];    // orientation quaternion
  uniform vec4 uFall;          // metresFallen, oblivionSeconds, shaftHead, inOblivion
  uniform vec4 uFold0;         // fold coordinate of span tiles 0..3
  uniform vec4 uFold1;         // fold coordinate of span tiles 4..7
  uniform vec4 uFold2;         // fold coordinate of span tiles 8..11
  uniform vec4 uFold3;         // fold coordinate of span tiles 12..15

  const float PI = 3.14159265359;

  // --- the loop (mirrors physics.ts) ---------------------------------------
  const float SEC_LEN = 36.0;
  const float SEC_COUNT = 7.0;
  const float CYCLE = 252.0;    // SEC_LEN * SEC_COUNT
  const float TRANS = 9.0;      // profile funnel length at every boundary
  const float FEAT_FADE = 3.0;  // machinery dissolve length at every boundary
  const float FEAT_ERODE = 2.2; // how far a dissolving fitting is offset away
  const float CEIL_MAX = 11.5;  // above every hall's ceiling — nothing but shaft

  // --- the hoist shaft (mirrors physics.ts) ---------------------------------
  const float LIFT_Z = 18.0;
  const float SHAFT_R = 3.0;
  // Shaft head is not a constant any more: the cable parts higher up every run,
  // so the head goes with it and arrives as a uniform. See liftTopFor.
  const float PIT_Y = -3.0;
  const float CAGE_R = 1.5;
  const float CAGE_H = 2.6;

  // --- the stepping stones (mirrors physics.ts) -----------------------------
  const float SPAN_Z0 = 219.0;
  const float TILE_H = 1.2;      // plate half-size
  const float TILE = 2.4;        // step between tiles — they share an edge
  const float PLATE_T = 0.09;    // plate half-thickness
  const float SPAN_MID = 229.8;  // centre of the cut in the furnace floor
  const float SPAN_HALF = 13.0;  // half-length of that cut
  const float MELT_Y = -30.0;

  // --- oblivion (mirrors physics.ts) ----------------------------------------
  const float OB_PERIOD = 64.0;  // vertical period of the shaft with no bottom

  // --- deployment ------------------------------------------------------------
  const float DEPLOY_SIGHT = 20.0; // metres ahead at which a mechanism wakes up
  const float DEPLOY_RUN = 8.0;    // metres over which it drives out and settles

  // Material/look state written by the SDF at the nearest hit.
  float gMat;      // 0 plate, 1 painted frame, 2 offcut, 3 machined, 4 lamp,
                   // 5 rail steel, 6 span panel, 8 molten
  float gWear;     // 0..1 rust/paint-chip weight
  float gGlow;     // emissive weight

  // --- hash / noise --------------------------------------------------------
  ${HASH11}
  ${HASH21}
  ${valueNoise2('hash21')}
  ${fbm2({ octaves: 'FBM_OCTAVES', next: 'p *= 2.03;' })}
  ${ROT}
  ${ACES}

  // Rotate v by quaternion q / by its inverse. Used to bring a world-space
  // sample point into each debris body's local frame.
  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  vec3 qinv(vec4 q, vec3 v) { return qrot(vec4(-q.xyz, q.w), v); }

  // --- SDF primitives ------------------------------------------------------
  ${SD_BOX}
  ${SD_BOX2}
  float sdCylY(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdCylX(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.yz) - r, abs(p.x) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdTorusX(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.yz) - R, p.x);
    return length(q) - r;
  }

  // --- convenience ---------------------------------------------------------
  float cageY() { return uCage.x; }
  float cageA() { return uCage.z; }
  float spark() { return uSim.z; }
  float decay() { return uWalk.z; }
  // What the eye is shown of it. decay() is the geometry's (the corridor's
  // squeeze has to agree with the walker's); this is the one the cracks, the
  // leaks, the lamps and the grade use, and it does not wait: from the second
  // lap on the place is visibly coming apart.
  float decayVis() { return clamp(max(uWalk.z * 3.2, (uWalk.y - 0.6) * 0.36), 0.0, 0.85); }
  // The red leaking through the split plate into the air, from the second lap.
  float leakI() { return smoothstep(0.75, 1.25, uWalk.y) * (1.5 + 2.0 * clamp(uWalk.y - 1.0, 0.0, 2.0)); }
  float walkZ() { return uWalk.x; }
  float riding() { return uRide.x; }
  float shutter() { return uRide.y; }
  float gateOpen() { return uRide.z; }
  // Free fall reads as weightlessness: the cage's acceleration approaches -g.
  float weightless() { return smoothstep(-6.0, -9.2, cageA()); }
  float oblivion() { return uFall.w; }
  float fallen() { return uFall.x; }

`
