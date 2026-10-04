// SKYBRIDGES — a first-person run across nine themed glass skybridges suspended
// over a cloud sea, skyscrapers rising from the haze in the distance. One
// unbroken journey: the path climbs, drops, leaps onto a train, falls, and is
// caught — each section a distinct scene placed in its own world-Z band. See
// SPEC.md in this directory for the full design.
//
// Single-pass raymarch via lib/gl/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only, no dynamic array indexing. Uniforms:
// iResolution, iTime, uPointer, uHeavy (heavyEffects -> see-through glass),
// uEnv (equirect env), uEnvLoaded.

import { foundationGlsl } from './glsl/foundation'
import { structuresGlsl } from './glsl/structures'
import { materialsGlsl } from './glsl/materials'
import { cameraGlsl } from './glsl/camera'


const COMMON = foundationGlsl + structuresGlsl + materialsGlsl + cameraGlsl

// Full-quality variant used by the route page (env map bound; see-through on
// when heavyEffects is enabled).
export const skybridgesFrag = `
#define RM_STEPS 76
#define MAX_DIST 160.0
#define STEP_K 0.62
#define SHX 3
#define SHZ 3
#define TWX 2
#define TWY 2
#define TWZ 2
#define SCENE_TOWERS 2
#define SEETHRU_STEPS 12
#define SEETHRU_DIST 30.0
#define FBM_OCTAVES 3
${COMMON}`

// Cheaper hover-thumbnail variant: fewer steps, coarser noise, shorter
// see-through march. No env map bound -> procedural sky fallback.
export const skybridgesPreviewFrag = `
#define RM_STEPS 50
#define MAX_DIST 115.0
#define STEP_K 0.58
#define SHX 2
#define SHZ 2
#define TWX 2
#define TWY 2
#define TWZ 2
#define SCENE_TOWERS 2
#define SEETHRU_STEPS 8
#define SEETHRU_DIST 22.0
#define FBM_OCTAVES 2
${COMMON}`

// perf: one fullscreen draw call; no persistent geometry buffers; shader cost is
// medium/high and bounded by the compile-time ray, refraction, shard, and tower grids.
