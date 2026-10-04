import { brdfChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './common'

// ---------------------------------------------------------------------------
// the swept road
// ---------------------------------------------------------------------------

/**
 * Reading the bank table. R32F texels, 1024 wide, wrapped rows; linear between
 * samples — identical to route.ts's bankTableAt, which is the point.
 */
export const bankChunk = /* glsl */`
uniform sampler2D uBankLut;
uniform ivec2 uBankInfo;   // (sample count, unused)
uniform float uBankStep;
uniform float uBankGain;   // 1 + lapF * BANK_GAIN
float bankAt (float s) {
  int N = uBankInfo.x;
  float f = s / uBankStep;
  float fi = floor(f);
  float t = f - fi;
  int i = int(mod(fi, float(N)));
  int j = int(mod(fi + 1.0, float(N)));
  float a = texelFetch(uBankLut, ivec2(i % 1024, i / 1024), 0).r;
  float b = texelFetch(uBankLut, ivec2(j % 1024, j / 1024), 0).r;
  return mix(a, b, t) * uBankGain;
}
`

export const sweepVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec4 aSpine;   // spine xyz, s
layout(location = 1) in vec4 aRight;   // level right xyz, r
layout(location = 2) in vec4 aUp;      // level up xyz, u
layout(location = 3) in vec4 aAux;     // normal2d (r,u), edge param, section
uniform mat4 uViewProj;
uniform vec3 uOffset;   // whole-mesh translation: the fish rising out of the sea
uniform vec4 uPulse;    // peristalsis: amplitude, time, mouth s, flesh end (0 amplitude for anything but the throat)
${bankChunk}
out vec3 vWorld;
out vec3 vNormal;
out vec4 vAux;    // s, r, u, edge
out float vSection;
void main () {
  float roll = bankAt(aSpine.w);
  float c = cos(roll), sn = sin(roll);
  // Positive bank rolls the right side down: up leans toward right.
  vec3 R = aRight.xyz * c - aUp.xyz * sn;
  vec3 U = aUp.xyz * c + aRight.xyz * sn;
  vec3 world = aSpine.xyz + R * aRight.w + U * aUp.w + uOffset;
  vNormal = normalize(R * aAux.x + U * aAux.y);
  // Peristalsis: the flesh squeezes in rings that travel down the throat,
  // dying out where the rock begins. The front faces point inward, so a
  // positive push along the normal is a constriction.
  if (uPulse.x > 0.0) {
    float t = aSpine.w - uPulse.z;
    float live = 1.0 - smoothstep(uPulse.w * 0.7, uPulse.w * 1.35, t);
    float ring = 0.5 + 0.5 * sin(t * 0.32 - uPulse.y * 2.4 + aAux.x * 1.2);
    world += vNormal * uPulse.x * ring * ring * live;
  }
  vWorld = world;
  vAux = vec4(aSpine.w, aRight.w, aUp.w, aAux.z);
  vSection = aAux.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`

/** Depth only, for the shadow pass. Any vertex shader, no colour. */
export const depthFrag = /* glsl */`#version 300 es
precision highp float;
void main () {}
`

/** The standard interleaved layout (lib/mesh), un-instanced: terrain, the sea. */
export const meshVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aShard;   // x: signed distance to the tube's wall, negative inside
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vCarve;
void main () {
  vWorld = aPos;
  vNormal = aNormal;
  vUv = aUv;
  vCarve = aShard.x;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

/**
 * The land: grass in field patches, soil on the worn ground, rock on anything
 * steep, sand at the water line. Detail fades to its mean with distance rather
 * than to zero — the natatorium moiré lesson — and every term is a function of
 * world position, so two chunks never disagree at a seam.
 */
export const terrainFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vCarve;
uniform vec4 uRide;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  // The heightfield cannot tunnel: inside the tube it is simply not there.
  if (vCarve < 0.0) discard;
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  float dist = length(p - uCamPos);
  float lod = clamp(dist / 260.0, 0.0, 1.0);

  // Fields: patches of different greens and a few harvested to gold, on a
  // large-scale noise quantised into parcels.
  float parcel = fbm(p.xz * 0.0024 + 11.0);
  float par2 = fbm(p.xz * 0.0071 + 4.0);
  vec3 g1 = vec3(0.09, 0.17, 0.045);
  vec3 g2 = vec3(0.16, 0.22, 0.06);
  vec3 g3 = vec3(0.34, 0.27, 0.10);
  vec3 grass = mix(g1, g2, smoothstep(0.42, 0.58, parcel));
  grass = mix(grass, g3, smoothstep(0.62, 0.7, par2) * smoothstep(0.52, 0.58, parcel));
  // Blade-scale detail, fading to its mean.
  float blades = vnoise(p.xz * 1.7) * 0.6 + vnoise(p.xz * 6.3) * 0.4;
  grass *= mix(0.72 + blades * 0.56, 1.0, lod);

  vec3 soil = vec3(0.21, 0.15, 0.095) * (0.8 + 0.4 * vnoise(p.xz * 0.9));
  vec3 rock = vec3(0.30, 0.285, 0.26) * (0.6 + 0.6 * fbm3(p * 0.11));
  rock = mix(rock, rock * vec3(0.85, 0.8, 0.75), smoothstep(0.3, 0.7, fbm3(p * 0.021 + 5.0)));
  vec3 sand = vec3(0.44, 0.39, 0.29) * (0.85 + 0.3 * vnoise(p.xz * 2.2));

  float slope = 1.0 - n.y;
  float rockW = smoothstep(0.22, 0.48, slope + (fbm3(p * 0.06) - 0.5) * 0.18);
  float soilW = smoothstep(0.08, 0.2, slope) * (1.0 - rockW) * 0.7;
  // Sand only where the land meets the sea; the valley floor is below sea
  // level and must not read as a beach.
  float sandW = smoothstep(4.0, 0.5, p.y) * smoothstep(330.0, 420.0, p.x) * (1.0 - rockW * 0.6);
  vec3 albedo = mix(grass, soil, soilW);
  albedo = mix(albedo, rock, rockW);
  albedo = mix(albedo, sand, sandW);
  float rough = mix(0.92, 0.75, rockW) ;

  // Downtown's plaza is paved: concrete slabs with joints, over the flat disc.
  const vec3 PLAZA = vec3(385.0, 665.0, 130.0);
  float pave = 1.0 - smoothstep(PLAZA.z - 12.0, PLAZA.z + 28.0, length(p.xz - PLAZA.xy));
  if (pave > 0.001) {
    vec2 slabUv = p.xz / 6.0;
    vec2 jf = abs(fract(slabUv) - 0.5);
    float joint = 1.0 - smoothstep(0.44, 0.49, max(jf.x, jf.y));
    vec3 slab = vec3(0.4, 0.39, 0.37) * (0.82 + 0.36 * vnoise(floor(slabUv) * 3.7 + 1.0)) * (0.6 + 0.4 * joint);
    slab *= mix(0.85, 1.0, vnoise(p.xz * 1.3));
    albedo = mix(albedo, slab, pave);
    rough  = mix(rough, 0.62, pave);
  }

  // Rock faces get shading from their own relief.
  vec3 nn = n;
  if (rockW > 0.01) {
    float e = 0.6;
    float h0 = fbm3(p * 0.35);
    float hx = fbm3((p + vec3(e, 0, 0)) * 0.35) - h0;
    float hy = fbm3((p + vec3(0, e, 0)) * 0.35) - h0;
    float hz = fbm3((p + vec3(0, 0, e)) * 0.35) - h0;
    vec3 g = vec3(hx, hy, hz) / e;
    g -= n * dot(g, n);
    nn = normalize(n - g * 0.9 * rockW * (1.0 - lod));
  }

  float sh = shadowAt(p, nn, uSunDir);
  // A little ambient occlusion from slope: ground under a steep face sees less sky.
  float ao = 0.75 + 0.25 * n.y;
  vec3 col = lightSurface(p, nn, albedo, rough, 0.0, ao, sh);
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/**
 * The sea's vertices: four Gerstner waves (GPU Gems ch. 1), amplitude faded to
 * nothing at the edge of the fine patch so it meets the flat far quad without
 * a step. uWaveScale is 0 for the far quad. The whole surface rises by lap.
 */
export const seaVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4  uViewProj;
uniform float uTime;
uniform float uWaveScale;
uniform float uSeaRise;
uniform vec4  uPatch;      // centre.x, centre.z, half size x, half size z
uniform vec3  uMouth;      // where the fish's mouth is
uniform vec2  uMouthDir;   // the throat's heading from it, in xz
uniform float uRise;       // how far the fish has surfaced, 0..1
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vFoam;
out float vPit;
const vec4 W0 = vec4(0.94, 0.34, 0.85, 58.0);   // dir.x, dir.z, amplitude, wavelength
const vec4 W1 = vec4(0.62, -0.78, 0.45, 29.0);
const vec4 W2 = vec4(-0.24, 0.97, 0.26, 16.0);
const vec4 W3 = vec4(0.71, 0.71, 0.12, 7.5);
void wave (vec4 w, vec2 xz, float t, float amp, inout vec3 P, inout vec3 N) {
  float k = 6.2831853 / w.w;
  float c = sqrt(9.81 / k);
  float A = w.z * amp;
  float f = k * dot(w.xy, xz) - c * k * t;
  float Q = 0.6 / (k * A * 4.0 + 1e-3);
  Q = min(Q, 1.0);
  P.x += Q * A * w.x * cos(f);
  P.z += Q * A * w.y * cos(f);
  P.y += A * sin(f);
  N.x -= w.x * k * A * cos(f);
  N.z -= w.y * k * A * cos(f);
  N.y -= Q * k * A * sin(f);
}
void main () {
  vec3 P = aPos;
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec2 rel = abs(aPos.xz - uPatch.xy) / max(uPatch.zw, vec2(1.0));
  float amp = uWaveScale * (1.0 - smoothstep(0.78, 1.0, max(rel.x, rel.y)));
  if (amp > 0.0) {
    wave(W0, aPos.xz, uTime, amp, P, N);
    wave(W1, aPos.xz, uTime, amp, P, N);
    wave(W2, aPos.xz, uTime, amp, P, N);
    wave(W3, aPos.xz, uTime, amp, P, N);
  }
  P.y += uSeaRise;
  // The fish: while it is under, the sea is whole. As it surfaces the water
  // heaps into a bow wave around the head and, in the last part of the rise,
  // the surface inside the mouth's footprint and along the throat drops away
  // so no water plane crosses the gullet the car falls into.
  // The throat's ceiling is above sea level for the first 110 m from the
  // mouth (measured in maw.ts terms: it dips under at t = 120), all of it
  // under the head's skin; the pit runs that far and narrows with the throat.
  vec2 rm = P.xz - uMouth.xz;
  float alongB = clamp(dot(rm, uMouthDir), 0.0, 78.0);
  float dB = length(rm - uMouthDir * alongB);
  float ring = (dB - 58.0) / 16.0;
  float bulge = exp(-ring * ring) * (5.0 + 2.5 * sin(uTime * 1.7 + dB * 0.35 + rm.x * 0.05)) * smoothstep(0.3, 0.95, uRise);
  // The pit is a hole, not a funnel: a displaced surface that goes from above
  // the throat to below it has to cross the tube somewhere along the axis,
  // and did, as a white plane at the end of the gullet. seaFrag discards it.
  // The plane cuts the throat from 28 m behind the mouth to 110 m, where the
  // ceiling goes under; the hole is sized to that cut (half width 25 m at
  // most, 8 m at the end) and stays inside the head's skin all the way.
  float along = clamp(dot(rm, uMouthDir), 28.0, 112.0);
  float dSeg = length(rm - uMouthDir * along);
  float pr = mix(24.0, 6.0, smoothstep(45.0, 110.0, along));
  float pit = (1.0 - smoothstep(pr, pr + 14.0, dSeg)) * smoothstep(0.7, 1.0, uRise);
  P.y += bulge;
  vFoam = bulge / 7.0 + pit * 2.0;
  vPit = pit;
  vWorld = P;
  vNormal = normalize(N);
  vUv = aUv;
  gl_Position = uViewProj * vec4(P, 1.0);
}
`

/**
 * The sea's surface: the Gerstner normal from the vertex shader, a little
 * noise for the glitter, water Fresnel over a lit body colour, foam where the
 * crests pinch.
 */
export const seaFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vFoam;
in float vPit;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  if (vPit > 0.5) discard;
  vec3 p = vWorld;
  float dist = length(p - uCamPos);
  float lod = clamp(dist / 600.0, 0.0, 1.0);
  // Two octave bands of moving noise stand in for the swell until Gerstner
  // lands: a long one for the sky reflection, a short one for the glitter.
  vec2 q1 = p.xz * 0.045 + vec2(uTime * 0.09, uTime * 0.05);
  vec2 q2 = p.xz * 0.31 + vec2(-uTime * 0.35, uTime * 0.22);
  float e = 0.25;
  float h0 = fbm(q1) + 0.35 * fbm(q2);
  float hx = fbm(q1 + vec2(e, 0.0)) + 0.35 * fbm(q2 + vec2(e * 6.9, 0.0)) - h0;
  float hz = fbm(q1 + vec2(0.0, e)) + 0.35 * fbm(q2 + vec2(0.0, e * 6.9)) - h0;
  float flat_ = 1.0 - lod * 0.85;
  vec3 nn = normalize(vec3(-hx * 1.4 * flat_, e, -hz * 1.4 * flat_));
  vec3 n = normalize(normalize(vNormal) + (nn - vec3(0.0, 1.0, 0.0)) * 0.6);

  // Water, not plastic: f0 0.02, a body colour that is lit through, and the
  // sky mirrored by Fresnel alone. The sun keeps its GGX glitter path.
  vec3 v = normalize(uCamPos - p);
  float NoV = max(dot(n, v), 0.0);
  vec3 F = F_Schlick(NoV, vec3(0.02));
  vec3 rdir = reflect(-v, n);
  rdir.y = max(rdir.y, 0.02);
  vec3 refl = skyLookup(rdir);
  vec3 body = vec3(0.02, 0.10, 0.12);
  float sh = shadowAt(p, vec3(0.0, 1.0, 0.0), uSunDir);
  vec3 sunCol = sunRadiance();
  vec3 under = body * (skyLookup(vec3(0.0, 1.0, 0.0)) * 0.8 + sunCol * max(uSunDir.y, 0.0) * 0.25 * sh);
  vec3 glitter = shade(n, v, uSunDir, vec3(0.0), 0.14, 0.0, sunCol) * sh;
  vec3 col = under * (1.0 - F) + refl * F + glitter;
  // Foam where the surface pinches: a steep Gerstner normal.
  float steep = 1.0 - normalize(vNormal).y;
  float foam = smoothstep(0.1, 0.3, steep) * (0.5 + 0.5 * vnoise(p.xz * 0.8 + uTime * 0.3)) * (1.0 - lod);
  foam = max(foam, clamp(vFoam, 0.0, 1.0) * (0.55 + 0.45 * vnoise(p.xz * 0.5 - uTime * 0.4)));
  col = mix(col, vec3(0.7, 0.72, 0.7) * (skyLookup(vec3(0.0, 1.0, 0.0)) * 0.5 + sunCol * 0.15 * sh), foam);
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/**
 * Props: one unit mesh per kind, instanced. iXform is (pos.xyz, yaw), iParams
 * (scale, seed, sway, spare). A rotor spins about its local z when uSpin is set;
 * a canopy sways with its own seed. Material is per set, a uniform.
 */
export const propVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 4) in vec4 iXform;
layout(location = 5) in vec4 iParams;
uniform mat4  uViewProj;
uniform float uTime;
uniform float uSpin;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vSeed;
out vec3 vCentre;
void main () {
  vec3 p = aPos * iParams.x;
  // A pier is a unit column stretched to the deck: iParams.w is its height.
  if (iParams.w > 0.0) p.y = aPos.y * iParams.w;
  vec3 n = aNormal;
  // Where a canopy's fake sphere is centred: the crown, scaled with the tree.
  vCentre = iXform.xyz + vec3(0.0, 5.9 * iParams.x, 0.0);
  if (uSpin != 0.0) {
    float a = uTime * uSpin + iParams.y * 6.2831853;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    p.xy = R * p.xy;
    n.xy = R * n.xy;
  }
  mat2 Y = mat2(cos(iXform.w), -sin(iXform.w), sin(iXform.w), cos(iXform.w));
  p.xz = Y * p.xz;
  n.xz = Y * n.xz;
  vec3 w = iXform.xyz + p;
  // Wind: a lean that grows with height, phased by seed.
  float lift = max(p.y - 1.5, 0.0);
  w.x += iParams.z * sin(uTime * 1.1 + iParams.y * 9.0) * lift * 0.03;
  w.z += iParams.z * cos(uTime * 0.8 + iParams.y * 5.0) * lift * 0.02;
  vWorld = w;
  vNormal = n;
  vUv = aUv;
  vSeed = iParams.y;
  gl_Position = uViewProj * vec4(w, 1.0);
}
`

/** Leaf mask for the crossed canopy quads: an ellipse eaten by noise. */
export const leafChunk = /* glsl */`
// Holes torn in a crown lobe's skin, on its spherical uv: the lobe reads as
// clumps of leaves with sky between them, not as a smooth green ball. Negative
// is a hole.
float leafMask (vec2 uv, float seed) {
  float holes = fbm(uv * vec2(7.0, 4.5) + seed * 13.0) - 0.44;
  holes += (fbm(uv * vec2(19.0, 12.0) + seed * 7.0) - 0.5) * 0.25;
  return holes;
}
`

/** Prop materials by uMaterial, shared by every set. */
export const propFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vSeed;
in vec3 vCentre;
uniform int uMaterial;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
${leafChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  if (dot(n, uCamPos - p) < 0.0) n = -n;
  // A canopy quad is lit as the sphere it stands in for, so the crown rounds
  // toward the sun instead of reading as a cardboard cutout.
  if (uMaterial == 5)
    n = normalize(mix(n, normalize(p - vCentre), 0.45));
  vec3 albedo; float rough = 0.85; float metal = 0.0;
  float det = 0.82 + 0.36 * fbm3(p * 3.1);
  if (uMaterial == 0)      { albedo = vec3(0.36, 0.28, 0.18); }                                 // wood
  else if (uMaterial == 1) { albedo = vec3(0.15, 0.11, 0.08); rough = 0.8; }                    // creosote
  else if (uMaterial == 2) { albedo = vec3(0.58, 0.46, 0.20); rough = 0.95; det = 0.7 + 0.6 * fbm3(p * 9.0); }  // hay
  else if (uMaterial == 3) { albedo = vec3(0.42, 0.09, 0.07); rough = 0.7; }                    // barn wall
  else if (uMaterial == 4) { albedo = vec3(0.34, 0.35, 0.37); rough = 0.45; metal = 0.6; }      // barn roof
  else if (uMaterial == 5) {                                                                     // canopy
    if (leafMask(vUv, vSeed) < 0.0) discard;
    albedo = mix(vec3(0.08, 0.17, 0.045), vec3(0.2, 0.26, 0.06), vnoise(vUv * 9.0 + vSeed)) * (0.75 + 0.6 * vUv.y);
    rough = 0.9;
  }
  else if (uMaterial == 6) { albedo = vec3(0.22, 0.17, 0.12); rough = 0.92; }                   // trunk
  else if (uMaterial == 7) { albedo = vec3(0.86, 0.87, 0.88); rough = 0.42; det = 1.0; }        // turbine
  else if (uMaterial == 8) { albedo = vec3(0.55, 0.56, 0.58); rough = 0.35; metal = 0.9; det = 0.9 + 0.2 * fbm3(p * 2.0); } // steel
  else if (uMaterial == 9) { albedo = vec3(0.5, 0.49, 0.46); rough = 0.85; det = 0.85 + 0.3 * fbm3(p * 0.7); }               // concrete
  else if (uMaterial == 10) { albedo = vec3(0.04, 0.05, 0.06); rough = 0.12; metal = 0.5; det = 1.0; }                        // glass
  else if (uMaterial == 11) { albedo = vec3(0.27, 0.25, 0.23); rough = 0.95; det = 0.6 + 0.8 * fbm3(p * 0.9); }              // rock
  else                     { albedo = vec3(0.84, 0.83, 0.78); rough = 0.55; det = 0.94 + 0.12 * fbm3(p * 4.0); }              // paint
  albedo *= det;
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, metal, 1.0, sh);
  // Leaves are lit through: a wrapped sun term keeps the shade side of a crown
  // green rather than black, and the sky fills it from every side.
  if (uMaterial == 5) {
    float wrap = 0.5 + 0.5 * dot(n, uSunDir);
    col += albedo * (sunRadiance() * (0.16 * wrap * sh) + skyLookup(vec3(0.0, 1.0, 0.0)) * 0.35);
  }
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/** Prop depth for the shadow pass: only the canopy needs its mask. */
export const propDepthFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
in float vSeed;
uniform int uMaterial;
${noiseChunk}
${leafChunk}
void main () {
  if (uMaterial == 5 && leafMask(vUv, vSeed) < 0.0) discard;
}
`

/**
 * Downtown's towers. A unit box per instance, bent live: lean grows with the
 * square of height along iBend.xy, twist grows linearly, both scaled by the
 * lap gain. Facade coordinates come out in metres so the window grid is real.
 */
export const towerVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 4) in vec4 iXform;   // pos.xyz, yaw
layout(location = 5) in vec4 iSize;    // w, h, d, seed
layout(location = 6) in vec4 iBend;    // dir.x, dir.z, K, twist
uniform mat4  uViewProj;
uniform float uBendGain;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vFacade;
out float vSeed;
out float vRoof;
out float vH;
void main () {
  vec3 lp = aPos * iSize.xyz;
  float h = lp.y;
  float H = iSize.y;
  float ang = iXform.w + iBend.w * (h / H) * uBendGain;
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec3 n = aNormal;
  lp.xz = R * lp.xz;
  n.xz  = R * n.xz;
  float lean  = min(iBend.z * h * h * uBendGain, 0.36 * H);
  float slope = 2.0 * iBend.z * h * uBendGain;
  vec2 dir = vec2(iBend.x, iBend.y);
  vec3 w = iXform.xyz + lp;
  w.xz += dir * lean;
  // A leaning wall's normal tips back against the lean.
  n.y -= dot(n.xz, dir) * slope;
  n = normalize(n);
  float faceW = abs(aNormal.x) > 0.5 ? iSize.z : iSize.x;
  vFacade = vec2(aUv.x * faceW, h);
  vRoof   = step(0.5, aNormal.y);
  vSeed   = iSize.w;
  vH      = h / H;
  vWorld  = w;
  vNormal = n;
  gl_Position = uViewProj * vec4(w, 1.0);
}
`

/**
 * Facades: two families by seed — concrete with punched windows, and curtain
 * glass with mullions. Windows light up as the sun goes down, cell by cell.
 */
export const towerFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vFacade;
in float vSeed;
in float vRoof;
in float vH;
uniform float uSunEl;      // sun elevation, degrees
uniform vec4  uRide;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  float glassy = step(0.45, hash12(vec2(vSeed * 7.1, 3.0)));
  vec2 cell = mix(vec2(3.4, 3.7), vec2(2.2, 3.9), glassy);
  vec2 f  = fract(vFacade / cell);
  vec2 id = floor(vFacade / cell);
  float win;
  vec3 wall;
  float rough;
  float metal = 0.0;
  if (glassy > 0.5) {
    // Curtain wall: glass everywhere, a mullion grid on top.
    float mull = step(f.x, 0.05) + step(f.y, 0.06);
    win  = 1.0 - min(mull, 1.0);
    wall = vec3(0.22, 0.23, 0.25);
    rough = 0.4;
  } else {
    win  = step(0.14, f.x) * step(f.x, 0.86) * step(0.18, f.y) * step(f.y, 0.82);
    vec3 tint = mix(vec3(0.3, 0.28, 0.26), vec3(0.46, 0.44, 0.42), hash12(vec2(vSeed, 9.0)));
    wall = tint * (0.85 + 0.3 * fbm3(p * 0.45));
    rough = 0.82;
  }
  vec3 glass = vec3(0.03, 0.05, 0.07);
  vec3 albedo = mix(wall, glass, win);
  rough = mix(rough, 0.12, win);
  if (vRoof > 0.5) {
    albedo = vec3(0.16, 0.16, 0.15) * (0.8 + 0.4 * vnoise(p.xz * 0.8));
    rough  = 0.9;
    win    = 0.0;
  }
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, metal, 1.0, sh);

  // Lights come on with dusk, more of them every lap.
  float dusk = smoothstep(11.0, 2.0, uSunEl) * 0.85 + 0.15;
  float on   = step(1.0 - 0.55 * dusk, hash12(id + vSeed * 13.0));
  vec3 warm  = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.7, hash12(id * 1.7 + vSeed)));
  col += warm * 1.8 * on * win * dusk;

  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`
