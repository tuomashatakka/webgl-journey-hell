// THE HOLLOW ORCHARD — twelve stages of a fungal descent, one raymarch.
//
// Single-pass via lib/shaderQuad.ts, driven by createHollowOrchardSimulation in
// kinematics.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch,
// no dynamic array indexing, no bitwise ops.
//
// The shader owns *geometry and light, nothing else*. Pacing, palette, camera
// and the stage crossfade all arrive as uniforms, so — unlike app/journeys/liminal,
// which hand-mirrors its keyframe tables in GLSL — there is no table here to keep
// in sync. Everything below is a function of what the simulation already decided.
//
// Uniforms (packed; see kinematics.ts `uniforms()`):
//   uStage  (stageA, stageB, blend, localZ)
//   uWalk   (loopZ, loop, descent, rot)
//   uCam    (camX, eyeY, fall, stageLen)
//   uLook   (yaw, pitch, roll, bob)
//   uPulse  (breath, spore, wet, glow)
//   uBg / uKey / uTint — CPU-lerped palette
//
// The camera works in *floor-relative* space: the local floor is always y = 0 and
// the eye sits at uCam.y above it. Descent is sold by pitch, speed and palette
// rather than an absolute Y ramp — which is precisely what lets the CPU own the
// timeline without the shader duplicating it.

const COMMON = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;     // 1.0 = heavyEffects (extra fbm octaves, SSS, filaments)

  uniform vec4 uStage;      // stageA, stageB, blend, localZ
  uniform vec4 uWalk;       // loopZ, loop, descent, rot
  uniform vec4 uCam;        // camX, eyeY, fall, stageLen
  uniform vec4 uLook;       // yaw, pitch, roll, bob
  uniform vec4 uPulse;      // breath, spore, wet, glow
  uniform vec4 uPath;       // A1, k1, A2, k2 — the route's two harmonics
  uniform vec4 uAisle;      // swayAmp, radius, centreY, halfHeight
  uniform vec3 uBg;
  uniform vec3 uKey;
  uniform vec3 uTint;

  const float PI  = 3.14159265;
  const float TAU = 6.28318531;

  // Written by the SDF at the nearest hit, read by shading. Saved off before any
  // extra map() taps (normals, AO, SSS) clobber them.
  float gMat;   // 0 flesh · 1 bark/bone · 2 root/soil · 3 wet fruit · 4 spore crust
  float gWet;
  float gGlow;

  // Ray origin, published by main() so the SDFs can cheapen themselves with
  // distance. Every fbm tap costs ~32 hashes and the far field is where the
  // march spends its steps, so fading displacement out past ~16 units is the
  // single biggest win available — and fading (not clipping) keeps the distance
  // field continuous, which a hard cutoff would not.
  vec3 gRo;

  float lodAt(vec3 p) {
    return 1.0 - smoothstep(16.0, 30.0, length(p - gRo));
  }

  // --- the route -----------------------------------------------------------
  // Coefficients, not a table: kinematics.ts owns the shape and uploads it, and
  // this evaluates it at any marched z. Every stage below is authored around a
  // straight axis and mapScene bends the domain underneath them, so the whole
  // world snakes and no SDF has to know the route exists.
  float pathX(float z) {
    return sin(z * uPath.y) * uPath.x + sin(z * uPath.w) * uPath.z;
  }

  // Where the camera sits *within* the bent frame. Same expression the CPU uses
  // for camX, so the aisle below is centred on the line actually walked rather
  // than on the axis the camera only averages out to.
  float trackX(float z) {
    return sin(z * 0.055) * uAisle.x + sin(z * 0.017) * uAisle.x * 0.6;
  }

  // --- hash / noise --------------------------------------------------------
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    float a = mix(hash11(n),         hash11(n + 1.0),   f.x);
    float b = mix(hash11(n + 57.0),  hash11(n + 58.0),  f.x);
    float c = mix(hash11(n + 113.0), hash11(n + 114.0), f.x);
    float d = mix(hash11(n + 170.0), hash11(n + 171.0), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
  // Octave count rides uHeavy: 2 octaves light, 4 heavy. The bound stays constant
  // (ES 1.00 requirement) — only the early break moves.
  float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      if (float(i) > 1.0 + uHeavy * 2.0) break;
      s += a * vnoise3(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  // Ridged noise — filaments and veins. Shading only, never the SDF.
  float ridge(vec3 p) {
    return 1.0 - abs(fbm3(p) * 2.0 - 1.0);
  }

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }
  // Signed domain repetition that behaves for negative coordinates.
  float repS(float x, float s) {
    return mod(x + 0.5 * s, s) - 0.5 * s;
  }
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }
  float smax(float a, float b, float k) {
    return -smin(-a, -b, k);
  }

  // --- primitives ----------------------------------------------------------
  float sdSphere(vec3 p, float r) { return length(p) - r; }
  float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
  }
  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float sdVertCone(vec3 p, float h, float r0, float r1) {
    float t = clamp(p.y / h, 0.0, 1.0);
    float r = mix(r0, r1, t);
    float d = length(p.xz) - r;
    return max(d, max(-p.y, p.y - h));
  }
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  // --- organic operators ---------------------------------------------------
  // The rooms inhale. Phase comes from the CPU so the audio can lock to it.
  float breathe(vec3 p) {
    return sin(uPulse.x * TAU + p.z * 0.28) * (0.06 + 0.22 * uPulse.z);
  }
  // Subtractive decay: eats holes rather than adding lumps. Amplitude is clamped
  // because fbm breaks the SDF's Lipschitz bound and the march has to survive it.
  float rotDisp(vec3 p, float amt) {
    return fbm3(p * 1.7 + vec3(0.0, 0.0, iTime * 0.04)) * min(amt, 0.45);
  }
  // A mushroom cap: squashed dome, hollowed underside, rim softened.
  // Gills are a *shading* term (see shadeSurface) — putting them in the SDF
  // costs the distance bound and the march falls apart on grazing rays.
  float sdCap(vec3 p, float r, float h) {
    float dome   = sdEllipsoid(p, vec3(r, h, r));
    float hollow = sdEllipsoid(p - vec3(0.0, -h * 0.35, 0.0), vec3(r * 0.86, h * 0.8, r * 0.86));
    return smax(dome, -hollow, 0.06 * r);
  }

  // --- the twelve stages ---------------------------------------------------
  // Each returns a distance and leaves gMat / gWet / gGlow describing the surface.

  // 1 · THE NURSERY — rows of pale saplings under a low ceiling.
  float sdNursery(vec3 p) {
    float lod = lodAt(p);
    float d   = p.y;
    if (lod > 0.02)
      d += fbm3(vec3(p.x, 0.0, p.z) * 0.55) * 0.35 * lod;
    gMat = 2.0; gWet = 0.15; gGlow = 0.0;

    vec3 q     = p;
    vec2 cell  = floor((p.xz + 1.5) / 3.0);
    q.x        = repS(q.x, 3.0);
    q.z        = repS(q.z, 3.0);
    float rnd  = hash21(cell);
    float hgt  = mix(2.2, 4.4, rnd);
    float lean = (rnd - 0.5) * 0.55;
    q.xz      += vec2(lean, lean * 0.6) * q.y;

    float trunk = sdVertCone(q, hgt, 0.16, 0.045);
    // Fur only on the sick upper half, only nearby, and only with heavy effects —
    // this is the densest stage in the journey and an fbm tap here costs real frames.
    if (uHeavy > 0.5 && lod > 0.02)
      trunk -= rotDisp(p * 0.9, 0.10) * smoothstep(1.2, 2.4, p.y) * (0.4 + uWalk.w) * lod;
    if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.1; gGlow = 0.0; }

    // A sick little cap on roughly a third of them.
    if (rnd > 0.62) {
      float cap = sdCap(q - vec3(0.0, hgt, 0.0), mix(0.28, 0.5, rnd), 0.22);
      if (cap < d) { d = cap; gMat = 0.0; gWet = 0.45; gGlow = 0.25 + 0.5 * uWalk.w; }
    }

    // Sagging ceiling. Keep the displacement gentle: this term is min'd into the
    // scene distance, so a gradient over 1 makes it a distance *over*estimate and
    // the march steps straight past the trunks, shredding them into fragments.
    float ceil = 6.2 - p.y;
    if (lod > 0.02)
      ceil += fbm3(p * 0.4) * 0.9 * lod;
    if (ceil < d) { d = ceil; gMat = 2.0; gWet = 0.2; gGlow = 0.0; }
    return d;
  }

  // 2 · SPORE CATHEDRAL — caps as vaulting, stems as columns.
  float sdSporeCathedral(vec3 p) {
    float d = p.y + fbm3(vec3(p.x, 0.0, p.z) * 0.4) * 0.25;
    gMat = 2.0; gWet = 0.2; gGlow = 0.0;

    vec3 q    = p;
    vec2 cell = floor((p.xz + 5.5) / 11.0);
    q.x       = repS(q.x, 11.0);
    q.z       = repS(q.z, 11.0);
    float rnd = hash21(cell + 7.7);

    // Stem: a column that thickens into the floor and flares into the vault.
    float stem = length(q.xz) - (0.55 + 0.22 * sin(q.y * 0.35) + q.y * 0.02);
    stem       = max(stem, -p.y);
    stem       = smin(stem, d + 0.6, 1.4);          // fuse the base into the ground

    float capH = mix(8.5, 11.5, rnd);
    float cap  = sdCap(q - vec3(0.0, capH, 0.0), 6.4, 2.2);
    float vault = smin(stem, cap, 1.1);
    float lod   = lodAt(p);
    if (lod > 0.02)
      vault -= rotDisp(p * 0.5, 0.18) * 0.5 * lod;

    if (vault < d) { d = vault; gMat = 0.0; gWet = 0.3; gGlow = 0.35; }
    return d;
  }

  // 3 · MARROW GROVE — bone-white trunks, knuckled, twisted.
  float sdMarrowGrove(vec3 p) {
    float d = p.y + fbm3(vec3(p.x, 0.0, p.z) * 0.7) * 0.2;
    gMat = 1.0; gWet = 0.05; gGlow = 0.0;

    vec3 q    = p;
    vec2 cell = floor((p.xz + 2.25) / 4.5);
    q.x       = repS(q.x, 4.5);
    q.z       = repS(q.z, 4.5);
    float rnd = hash21(cell + 3.1);

    q.xz *= rot2(q.y * (0.06 + rnd * 0.09));        // slow twist up the trunk
    float r     = 0.30 + 0.07 * sin(q.y * 3.0 + rnd * 6.0);  // knuckles
    float trunk = length(q.xz) - r;
    trunk       = max(trunk, p.y - mix(7.0, 12.0, rnd));
    trunk       = max(trunk, -p.y - 0.2);
    trunk       = smin(trunk, d + 0.5, 0.9);        // flare into the floor

    if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.02; gGlow = 0.0; }

    // Fallen litter.
    vec3 l    = p;
    l.x       = repS(l.x, 4.5) + 1.4;
    l.z       = repS(l.z + 2.2, 4.5);
    float bone = sdCapsule(l, vec3(-0.9, 0.13, 0.0), vec3(0.9, 0.13, 0.25), 0.11);
    if (bone < d) { d = bone; gMat = 1.0; gWet = 0.05; gGlow = 0.0; }
    return d;
  }

  // 4 · THE ROOT LABYRINTH — a carved corridor, braided shut.
  float sdRootLabyrinth(vec3 p) {
    // Interior of a box: negating keeps the march bounded no matter how the
    // roots below chew into it.
    vec2 c     = vec2(sin(p.z * 0.06) * 1.6, 0.0);
    float room = -sdBox(p - vec3(c.x, 1.7, 0.0), vec3(2.4, 1.9, 1e4));
    float d  = room;
    gMat = 2.0; gWet = 0.35; gGlow = 0.0;

    // Braided roots fused into the walls.
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float ph = fi * 1.7 + p.z * (0.18 + fi * 0.04);
      vec3 a   = vec3(c.x + cos(ph) * 2.1, 1.7 + sin(ph) * 1.5, p.z - 3.0);
      vec3 b   = vec3(c.x + cos(ph + 0.9) * 2.1, 1.7 + sin(ph + 0.9) * 1.5, p.z + 3.0);
      float rt = sdCapsule(p, a, b, 0.20 + 0.08 * sin(p.z * 0.9 + fi));
      d = smin(d, rt, 0.35);
    }
    d -= rotDisp(p * 1.1, 0.14) * (0.5 + uWalk.w * 0.5);
    if (d < room - 0.01) { gMat = 2.0; gWet = 0.5; gGlow = 0.1; }
    return d;
  }

  // 5 · FRUITING BODY — a tube of wet muscle that breathes.
  float sdFruitingBody(vec3 p) {
    vec2 c    = vec2(sin(p.z * 0.05) * 1.2, 1.5 + sin(p.z * 0.037) * 0.5);
    float rad = 2.5
              + breathe(p)
              + sin(p.z * 0.5) * 0.28                 // sphincter rings
              - rotDisp(p * 1.3, 0.30);
    float d = rad - length(p.xy - c);
    gMat = 0.0; gWet = 1.0; gGlow = 0.15 + 0.5 * uPulse.x;

    // Polyps clinging to the wall.
    vec3 q = p;
    q.z    = repS(q.z, 6.0);
    float a = atan(p.y - c.y, p.x - c.x);
    float k = floor(a / TAU * 7.0);
    float pr = 0.34 + 0.2 * hash11(k + floor(p.z / 6.0) * 13.0);
    vec3 pc = vec3(c.x + cos(k / 7.0 * TAU) * rad * 0.9,
                   c.y + sin(k / 7.0 * TAU) * rad * 0.9,
                   0.0);
    float polyp = sdSphere(q - pc, pr) - breathe(p) * 0.3;
    if (polyp < d) { d = polyp; gMat = 3.0; gWet = 1.0; gGlow = 0.5; }
    return d;
  }

  // 6 · TRANSITION — the nursery again, with the floor coming apart.
  float sdTransition(vec3 p) {
    float open = smoothstep(0.0, 1.0, uStage.w / max(uCam.w, 1.0));

    // Floor with a hole that widens as the stage runs out.
    float hole  = length(vec2(p.x, repS(p.z, 60.0))) - open * 14.0;
    float floorD = smax(p.y + fbm3(p * 0.5) * 0.3, -hole, 0.6);
    float d = floorD;
    gMat = 2.0; gWet = 0.3; gGlow = 0.0;

    // Dead saplings, thinning out.
    vec3 q    = p;
    vec2 cell = floor((p.xz + 2.0) / 4.0);
    q.x       = repS(q.x, 4.0);
    q.z       = repS(q.z, 4.0);
    float rnd = hash21(cell + 11.0);
    if (rnd > open * 0.8) {
      float trunk = sdVertCone(q, mix(1.6, 3.4, rnd), 0.13, 0.03);
      if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.1; gGlow = 0.0; }
    }

    // The shaft wall you are about to drop past. Displaced so it reads as torn
    // earth rather than as a poured concrete pipe.
    float shaft = abs(length(vec2(p.x, repS(p.z, 60.0))) - 15.0) - 1.0
                - rotDisp(p * 0.5, 0.42) * 2.4;
    shaft = max(shaft, -p.y - 2.0);
    if (shaft < d) { d = shaft; gMat = 2.0; gWet = 0.4; gGlow = 0.1; }

    // Roots torn loose from the rim, hanging into the opening.
    vec3 r = p;
    r.z    = repS(r.z, 7.0);
    r.x    = repS(r.x, 5.0);
    float dangle = sdCapsule(r, vec3(0.0, 0.4, 0.0), vec3(0.3, -3.0 * open, 0.2), 0.09);
    if (dangle < d) { d = dangle; gMat = 1.0; gWet = 0.3; gGlow = 0.05; }
    return d;
  }

  // 7 · THE BLOOM — one enormous cap, aperture widening as you fall past it.
  float sdBloom(vec3 p) {
    vec3 q = p;
    q.z    = repS(q.z, 46.0);
    float open = 3.0 + uWalk.z * 9.0;

    float cap  = sdCap(q - vec3(0.0, 7.0, 0.0), 16.0, 6.0);
    float bore = length(vec2(q.x, q.z)) - open;      // the throat you fall through
    float d    = smax(cap, -bore, 0.8);
    d         -= rotDisp(p * 0.35, 0.4) * 0.8;
    gMat = 0.0; gWet = 0.6; gGlow = 0.6;

    // Petal ribs hanging off the rim.
    float a   = atan(q.z, q.x);
    float rib = abs(sin(a * 9.0)) * 0.5 + 0.5;
    d -= rib * 0.35;

    // A sleeve *around* the throat, not a plug inside it: at open = 3 the old
    // radius of 2.85 sat entirely within the 3-unit bore, so the one opening the
    // camera is aimed at was filled with solid stalk and you fell through it.
    float stalk = length(q.xz) - (open + 1.8);
    stalk = max(stalk, q.y - 7.0);
    stalk = max(stalk, -bore);
    if (stalk < d) { d = stalk; gMat = 3.0; gWet = 0.9; gGlow = 0.35; }
    return d;
  }

  // 8 · HOST — bodies grown into the wall of the shaft.
  float sdHost(vec3 p) {
    float rad = 5.5 + breathe(p) * 1.6;
    float d   = rad - length(p.xy - vec2(0.0, 1.5));
    gMat = 0.0; gWet = 0.7; gGlow = 0.2;

    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float a  = fi / 5.0 * TAU + p.z * 0.02;
      vec2  at = vec2(cos(a), sin(a)) * (rad - 0.7);
      vec3  q  = p;
      q.z      = repS(q.z - fi * 2.3, 11.5);

      vec3 base = vec3(at.x, at.y + 1.5, 0.0);
      // torso · head · one reaching arm
      float body = sdCapsule(q, base, base + vec3(-at.x, -at.y, 0.0) * 0.16 + vec3(0.0, 0.9, 0.0), 0.42);
      float head = sdSphere(q - base - vec3(-at.x, -at.y, 0.0) * 0.2 - vec3(0.0, 1.35, 0.0), 0.30);
      float arm  = sdCapsule(q, base + vec3(0.0, 0.7, 0.0),
                             base + vec3(-at.x, -at.y, 0.0) * 0.75 + vec3(0.0, 0.4, 0.0), 0.13);
      float fig  = smin(smin(body, head, 0.16), arm, 0.14);
      d = smin(d, fig, 0.55);
      if (fig < d + 0.4) { gMat = 3.0; gWet = 0.85; gGlow = 0.3 + 0.4 * uPulse.x; }
    }
    d -= rotDisp(p * 0.8, 0.22) * 0.7;
    return d;
  }

  // 9 · THE HARVEST — fruiting bodies hung on cords.
  float sdHarvest(vec3 p) {
    // The shaft is displaced, not a smooth cylinder — a clean tube reads as a
    // flat wall the moment the camera finds a gap between the fruiting bodies.
    float rad = 7.0 - rotDisp(p * 0.45, 0.40) * 2.2;
    float d   = rad - length(p.xy - vec2(0.0, 2.0));
    gMat = 2.0; gWet = 0.4; gGlow = 0.1;

    vec3 q    = p;
    float row = floor(p.z / 5.5);
    q.z       = repS(q.z, 5.5);
    q.x       = repS(q.x, 3.4);
    float rnd = hash21(vec2(row, floor(p.x / 3.4)));

    float drop  = mix(1.5, 5.0, rnd);
    float sway  = sin(iTime * 0.5 + rnd * 6.2) * 0.18;
    vec3  hang  = vec3(sway * drop, 7.0 - drop, 0.0);
    float cord  = sdCapsule(q, vec3(0.0, 7.2, 0.0), hang, 0.035);
    float fruit = sdEllipsoid(q - hang, vec3(0.42, 0.62, 0.42) * mix(0.7, 1.4, rnd));
    fruit      -= breathe(p) * 0.25;

    if (cord < d)  { d = cord;  gMat = 1.0; gWet = 0.2; gGlow = 0.0; }
    if (fruit < d) { d = fruit; gMat = 3.0; gWet = 1.0; gGlow = 0.55 + 0.4 * rnd; }
    return d;
  }

  // 10 · MYCELIAL FALL — no floor, no walls: filament space.
  float sdMycelialFall(vec3 p) {
    float d = 1e4;
    gMat = 4.0; gWet = 0.15; gGlow = 0.85;

    // Three axis-aligned hyphal families, each on its own lattice.
    vec3 a = p;
    a.x = repS(a.x, 2.6); a.y = repS(a.y - 1.0, 2.6);
    d = min(d, length(a.xy) - 0.045);

    vec3 b = p;
    b.xz *= rot2(0.7);
    b.x = repS(b.x, 3.1); b.z = repS(b.z, 3.1);
    d = min(d, length(b.xz) - 0.038);

    vec3 c = p;
    c.xy *= rot2(-0.5);
    c.y = repS(c.y, 2.2); c.z = repS(c.z, 4.4);
    d = min(d, length(c.yz) - 0.05);

    // Nodes where the families cross.
    vec3 n = vec3(repS(p.x, 2.6), repS(p.y - 1.0, 2.2), repS(p.z, 4.4));
    d = smin(d, length(n) - 0.16, 0.2);
    return d;
  }

  // 11 · SEED VAULT — chambered spheres, each with something curled inside.
  float sdSeedVault(vec3 p) {
    float rad = 8.0 - rotDisp(p * 0.4, 0.40) * 2.6;
    float d   = rad - length(p.xy - vec2(0.0, 2.0));
    gMat = 1.0; gWet = 0.1; gGlow = 0.05;

    vec3 q    = p;
    vec2 cell = floor(vec2(p.x, p.z) / 4.4);
    q.x       = repS(q.x, 4.4);
    q.z       = repS(q.z, 4.4);
    q.y       = repS(q.y - 2.0, 4.4);
    float rnd = hash21(cell + 5.5);

    float shell  = sdSphere(q, 1.25);
    float hollow = sdSphere(q, 1.05);
    float pod    = smax(shell, -hollow, 0.04);
    // A window cut into the shell so the embryo shows.
    float win    = sdBox(q - vec3(0.0, 0.0, 1.1), vec3(0.6, 0.6, 0.4));
    pod          = smax(pod, -win, 0.05);

    float embryo = sdEllipsoid(q - vec3(0.0, -0.15, 0.0), vec3(0.5, 0.38, 0.5))
                 - breathe(p) * 0.2;

    if (pod < d)    { d = pod;    gMat = 1.0; gWet = 0.1;  gGlow = 0.1; }
    if (embryo < d) { d = embryo; gMat = 3.0; gWet = 0.95; gGlow = 0.4 + 0.5 * rnd; }
    return d;
  }

  // 12 · COMPOST — everything softened back into sludge.
  float sdCompost(vec3 p) {
    float d = p.y + 2.0
            + fbm3(p * 0.35 + vec3(0.0, 0.0, iTime * 0.02)) * 2.6
            + fbm3(p * 1.4) * 0.5;
    gMat = 2.0; gWet = 0.8; gGlow = 0.0;

    // Half-dissolved lumps of everything you already walked through.
    vec3 q = p;
    q.x = repS(q.x, 5.0);
    q.z = repS(q.z, 5.0);
    float lump = sdEllipsoid(q - vec3(0.0, -1.2, 0.0), vec3(1.4, 0.7, 1.1));
    lump -= fbm3(p * 0.9) * 0.6;
    d = smin(d, lump, 1.2);
    return d;
  }

  // --- dispatch ------------------------------------------------------------
  float stageSDF(vec3 p, float id) {
    if (id < 1.5)  return sdNursery(p);
    if (id < 2.5)  return sdSporeCathedral(p);
    if (id < 3.5)  return sdMarrowGrove(p);
    if (id < 4.5)  return sdRootLabyrinth(p);
    if (id < 5.5)  return sdFruitingBody(p);
    if (id < 6.5)  return sdTransition(p);
    if (id < 7.5)  return sdBloom(p);
    if (id < 8.5)  return sdHost(p);
    if (id < 9.5)  return sdHarvest(p);
    if (id < 10.5) return sdMycelialFall(p);
    if (id < 11.5) return sdSeedVault(p);
    return sdCompost(p);
  }

  // Crossfading two SDFs is a *morph*, not a union — which for fungus is the
  // correct artifact rather than a bug. Where it does misbehave it is buried
  // under the spore surge that peaks at exactly the same moment (see main).
  // The cleared aisle, as a capsule swept along the walked line: a vertical
  // stadium in (x, y), infinite in z, wobbling so it reads as eaten rather than
  // bored. Everything inside it is removed from the scene, which is the only
  // reason the camera can be promised a clear run — twelve stages all grow
  // something at the centre of their repeated cell, and that centre is the line
  // the camera walks.
  float aisleSD(vec3 p) {
    float r = uAisle.y + 0.20 * sin(p.z * 0.23) + 0.12 * sin(p.z * 0.61 + 1.1);
    vec2  q = vec2(p.x - trackX(p.z), p.y - uAisle.z);
    q.y     = max(0.0, abs(q.y) - uAisle.w);
    return length(q) - r;
  }

  float mapScene(vec3 p) {
    // Bend first: every SDF below sees the straight world it was authored in.
    p.x -= pathX(p.z);

    float dA = stageSDF(p, uStage.x);
    float d  = dA;

    if (uStage.z >= 0.002) {                  // uniform branch: coherent across the frame
      float mA = gMat, wA = gWet, gA = gGlow;
      float dB = stageSDF(p, uStage.y);
      gMat  = mix(mA, gMat,  uStage.z);
      gWet  = mix(wA, gWet,  uStage.z);
      gGlow = mix(gA, gGlow, uStage.z);
      d     = mix(dA, dB, uStage.z);
    }

    // Then carve. smax rather than max so the aisle blends into what it cut
    // instead of leaving a machined lip along its whole length.
    return smax(d, -aisleSD(p), 0.35);
  }

  vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(1.0, -1.0) * (0.0009 + 0.0012 * t);
    return normalize(
      e.xyy * mapScene(p + e.xyy) +
      e.yyx * mapScene(p + e.yyx) +
      e.yxy * mapScene(p + e.yxy) +
      e.xxx * mapScene(p + e.xxx));
  }

  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 4; i++) {
      float h = 0.02 + 0.14 * float(i);
      occ += (h - mapScene(p + n * h)) * sca;
      sca *= 0.72;
    }
    return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
  }
`

// Shading, camera and the folded-in post chain. Split from COMMON only so the
// preview below can pull in the noise helpers without any of the raymarch.
const SCENE = `
  // Spore motes. Screen-space and additive — cheaper than geometry and it reads
  // better, because real spores are out of focus at every distance.
  vec3 spores(vec2 uv, float t) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      if (fi > 4.0 + uHeavy * 7.0) break;
      float depth = 0.35 + fi * 0.22;
      vec2  g     = uv * (2.0 + fi * 1.6) + vec2(sin(t * 0.07 + fi) * 0.4, -t * 0.05 / depth);
      vec2  id    = floor(g);
      vec2  f     = fract(g) - 0.5;
      float rnd   = hash21(id + fi * 17.0);
      if (rnd < 0.62) continue;
      vec2  off   = vec2(sin(t * 0.6 + rnd * 30.0), cos(t * 0.5 + rnd * 21.0)) * 0.22;
      float m     = smoothstep(0.16, 0.0, length(f - off));
      acc += uTint * m * (0.5 / depth) * (0.4 + 0.6 * rnd);
    }
    return acc * uPulse.y;
  }

  vec3 shadeSurface(vec3 p, vec3 rd, vec3 n, float t, float mat, float wet, float glow) {
    vec3 keyDir = normalize(vec3(-0.45, 0.72, -0.30));

    vec3 base;
    if (mat < 0.5)      base = uTint * 0.55 + vec3(0.10, 0.06, 0.05);   // flesh / fungus
    else if (mat < 1.5) base = vec3(0.78, 0.74, 0.66);                  // bark / bone
    else if (mat < 2.5) base = vec3(0.20, 0.15, 0.11);                  // root / soil
    else if (mat < 3.5) base = uTint * 0.85 + vec3(0.12, 0.02, 0.04);   // wet fruit
    else                base = vec3(0.62, 0.66, 0.78);                  // spore crust

    // Rot mottling, and gills where a cap is facing down.
    float mott = fbm3(p * 2.4);
    base *= mix(1.0, 0.55 + mott * 0.9, 0.35 + 0.5 * uWalk.w);
    if (mat < 0.5) {
      float gill = 0.5 + 0.5 * sin(atan(p.z, p.x) * 36.0);
      base *= mix(1.0, 0.72 + gill * 0.5, clamp(-n.y, 0.0, 1.0));
    }

    float ndl = clamp(dot(n, keyDir), 0.0, 1.0);
    float ao  = calcAO(p, n);
    vec3  col = base * uKey * (0.12 + 0.9 * ndl) * ao;

    // Hemisphere ambient — the ground is dead, the air above it glows a little.
    col += base * mix(uBg * 0.5, uKey * 0.18, 0.5 + 0.5 * n.y) * ao;

    // Fake subsurface: how thick is the thing we just hit? Backlit translucency
    // is what makes fungus read as alive instead of as painted plastic.
    if (uHeavy > 0.5) {
      float thick = max(0.0, -mapScene(p - n * 0.4));
      float back  = pow(clamp(dot(rd, -keyDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
      col += uTint * exp(-thick * 3.5) * back * (0.35 + 0.55 * wet);
    }

    // Wet specular + rim.
    vec3  h    = normalize(keyDir - rd);
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), mix(12.0, 64.0, wet));
    col += uKey * spec * wet * 0.6;
    col += uTint * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * (0.18 + 0.5 * glow);

    // Mycelial filament tracery, heavy-effects only.
    if (uHeavy > 0.5)
      col += uTint * pow(ridge(p * 3.2 + vec3(0.0, 0.0, iTime * 0.06)), 6.0) * glow * 0.7;

    return col;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // Barrel distortion applied to the *ray*, not to a rendered image. Same lens
    // read as a CRT post pass, but there is no second pass here to sample from.
    // Scanlines and the RGB column split come free from #crt-overlay in CSS.
    float r2 = dot(uv, uv);
    uv *= 1.0 + r2 * (0.09 + 0.16 * uWalk.w);

    float fall  = uCam.z;
    float yaw   = uLook.x - uPointer.x * 0.42; // right = cross(fwd, Y) is -x facing +z: negative yaw turns right
    float pitch = uLook.y + uPointer.y * 0.26;

    // The camera rides the bent centreline, so its world x carries pathX. gRo is
    // deliberately the *straight-frame* position instead: lodAt() compares it
    // against points that mapScene has already unbent, and mixing the two frames
    // would fade displacement in and out with the turn rather than with distance.
    gRo     = vec3(uCam.x, uCam.y + uLook.w, uWalk.x);
    vec3 ro = gRo + vec3(pathX(uWalk.x), 0.0, 0.0);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);

    float roll = uLook.z;
    float cr = cos(roll), sr = sin(roll);
    vec3 rgt2 = rgt * cr - up * sr;
    up        = rgt * sr + up * cr;
    rgt       = rgt2;

    // Wider the harder you are falling.
    float focal = mix(1.05, 0.52, fall) * mix(1.0, 0.86, uWalk.w);
    vec3  rd    = normalize(uv.x * rgt + uv.y * up + focal * fwd);

    // --- march ---
    float t = 0.05;
    float d = 0.0;
    bool  hit = false;
    for (int i = 0; i < 92; i++) {
      vec3 p = ro + rd * t;
      d = mapScene(p);
      if (d < 0.0015 * t + 0.0012) { hit = true; break; }
      if (t > 120.0) break;
      // Undershoot: fbm displacement breaks the Lipschitz bound, and the route's
      // shear inflates the estimate by up to ~1.8x on top of that (see the note
      // on PATH_A1 in kinematics.ts). 0.48 stays under the reciprocal of both.
      t += d * 0.48;
    }

    vec3 col = uBg;
    if (hit) {
      vec3  p    = ro + rd * t;
      float mat  = gMat, wet = gWet, glow = gGlow;   // save before extra map() taps
      vec3  n    = calcNormal(p, t);
      col        = shadeSurface(p, rd, n, t, mat, wet, glow);
    }

    // Exponential fog into the stage's own colour, thickened by rot and by the
    // crossfade — every stage change arrives inside a wall of spores, which is
    // also what hides the geometry morph underneath it.
    // (Named xfade, not cross -- cross() is a GLSL builtin called above in this scope.)
    float xfade = sin(uStage.z * PI);
    float den   = 0.016 + 0.030 * uWalk.w + 0.05 * xfade + 0.02 * uPulse.z;
    col = mix(uBg, col, exp(-t * den));

    // Cheap wavelength split in the haze only — the one chromatic effect a
    // single pass can afford, since it needs no resampling of the scene.
    float haze = 1.0 - exp(-t * den);
    col += vec3(0.030, 0.0, -0.022) * haze * uWalk.w;

    col += spores(uv, iTime) * (0.6 + 0.8 * xfade);
    col += uTint * uPulse.w * 0.10 * (0.5 + 0.5 * sin(uPulse.x * TAU));   // glow pulse

    // --- folded post ---
    col *= 1.0 - smoothstep(0.42, 1.10, length(uv)) * (0.55 + 0.25 * uWalk.w);  // vignette
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.5, lum) * 0.5;                              // bloom
    col  = pow(clamp(col, 0.0, 1.7), vec3(0.90));
    col  = mix(col, col * vec3(1.08, 0.90, 1.06), uWalk.w);                     // sickness grade
    col *= 0.94 + 0.06 * uPulse.x;                                              // it breathes
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.035;       // grain

    gl_FragColor = vec4(col, 1.0);
  }
`

export const hollowOrchardFrag = COMMON + SCENE

// Hover preview. Self-driving on iTime alone: ShaderPreviewLayer attaches no
// simulation, so uStage/uCam would all read zero and the real shader would
// render a black frame. No raymarch either — every card in the grid shares one
// GL context, so this has to compile fast and stay branch-light.
export const hollowOrchardPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.10;

    const float HORIZON = 0.20;
    const float FOCAL   = 0.9;

    // Bruised violet above, sick amber ground below.
    vec3 col = mix(vec3(0.11, 0.055, 0.15), vec3(0.03, 0.02, 0.05),
                   smoothstep(-0.05, 0.45, uv.y));
    if (uv.y < HORIZON) {
      float gd = 1.0 / max(HORIZON - uv.y, 0.004);   // ground distance at this pixel
      col = vec3(0.17, 0.115, 0.055) * clamp(2.2 / gd, 0.06, 1.0) + vec3(0.02, 0.012, 0.02);
    }

    // Rows of saplings as discrete depth layers, painted far to near. Doing it
    // per-layer (rather than per-pixel off a y-varying depth) is what keeps the
    // trunks actually vertical — the cheap way streaks them into diagonals.
    for (int i = 0; i < 8; i++) {
      float fi    = float(i);
      float zi    = fract(iTime * 0.09 + fi / 8.0);
      // Linear in zi = constant world speed. Stops at 1.9 so the nearest row
      // never swallows the card, and fades out before it would.
      float depth = mix(9.5, 1.9, zi);
      float yG    = HORIZON - 1.15 / depth;            // where this row meets the ground
      if (uv.y < yG) continue;

      float worldX = uv.x * depth / FOCAL;
      float cellF  = worldX / 2.4;
      float rnd    = hash21(vec2(floor(cellF), floor(zi * 90.0)));
      float wdist  = abs(fract(cellF) - 0.5) * 2.4;    // world units from trunk axis
      float halfW  = 0.15 + 0.06 * rnd;
      float hgt    = (2.6 + 2.0 * rnd) / depth;
      float top    = yG + hgt;
      if (uv.y > top) continue;

      float bar   = smoothstep(halfW, halfW * 0.55, wdist);
      float shade = clamp(3.5 / depth, 0.08, 1.0);
      // Fade in at the far plane, back out before the row reaches the lens.
      float fade  = smoothstep(0.0, 0.14, zi) * smoothstep(1.0, 0.82, zi);
      col = mix(col, vec3(0.62, 0.55, 0.41) * shade, bar * fade * 0.95);

      // The cap on top of it.
      vec2  cp   = vec2(uv.x - (floor(cellF) + 0.5) * 2.4 * FOCAL / depth, uv.y - top);
      float capR = (0.55 + 0.3 * rnd) / depth;
      float cap  = smoothstep(capR, capR * 0.7, length(cp * vec2(1.0, 2.6)));
      col = mix(col, vec3(0.78, 0.52, 0.24) * shade, cap * fade * 0.92);
    }

    // One enormous cap arcing overhead, above all of it.
    float arc = smoothstep(0.07, 0.0, abs(length(uv - vec2(0.0, -0.62)) - 0.92));
    col += vec3(0.58, 0.36, 0.17) * arc * 0.6;

    // Spore motes.
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      vec2  g  = uv * (3.0 + fi * 1.4) + vec2(sin(iTime * 0.1 + fi), -iTime * 0.06);
      vec2  f  = fract(g) - 0.5;
      float rn = hash21(floor(g) + fi * 13.0);
      if (rn < 0.7) continue;
      col += vec3(0.95, 0.66, 0.30) * smoothstep(0.17, 0.0, length(f)) * 0.35 / (1.0 + fi * 0.3);
    }

    col *= 1.0 - smoothstep(0.35, 1.05, length(uv)) * 0.7;      // vignette
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`
