// SKYBRIDGES — a fight-or-flight panic POV: sprinting across a network of
// collapsing glass skybridges at the clouds' height. Clean, clinical, high-key
// palette — bright pale sky, cold whites/greys, thin cold air, vertigo.
//
// What lives in here (all driven by iTime, no extra uniforms):
//   • MULTIPLE named bridges running in parallel lanes, each a different TYPE
//     (arch / suspension / truss / tube) with a camera-facing TITLE billboard.
//   • A turning PATH — the corridor bends +90° left, −60° right, +120° left as
//     you sprint, via an eased heading function that warps the canonical scene
//     and yaws the camera to follow.
//   • GLASS-SHATTER collapse — segments behind you fracture into scattering,
//     spinning, plunging shards with sharp specular glints (not a rigid drop).
//   • SKYSCRAPER TOPS rising out of the cloud floor on both flanks; some
//     detonate — their crowns burst into debris — and the camera glances at them.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — so:
// no bitwise ops (the font decodes via mod/floor), constant loop bounds only,
// no dynamic array indexing. All scene density / raymarch budget is #defined
// per-variant below so the look stays byte-for-byte consistent.
// Uniforms (set by lib/shaderQuad.ts): iResolution, iTime, uPointer.

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  // --- constants -----------------------------------------------------------
  const float PI = 3.14159265359;
  const float LANE = 7.0;        // X spacing between parallel bridges
  const float SEG = 9.0;         // Z spacing between deck segments / ribs
  const float SPEED = 7.5;       // forward sprint speed (units/sec)
  const float LOOKAHEAD = 14.0;  // how far ahead the camera anticipates a turn
  const float BENDLEN = 30.0;    // half-length over which each corner eases in

  // Material/look state written by the SDF at the nearest hit, read by shading.
  float gThick;   // thin-film thickness proxy (iridescence)
  float gFell;    // fracture/darken weight 0..1
  float gSpark;   // glass-shatter sparkle weight 0..1
  float gMat;     // 0 = glass bridge, 1 = skyscraper

  // --- hash / noise (procedural clouds, no textures) -----------------------
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
    float s = 0.0;
    float amp = 0.5;
    for (int i = 0; i < FBM_OCTAVES; i++) {
      s += amp * vnoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return s;
  }

  // 2D rotation helper.
  mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
  }

  // --- SDF primitives ------------------------------------------------------
  float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
  }
  // Torus whose ring lies in the XY plane (axis along Z): arch ribs across the
  // deck width, and full hoops you run through for the 'tube' bridge type.
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xy) - t.x, p.z);
    return length(q) - t.y;
  }

  // --- section timeline ----------------------------------------------------
  // Mirrored in kinematics.ts. The shader reads section as authored distance,
  // not raw seconds, so playback speed can change without desynchronizing HUD.
  const float LOOP_Z = 360.0;
  float rawPlayerZ() { return iTime * SPEED; }
  float sectionZ() { return mod(rawPlayerZ(), LOOP_Z); }
  float sectionProgress(float startZ, float endZ) {
    return clamp((sectionZ() - startZ) / max(endZ - startZ, 0.001), 0.0, 1.0);
  }
  float sectionWindow(float startZ, float endZ) {
    float z = sectionZ();
    return step(startZ, z) * (1.0 - step(endZ, z));
  }
  float sectionPulse(float startZ, float endZ) {
    return sin(sectionProgress(startZ, endZ) * PI);
  }
  float sectionRamp(float startZ, float endZ) {
    return smoothstep(startZ, endZ, sectionZ());
  }

  // Authored progression: section labels advance on raw time, but the world can
  // pause, drop, surge, and recover like liminal's sector choreography.
  float playerZ() {
    float raw = rawPlayerZ();
    float base = floor(raw / LOOP_Z) * LOOP_Z;
    float z = sectionZ();
    if (z < 55.0) {
      return base + z * 1.16;                         // runway sprint
    }
    if (z < 110.0) {
      float t = sectionProgress(55.0, 110.0);
      return base + 63.8 + smoothstep(0.0, 1.0, t) * 15.0; // hanging: forward motion nearly stalls
    }
    if (z < 165.0) {
      float t = sectionProgress(110.0, 165.0);
      return base + 78.8 + t * 96.0;                  // underbridge canyon rush
    }
    if (z < 225.0) {
      float t = sectionProgress(165.0, 225.0);
      return base + 174.8 + t * 118.0;                // blast catapult
    }
    if (z < 290.0) {
      float t = sectionProgress(225.0, 290.0);
      return base + 292.8 + t * 88.0;                 // switchback scramble
    }
    float t = sectionProgress(290.0, LOOP_Z);
    return base + 380.8 + smoothstep(0.0, 1.0, t) * 82.0; // helix recovery
  }

  // --- turning path --------------------------------------------------------
  // Cumulative heading (radians) as a function of canonical depth. Left = +.
  // Three eased corners: +90deg L, then −60deg R, then +120deg L. The scene is
  // authored straight in canonical space; we bend it about the camera by the
  // local heading delta so the corridor visibly sweeps around each corner.
  float turnHeading(float z) {
    float h = 0.0;
    h += (PI * 0.5)       * smoothstep(78.0  - BENDLEN, 78.0  + BENDLEN, z);
    h += (-PI / 3.0)      * smoothstep(170.0 - BENDLEN, 170.0 + BENDLEN, z);
    h += (PI * 2.0 / 3.0) * smoothstep(270.0 - BENDLEN, 270.0 + BENDLEN, z);
    return h;
  }

  // world -> canonical: undo the corridor bend so the SDF can stay straight.
  vec3 unbend(vec3 w) {
    float camz = playerZ();
    float ang = turnHeading(w.z) - turnHeading(camz);
    vec2 d = w.xz - vec2(0.0, camz);
    d = rot(-ang) * d;
    return vec3(d.x, w.y, d.y + camz);
  }
  // canonical -> world (approximate inverse; used to place title billboards).
  vec3 bendApprox(vec3 c) {
    float camz = playerZ();
    float ang = turnHeading(c.z) - turnHeading(camz);
    vec2 d = c.xz - vec2(0.0, camz);
    d = rot(ang) * d;
    return vec3(d.x, c.y, d.y + camz);
  }

  // --- camera choreography (scripted, purely a function of iTime) ----------
  // Smooth single-hump pulse in [0,1] within a window of length 'len' starting
  // at 'start' inside each 'period'.
  float pulse(float t, float period, float start, float len) {
    float ph = mod(t, period) - start;
    float x = clamp(ph / len, 0.0, 1.0);
    return sin(x * PI);
  }

  // Returns camera pitch (x) and yaw (y), plus an 'attention' weight (z) used to
  // intensify edge wash during the dramatic glances.
  vec3 camAngles() {
    float t = iTime;
    float camz = playerZ();

    // Base yaw follows the bending corridor (negative = the path curving left).
    float baseYaw = turnHeading(camz) - turnHeading(camz + LOOKAHEAD);

    float edgeT = sectionProgress(55.0, 110.0);
    float hang = sectionWindow(55.0, 110.0) * (1.0 - smoothstep(0.36, 0.62, edgeT));
    float freefall = sectionWindow(55.0, 110.0) * smoothstep(0.42, 1.0, edgeT);
    float underCanyon = sectionWindow(110.0, 165.0);
    float underT = sectionProgress(110.0, 165.0);

    // Glance DOWN at the drop, then tip into the fall.
    float down = pulse(t, 13.0, 5.0, 2.4);
    down = max(down, sectionPulse(55.0, 110.0) * 1.25);
    float pitch = -down * 0.85;
    pitch += hang * -0.7 + freefall * -0.35 + underCanyon * mix(0.45, 0.88, underT);

    // Glance BACK at the collapse, later in the cycle.
    float back = pulse(t, 13.0, 9.0, 2.6);
    back = max(back, sectionPulse(225.0, 290.0) * 1.15);
    float yaw = baseYaw + back * (PI * 0.9);
    pitch += -back * 0.45;

    // Glance toward an EXPLODING skyscraper, early in the cycle. Side alternates.
    float tg = pulse(t, 13.0, 1.0, 2.2);
    tg = max(tg, sectionPulse(165.0, 225.0));
    float cyc = floor(t / 13.0);
    float sideSign = (mod(cyc, 2.0) < 0.5) ? 1.0 : -1.0;
    yaw += tg * sideSign * 0.7;
    pitch += tg * 0.18;            // tip up toward the towers

    yaw += hang * 0.45 + freefall * sin(edgeT * PI * 10.0) * 0.18;

    // Storm switchback: the path yanks sideways before the recovery helix.
    float stormTurn = sectionPulse(225.0, 290.0);
    yaw += stormTurn * 0.72;
    pitch += stormTurn * 0.08;

    // subtle running head sway always present
    pitch += sin(t * 5.0) * (0.022 + freefall * 0.07);
    yaw   += sin(t * 3.1) * (0.028 + freefall * 0.16);

    return vec3(pitch, yaw, max(max(back, tg * 0.65), max(down * 0.55, stormTurn * 0.45)));
  }

  // --- bridge collapse bookkeeping -----------------------------------------
  // Segments BEHIND the advancing player detach and shatter. Returns
  // vec3(prog 0..1, yDrop, tumble) with deterministic per-segment jitter.
  float bridgeTierY(float tier) {
    return (tier - 1.0) * 11.0 - 3.0;   // discrete heights, spread for vertigo
  }
  vec3 segmentFall(float segZcenter, float lane) {
    float pz = playerZ();
    float behind = pz - segZcenter;
    float seed = hash21(vec2(floor(segZcenter / SEG), lane * 1.7));
    float onset = 3.0 + seed * 8.0;
    float fall = max(behind - onset, 0.0);
    float prog = clamp(fall / 30.0, 0.0, 1.0);
    float yDrop = prog * prog * (40.0 + seed * 28.0);
    float tumble = prog * (2.0 + seed * 4.0);
    return vec3(prog, yDrop, tumble);
  }

  // --- glass shatter -------------------------------------------------------
  // A deck slab fractured into SHX*SHZ slivers that scatter, spin and plunge as
  // 'prog' rises. At prog==0 the shards tile the slab exactly (seamless onset).
  float shatterDeck(vec3 lp, vec3 hf, float prog, float yDrop, vec2 seed) {
    float best = 1e5;
    float cw = (hf.x * 2.0) / float(SHX);
    float cd = (hf.z * 2.0) / float(SHZ);
    for (int i = 0; i < SHX; i++) {
      for (int j = 0; j < SHZ; j++) {
        float fi = float(i) + 0.5;
        float fj = float(j) + 0.5;
        vec3 center = vec3(-hf.x + fi * cw, 0.0, -hf.z + fj * cd);
        float h = hash21(seed + vec2(fi * 1.3, fj * 2.1));
        float h2 = hash21(seed + vec2(fj * 3.7, fi * 0.9));
        vec3 vel = vec3(center.x * 0.15 + (h - 0.5) * 2.0,
                        -0.2 - h2 * 0.8,
                        (h2 - 0.5) * 2.0);
        vec3 off = vel * prog * 6.0;
        off.y -= yDrop;
        vec3 ls = lp - center - off;
        ls.xy = rot((h - 0.5) * prog * 8.0) * ls.xy;
        ls.yz = rot((h2 - 0.5) * prog * 6.0) * ls.yz;
        vec3 shalf = vec3(cw * 0.5, hf.y, cd * 0.5) * (1.0 - prog * 0.25);
        best = min(best, sdBox(ls, shalf));
      }
    }
    return best;
  }
  // A tower crown blown apart into TWX*TWY*TWZ chunks bursting outward+up, then
  // dragged down by gravity as 'prog' rises.
  float shatterTower(vec3 lp, vec3 hf, float prog, float seed) {
    float best = 1e5;
    float cx = (hf.x * 2.0) / float(TWX);
    float cy = (hf.y * 2.0) / float(TWY);
    float cz = (hf.z * 2.0) / float(TWZ);
    for (int i = 0; i < TWX; i++) {
      for (int j = 0; j < TWY; j++) {
        for (int k = 0; k < TWZ; k++) {
          float fi = float(i) + 0.5;
          float fj = float(j) + 0.5;
          float fk = float(k) + 0.5;
          vec3 center = vec3(-hf.x + fi * cx, -hf.y + fj * cy, -hf.z + fk * cz);
          float h = hash21(vec2(seed + fi * 1.7 + fk * 0.3, fj * 2.3));
          float h2 = hash21(vec2(fj * 1.1, seed + fi * 0.7 + fk * 1.9));
          vec3 dir = normalize(vec3(center.x + (h - 0.5), 0.6 + h2, center.z + (h2 - 0.5)));
          vec3 off = dir * prog * prog * 22.0;
          off.y -= prog * prog * 30.0;
          vec3 ls = lp - center - off;
          ls.xy = rot((h - 0.5) * prog * 9.0) * ls.xy;
          ls.yz = rot((h2 - 0.5) * prog * 9.0) * ls.yz;
          vec3 shalf = vec3(cx, cy, cz) * 0.5 * (1.0 - prog * 0.3);
          best = min(best, sdBox(ls, shalf));
        }
      }
    }
    return best;
  }

  // --- bridges -------------------------------------------------------------
  // Lanes repeat in X (each a distinct TYPE), tiers in Y, segments in Z. Each
  // lane = a glass deck + side rails + a type-specific superstructure.
  float mapBridges(vec3 p) {
    float d = 1e5;
    float edgeT = sectionProgress(55.0, 110.0);
    float edgeBreak = sectionWindow(55.0, 110.0) * smoothstep(0.12, 0.58, edgeT);
    float underCanyon = sectionWindow(110.0, 165.0);
    float storm = sectionPulse(225.0, 290.0);
    for (int li = 0; li < SCENE_LANES; li++) {
      float lane = float(li) - float(SCENE_LANES - 1) * 0.5;
      float lx = lane * LANE * mix(1.0, 0.58, underCanyon);
      int btype = int(mod(float(li), 4.0));

      for (int ti = 0; ti < SCENE_TIERS; ti++) {
        float tier = float(ti);
        float ty = bridgeTierY(tier) + underCanyon * 8.0 + storm * sin(tier * 2.1 + iTime) * 1.8;

        vec3 q = p - vec3(lx, ty, 0.0);
        float segIndex = floor(q.z / SEG + 0.5);
        float segZcenter = segIndex * SEG;
        vec3 fall = segmentFall(segZcenter, lane + tier * 0.31);
        float prog = fall.x;

        // segment-local; 'sr' carries the rigid drop+tumble for super-structure.
        vec3 s = q;
        s.z -= segZcenter;
        vec3 sr = s;
        sr.y += fall.y;
        sr.xy = rot(fall.z) * sr.xy;
        sr.yz = rot(fall.z * 0.6) * sr.yz;

        float deckHalfZ = SEG * 0.5;

        // Glass deck — intact slab, or a shattering shard field.
        float deck;
        if (prog < 0.001) {
          deck = sdBox(s, vec3(2.4, 0.16, deckHalfZ));
        } else {
          deck = shatterDeck(s, vec3(2.4, 0.16, deckHalfZ), prog, fall.y, vec2(segIndex, lane));
        }
        float centerLane = 1.0 - smoothstep(0.25, 1.15, abs(lane));
        float bite = edgeBreak * centerLane;
        float edgeHole = sdBox(s - vec3(2.1, 0.02, mix(-2.5, 2.0, edgeT)), vec3(0.95, 0.55, deckHalfZ * 0.92));
        deck = mix(deck, max(deck, -edgeHole), bite);

        // Side rails ride the rigid fall.
        float railL = sdBox(sr - vec3(2.2, 0.45, 0.0), vec3(0.10, 0.45, deckHalfZ));
        float railR = sdBox(sr + vec3(2.2, -0.45, 0.0), vec3(0.10, 0.45, deckHalfZ));
        float rails = min(railL, railR);
        rails = mix(rails, min(max(railL, -edgeHole), railR), bite);

        // Type-specific superstructure.
        float sup = 1e5;
        if (btype == 0) {
          // ARCH — upper half-rib across the deck.
          float arch = sdTorus(sr, vec2(3.4, 0.16));
          arch = max(arch, -sr.y - 0.2);
          sup = arch;
        } else if (btype == 1) {
          // SUSPENSION — four corner pylons + a top main beam.
          float pyl = sdBox(sr - vec3(2.3, 2.6, deckHalfZ * 0.85), vec3(0.18, 3.0, 0.18));
          pyl = min(pyl, sdBox(sr - vec3(-2.3, 2.6, deckHalfZ * 0.85), vec3(0.18, 3.0, 0.18)));
          pyl = min(pyl, sdBox(sr - vec3(2.3, 2.6, -deckHalfZ * 0.85), vec3(0.18, 3.0, 0.18)));
          pyl = min(pyl, sdBox(sr - vec3(-2.3, 2.6, -deckHalfZ * 0.85), vec3(0.18, 3.0, 0.18)));
          float cable = sdBox(sr - vec3(0.0, 5.2, 0.0), vec3(2.5, 0.08, deckHalfZ));
          sup = min(pyl, cable);
        } else if (btype == 2) {
          // TRUSS — crossed X-braces over the deck.
          vec3 b = sr - vec3(0.0, 1.4, 0.0);
          vec3 b1 = b; b1.xy = rot(0.6) * b1.xy;
          vec3 b2 = b; b2.xy = rot(-0.6) * b2.xy;
          float br = sdBox(b1, vec3(0.12, 2.4, deckHalfZ));
          br = min(br, sdBox(b2, vec3(0.12, 2.4, deckHalfZ)));
          sup = br;
        } else {
          // TUBE — full glass hoop you run through.
          sup = sdTorus(sr - vec3(0.0, 1.0, 0.0), vec2(3.2, 0.14));
        }

        float piece = min(deck, min(rails, sup));
        if (piece < d) {
          d = piece;
          gThick = 0.45 + 0.35 * sin(segZcenter * 0.21 + tier * 1.3 + lane * 0.7);
          gThick += 0.12 * sin(s.z * 0.8) + float(btype) * 0.07;
          gFell = smoothstep(0.0, 0.35, prog);
          gSpark = prog * 0.9;
          gMat = 0.0;
        }
      }
    }
    return d;
  }

  // --- skyscrapers ---------------------------------------------------------
  // Tall towers on both flanks, bases sunk into the cloud floor so only their
  // crowns poke into the horizon. Some detonate as the player draws near.
  float mapTowers(vec3 c) {
    float pz = playerZ();
    float d = 1e5;
    float gap = 46.0;
    for (int i = 0; i < SCENE_TOWERS; i++) {
      float fi = float(i);
      float baseZ = floor(pz / gap) * gap + (fi + 1.0) * gap + 20.0;
      for (int sdi = 0; sdi < 2; sdi++) {
        float side = (sdi == 0) ? -1.0 : 1.0;
        float seed = hash21(vec2(baseZ * 0.07, side * 3.3 + fi));
        float tx = side * (30.0 + seed * 10.0);
        float tz = baseZ + (seed - 0.5) * 20.0;
        float topY = 6.0 + seed * 16.0;
        float baseY = -60.0;
        float halfH = (topY - baseY) * 0.5;
        float midY = (topY + baseY) * 0.5;
        float tw = 4.0 + seed * 4.0;
        vec3 lp = c - vec3(tx, midY, tz);

        // detonation rises as the tower enters the blast window; gated by hash.
        float ahead = tz - pz;
        float det = clamp(1.0 - (ahead - 16.0) / 40.0, 0.0, 1.0);
        float towerBlast = sectionPulse(165.0, 225.0);
        det *= max(step(0.55, hash21(vec2(baseZ, side))), towerBlast * 0.82);

        float tower;
        if (det < 0.001) {
          tower = sdBox(lp, vec3(tw, halfH, tw));
        } else {
          float stumpH = halfH * (1.0 - det * 0.55);
          float stump = sdBox(lp - vec3(0.0, -(halfH - stumpH), 0.0), vec3(tw, stumpH, tw));
          vec3 topL = lp - vec3(0.0, stumpH, 0.0);
          float top = shatterTower(topL, vec3(tw, halfH - stumpH + 0.01, tw), det, hash21(vec2(tz, side)));
          tower = min(stump, top);
        }

        if (tower < d) {
          d = tower;
          gThick = 0.2;
          gFell = det * 0.6;
          gSpark = det;
          gMat = 1.0;
        }
      }
    }
    return d;
  }

  // Whole scene = bent bridges + bent towers, sharing one canonical space.
  float mapScene(vec3 w) {
    vec3 c = unbend(w);
    float underCanyon = sectionWindow(110.0, 165.0);
    float towerDetonation = sectionPulse(165.0, 225.0);
    float storm = sectionPulse(225.0, 290.0);
    float helix = sectionWindow(290.0, LOOP_Z) * sectionRamp(290.0, LOOP_Z);

    // Section setpieces reshape the authored corridor rather than just tint it:
    // underbridge canyon squeezes the lanes, storm switchback shears the deck,
    // and helix recovery twists the whole bridge field around the camera.
    c.x *= mix(1.0, 0.68, underCanyon);
    c.x += sin(c.z * 0.13 + iTime * 4.0) * storm * 2.4;
    c.y += sin(c.z * 0.08 + iTime * 5.0) * storm * 1.1;
    c.y += towerDetonation * sin(c.x * 0.3 + c.z * 0.07 + iTime * 8.0) * 1.5;
    vec2 h = c.xz - vec2(0.0, playerZ());
    h = rot(helix * (PI * 1.35) + sin(c.z * 0.035) * helix * 0.55) * h;
    c.xz = h + vec2(0.0, playerZ());

    gThick = 0.0; gFell = 0.0; gSpark = 0.0; gMat = 0.0;

    float db = mapBridges(c);
    float bThick = gThick, bFell = gFell, bSpark = gSpark, bMat = gMat;

    float dt = mapTowers(c);
    if (db < dt) {
      gThick = bThick; gFell = bFell; gSpark = bSpark; gMat = bMat;
      return db;
    }
    return dt;
  }

  // --- thin-film iridescence ----------------------------------------------
  vec3 iridescence(float cosTheta, float thick) {
    float shift = thick * 5.0 + (1.0 - clamp(cosTheta, 0.0, 1.0)) * 3.5;
    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + shift);
    return mix(vec3(0.92), col, 0.55);   // desaturate toward clinical white
  }

  // --- sky: bright high-key gradient + pale clouds, dense floor below -------
  vec3 sky(vec3 rd) {
    float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 top = vec3(0.62, 0.78, 0.95);
    vec3 hor = vec3(0.93, 0.96, 1.0);
    float edgeFall = sectionWindow(55.0, 110.0) * smoothstep(0.35, 1.0, sectionProgress(55.0, 110.0));
    float underCanyon = sectionWindow(110.0, 165.0);
    float towerBlast = sectionPulse(165.0, 225.0);
    float storm = sectionPulse(225.0, 290.0);
    float escape = sectionWindow(290.0, LOOP_Z) * sectionRamp(290.0, LOOP_Z);
    top = mix(top, vec3(0.28, 0.44, 0.66), edgeFall * 0.65);
    top = mix(top, vec3(0.10, 0.15, 0.24), underCanyon * 0.82);
    hor = mix(hor, vec3(0.42, 0.50, 0.63), underCanyon * 0.7);
    hor = mix(hor, vec3(1.0, 0.86, 0.64), towerBlast * 0.32);
    top = mix(top, vec3(0.40, 0.47, 0.62), storm * 0.45);
    vec3 col = mix(hor, top, pow(up, 0.7));

    vec2 cuv = rd.xz / (abs(rd.y) + 0.18);
    float hi = fbm(cuv * 1.1 + vec2(iTime * 0.05, 0.0));
    hi = smoothstep(0.45, 1.05, hi) * smoothstep(0.0, 0.25, rd.y + 0.05);
    col = mix(col, vec3(1.0), hi * (0.6 + towerBlast * 0.35));

    float belowMask = smoothstep(0.0, 0.35, -rd.y);
    vec2 fuv = rd.xz / max(-rd.y, 0.05);
    float floorN = fbm(fuv * 0.5 + vec2(iTime * 0.03, iTime * 0.02));
    vec3 floorCol = mix(vec3(0.78, 0.84, 0.92), vec3(0.55, 0.62, 0.74), floorN);
    floorCol = mix(floorCol, vec3(0.10, 0.13, 0.18), underCanyon * 0.85);
    floorCol = mix(floorCol, vec3(0.34, 0.38, 0.50), storm * 0.55);
    col = mix(col, floorCol, belowMask * (0.85 + edgeFall * 0.22 + underCanyon * 0.25));
    col = mix(col, vec3(0.96, 0.99, 1.0), escape * up * 0.18);

    return col;
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.004, -0.004);
    return normalize(
      e.xyy * mapScene(p + e.xyy) +
      e.yyx * mapScene(p + e.yyx) +
      e.yxy * mapScene(p + e.yxy) +
      e.xxx * mapScene(p + e.xxx)
    );
  }

  // --- 3x5 bitmap font (titles) --------------------------------------------
  // Each glyph packed into a single float: bit (row*3 + col) lit. Decoded with
  // mod/floor because GLSL ES 1.00 has no bitwise operators.
  float letterCode(int l) {
    if (l == 0) return 23530.0;   // A
    if (l == 1) return 29351.0;   // Z
    if (l == 2) return 31597.0;   // U
    if (l == 3) return 23275.0;   // R
    if (l == 4) return 29647.0;   // E
    if (l == 5) return 23533.0;   // H
    if (l == 6) return 29257.0;   // L
    if (l == 7) return 29847.0;   // I
    if (l == 8) return 23213.0;   // X
    if (l == 9) return 4843.0;    // P
    if (l == 10) return 31183.0;  // S
    if (l == 11) return 23421.0;  // M
    if (l == 12) return 11117.0;  // V
    if (l == 13) return 9367.0;   // T
    if (l == 14) return 23549.0;  // N
    return 15211.0;               // D
  }
  // Five 5-letter bridge names: AZURE / HELIX / PRISM / VAULT / NADIR.
  int wordLetter(int w, int i) {
    if (w == 0) { if (i == 0) return 0;  if (i == 1) return 1;  if (i == 2) return 2;  if (i == 3) return 3;  return 4;  }
    if (w == 1) { if (i == 0) return 5;  if (i == 1) return 4;  if (i == 2) return 6;  if (i == 3) return 7;  return 8;  }
    if (w == 2) { if (i == 0) return 9;  if (i == 1) return 3;  if (i == 2) return 7;  if (i == 3) return 10; return 11; }
    if (w == 3) { if (i == 0) return 12; if (i == 1) return 0;  if (i == 2) return 2;  if (i == 3) return 6;  return 13; }
    if (i == 0) return 14; if (i == 1) return 0; if (i == 2) return 15; if (i == 3) return 7; return 3;
  }
  float glyphBit(float code, float col, float row) {
    float idx = row * 3.0 + col;
    return mod(floor(code / pow(2.0, idx)), 2.0);
  }
  // luv in [-1,1]^2 across a 5-char title; returns ink coverage 0..1.
  float printTitle(vec2 luv, int word) {
    float x = (luv.x * 0.5 + 0.5) * 5.0;          // 0..5 char slots
    int ci = int(floor(x));
    if (ci < 0 || ci > 4) return 0.0;
    float gx = (fract(x) - 0.12) / 0.76;          // glyph cell horizontal 0..1
    float gy = 1.0 - (luv.y * 0.5 + 0.5);         // glyph cell vertical 0..1
    if (gx < 0.0 || gx > 1.0 || gy < 0.0 || gy > 1.0) return 0.0;
    int letter = wordLetter(word, ci);
    if (letter < 0) return 0.0;
    return glyphBit(letterCode(letter), floor(gx * 3.0), floor(gy * 5.0));
  }

  void mainScene(out vec3 outCol) {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // --- camera ---
    vec3 ang = camAngles();
    float pitch = ang.x;
    float yaw = ang.y;
    float attention = ang.z;

    float t = iTime;
    float launch = sectionPulse(0.0, 55.0);
    float edgeT = sectionProgress(55.0, 110.0);
    float hang = sectionWindow(55.0, 110.0) * (1.0 - smoothstep(0.36, 0.62, edgeT));
    float freefall = sectionWindow(55.0, 110.0) * smoothstep(0.42, 1.0, edgeT);
    float underCanyon = sectionWindow(110.0, 165.0);
    float underT = sectionProgress(110.0, 165.0);
    float towerBlast = sectionPulse(165.0, 225.0);
    float storm = sectionPulse(225.0, 290.0);
    float escape = sectionWindow(290.0, LOOP_Z) * sectionRamp(290.0, LOOP_Z);
    float bobY = sin(t * 9.0) * (0.12 + launch * 0.04 + freefall * 0.18) + abs(sin(t * 4.5)) * 0.06;
    float swayX = sin(t * 3.0) * (0.25 + storm * 0.35 + freefall * 0.65);
    vec3 ro = vec3(swayX, 1.2 + bobY, playerZ());
    ro.x += hang * 2.05 + freefall * (2.4 + sin(edgeT * 31.0) * 0.35);
    ro.y += hang * -0.92;
    ro.y += freefall * (-48.0 + sin(edgeT * 43.0) * 1.2);
    ro.y += underCanyon * mix(-40.0, -22.0, underT);
    ro.y += towerBlast * 4.5;
    ro.y += storm * -7.0;
    ro.y += escape * mix(-16.0, 2.5, escape);
    ro.z -= hang * 3.0 + freefall * 8.0;

    pitch += uPointer.y * 0.08;
    yaw   += uPointer.x * 0.12;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.25;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    // --- raymarch (under-stepped: the corridor bend shears the SDF) ---
    float dist = 0.0;
    float hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.002 * dist + 0.001) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    vec3 col = sky(rd);

    if (hit > 0.0) {
      float thick = gThick;
      float fell = gFell;
      float spark = gSpark;
      float matId = gMat;
      vec3 n = calcNormal(p);

      float cosT = clamp(dot(n, -rd), 0.0, 1.0);
      float fres = pow(1.0 - cosT, 3.0);
      vec3 refl = sky(reflect(rd, n));
      float diff = clamp(dot(n, normalize(vec3(0.4, 0.9, -0.2))), 0.0, 1.0);

      vec3 surf;
      if (matId > 0.5) {
        // skyscraper: cold curtain-wall with a faint window grid.
        vec3 wall = vec3(0.46, 0.52, 0.60);
        float win = step(0.5, fract(p.y * 0.6)) * step(0.4, fract((p.x + p.z) * 0.5));
        wall = mix(wall, vec3(0.62, 0.74, 0.86), win * 0.5);
        surf = wall * (0.45 + 0.55 * diff);
        surf = mix(surf, refl, 0.22 + 0.4 * fres);
      } else {
        // glass: cold, near-white, polished, thin-film at grazing angles.
        vec3 glass = vec3(0.82, 0.88, 0.95);
        vec3 irid = iridescence(cosT, thick);
        surf = glass * (0.35 + 0.65 * diff);
        surf = mix(surf, refl, 0.45 + 0.4 * fres);
        surf += irid * (0.12 + 0.55 * fres) * 0.6;
        surf = mix(surf, surf * vec3(0.7, 0.74, 0.82), fell * 0.5);
        surf = mix(surf, refl, 0.15);
      }

      // glass-shatter glints + detonation flash on freshly-fractured pieces.
      if (spark > 0.01) {
        float tw = hash21(floor(p.xz * 3.0) + floor(iTime * 30.0));
        float beatSpark = 1.0 + towerBlast * (matId > 0.5 ? 1.2 : 0.45) + storm * 0.35 + freefall * 0.28;
        surf += step(0.92, tw) * spark * beatSpark * (matId > 0.5 ? 1.4 : 2.2);
        surf += spark * beatSpark * vec3(1.0, 0.98, 0.95) * (matId > 0.5 ? 0.22 : 0.12);
        surf += fres * spark * 0.6;
      }

      float haze = 1.0 - exp(-dist * (0.026 + storm * 0.012 + underCanyon * 0.018 - escape * 0.008));
      col = mix(surf, sky(rd), haze);
    }

    // --- title billboards: one camera-facing label floating ahead per lane ---
    #if SHOW_TITLES
    {
      float pz = playerZ();
      for (int li = 0; li < SCENE_LANES; li++) {
        float lane = float(li) - float(SCENE_LANES - 1) * 0.5;
        int word = int(mod(float(li), 5.0));
        vec3 anchorC = vec3(lane * LANE, 3.0, pz + 34.0);
        vec3 Lw = bendApprox(anchorC);
        vec3 toL = Lw - ro;
        float denom = dot(rd, -fwd);
        if (denom > 0.0001) {
          float tHit = dot(toL, -fwd) / denom;
          if (tHit > 0.0 && (hit < 0.0 || tHit < dist)) {
            vec3 lp = (ro + rd * tHit) - Lw;
            vec2 luv = vec2(dot(lp, right) / 5.5, dot(lp, upv) / 1.25);
            if (abs(luv.x) < 1.0 && abs(luv.y) < 1.0) {
              float fade = exp(-tHit * 0.02);
              float cov = printTitle(luv, word);
              // faint holo plate behind the glyphs, then cyan ink on top
              col = mix(col, vec3(0.04, 0.13, 0.18), 0.14 * fade);
              col = mix(col, vec3(0.66, 0.92, 1.0), cov * 0.9 * fade);
            }
          }
        }
      }
    }
    #endif

    col = pow(clamp(col, 0.0, 1.0), vec3(0.92));
    col *= mix(vec3(0.98, 1.0, 1.03), vec3(1.02, 1.03, 1.06), escape);
    col += towerBlast * vec3(0.07, 0.12, 0.16) * smoothstep(0.3, 1.0, length(uv));

    // adrenaline edge wash during the dramatic glances
    float edge = smoothstep(0.4, 0.95, length(uv));
    col = mix(col, mix(col, vec3(dot(col, vec3(0.33))), 0.3), edge * attention * 0.4);
    col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.9, 0.98, 1.1), edge * storm * 0.24);
    col = mix(col, vec3(0.05, 0.08, 0.12), underCanyon * (0.12 + edge * 0.25));
    col += freefall * vec3(0.06, 0.10, 0.14) * (1.0 - smoothstep(0.0, 0.9, length(uv)));

    outCol = col;
  }

  void main() {
    vec3 col;
    mainScene(col);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Full-quality scene used by the route page: denser lanes/tiers, more steps,
// finer shatter grids, and the title billboards on.
export const skybridgesFrag = `
#define SCENE_LANES 4
#define SCENE_TIERS 2
#define SCENE_TOWERS 2
#define RM_STEPS 76
#define MAX_DIST 165.0
#define STEP_K 0.62
#define SHX 2
#define SHZ 2
#define TWX 2
#define TWY 2
#define TWZ 2
#define FBM_OCTAVES 4
#define SHOW_TITLES 1
${COMMON}`;

// Cheaper hover-thumbnail variant: fewer raymarch steps, fewer lanes/tiers,
// coarser shatter, no titles — but the same glass-arch-in-bright-sky read.
export const skybridgesPreviewFrag = `
#define SCENE_LANES 3
#define SCENE_TIERS 2
#define SCENE_TOWERS 2
#define RM_STEPS 50
#define MAX_DIST 130.0
#define STEP_K 0.6
#define SHX 2
#define SHZ 2
#define TWX 2
#define TWY 2
#define TWZ 2
#define FBM_OCTAVES 3
#define SHOW_TITLES 0
${COMMON}`;
