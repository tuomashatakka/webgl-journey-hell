// THE LOOP LINE — shaders.
//
// Two entirely separate things live in this file, written against two different
// versions of GLSL, and the reason is worth stating because it looks like an
// inconsistency:
//
//   * `loopLineVert` / `loopLineFrag` are **GLSL ES 3.00** (`#version 300 es`).
//     They are the real journey: a rasterized forward pass over actual
//     triangles, run on the WebGL2 context withGeometryJourney asks for.
//
//   * `loopLinePreviewFrag` is **GLSL ES 1.00**, no version directive. It is the
//     landing-grid hover preview, and the grid draws every card's preview
//     through ONE shared WebGL 1.0 context (components/ShaderPreviewLayer) so
//     that a page listing a dozen journeys never trips the browser's per-document
//     context limit. A preview cannot be the journey's own renderer here, since
//     the journey's renderer needs WebGL2 and its own depth buffer. So the
//     preview fakes it, in one pass, from iTime alone — no simulation is
//     attached to a card, and a preview reading uRide or uDecay draws a black
//     rectangle.
//
// ---------------------------------------------------------------------------
// The shard contract
// ---------------------------------------------------------------------------
//
// `aShard` is (centroid.xyz, seed) for the fracture cell this triangle belongs
// to — see lib/mesh's `fracture`. The vertex shader rotates and throws each
// shard about its own centroid, which is why the centroid has to travel with
// every vertex: a vertex on its own cannot know what it is a corner of.
//
// This is the whole reason the journey is rasterized rather than raymarched. A
// shard displacement is four multiply-adds in the vertex shader, evaluated once
// per vertex, with the buffers untouched from the first frame to the last — so
// the world can come apart without a single re-upload, without the frame getting
// any more expensive, and (because the displacement is a pure function of
// uDecay) without breaking ?t= reproducibility.

// --- the real journey -----------------------------------------------------

export const loopLineVert = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aShard;   // (shard centroid xyz, shard seed)
layout(location = 4) in vec4 iXform;   // (translate xyz, yaw)
layout(location = 5) in vec4 iParams;  // (scale, tint, seed, bayId)

uniform mat4 uViewProj;
uniform vec4 uDecay;   // (fracture, lightFail, rot, wear)
uniform vec4 uRide;    // (speed, lapF, shake, onAlt)
uniform vec4 uRupture; // per-bay rupture weights, indexed by iParams.w

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vTint;
out float vBay;
out float vBroken;

// One rotation matrix from an axis-angle, Rodrigues in matrix form.
mat3 axisAngle (vec3 axis, float angle) {
  float c = cos(angle), s = sin(angle);
  float t = 1.0 - c;
  vec3 a = normalize(axis);
  return mat3(
    t * a.x * a.x + c,       t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c,       t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c
  );
}

void main () {
  // Instance transform: yaw about world up, uniform scale, translate. A full
  // matrix per instance would be four times the bandwidth for a freedom no prop
  // on this line uses — nothing is pitched or rolled except by rupture.
  float ca = cos(iXform.w), sa = sin(iXform.w);
  vec3 p = aPos * iParams.x;
  p = vec3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca);
  vec3 n = vec3(aNormal.x * ca + aNormal.z * sa, aNormal.y, -aNormal.x * sa + aNormal.z * ca);
  vec3 world = p + iXform.xyz;

  // Shard displacement. Rotate the shard about its own centroid and throw it
  // ("pivot", not "centroid": GLSL ES 3.00 reserves that word as an
  // interpolation qualifier and a variable named it is a syntax error.)
  // along a per-shard axis, both scaled by how far this particular bay has come
  // apart. Sagging under gravity is added separately so a shard falls as well as
  // spins, which is the difference between debris and confetti.
  vec3 pivot = aShard.xyz * iParams.x + iXform.xyz;
  float seed  = fract(aShard.w + iParams.z);
  float amount = uDecay.x * uRupture.x;
  vBroken = amount;

  if (amount > 0.001) {
    vec3 axis = normalize(vec3(
      sin(seed * 91.7) , cos(seed * 47.3) + 0.35, sin(seed * 13.1 + 2.0)));
    float spin = amount * (0.35 + seed * 1.15) * 0.6;
    mat3 R = axisAngle(axis, spin);
    vec3 local = world - pivot;
    world = pivot + R * local;
    n = R * n;

    // Sub-metre for most of the ride. A shard thrown ten metres has left the
    // building and reads as debris in a void; a shard that has moved thirty
    // centimetres and turned five degrees reads as a wall that is failing, which
    // is the thing worth looking at.
    float throwDist = amount * amount * (0.30 + seed * 1.5);
    world += axis * throwDist;
    world.y -= throwDist * (0.7 + seed * 1.1);   // and down, because gravity
  }

  vWorld  = world;
  vNormal = n;
  vUv     = aUv;
  vTint   = iParams.y;
  vBay    = iParams.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`

export const loopLineFrag = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vTint;
in float vBay;
in float vBroken;

uniform vec3 uCamPos;
uniform vec4 uDecay;      // (fracture, lightFail, rot, wear)
uniform vec4 uRide;       // (speed, lapF, shake, onAlt)
uniform float uTime;

// Up to 24 resident lamps, packed as (position.xyz, radius) and (tint.rgb, out).
// the w channel is 1.0 for a lamp this lap has killed — a dead lamp is still geometry
// and still occludes, it just stops contributing.
uniform vec4 uLampPos[24];
uniform vec4 uLampCol[24];
uniform int  uLampCount;

// The bay this fragment's surface belongs to, resolved per draw call rather than
// from the camera — see the header of scene.ts for why that distinction is the
// single most repeated bug in this repo.
uniform vec4 uBayFog;     // (fog.rgb, density)
uniform vec4 uBayAmb;     // (ambient.rgb, sky)
uniform vec4 uWater;      // (surfaceY, murk, 0, 0)
uniform vec3 uLampTint;   // the bay's lamp colour, for emissive housings

out vec4 fragColor;

float hash21 (vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Bilinear value noise. Every journey in this repo pastes its own copy of this
// rather than importing one; that is the established convention here, not an
// oversight, because a shader is a string and there is no include step.
float vnoise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main () {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);

  // Two-tone albedo from the instance tint, plus a tile/panel grid that fades
  // out with distance so the far end of a hall does not shimmer.
  float grid = 1.0;
  vec2 g = abs(fract(vUv) - 0.5);
  float line = smoothstep(0.46, 0.5, max(g.x, g.y));
  grid -= line * 0.35 * (1.0 - smoothstep(8.0, 40.0, dist));

  // tint in [0,1] blends the two surface albedos; tint ABOVE 1 means the
  // surface is self-lit, with strength tint - 1. A lamp diffuser shaded only by
  // other lamps is a dark lamp, which is how you end up with a corridor of
  // bright pools thrown by nothing visible.
  float emissive = max(vTint - 1.0, 0.0);
  float tint = clamp(vTint, 0.0, 1.0);
  vec3 albedo = mix(vec3(0.62, 0.58, 0.52), vec3(0.34, 0.36, 0.40), tint) * grid;

  // Grime. A perfectly uniform wall is the loudest possible tell that a scene
  // has no textures in it, and two octaves of value noise on world position fix
  // most of that for a handful of instructions. Projected on whichever plane the
  // surface faces most, so nothing smears into stripes on any wall — the failure
  // mode that journey.mjs's uv subcommand exists to catch.
  vec3 an = abs(N);
  vec2 gp = an.y > max(an.x, an.z) ? vWorld.xz
          : an.x > an.z            ? vWorld.zy
                                   : vWorld.xy;
  albedo *= 0.70 + (vnoise(gp * 0.7) * 0.55 + vnoise(gp * 2.9) * 0.26) * 0.55;

  // Vertical staining. What actually makes a tunnel look old is that water has
  // run down it, and water only ever runs one way.
  albedo *= 1.0 - clamp(vnoise(vec2(gp.x * 1.7, vWorld.y * 0.11)) - 0.46, 0.0, 1.0) * 0.55;

  // Rot: desaturate, then flatten toward a dead grey. The geometry stops
  // pretending to be a material before it stops being geometry.
  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(albedo, vec3(lum), uDecay.z * 0.75);
  albedo *= 1.0 - uDecay.z * 0.35;

  vec3 lit = uBayAmb.rgb * (0.35 + 0.65 * (N.y * 0.5 + 0.5));

  for (int i = 0; i < 24; i++) {
    if (i >= uLampCount) break;
    vec3 lp = uLampPos[i].xyz;
    float radius = uLampPos[i].w;
    vec3 L = lp - vWorld;
    float d = length(L);
    if (d > radius) continue;
    L /= d;
    float ndl = max(dot(N, L), 0.0);
    // Inverse-square, but softened near zero and windowed to the radius so a
    // lamp contributes nothing outside its own bay's reach.
    float atten = 1.0 / (1.0 + d * d * 0.012);
    atten *= 1.0 - smoothstep(radius * 0.62, radius, d);
    float alive = 1.0 - uLampCol[i].w;
    lit += uLampCol[i].rgb * ndl * atten * alive * 3.1;
    // A tight specular gives tile and steel somewhere to catch the light.
    vec3 H = normalize(L + V);
    lit += uLampCol[i].rgb * pow(max(dot(N, H), 0.0), 48.0) * atten * alive * 0.65;
  }

  vec3 col = albedo * lit + uLampTint * emissive * 2.8;

  // A shard in flight loses its shading and goes toward silhouette, because
  // nothing is lighting its new orientation and pretending otherwise reads as
  // plastic.
  col *= 1.0 - vBroken * 0.45;

  // Underwater: everything below the surface plane is filtered and loses
  // contrast with depth. The surface itself is drawn by the scene as geometry.
  float under = clamp((uWater.x - vWorld.y) * 0.45, 0.0, 1.0) * uWater.y;
  col = mix(col, col * vec3(0.32, 0.62, 0.58), under);

  // Exponential fog toward the bay's own colour. Distance-only: this is a
  // rasterizer, so there is no ray to integrate along, and the honest cheap
  // approximation is a per-fragment exponential.
  float f = 1.0 - exp(-dist * uBayFog.w);
  col = mix(col, uBayFog.rgb, f);

  // Dither the fog, or a long hall bands visibly in the dark bays.
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.004;

  fragColor = vec4(col, 1.0);
}
`

// --- the hover preview ----------------------------------------------------

// GLSL ES 1.00, one pass, self-driving from iTime. Fakes the shot the journey
// opens on: a tunnel mouth with a receding string of platform lamps, the train
// closing on it at speed. No raymarch, no simulation, nothing to compile slowly
// — this is one of eight programs sharing a single context on the landing page.
export const loopLinePreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;

    float run = iTime * 7.0;

    // Fake perspective: depth from the inverse of the distance to the vanishing
    // point, which is all a corridor needs.
    float r = max(abs(uv.x) * 0.62, abs(uv.y));
    float depth = 0.26 / max(r, 0.004);

    // Tunnel shell, banded into ring segments along its length.
    float ring = fract(depth * 0.5 - run * 0.1);
    float seg  = smoothstep(0.02, 0.10, ring) * (1.0 - smoothstep(0.86, 0.96, ring));
    float shade = clamp(2.2 / depth, 0.04, 1.0);

    vec3 col = mix(vec3(0.20, 0.18, 0.17), vec3(0.30, 0.29, 0.31), seg) * shade;

    // Which wall are we looking at — floor gets the trackbed, ceiling stays dark.
    float floorish = smoothstep(0.0, -0.06, uv.y - abs(uv.x) * 0.3);
    col = mix(col, vec3(0.13, 0.12, 0.12), floorish * 0.7);

    // Sleepers, only on the floor, receding.
    float tie = fract(depth * 1.6 - run * 0.32);
    col += floorish * shade * 0.10 *
           (1.0 - smoothstep(0.0, 0.32, tie));

    // Two rails catching the light.
    float rail = smoothstep(0.016, 0.0, abs(abs(uv.x) - 0.055 / max(r, 0.05) * 0.30));
    col += vec3(0.55, 0.56, 0.60) * rail * floorish * shade * 0.7;

    // The lamp string: a run of sodium lamps at the ceiling line, pitched along
    // the tunnel, each a soft blob that brightens as it arrives.
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float lz = fract((fi * 0.1428) - run * 0.055);
      float ld = 0.6 / (lz + 0.06);
      vec2 lp = vec2(0.0, 0.115 * ld - 0.03);
      float fall = 1.0 / (1.0 + lz * 44.0);
      col += vec3(1.0, 0.79, 0.48) *
             exp(-dot(uv - lp, uv - lp) * (170.0 + lz * 5200.0)) * (0.9 + fall);
      // and the pool it throws down the wall
      col += vec3(1.0, 0.74, 0.42) * 0.10 * fall *
             exp(-abs(uv.y - lp.y + 0.16) * 7.0) *
             exp(-abs(uv.x) * 2.4);
    }

    // The mouth: a cold rectangle of somewhere else, straight ahead.
    float mouth = smoothstep(0.10, 0.045, r);
    col = mix(col, vec3(0.55, 0.63, 0.72), mouth * 0.55);

    // Bloom-ish lift, vignette, grain — the family look.
    col += col * smoothstep(0.65, 1.6, dot(col, vec3(0.299, 0.587, 0.114))) * 0.4;
    col *= 1.0 - smoothstep(0.34, 1.05, length(uv * vec2(1.0, 1.1))) * 0.55;
    col = col * (1.0 + col / 5.3) / (1.0 + col);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.022;

    gl_FragColor = vec4(col, 1.0);
  }
`

// --- post chain -----------------------------------------------------------

/** A full-screen triangle-pair vertex shader, shared by every post pass. */
export const postVert = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * Bright pass at half resolution. Subtracting a threshold before blurring is
 * what makes bloom read as light rather than as haze: keep only what is
 * genuinely brighter than the scene's working range, or every mid-grey wall
 * contributes and the whole image turns milky.
 */
export const brightFrag = `#version 300 es
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

/** Separable Gaussian, nine taps, run once per axis. */
export const blurFrag = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;      // (1/width, 0) or (0, 1/height), pre-scaled by radius
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
 * Composite. Everything that is a property of the whole image rather than of
 * any surface lands here: bloom, chromatic aberration, vignette, tone map,
 * grain, and the power cut.
 *
 * The tone-map tail is deliberately identical to switchback's — Reinhard with a
 * white point rather than a clamp, then atzedent's sqrt lift toward the corners,
 * then a 0.94 gamma and grain. Two journeys that share a house look should share
 * the actual code that produces it, not approximate each other.
 */
export const compositeFrag = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec4 uDecay;    // (fracture, lightFail, rot, wear)
uniform vec4 uRide;     // (speed, lapF, shake, onAlt)
uniform float uTime;
out vec4 fragColor;

float hash21 (vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main () {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;

  // Chromatic aberration, scaled by rot and by speed — the lens only starts
  // failing once the line does. Radial, so it is zero at the centre where you
  // are actually looking.
  float ca = (0.0012 + uDecay.z * 0.010) * (0.4 + uRide.x * 0.03);
  vec3 col;
  col.r = texture(uScene, uv + c * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - c * ca).b;

  col += texture(uBloom, uv).rgb * (0.55 + uDecay.z * 0.30);

  // A power cut arriving one lap at a time. Hashed on a 15 Hz frame index so it
  // reads as a supply fault rather than a flicker animation.
  col *= 1.0 - uDecay.y * 0.30 * step(0.962, hash21(vec2(floor(uTime * 15.0), 3.0)));

  // Vignette, tightened by speed.
  float rush = clamp(uRide.x / 24.0, 0.0, 1.0);
  col *= 1.0 - smoothstep(0.36, 1.16, length(c * vec2(1.0, 1.07))) * (0.38 + rush * 0.26);

  // Reinhard with a white point rather than a clamp.
  col = max(col, 0.0);
  col = col * (1.0 + col / (2.7 * 2.7)) / (1.0 + col);

  // atzedent's lift toward the corners.
  col = mix(col, sqrt(col) * 0.90, 0.15 * (1.0 - smoothstep(0.0, 1.6, dot(c, c) * 4.0)));

  col = pow(col, vec3(0.94));
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 71.3) - 0.5) * 0.026;

  fragColor = vec4(col, 1.0);
}
`
