export const materialsGlsl = `  // --- scene composition ---------------------------------------------------
  float mapScene(vec3 w) {
    gThick = 0.0; gFell = 0.0; gSpark = 0.0; gMat = 0.0;
    vec3 pathSpace = unbend(w);
    float d = mapMainDeck(pathSpace);
    float t0 = gThick, f0 = gFell, s0 = gSpark, m0 = gMat;
    float dc = mapCrossings(pathSpace);
    float t1 = gThick, f1 = gFell, s1 = gSpark, m1 = gMat;
    float dt = mapTrain(pathSpace);
    float t2 = gThick, f2 = gFell, s2 = gSpark, m2 = gMat;
    float db = mapTowers(pathSpace);
    float t3 = gThick, f3 = gFell, s3 = gSpark, m3 = gMat;

    float best = d; gThick = t0; gFell = f0; gSpark = s0; gMat = m0;
    if (dc < best) { best = dc; gThick = t1; gFell = f1; gSpark = s1; gMat = m1; }
    if (dt < best) { best = dt; gThick = t2; gFell = f2; gSpark = s2; gMat = m2; }
    if (db < best) { best = db; gThick = t3; gFell = f3; gSpark = s3; gMat = m3; }
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

    // --- the star comes apart -------------------------------------------
    float b = blast();
    if (b > 0.001) {
      // Angle off the sun, which is the only coordinate the whole event needs.
      float ang = acos(clamp(dot(rd, gKeyDir), -1.0, 1.0));
      float cool = smoothstep(0.16, 0.85, b);

      // The disc. It swells by two orders of magnitude in the first tenth of
      // the sequence and then hangs there, burning down.
      float rad = mix(0.0045, 0.30, smoothstep(0.0, 0.16, b)) * (1.0 + 0.10 * cool);
      // Ragged, not round: the edge is torn by low-frequency noise that keeps
      // turning, so it reads as material rather than as a light source.
      float tear = fbm(vec2(atan(rd.y - gKeyDir.y, rd.x - gKeyDir.x) * 2.4, iTime * 0.35)) - 0.5;
      float edge = rad * (1.0 + tear * 0.55 * smoothstep(0.10, 0.5, b));
      float disc = smoothstep(edge, edge * 0.55, ang);

      // Convective cells crawling over the surface as it cools to slag.
      float cell = fbm(rd.xy * 26.0 + vec2(iTime * 0.22, -iTime * 0.16));
      vec3 core = mix(vec3(3.2, 3.0, 2.7), mix(vec3(2.2, 0.62, 0.12),
        vec3(0.70, 0.11, 0.04), cell), cool);
      col = mix(col, core, disc);

      // Filaments thrown clear of the disc, dragged out radially.
      float fil = fbm(vec2(atan(rd.y - gKeyDir.y, rd.x - gKeyDir.x) * 7.0, ang * 5.0 - iTime * 0.3));
      col += mix(vec3(1.3, 0.80, 0.32), vec3(0.60, 0.11, 0.03), cool)
        * smoothstep(0.62, 1.0, fil) * smoothstep(edge * 3.2, edge, ang) * (1.0 - cool * 0.6);

      // The shockfront. One luminous ring, expanding from the sun across the
      // entire sky and out past the horizon behind you — which is what makes it
      // an event you are inside rather than a picture you are looking at.
      float front = blastFront(b);
      // Narrow and not very bright in absolute terms: the scene it crosses is a
      // daylit one whose whites already sit near 1.0, and a front authored in
      // the star's own units blows every pane of glass on the bridge to paper.
      float ring = smoothstep(0.16, 0.0, abs(ang - front));
      col += mix(vec3(1.5, 1.2, 0.9), vec3(0.75, 0.24, 0.09), cool) * ring * (1.0 - cool * 0.55);
      // Everything the front has already passed is scorched.
      float passed = smoothstep(front + 0.20, front - 0.30, ang);
      col = mix(col, mix(col, mix(vec3(0.62, 0.27, 0.11), vec3(0.13, 0.035, 0.028), cool),
        0.80), passed);
    }
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

`
