export const structuresGlsl = `  // --- collapse-behind -----------------------------------------------------
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

  // The original journey blew tower crowns into a deterministic 3D debris
  // field. Keeping the grid compile-time bounded makes the effect WebGL 1-safe.
  float shatterTower(vec3 lp, vec3 hf, float prog, float seed) {
    float best = 1e5;
    float cx = (hf.x * 2.0) / float(TWX);
    float cy = (hf.y * 2.0) / float(TWY);
    float cz = (hf.z * 2.0) / float(TWZ);
    for (int i = 0; i < TWX; i++) {
      for (int j = 0; j < TWY; j++) {
        for (int k = 0; k < TWZ; k++) {
          float fi = float(i) + 0.5, fj = float(j) + 0.5, fk = float(k) + 0.5;
          vec3 center = vec3(-hf.x + fi * cx, -hf.y + fj * cy, -hf.z + fk * cz);
          float h = hash21(vec2(seed + fi * 1.7 + fk * 0.3, fj * 2.3));
          float h2 = hash21(vec2(fj * 1.1, seed + fi * 0.7 + fk * 1.9));
          vec3 dir = normalize(vec3(center.x + h - 0.5, 0.6 + h2, center.z + h2 - 0.5));
          vec3 off = dir * prog * prog * 22.0;
          off.y -= prog * prog * 30.0;
          vec3 ls = lp - center - off;
          ls.xy = rot((h - 0.5) * prog * 9.0) * ls.xy;
          ls.yz = rot((h2 - 0.5) * prog * 9.0) * ls.yz;
          best = min(best, sdBox(ls, vec3(cx, cy, cz) * 0.5 * (1.0 - prog * 0.3)));
        }
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

  // Tall skyscrapers occupy both flanks. As each tower reaches the runner its
  // upper mass tears away, bursts into chunks, and falls toward the cloud sea.
  float mapTowers(vec3 p) {
    float pz = playerZ();
    float d = 1e5;
    float gap = 52.0;
    float blastTheme = max(gSpan, max(gTrain * 0.72, max(gFrost * 0.78, gConv * 0.42)));
    for (int i = 0; i < SCENE_TOWERS; i++) {
      float fi = float(i);
      float baseZ = floor(pz / gap) * gap + fi * gap + 26.0;
      for (int sideIndex = 0; sideIndex < 2; sideIndex++) {
        float side = sideIndex == 0 ? -1.0 : 1.0;
        float seed = hash21(vec2(baseZ * 0.07, side * 3.3 + fi));
        float tx = side * (22.0 + seed * 10.0);
        float tz = baseZ + (seed - 0.5) * 16.0;
        float topY = 14.0 + seed * 24.0;
        float baseY = -70.0;
        float halfH = (topY - baseY) * 0.5;
        float midY = (topY + baseY) * 0.5;
        float width = 3.5 + seed * 3.0;
        vec3 lp = p - vec3(tx, midY, tz);

        float ahead = tz - pz;
        float proximity = 1.0 - smoothstep(16.0, 64.0, ahead);
        float selected = step(0.48, hash21(vec2(baseZ, side)));
        float collapse = clamp(proximity * max(selected * 0.84, blastTheme), 0.0, 1.0);

        float tower;
        if (collapse < 0.001) {
          tower = sdBox(lp, vec3(width, halfH, width));
        } else {
          float stumpH = halfH * (1.0 - collapse * 0.58);
          float stump = sdBox(
            lp - vec3(0.0, -(halfH - stumpH), 0.0),
            vec3(width, stumpH, width)
          );
          vec3 crown = lp - vec3(0.0, stumpH, 0.0);
          float debris = shatterTower(
            crown,
            vec3(width, halfH - stumpH + 0.01, width),
            collapse,
            hash21(vec2(tz, side))
          );
          tower = min(stump, debris);
        }

        if (tower < d) {
          d = tower;
          gThick = 0.12;
          gFell = collapse * 0.7;
          gSpark = collapse;
          gMat = 2.0;
        }
      }
    }
    return d;
  }

`
