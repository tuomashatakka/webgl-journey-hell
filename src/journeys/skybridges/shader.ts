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

// The lighter builds, heaviest first: a phone takes the first its compiler
// will link. Phone compilers unroll every loop and inline every call, and an
// Adreno that runs the index channel happily would not link the full build
// with the detonation in it. Each step down drops one thing:
//   lite   fewer steps and octaves, no blast crazing;
//   min    the index channel's budgets;
//   glass  no crazing and no burning floors;
//   plain  no pressure-wave wall, glare or afterimage, the cloud as reflections see it.
// The last resort after these is the index channel itself, with no ending.
const SMALL = `
#define RM_STEPS 52
#define MAX_DIST 120.0
#define STEP_K 0.85
#define FBM_OCTAVES 2
#define SEETHRU_STEPS 8
#define SEETHRU_DIST 20.0
#define LITE`

const skybridgesLiteFrag = `
#define RM_STEPS 64
#define MAX_DIST 150.0
#define STEP_K 0.85
#define FBM_OCTAVES 2
#define SEETHRU_STEPS 16
#define SEETHRU_DIST 40.0
#define LITE
${COMMON}`

export const skybridgesLighter = [
  skybridgesLiteFrag,
  `${SMALL}\n${COMMON}`,
  `${SMALL}\n#define PLAIN_GLASS\n${COMMON}`,
  `${SMALL}\n#define PLAIN_GLASS\n#define PLAIN_BLAST\n${COMMON}`,
] as const

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

// Past the index channel: the same, on smaller and smaller budgets. Nothing
// should ever get here; if a phone does, its screen still shows the run, and a
// failure that reaches the end of these says the trouble is not size.
const lastResort = (steps: number, octaves: number) => `
#define RM_STEPS ${steps}
#define MAX_DIST 90.0
#define STEP_K 0.9
#define FBM_OCTAVES ${octaves}
#define SEETHRU_STEPS 1
#define SEETHRU_DIST 1.0
#define NO_BLAST
${COMMON}`

export const skybridgesLastResort = [ lastResort(28, 1), lastResort(12, 1) ] as const
