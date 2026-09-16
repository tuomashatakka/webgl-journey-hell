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
const float K_M   = 21e-6;
const float H_R   = 8000.0;
const float H_M   = 1200.0;
const float G_M   = 0.758;
const float I_SUN = 22.0;

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
 * Per-fragment lighting shared by every world material: sun through the BRDF,
 * sky ambient at the normal, then fog toward the sky in the view direction.
 */
const lightingChunk = /* glsl */`
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec4  uEnv;        // (exposure EV, sky weight, fog density, water level)
uniform vec3  uFogCol;
uniform float uTime;

vec3 lightSurface (vec3 p, vec3 n, vec3 albedo, float rough, float metal, float ao) {
  vec3 v = normalize(uCamPos - p);
  vec3 sunCol = sunRadiance();
  vec3 col = shade(n, v, uSunDir, albedo, rough, metal, sunCol);
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
  vec3 fogCol = mix(uFogCol, skyLookup(vec3(rd.x, max(rd.y, 0.015), rd.z)), uEnv.y);
  float f = 1.0 - exp(-dist * uEnv.z);
  return mix(col, fogCol, f);
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
${lightingChunk}
void main () {
  float s = vAux.x;
  float r = vAux.y;
  vec3 n = normalize(vNormal);
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

  vec3 col = lightSurface(vWorld, n, albedo, rough, 0.0, 1.0);
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
