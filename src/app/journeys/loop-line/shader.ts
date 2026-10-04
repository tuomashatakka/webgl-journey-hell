// THE LOOP LINE — shaders.
//
// Two versions of GLSL live here on purpose:
//
//   * everything prefixed `loopLine…` and the post chain is **GLSL ES 3.00**,
//     for the WebGL2 context geometryRenderer asks for;
//   * `loopLinePreviewFrag` is **GLSL ES 1.00**, because the landing grid draws
//     every card's preview through one shared WebGL 1.0 context and has no
//     simulation to feed it — it fakes the shot from iTime alone.
//
// ---------------------------------------------------------------------------
// What a fragment knows
// ---------------------------------------------------------------------------
//
// Every surface is shaded from the Δ material library — colour, normal,
// roughness, displacement, AO and metalness, all six maps of an ambientCG set —
// with parallax occlusion close up, under:
//
//   * the bay's ambient, *blended along the track* (see below), plus sky-map
//     irradiance and a sun where the bay is open;
//   * the 24 lamps of its own bay nearest the camera, GGX against each;
//   * the train's headlight;
//   * the occlusion baked into the shell's sections (the vertex normal's length).
//
// ---------------------------------------------------------------------------
// The medium is a function of arc length, and so the seams vanish
// ---------------------------------------------------------------------------
//
// The old renderer gave every draw its own bay's fog and the clear colour the
// camera's bay's, so looking down a tunnel into the next room showed a hard
// line where one fog met the other, and crossing a boundary changed the colour
// of everything at once. Now each vertex computes its medium — fog colour,
// density, ambient, openness — from its *arc length*, smoothly blended across
// fifteen metres either side of every boundary, and the camera's medium comes
// from the CPU by the same function. The fog is then integrated as two
// half-segments, the camera's medium near and the surface's far:
//
//   C = C0·Tc·Ts + fogS·(1 − Ts)·Tc + fogC·(1 − Tc)
//
// which is continuous everywhere and correct at both ends.
//
// ---------------------------------------------------------------------------
// Light in the air
// ---------------------------------------------------------------------------
//
// The eight lamps nearest the camera also scatter into the view ray, using
// Miles Macklin's closed form for single scattering from a point light along a
// segment ("Faster Fog", 2010): with b = rd·(ro − p), h the ray's closest
// approach, the integral of 1/r² is (atan((d + b)/h) − atan(b/h))/h. It costs
// two atans per lamp and gives every lamp its halo without a single texture.

import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from 'Δ/glsl'
import { ACES, HASH11, HASH12 } from '✦/lib/glsl'


/** Lamps per draw. A bay uploads its nearest this many to the camera. */
export const MAX_LAMPS = 24

/** Lamps that scatter into the air, nearest the camera across all bays. */
export const MAX_SCATTER = 8

/** Points per headwall opening; two openings at most. */
export const MAX_HOLE = 24

const HEADER = /* glsl */`#version 300 es
precision highp float;
precision highp int;
`

// --- vertex ---------------------------------------------------------------------

export const loopLineVert = HEADER + /* glsl */`
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aShard;   // shard pivot (local), seed
layout(location = 4) in vec4 iA;       // position, scale x
layout(location = 5) in vec4 iB;       // forward, scale y
layout(location = 6) in vec4 iC;       // up, scale z
layout(location = 7) in vec4 iD;       // s, bay, seed, tint

uniform mat4 uViewProj;
uniform vec4 uDecay;      // fracture, lightFail, rot, wear
uniform vec4 uRupture;    // shard weight, special amount, mode, unused
uniform vec4 uBay;        // s0, s1, blend, isShell
uniform vec4 uFogA;       // previous bay: fog rgb, density
uniform vec4 uFogB;       // this bay
uniform vec4 uFogC;       // next bay
uniform vec4 uAmbA;       // previous bay: ambient rgb, open
uniform vec4 uAmbB;
uniform vec4 uAmbC;
uniform float uLift;      // world-y offset for the whole draw (the flood)

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec3 vLocal;
out vec3 vLocalN;
out vec4 vFog;
out vec4 vAmb;
out vec4 vInst;           // seed, tint, broken, s

mat3 axisAngle (vec3 axis, float angle) {
  float c = cos(angle), s = sin(angle), t = 1.0 - c;
  vec3 a = normalize(axis);
  return mat3(
    t * a.x * a.x + c,       t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c,       t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c
  );
}

void main () {
  vec3 F = iB.xyz;
  vec3 U = iC.xyz;
  vec3 Lf = cross(U, F);
  vec3 sc = vec3(iA.w, iB.w, iC.w);
  float isShell = uBay.w;

  vec3 lp = aPos * sc;

  // ADVANCE: the racks walk in toward the aisle, a fraction of a metre a lap.
  if (uRupture.z > 5.5 && uRupture.z < 6.5)
    lp.x += uRupture.y * (0.6 + fract(iD.z * 13.7) * 0.8);

  vec3 world = iA.xyz + Lf * lp.x + U * lp.y + F * lp.z;
  vec3 ln = aNormal / sc;
  vec3 n = Lf * ln.x + U * ln.y + F * ln.z;
  // A shell's normal carries its baked occlusion in its length; a prop's is
  // unit, and is re-normalised here because a non-uniform scale stretched it.
  if (isShell < 0.5)
    n = normalize(n);

  vec3 pivotL = aShard.xyz * sc;
  vec3 pivot = iA.xyz + Lf * pivotL.x + U * pivotL.y + F * pivotL.z;
  float seed = fract(aShard.w + iD.z * 7.31);
  float amount = uDecay.x * uRupture.x;

  if (amount > 0.001 && aShard.w > 0.0) {
    vec3 axis = vec3(sin(seed * 91.7), cos(seed * 47.3) + 0.35, sin(seed * 13.1 + 2.0));
    // Small. A slab that has turned five degrees and dropped thirty
    // centimetres reads as a wall that is failing; one that has turned thirty
    // reads as confetti, and there is nowhere left for the next lap to go.
    float spin = amount * (0.2 + seed * 0.8) * 0.4;
    mat3 R = axisAngle(axis, spin);
    world = pivot + R * (world - pivot);
    n = R * n;
    float throwDist = amount * amount * (0.25 + seed * 1.1);
    world += normalize(axis) * throwDist;
    world.y -= throwDist * (0.7 + seed * 1.1);
  }

  // VANISH: a member that has left is collapsed to its pivot, not drawn.
  float gone = 0.0;
  if (uRupture.z > 7.5 && aShard.w > 0.0 && seed < uRupture.y)
    gone = 1.0;
  if (gone > 0.5)
    world = pivot;

  world.y += uLift;

  // The medium at this arc length: previous, own, next bay, blended across
  // each boundary so a surface's fog and light do not step at the seam.
  float s = isShell > 0.5 ? aUv.x : iD.x;
  float t0 = smoothstep(uBay.x - uBay.z, uBay.x + uBay.z, s);
  float t1 = smoothstep(uBay.y - uBay.z, uBay.y + uBay.z, s);
  vFog = mix(mix(uFogA, uFogB, t0), uFogC, t1);
  vAmb = mix(mix(uAmbA, uAmbB, t0), uAmbC, t1);

  vWorld  = world;
  vNormal = n;
  vUv     = aUv;
  vLocal  = lp;
  vLocalN = aNormal;
  vInst   = vec4(iD.z, iD.w, amount, s);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`

// --- shared fragment code ----------------------------------------------------------

const FRAG_COMMON = /* glsl */`
${MATERIAL_GLSL}
${SURFACE_GLSL}
${SKY_GLSL}

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec3 vLocal;
in vec3 vLocalN;
in vec4 vFog;
in vec4 vAmb;
in vec4 vInst;

uniform vec3  uCamPos;
uniform vec4  uCamFog;     // the camera's medium: rgb, density
uniform vec4  uDecay;
uniform vec4  uRide;       // speed, lapF, shake, onAlt
uniform float uTime;
uniform float uHeavy;

uniform vec4 uLampPos[${MAX_LAMPS}];   // xyz, range
uniform vec4 uLampCol[${MAX_LAMPS}];   // rgb intensity, alive
uniform int  uLampCount;

uniform vec4 uScatPos[${MAX_SCATTER}];
uniform vec4 uScatCol[${MAX_SCATTER}];
uniform int  uScatCount;
uniform float uScatter;    // single-scattering coefficient of the camera's air

uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;

// Without float render targets the scene is stored Reinhard-encoded in RGBA8
// and decoded by the post chain; 1 here selects that path.
uniform float uEncode;

uniform sampler2D uSkyA;
uniform sampler2D uSkyB;
uniform vec4 uSky;         // mix B over A, exposure A, exposure B, yaw
uniform vec4 uSun;         // direction, intensity

out vec4 fragColor;

${HASH12}

${HASH11}

vec3 skyColour (vec3 d) {
  vec3 a = skyRadiance(skyTexel(uSkyA, d, uSky.w), uSky.y);
  if (uSky.x <= 0.001)
    return a;
  vec3 b = skyRadiance(skyTexel(uSkyB, d, uSky.w), uSky.z);
  return mix(a, b, uSky.x);
}

// Reflections sample by LOD, not by derivative: they are taken inside a
// branch on the interpolated openness, where implicit derivatives are undefined.
vec3 skyColourLod (vec3 d, float lod) {
  vec3 a = skyRadiance(textureLod(uSkyA, equirectUv(d, uSky.w), lod).rgb, uSky.y);
  if (uSky.x <= 0.001)
    return a;
  return mix(a, skyRadiance(textureLod(uSkyB, equirectUv(d, uSky.w), lod).rgb, uSky.z), uSky.x);
}

vec3 skyLight (vec3 n) {
  vec3 a = skyIrradiance(uSkyA, n, uSky.w, uSky.y);
  if (uSky.x <= 0.001)
    return a;
  return mix(a, skyIrradiance(uSkyB, n, uSky.w, uSky.z), uSky.x);
}

// Single scattering from the nearest lamps along the view ray (Macklin).
vec3 inscatter (vec3 ro, vec3 rd, float d) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_SCATTER}; i++) {
    if (i >= uScatCount) break;
    vec3 q = ro - uScatPos[i].xyz;
    float b = dot(rd, q);
    float c = dot(q, q);
    float h = sqrt(max(c - b * b, 0.02));
    float l = (atan((d + b) / h) - atan(b / h)) / h;
    acc += uScatCol[i].rgb * uScatCol[i].a * l;
  }
  return acc * uScatter;
}

// Fog in two half-segments: the camera's air near, the surface's far.
vec3 applyMedium (vec3 col, float dist, vec4 far) {
  float h = dist * 0.5;
  float tc = exp(-uCamFog.w * h);
  float tf = exp(-far.w * h);
  return col * tc * tf + far.rgb * (1.0 - tf) * tc + uCamFog.rgb * (1.0 - tc);
}

// Point-light falloff: inverse square, softened at the source and windowed to
// zero at the range so a lamp cannot reach past its own room.
float lampFalloff (float d, float range) {
  float w = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0);
  return w * w / (d * d + 1.0);
}
`

export const loopLineFrag = (variant: 'surface' | 'headwall' | 'water'): string => HEADER +
  (variant === 'headwall' ? '#define HEADWALL\n' : '') +
  (variant === 'water' ? '#define WATER\n' : '') + FRAG_COMMON + /* glsl */`

uniform vec4 uSurf;        // layer, mode, roughness, metalness
uniform vec3 uTint;
uniform vec3 uGlow;
uniform float uPom;
uniform float uMapping;    // 0 = shell uv, 1 = box-mapped from local position
uniform vec4 uRupture;

#ifdef HEADWALL
uniform vec2 uHoleA[${MAX_HOLE}];
uniform vec2 uHoleB[${MAX_HOLE}];
uniform ivec2 uHoleN;

// Signed distance to a polygon (iq's even-odd winding test): negative inside.
float sdPolygon (vec2 p, int which) {
  int n = which == 0 ? uHoleN.x : uHoleN.y;
  if (n < 3) return 1e5;
  vec2 v0 = which == 0 ? uHoleA[0] : uHoleB[0];
  float d = dot(p - v0, p - v0);
  float s = 1.0;
  for (int i = 0; i < ${MAX_HOLE}; i++) {
    if (i >= n) break;
    int j = i == 0 ? n - 1 : i - 1;
    vec2 vi = which == 0 ? uHoleA[i] : uHoleB[i];
    vec2 vj = which == 0 ? uHoleA[j] : uHoleB[j];
    vec2 e = vj - vi;
    vec2 w = p - vi;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
#endif

#ifdef WATER
uniform vec4 uWater;       // murk, ripple speed, unused, unused
#endif

vec3 paletteColour (float k) {
  k = mod(floor(k), 8.0);
  if (k < 0.5) return vec3(0.75, 0.10, 0.08);
  if (k < 1.5) return vec3(0.05, 0.25, 0.60);
  if (k < 2.5) return vec3(0.85, 0.62, 0.10);
  if (k < 3.5) return vec3(0.08, 0.45, 0.30);
  if (k < 4.5) return vec3(0.82, 0.80, 0.74);
  if (k < 5.5) return vec3(0.45, 0.10, 0.45);
  if (k < 6.5) return vec3(0.95, 0.35, 0.12);
  return vec3(0.10, 0.10, 0.12);
}

void main () {
  float bakedAo = clamp(length(vNormal), 0.05, 1.0);
  vec3 Ng = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec3 rd = -V;

#ifdef HEADWALL
  // The opening is cut per fragment and antialiased through alpha-to-coverage:
  // the edge's alpha ramps over one pixel of the polygon's distance field.
  float hole = min(sdPolygon(vUv, 0), sdPolygon(vUv, 1));
  float px = fwidth(hole);
  float cover = clamp(hole / max(px, 1e-4) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
#endif

  // Metric uv: the shell's own, or box-mapped from the prop's local position.
  vec2 uvm = vUv;
  if (uMapping > 0.5) {
    vec3 an = abs(vLocalN);
    uvm = an.x > an.y && an.x > an.z ? vLocal.zy
        : an.y > an.z ? vLocal.xz : vLocal.xy;
  }

  float mode = uSurf.y;
  Surface s;
  if (uSurf.x >= 0.0) {
    int steps = (uPom > 0.5 && dist < 16.0) ? int(mix(14.0, 5.0, dist / 16.0) * (0.5 + 0.5 * uHeavy)) : 0;
    s = sampleMaterial(uSurf.x, uvm, Ng, vWorld, V, steps);
    s.albedo *= uTint;
    s.rough = clamp(s.rough * uSurf.z, 0.04, 1.0);
    s.metal = max(s.metal, uSurf.w);
  }
  else {
    s.albedo = uTint;
    s.normal = Ng;
    s.rough = uSurf.z;
    s.ao = 1.0;
    s.metal = uSurf.w;
    s.height = 0.5;
  }

  vec3 emissive = vec3(0.0);
  float seed = vInst.x;
  float tint = vInst.y;

  // Lamp fittings share their lamp's roll, so the glass dies with the light.
  // A lamp near its turn flickers for a while first.
  float margin = seed - uDecay.y;
  float alive = step(0.0, margin);
  if (margin > 0.0 && margin < 0.05)
    alive *= step(0.25, fract(sin(floor(uTime * 14.0) * 12.9898 + seed * 78.233) * 43758.5453));

  if (mode > 1.5 && mode < 2.5) {
    // EMISSIVE fitting.
    emissive = uGlow * alive;
    s.albedo = mix(s.albedo, vec3(0.04), 1.0 - alive);
  }
  else if (mode > 2.5 && mode < 3.5) {
    // WINDOWS: a facade of lit and dark windows, drawn from the instance seed.
    vec3 an = abs(vLocalN);
    if (an.y < 0.5) {
      vec2 f = an.x > an.z ? vLocal.zy : vLocal.xy;
      vec2 cell = vec2(2.7, 3.4);
      vec2 g = f / cell;
      vec2 id = floor(g);
      vec2 q = fract(g);
      float fw = max(fwidth(g.x), fwidth(g.y));
      vec2 lo = smoothstep(vec2(0.18), vec2(0.18) + fw, q);
      vec2 hi = 1.0 - smoothstep(vec2(0.82, 0.78) - fw, vec2(0.82, 0.78), q);
      float win = lo.x * lo.y * hi.x * hi.y;
      float face = an.x > an.z ? sign(vLocalN.x) : 2.0 * sign(vLocalN.z);
      float h = hash12(id + vec2(seed * 517.0, face * 31.0));
      // The city goes dark one window at a time, and never comes back.
      float litFrac = 0.46 * (1.0 - uRupture.y * 0.9);
      float lit = step(h, litFrac) * step(1.0, id.y);
      vec3 wc = mix(vec3(1.0, 0.66, 0.34), vec3(0.72, 0.84, 1.0), step(0.7, hash11(h * 91.0)));
      wc *= 0.5 + hash11(h * 37.0) * 1.1;
      // Far away the grid is sub-pixel: fade to its mean rather than shimmer.
      float far = smoothstep(0.35, 0.9, fw);
      float glowAmt = mix(win * lit, litFrac * 0.38, far);
      emissive += wc * glowAmt * 1.9;
      s.albedo = mix(s.albedo, vec3(0.015), mix(win, 0.38, far) * (1.0 - mix(lit, litFrac, far)));
      s.rough = mix(s.rough, 0.12, mix(win, 0.38, far));
    }
  }
  else if (mode > 3.5 && mode < 4.5) {
    // RACK: a server's face, rows of status LEDs blinking on their own clocks.
    if (vLocalN.x > 0.5) {
      vec2 g = vec2(vLocal.z / 0.6 * 8.0, vLocal.y / 0.0445);
      vec2 id = floor(g);
      vec2 q = fract(g);
      float h = hash12(id + seed * 113.0);
      float led = smoothstep(0.32, 0.12, length((q - vec2(0.5, 0.5)) * vec2(1.0, 1.6)));
      float rate = 0.7 + h * 5.0;
      float on = step(0.45, fract(uTime * rate + h * 9.0)) * step(0.35, h);
      vec3 lc = h < 0.6 ? vec3(0.2, 1.0, 0.35) : h < 0.85 ? vec3(1.0, 0.55, 0.05) : vec3(0.25, 0.5, 1.0);
      emissive += lc * led * on * 3.5 * (1.0 - uDecay.y * 0.6);
      float seam = smoothstep(0.06, 0.0, abs(fract(vLocal.y / 0.0445 * 0.25) - 0.5) - 0.44);
      s.albedo *= 1.0 - seam * 0.5;
    }
  }
  else if (mode > 4.5 && mode < 5.5) {
    // CARRIAGE: a parked car, its window band lit or not.
    vec3 an = abs(vLocalN);
    if (an.x > 0.5) {
      float band = step(1.55, vLocal.y) * step(vLocal.y, 2.75);
      float pane = step(0.12, fract(vLocal.z / 1.9)) * step(fract(vLocal.z / 1.9), 0.88);
      float win = band * pane;
      float lit = step(0.35, tint) * (1.0 - step(tint, uRupture.y));
      emissive += vec3(0.85, 0.95, 1.0) * win * lit * 0.45;
      s.albedo = mix(s.albedo, vec3(0.02), win * (1.0 - lit * 0.6));
      s.rough = mix(s.rough, 0.28, win);
      // A livery stripe under the windows.
      s.albedo = mix(s.albedo, vec3(0.55, 0.06, 0.05), step(1.25, vLocal.y) * step(vLocal.y, 1.45));
    }
  }
  else if (mode > 5.5 && mode < 6.5) {
    // SIGNAL lens: red, green or yellow by tint, dead once the lap kills it.
    vec3 c = tint < 0.5 ? vec3(8.0, 0.5, 0.3) : tint < 1.5 ? vec3(0.4, 6.0, 1.8) : vec3(6.0, 3.6, 0.3);
    emissive = c * alive * (uGlow.r > 1.5 ? uGlow / max(uGlow.r, 1e-3) : vec3(1.0));
    s.albedo = vec3(0.05);
  }
  else if (mode > 6.5 && mode < 7.5) {
    // POSTER / SIGN: a printed sheet — two blocks of colour and a band of text.
    vec2 p = vec2(vLocal.z, vLocal.y);
    vec3 a = paletteColour(tint);
    vec3 b = paletteColour(tint + 3.0);
    float split = step(0.15 + hash11(tint * 7.1 + seed) * 0.5, fract(p.y * 0.6 + 0.5));
    vec3 c = mix(a, b, split * 0.8);
    float text = step(0.5, hash12(floor(p * vec2(9.0, 14.0)) + tint)) *
      step(abs(p.y + 0.35), 0.12);
    c = mix(c, vec3(0.92), text * 0.7);
    s.albedo = c * 0.85;
    s.rough = 0.35;
    // Shop signs are lit from inside.
    emissive += c * uGlow * alive * 0.8;
  }
  else if (mode > 7.5) {
    // RAIL: the running surface is polished by the wheels; the rest is rust.
    if (vLocalN.y > 0.5 && vLocal.y > 0.12) {
      s.albedo = vec3(0.62, 0.62, 0.64);
      s.metal = 1.0;
      s.rough = 0.18 + uDecay.w * 0.3;
    }
  }

  // Rot: the materials stop being materials before the geometry stops being
  // geometry.
  float lum = dot(s.albedo, vec3(0.2126, 0.7152, 0.0722));
  s.albedo = mix(s.albedo, vec3(lum), uDecay.z * 0.8);
  s.albedo *= 1.0 - uDecay.z * 0.3;
  s.rough = mix(s.rough, 1.0, uDecay.z * 0.4);

  // --- light ---------------------------------------------------------------
  vec3 col = vec3(0.0);

  // Ambient: the room's bounce, from above more than below, and where the bay
  // is open, the sky map itself.
  float hemi = 0.55 + 0.45 * s.normal.y;
  vec3 irr = vAmb.rgb * hemi;
  vec3 refl = vAmb.rgb;
  if (vAmb.a > 0.01) {
    irr += skyLight(s.normal) * vAmb.a;
    refl = mix(refl, skyColourLod(reflect(rd, s.normal), 2.0 + s.rough * 7.0), vAmb.a);
  }
  col += shadeAmbient(s, V, irr, refl, bakedAo);

  // The sun, where there is one, attenuated by the trench's own walls through
  // the baked occlusion — a crude shadow, and the right sign.
  if (uSun.w > 0.0 && vAmb.a > 0.01)
    col += shadeBrdf(s, V, uSun.xyz) * vec3(1.0, 0.95, 0.86) * uSun.w * vAmb.a *
      smoothstep(0.35, 0.85, bakedAo);

  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLampPos[i].xyz - vWorld;
    float d = length(L);
    float range = uLampPos[i].w;
    if (d > range) continue;
    L /= d;
    col += shadeBrdf(s, V, L) * uLampCol[i].rgb * uLampCol[i].a * lampFalloff(d, range);
  }

  // The headlight, mounted on the nose and aimed down the track.
  {
    vec3 L = uHeadPos - vWorld;
    float d = length(L);
    L /= max(d, 1e-4);
    float cone = smoothstep(0.86, 0.97, dot(-L, uHeadDir));
    col += shadeBrdf(s, V, L) * vec3(1.0, 0.94, 0.84) * 70.0 * cone * uHeadOn / (d * d + 2.0);
  }

  col += emissive;

#ifdef WATER
  // The flood: a dark mirror with the lamps in it. Ripples from two scrolling
  // octaves of value noise bend the reflection; Fresnel decides how much of
  // the room is in it and how much of the floor shows through.
  vec2 wp = vWorld.xz;
  float t = uTime * uWater.y;
  vec2 e = vec2(0.08, 0.0);
  vec3 wn = normalize(vec3(
    sin(wp.x * 3.1 + t * 2.0) * 0.022 + sin(wp.y * 5.7 - t * 1.7 + wp.x) * 0.014,
    1.0,
    sin(wp.y * 2.7 + t * 1.6) * 0.022 + cos(wp.x * 6.3 + t * 2.3 - wp.y) * 0.014));
  vec3 R = reflect(rd, wn);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
  vec3 mirror = vFog.rgb * 0.6 + vAmb.rgb * 0.5;
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLampPos[i].xyz - vWorld;
    float d = length(L);
    L /= d;
    // A mirror shows a point light as a point: the sharp lobe is the lamp's
    // reflection, the faint broad one the ripples smearing it.
    float rl = max(dot(R, L), 0.0);
    float spec = pow(rl, 900.0) * 16.0 + pow(rl, 60.0) * 0.04;
    mirror += uLampCol[i].rgb * uLampCol[i].a * spec / (d * d * 0.1 + 1.0);
  }
  vec3 murk = vec3(0.004, 0.012, 0.010);
  col = mix(murk, mirror, fres);
  float alpha = mix(uWater.x, 1.0, fres);
#endif

  col = applyMedium(col, dist, vFog);
  col += inscatter(uCamPos, rd, dist);

  // A shard in flight loses its shading: nothing lights its new face.
  col *= 1.0 - vInst.z * 0.4;

  // Dither, or the long dark halls band.
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.002;

  if (uEncode > 0.5)
    col = col / (1.0 + col);

#ifdef HEADWALL
  fragColor = vec4(col, cover);
#elif defined(WATER)
  fragColor = vec4(col, alpha);
#else
  fragColor = vec4(col, 1.0);
#endif
}
`

// --- sky ---------------------------------------------------------------------------

export const skyVert = HEADER + /* glsl */`
layout(location = 0) in vec2 aPos;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
out vec3 vDir;
void main () {
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vDir = far.xyz / far.w - uCamPos;
  // At the far plane, so everything drawn later wins the depth test.
  gl_Position = vec4(aPos, 0.99999, 1.0);
}
`

export const skyFrag = HEADER + FRAG_COMMON.replace(/in vec3 vWorld;[\s\S]*?in vec4 vInst;/, 'in vec3 vDir;') + /* glsl */`
uniform float uSkyFog;      // effective distance the sky sits behind the air

void main () {
  vec3 rd = normalize(vDir);
  vec3 col = skyColour(rd);
  col = applyMedium(col, uSkyFog, uCamFog);
  col += inscatter(uCamPos, rd, 400.0);
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.002;
  if (uEncode > 0.5)
    col = col / (1.0 + col);
  fragColor = vec4(col, 1.0);
}
`

// --- post chain ---------------------------------------------------------------------

export const postVert = HEADER + /* glsl */`
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * First bloom level: a soft-knee bright pass with a 13-tap downsample (Jimenez,
 * "Next Generation Post Processing in Call of Duty: Advanced Warfare", 2014),
 * which is what stops a single hot pixel from blinking as the train moves.
 */
export const bloomDownFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;   // < 0 for plain downsample levels
uniform float uDecode;      // 1 when the source is the Reinhard-encoded LDR fallback
out vec4 fragColor;

vec3 fetch (vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

void main () {
  vec2 t = uTexel;
  vec3 a = fetch(vUv + t * vec2(-2.0, -2.0));
  vec3 b = fetch(vUv + t * vec2(0.0, -2.0));
  vec3 c = fetch(vUv + t * vec2(2.0, -2.0));
  vec3 d = fetch(vUv + t * vec2(-1.0, -1.0));
  vec3 e = fetch(vUv + t * vec2(1.0, -1.0));
  vec3 f = fetch(vUv + t * vec2(-2.0, 0.0));
  vec3 g = fetch(vUv);
  vec3 h = fetch(vUv + t * vec2(2.0, 0.0));
  vec3 i = fetch(vUv + t * vec2(-1.0, 1.0));
  vec3 j = fetch(vUv + t * vec2(1.0, 1.0));
  vec3 k = fetch(vUv + t * vec2(-2.0, 2.0));
  vec3 l = fetch(vUv + t * vec2(0.0, 2.0));
  vec3 m = fetch(vUv + t * vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 +
    (b + f + h + l) * 0.0625 + g * 0.125;
  if (uThreshold >= 0.0) {
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(60.0));
  }
  fragColor = vec4(col, 1.0);
}
`

/** Tent-filter upsample, added onto the level above. */
export const bloomUpFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 fragColor;
void main () {
  vec2 t = uTexel * uRadius;
  vec3 c = texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb
    + texture(uSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb
    + texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0
    + texture(uSrc, vUv).rgb * 4.0
    + texture(uSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0
    + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb
    + texture(uSrc, vUv + vec2(0.0, t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}
`

/**
 * The composite: exposure, a radial speed blur, chromatic aberration, bloom,
 * ACES, vignette, grain, the power cuts. Everything that is a property of the
 * picture rather than of a surface.
 */
export const compositeFrag = HEADER + /* glsl */`
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec4 uDecay;
uniform vec4 uRide;
uniform float uTime;
uniform float uExposure;
uniform float uDecode;
uniform float uHeavy;
uniform vec2 uAspect;
out vec4 fragColor;

${HASH12}

vec3 fetch (vec2 uv) {
  vec3 c = texture(uScene, uv).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

// Narkowicz's fitted ACES curve.
${ACES}

void main () {
  vec2 c = vUv - 0.5;
  float r = length(c * uAspect);

  // Speed: a radial smear that only touches the edges of the frame, the way
  // the eye loses the periphery and keeps the vanishing point.
  float speed = clamp(uRide.x / 26.0, 0.0, 1.0);
  float amount = speed * speed * smoothstep(0.18, 0.75, r) * 0.045;
  int taps = uHeavy > 0.5 ? 7 : 3;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  float ca = (0.0009 + uDecay.z * 0.006) * (0.4 + speed);
  for (int i = 0; i < 7; i++) {
    if (i >= taps) break;
    float k = float(i) / float(max(taps - 1, 1));
    vec2 uv = vUv - c * amount * k;
    vec3 s;
    s.r = fetch(uv + c * ca).r;
    s.g = fetch(uv).g;
    s.b = fetch(uv - c * ca).b;
    float w = 1.0 - k * 0.6;
    col += s * w;
    wsum += w;
  }
  col /= wsum;

  col += texture(uBloom, vUv).rgb * (0.075 + uDecay.z * 0.05);
  col *= uExposure;

  // Power cuts, arriving a lap at a time, on a 15 Hz clock so they read as a
  // supply fault rather than as an animation.
  col *= 1.0 - uDecay.y * 0.35 * step(0.965, hash12(vec2(floor(mod(uTime, 997.0) * 15.0), 3.0)));

  col = aces(col);
  col *= 1.0 - smoothstep(0.42, 1.05, r) * (0.42 + speed * 0.2);

  // Rot reaches the grade last.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(1.02, 1.0, 0.96), uDecay.z * 0.55);

  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * 0.02;
  fragColor = vec4(col, 1.0);
}
`

// --- the hover preview -----------------------------------------------------------------

// GLSL ES 1.00, one pass, self-driving from iTime. A tiled platform rushing
// past a train window — tiles on the far wall, lamps overhead, the next
// tunnel mouth glowing at the end — by nearest-plane intersection, so the
// perspective is exact and every band lands crisply on its depth.
export const loopLinePreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.05;
    float run = iTime * 6.5;

    const float HW = 0.46;
    const float HH = 0.28;
    float tF = uv.y < -0.0015 ? HH / -uv.y : 1e9;
    float tC = uv.y >  0.0015 ? HH /  uv.y : 1e9;
    float tW = abs(uv.x) > 0.0015 ? HW / abs(uv.x) : 1e9;
    float z = min(min(tF, tC), tW);
    float depth = z + run;
    float lat = uv.x * z / HW;
    float vert = uv.y * z / HH;
    bool onFloor = tF <= tC && tF <= tW;
    bool onCeil = tC < tF && tC <= tW;
    float shade = clamp(1.9 / z, 0.04, 1.0);

    vec3 col;
    if (onCeil) {
      col = vec3(0.10, 0.10, 0.11);
      float tube = smoothstep(0.08, 0.0, abs(abs(lat) - 0.45)) * step(0.4, fract(depth * 0.32));
      col += vec3(1.2, 1.1, 0.9) * tube;
    } else if (onFloor) {
      col = vec3(0.12, 0.11, 0.10);
      float tie = step(fract(depth * 1.34), 0.38);
      col += vec3(0.07, 0.06, 0.05) * tie;
      float rail = smoothstep(0.05, 0.0, abs(abs(lat) - 0.32));
      col = mix(col, vec3(0.75, 0.76, 0.8), rail * 0.8);
    } else {
      // Subway tile in running bond, cream glaze with a gloss line.
      vec2 t = vec2(depth * 6.0, vert * 9.0);
      t.x += step(1.0, mod(floor(t.y), 2.0)) * 0.5;
      vec2 q = fract(t);
      float grout = step(0.06, q.x) * step(0.08, q.y);
      col = mix(vec3(0.25, 0.23, 0.2), vec3(0.86, 0.80, 0.66), grout);
      col *= 0.85 + hash(floor(t)) * 0.15;
      col *= vert < -0.35 ? 0.6 : 1.0;
      float poster = step(abs(fract(depth * 0.18) - 0.5), 0.12) * step(abs(vert + 0.05), 0.28);
      col = mix(col, vec3(0.7, 0.12, 0.08) * (0.6 + 0.4 * step(0.0, vert)), poster * 0.85);
    }
    col *= shade;
    float pool = pow(0.5 + 0.5 * cos(fract(depth * 0.32) * 6.2831), 3.0) * shade;
    col += vec3(1.0, 0.85, 0.6) * pool * 0.22;

    float r = max(abs(uv.x) / HW, abs(uv.y) / HH);
    col = mix(col, vec3(0.9, 0.8, 0.6), smoothstep(0.12, 0.03, r) * 0.7);

    col = col / (1.0 + col);
    col *= 1.0 - smoothstep(0.4, 1.1, length(uv * vec2(0.9, 1.1))) * 0.6;
    col = pow(col, vec3(0.85));
    col += (hash(gl_FragCoord.xy + fract(iTime)) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
