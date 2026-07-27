// SKYBRIDGES — a first-person run across nine themed glass skybridges suspended
// over a cloud sea, skyscrapers rising from the haze in the distance. One
// unbroken journey: the path climbs, drops, leaps onto a train, falls, and is
// caught — each section a distinct scene placed in its own world-Z band. See
// SPEC.md in this directory for the full design.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only, no dynamic array indexing. Uniforms:
// iResolution, iTime, uPointer, uHeavy (heavyEffects -> see-through glass),
// uEnv (equirect env), uEnvLoaded.

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (see-through refraction march)
  uniform sampler2D uEnv;      // equirectangular environment map (unit 0)
  uniform float uEnvLoaded;    // 1.0 once uEnv's image has uploaded

  const float PI = 3.14159265359;
  const float SEG = 9.0;         // Z length of each main-deck segment
  const float SPEED = 7.5;       // forward run speed (units/sec) — mirrors kinematics.ts
  const float LOOP_Z = 540.0;    // nine 60-unit sections; mirrored in kinematics.ts
  const float EYE = 1.6;         // first-person eye height above the deck

  // Material/look state written by the SDF at the nearest hit, read by shading.
  float gThick;   // thin-film thickness proxy + Beer-Lambert depth
  float gFell;    // fracture/darken weight 0..1
  float gSpark;   // shatter sparkle weight 0..1
  float gMat;     // 0 = glass, 1 = train (dark metal)

  // Continuous per-fragment atmosphere (set once by setupAtmosphere()).
  vec3  gBg, gKeyDir, gKeyCol, gGlassTint;
  float gRough, gDisp, gBloom, gFogDen;
  // Section weights (0..1), peaking at each act centre, overlapping:
  // 1 DAWN 2 CONVERGENCE 3 ASCENT 4 HIGH-SPAN 5 TRAIN 6 CATCH 7 FROST 8 HELIX 9 SKYLIGHT
  float gDawn, gConv, gAsc, gSpan, gTrain, gCatch, gFrost, gHelix, gSky;

  // --- hash / noise --------------------------------------------------------
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < FBM_OCTAVES; i++) { s += amp * vnoise(p); p *= 2.02; amp *= 0.5; }
    return s;
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // --- SDF primitives ------------------------------------------------------
  float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
  float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xy) - t.x, p.z); return length(q) - t.y; }

  // --- easing / physics shapes --------------------------------------------
  float easeIO(float u) { u = clamp(u, 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
  float accel(float u)  { u = clamp(u, 0.0, 1.0); return u * u; }            // from rest (gravity)
  float decel(float u)  { u = clamp(u, 0.0, 1.0); return 1.0 - (1.0 - u) * (1.0 - u); }
  float win(float z, float a, float b, float c, float d) { return smoothstep(a, b, z) - smoothstep(c, d, z); }

  // --- timeline ------------------------------------------------------------
  float rawPlayerZ() { return iTime * SPEED; }
  float sectionZ() { return mod(rawPlayerZ(), LOOP_Z); }
  float playerZ() { return rawPlayerZ(); }
  float sectionEnv(float center, float halfW) {
    float d = abs(sectionZ() - center);
    d = min(d, LOOP_Z - d);
    return 1.0 - smoothstep(0.0, halfW, d);
  }

  // --- vertical path (first-person eye Y), continuous, physically shaped ----
  // E0 = ground eye, E1 = upper-tier eye, ET = train-roof eye. See SPEC.md §4.
  float pathY(float z) {
    z = mod(z, LOOP_Z);
    float E0 = EYE, E1 = 11.6, ET = -2.3;
    if (z < 120.0) return E0;                                              // 1 dawn / 2 convergence
    if (z < 180.0) return mix(E0, E1, easeIO((z - 120.0) / 60.0));         // 3 ascent (climb)
    if (z < 225.0) return E1;                                             // 4 high catwalk
    if (z < 240.0) return mix(E1, E0, accel((z - 225.0) / 15.0));         // 4 jump down
    if (z < 248.0) return E0;                                             // brief lower run
    if (z < 260.0) return mix(E0, ET, accel((z - 248.0) / 12.0));         // 5 leap onto train
    if (z < 288.0) return ET + sin(z * 0.5) * 0.22;                       // 5 ride (sway)
    if (z < 300.0) return ET - accel((z - 288.0) / 12.0) * 37.2;          // 5 free fall
    if (z < 330.0) return mix(-39.5, E0, decel((z - 300.0) / 30.0));      // 6 catch + climb
    if (z < 360.0) return E0;                                             // 6 settle
    if (z < 420.0) return E0 + sin((z - 360.0) * 0.12) * 0.3;             // 7 frost (flat)
    if (z < 480.0) return E0 + sin((z - 420.0) / 60.0 * PI) * 4.0;        // 8 helix rise/fall
    return E0;                                                            // 9 skylight
  }

  // Deck top Y at canonical depth sz, or 1e4 where there is no main deck
  // (jump gaps, the train section, etc — those use other geometry).
  float deckTopAt(float sz) {
    float zz = mod(sz, LOOP_Z);
    if (zz < 225.0) return pathY(sz) - EYE;        // ground / climb / catwalk
    if (zz < 240.0) return 1e4;                     // jump-down gap
    if (zz < 248.0) return 0.0;                     // brief landing deck
    if (zz < 300.0) return 1e4;                     // train section
    if (zz < 540.0) return pathY(sz) - EYE;         // catch / settle / frost / helix / skylight
    return pathY(sz) - EYE;
  }

  // --- atmosphere ----------------------------------------------------------
  void setupAtmosphere() {
    gDawn  = sectionEnv(30.0, 64.0);  gConv  = sectionEnv(90.0, 64.0);  gAsc   = sectionEnv(150.0, 64.0);
    gSpan  = sectionEnv(210.0, 64.0); gTrain = sectionEnv(270.0, 64.0); gCatch = sectionEnv(330.0, 64.0);
    gFrost = sectionEnv(390.0, 64.0); gHelix = sectionEnv(450.0, 64.0); gSky   = sectionEnv(510.0, 64.0);

    float s = 0.0, w;
    vec3 bg = vec3(0.0), kd = vec3(0.0), kc = vec3(0.0), gt = vec3(0.0);
    float ro = 0.0, di = 0.0, bl = 0.0, fd = 0.0;
    // 1 DAWN APPROACH — warm low sun, clear
    w = gDawn;  s += w; bg += w*vec3(0.12,0.13,0.20); kd += w*normalize(vec3(-0.35,0.16,0.92)); kc += w*vec3(1.00,0.76,0.50); gt += w*vec3(0.90,0.93,0.97); ro += w*0.05; di += w*0.020; bl += w*0.40; fd += w*0.013;
    // 2 CONVERGENCE — cool prism, crossing bridges
    w = gConv;  s += w; bg += w*vec3(0.10,0.15,0.26); kd += w*normalize(vec3( 0.30,0.42,0.86)); kc += w*vec3(1.00,0.98,0.98); gt += w*vec3(0.95,0.97,1.00); ro += w*0.03; di += w*0.115; bl += w*0.46; fd += w*0.012;
    // 3 ASCENT — bright opening, climb
    w = gAsc;   s += w; bg += w*vec3(0.13,0.18,0.30); kd += w*normalize(vec3( 0.10,0.34,0.94)); kc += w*vec3(0.82,0.90,1.00); gt += w*vec3(0.86,0.92,1.00); ro += w*0.05; di += w*0.035; bl += w*0.40; fd += w*0.013;
    // 4 HIGH SPAN — teal, thin, vertigo
    w = gSpan;  s += w; bg += w*vec3(0.07,0.17,0.22); kd += w*normalize(vec3(-0.18,0.36,0.91)); kc += w*vec3(0.58,0.92,1.00); gt += w*vec3(0.80,0.94,0.99); ro += w*0.05; di += w*0.050; bl += w*0.42; fd += w*0.018;
    // 5 TRAIN — dramatic side light, energetic
    w = gTrain; s += w; bg += w*vec3(0.18,0.15,0.18); kd += w*normalize(vec3(0.55,0.30,0.78));  kc += w*vec3(1.00,0.82,0.62); gt += w*vec3(0.92,0.94,1.00); ro += w*0.05; di += w*0.045; bl += w*0.58; fd += w*0.016;
    // 6 CATCH — warm golden relief
    w = gCatch; s += w; bg += w*vec3(0.22,0.16,0.14); kd += w*normalize(vec3(0.20,0.40,0.89));  kc += w*vec3(1.00,0.78,0.52); gt += w*vec3(0.96,0.90,0.84); ro += w*0.05; di += w*0.040; bl += w*0.70; fd += w*0.014;
    // 7 FROST GALLERY — cold milky, crossings
    w = gFrost; s += w; bg += w*vec3(0.14,0.18,0.30); kd += w*normalize(vec3(-0.30,0.28,0.91)); kc += w*vec3(0.74,0.84,1.00); gt += w*vec3(0.82,0.88,1.00); ro += w*0.55; di += w*0.020; bl += w*0.30; fd += w*0.026;
    // 8 AURORA HELIX — iridescent dusk, spiral
    w = gHelix; s += w; bg += w*vec3(0.10,0.14,0.26); kd += w*normalize(vec3(0.30,0.40,0.87));  kc += w*vec3(0.62,1.00,0.82); gt += w*vec3(0.90,0.96,1.00); ro += w*0.08; di += w*0.065; bl += w*0.50; fd += w*0.018;
    // 9 SKYLIGHT RELEASE — brilliant bloom
    w = gSky;   s += w; bg += w*vec3(0.30,0.34,0.44);  kd += w*normalize(vec3(0.05,0.55,0.83));  kc += w*vec3(1.00,0.98,0.94); gt += w*vec3(0.97,0.99,1.00); ro += w*0.03; di += w*0.030; bl += w*0.74; fd += w*0.010;

    float inv = 1.0 / max(s, 0.001);
    gBg = bg*inv; gKeyDir = normalize(kd); gKeyCol = kc*inv; gGlassTint = gt*inv;
    gRough = ro*inv; gDisp = di*inv; gBloom = bl*inv; gFogDen = fd*inv;
  }

  // --- collapse-behind -----------------------------------------------------
  vec3 segmentFall(float segZcenter) {
    float pz = playerZ();
    float behind = pz - segZcenter;
    float seed = hash21(vec2(floor(segZcenter / SEG), 7.3));
    float onset = 1.5 + seed * 4.0;
    float fall = max(behind - onset, 0.0);
    float prog = clamp(fall / 24.0, 0.0, 1.0);
    return vec3(prog, prog * prog * (26.0 + seed * 20.0), prog * (2.2 + seed * 3.8));
  }
  float shatterDeck(vec3 lp, vec3 hf, float prog, float yDrop, vec2 seed) {
    float best = 1e5;
    float cw = (hf.x * 2.0) / float(SHX);
    float cd = (hf.z * 2.0) / float(SHZ);
    for (int i = 0; i < SHX; i++) {
      for (int j = 0; j < SHZ; j++) {
        float fi = float(i) + 0.5, fj = float(j) + 0.5;
        vec3 center = vec3(-hf.x + fi * cw, 0.0, -hf.z + fj * cd);
        float h = hash21(seed + vec2(fi * 1.3, fj * 2.1));
        float h2 = hash21(seed + vec2(fj * 3.7, fi * 0.9));
        vec3 vel = vec3(center.x * 0.18 + (h - 0.5) * 2.0, -0.2 - h2 * 0.8, (h2 - 0.5) * 2.0);
        vec3 off = vel * prog * 6.0; off.y -= yDrop;
        vec3 ls = lp - center - off;
        ls.xy = rot((h - 0.5) * prog * 8.0) * ls.xy;
        ls.yz = rot((h2 - 0.5) * prog * 6.0) * ls.yz;
        best = min(best, sdBox(ls, vec3(cw * 0.5, hf.y, cd * 0.5) * (1.0 - prog * 0.25)));
      }
    }
    return best;
  }

  // --- main deck -----------------------------------------------------------
  float mapMainDeck(vec3 p) {
    float pz = playerZ();
    float segIndex = floor(p.z / SEG + 0.5);
    float segZ = segIndex * SEG;
    float top = deckTopAt(segZ);
    if (top > 9000.0) return 1e5;                  // no deck here (gap / train)

    vec3 fall = segmentFall(segZ);
    float deckHalfZ = SEG * 0.5 - 0.12;
    vec3 s = p; s.z -= segZ; s.y -= top; s.y += 0.12;   // top surface -> y=0 local
    float nearCam = step(abs(pz - segZ), 24.0);

    float deck; vec3 rr;
    if (fall.x < 0.001) { rr = s; deck = sdBox(s, vec3(1.6, 0.12, deckHalfZ)); }
    else if (nearCam < 0.5) {
      vec3 sr = s; sr.y += fall.y; sr.xy = rot(fall.z) * sr.xy; sr.yz = rot(fall.z * 0.6) * sr.yz;
      rr = sr; deck = sdBox(sr, vec3(1.6, 0.12, deckHalfZ));
    } else { deck = shatterDeck(s, vec3(1.6, 0.12, deckHalfZ), fall.x, fall.y, vec2(segIndex, 3.0)); rr = s; rr.y += fall.y; }

    float railL = sdBox(rr - vec3( 1.52, 0.44, 0.0), vec3(0.05, 0.44, deckHalfZ));
    float railR = sdBox(rr - vec3(-1.52, 0.44, 0.0), vec3(0.05, 0.44, deckHalfZ));
    float post = sdBox(vec3(abs(rr.x) - 1.52, rr.y - 0.22, mod(rr.z, 3.0) - 1.5), vec3(0.07, 0.46, 0.07));
    float d = min(deck, min(min(railL, railR), post));

    gThick = 0.42 + 0.22 * sin(segZ * 0.2) + 0.10 * sin(s.z * 0.8);
    gFell = smoothstep(0.0, 0.4, fall.x); gSpark = fall.x * 0.9; gMat = 0.0;
    return d;
  }

  // --- crossing bridges (over & under, at angles) --------------------------
  // One long glass span centred at (0,hY,cz), yawed by 'yaw' about the path.
  float oneCross(vec3 p, float cz, float hY, float yaw) {
    vec3 q = p - vec3(0.0, hY, cz);
    q.xz = rot(yaw) * q.xz;
    float deck = sdBox(q, vec3(1.5, 0.13, 46.0));
    float rail = min(sdBox(q - vec3(1.5, 0.42, 0.0), vec3(0.05, 0.42, 46.0)),
                     sdBox(q + vec3(1.5, -0.42, 0.0), vec3(0.05, 0.42, 46.0)));
    return min(deck, rail);
  }
  float mapCrossings(vec3 p) {
    float pz = playerZ();
    float zc = mod(pz, LOOP_Z);
    float d = 1e5;
    // Section 2 — The Convergence (z 60–120): a junction of spans.
    if (zc > 36.0 && zc < 150.0) {
      d = min(d, oneCross(p, 72.0,  6.5, 0.60));   // arcs overhead, ~34°
      d = min(d, oneCross(p, 90.0, -7.5, 1.90));   // passes below, ~109°
      d = min(d, oneCross(p, 108.0, 2.2, 1.05));   // crosses at deck level, ~60°
    }
    // Section 7 — Frost Gallery (z 360–420): the crossings return, rimed.
    if (zc > 336.0 && zc < 444.0) {
      d = min(d, oneCross(p, 372.0,  5.5, 0.85));
      d = min(d, oneCross(p, 392.0, -6.5, 2.10));
      d = min(d, oneCross(p, 410.0,  2.0, 1.30));
    }
    if (d < 9000.0) { gThick = 0.5; gFell = 0.0; gSpark = 0.0; gMat = 0.0; }
    return d;
  }

  // --- the train (section 5) -----------------------------------------------
  // A boxcar chain on a lower bridge along +Z; the bridge dead-ends at z=288
  // and cars beyond it pitch into free fall.
  float mapTrain(vec3 p) {
    float pz = playerZ();
    if (pz < 226.0 || pz > 312.0) return 1e5;
    float beamStart = 232.0, beamEnd = 288.0;
    float d = 1e5;
    // the train's bridge (ends abruptly at beamEnd)
    float bc = (beamStart + beamEnd) * 0.5, bh = (beamEnd - beamStart) * 0.5;
    d = min(d, sdBox(p - vec3(0.0, -6.6, bc), vec3(2.4, 0.55, bh)));
    // a diagonal on-ramp showing it crossing in from below
    {
      vec3 q = p - vec3(0.0, -8.5, 238.0); q.xz = rot(0.9) * q.xz;
      d = min(d, sdBox(q, vec3(2.2, 0.5, 26.0)));
    }
    // cars: roof at y=-5, period 9
    float seg = floor(p.z / 9.0) * 9.0 + 4.5;
    if (seg > beamStart - 2.0 && seg < beamEnd + 60.0) {
      vec3 c = p - vec3(0.0, -5.0, seg);
      if (seg > beamEnd) {                          // fallen past the dead end
        float u = clamp((pz - beamEnd) / 14.0, 0.0, 1.0);
        c.y += u * u * 34.0; c.xy = rot(u * 1.1) * c.xy;
      }
      d = min(d, sdBox(c, vec3(2.0, 1.15, 3.6)));   // car body
      d = min(d, sdBox(c - vec3(0.0, 1.3, 0.0), vec3(1.7, 0.25, 3.0))); // roof rib
    }
    gThick = 0.2; gFell = 0.0; gSpark = 0.0; gMat = 1.0;
    return d;
  }

  // --- scene composition ---------------------------------------------------
  float mapScene(vec3 w) {
    gThick = 0.0; gFell = 0.0; gSpark = 0.0; gMat = 0.0;
    float d = mapMainDeck(w);
    float t0 = gThick, f0 = gFell, s0 = gSpark, m0 = gMat;
    float dc = mapCrossings(w);
    float t1 = gThick, f1 = gFell, s1 = gSpark, m1 = gMat;
    float dt = mapTrain(w);
    float t2 = gThick, f2 = gFell, s2 = gSpark, m2 = gMat;

    float best = d; gThick = t0; gFell = f0; gSpark = s0; gMat = m0;
    if (dc < best) { best = dc; gThick = t1; gFell = f1; gSpark = s1; gMat = m1; }
    if (dt < best) { best = dt; gThick = t2; gFell = f2; gSpark = s2; gMat = m2; }
    return best;
  }

  // --- thin-film iridescence ----------------------------------------------
  vec3 iridescence(float cosTheta, float thick) {
    float shift = thick * 5.0 + (1.0 - clamp(cosTheta, 0.0, 1.0)) * 3.5;
    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + shift);
    return mix(vec3(0.92), col, 0.55);
  }

  // --- environment (IBL) ---------------------------------------------------
  vec3 envSample(vec3 dir, float lod) {
    float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
    float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
    return texture2D(uEnv, vec2(u, v), lod).rgb;
  }
  vec3 envProc(vec3 dir) {
    float up = dir.y * 0.5 + 0.5;
    vec3 base = mix(gBg * 1.2 + vec3(0.18, 0.22, 0.30), gBg * 1.6 + vec3(0.10, 0.18, 0.38), up);
    float kd = max(dot(dir, gKeyDir), 0.0);
    base += gKeyCol * pow(kd, 220.0) * 3.4;
    base += gKeyCol * smoothstep(0.86, 1.0, kd) * 0.5;
    return base;
  }
  vec3 environment(vec3 dir, float lod) {
    vec3 e = envProc(dir);
    if (uEnvLoaded > 0.5) e += max(envSample(dir, lod) - 0.62, 0.0) * 2.2;
    return e;
  }

  // --- background sky ------------------------------------------------------
  vec3 skyBg(vec3 rd) {
    float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 horizon = gBg * 1.1 + gKeyCol * 0.12 + vec3(0.24, 0.30, 0.40);
    vec3 zenith  = gBg * 0.85 + vec3(0.05, 0.11, 0.28);
    vec3 col = mix(horizon, zenith, pow(up, 0.75));

    float kd = max(dot(rd, gKeyDir), 0.0);
    col += gKeyCol * pow(kd, 4.0) * (0.10 + gBloom * 0.18);
    col += gKeyCol * pow(kd, 1400.0) * (5.0 + gBloom * 3.0);
    col += gKeyCol * pow(kd, 2.0) * 0.06;

    // distant skyline rising from the cloud sea (blocky horizon silhouette)
    {
      float az = atan(rd.z, rd.x);
      float cell = floor(az * 9.0 + 50.0);
      float bw = hash21(vec2(cell, 1.0));
      float top = 0.012 + bw * 0.055 + hash21(vec2(cell, 7.0)) * 0.025;
      float mask = step(rd.y, top) * smoothstep(-0.015, 0.01, rd.y);
      vec3 bcol = mix(gBg * 1.6, gKeyCol * 0.45, 0.35) * (0.45 + bw * 0.5);
      float wlit = step(0.86, hash21(vec2(cell, floor(rd.y * 200.0))));
      bcol += gKeyCol * wlit * 0.35;
      col = mix(col, bcol, mask * 0.9);
    }

    // drifting lit cloud bands above the horizon
    vec2 cuv = rd.xz / (abs(rd.y) + 0.18);
    float n = fbm(cuv * 0.6 + vec2(iTime * 0.03, iTime * 0.012));
    float cl = smoothstep(0.46, 0.95, n) * smoothstep(0.0, 0.22, rd.y + 0.02);
    float lit = 0.45 + 0.55 * max(dot(normalize(rd + gKeyDir), gKeyDir), 0.0);
    col = mix(col, mix(vec3(0.52, 0.58, 0.70), gKeyCol * 1.25, lit * 0.7), cl * 0.7);

    // cloud sea below the horizon (the void the bridges float over)
    float below = smoothstep(0.0, 0.4, -rd.y);
    vec2 fuv = rd.xz / max(-rd.y, 0.05);
    float floorN = fbm(fuv * 0.4 + vec2(iTime * 0.02, iTime * 0.015));
    vec3 floorCol = mix(gBg * 0.8 + vec3(0.08, 0.11, 0.18), gKeyCol * 0.4, floorN * 0.5);
    col = mix(col, floorCol, below * 0.75);

    // aurora bands (helix) + skylight lift
    float aur = sin(rd.x * 3.0 + iTime * 0.8) * 0.5 + 0.5;
    col += vec3(0.3, 1.0, 0.6) * aur * smoothstep(0.15, 0.6, up) * gHelix * 0.2;
    col = mix(col, vec3(0.88, 0.91, 1.0), gSky * (0.20 + up * 0.22));
    return col;
  }

  // --- see-through: short march of the refracted ray to real scene/sky -----
  vec3 refractBg(vec3 ro2, vec3 rd2) {
    float t = 0.0; float hit = -1.0; vec3 p = ro2;
    for (int i = 0; i < SEETHRU_STEPS; i++) {
      p = ro2 + rd2 * t;
      float d = mapScene(p);
      if (d < 0.01 + 0.003 * t) { hit = 1.0; break; }
      t += d * 0.8;
      if (t > SEETHRU_DIST) break;
    }
    if (hit > 0.0) return gGlassTint * (0.12 + 0.22 * gBloom) + gKeyCol * 0.06;  // dim shape behind glass
    return skyBg(rd2);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0035, -0.0035);
    return normalize(e.xyy * mapScene(p + e.xyy) + e.yyx * mapScene(p + e.yyx) +
                     e.yxy * mapScene(p + e.yxy) + e.xxx * mapScene(p + e.xxx));
  }

  // --- glass shading (see-through) -----------------------------------------
  vec3 shadeGlass(vec3 rd, vec3 n, vec3 pos, float thick, float fell) {
    float cosT = clamp(dot(n, -rd), 0.0, 1.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    float lod = gRough * 6.0;
    vec3 reflCol = environment(reflect(rd, n), lod);

    float eta = 1.0 / 1.45;
    vec3 rdr = refract(rd, n, eta);
    vec3 refrCol;
    if (uHeavy > 0.5) {
      // genuine see-through: march the refracted ray to geometry/sky behind
      refrCol = refractBg(pos + rdr * 0.25, rdr);
      // cheap chromatic fringe on the way through
      if (gDisp > 0.001) {
        float fr = environment(refract(rd, n, eta - gDisp), lod).r;
        float fb = environment(refract(rd, n, eta + gDisp), lod).b;
        refrCol += vec3(fr, 0.0, fb) * gDisp * 3.5 * fres;
      }
    } else if (gDisp > 0.001) {
      refrCol = vec3(environment(refract(rd, n, eta - gDisp), lod).r,
                     environment(rdr, lod).g,
                     environment(refract(rd, n, eta + gDisp), lod).b);
    } else {
      refrCol = environment(rdr, lod);
    }

    refrCol *= exp(-(1.0 - gGlassTint) * (0.4 + thick) * 1.1);   // lighter absorption -> more see-through
    if (gRough > 0.02) refrCol = mix(refrCol, gGlassTint * (0.5 + environment(n, 6.0) * 0.5), gRough * 0.7);

    vec3 surf = mix(refrCol, reflCol, fres);
    surf += iridescence(cosT, thick) * (0.10 + 0.45 * fres) * (0.5 + gHelix * 1.2);
    vec3 R = reflect(rd, n);
    surf += gKeyCol * pow(max(dot(R, gKeyDir), 0.0), mix(900.0, 40.0, gRough)) * (0.8 + gBloom * 1.6);
    surf = mix(surf, surf * vec3(0.7, 0.74, 0.82), fell * 0.5);
    return surf;
  }

  // --- first-person camera choreography ------------------------------------
  // Periodic over-the-shoulder glance at the collapse (0..1), shared by yaw+pitch.
  float glanceAmt() {
    float cyc = fract(iTime * 0.11);
    return clamp(smoothstep(0.05, 0.12, cyc) - smoothstep(0.20, 0.34, cyc), 0.0, 1.0);
  }
  float camLateral(float z) {
    float x = sin(iTime * 2.5) * 0.10;                                 // run sway
    x += win(z, 360.0, 372.0, 408.0, 420.0) * sin(z * 0.12 + iTime * 1.5) * 1.3;  // 7 storm
    x += win(z, 420.0, 432.0, 468.0, 480.0) * sin((z - 420.0) / 60.0 * PI * 2.0) * 1.0; // 8 helix
    return x;
  }
  float camPitch(float z) {
    float p = 0.0;
    p += -0.50 * win(z, 222.0, 228.0, 238.0, 242.0);   // jump down: look down
    p += -0.42 * win(z, 240.0, 244.0, 250.0, 254.0);   // leap onto train
    p += -0.85 * win(z, 288.0, 292.0, 300.0, 304.0);   // free fall: pitch down hard
    p +=  0.16 * win(z, 120.0, 135.0, 165.0, 180.0);   // ascent: glance up
    p +=  0.18 * win(z, 300.0, 312.0, 324.0, 336.0);   // catch climb: glance up
    p += -0.34 * glanceAmt();                          // look down at the collapsing deck while glancing back
    p += sin(iTime * 9.0) * 0.012;                     // run bob pitch
    return p;
  }
  float camYaw(float z) {
    float y = 0.0;
    y += glanceAmt() * (-2.7);                         // glance over the shoulder at the collapse (~155 deg)
    y += win(z, 288.0, 293.0, 300.0, 306.0) * (-2.7);  // forced look back during the fall
    return y;
  }
  float camRoll(float z) {
    float r = win(z, 420.0, 432.0, 468.0, 480.0) * 0.3 * sin((z - 420.0) / 60.0 * PI); // helix bank
    r += win(z, 288.0, 294.0, 300.0, 306.0) * 0.4;     // fall tilt
    return r;
  }

  void mainScene(out vec3 outCol) {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    setupAtmosphere();

    float z = playerZ();
    float air = win(z, 224.0, 230.0, 238.0, 244.0) + win(z, 286.0, 290.0, 300.0, 308.0);
    float bob = sin(iTime * 9.0) * 0.05 * (1.0 - clamp(air, 0.0, 1.0));
    vec3 ro = vec3(camLateral(z), pathY(z) + bob, z);

    float pitch = camPitch(z) + uPointer.y * 0.25;
    float yaw   = camYaw(z) + uPointer.x * 0.45;
    float roll  = camRoll(z);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.3;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);
    float attention = clamp(win(z, 286.0, 292.0, 302.0, 308.0) + 0.5 * fract(iTime * 0.11), 0.0, 1.0);

    float dist = 0.0, hit = -1.0; vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.002 * dist + 0.001) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    vec3 col = skyBg(rd);
    if (hit > 0.0) {
      float thick = gThick, fell = gFell, spark = gSpark, matId = gMat;
      vec3 n = calcNormal(p);
      vec3 surf;
      if (matId > 0.5) {
        // train: dark metal curtain, reflective, hot edge glints
        float cosT = clamp(dot(n, -rd), 0.0, 1.0);
        float fres = 0.05 + 0.95 * pow(1.0 - cosT, 5.0);
        vec3 metal = mix(vec3(0.05, 0.06, 0.08), vec3(0.14, 0.16, 0.20), step(0.5, fract(p.y * 0.7 + p.z * 0.3)));
        surf = mix(metal, environment(reflect(rd, n), gRough * 6.0), 0.30 + 0.5 * fres);
        surf += gKeyCol * pow(max(dot(reflect(rd, n), gKeyDir), 0.0), 90.0) * (1.0 + gBloom * 2.0);
      } else {
        surf = shadeGlass(rd, n, p, thick, fell);
        if (spark > 0.01) {
          float tw = hash21(floor(p.xz * 3.0) + floor(iTime * 30.0));
          surf += step(0.92, tw) * spark * 2.0 + spark * vec3(1.0, 0.98, 0.95) * 0.12;
        }
      }
      float haze = 1.0 - exp(-dist * gFogDen);
      col = mix(surf, skyBg(rd), haze);
    }

    // grade + pseudo-bloom
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.85, 1.6, lum) * gBloom * 0.45;
    col = pow(clamp(col, 0.0, 1.6), vec3(0.92));
    col *= mix(vec3(1.0), vec3(1.02, 1.03, 1.06), gSky);
    float edge = smoothstep(0.45, 0.98, length(uv));
    col = mix(col, mix(col, vec3(dot(col, vec3(0.33))), 0.25), edge * attention * 0.35);
    outCol = col;
  }

  void main() { vec3 col; mainScene(col); gl_FragColor = vec4(col, 1.0); }
`

// Full-quality variant used by the route page (env map bound; see-through on
// when heavyEffects is enabled).
export const skybridgesFrag = `
#define RM_STEPS 72
#define MAX_DIST 150.0
#define STEP_K 0.7
#define SHX 3
#define SHZ 3
#define SEETHRU_STEPS 12
#define SEETHRU_DIST 30.0
#define FBM_OCTAVES 3
${COMMON}`

// Cheaper hover-thumbnail variant: fewer steps, coarser noise, shorter
// see-through march. No env map bound -> procedural sky fallback.
export const skybridgesPreviewFrag = `
#define RM_STEPS 48
#define MAX_DIST 110.0
#define STEP_K 0.66
#define SHX 2
#define SHZ 2
#define SEETHRU_STEPS 8
#define SEETHRU_DIST 22.0
#define FBM_OCTAVES 2
${COMMON}`
