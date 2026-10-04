// SKYBRIDGES — a first-person sprint across glass skybridges between glass
// supertalls, a cloud sea a hundred metres down; the deck breaks under every
// step, the towers crack as the run passes, and at the end of the second lap
// the city goes. Nine sections, each its own place. See
// docs/journeys/skybridges.md for the full design.
//
// Single-pass raymarch via @wjh/gl/shaderQuad. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only, no dynamic array indexing. Uniforms:
// iResolution, iTime, uPointer, uHeavy (the view carries on through glass),
// uEnv (equirect env), uEnvLoaded.

import { atmosphereGlsl } from './glsl/atmosphere'
import { blastGlsl } from './glsl/blast'
import { cameraGlsl } from './glsl/camera'
import { cracksGlsl } from './glsl/cracks'
import { foundationGlsl } from './glsl/foundation'
import { materialsGlsl } from './glsl/materials'
import { structuresGlsl } from './glsl/structures'
import { SKYBRIDGES_BLAST_T, SKYBRIDGES_LOOP_Z, SKYBRIDGES_SPEED } from './kinematics'


const COMMON = foundationGlsl({ speed: SKYBRIDGES_SPEED, loopZ: SKYBRIDGES_LOOP_Z, blastT: SKYBRIDGES_BLAST_T }) +
  blastGlsl + atmosphereGlsl + cracksGlsl + structuresGlsl + materialsGlsl + cameraGlsl

// The route page: env map bound, see-through glass when heavy effects are on.
export const skybridgesFrag = `
#define RM_STEPS 88
#define MAX_DIST 170.0
#define STEP_K 0.85
#define FBM_OCTAVES 3
#define SEETHRU_STEPS 32
#define SEETHRU_DIST 60.0
${COMMON}`

// The index's channel: fewer steps, coarser noise, no env map, and no ending —
// the channel loops on the run itself.
export const skybridgesPreviewFrag = `
#define RM_STEPS 52
#define MAX_DIST 120.0
#define STEP_K 0.85
#define FBM_OCTAVES 2
#define SEETHRU_STEPS 8
#define SEETHRU_DIST 20.0
#define NO_BLAST
${COMMON}`
