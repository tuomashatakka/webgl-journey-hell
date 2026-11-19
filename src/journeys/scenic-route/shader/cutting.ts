import { brdfChunk, deltaChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './chunks'
import { bankChunk } from './world'

// ---------------------------------------------------------------------------
// the incline's rock cutting and retaining walls (cutting.ts)
// ---------------------------------------------------------------------------

/**
 * The sweep's vertices, rolled only at the foot. The ditch and the bottom of
 * the face follow the road's bank, as the road does; from five metres up the
 * face stays in the level frame, where the land behind it is. A banked lap
 * therefore bends the face a little instead of tipping it out of the ground.
 */
export const cutVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec4 aSpine;   // spine xyz, s
layout(location = 1) in vec4 aRight;   // level right xyz, r
layout(location = 2) in vec4 aUp;      // level up xyz, u
layout(location = 3) in vec4 aAux;     // normal2d (r,u), edge param, the top edge's edge param (signed by side)
uniform mat4 uViewProj;
uniform float uWallFrom;   // arc length where the rock gives way to the walls
${bankChunk}
${noiseChunk}
out vec3 vWorld;
out vec3 vNormal;
out vec4 vAux;    // s, r, u, edge
out float vTop;
void main () {
  float roll = bankAt(aSpine.w);
  float c = cos(roll), sn = sin(roll);
  vec3 R = aRight.xyz * c - aUp.xyz * sn;
  vec3 U = aUp.xyz * c + aRight.xyz * sn;
  float k = 1.0 - smoothstep(0.0, 5.0, aUp.w);
  vec3 level  = aSpine.xyz + aRight.xyz * aRight.w + aUp.xyz * aUp.w;
  vec3 rolled = aSpine.xyz + R * aRight.w + U * aUp.w;
  vec3 world  = mix(level, rolled, k);
  vNormal = normalize(mix(aRight.xyz * aAux.x + aUp.xyz * aAux.y, R * aAux.x + U * aAux.y, k));
  // Blasted rock is not a plane: the face between its foot and its top edge
  // is pushed in and out in blocks, and shaded flat per facet downstream.
  float rel  = aAux.w >= 0.0 ? aAux.z - aAux.w : -aAux.w - aAux.z;
  float rock = 1.0 - smoothstep(uWallFrom - 1.0, uWallFrom, aSpine.w);
  float bulk = smoothstep(0.0, 1.2, aUp.w) * (1.0 - smoothstep(-0.8, -0.1, rel)) * rock;
  float d = (vnoise3(level * 0.4) - 0.5) * 1.4 + (vnoise3(level * 0.83 + 7.0) - 0.5) * 0.35;
  world += vNormal * d * bulk;
  vWorld = world;
  vAux = vec4(aSpine.w, aRight.w, aUp.w, aAux.z);
  vTop = aAux.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`

/**
 * Rock, then concrete, from uWallFrom on. The rock is Δ's stratified scan with
 * bedding across it, presplit drill traces down it (the half-barrels a blasted
 * road cut keeps), seeps and iron stain running from the bench and the lip,
 * and scree in the ditch. The walls are shuttered concrete in 7.5 m bays with
 * board marks, weep holes and the lime and grime they bleed, a coping, and a
 * damp foot. Turf on the benches and behind the top, turning with the season.
 */
export const cutFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vAux;
in float vTop;
uniform vec4 uRide;        // (speed, lapF, bank, section)
uniform float uWallFrom;   // arc length where the rock gives way to the walls
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
${deltaChunk}
void main () {
  vec3 p = vWorld;
  float s = vAux.x;
  float u = vAux.z;
  // Distance along the cross-section past the face's top edge: negative on
  // the face and in the ditch, the coping just past zero, turf beyond.
  float rel = vTop >= 0.0 ? vAux.w - vTop : -vTop - vAux.w;
  vec3 n = normalize(vNormal);
  if (dot(n, uCamPos - p) < 0.0) n = -n;
  float dist = length(p - uCamPos);
  float near = 1.0 - smoothstep(25.0, 70.0, dist);
  float lapF = uRide.y;

  float wall  = smoothstep(uWallFrom - 0.6, uWallFrom + 0.6, s);
  // The rock face is shaded per facet, as blasted rock breaks.
  vec3 nf = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(nf, uCamPos - p) < 0.0) nf = -nf;
  float blocky = (1.0 - wall) * smoothstep(0.3, 1.2, u) * (1.0 - smoothstep(-0.8, -0.1, rel)) * (1.0 - smoothstep(0.7, 0.9, n.y));
  n = normalize(mix(n, nf, blocky * 0.85));
  float ditch = (1.0 - smoothstep(-0.32, -0.12, u)) * step(rel, 0.0);
  float flat_ = smoothstep(0.55, 0.85, n.y);
  float turf  = max(smoothstep(0.45 + 0.4 * wall, 0.9 + 0.4 * wall, rel), flat_ * (1.0 - ditch) * step(rel, 0.0) * (1.0 - wall));
  float face  = (1.0 - turf) * (1.0 - ditch);

  // --- rock ----------------------------------------------------------------
  Surface sR = sampleTriplanar(MAT_ROCK, p, n, 4.0);
  // Beds dipping gently along the road, each its own shade, a parting
  // between them.
  float bed  = p.y * 0.42 + s * 0.03 + fbm3(p * 0.07) * 1.6;
  float band = hash12(vec2(floor(bed), 3.0));
  // Freshly blasted, so paler than the weathered rock on the hillsides.
  vec3 rock  = sR.albedo * vec3(1.2, 1.15, 1.08) * mix(vec3(0.82, 0.8, 0.78), vec3(1.08, 1.0, 0.9), band);
  float part = 1.0 - smoothstep(0.0, 0.05, min(fract(bed), 1.0 - fract(bed)));
  rock *= 1.0 - 0.4 * part * near;
  // Presplit traces: a drill hole every 0.9 m, vertical, split in half by the
  // blast; long runs of them survive, broken where the rock came away.
  float tx    = (fract(s / 0.9) - 0.5) * 0.9;
  float keep  = step(0.42, vnoise(vec2(s * 0.6, u * 0.3 + 7.0)));
  float trace = (1.0 - smoothstep(0.022, 0.045, abs(tx))) * keep * near * (1.0 - flat_);
  vec3 along  = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0));
  // Seeps and iron stain: water runs down from the bench and the lip.
  float seep = smoothstep(0.58, 0.78, vnoise(vec2(s * 0.42, u * 0.05 + 3.0)));
  float iron = smoothstep(0.55, 0.8, vnoise(vec2(s * 0.9 + 40.0, u * 0.08)));
  rock = mix(rock, rock * vec3(1.25, 0.82, 0.52), iron * 0.45);
  rock *= mix(1.0, 0.5, seep);
  rock *= 1.0 - 0.45 * trace;

  // --- concrete ------------------------------------------------------------
  Surface sC = sampleTriplanar(MAT_PANEL, p, n, 4.0);
  float bay  = floor(s / 7.5);
  vec3 conc  = sC.albedo * vec3(0.98, 0.96, 0.92) * (0.88 + 0.2 * hash12(vec2(bay, 9.0)));
  float jx    = (fract(s / 7.5 + 0.5) - 0.5) * 7.5;
  float joint = 1.0 - smoothstep(0.02, 0.05, abs(jx));
  float board = 1.0 - smoothstep(0.0, 0.025, abs(fract(u / 0.3) - 0.5) * 0.3 - 0.13);
  conc *= 1.0 - 0.06 * board * near;
  // Weep holes in a row near the foot, and what they bleed down the face.
  float wx    = (fract(s / 2.5) - 0.5) * 2.5;
  float hole  = 1.0 - smoothstep(0.035, 0.055, length(vec2(wx, u - 0.75)));
  float bleed = (1.0 - smoothstep(0.015, 0.05 + 0.05 * vnoise(vec2(s * 3.0, u * 2.0)), abs(wx))) * step(u, 0.75) * smoothstep(-0.3, 0.7, u);
  conc = mix(conc, conc * vec3(0.55, 0.5, 0.42), bleed * 0.5);
  // Grime from the coping down, heavier toward the top; a damp foot.
  float grime = vnoise(vec2(s * 1.7, u * 0.1 + 11.0)) * smoothstep(0.5, 3.0, u);
  conc *= 1.0 - 0.35 * smoothstep(0.45, 0.85, grime);
  float foot = (1.0 - smoothstep(0.0, 0.9, u + 0.3 * vnoise(vec2(s * 0.8, 2.0))));
  conc = mix(conc, vec3(0.07, 0.085, 0.045) * (0.8 + 0.4 * vnoise(p.xz * 2.0)), foot * 0.6);
  conc *= 1.0 - 0.55 * joint - 0.85 * hole;
  // The coping: a lighter cap, the first half metre past the top edge.
  float cope = step(-0.02, rel) * (1.0 - smoothstep(0.5, 0.6, rel));
  conc = mix(conc, sC.albedo * 1.12, cope * 0.8);

  // --- the ditch and the turf -------------------------------------------------
  Surface sB = sampleTriplanar(MAT_BALLAST, p, n, 4.0);
  vec3 scree = mix(sB.albedo * 0.8, rock * 0.9, (1.0 - wall) * 0.5);
  float macro = fbm(p.xz * 0.0024 + 11.0);
  vec3 grass = mix(vec3(0.075, 0.15, 0.04), vec3(0.15, 0.21, 0.06), smoothstep(0.35, 0.65, macro));
  grass *= 0.72 + 0.56 * (vnoise(p.xz * 1.7) * 0.6 + vnoise(p.xz * 6.3) * 0.4);
  vec3 heath = mix(vec3(0.15, 0.14, 0.065), vec3(0.15, 0.09, 0.11), smoothstep(0.5, 0.7, fbm(p.xz * 0.011 + 2.0)));
  grass = mix(grass, heath * (0.8 + 0.4 * vnoise(p.xz * 0.2)), smoothstep(25.0, 80.0, p.y) * 0.85);
  vec3 fall_ = grass * vec3(1.45, 1.05, 0.55) + vec3(0.04, 0.02, 0.0);
  grass = mix(grass, fall_, autumnAt() * 0.85);
  vec3 ash = vec3(0.075, 0.07, 0.066) * (0.7 + 0.6 * vnoise(p.xz * 0.7));
  grass = mix(grass, ash, deadAt() * 0.9);

  vec3 albedo = mix(rock, conc, wall);
  albedo = mix(albedo, scree, ditch);
  albedo = mix(albedo, grass, turf);
  float rough = mix(mix(0.82, 0.88, wall), 0.95, max(ditch, turf));
  rough = mix(rough, 0.45, seep * face * (1.0 - wall));
  float wet = rainAt();
  albedo *= 1.0 - 0.3 * wet * (1.0 - turf);
  rough  *= 1.0 - 0.45 * wet;

  // Normals: the scans' relief, the traces as grooves across the face.
  vec3 nn = normalize(mix(n, mix(sR.normal, sC.normal, wall), face * near * 0.85));
  nn = normalize(mix(nn, sB.normal, ditch * near * 0.7));
  nn = normalize(nn - along * (tx / 0.045) * 0.6 * trace * face * (1.0 - wall));
  nn = normalize(nn + along * sign(jx) * joint * 0.5 * face * wall);

  // The foot of a face sees less sky, the ditch less again.
  float ao = mix(0.55, 1.0, smoothstep(-0.6, 3.5, u)) * (1.0 - 0.25 * ditch) * mix(1.0, sR.ao, face * (1.0 - wall));
  float sh = shadowAt(p, nn, uSunDir);
  vec3 col = lightSurface(p, nn, albedo, rough, 0.0, ao, sh);
  // The red under the road is under the hill too: from the second lap it
  // shows in the rock's joints and between the wall's bays.
  float vein = (1.0 - smoothstep(0.0, 0.012, abs(fbm3(p * vec3(0.18, 0.5, 0.18)) - 0.5))) * (1.0 - wall);
  float hell = smoothstep(1.0, 1.6, lapF) * face;
  col += vec3(12.0, 0.18, 0.04) * (vein * 0.2 + joint * wall * 0.25) * hell * (0.75 + 0.25 * sin(uTime * 3.0 + s * 0.2));
  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`
