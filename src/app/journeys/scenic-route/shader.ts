// THE SCENIC ROUTE — the GLSL.
//
// Two dialects on purpose, as in loop-line: the journey is GLSL ES 3.00 and
// the landing-grid hover preview at the bottom is ES 1.00, because every card
// shares one WebGL 1.0 context.
//
// The rendering idea that everything here hangs off: **the fog is the sky.**
// Once a frame, `skyLutFrag` renders the whole sky — single-scattering Rayleigh
// and Mie after Nishita (GPU Gems 2 ch. 16; gboisse/glsl-atmosphere for the
// compact form) — into a 128×65 lat-long texture. The sky dome samples it, every
// surface's fog colour samples it in the view direction, ambient samples it at
// the normal, and its extra top row holds the sun's transmitted radiance. One
// source of truth, so the horizon can never disagree with the haze on the road.
//
// Never a backtick inside a shader comment. It ends the template literal.

// ---------------------------------------------------------------------------
// shared chunks
// ---------------------------------------------------------------------------

const noiseChunk = /* glsl */`
float hash11 (float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13 (vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vnoise3 (vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm (vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
float fbm3 (vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise3(p);
    p = p * 2.07 + 11.3;
    a *= 0.5;
  }
  return s;
}
`

/**
 * Cook-Torrance with GGX / Smith / Schlick, per learnopengl.com/PBR. Inputs are
 * clamped so no pow() ever sees a negative base.
 */
const brdfChunk = /* glsl */`
const float PI = 3.14159265;
float D_GGX (float NoH, float a) {
  float a2 = a * a;
  float d = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * d * d + 1e-6);
}
float V_Smith (float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-4);
}
vec3 F_Schlick (float VoH, vec3 f0) {
  float x = clamp(1.0 - VoH, 0.0, 1.0);
  float x2 = x * x;
  return f0 + (1.0 - f0) * (x2 * x2 * x);
}
// Radiance leaving the surface toward v from one directional light of colour lc.
vec3 shade (vec3 n, vec3 v, vec3 l, vec3 albedo, float rough, float metal, vec3 lc) {
  float NoL = max(dot(n, l), 0.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(v + l);
  float NoV = max(dot(n, v), 1e-3);
  float NoH = max(dot(n, h), 0.0);
  float VoH = max(dot(v, h), 0.0);
  float a = max(rough * rough, 0.002);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F_Schlick(VoH, f0);
  vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F;
  // Grass and gravel are not microfacet surfaces at this scale: the GGX sheen
  // at grazing angles toward a low sun paints whole fields white. Fade the
  // specular out with roughness; the sea (0.09) and paint keep all of theirs.
  spec *= mix(1.0, 0.08, smoothstep(0.55, 0.95, rough));
  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo / PI + spec) * lc * NoL;
}
`

/**
 * Single scattering. Camera at r0 (planet-centred metres), ray rd, integrated
 * to tMax. Returns in-scattered radiance and writes the segment transmittance.
 * The sun below the horizon is handled by testing each sample's sun ray against
 * the planet, which is what darkens the sky at dusk rather than a fade.
 */
const atmosphereChunk = /* glsl */`
const float R_E   = 6371e3;
const float R_A   = 6471e3;
const vec3  K_R   = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_M   = 12.6e-6;
const float H_R   = 8000.0;
const float H_M   = 1200.0;
const float G_M   = 0.758;
const float I_SUN = 20.0;

vec2 rsi (vec3 r0, vec3 rd, float sr) {
  float b = dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e5, -1e5);
  float q = sqrt(d);
  return vec2(-b - q, -b + q);
}

vec3 scatter (vec3 r0, vec3 rd, float tMax, vec3 sun, int iSteps, int jSteps, out vec3 trans) {
  vec2 p = rsi(r0, rd, R_A);
  if (p.x > p.y) { trans = vec3(1.0); return vec3(0.0); }
  float tEnd = min(p.y, tMax);
  vec2 g = rsi(r0, rd, R_E);
  if (g.x < g.y && g.x > 0.0) tEnd = min(tEnd, g.x);
  float t0 = max(p.x, 0.0);
  float iStep = (tEnd - t0) / float(iSteps);
  float iTime = t0;
  vec3 totR = vec3(0.0);
  vec3 totM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  float mu = dot(rd, sun);
  float mumu = mu * mu;
  float gg = G_M * G_M;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * G_M, 1.5) * (2.0 + gg));
  for (int i = 0; i < iSteps; i++) {
    vec3 iPos = r0 + rd * (iTime + iStep * 0.5);
    float iH = max(length(iPos) - R_E, 0.0);
    float odsR = exp(-iH / H_R) * iStep;
    float odsM = exp(-iH / H_M) * iStep;
    odR += odsR;
    odM += odsM;
    vec2 e = rsi(iPos, sun, R_E);
    if (e.x < e.y && e.x > 0.0) { iTime += iStep; continue; }
    float jStep = rsi(iPos, sun, R_A).y / float(jSteps);
    float jTime = 0.0;
    float jOdR = 0.0;
    float jOdM = 0.0;
    for (int j = 0; j < jSteps; j++) {
      vec3 jPos = iPos + sun * (jTime + jStep * 0.5);
      float jH = max(length(jPos) - R_E, 0.0);
      jOdR += exp(-jH / H_R) * jStep;
      jOdM += exp(-jH / H_M) * jStep;
      jTime += jStep;
    }
    vec3 attn = exp(-(K_M * (odM + jOdM) + K_R * (odR + jOdR)));
    totR += odsR * attn;
    totM += odsM * attn;
    iTime += iStep;
  }
  trans = exp(-(K_M * odM + K_R * odR));
  return I_SUN * (pR * K_R * totR + pM * K_M * totM);
}
`

/**
 * Reading the sky LUT. Rows 0..63 are elevation −90°..+90°; row 64 is the sun's
 * transmitted radiance. Azimuth wraps through REPEAT on S.
 */
const skyLookupChunk = /* glsl */`
uniform sampler2D uSky;
const float SKY_ROWS = 65.0;
vec3 skyLookup (vec3 d) {
  float az = atan(d.x, d.z) / (2.0 * PI) + 0.5;
  float el = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  float v = (el * 63.0 + 0.5) / SKY_ROWS;
  return texture(uSky, vec2(az, v)).rgb;
}
vec3 sunRadiance () {
  return texelFetch(uSky, ivec2(0, 64), 0).rgb;
}
`

export const postVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * The sky dome's vertex shader: the same fullscreen quad, but at NDC z = 1 so
 * that under LEQUAL against a depth buffer cleared to 1.0 it fills exactly the
 * pixels nothing opaque claimed. Drawn last, so it also costs no overdraw.
 */
export const skyVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 1.0, 1.0);
}
`

// ---------------------------------------------------------------------------
// the sky
// ---------------------------------------------------------------------------

/** Renders the lat-long sky LUT. Cheap: 128×65 texels, and the sun moves slowly. */
export const skyLutFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3  uSunDir;
uniform float uCamAlt;
uniform ivec2 uSteps;      // (view samples, light samples)
out vec4 fragColor;
${brdfChunk}
${atmosphereChunk}
void main () {
  float row = floor(vUv.y * 65.0);
  vec3 r0 = vec3(0.0, R_E + max(uCamAlt, 2.0), 0.0);
  vec3 trans;
  if (row >= 64.0) {
    // The sun's own transmitted radiance, for lighting surfaces.
    scatter(r0, uSunDir, 1e9, uSunDir, uSteps.x, uSteps.y, trans);
    fragColor = vec4(I_SUN * trans, 1.0);
    return;
  }
  float el = ((row + 0.5) / 64.0 - 0.5) * PI;
  float az = (vUv.x - 0.5) * 2.0 * PI;
  vec3 d = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
  vec3 col = scatter(r0, d, 1e9, uSunDir, uSteps.x, uSteps.y, trans);
  fragColor = vec4(col, 1.0);
}
`

/**
 * The sky dome: a fullscreen triangle at far depth, drawn after the world so it
 * only fills what nothing else did. The sun is a real disc here, depth-tested
 * like anything else, and bloom does the flare.
 */
export const skyDomeFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform float uTime;
uniform float uSkyMix;     // section sky weight: 1 outside, 0 in the cave
uniform vec3  uFogCol;
out vec4 fragColor;
${brdfChunk}
${skyLookupChunk}
${noiseChunk}
void main () {
  vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(p.xyz / p.w - uCamPos);
  // Below the horizon the dome is whatever the terrain did not cover; read the
  // haze at the horizon rather than the near-black of a ray into the ground.
  vec3 col = skyLookup(vec3(rd.x, max(rd.y, 0.012), rd.z));

  // The sun disc: 0.27° radius, softened a touch, at the transmitted radiance.
  float cosSun = dot(rd, uSunDir);
  float disc = smoothstep(0.999935, 0.999975, cosSun);
  col += sunRadiance() * disc * 0.35;

  // A thin fbm cloud layer at 1800 m, lit by phase. Cheap and only above the horizon.
  if (rd.y > 0.002) {
    float t = 1800.0 / rd.y;
    vec2 cp = (uCamPos.xz + rd.xz * t) * 0.00045 + vec2(uTime * 0.0011, 0.0);
    float cov = fbm(cp) ;
    float cloud = smoothstep(0.52, 0.72, cov) * smoothstep(0.015, 0.16, rd.y);
    float phase = 0.6 + 0.9 * pow(max(cosSun, 0.0), 6.0);
    vec3 cloudCol = mix(skyLookup(vec3(rd.x, 0.02, rd.z)) * 0.9, sunRadiance() * 0.06, 0.35) * phase;
    col = mix(col, cloudCol, cloud * 0.85);
  }

  col = mix(uFogCol, col, uSkyMix);
  fragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------
// the swept road
// ---------------------------------------------------------------------------

/**
 * Reading the bank table. R32F texels, 1024 wide, wrapped rows; linear between
 * samples — identical to route.ts's bankTableAt, which is the point.
 */
const bankChunk = /* glsl */`
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
  vec3 world = aSpine.xyz + R * aRight.w + U * aUp.w;
  vWorld = world;
  vNormal = normalize(R * aAux.x + U * aAux.y);
  vAux = vec4(aSpine.w, aRight.w, aUp.w, aAux.z);
  vSection = aAux.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`

/**
 * The sun shadow, received. One 2048² depth map fitted ahead of the camera,
 * hardware-compared through sampler2DShadow with a 3×3 tap, and a normal offset
 * that grows as the light grazes — the two biases learnopengl and MJP agree on.
 * Off entirely in the cave, where uShadowOn is zero.
 */
const shadowChunk = /* glsl */`
uniform highp sampler2DShadow uShadowMap;
uniform mat4  uShadowMat;    // world -> [0,1]^3 in light space
uniform float uShadowOn;
uniform vec2  uShadowTexel;
float shadowAt (vec3 p, vec3 n, vec3 l) {
  if (uShadowOn < 0.5) return 1.0;
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  vec3 pp = p + n * (0.25 + 1.4 * (1.0 - NoL));
  vec4 sc = uShadowMat * vec4(pp, 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x <= 0.0 || uvz.x >= 1.0 || uvz.y <= 0.0 || uvz.y >= 1.0 || uvz.z >= 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += texture(uShadowMap, vec3(uvz.xy + vec2(float(i), float(j)) * uShadowTexel, uvz.z - 0.0006));
  return sum / 9.0;
}
`

/**
 * Per-fragment lighting shared by every world material: sun through the BRDF
 * and the shadow map, sky ambient at the normal, then fog toward the sky in
 * the view direction.
 */
const lightingChunk = /* glsl */`
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec4  uEnv;        // (exposure EV, sky weight, fog density, water level)
uniform vec3  uFogCol;
uniform float uTime;

vec3 lightSurface (vec3 p, vec3 n, vec3 albedo, float rough, float metal, float ao, float shadow) {
  vec3 v = normalize(uCamPos - p);
  vec3 sunCol = sunRadiance();
  vec3 col = shade(n, v, uSunDir, albedo, rough, metal, sunCol) * shadow;
  // Sky ambient: radiance at the normal stands in for hemisphere irradiance.
  vec3 amb = skyLookup(n) * (0.6 + 0.4 * n.y) * ao;
  col += albedo * (1.0 - metal) * amb;
  // Specular ambient, cheap: the sky in the reflected direction, Fresnel-weighted.
  vec3 rdir = reflect(-v, n);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F_Schlick(max(dot(n, v), 0.0), f0);
  col += skyLookup(rdir) * F * (1.0 - rough) * ao;
  return col;
}

vec3 applyFog (vec3 col, vec3 p) {
  vec3 d = p - uCamPos;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  vec3 sky = skyLookup(vec3(rd.x, max(rd.y, 0.015), rd.z));
  // The sky LUT carries the Mie peak; fog in-scatter toward the sun must not.
  // Cap the in-scatter at a few times the zenith luminance, keeping the hue,
  // or every surface in the sun's quarter washes to white.
  vec3 zen = skyLookup(vec3(0.0, 1.0, 0.0));
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float cap = 3.0 * dot(zen, LUMA);
  sky *= min(1.0, cap / max(dot(sky, LUMA), 1e-4));
  vec3 fogCol = mix(uFogCol, sky, uEnv.y);
  float f = 1.0 - exp(-dist * uEnv.z);
  return mix(col, fogCol, f);
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
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
void main () {
  vWorld = aPos;
  vNormal = aNormal;
  vUv = aUv;
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
uniform vec4 uRide;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
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
 * The sea, placeholder edition: a Fresnel reflection of the sky over a deep
 * body colour, with a small animated normal so the sun glitters. Gerstner and
 * the maw arrive in phase 4.
 */
export const seaFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
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
  vec3 n = normalize(vec3(-hx * 2.6 * flat_, e, -hz * 2.6 * flat_));

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
  vec3 glitter = shade(n, v, uSunDir, vec3(0.0), 0.09, 0.0, sunCol) * sh;
  vec3 col = under * (1.0 - F) + refl * F + glitter;
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
const leafChunk = /* glsl */`
float leafMask (vec2 uv, float seed) {
  vec2 c = (uv - vec2(0.5, 0.52)) * vec2(1.0, 0.92);
  float edge = 0.46 - length(c);
  float holes = fbm(uv * 5.5 + seed * 13.0) - 0.5;
  return edge * 8.0 + holes * 1.4;
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
    n = normalize(mix(n, normalize(p - vCentre), 0.8));
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
  else                     { albedo = vec3(0.5, 0.49, 0.46); rough = 0.85; det = 0.85 + 0.3 * fbm3(p * 0.7); }               // concrete
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

/** The coast guardrail: a galvanised band swept with the road, rolled by the same LUT. */
export const railFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vAux;
in float vSection;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  vec3 n = normalize(vNormal);
  if (dot(n, uCamPos - vWorld) < 0.0) n = -n;
  // Corrugation along the band, and a post every four metres darkening it.
  float corr = 0.9 + 0.2 * sin(vAux.z * 12.0);
  vec3 albedo = vec3(0.56, 0.57, 0.6) * corr * (0.85 + 0.3 * fbm3(vWorld * 1.7));
  float sh = shadowAt(vWorld, n, uSunDir);
  vec3 col = lightSurface(vWorld, n, albedo, 0.38, 0.9, 1.0, sh);
  col = applyFog(col, vWorld);
  fragColor = vec4(col, 1.0);
}
`

/** The running surface: asphalt with lane paint, gravel shoulders, wear by lap. */
export const roadFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vAux;
in float vSection;
uniform vec4 uRide;        // (speed, lapF, bank, section)
uniform float uRoadHalf;   // camera's section half width — only for the paint's edge fade
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  float s = vAux.x;
  float r = vAux.y;
  vec3 n = normalize(vNormal);
  // Two-sided: the corkscrew shows its underside from across the helix, and
  // from below it is a concrete deck, not asphalt.
  float under = step(dot(n, uCamPos - vWorld), 0.0);
  n = mix(n, -n, under);
  float lapF = uRide.y;

  // Aggregate: two scales of noise, tyre-polished toward the wheel tracks.
  vec2 uv = vec2(r, s);
  float agg = vnoise(uv * 18.0) * 0.5 + vnoise(uv * 61.0) * 0.5;
  float polish = exp(-pow((abs(r) - 1.55) * 2.2, 2.0)) * 0.35;
  vec3 asphalt = vec3(0.055, 0.056, 0.058) * (0.7 + agg * 0.6) + polish * 0.02;
  float rough = 0.86 - polish * 0.35 - agg * 0.08;

  // Wet patches and cracks arriving with the laps.
  float wet = smoothstep(0.55, 0.8, fbm(uv * 0.35 + 7.0)) * clamp(lapF * 0.5, 0.0, 1.0);
  rough = mix(rough, 0.25, wet);
  asphalt *= 1.0 - wet * 0.45;
  float crack = smoothstep(0.62, 0.66, fbm(uv * vec2(3.0, 0.8) + 31.0)) * clamp(lapF - 0.5, 0.0, 1.0);
  asphalt *= 1.0 - crack * 0.6;

  // Lane paint: a dashed centre line, solid edge lines, in metres.
  float dash = step(0.5, fract(s / 12.0));
  float centre = smoothstep(0.09, 0.06, abs(r)) * dash;
  float edge = smoothstep(0.10, 0.07, abs(abs(r) - (uRoadHalf - 0.28)));
  float paint = max(centre, edge) * step(abs(r), uRoadHalf) * (0.85 - crack * 0.5);
  vec3 paintCol = mix(vec3(0.62, 0.60, 0.55), vec3(0.75, 0.62, 0.22), centre * 0.0);
  vec3 albedo = mix(asphalt, paintCol, paint * (0.6 + 0.4 * agg));
  rough = mix(rough, 0.55, paint);

  // Shoulder: gravel, then verge.
  float shoulder = smoothstep(uRoadHalf - 0.05, uRoadHalf + 0.25, abs(r));
  vec3 gravel = vec3(0.22, 0.20, 0.17) * (0.6 + vnoise(uv * 40.0) * 0.8);
  albedo = mix(albedo, gravel, shoulder);
  rough = mix(rough, 0.95, shoulder);

  albedo = mix(albedo, vec3(0.42, 0.41, 0.39) * (0.8 + 0.4 * fbm3(vWorld * 0.3)), under);
  rough  = mix(rough, 0.85, under);
  float sh = shadowAt(vWorld, n, uSunDir);
  vec3 col = lightSurface(vWorld, n, albedo, rough, 0.0, 1.0, sh);
  col = applyFog(col, vWorld);
  fragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------
// post chain
// ---------------------------------------------------------------------------

export const brightFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uThreshold;
out vec4 fragColor;
void main () {
  vec3 c = texture(uSrc, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(c * max(l - uThreshold, 0.0) / max(l, 1e-4), 1.0);
}
`

export const blurFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 fragColor;
void main () {
  float w[5];
  w[0] = 0.2270; w[1] = 0.1946; w[2] = 0.1216; w[3] = 0.0540; w[4] = 0.0162;
  vec3 sum = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i);
    sum += texture(uSrc, vUv + o).rgb * w[i];
    sum += texture(uSrc, vUv - o).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}
`

/**
 * Composite: bloom, exposure, the ACES fit (Narkowicz 2016), a speed blur that
 * only bites in the fall, a light vignette, sRGB. lib/crtPass adds the tube and
 * the signal loss on top of whatever comes out of here.
 */
export const compositeFrag = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;   // linear multiplier
uniform float uSpeedBlur;  // 0..1
uniform float uTime;
out vec4 fragColor;
vec3 aces (vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main () {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  vec3 col;
  if (uSpeedBlur > 0.001) {
    // Radial blur toward the centre: eight taps along the ray, weighted in.
    col = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      float t = float(i) / 7.0;
      float wgt = 1.0 - t * 0.6;
      col += texture(uScene, uv - c * t * uSpeedBlur * 0.35).rgb * wgt;
      total += wgt;
    }
    col /= total;
  }
  else
    col = texture(uScene, uv).rgb;

  col += texture(uBloom, uv).rgb * 0.55;
  col *= uExposure;
  col = aces(col);
  col *= 1.0 - smoothstep(0.45, 1.15, length(c * vec2(1.0, 1.1))) * 0.30;
  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------
// the hover preview (GLSL ES 1.00 — shared WebGL1 context on the landing grid)
// ---------------------------------------------------------------------------

/**
 * Self-driving from iTime alone: a road running at the viewer under a low sun,
 * the horizon rolling like the helix, and the dashboard's arc at the bottom with
 * a needle climbing. No uniforms from the ride — the grid attaches none.
 */
export const scenicRoutePreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;

    // The world rolls: the helix, slowly.
    float roll = sin(iTime * 0.35) * 0.35;
    float cr = cos(roll), sr = sin(roll);
    vec2 w = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);

    // Sky: warm at the horizon, blue up.
    float horizon = 0.02;
    vec3 sky = mix(vec3(0.98, 0.62, 0.32), vec3(0.28, 0.42, 0.68), smoothstep(horizon, 0.6, w.y));
    float sun = smoothstep(0.08, 0.0, length(w - vec2(-0.32, 0.09)));
    sky += vec3(1.0, 0.85, 0.6) * sun * 0.9;

    // Ground with a road converging on the vanishing point.
    float depth = max(0.01, horizon - w.y);
    float persp = 0.06 / depth;
    float lane = abs(w.x) * persp;
    vec3 grass = vec3(0.16, 0.22, 0.09) * (0.7 + 0.3 * hash(floor(vec2(w.x * persp * 6.0, persp * 2.0 + iTime * 6.0))));
    vec3 road = vec3(0.09, 0.09, 0.10);
    float onRoad = smoothstep(0.36, 0.30, lane);
    float dash = step(0.5, fract(persp * 0.8 + iTime * 4.0)) * smoothstep(0.03, 0.0, lane);
    road += dash * 0.5;
    vec3 ground = mix(grass, road, onRoad);
    ground *= smoothstep(0.0, 0.12, depth) * 0.9 + 0.1;
    vec3 col = mix(ground, sky, step(horizon, w.y));
    col = mix(col, sky, smoothstep(0.0, 0.25, depth) * (1.0 - step(horizon, w.y)) * 0.55);

    // Dashboard: a dark hood and a dial with a needle.
    float hood = smoothstep(-0.34, -0.36, uv.y + uv.x * uv.x * 0.35);
    col = mix(col, vec3(0.02, 0.02, 0.025), hood);
    vec2 dc = uv - vec2(0.0, -0.52);
    float dial = smoothstep(0.17, 0.165, length(dc)) * hood;
    col = mix(col, vec3(0.05, 0.045, 0.04), dial);
    float ang = -2.4 + 3.6 * (0.55 + 0.45 * sin(iTime * 0.6));
    vec2 nd = vec2(cos(ang), sin(ang));
    float needle = smoothstep(0.006, 0.0, abs(dot(dc, vec2(-nd.y, nd.x)))) * step(0.0, dot(dc, nd)) * step(dot(dc, nd), 0.14) * hood;
    col = mix(col, vec3(1.0, 0.45, 0.15), needle);
    float ring = smoothstep(0.012, 0.0, abs(length(dc) - 0.15)) * hood;
    col += vec3(1.0, 0.66, 0.3) * ring * 0.35;

    col *= smoothstep(1.1, 0.35, length(uv));
    col -= sin(gl_FragCoord.y * 1.5 + iTime * 10.0) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
