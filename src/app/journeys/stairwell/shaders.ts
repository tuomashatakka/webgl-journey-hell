// THE STAIRWELL — six open industrial landscapes on one descending stair.
//
// GLSL ES 3.00, on WebGL2: the scene is shaded from the Δ library — every map
// of every ambientCG set, triplanar, under the act's own photographed sky — and
// the acts are joined in *space*, not in time.
//
// ---------------------------------------------------------------------------
// Seams, not crossfades
// ---------------------------------------------------------------------------
//
// The first version handed one act to the next by mixing their distance fields
// over the closing half of each act and hiding the morph behind a veil of fog.
// A mixed distance field is a blob that is neither place, and the veil meant
// half of every act was spent in soup.
//
// Now every act ends in a wall: a dam, a cliff face, a bulkhead — two hundred
// metres across and seventy high — with the stair running through a portal in
// it. The next act is *there*, beyond the wall, in its own coordinates shifted
// to meet the stair, and you see it framed in the far mouth of the tunnel long
// before you reach it. Everything that differs between two acts is decided by
// which side of the wall a ray ends on:
//
//   * a ray that hits geometry past the seam is shaded with the next act's
//     sun, sky light and air; one that hits before it, with this act's;
//   * a ray that escapes takes the next act's sky only if it crossed the seam
//     plane *below the top of the wall* — through the portal — and this act's
//     otherwise, so the sky above the wall is never split;
//   * the air is integrated in two pieces, this act's up to the seam and the
//     next act's beyond it.
//
// The stair itself is continuous across the seam: rise and run differ per act,
// so the slope is blended through the tunnel and the rail height is its
// integral, in closed form — a smoothstep integrates to u³ − u⁴/2 — which
// makes the landing exact at any z and the camera's height C¹ across the
// switch of coordinate systems. The CPU changes act when the camera passes the
// middle of the tunnel; at that instant the old act's coordinates and the new
// one's describe the same point, so nothing on screen moves.
//
// The Protean Weather Bridge's cloud volume is technically inspired by Nimitz's
// Protean Clouds (Shadertoy 3l23Rh, CC BY-NC-SA 3.0) but does not copy its
// field, constants, camera or palette. Fog is after Inigo Quilez's "Better Fog"
// (sun inscattering and extinction kept separate). Soft shadows are iq's
// penumbra estimate along the shadow ray.

import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from 'Δ/glsl'
import { PURGATORY_LENGTH, SEAM_HALF, STAIRWELL_SECTIONS } from './kinematics'


// The act lengths, from the route table: the shader must agree with the
// simulation about where every seam is, to the unit.
const ACT_LENGTH_GLSL = [
  'float actLen (float a) {',
  `  if (a > 5.5) return ${PURGATORY_LENGTH.toFixed(1)};`,
  ...STAIRWELL_SECTIONS.map(s => `  if (a < ${s.id}.5) return ${(s.end - s.start).toFixed(1)};`),
  `  return ${(STAIRWELL_SECTIONS.at(-1)!.end - STAIRWELL_SECTIONS.at(-1)!.start).toFixed(1)};`,
  '}',
].join('\n')


export const vsQuad = /* glsl */`#version 300 es
layout(location = 0) in vec2 position;
void main () {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export const fsScene = /* glsl */`#version 300 es
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

float saturate (float x) { return clamp(x, 0.0, 1.0); }
float hash11 (float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
mat2 rotate2 (float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdBox (vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
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
float brace (vec3 q, float lean, vec3 b) { q.xy *= rotate2(lean); return sdBox(q, b); }
float benchedGround (float x, float stepW, float stepH, float slope) {
  float a = abs(x);
  return a * slope - floor(a / stepW) * stepH;
}

// The scenery's clock stops as the residue takes hold: nothing is left to run it.
float animTime () { return gTime * (1.0 - uPurgatory * 0.95); }

// --- the acts' shape -----------------------------------------------------------

${ACT_LENGTH_GLSL}

// The stair pitches over as the traversals pile up: rise grows, run shortens,
// so the first traversal walks a ~13 degree flight and the fourth falls down
// something near 48.
float riseScale () { return 1.0 + uDecay * 0.45; }
float runScale () { return 1.0 / (1.0 + uDecay * 0.18); }
vec2 treadOf (float a) {
  if (a > 0.5 && a < 1.5) return vec2(0.17, 1.2);
  if (a > 1.5 && a < 2.5) return vec2(0.28, 1.55);
  if (a > 2.5 && a < 3.5) return vec2(0.31, 1.35);
  if (a > 3.5 && a < 4.5) return vec2(0.24, 1.3);
  if (a > 4.5) return vec2(0.22, 1.1);
  return vec2(0.34, 1.45);
}
float slopeOf (float a) { vec2 t = treadOf(a); return t.x * riseScale() / (t.y * runScale()); }
float runOf (float a) { return treadOf(a).y * runScale(); }

float wiggle (float a, float z) {
  if (a < 0.5) return sin(z * 0.032) * 1.2;
  if (a < 1.5) return sin(z * 0.055) * 2.1;
  if (a < 2.5) return sin(z * 0.041) * 1.5;
  if (a < 3.5) return sin(z * 0.072) * 4.4;
  if (a < 4.5) return sin(z * 0.052) * 4.8;
  return sin(z * 0.038 + uFinale * 2.0) * (2.4 + uFinale * 3.0);
}

float pathWidth (float a) {
  if (a < 0.5) return 2.6;
  if (a < 1.5) return 1.6;
  if (a < 2.5) return 2.1;
  if (a < 3.5) return 1.9;
  if (a < 4.5) return 1.8;
  return 1.7;
}

// The joined path, in this act's coordinates. See the header: slopes blend
// through each seam's tunnel by smoothstep, and the rail is that integrated.
float H (float u) { return u * u * u - 0.5 * u * u * u * u; }

float railJ (float z) {
  float sP = slopeOf(gP), sX = slopeOf(gA), sN = slopeOf(gB);
  float T = SEAM;
  float L = gLenA;
  if (z < -T) return (sP * T + 0.1875 * T * (sX - sP)) - sP * (z + T);
  if (z < T) {
    float u = (z + T) / (2.0 * T);
    return -(sP * z + (sX - sP) * 2.0 * T * (H(u) - 0.09375));
  }
  float JT = -(sP * T + 0.8125 * T * (sX - sP));
  if (z < L - T) return JT - sX * (z - T);
  float zn = z - L;
  if (zn < T) {
    float u = (zn + T) / (2.0 * T);
    return gJL - (sX * zn + (sN - sX) * 2.0 * T * (H(u) - 0.09375));
  }
  if (zn < gLenB - T) return gJL - (sX * T + 0.8125 * T * (sN - sX)) - sN * (zn - T);
  // The seam after that: the next act's far wall has to stand where it will
  // stand once the camera is in the next act, bore and all.
  float sF = slopeOf(gC);
  float zf = zn - gLenB;
  if (zf < T) {
    float u = (zf + T) / (2.0 * T);
    return gJLB - (sN * zf + (sF - sN) * 2.0 * T * (H(u) - 0.09375));
  }
  return gJLB - (sN * T + 0.8125 * T * (sF - sN)) - sF * (zf - T);
}

float pathXJ (float z) {
  float xa = wiggle(gA, z);
  float xb = wiggle(gB, z - gLenA) + gOffB.x;
  float xp = wiggle(gP, z + gLenP) - wiggle(gP, gLenP) + wiggle(gA, 0.0);
  float xc = wiggle(gC, z - gLenA - gLenB) + gOffC.x;
  float x = mix(xp, xa, smoothstep(-SEAM, SEAM, z));
  x = mix(x, xb, smoothstep(gLenA - SEAM, gLenA + SEAM, z));
  return mix(x, xc, smoothstep(gLenA + gLenB - SEAM, gLenA + gLenB + SEAM, z));
}

// An act's own straight rail and wiggle, in its own coordinates: what its
// scenery is placed against.
float pathX (float a, float z) { return wiggle(a, z); }
float pathY (float a, float z) { return -z * slopeOf(a); }

// Which act's stretch a point is in, split at the walls' midlines: -1 the act
// behind (never looked at), 0 this one, 1 the next, 2 the one after. Anything
// sampled by position is sampled in its stretch's own coordinates, which do
// not change when the camera changes act.
float zoneOf (float z) { return z < 0.0 ? -1.0 : z < gLenA ? 0.0 : z < gLenA + gLenB ? 1.0 : 2.0; }
float zoneAct (float k) { return k < -0.5 ? gP : k < 0.5 ? gA : k < 1.5 ? gB : gC; }
vec3 zoneOffset (float k) { return k < 0.5 ? vec3(0.0) : k < 1.5 ? gOffB : gOffC; }

// --- the rupture, in the field -------------------------------------------------

// liminal's getFloorCrack: a signed vein noise widened by decay and gated by a
// much lower-frequency mask so the breakage arrives in patches.
float crackField (vec3 p, float decay) {
  float d = clamp(decay * 0.15, 0.0, 0.72) * (1.0 - uPurgatory * 0.45);
  if (d < 0.05) return 0.0;
  float veins = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
  float edge = smoothstep(mix(0.003, 0.045, d), 0.0, abs(veins));
  float mask = smoothstep(0.25, 0.6, sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + d * 0.3);
  return edge * mask * d;
}

// Corruption of the field itself, bounded well under the step factor.
float fieldBoil (vec3 p) {
  float amount = uRupture * (1.0 - uPurgatory * 0.8);
  if (amount < 0.02) return 0.0;
  return sin(p.x * 24.0 + gTime * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) * 0.03 * amount;
}

// --- the stair -----------------------------------------------------------------

// A real flight, not a solid ramp: stepped treads with a nosing, a soffit a
// little under the rail line, steel stringers either side, and a balustrade of
// posts and a round top rail. Treads use the joined rail, so the steps follow
// the landing through every seam.
vec2 stair (vec3 p) {
  float px = pathXJ(p.z);
  float dx = p.x - px;
  // Each stretch keeps its own tread: run, width and step grid restart at the
  // walls' midlines, wherever the camera is.
  float k0 = zoneOf(p.z);
  float a = zoneAct(k0);
  float z0 = k0 < -0.5 ? -gLenP : zoneOffset(k0).z;
  float run = runOf(a);
  float width = pathWidth(a);
  float k = floor((p.z - z0) / run);
  float zq = z0 + run * (k + 1.0);
  float top = railJ(zq);

  // The fall's broken path: treads stop being where the eye expects them.
  if (a > 4.5 && a < 5.5) {
    float j = (hash11(k * 7.3) - 0.5) * uFinale;
    top += j * 1.2 + sin((p.z - z0) * 0.18) * uFinale * 1.4 * (1.0 - uPurgatory);
    dx -= j * 1.5;
  }

  float rail = railJ(p.z);
  float tread = max(p.y - top, abs(dx) - width);
  float soffit = (rail - 0.75) - p.y;
  float flight = max(tread, soffit);
  // Nosing: a lip proud of each riser, which is what catches the light.
  float zl = (p.z - z0) - run * (k + 1.0);
  float nose = sdBox(vec3(dx, p.y - top + 0.03, zl + 0.02), vec3(width, 0.03, 0.04));
  flight = min(flight, nose);

  // Noise is sampled in the coordinates of whichever act owns this stretch,
  // so the cracks are where they were when the camera's act changes.
  vec3 pc = p - zoneOffset(k0);
  float near = saturate(1.0 - abs(flight) * 2.6);
  flight -= crackField(pc, uDecay) * 0.16 * near;
  flight += fieldBoil(pc) * near;

  float stringer = sdBox(vec3(abs(dx) - width - 0.06, p.y - rail + 0.45, 0.0), vec3(0.06, 0.32, 1e4));
  // Posts on the stretch's own grid: on this act's they jumped at the switch
  // by however far the act's length is from a multiple of their spacing.
  vec3 postP = vec3(abs(dx) - width - 0.12, p.y - rail - 0.5, mod(p.z - z0, 1.6) - 0.8);
  float posts = sdBox(postP, vec3(0.025, 0.5, 0.025));
  float handrail = length(vec2(abs(dx) - width - 0.12, p.y - rail - 1.02)) - 0.035;
  float steel = min(stringer, min(posts, handrail));

  return steel < flight ? vec2(steel, M_STEEL) : vec2(flight, M_TREAD);
}

// --- the walls between the acts -----------------------------------------------

// A barrier at a seam: two hundred metres of wall, seventy high, with a portal
// tunnel carrying the stair through it. Its style follows the act it closes —
// the spillway ends in its own dam, the canyon in its rock.
vec2 barrier (vec3 p, float zs, float closing) {
  // Ribs and rock stand up to two units proud of the slab.
  float bound = abs(p.z - zs) - SEAM - 2.5;
  if (bound > 2.0) return vec2(bound, M_WALL);
  float px = pathXJ(p.z);
  float ry = railJ(p.z);
  vec3 q = vec3(p.x - pathXJ(zs), p.y - railJ(zs), p.z - zs);

  // Rock walls are cliffs: strata, ledges and a few octaves of ridge. Concrete
  // walls are dams: buttress ribs standing proud of the face every nine
  // metres, a setback every twelve, and a parapet along the crest.
  float isRock = (closing > 1.5 && closing < 3.5) || closing > 4.5 ? 1.0 : 0.0;
  float slab = sdBox(vec3(q.x, q.y - (WALL_TOP - 60.0), q.z), vec3(160.0, 60.0, SEAM));
  if (isRock > 0.5) {
    float strata = sin(q.y * 0.9 + sin(q.x * 0.07) * 2.0) * 0.9;
    float ridge = sin(q.x * 0.31 + sin(q.y * 0.17) * 2.0) * 1.3 + sin(q.y * 0.53 + q.x * 0.11) * 0.7;
    float ledge = smoothstep(0.7, 1.0, fract(q.y / 7.0)) * 1.4;
    slab += (ridge + strata - ledge) * 0.45;
  } else {
    vec3 r = vec3(mod(q.x + 4.5, 9.0) - 4.5, q.y, q.z + SEAM);
    float rib = sdBox(r - vec3(0.0, 10.0, -0.9), vec3(0.9, 40.0, 1.1));
    float setback = (SEAM - 0.5) * step(18.0, q.y) - 0.0;
    slab = max(slab, -(q.z + SEAM - min(setback, 0.8) * step(18.0, q.y)));
    float parapet = sdBox(vec3(q.x, q.y - WALL_TOP - 0.7, q.z + SEAM - 0.4), vec3(160.0, 0.7, 0.25));
    slab = min(slab, min(rib, parapet));
  }

  // The bore follows the stair.
  float dx = p.x - px;
  float bore = max(abs(dx) - 2.9, abs(p.y - ry - 1.5) - 3.0);
  // A portal arch on each face, slightly larger than the bore, for a reveal.
  float reveal = max(abs(dx) - 3.4, abs(p.y - ry - 1.7) - 3.3);
  reveal = max(reveal, SEAM - 0.6 - abs(q.z));
  float wall = max(slab, -min(bore, reveal));

  // Light strips in the tunnel roof, the only light inside.
  float strip = sdBox(vec3(dx, p.y - ry - 4.45, mod(q.z + 1.0, 2.0) - 1.0), vec3(0.18, 0.03, 0.6));
  strip = max(strip, abs(q.z) - SEAM + 0.5);
  if (strip < wall) return vec2(strip, M_EMISSIVE);
  return vec2(wall, M_WALL);
}

// --- the six acts --------------------------------------------------------------

// I · THE SPILLWAY THRESHOLD — mass concrete, water, a cold dawn.
vec2 spillway (vec3 p) {
  float px = pathX(0.0, p.z);
  float py = pathY(0.0, p.z);
  float zCell = mod(p.z + 9.0, 18.0) - 9.0;
  float zBay = mod(p.z + 4.5, 9.0) - 4.5;
  float dam = sdBox(p - vec3(-13.0, py + 7.0, p.z), vec3(5.5, 15.0, 130.0));
  float chute = p.y - py + 2.0 + benchedGround(p.x + 22.0, 3.4, 0.85, 0.06) * 0.5;
  chute = max(chute, -(p.x + 34.0));
  chute = max(chute, p.x + 8.0);
  float buttress = sdBox(vec3(abs(p.x + 7.0) - 3.0, p.y - py - 2.5, zCell), vec3(0.65, 5.0, 1.2));
  float penstock = sdCylinderZ(vec3(p.x - 8.5, p.y - py + 4.0, zCell), 8.0, 1.8);
  float gate = sdBox(vec3(p.x - 6.0, p.y - py - 2.0, zCell), vec3(3.6, 3.2, 0.34));
  float screw = sdCylinderY(vec3(p.x - 6.0, p.y - py - 6.4, zCell), 3.0, 0.13);
  float gantry = sdBox(vec3(p.x - 6.0, p.y - py - 9.2, zCell), vec3(4.0, 0.3, 0.55));
  float sluice = min(gate, min(screw, gantry));
  float baffle = sdBox(vec3(mod(p.x + 30.0, 4.2) - 2.1, p.y - py + 1.4, zBay), vec3(0.5, 0.9, 0.5));
  baffle = max(baffle, p.x + 12.0);
  float ground = p.y - py + 3.2;
  float concrete = min(dam, min(chute, min(buttress, min(baffle, ground))));
  float steel = min(sluice, penstock);
  float water = p.y - py + 2.55;
  water = max(water, -(p.x + 34.0));
  water = max(water, p.x + 8.5);
  vec2 r = steel < concrete ? vec2(steel, M_MACHINE) : vec2(concrete, M_CONCRETE);
  return water < r.x ? vec2(water, M_WATER) : r;
}

// II · PROTEAN WEATHER BRIDGE — nothing but structure and weather.
vec2 stormBridge (vec3 p) {
  float px = pathX(1.0, p.z);
  float py = pathY(1.0, p.z);
  float zCell = mod(p.z + 11.0, 22.0) - 11.0;
  float zTruss = mod(p.z + 2.75, 5.5) - 2.75;
  float dx = p.x - px;
  float pylons = sdBox(vec3(abs(dx) - 4.2, p.y - py - 4.0, zCell), vec3(0.28, 4.3, 0.28));
  float crosshead = sdBox(vec3(dx, p.y - py - 7.8, zCell), vec3(4.4, 0.22, 0.25));
  float sag = cos(zCell * 0.16) * 1.15;
  float cable = abs(length(vec2(abs(dx) - 4.2, p.y - py - 8.6 + sag)) - 0.06);
  float hanger = sdBox(vec3(abs(dx) - 4.2, p.y - py - 5.4, zTruss), vec3(0.04, 3.2 - sag * 0.5, 0.04));
  float chord = sdBox(vec3(abs(dx) - 3.4, p.y - py + 0.9, zCell), vec3(0.14, 0.14, 11.0));
  vec3 braceP = vec3(abs(dx) - 3.4, p.y - py + 0.35, zTruss);
  float braces = min(brace(braceP.zyx, 0.62, vec3(3.1, 0.09, 0.09)), brace(braceP.zyx, -0.62, vec3(3.1, 0.09, 0.09)));
  float slat = sdBox(vec3(abs(dx) - 3.9, mod(p.y - py - 0.4, 0.42) - 0.21, zCell), vec3(0.05, 0.06, 11.0));
  slat = max(slat, abs(p.y - py - 1.4) - 1.5);
  float pier = sdBox(vec3(dx, p.y - py + 30.0, mod(p.z + 22.0, 44.0) - 22.0), vec3(2.2, 28.0, 1.6));
  float beaconPulse = 0.14 + 0.05 * sin(animTime() * 2.1 + floor(p.z / 22.0));
  float beacon = sdBox(vec3(abs(dx) - 4.2, p.y - py - 8.4, zCell), vec3(beaconPulse));
  float steel = min(min(pylons, crosshead), min(min(cable, hanger), min(chord, min(braces, slat))));
  if (beacon < min(steel, pier)) return vec2(beacon, M_EMISSIVE);
  return pier < steel ? vec2(pier, M_CONCRETE) : vec2(steel, M_STEEL);
}

// III · THE TURBINE CANYON — rock and rotation.
vec2 turbineCanyon (vec3 p) {
  float px = pathX(2.0, p.z);
  float py = pathY(2.0, p.z);
  float zCell = mod(p.z + 14.0, 28.0) - 14.0;
  float dx = p.x - px;
  // The canyon is wide enough for its machines: walls stand back at twelve
  // metres, stratified and undercut, and the rotors stand free in front of
  // them instead of buried in the rock.
  float strata = sin(p.y * 1.6 + sin(p.z * 0.09) * 1.4) * 0.35 + sin(p.y * 4.1 + p.z * 0.3) * 0.08;
  float walls = 12.5 - abs(dx) + strata + sin(p.z * 0.05) * 1.5;
  walls = max(walls, p.y - py - 20.0 - sin(p.z * 0.031 + p.x * 0.02) * 4.0);
  float talus = p.y - (py - 3.4 + max(0.0, abs(dx) - 9.5) * 0.65);
  talus = max(talus, abs(dx) - 17.0);
  float floorRock = p.y - py + 3.6 + sin(p.x * 0.3) * sin(p.z * 0.21) * 0.3;
  vec3 rotorP = vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell);
  rotorP.yz *= rotate2(animTime() * 0.32 + hash11(floor(p.z / 28.0)) * 6.28);
  float housing = sdCylinderX(rotorP, 2.0, 3.5);
  float hub = sdCylinderX(rotorP, 2.9, 0.65);
  float blades = sdBox(rotorP, vec3(2.25, 0.16, 3.0));
  rotorP.yz *= rotate2(2.0944);
  blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));
  rotorP.yz *= rotate2(2.0944);
  blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));
  float tail = sdBox(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell + 3.4), vec3(1.1, 1.1, 2.6));
  float penstock = sdCylinderZ(vec3(abs(dx) - 11.0, p.y - py + 1.2, zCell), 13.0, 1.6);
  float gantry = sdBox(vec3(dx, p.y - py - 11.5, mod(p.z + 33.0, 66.0) - 33.0), vec3(12.5, 0.28, 0.9));
  float gantryLeg = sdBox(vec3(abs(dx) - 11.6, p.y - py - 4.0, mod(p.z + 33.0, 66.0) - 33.0), vec3(0.2, 8.0, 0.6));
  float trayY = p.y - py - 6.4 + cos((mod(p.z, 14.0) - 7.0) * 0.22) * 0.5;
  float tray = sdBox(vec3(dx + 5.4, trayY, p.z), vec3(0.42, 0.1, 200.0));
  float rock = min(min(walls, talus), floorRock);
  float pedestal = sdBox(vec3(abs(dx) - 8.5, p.y - py + 1.0, zCell + 0.6), vec3(1.6, 2.4, 3.6));
  float machine = min(min(housing, min(hub, blades)), min(tail, min(penstock, min(gantry, min(gantryLeg, min(tray, pedestal))))));
  float lamp = sdCylinderX(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell), 3.05, 0.2);
  if (lamp < min(rock, machine)) return vec2(lamp, M_EMISSIVE);
  return rock < machine ? vec2(rock, M_ROCK) : vec2(machine, M_MACHINE);
}

// IV · CONVEYOR ESCARPMENT — extraction, warm and dusty.
vec2 conveyorEscarpment (vec3 p) {
  float px = pathX(3.0, p.z);
  float py = pathY(3.0, p.z);
  float zCell = mod(p.z + 10.0, 20.0) - 10.0;
  float dx = p.x - px;
  float quarry = p.y - py + 10.0 - benchedGround(p.x, 5.0, 0.72, 0.16);
  float coneX = mod(p.x + 60.0, 40.0) - 20.0;
  float stockpile = p.y - py + 3.0 + (length(vec2(coneX, mod(p.z + 45.0, 90.0) - 45.0)) - 9.0) * 0.62;
  vec3 galleryP = vec3(dx - 7.0, p.y - py - 4.4, zCell);
  float belt = sdBox(galleryP, vec3(2.0, 0.26, 9.6));
  float roof = sdBox(vec3(galleryP.x, galleryP.y - 1.9, galleryP.z), vec3(2.2, 0.12, 9.6));
  float side = sdBox(vec3(abs(galleryP.x) - 2.1, galleryP.y - 0.9, galleryP.z), vec3(0.08, 1.0, 9.6));
  float trestle = sdBox(vec3(abs(dx - 7.0) - 1.7, p.y - py - 2.0, mod(p.z + 5.0, 10.0) - 5.0), vec3(0.2, 2.4, 0.25));
  float roller = sdCylinderX(vec3(dx - 7.0, p.y - py - 4.15, mod(p.z + 0.6, 1.2) - 0.6), 2.0, 0.16);
  vec3 wheelP = vec3(dx - 11.0, p.y - py - 4.0, mod(p.z + 25.0, 50.0) - 25.0);
  wheelP.yz *= rotate2(animTime() * 0.18);
  float wheel = sdTorusX(wheelP, vec2(4.2, 0.35));
  vec3 bucketP = wheelP;
  bucketP.yz *= rotate2(floor(atan(wheelP.z, wheelP.y) * 1.9099 + 0.5) * -0.5236);
  float bucket = sdBox(vec3(bucketP.x, bucketP.y - 4.2, bucketP.z), vec3(0.7, 0.5, 0.5));
  float boom = sdBox(vec3(dx + 9.0, p.y - py - 7.0, zCell), vec3(0.28, 7.0, 0.28));
  vec3 towerP = vec3(dx - 7.0, p.y - py - 7.0, mod(p.z + 60.0, 120.0) - 60.0);
  float tower = sdBox(towerP, vec3(2.6, 7.2, 2.6));
  tower = max(tower, -sdBox(towerP, vec3(2.2, 6.6, 2.2)));
  float rock = min(quarry, stockpile);
  float clad = min(roof, side);
  float machine = min(min(belt, trestle), min(min(roller, wheel), min(bucket, min(boom, tower))));
  if (clad < min(rock, machine)) return vec2(clad, M_STEEL);
  return rock < machine ? vec2(rock, M_ROCK) : vec2(machine, M_MACHINE);
}

// V · THE COOLING FIELD — pale, chemical, every silhouette a curve.
vec2 coolingField (vec3 p) {
  float px = pathX(4.0, p.z);
  float py = pathY(4.0, p.z);
  float zCell = mod(p.z + 21.0, 42.0) - 21.0;
  float dx = p.x - px;
  vec3 towerP = vec3(abs(dx) - 15.0, p.y - py - 8.0, zCell);
  float towerRadius = 4.4 + towerP.y * towerP.y * 0.018;
  float tower = max(abs(length(towerP.xz) - towerRadius) - 0.3, abs(towerP.y) - 10.0);
  float ang = atan(towerP.z, towerP.x);
  vec3 legP = vec3(length(towerP.xz) - 5.6, towerP.y + 9.4, sin(ang * 9.0) * 1.4);
  float legs = sdBox(legP, vec3(0.22, 1.6, 0.22));
  float pipes = 1000.0;
  for (int i = 0; i < 4; i++) {
    float o = float(i) * 0.9;
    pipes = min(pipes, sdCylinderZ(vec3(abs(dx) - 6.0 + o * 0.55, p.y - py - 0.2 - o * 0.42, zCell), 19.0, 0.34));
  }
  float loopPipe = sdTorusY(vec3(abs(dx) - 6.0, p.y - py - 1.6, zCell - 16.0), vec2(1.5, 0.34));
  float rackFrame = sdBox(vec3(abs(dx) - 6.8, p.y - py - 0.8, mod(p.z + 6.0, 12.0) - 6.0), vec3(0.14, 1.6, 0.14));
  vec3 stackP = vec3(abs(dx) - 9.0, p.y - py - 6.0, zCell);
  float stack = sdCylinderY(stackP, 6.5, 0.7 - abs(stackP.y) * 0.02);
  float bands = sdTorusY(vec3(stackP.x, mod(stackP.y + 1.0, 2.0) - 1.0, stackP.z), vec2(0.72, 0.09));
  bands = max(bands, abs(stackP.y) - 6.5);
  float valve = sdTorusY(vec3(abs(dx) - 6.0, p.y - py + 0.9, mod(p.z + 15.0, 30.0) - 15.0), vec2(0.55, 0.09));
  float fence = sdBox(vec3(abs(dx) - 3.6, p.y - py - 0.9, mod(p.z + 3.0, 6.0) - 3.0), vec3(0.05, 0.9, 0.05));
  float ground = p.y - py + 3.6;
  float pond = p.y - py + 3.4 + sin(p.x * 0.35) * 0.1;
  pond = max(pond, abs(dx) - 26.0);
  float concrete = min(tower, min(legs, ground));
  float steel = min(min(pipes, min(loopPipe, rackFrame)), min(stack, min(bands, min(valve, fence))));
  vec2 r = concrete < steel ? vec2(concrete, M_CONCRETE) : vec2(steel, M_MACHINE);
  return pond < r.x ? vec2(pond, M_WATER) : r;
}

// VI · THE SHEAR HORIZON — where the anthology stops being architecture.
vec2 shearHorizon (vec3 p) {
  float px = pathX(5.0, p.z);
  float py = pathY(5.0, p.z);
  float cell = floor((p.z + 6.0) / 12.0);
  float zCell = mod(p.z + 6.0, 12.0) - 6.0;
  float dx = p.x - px;
  float angle = (hash11(cell * 4.7) - 0.5) * (0.4 + uRupture * 1.4);
  vec3 shardP = vec3(abs(dx) - 7.0 - hash11(cell) * 7.0, p.y - py - 3.0, zCell);
  shardP.xy *= rotate2(angle + uFinale * sin(cell) * 1.2);
  float shard = sdBox(shardP, vec3(2.8 + hash11(cell + 2.0) * 3.0, 0.5, 5.0));
  float sCell = floor((p.z + 19.0) / 38.0);
  vec3 slabP = vec3(dx + (hash11(sCell) - 0.5) * 26.0, p.y - py + 6.0 - hash11(sCell + 4.0) * 16.0, mod(p.z + 19.0, 38.0) - 19.0);
  slabP.xy *= rotate2((hash11(sCell + 7.0) - 0.5) * 2.2);
  float slab = sdBox(slabP, vec3(7.0, 0.42, 9.0));
  float fCell = floor((p.z + 8.0) / 16.0);
  vec3 fragP = vec3(dx - (hash11(fCell + 2.0) - 0.5) * 30.0, p.y - py - 2.0 - hash11(fCell + 11.0) * 14.0, mod(p.z + 8.0, 16.0) - 8.0);
  fragP.xy *= rotate2(hash11(fCell + 3.0) * 3.0 + uFinale);
  float tread = sdBox(vec3(fragP.x, mod(fragP.y + 0.35, 0.7) - 0.35, fragP.z), vec3(1.6, 0.09, 0.42));
  float frag = max(tread, sdBox(fragP, vec3(1.7, 2.2, 3.0)));
  vec3 ringP = vec3(dx, p.y - py - 12.0, mod(p.z + 40.0, 80.0) - 40.0);
  ringP.xy *= rotate2(0.7 + uFinale * 0.8);
  float ring = sdTorusX(ringP, vec2(13.0, 0.6));
  float monolith = sdBox(vec3(abs(dx) - 18.0, p.y - py - 7.0, zCell), vec3(2.0, 11.0, 3.5));
  float rift = max(abs(p.y - py + 14.0) - 0.35, abs(dx) - 40.0);
  float lit = min(ring, rift);
  float solid = min(shard, min(slab, min(frag, monolith)));
  return lit < solid ? vec2(lit, M_EMISSIVE) : vec2(solid, M_ROCK);
}

vec2 actEnvironment (vec3 p, float a) {
  if (a < 0.5) return spillway(p);
  if (a < 1.5) return stormBridge(p);
  if (a < 2.5) return turbineCanyon(p);
  if (a < 3.5) return conveyorEscarpment(p);
  if (a < 4.5) return coolingField(p);
  return shearHorizon(p);
}

// Purgatory's geometry is not a seventh place: it is the six recurring as
// ghosts on a slow cycle, pushed back and thickened, one material.
vec2 residue (vec3 p, float z0) {
  // Cycled on distance along the whole route, so a ghost is the same ghost
  // seen from either side of a seam.
  float cycle = mod(floor((p.z + z0) / 88.0), 6.0);
  vec3 q = p;
  q.x += sin(p.z * 0.021) * 3.2;
  q.y -= 1.1;
  vec2 ghost = actEnvironment(q, cycle);
  return vec2(ghost.x * 0.86 + 1.3, M_CONCRETE);
}

vec2 environment (vec3 p, float a, float z0) {
  if (a > 5.5) return residue(p, z0);
  return actEnvironment(p, a);
}

vec2 debris (vec3 p) {
  if (uRupture < 0.05 || uPurgatory > 0.75) return vec2(1000.0, M_MACHINE);
  // Cells on distance along the route, not along this act: the same piece of
  // debris either side of a seam.
  float gz = p.z + gZ0;
  float cell = floor((gz + 4.0) / 8.0);
  float zCell = mod(gz + 4.0, 8.0) - 4.0;
  float side = sign(sin(cell * 4.13));
  float x = pathXJ(p.z) + side * (5.0 + hash11(cell) * 11.0);
  float y = railJ(p.z) + 2.0 + hash11(cell + 9.0) * 10.0;
  vec3 q = p - vec3(x, y, p.z - zCell);
  q.xy *= rotate2(gTime * 0.07 * side + hash11(cell + 3.0) * 3.0);
  float d = sdBox(q, vec3(0.25 + hash11(cell) * 1.1, 0.18, 1.2 + hash11(cell + 2.0) * 2.5));
  return vec2(d, hash11(cell + 6.0) > 0.92 ? M_EMISSIVE : M_MACHINE);
}

// The whole scene, in this act's coordinates: (distance, material). Whose
// light, coordinates and material a hit takes follows from where it is.
vec2 mapScene (vec3 p) {
  vec2 res = stair(p);

  // The scenery of whichever act's stretch p is in, in that act's own
  // coordinates: one environment call however many acts are in view. The
  // next act's far wall has to be standing before the camera gets to it, and
  // so does whatever is framed in its bore. A shear band displaces the
  // scenery as the rupture grows: the world leans as well as cracks.
  float k = max(zoneOf(p.z), 0.0);
  vec3 o = zoneOffset(k);
  float len = k < 0.5 ? gLenA : k < 1.5 ? gLenB : gLenC;
  vec3 q = p - o;
  float band = floor((q.z + 13.0) / 26.0);
  vec3 w = q;
  w.x += sin(q.z * 0.11 + band) * uRupture * 1.8;
  w.y += (hash11(band) - 0.5) * uRupture * 2.0;
  vec2 e = environment(w, zoneAct(k), gZ0 + o.z);
  // Scenery stops at the walls' faces: inside a seam there is only the wall
  // and its bore. (A quarry's stockpile happens to sit on the path at an act's
  // origin, and filled the tunnel until it did.)
  e.x = max(e.x, max(q.z - (len - SEAM), SEAM - q.z));
  // The neighbouring stretches' scenery starts a wall's half-width past the
  // midlines, which keeps the split a bound on the distance to that as well.
  float nb = 1e4;
  if (k < 1.5) nb = len + SEAM - q.z;
  if (k > 0.5) nb = min(nb, q.z + SEAM);
  e.x = min(e.x, nb);
  if (e.x < res.x) res = e;

  // The walls: behind, at the far seam, and at the next act's far seam.
  vec2 wall = barrier(p, 0.0, gP);
  vec2 far = barrier(p, gLenA, gA);
  if (far.x < wall.x) wall = far;
  far = barrier(p, gLenA + gLenB, gB);
  if (far.x < wall.x) wall = far;
  if (wall.x < res.x) res = wall;

  vec2 d = debris(p);
  if (d.x < res.x) res = d;

  // A machine face that has stopped being one: rift light where steel was.
  if (uDecay >= 1.0 && res.y > 2.5 && res.y < 3.5) {
    vec3 pc = p - zoneOffset(zoneOf(p.z));
    float v = hash21(floor(pc.xz * 0.6) + floor(pc.y * 0.5));
    if (v > 0.97 - clamp(uDecay * 0.05, 0.0, 0.16)) res.y = M_EMISSIVE;
  }

  // The walked tube: nothing may enter it, by construction.
  float safe = length(p.xy - vec2(pathXJ(p.z), railJ(p.z) + 1.5)) - 0.78;
  res.x = max(res.x, -safe);
  return res;
}

float mapD (vec3 p) { return mapScene(p).x; }

vec3 calcNormal (vec3 p) {
  vec2 e = vec2(0.0022, -0.0022);
  return normalize(e.xyy * mapD(p + e.xyy) + e.yyx * mapD(p + e.yyx) +
                   e.yxy * mapD(p + e.yxy) + e.xxx * mapD(p + e.xxx));
}

float ambientOcclusion (vec3 p, vec3 n) {
  float a = 0.0, w = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.06 + float(i) * 0.22;
    a += (h - mapD(p + n * h)) * w;
    w *= 0.6;
  }
  return saturate(1.0 - a * 1.4);
}

// iq's soft shadow: the closest the shadow ray came to anything, over distance.
float softShadow (vec3 ro, vec3 rd, float k) {
  float res = 1.0;
  float t = 0.06;
  for (int i = 0; i < 40; i++) {
    if (uHeavy < 0.5 && i >= 20) break;
    float h = mapD(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.06, 3.0);
    if (res < 0.02 || t > 70.0) break;
  }
  return saturate(res);
}

// --- sky, air, cloud -------------------------------------------------------------

// Both skies are looked up for every pixel, in uniform control flow, and the
// owner only selects between the results: skyTexel takes derivatives, and a
// derivative inside a branch on whether a ray hit something is undefined.
vec3 skyOf (float owner, vec3 rd) {
  vec3 a = skyRadiance(skyTexel(uSkyA, rd, uSkyInfoA.y), uSkyInfoA.x);
  vec3 b = skyRadiance(skyTexel(uSkyB, rd, uSkyInfoB.y), uSkyInfoB.x);
  vec3 f = skyRadiance(skyTexel(uSkyC, rd, uSkyInfoC.y), uSkyInfoC.x);
  vec3 c = owner < 0.5 ? a : owner < 1.5 ? b : f;
  // The rift: a horizontal slit of light along the floor of the world.
  float rift = exp(-abs(rd.y + 0.05 + sin(rd.x * 8.0) * 0.05) * 55.0);
  c += vec3(0.20, 0.55, 1.0) * rift * uRupture * (0.25 + uFinale * 2.0);
  return c;
}

// The air's colour is the sky's own horizon in that direction, so the haze
// matches the photograph rather than a constant someone picked.
vec3 hazeOf (float owner, vec3 rd) {
  vec3 h = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.4 + 0.04, rd.z));
  vec3 c = owner < 0.5
    ? textureLod(uSkyA, equirectUv(h, uSkyInfoA.y), 5.5).rgb * uSkyInfoA.x
    : owner < 1.5
    ? textureLod(uSkyB, equirectUv(h, uSkyInfoB.y), 5.5).rgb * uSkyInfoB.x
    : textureLod(uSkyC, equirectUv(h, uSkyInfoC.y), 5.5).rgb * uSkyInfoC.x;
  vec3 sun = owner < 0.5 ? uSunA : owner < 1.5 ? uSunB : uSunC;
  float si = owner < 0.5 ? uSkyInfoA.z : owner < 1.5 ? uSkyInfoB.z : uSkyInfoC.z;
  c += vec3(1.0, 0.82, 0.62) * pow(max(dot(rd, sun), 0.0), 9.0) * si * 0.12;
  return c;
}

float hazeDensity (float a) {
  if (a > 5.5) return 0.022;
  if (a < 0.5) return 0.0055;
  if (a < 1.5) return 0.011;
  if (a < 2.5) return 0.004;
  if (a < 3.5) return 0.0045;
  if (a < 4.5) return 0.0055;
  return 0.005;
}

float cloudField (vec3 p) {
  p *= 0.17;
  float sum = 0.0, amp = 0.58;
  for (int i = 0; i < 4; i++) {
    vec3 warp = sin(p.yzx * 1.37 + gTime * vec3(0.19, 0.13, 0.16));
    sum += abs(dot(sin(p + warp * 0.45), cos(p.zxy * 1.11))) * amp;
    p.xy *= rotate2(0.82 + float(i) * 0.17);
    p.yz *= rotate2(-0.54 + float(i) * 0.11);
    p = p * 1.68 + vec3(1.7, -1.1, 0.8);
    amp *= 0.52;
  }
  return sum;
}

// The weather bridge's cloud deck, only inside act II's span (in whichever
// coordinates it currently has), lit by that act's sun.
vec4 marchClouds (vec3 ro, vec3 rd, float maxD) {
  // The deck lies along act II's own descent, in act II's own coordinates,
  // wherever act II is in view — this act, the next, or framed in the next
  // one's far bore: the same cloud in the same place either side of every
  // seam. Like the scenery it stops at the walls' faces; it used to run on
  // into the tunnels, and vanish from them at the switch.
  vec3 off, sun;
  if (gA > 0.5 && gA < 1.5) { off = vec3(0.0); sun = uSunA; }
  else if (gB > 0.5 && gB < 1.5) { off = gOffB; sun = uSunB; }
  else if (gC > 0.5 && gC < 1.5) { off = gOffC; sun = uSunC; }
  else return vec4(0.0);
  float len = actLen(1.0);
  float live = max(1.0 - uPurgatory, 0.0);
  vec4 acc = vec4(0.0);
  float t = 2.0;
  for (int i = 0; i < 56; i++) {
    if (uHeavy < 0.5 && i >= 28) break;
    if (t > maxD || acc.a > 0.97) break;
    vec3 p = ro + rd * t;
    vec3 q = p - off;
    if (q.z > SEAM && q.z < len - SEAM) {
      q.x += sin(q.z * 0.025 + gTime * 0.11) * 5.0;
      float layer = abs(q.y - (pathY(1.0, q.z) - 3.5));
      float envelope = 1.0 - smoothstep(1.5, 8.0, layer);
      float shape = cloudField(q) - 0.80 + envelope * 0.12 + sin(q.x * 0.16 + q.z * 0.07) * 0.2;
      float dens = smoothstep(0.02, 0.5, shape) * envelope * live;
      if (dens > 0.01) {
        float l = saturate((shape - cloudField(q + sun * 1.4)) * 1.6 + 0.4);
        vec3 c = mix(vec3(0.16, 0.22, 0.26), vec3(1.0, 0.95, 0.88), l) * (0.35 + l * 1.4);
        c = mix(c, vec3(0.62, 0.22, 0.13), uRupture * 0.5);
        float a = dens * 0.09;
        acc.rgb += c * a * (1.0 - acc.a);
        acc.a += a * (1.0 - acc.a);
      }
      t += mix(0.8, 0.22, dens);
    }
    else t += 1.5;
  }
  return acc;
}

// --- materials -----------------------------------------------------------------

// Which Δ layer a hit is drawn from, and how it is tinted, by material and act.
void materialOf (float m, float a, out float layer, out vec3 tint, out float rough) {
  rough = 1.0;
  tint = vec3(1.0);
  if (m < 1.5) {                       // concrete
    layer = a > 3.5 && a < 4.5 ? MAT_PANEL : MAT_CONCRETE;
    tint = a < 0.5 ? vec3(0.82, 0.84, 0.86) : a > 3.5 && a < 4.5 ? vec3(1.0, 0.98, 0.95) : vec3(0.78);
  } else if (m < 2.5) {                // structural steel
    layer = a > 2.5 && a < 3.5 ? MAT_CORRUGATED : MAT_STEEL;
    tint = a > 2.5 && a < 3.5 ? vec3(0.78, 0.55, 0.36) : vec3(0.62, 0.66, 0.68);
  } else if (m < 3.5) {                // machine
    layer = a > 2.5 && a < 3.5 ? MAT_HAZARD : MAT_STEEL;
    tint = a < 2.5 ? vec3(0.42, 0.58, 0.58) : a > 2.5 && a < 3.5 ? vec3(0.9) : vec3(0.85, 0.5, 0.26);
  } else if (m < 5.5) {                // rock
    layer = a > 2.5 && a < 3.5 ? MAT_DIRT : MAT_ROCK;
    tint = a > 4.5 ? vec3(0.32, 0.30, 0.36) : a > 2.5 && a < 3.5 ? vec3(0.95, 0.78, 0.6) : vec3(0.85, 0.76, 0.68);
  } else if (m < 6.5) {                // treads
    layer = (a > 0.5 && a < 1.5) || a > 4.5 ? MAT_STEEL : MAT_CONCRETE;
    tint = vec3(0.72);
  } else {                             // the barrier walls
    layer = (a > 1.5 && a < 3.5) || a > 4.5 ? MAT_ROCK : MAT_PANEL;
    tint = a > 4.5 ? vec3(0.3) : vec3(0.8);
  }
}

vec3 aces (vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main () {
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  gTime = mod(iTime, 3600.0);
  // The neighbours come from the simulation, which knows that the fourth
  // shear horizon opens on the residue rather than on the spillway.
  gA = uSection;
  gB = uNextSection;
  gC = uFarSection;
  gP = uPrevSection;
  gLenA = actLen(gA);
  gLenB = actLen(gB);
  gLenC = actLen(gC);
  gLenP = actLen(gP);
  // The far seam's rail height and the next act's origin. railJ reads gJL in
  // its far branch, but the value is only needed there and is computed from
  // the near branches, so the order here is safe.
  {
    float sP = slopeOf(gP), sX = slopeOf(gA), sN = slopeOf(gB);
    float T = SEAM;
    float JT = -(sP * T + 0.8125 * T * (sX - sP));
    gJL = JT - sX * (gLenA - 2.0 * T) - sX * T - 0.1875 * T * (sN - sX);
    // The same again from the next act's origin, one act further on.
    float sF = slopeOf(gC);
    gJLB = gJL - (sX * T + 0.8125 * T * (sN - sX)) - sN * (gLenB - 2.0 * T) - sN * T -
           0.1875 * T * (sF - sN);
  }
  gOffB = vec3(wiggle(gA, gLenA) - wiggle(gB, 0.0), gJL, gLenA);
  gOffC = vec3(gOffB.x + wiggle(gB, gLenB) - wiggle(gC, 0.0), gJLB, gLenA + gLenB);
  gCamZ = uSectionProgress * gLenA;
  gZ0 = uPlayerZ - gCamZ;

  float bob = sin(gTime * 5.2) * 0.035 * (1.0 - uFinale * 0.65);
  vec3 ro = vec3(pathXJ(gCamZ), railJ(gCamZ) + 1.68 + bob, gCamZ);
  float lookZ = gCamZ + 10.0;
  vec3 target = vec3(pathXJ(lookZ), railJ(lookZ) + 1.35, lookZ);
  vec3 forward = normalize(target - ro);
  forward.y -= uFinale * 0.62;
  forward = normalize(forward);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  right.xy *= rotate2(uFinale * 0.18 * sin(gTime * 0.43));
  up = cross(right, forward);
  vec3 rd = normalize(uv.x * right + uv.y * up + mix(1.28, 0.78, uFinale) *
                      (forward + right * uPointer.x * 0.42 + up * uPointer.y * 0.32));

  float t = 0.0;
  vec2 hit = vec2(0.0);
  bool found = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (uHeavy < 0.5 && i >= 80) break;
    vec2 h = mapScene(ro + rd * t);
    if (h.x < HIT_EPSILON * (1.0 + t * 0.02)) { hit = h; found = true; break; }
    t += h.x * 0.75;
    if (t > FAR_CLIP) break;
  }
  if (!found) t = FAR_CLIP;

  // Which side of the far seam the ray ends on; for a ray that escapes, it is
  // the far side only if it went *through* the wall, below its top.
  float tSeam = rd.z > 1e-4 ? (gLenA - ro.z) / rd.z : 1e9;
  float tSeamB = rd.z > 1e-4 ? (gLenA + gLenB - ro.z) / rd.z : 1e9;
  // Everything else about a hit follows from where it is. owner, whose sun,
  // sky and air: the stretch's past each wall's midline; a ray that escapes
  // takes the sky beyond a wall only if it went *through* it, below its top.
  // zone, whose coordinates and material: the stretch the hit is in. A wall is drawn in
  // the coordinates of the act beyond it, which become the current ones as
  // the camera passes through, so a tunnel does not change pattern under it,
  // and in the material of the act it closes.
  vec3 pAll = ro + rd * t;
  float owner = 0.0;
  if (found) owner = pAll.z < gLenA ? 0.0 : pAll.z < gLenA + gLenB ? 1.0 : 2.0;
  else if (tSeam < FAR_CLIP && ro.y + rd.y * tSeam < railJ(gLenA) + WALL_TOP) {
    owner = 1.0;
    if (tSeamB < FAR_CLIP && ro.y + rd.y * tSeamB < railJ(gLenA + gLenB) + WALL_TOP) owner = 2.0;
  }
  float zone = zoneOf(pAll.z);
  float act = zoneAct(zone);
  if (found && hit.y > 7.5) {
    zone = pAll.z < 0.5 * gLenA ? 0.0 : pAll.z < gLenA + 0.5 * gLenB ? 1.0 : 2.0;
    act = zoneAct(zone - 1.0);
  }
  vec3 sun = owner < 0.5 ? uSunA : owner < 1.5 ? uSunB : uSunC;
  vec4 info = owner < 0.5 ? uSkyInfoA : owner < 1.5 ? uSkyInfoB : uSkyInfoC;

  // Everything that needs a derivative is taken here, before the branch.
  vec3 skyCol = skyOf(owner, rd);
  vec3 dpx = dFdx(pAll);
  vec3 dpy = dFdy(pAll);

  vec3 col;
  if (found) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 V = -rd;
    float m = hit.y;

    if (m > 3.5 && m < 4.5) {
      // Emissive: tunnel strips warm, everything else the rift's cold light.
      bool tunnel = abs(p.z - gLenA) < SEAM + 1.0 || abs(p.z) < SEAM + 1.0 ||
                    abs(p.z - gLenA - gLenB) < SEAM + 1.0;
      col = tunnel ? vec3(3.2, 2.6, 1.9)
                   : vec3(0.06, 0.42, 0.9) * (1.0 + sin(gTime * 4.0 + p.z + gZ0) * 0.25);
    } else {
      Surface s;
      // Purgatory is one material and no colour.
      if (m > 6.5 && m < 7.5) {
        // Water: a dark, rippled mirror of its own sky.
        s.albedo = vec3(0.02, 0.03, 0.03);
        vec3 wp = p - zoneOffset(zone);
        s.normal = normalize(n + vec3(sin(wp.x * 2.1 + gTime * 1.3), 0.0, cos(wp.z * 1.7 - gTime)) * 0.025);
        s.rough = 0.06;
        s.metal = 0.0;
        s.ao = 1.0;
        s.height = 0.5;
      } else {
        float layer; vec3 tint; float rmul;
        materialOf(m, act, layer, tint, rmul);
        // Coordinates for the texture: this act's own, so a pattern does not
        // slide when the camera changes act.
        vec3 tp = p - zoneOffset(zone);
        s = sampleTriplanarGrad(layer, tp, n, 4.0, dpx, dpy);
        s.albedo *= tint;
        // The displacement map does two jobs here: crevices hold dirt and
        // shadow (height-weighted occlusion), and on rock and ground it
        // decides where the second material shows through.
        s.ao *= mix(0.55, 1.0, s.height);
        if (m > 4.5 && m < 5.5) {
          float dirt = smoothstep(0.42, 0.25, s.height + (n.y - 0.6) * 0.4);
          s.albedo = mix(s.albedo, s.albedo * vec3(0.62, 0.54, 0.46), dirt);
        }
        s.rough = clamp(s.rough * rmul, 0.04, 1.0);
      }
      if (uPurgatory > 0.8) s.albedo = vec3(dot(s.albedo, vec3(0.3, 0.59, 0.11)));

      float ao = ambientOcclusion(p, n);
      float sh = softShadow(p + n * 0.03, sun, 9.0);
      float sunI = info.z * (1.0 - uPurgatory * 0.85);

      col = shadeBrdf(s, V, sun) * vec3(1.0, 0.93, 0.82) * sunI * sh;
      // Sky fill: a fifth of the sun on a clear day, as it is outdoors; what
      // makes an overcast act soft is that its sun term is small, not that
      // its sky term is large.
      vec3 irr = (owner < 0.5 ? skyIrradiance(uSkyA, s.normal, info.y, info.x)
                : owner < 1.5 ? skyIrradiance(uSkyB, s.normal, info.y, info.x)
                              : skyIrradiance(uSkyC, s.normal, info.y, info.x)) * 0.8;
      // Bounce from the sunlit ground below.
      irr += vec3(0.32, 0.28, 0.22) * sunI * 0.08 * saturate(-s.normal.y * 0.5 + 0.5);
      vec3 R = reflect(rd, s.normal);
      vec2 ruv = equirectUv(R, info.y);
      float rlod = 1.0 + s.rough * 7.0;
      vec3 refl = (owner < 0.5 ? textureLod(uSkyA, ruv, rlod).rgb
                 : owner < 1.5 ? textureLod(uSkyB, ruv, rlod).rgb
                               : textureLod(uSkyC, ruv, rlod).rgb) * info.x;
      col += shadeAmbient(s, V, irr, refl, ao);

      // Inside a seam's tunnel, the strip lights are what you see by.
      float inTunnel = 1.0 - smoothstep(SEAM - 1.0, SEAM + 3.0,
        min(min(abs(p.z - gLenA), abs(p.z)), abs(p.z - gLenA - gLenB)));
      if (inTunnel > 0.0) {
        float ry = railJ(p.z);
        vec3 L = normalize(vec3(pathXJ(p.z), ry + 4.4, p.z) - p);
        float d = length(vec3(pathXJ(p.z), ry + 4.4, p.z) - p);
        col += shadeBrdf(s, V, L) * vec3(3.2, 2.6, 1.9) * inTunnel / (d * d * 0.35 + 1.0) * ao;
      }

      // Cracks: cold rift blue on the first traversal, crossfading to
      // liminal's furnace core as the decay climbs. Mixed in, never added.
      vec3 cp = p - zoneOffset(zone);
      float fracture = abs(sin(cp.x * 2.8 + sin(cp.z * 0.7)) * cos(cp.y * 2.2 + cp.z));
      float crack = smoothstep(0.02 + uRupture * 0.035, 0.0, fracture) * uRupture;
      float heat = saturate(uDecay * 0.28);
      vec3 crackHot = vec3(1.5, 0.12, 0.02) * (1.0 + 2.0 * heat);
      col += mix(vec3(0.05, 0.3, 0.7), crackHot * 0.5, heat) * crack * (0.1 + uFinale * 0.6);
      col = mix(col, crackHot * 0.5, saturate(crackField(cp, uDecay) * 0.55));
    }
  } else {
    col = skyCol;
  }

  // The air, in two pieces: this act's up to the far seam, the next act's past it.
  float dA = owner < 0.5 ? t : min(t, tSeam);
  float dB = owner < 0.5 ? 0.0 : max((owner < 1.5 ? t : min(t, tSeamB)) - tSeam, 0.0);
  float dC = owner < 1.5 ? 0.0 : max(t - tSeamB, 0.0);
  float denA = hazeDensity(gA) + uPurgatory * 0.03;
  float denB = hazeDensity(gB) + uPurgatory * 0.03;
  float denC = hazeDensity(gC) + uPurgatory * 0.03;
  // Height falloff: the haze lies in the low ground, so a ray climbing
  // toward the sky passes through less of it than one looking down the flight.
  float lift = exp(-max(rd.y, 0.0) * 3.0);
  float trA = exp(-denA * dA * lift);
  float trB = exp(-denB * dB * lift);
  float trC = exp(-denC * dC * lift);
  if (!found) { trA = mix(1.0, trA, 0.25); trB = mix(1.0, trB, 0.25); trC = mix(1.0, trC, 0.25); }
  col = ((col * trC + hazeOf(2.0, rd) * (1.0 - trC)) * trB + hazeOf(1.0, rd) * (1.0 - trB)) * trA +
        hazeOf(0.0, rd) * (1.0 - trA);

  vec4 clouds = marchClouds(ro, rd, min(t, FAR_CLIP));
  col = col * (1.0 - clouds.a) + clouds.rgb;

  // The residue takes the whole image with it: colour drains, blacks close.
  if (uPurgatory > 0.001) {
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(luma), uPurgatory * 0.88);
    vec3 c = clamp(col, 0.0, 1.0);
    col = mix(col, c * c * (3.0 - 2.0 * c), uPurgatory * 0.6);
    col *= 1.0 - uPurgatory * 0.20;
  }

  col *= 1.0 - uFinale * 0.18 + sin(gTime * 19.0) * uFinale * 0.025;
  col = max(col, 0.0);
  if (uEncode > 0.5) col = col / (1.0 + col);
  fragColor = vec4(col, 1.0);
}
`

export const fsPost = /* glsl */`#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec2 iResolution;
uniform float iTime;
uniform float uHeavy;
uniform float uRupture;
uniform float uDecay;
uniform float uPurgatory;
uniform float uFinale;
uniform float uDecode;
uniform float uExposure;

out vec4 fragColor;

float hash21 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 fetch (vec2 uv, float lod) {
  vec3 c = textureLod(uTexture, uv, lod).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

vec3 aces (vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main () {
  float t = mod(iTime, 3600.0);
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  vec2 center = uv - 0.5;
  float r2 = dot(center, center);
  vec2 warped = uv + center * r2 * mix(0.03, 0.12, uFinale);

  // How much of the image has gone: continuous in uDecay, calmed by the
  // residue (liminal's calm term), so the quiet end is quiet.
  float damage = (clamp(uDecay * 0.16, 0.0, 0.52) + uFinale * 0.42) * (1.0 - uPurgatory * 0.78);

  // liminal's two-tier interference: a hash-gated band displacement, and,
  // independently, an injected red flash.
  float band = floor(warped.y * 38.0 + t * 8.0);
  float glitch = step(0.92 - uRupture * 0.11 - uFinale * 0.18, hash21(vec2(band, floor(t * 7.0))));
  warped.x += (hash21(vec2(band, 17.0)) - 0.5) * glitch * (0.012 + uFinale * 0.045) * (1.0 - uPurgatory * 0.85);
  float fineBand = floor(warped.y * 28.0 + t * 35.0);
  if (hash21(vec2(fineBand, 91.0)) < damage * 0.25)
    warped.x += (hash21(vec2(fineBand, 15.0)) - 0.5) * damage * 0.07;

  float caScale = 0.012 + uRupture * 0.05 + uFinale * 0.08;
  if (uFinale > 0.5) {
    float tG = t * 65.0;
    warped += vec2(sin(tG * 1.5) * 0.012 * step(0.72, sin(tG)), cos(tG * 0.9) * 0.008 * step(0.82, cos(tG * 1.1)));
    caScale *= 2.2;
  }
  vec2 ca = center * (r2 + 0.02) * caScale;
  vec3 color;
  color.r = fetch(warped - ca, 0.0).r;
  color.g = fetch(warped, 0.0).g;
  color.b = fetch(warped + ca, 0.0).b;

  // Bloom from the scene's own mip chain: the wider levels, thresholded.
  vec3 bloom = vec3(0.0);
  for (int i = 2; i <= 6; i++) {
    if (uHeavy < 0.5 && i > 4) break;
    vec3 b = fetch(warped, float(i));
    bloom += max(b - 1.0, 0.0) * (0.6 / float(i));
  }
  color += bloom * 0.6;

  if (hash21(vec2(floor(t * 18.0), 3.0)) < damage * 0.18)
    color += vec3(0.18, 0.01, 0.02) * damage * sin(warped.y * 30.0);

  color *= uExposure;
  color = aces(color);
  // A gentle print curve: a little more saturation and a little more bite in
  // the mids, the way film handles a grey industrial morning.
  float luma0 = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma0), color, 1.12);
  color = mix(color, color * color * (3.0 - 2.0 * color), 0.25);
  color *= mix(0.55, 1.0, smoothstep(0.80, 0.22, length(center)));
  if (uPurgatory > 0.001) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma * 1.04), uPurgatory * 0.7);
  }
  color *= 1.0 - smoothstep(0.82, 1.0, uFinale) * 0.22;
  color = pow(color, vec3(1.0 / 2.2));
  color += (hash21(gl_FragCoord.xy + fract(t) * 71.0) - 0.5) * 0.03;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`

// perf: one sdf march (120/80 steps by quality), a 40/20-step soft shadow and a
// 4-tap AO at the hit, triplanar Δ sampling once per pixel; clouds only in act II.
