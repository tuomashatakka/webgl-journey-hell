// THE FOUNDRY — a lift drop into a machine hall that never ends.
//
// Companion piece to THE LIMINAL JOURNEY: the same endlessly repeating
// first-person traversal, but the corridors are machinery and the motion is not
// authored. Every moving thing in this shader is positioned by uniforms produced
// by the rigid-body integrator in physics.ts — the falling cage, six tumbling
// debris bodies loose in it, the walker's gait (head height on a leg spring,
// lateral sway, roll and yaw all read off footfalls), the exact slider-crank
// piston extension, and two pendulums swung by the cage's acceleration and by
// your own footsteps. The shader draws state; it does not invent motion.
//
// Single-pass raymarch via lib/gl/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only. Uniforms beyond the shared set:
//   uWalk    = (cyclicZ, smoothLoop, decay, headRoll)
//   uGait    = (eyeY, swayX, headYaw, headPitch)
//   uRide    = (riding, shutterClosed, gateOpen, phaseSeconds)
//   uCage    = (floorY, velocity, acceleration, mode)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, cageHookAngle, hallChainAngle)
//   uDebris  = 6 x (cageX, worldY, cageZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion
//   uFold0/1 = fold coordinate of the 8 folding-span cubes
//
// THE LAP. It opens inside the cage, part-way down a 128 m hoist shaft, with the
// cable already gone: free fall, then the emergency shoes on the guide rails,
// then a governed shudder onto the landing and the gate rattling up. From there
// it is a walk through seven 36 m halls (loading bay, piston gallery, long run,
// coolant tier, gearworks, brake run, furnace floor) laid end to end, and
// everything is keyed off mod(z, CYCLE) — so the seventh hall runs straight back
// into the first with no seam, no fade and no teleport. Every boundary, the wrap
// included, is handled by exactly one rule (see secBlend): the last TRANS metres
// funnel the corridor profile into the next hall's proportions, the last
// FEAT_FADE metres erode this hall's machinery away while the next hall's
// already stands beyond the doorway, and a bulkhead portal is bolted across the
// join. The lap ends where it began, back in the cage, and the shutter coming
// down over its open faces is the only thing that is ever cut away from.
//
// NOTHING IS SIMPLY THERE. Every mechanism drives itself into place as it comes
// into view — rams telescope out of the wall, gears rise in their recesses and
// spin up, valve wheels swing out, shoe housings clamp onto the rails, hoist
// beams lower on their hangers, bulkhead shutters roll up, lamps strike. They
// all run on one closed-form damped hinge (deployAt) evaluated against distance
// to the walker, so they overshoot and ring down instead of easing.
//
// TEXTURE. There are no image textures here — one draw call, no render targets,
// no assets — so every surface is built from a height field which tints the
// albedo, drives the roughness, and whose gradient perturbs the normal.
//
// THE DECAY. Each completed lap leaves the foundry a little less sure of itself:
// the corridor snakes and breathes, the walls close in, lamps fail, the lens
// barrels, whole scanlines tear sideways and the grade rots toward oxblood.
// Same road, one level deeper, worse every time round.

import { HASH11, HASH21 } from '@wjh/glsl/hash'
import { ROT, SD_BOX, SD_BOX2 } from '@wjh/glsl/sdf'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'
import { foundationGlsl } from './glsl/foundation'
import { decayGlsl } from './glsl/decay'
import { hallsGlsl } from './glsl/halls'
import { shaftGlsl } from './glsl/shaft'
import { oblivionGlsl } from './glsl/oblivion'
import { surfaceTextureGlsl } from './glsl/surfaceTexture'
import { shadingGlsl } from './glsl/shading'
import { cameraGlsl } from './glsl/camera'


const COMMON = foundationGlsl + decayGlsl + hallsGlsl + shaftGlsl + oblivionGlsl + surfaceTextureGlsl + shadingGlsl + cameraGlsl

// Full-quality variant used by the route page.
export const foundryFrag = `
#define RM_STEPS 96
#define MAX_DIST 90.0
#define STEP_K 0.72
#define FBM_OCTAVES 4
#define SPARK_LAYERS 14
${COMMON}`

// The hover thumbnail runs without a simulation attached (uWalk et al. are all
// zero), so it gets its own compact, self-driving shader rather than a cheaper
// build of the one above: the journey's opening shot, an analytic plunge down a
// shaft past ribs, lamps and a landing door, with the brake flash on a cycle.
export const foundryPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH21}

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.10;

    // The drop runs on a cycle: free fall, shoes, stop, and away again.
    float cycle = fract(iTime * 0.085);
    float speed = 26.0 * (1.0 - smoothstep(0.62, 0.86, cycle));
    float brake = smoothstep(0.62, 0.70, cycle) * (1.0 - smoothstep(0.84, 0.94, cycle));
    float fall = iTime * 14.0 - 60.0 * smoothstep(0.62, 0.86, cycle);
    // The stop throws the frame down and lets it rebound.
    uv.y += brake * 0.05 * sin(cycle * 90.0) * exp(-(cycle - 0.62) * 14.0);

    // Fake-perspective shaft: |uv| drives distance to the wall, so the frame
    // reads as looking down a square well.
    float q = max(abs(uv.x), abs(uv.y));
    float depth = 0.42 / max(q, 0.02);

    // Ribs streaming up past the cage.
    float rib = fract(depth * 0.9 + fall * 0.06);
    float ribHi = smoothstep(0.0, 0.06, rib) * (1.0 - smoothstep(0.14, 0.22, rib));

    float shade = clamp(1.6 / depth, 0.04, 1.0);
    vec3 col = vec3(0.085, 0.088, 0.098) * shade;
    col = mix(col, vec3(0.26, 0.12, 0.06) * shade, hash21(floor(vec2(uv * 14.0))) * 0.5);
    col += ribHi * shade * 0.16;

    // Caged wall lamps, staggered, streaming upward as the cage falls.
    float lampPhase = fract(depth * 0.30 + fall * 0.02);
    float lamp = smoothstep(0.03, 0.0, abs(lampPhase - 0.5)) * smoothstep(0.55, 0.25, abs(uv.x));
    col += vec3(1.0, 0.72, 0.38) * lamp * 1.6;

    // Motion blur along the fall, which is what actually reads as speed.
    col *= 1.0 - clamp(speed, 0.0, 26.0) / 26.0 * 0.35 * smoothstep(0.1, 0.6, abs(uv.y));

    // The cage's own gate — the bars you are looking out through.
    float bars = min(abs(fract(uv.x * 9.0) - 0.5), abs(fract(uv.y * 9.0) - 0.5));
    col *= mix(1.0, 0.35, smoothstep(0.06, 0.0, bars));

    // Brake sparks off the guide rails, and the melt burning far below.
    float sparkle = step(0.985, hash21(floor(uv * 90.0) + floor(iTime * 30.0)));
    col += vec3(1.6, 0.95, 0.42) * sparkle * brake * 1.8;
    col += vec3(0.30, 0.09, 0.02) * pow(max(-uv.y, 0.0), 2.0) * 1.2;

    col *= 1.0 - smoothstep(0.40, 1.05, length(uv)) * 0.6;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 96 raymarch steps x (hall + deployed machinery + portal +
// shaft + cage + 6 quaternion-rotated debris boxes + 8 folding cubes), plus four
// height-field evaluations for the bump normal at the hit. The bounding-sphere
// rejects, the ceiling test that skips the whole corridor while you are up the
// shaft, and the shaft/span distance gates keep the common case near the cost of
// the corridor alone. ~1 draw call, no textures, no render targets.
