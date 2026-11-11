import { brdfChunk, deltaChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './chunks'

/** Skin, flesh, teeth and the lights the fish carries, shared by every part of it. */
const mawMaterialChunk = /* glsl */`
// Cellular plates: distance to the nearest of a jittered grid of centres, and
// to the second nearest, so the edges between plates can be cut in as seams.
vec2 plates (vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash12(i + g), hash12(i + g + 17.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  return vec2(d1, d2 - d1);
}

// The hide: near-black and oily, plated, scarred, crusted with barnacles up
// top, pale toward the belly.
vec3 skinAlbedo (vec3 p, float belly, out float seam, out float crust) {
  vec2 pl = plates(p.xz * 0.16 + p.y * 0.07);
  seam = 1.0 - smoothstep(0.02, 0.09, pl.y);
  vec3 dark = vec3(0.016, 0.022, 0.024);
  vec3 pale = vec3(0.22, 0.21, 0.18);
  vec3 c = mix(dark, pale, belly);
  c *= 0.7 + 0.6 * fbm3(p * 0.11);
  c = mix(c, c * vec3(1.6, 0.8, 0.7), smoothstep(0.62, 0.75, fbm3(p * 0.05 + 4.0)) * 0.6);   // old wounds
  c *= 1.0 - 0.6 * seam;
  float scar = smoothstep(0.03, 0.0, abs(fbm3(p * vec3(0.02, 0.09, 0.02)) - 0.5)) * 0.8;
  c = mix(c, vec3(0.25, 0.2, 0.19), scar);
  crust = smoothstep(0.7, 0.76, vnoise3(p * 0.6)) * smoothstep(0.5, 0.7, fbm3(p * 0.04)) * (1.0 - belly);
  c = mix(c, vec3(0.2, 0.19, 0.16) * (0.5 + 0.7 * vnoise3(p * 3.0)), crust);
  return c;
}

// Inside: raw, veined, wet, darker the deeper it goes.
vec3 fleshAlbedo (vec3 p) {
  float veins = smoothstep(0.035, 0.0, abs(fbm3(p * 0.22) - 0.5)) + 0.6 * smoothstep(0.03, 0.0, abs(fbm3(p * 0.6 + 3.0) - 0.5));
  vec3 c = mix(vec3(0.16, 0.022, 0.03), vec3(0.36, 0.07, 0.07), fbm3(p * 0.35));
  c *= 0.7 + 0.6 * vnoise(p.xz * 1.7 + p.y);
  c = mix(c, vec3(0.08, 0.005, 0.03), clamp(veins, 0.0, 1.0) * 0.8);
  return c;
}

// Photophores: rows of lights in the hide, pulsing in a wave that runs toward
// the mouth, the way a lure says come here. q is (metres back from the lip,
// metres round the head).
float photophores (vec2 q, float time) {
  vec2 cell = floor(q / vec2(5.5, 4.0));
  vec2 f = fract(q / vec2(5.5, 4.0)) - 0.5;
  float h = hash12(cell + 3.0);
  float spot = smoothstep(0.22, 0.08, length(f + (vec2(hash12(cell), hash12(cell + 9.0)) - 0.5) * 0.4)) * step(0.45, h);
  float wave = 0.5 + 0.5 * sin(q.x * 0.22 + time * 4.0 + h * 2.0);
  return spot * (0.25 + 0.75 * wave * wave);
}
// The same lights where there is no surface frame to lay a grid in: spots
// on a 3D lattice, the wave running along the lattice's own x.
float photophores3 (vec3 p, float time) {
  vec3 cell = floor(p / 3.2);
  vec3 f = fract(p / 3.2) - 0.5;
  float h = hash13(cell);
  float spot = smoothstep(0.2, 0.06, length(f)) * step(0.6, h);
  float wave = 0.5 + 0.5 * sin(dot(cell, vec3(0.7, 0.4, 0.5)) + time * 4.0);
  return spot * (0.25 + 0.75 * wave * wave);
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
    float seam, crust;
    albedo = skinAlbedo(p, belly, seam, crust);
    rough = mix(0.14, 0.7, crust);
    // The plates' seams cut into the normal, so the wet hide breaks the light
    // into scales instead of mirroring the sky in one sheet.
    n = normalize(n + (vec3(fbm3(p * 0.4), fbm3(p * 0.4 + 5.0), fbm3(p * 0.4 + 9.0)) - 0.5) * (0.5 + 0.8 * seam));

    // Eyes: a cluster each side, high and a little back from the lip, all
    // burning, all blinking out of step, slit pupils that dilate and twitch.
    float r = 40.0;
    // The last three sit on the crown, a spider's cluster above the mouth,
    // because that is the face the falling car looks down at.
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      vec3 E = k == 0 ? vec3(24.0, 0.35, 7.6) : k == 1 ? vec3(35.0, 0.62, 4.6) : k == 2 ? vec3(14.0, 0.66, 3.4)
             : k == 3 ? vec3(40.0, 0.2, 3.0) : k == 4 ? vec3(10.0, 1.32, 5.2) : k == 5 ? vec3(20.0, 1.12, 4.0) : vec3(19.0, 1.5, 3.2);
      float dA = min(abs(ang - E.y), abs(ang - (PI - E.y)));
      float side = cos(ang) > 0.0 ? 0.0 : 1.0;
      vec2 q = vec2(t - E.x, dA * r);
      float d = length(q);
      float lidT = fract(uTime * (0.13 + 0.05 * fk) + fk * 0.31 + side * 0.17);
      float lid = smoothstep(0.0, 0.02, lidT) * smoothstep(0.075, 0.05, lidT);   // 1 while shut
      float eyeW = smoothstep(E.z, E.z * 0.85, d) * step(0.3, abs(cos(ang)));
      vec2 look = vec2(sin(uTime * 1.3 + fk * 2.0), sin(uTime * 0.9 + fk)) * E.z * 0.12;
      vec2 qp = q - look;
      float dil = 0.18 + 0.12 * sin(uTime * 0.7 + fk);
      float pupil = smoothstep(1.0, 0.7, length(qp * vec2(1.0 / (E.z * dil), 1.0 / (E.z * 0.8))));
      float iris = smoothstep(E.z * 0.85, 0.0, d);
      vec3 eyeCol = mix(vec3(1.0, 0.45, 0.05), vec3(1.0, 0.9, 0.35), iris);
      albedo = mix(albedo, vec3(0.03), eyeW);
      emit += eyeCol * eyeW * (1.0 - pupil) * (1.0 - lid) * (3.0 + 2.0 * iris);
      rough = mix(rough, 0.05, eyeW * (1.0 - lid));
    }

    // Photophores along the flanks and round the lip, cold blue-green.
    float pp = photophores(vec2(t, ang * r), uTime) * (1.0 - belly * 0.7) * step(abs(sin(ang)), 0.75);
    pp += photophores(vec2(t * 2.3 + 40.0, ang * r * 1.4), uTime + 1.7) * (1.0 - smoothstep(4.0, 12.0, t));
    emit += vec3(0.25, 0.95, 0.85) * pp * 4.0;
  } else {
    albedo = fleshAlbedo(p);
    rough = 0.16;
    // The mouth breathes: a slow pulse of blood in the flesh.
    emit = albedo * vec3(1.6, 0.25, 0.2) * (0.15 + 0.12 * sin(uTime * 1.8 - t * 0.1));
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
uniform float uTime;
void main () {
  // The flesh quivers: lips and gums (uv.x under 1.5) tremble on their own
  // noise; teeth and the lure are rigid.
  vec3 a = aPos;
  if (aUv.x < 1.5)
    a += aNormal * (sin(uTime * 7.0 + dot(aPos, vec3(0.13, 0.17, 0.11))) * 0.25 + sin(uTime * 2.3 + aPos.y * 0.05) * 0.4) * aUv.y;
  vec3 p = uHinge + uOffset + rotAxis(a - uHinge, uAxis, uJaw);
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
  vec3 emit = vec3(0.0);
  if (vUv.x > 4.5) {
    // Slime: pale, glassy, catching the light along its length.
    albedo = vec3(0.32, 0.36, 0.22) * (0.8 + 0.4 * vnoise(vec2(vUv.x * 3.0, uTime)));
    rough = 0.06;
    emit = vec3(0.05, 0.12, 0.08) * (0.5 + 0.5 * sin(vUv.x * 14.0 - uTime * 3.0));
  } else if (vUv.x > 3.5) {
    // The lure's bulb: a lamp of living light, pulsing, hottest at its heart.
    float beat = 0.6 + 0.4 * sin(uTime * 2.4) * sin(uTime * 0.7 + 1.0);
    albedo = vec3(0.6, 0.9, 0.8);
    rough = 0.1;
    emit = mix(vec3(0.1, 0.9, 0.7), vec3(0.6, 1.0, 0.85), beat * beat) * (1.6 + 1.8 * beat) * (0.6 + 0.7 * fbm3(p * 1.5 + uTime * 0.5));
  } else if (vUv.x > 1.5) {
    // Fangs: dark and bloody at the gum, yellowed ivory up the shaft, the tip
    // glassy where the enamel thins.
    float t = vUv.y;
    albedo = mix(vec3(0.2, 0.05, 0.04), vec3(0.62, 0.52, 0.33), smoothstep(0.0, 0.3, t));
    albedo = mix(albedo, vec3(0.86, 0.82, 0.7), smoothstep(0.55, 1.0, t));
    albedo *= 0.75 + 0.35 * fbm3(p * vec3(2.5, 0.6, 2.5));
    rough = mix(0.4, 0.12, t);
  } else if (vUv.x > 0.5) {
    albedo = fleshAlbedo(p);
    // Gums: darker and bruised toward the lip where the teeth come through.
    albedo = mix(albedo, albedo * vec3(0.55, 0.35, 0.6), smoothstep(0.3, 0.9, vUv.y));
    rough = 0.16;
    emit = albedo * vec3(1.4, 0.2, 0.18) * 0.12;
  } else {
    float seam, crust;
    albedo = skinAlbedo(p, 0.15, seam, crust);
    rough = mix(0.14, 0.7, crust);
    n = normalize(n + (vec3(fbm3(p * 0.4), fbm3(p * 0.4 + 5.0), fbm3(p * 0.4 + 9.0)) - 0.5) * (0.5 + 0.8 * seam));
    // Photophores rimming the lip.
    emit = vec3(0.25, 0.95, 0.85) * photophores3(p, uTime) * 3.0;
  }
  if (dot(n, uCamPos - p) < 0.0 && vUv.x > 4.5) n = -n;
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, 0.0, 1.0, sh) + emit;
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
${deltaChunk}
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
  // The aggregate under the binder, and the ballast on the shoulder, are Δ scans.
  Surface sRoad = sampleTriplanar(MAT_CONCRETE, vWorld, n, 4.0);
  Surface sBal = sampleTriplanar(MAT_BALLAST, vWorld, n, 4.0);
  asphalt *= 0.55 + 0.9 * dot(sRoad.albedo, vec3(0.333));
  n = normalize(mix(n, sRoad.normal, 0.45));
  float rough = 0.86 - polish * 0.35 - agg * 0.08;

  // Wet patches and cracks arriving with the laps.
  float wet = smoothstep(0.55, 0.8, fbm(uv * 0.35 + 7.0)) * clamp(lapF * 0.5, 0.0, 1.0);
  rough = mix(rough, 0.25, wet);
  asphalt *= 1.0 - wet * 0.45;
  // From the second lap the cracks open wider every lap, and what is under them glows.
  float worse = clamp(lapF - 1.0, 0.0, 2.0);
  float crack = smoothstep(0.62 - 0.05 * worse, 0.66, fbm(uv * vec2(3.0, 0.8) + 31.0)) * clamp(lapF - 0.5, 0.0, 1.0);
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
  vec3 gravel = mix(vec3(0.22, 0.20, 0.17) * (0.6 + vnoise(uv * 40.0) * 0.8), sBal.albedo * 0.85, 0.75);
  albedo = mix(albedo, gravel, shoulder);
  rough = mix(rough, 0.95, shoulder);

  albedo = mix(albedo, sRoad.albedo * (0.8 + 0.4 * fbm3(vWorld * 0.3)), under);
  rough  = mix(rough, 0.85, under);
  float sh = shadowAt(vWorld, n, uSunDir);
  vec3 col = lightSurface(vWorld, n, albedo, rough, 0.0, 1.0, sh);
  // Red under the road: the cracks and the potholes leak it from the second
  // lap, more every lap after. Bright enough in red alone to clear the bloom
  // threshold, so the post pass can carry it into the air as shafts.
  float hell = smoothstep(0.8, 1.3, lapF) * (1.0 + 1.5 * worse);
  col += vec3(12.0, 0.18, 0.04) * (crack * 0.8 + pot * 0.6) * hell * (1.0 - under) * (0.75 + 0.25 * sin(uTime * 3.0 + s * 0.2));
  col = applyFog(col, vWorld);
  fragColor = vec4(col, 1.0);
}
`

/**
 * Slime between the jaws: each strand's two anchors are carried by their own
 * jaw's rotation, and the strand hangs between them in a sagging curve that
 * thins as it stretches and sways on its own. A ribbon turned to the camera.
 */
export const strandVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;      // anchor on the upper jaw
layout(location = 1) in vec3 aNormal;   // anchor on the lower jaw
layout(location = 2) in vec2 aUv;       // along, side * width
uniform mat4  uViewProj;
uniform vec3  uHingeU;
uniform vec3  uHingeL;
uniform vec3  uAxis;
uniform float uJawU;
uniform float uJawL;
uniform vec3  uOffset;
uniform vec3  uCamPos;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
vec3 rotAxis (vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main () {
  vec3 U = uHingeU + rotAxis(aPos - uHingeU, uAxis, uJawU) + uOffset;
  vec3 L = uHingeL + rotAxis(aNormal - uHingeL, uAxis, uJawL) + uOffset;
  float t = aUv.x;
  vec3 d = L - U;
  float span = length(d);
  float seed = dot(aPos, vec3(0.031, 0.017, 0.023));
  vec3 p = U + d * t;
  float bow = 4.0 * t * (1.0 - t);
  p += vec3(0.0, -1.0, 0.0) * bow * span * 0.12;
  p += uAxis * bow * sin(uTime * 1.7 + seed * 40.0) * span * 0.06;
  vec3 tan = normalize(d + vec3(0.0, -1.0, 0.0) * (1.0 - 2.0 * t) * span * 0.48);
  vec3 side = normalize(cross(tan, normalize(uCamPos - p)));
  float w = abs(aUv.y) * mix(1.0, 0.3, bow) * clamp(28.0 / span, 0.3, 1.2);
  p += side * sign(aUv.y) * w;
  vWorld = p;
  vNormal = normalize(cross(side, tan));
  vUv = vec2(5.0 + t, aUv.y);
  gl_Position = uViewProj * vec4(p, 1.0);
}
`
