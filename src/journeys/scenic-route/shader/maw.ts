import { brdfChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './chunks'

/** Skin and flesh, shared by the head and the jaws. */
const mawMaterialChunk = /* glsl */`
vec3 skinAlbedo (vec3 p, float belly) {
  float scales = vnoise(p.xz * 0.9 + p.y * 0.4) * 0.5 + vnoise(p.xy * 2.3 + p.z) * 0.5;
  vec3 dark = vec3(0.028, 0.045, 0.045);
  vec3 pale = vec3(0.28, 0.28, 0.24);
  vec3 c = mix(dark, pale, belly);
  c *= 0.75 + 0.5 * scales;
  c += vec3(0.02, 0.05, 0.03) * fbm3(p * 0.06);
  return c;
}
vec3 fleshAlbedo (vec3 p) {
  float veins = fbm3(p * 0.35);
  vec3 c = mix(vec3(0.19, 0.035, 0.03), vec3(0.34, 0.08, 0.07), veins);
  c *= 0.7 + 0.6 * vnoise(p.xz * 1.7 + p.y);
  return c;
}
`

/**
 * The head: the sweep layout, front faces skin, back faces the mouth. Eyes by
 * arc length and profile angle, lit from inside.
 */
export const mawFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vAux;
in float vSection;
uniform float uMouthS;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
${mawMaterialChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  float t = vAux.x - uMouthS;
  float ang = atan(vAux.z, vAux.y);        // profile angle, 0 = right, pi/2 = up
  vec3 albedo;
  float rough;
  vec3 emit = vec3(0.0);
  // This sweep's front faces point inward: the front is the mouth.
  if (!gl_FrontFacing) {
    float belly = smoothstep(-0.2, -0.95, sin(ang));
    albedo = skinAlbedo(p, belly);
    rough = 0.18;
    // Eyes: two, high on the sides, a little back from the lip.
    float side = abs(cos(ang));
    // One eye each side: angles 0.35 (right, a little up) and pi - 0.35 (left).
    float dAng = min(abs(ang - 0.35), abs(ang - (PI - 0.35)));
    vec2 eyeUv = vec2(t - 24.0, dAng * 30.0);
    float eye = length(eyeUv);
    float eyeW = smoothstep(9.0, 7.4, eye) * step(0.4, side);
    float pupil = smoothstep(3.6, 2.6, eye);
    albedo = mix(albedo, vec3(0.9, 0.75, 0.2), eyeW);
    albedo = mix(albedo, vec3(0.01), pupil);
    emit = vec3(1.0, 0.7, 0.15) * eyeW * (1.0 - pupil) * 2.6;
    rough = mix(rough, 0.08, eyeW);
  } else {
    albedo = fleshAlbedo(p);
    rough = 0.22;
  }
  if (dot(n, uCamPos - p) < 0.0) n = -n;
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, 0.0, 1.0, sh) + emit;
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/**
 * The tube: flesh for the first stretch past the mouth, rock after, the two
 * traded by a noisy threshold so the change is ragged, not a seam. Ribs in the
 * flesh, relief in the rock, a wet band at the waterline.
 */
export const tubeFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vAux;
in float vSection;
uniform float uMouthS;
uniform vec2  uFleshRock;   // flesh end, rock start (metres past the mouth)
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
${mawMaterialChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  if (dot(n, uCamPos - p) < 0.0) n = -n;
  float t = vAux.x - uMouthS;
  float fleshW = 1.0 - smoothstep(uFleshRock.x, uFleshRock.y, t);
  float ragged = fbm3(p * 0.045) - 0.5;
  float flesh  = smoothstep(0.35, 0.65, fleshW + ragged * 0.9);

  // Rock: the terrain's rock, plus relief from its own noise.
  vec3 rock = vec3(0.26, 0.24, 0.22) * (0.55 + 0.7 * fbm3(p * 0.09));
  rock = mix(rock, vec3(0.32, 0.27, 0.2), smoothstep(0.4, 0.7, fbm3(p * 0.02 + 3.0)));
  float e = 0.5;
  float h0 = fbm3(p * 0.3);
  vec3 g = vec3(fbm3((p + vec3(e, 0, 0)) * 0.3) - h0, fbm3((p + vec3(0, e, 0)) * 0.3) - h0, fbm3((p + vec3(0, 0, e)) * 0.3) - h0) / e;
  g -= n * dot(g, n);
  vec3 nRock = normalize(n - g * 0.7);

  // Flesh: ribs every few metres, glistening.
  float rib = 0.5 + 0.5 * sin(vAux.x * 1.6 + fbm3(p * 0.2) * 3.0);
  vec3 fleshCol = fleshAlbedo(p) * (0.55 + 0.4 * rib);
  vec3 nFlesh = normalize(n + vec3(0.0, 0.0, 0.0) + (fbm3(p * 0.6) - 0.5) * 0.3);

  vec3 albedo = mix(rock, fleshCol, flesh);
  vec3 nn = normalize(mix(nRock, nFlesh, flesh));
  float rough = mix(0.85, 0.42, flesh);
  // Wet below and near the waterline (u near zero and below).
  float wet = smoothstep(2.5, -1.0, vAux.z);
  rough = mix(rough, 0.18, wet * (1.0 - flesh));
  albedo *= 1.0 - 0.35 * wet * (1.0 - flesh);

  float sh = shadowAt(p, nn, uSunDir);
  vec3 col = lightSurface(p, nn, albedo, rough, 0.0, 0.8, sh);
  // A faint living glow in the flesh, brighter along the ribs.
  col += fleshCol * vec3(0.9, 0.3, 0.25) * 0.12 * flesh * rib;
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/** The water in the tube: dark, flowing, mirroring the headlamps and the walls' glow by fog colour. */
export const waterFrag = /* glsl */`#version 300 es
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
  vec3 p = vWorld;
  vec3 n0 = normalize(vNormal);
  if (n0.y < 0.0) n0 = -n0;
  // Flow along the spine: ripples travelling in s, wobbling across.
  vec2 q = vec2(vAux.x * 0.35 - uTime * 1.4, vAux.y * 0.5);
  float e = 0.3;
  float h0 = fbm(q) + 0.5 * vnoise(q * 3.1 + uTime * 0.7);
  float hs = fbm(q + vec2(e, 0.0)) + 0.5 * vnoise((q + vec2(e, 0.0)) * 3.1 + uTime * 0.7) - h0;
  float hr = fbm(q + vec2(0.0, e)) + 0.5 * vnoise((q + vec2(0.0, e)) * 3.1 + uTime * 0.7) - h0;
  vec3 n = normalize(n0 + vec3(hr, 0.0, hs) * 0.3);
  vec3 v = normalize(uCamPos - p);
  float NoV = max(dot(n, v), 0.0);
  vec3 F = F_Schlick(NoV, vec3(0.02));
  vec3 body = vec3(0.02, 0.035, 0.03);
  vec3 col = lightSurface(p, n, body, 0.08, 0.0, 1.0, 1.0);
  // The walls' glow, mirrored: the fog colour stands in for the reflected cave.
  col += uFogCol * F * 0.8;
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`

/** A jaw shell rotates about its hinge by the lap's jaw angle. */
export const jawVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4  uViewProj;
uniform vec3  uHinge;
uniform vec3  uAxis;
uniform float uJaw;
uniform vec3  uOffset;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
vec3 rotAxis (vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main () {
  vec3 p = uHinge + uOffset + rotAxis(aPos - uHinge, uAxis, uJaw);
  vec3 n = rotAxis(aNormal, uAxis, uJaw);
  vWorld = p;
  vNormal = n;
  vUv = aUv;
  gl_Position = uViewProj * vec4(p, 1.0);
}
`

/** Jaw shells and teeth: uv.x tags a tooth; facing tells skin from flesh. */
export const jawFrag = /* glsl */`#version 300 es
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
${mawMaterialChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo;
  float rough;
  if (vUv.x > 1.5) {
    albedo = mix(vec3(0.55, 0.45, 0.3), vec3(0.85, 0.8, 0.66), vUv.y) * (0.85 + 0.3 * fbm3(p * 1.3));
    rough = 0.3;
  } else if (vUv.x > 0.5) {
    albedo = fleshAlbedo(p);
    rough = 0.22;
  } else {
    albedo = skinAlbedo(p, 0.15);
    rough = 0.32;
  }
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, 0.0, 1.0, sh);
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
uniform vec4 uRide;        // (speed, lapF, bank, section)
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
void main () {
  // Panels go missing by lap: a 4 m bay is gone once its hash falls under the
  // lap's share, so the rail thins toward the end of the ride.
  float bay = floor(vAux.x / 4.0);
  if (hash12(vec2(bay, 3.0)) < clamp((uRide.y - 0.7) * 0.22, 0.0, 0.6)) discard;
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
  // Potholes from the second lap: dark, rough, with a lip that catches the light.
  float potN = fbm(uv * vec2(0.9, 0.35) + 57.0);
  float pot = smoothstep(0.58, 0.68, potN) * clamp(lapF - 0.8, 0.0, 1.0) * step(abs(r), uRoadHalf);
  float lip = smoothstep(0.52, 0.58, potN) * (1.0 - smoothstep(0.58, 0.64, potN)) * clamp(lapF - 0.8, 0.0, 1.0);
  asphalt = mix(asphalt, vec3(0.028, 0.026, 0.024), pot * 0.85) * (1.0 + lip * 0.5);
  rough = mix(rough, 0.95, pot);

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
