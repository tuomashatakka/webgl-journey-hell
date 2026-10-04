import { brdfChunk, noiseChunk, skyLookupChunk } from './chunks'

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
