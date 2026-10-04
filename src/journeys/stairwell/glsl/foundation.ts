import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from '@wjh/delta/glsl'
import { SEAM_HALF } from '../kinematics'
import { SATURATE } from '@wjh/glsl/color'
import { HASH11, HASH12 } from '@wjh/glsl/hash'
import { ROT, SD_BOX } from '@wjh/glsl/sdf'


export const foundationGlsl = `#version 300 es
precision highp float;
precision highp int;
${MATERIAL_GLSL}
${SURFACE_GLSL}
${SKY_GLSL}

uniform vec2 iResolution;
uniform float iTime;
uniform vec2 uPointer;
uniform float uHeavy;
uniform float uPlayerZ;
uniform float uSection;
uniform float uSectionProgress;
uniform float uLoop;
uniform float uRupture;
uniform float uDecay;
uniform float uPurgatory;
uniform float uFinale;
uniform float uPrevSection;
uniform float uNextSection;
uniform float uFarSection;

uniform sampler2D uSkyA;      // this act's sky
uniform sampler2D uSkyB;      // the next act's sky
uniform sampler2D uSkyC;      // the sky framed in the next act's far bore
uniform vec4 uSkyInfoA;       // exposure, yaw, sun intensity, haze
uniform vec4 uSkyInfoB;
uniform vec4 uSkyInfoC;
uniform vec3 uSunA;
uniform vec3 uSunB;
uniform vec3 uSunC;
uniform float uEncode;

out vec4 fragColor;

#define MAX_STEPS 120
#define FAR_CLIP 170.0
#define HIT_EPSILON 0.012
#define SEAM ${SEAM_HALF.toFixed(1)}
#define WALL_TOP 50.0

#define M_CONCRETE 1.0
#define M_STEEL 2.0
#define M_MACHINE 3.0
#define M_EMISSIVE 4.0
#define M_ROCK 5.0
#define M_TREAD 6.0
#define M_WATER 7.0
#define M_WALL 8.0

// Per-pixel constants derived from uniforms, set once in main().
float gA;        // this act
float gB;        // the next act
float gC;        // the act after that, beyond the next act's far wall
float gP;        // the previous act
float gLenA;
float gLenB;
float gLenC;
float gLenP;
vec3 gOffB;      // the next act's origin, in this act's coordinates
vec3 gOffC;      // and the one after's
float gZ0;       // this act's origin as a distance along the whole route
float gJL;       // rail height at the far seam, this act's coordinates
float gJLB;      // and at the seam after that
float gCamZ;
float gTime;

${SATURATE}
${HASH11}
${HASH12}
${ROT}

${SD_BOX}
float sdCylinderX (vec3 p, float h, float r) {
  vec2 q = vec2(length(p.yz) - r, abs(p.x) - h);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}
float sdCylinderY (vec3 p, float h, float r) {
  vec2 q = vec2(length(p.xz) - r, abs(p.y) - h);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}
float sdCylinderZ (vec3 p, float h, float r) {
  vec2 q = vec2(length(p.xy) - r, abs(p.z) - h);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}
float sdTorusY (vec3 p, vec2 t) { return length(vec2(length(p.xz) - t.x, p.y)) - t.y; }
float sdTorusX (vec3 p, vec2 t) { return length(vec2(length(p.yz) - t.x, p.x)) - t.y; }
float brace (vec3 q, float lean, vec3 b) { q.xy *= rot(lean); return sdBox(q, b); }
float benchedGround (float x, float stepW, float stepH, float slope) {
  float a = abs(x);
  return a * slope - floor(a / stepW) * stepH;
}

// The scenery's clock stops as the residue takes hold: nothing is left to run it.
float animTime () { return gTime * (1.0 - uPurgatory * 0.95); }

`
