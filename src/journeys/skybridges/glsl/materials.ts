// The scene map, normals, sunlight, and how each material takes the light:
// glass that reflects the world-fixed sky and shows what is behind it, curtain
// walls with rooms behind them, steel, concrete, the train, frosted glass.
// Cracks are shading on top of all the glass (cracks.ts decides when).

export const materialsGlsl = /* glsl */`
  void keep(float d, inout float best) {
    if (d < best) { best = d; gMat = cMat; gInfo = cInfo; gBoxC = cBoxC; gBoxH = cBoxH; }
  }

  float ssd(float a, float b, float z) { float u = clamp((z - a) / (b - a), 0.0, 1.0); return 6.0 * u * (1.0 - u) / (b - a); }

  /** How fast the route turns at z (rad/m): unbend stretches space by this times the distance from the runner. */
  float turnRate(float z) {
    z = mod(z, LOOP_Z);
    return -PI / 3.0 * ssd(188.0, 224.0, z) + PI * 2.0 / 3.0 * ssd(366.0, 414.0, z)
      + PI * ssd(420.0, 480.0, z) + PI * 2.0 / 3.0 * ssd(488.0, 532.0, z);
  }

  float map(vec3 w) {
    vec3 p = unbend(w);
    float best = 1e5;
    keep(mapDeck(p), best);
    keep(mapNode(p), best);
    keep(mapCrossings(p), best);
    keep(mapFacade(p), best);
    keep(mapWire(p), best);
    keep(mapTrain(p), best);
    keep(mapCanyon(p), best);
    keep(mapTube(p), best);
    keep(mapHelix(p), best);
    keep(mapCrown(p), best);
    keep(mapTowers(p), best);
    // A bent world is not a distance field any more: scale the step by the stretch.
    return best / (1.0 + length(w.xz - vec2(0.0, gZ)) * abs(turnRate(w.z)));
  }

  vec3 normalAt(vec3 p, float t) {
    float e = 0.0015 + t * 0.0004;
    vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
                     k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
  }

  // --- sunlight: closed form, no march ---------------------------------------------
  /** 1 if a ray from ro along rd misses the box (c, h), else 0. */
  float boxClear(vec3 ro, vec3 rd, vec3 c, vec3 h) {
    vec3 m = 1.0 / rd;
    vec3 n = m * (ro - c);
    vec3 k = abs(m) * h;
    vec3 t1 = -n - k, t2 = -n + k;
    float tn = max(max(t1.x, t1.y), t1.z);
    float tf = min(min(t2.x, t2.y), t2.z);
    return (tn > tf || tf < 0.0) ? 1.0 : 0.0;
  }

  /** The sun reaching render-space w: the towers and set pieces in its way, the handrails' and the space frame's shadows. */
  float sunlight(vec3 w) {
    if (gSunW.y < 0.02) return 0.0;
    vec3 p = unbend(w);
    vec2 sxz = turnXZ(gSunW.xz, -turnHeading(p.z));
    vec3 sd = normalize(vec3(sxz.x, gSunW.y, sxz.y)) + vec3(1e-5);
    float zl = mod(p.z, LOOP_Z);
    float base = p.z - zl;
    float lit = 1.0;
    vec3 c, h;
    float side = sd.x < 0.0 ? -1.0 : 1.0;
    float k0 = floor(p.z / 36.0);
    float dir = sd.z < 0.0 ? -1.0 : 1.0;
    for (int i = 0; i < 4; i++) {
      if (towerBox(k0 + (float(i) - 1.0) * dir, side, c, h) > 0.5) lit *= boxClear(p, sd, c, h);
    }
    if (zl > 90.0 && zl < 215.0) lit *= boxClear(p, sd, vec3(-19.5, -85.0, base + 151.0), vec3(15.0, 155.0, 47.0));
    if (zl > 240.0 && zl < 300.0) lit *= boxClear(p, sd, vec3(0.0, -82.5, base + 273.0), vec3(22.0, 157.5, 11.0));
    if (zl > 270.0 && zl < 350.0) lit *= boxClear(p, sd, vec3(-22.0, -97.5, base + 311.0), vec3(15.0, 142.5, 29.0))
      * boxClear(p, sd, vec3(22.0, -97.5, base + 311.0), vec3(15.0, 142.5, 29.0));
    if (zl > 405.0 && zl < 495.0) lit *= boxClear(p, sd, vec3(27.0, -90.0, base + 450.0), vec3(20.0, 150.0, 36.0));

    float top = deckTop(p.z);
    if (top < 9000.0 && abs(p.y - top) < 0.25) {
      float hw = deckHalfW(zl);
      vec3 rails = railsAt(zl);
      float off = sd.x / sd.y * rails.z;
      for (int s = 0; s < 2; s++) {
        float sx = s == 0 ? -1.0 : 1.0;
        if ((s == 0 ? rails.x : rails.y) < 0.5) continue;
        float xr = sx * (hw - 0.04);
        float xs = xr - off;
        if (abs(p.x - xs) < 0.035) lit *= 0.15;
        else if ((p.x - xr) * (p.x - xs) < 0.0) lit *= 0.86;
      }
      if (zl > 494.0 && zl < 526.0) {
        float t = (top + 7.0 - p.y) / sd.y;
        vec2 g = vec2(p.x + sd.x * t, zl + sd.z * t);
        if (abs(g.x) < 6.4 && abs(g.y - 510.0) < 14.0) {
          vec2 gg = abs(fract(g / 2.4) - 0.5) * 2.4;
          lit *= min(gg.x, gg.y) < 0.06 ? 0.1 : 0.82;
        }
      }
    }
    return lit;
  }

  // --- light -------------------------------------------------------------------
  float fresnel(float c, float f0) { float m = 1.0 - c; float m2 = m * m; return f0 + (1.0 - f0) * m2 * m2 * m; }

  /** Sky above, the bright cloud sea below (it is most of the bounce light up here). */
  vec3 ambient(vec3 n) {
    vec3 below = mix(gHorizon, vec3(1.0), 0.25) * 0.5 * (1.0 - 0.8 * gNight) + vec3(0.6, 0.3, 0.12) * 0.05 * gNight;
    return mix(below, mix(gHorizon, gZenith, 0.55), n.y * 0.5 + 0.5);
  }

  vec3 direct(vec3 n, float sun) {
    return gSunCol * 0.1 * max(dot(n, gSun), 0.0) * sun + gBlastCol * 0.1 * max(dot(n, gBlastDir), 0.0);
  }

  /** The sun's glint in a reflection R, and the fireball's. */
  vec3 glint(vec3 R, float sun, float rough) {
    float c = max(dot(R, gSun), 0.0);
    float sharp = smoothstep(0.9994 - rough * 0.02, 0.99995, c);
    return gSunCol * (sharp * 6.0 + 0.4 * pow(c, mix(400.0, 40.0, rough))) * sun
      + gBlastCol * 0.3 * pow(max(dot(R, gBlastDir), 0.0), 60.0);
  }

  /** A canonical direction from a render-space one, at canonical z. */
  vec3 canonDir(vec3 d, float z) {
    vec2 r = turnXZ(d.xz, gCamH - turnHeading(z));
    return vec3(r.x, d.y, r.y);
  }
  vec3 renderDir(vec3 d, float z) {
    vec2 r = turnXZ(d.xz, turnHeading(z) - gCamH);
    return vec3(r.x, d.y, r.y);
  }

  // --- glass -------------------------------------------------------------------
  /** Tilt a normal per shard, so a cracked pane's reflection breaks into facets. */
  vec3 shardNormal(vec3 n, vec4 cr) {
    if (cr.w <= 0.0) return n;
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(n, t1);
    return normalize(n + (t1 * (fract(cr.z * 7.31) - 0.5) + t2 * (fract(cr.z * 3.17) - 0.5)) * 0.09);
  }

  /** Flat glass: the sky it reflects, the world through it (behind), its cracks (cr). */
  vec3 shadeGlass(vec3 w, vec3 n, vec3 rd, vec3 behind, vec4 cr, float sun) {
    vec3 nn = shardNormal(n, cr);
    float F = fresnel(clamp(dot(nn, -rd), 0.0, 1.0), 0.04);
    vec3 R = reflect(rd, nn);
    vec3 col = mix(behind * vec3(0.90, 0.96, 0.94), sky(R, w.y, 0.0) + glint(R, sun, 0.0), F);
    vec3 lit = ambient(nn) + direct(nn, sun);
    col = mix(col, lit * 0.95 + 0.03, cr.x * 0.85);
    return mix(col, lit * 1.2, cr.y);
  }

  /** Glass in panels (the hall, spokes, spans, canopy, balustrades): a front of cracks spreading out from the runner's path. */
  vec4 panelCracks(vec3 pc, vec3 nc, float px, float kind) {
    vec2 uv = abs(nc.y) > 0.7 ? pc.xz : vec2(pc.x * abs(nc.z) + pc.z * abs(nc.x), pc.y);
    vec2 id = floor(uv / 1.5);
    float h = hash21(id + kind * 5.1);
    float h2 = hash21(id.yx + 3.7);
    if (h > 0.3 + 0.6 * damageAt(pc.z / SPEED)) return vec4(0.0);
    float tc = pc.z / SPEED - 1.0 + abs(pc.x) * 0.25 + max(pc.y - deckTop(pc.z), 0.0) * 0.08 + h2 * 3.0;
    tc = min(tc, BLAST_T + gArrive + h * 0.3);
    vec2 imp = (id + 0.25 + 0.5 * vec2(h2, fract(h * 9.7))) * 1.5;
    return spiderweb(uv - imp, iTime - tc, h2, px, kind > 4.5 ? 1.5 : 0.9);
  }

  /** The hall floor: rainbow caustics from the light through its ribs and dome. */
  vec3 caustics(vec2 q) {
    float a = sin(q.x * 3.1 + gTm * 0.2) + sin(q.y * 2.7 - gTm * 0.15) + sin((q.x + q.y) * 1.9);
    return (0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + a * 2.0)) * smoothstep(1.2, 2.6, a);
  }

  vec3 shadeFrost(vec3 w, vec3 n, vec3 rd, vec3 behind, float px) {
    vec3 pc = unbend(w);
    vec2 uv = vec2(atan(pc.x, pc.y - deckTop(pc.z) - 1.25) * 2.6, pc.z);
    float fr = fbm(uv * 3.0) * 0.6 + vnoise(uv * 41.0) * 0.4;
    vec2 id = floor(vec2(uv.x / 1.6, uv.y / 3.0));
    float h = hash21(id + 2.2);
    vec4 cr = spiderweb((uv - (id + vec2(0.3 + 0.4 * h, 0.5)) * vec2(1.6, 3.0)), iTime - ((id.y + 0.5) * 3.0 / SPEED - 1.2 + h * 3.0), h, px, 1.2);
    vec3 lit = ambient(n) + direct(n, 1.0);
    vec3 col = mix(mix(behind, lit, 0.5) * 0.85, lit * 0.95, 0.55 + 0.35 * fr);
    col = mix(col, lit * 1.25 + 0.05, cr.x * 0.9);
    float F = fresnel(clamp(dot(n, -rd), 0.0, 1.0), 0.03);
    return col + skyBase(toWorld(reflect(rd, n))) * F * 0.5;
  }

  // --- curtain walls -------------------------------------------------------------
  /** Rooms behind the glass: one per three panes, ceiling panels, lit or dark. dir is the ray in face space (x along, y up, z in). */
  vec3 interior(vec2 uv, vec3 dir, float lit, float seed) {
    vec2 room = vec2(4.5, 3.6);
    vec2 cell = floor(uv / room);
    vec2 f = uv - cell * room;
    float h = hash21(cell + seed);
    float tx = dir.x > 0.0 ? (room.x - f.x) / dir.x : f.x / max(-dir.x, 1e-4);
    float ty = dir.y > 0.0 ? (room.y - f.y) / dir.y : f.y / max(-dir.y, 1e-4);
    float tz = (4.0 + 3.0 * fract(h * 7.1)) / max(dir.z, 1e-3);
    float tm = min(tx, min(ty, tz));
    vec3 hp = vec3(f, 0.0) + dir * tm;
    float on = step(1.0 - lit, fract(h * 13.7));
    vec3 lightC = mix(vec3(1.0, 0.82, 0.6), vec3(0.85, 0.92, 1.0), fract(h * 3.3));
    vec3 wallC = mix(vec3(0.55, 0.52, 0.48), vec3(0.35, 0.38, 0.42), fract(h * 5.9));
    float amb = 0.1 * (1.0 - gNight) + 0.01;
    on *= mix(1.0, 0.3, gNight);   // night exposure is high: a lit office must not burn out
    if (tm == ty && dir.y > 0.0) {
      vec2 g = fract(vec2(hp.x / 1.5, hp.z / 1.2));
      float panel = step(0.2, g.x) * step(g.x, 0.8) * step(0.3, g.y) * step(g.y, 0.7);
      return mix(wallC * (amb + 0.35 * on), lightC * 2.5, panel * on);
    }
    if (tm == ty) return vec3(0.12, 0.11, 0.10) * (amb + 0.6 * on);
    if (tm == tz) return wallC * (amb + 0.7 * on) * lightC * (0.85 + 0.15 * step(0.5, fract(hp.x * 0.6 + h)));
    return wallC * (amb + 0.5 * on);
  }

  vec3 shadeFacade(vec3 w, vec3 n, vec3 rd, float t, float px) {
    float sun = sunlight(w + n * 0.1);
    vec3 pc = unbend(w);
    vec3 nc = canonDir(n, pc.z);
    vec3 rdc = canonDir(rd, pc.z);
    vec3 an = abs(nc);
    if (an.y > an.x && an.y > an.z) {
      // a roof: gravel and plant, nobody looks
      return vec3(0.16, 0.16, 0.17) * (ambient(n) + direct(n, sun));
    }
    vec3 N = an.x > an.z ? vec3(sign(nc.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(nc.z));
    vec3 T = an.x > an.z ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec2 uv = vec2(dot(pc, T), pc.y);
    vec2 g = uv / vec2(1.5, 3.6);
    vec2 id = floor(g);
    vec2 f = g - id;

    float style = gInfo.x;
    float seed = style < 0.5 ? hash21(gInfo.yz) : style * 0.173;
    float tsel = fract(seed * 4.7);
    vec3 tint = tsel < 0.25 ? vec3(0.55, 0.70, 0.74) : tsel < 0.5 ? vec3(0.50, 0.54, 0.58) : tsel < 0.75 ? vec3(0.66, 0.55, 0.42) : vec3(0.42, 0.56, 0.72);
    float lit = mix(0.3, 0.6, gNight);
    float f0 = 0.08;
    if (style > 0.5 && style < 1.5) { f0 = 0.16; tint = vec3(0.55, 0.66, 0.72); }
    if (style > 1.5 && style < 2.5) lit = 0.85;
    if (style > 2.5 && style < 3.5) tint = vec3(0.70, 0.60, 0.45);
    if (style > 3.5) { lit = 0.75; tint = vec3(0.60, 0.68, 0.74); }

    // The pane's fate: a crack front from near bridge height as the runner comes past.
    vec3 face = gBoxC + N * gBoxH;
    vec3 origin = vec3(an.x > an.z ? face.x : gBoxC.x, 0.0, an.x > an.z ? gBoxC.z + (seed - 0.5) * gBoxH.z : face.z);
    vec3 paneC = T * (id.x + 0.5) * 1.5 + vec3(0.0, (id.y + 0.5) * 3.6, 0.0) + N * dot(face, N);
    vec2 fate = facadeFate(id + style * 101.0, seed, paneC, origin, gBoxC.z / SPEED, gArrive + 1.5 * (seed - 0.5));

    float h1 = hash21(id + seed), h2 = hash21(id.yx + seed * 3.0);
    float spandrel = step(f.y, 0.24);
    float near = 1.0 - smoothstep(120.0, 220.0, t);
    vec4 cr = vec4(0.0);
    if (fate.x > 0.0 && near > 0.0) cr = spiderweb((f - vec2(0.3 + 0.4 * h2, 0.45 + 0.4 * h1)) * vec2(1.5, 3.6), fate.x, h1, px, 1.4) * near;

    // Oil-canning: every pane a fraction of a degree off true, and the shards more.
    vec3 Tr = renderDir(T, pc.z);
    vec3 nn = normalize(n + (Tr * (h1 - 0.5) + vec3(0.0, 1.0, 0.0) * (h2 - 0.5)) * 0.02);
    nn = shardNormal(nn, cr);
    float F = fresnel(clamp(dot(nn, -rd), 0.0, 1.0), f0);
    vec3 R = reflect(rd, nn);
    vec3 refl = sky(R, w.y, 0.0) + glint(R, sun, 0.04);
    vec3 dirF = vec3(dot(rdc, T), rdc.y, -dot(rdc, N));
    vec3 room = interior(uv, dirF, lit, seed * 31.0) * near + vec3(0.04, 0.045, 0.05) * (1.0 - near) * (0.4 + lit);

    vec3 col;
    if (spandrel > 0.5) col = mix(tint * 0.06 * (ambient(n) + direct(n, sun)), refl, F);
    else col = mix(room * tint, refl, F);
    vec3 litC = ambient(nn) + direct(nn, sun);
    col = mix(col, litC * 0.9 + 0.03, cr.x * 0.8 * (1.0 - spandrel));

    // Blown out: the room, and the jagged rim of glass still in the frame.
    if (fate.y > 0.5 && spandrel < 0.5) {
      vec2 e = min(f - vec2(0.0, 0.24), 1.0 - f) * vec2(1.5, 3.6);
      float rim = min(e.x, e.y) - 0.05 - 0.12 * vnoise(f * vec2(9.0, 21.0) + id);
      col = rim < 0.0 ? litC * 0.8 + 0.05 : room;
    }

    // Mullions and slab edges, faded to their average as they shrink below a pixel.
    float fade = clamp(0.05 / max(px, 1e-4), 0.0, 1.0);
    float mull = max(1.0 - smoothstep(0.026, 0.026 + px / 1.5, min(f.x, 1.0 - f.x)), 1.0 - smoothstep(0.012, 0.012 + px / 3.6, abs(f.y - 0.24)));
    vec3 alu = vec3(0.2, 0.21, 0.22) * (ambient(n) + direct(n, sun));
    col = mix(col, alu, mull * fade * 0.9);
    return mix(col, mix(col, alu, 0.15), 1.0 - fade);
  }

  // --- the rest ------------------------------------------------------------------
  vec3 shadeSteel(vec3 w, vec3 n, vec3 rd) {
    float sun = sunlight(w + n * 0.05);
    vec3 R = reflect(rd, n);
    float F = fresnel(clamp(dot(n, -rd), 0.0, 1.0), 0.45);
    return vec3(0.22, 0.23, 0.25) * (ambient(n) + direct(n, sun)) * 0.8
      + skyBase(toWorld(R)) * F * 0.3 + glint(R, sun, 0.5) * F * 0.3;
  }

  vec3 shadeConcrete(vec3 w, vec3 n) {
    float sun = sunlight(w + n * 0.05);
    vec3 pc = unbend(w);
    float grain = 0.85 + 0.3 * vnoise(pc.xz * 3.0 + pc.y * 2.0);
    return vec3(0.42, 0.41, 0.39) * grain * (ambient(n) * 0.8 + direct(n, sun));
  }

  vec3 shadeTrain(vec3 w, vec3 n, vec3 rd, vec4 info) {
    float sun = sunlight(w + n * 0.05);
    vec3 c = info.xyz;
    float side = step(0.6, abs(n.x));
    float win = side * step(abs(c.y - 0.25), 0.36) * step(0.35, fract(c.z / 1.6 + 0.5));
    float stripe = side * step(abs(c.y + 0.45), 0.07);
    vec3 R = reflect(rd, n);
    float F = fresnel(clamp(dot(n, -rd), 0.0, 1.0), 0.06);
    vec3 paint = mix(vec3(0.82, 0.84, 0.86), vec3(0.62, 0.85, 1.0), stripe);
    vec3 col = paint * (ambient(n) + direct(n, sun)) + skyBase(toWorld(R)) * F * 0.6 + glint(R, sun, 0.2) * F;
    vec3 glass = mix(vec3(0.03, 0.035, 0.04) + vec3(1.0, 0.85, 0.6) * 0.25 * step(0.4, fract(info.w * 0.37 + floor(c.z / 1.6) * 0.31)), sky(R, w.y, 0.0), fresnel(clamp(dot(n, -rd), 0.0, 1.0), 0.05));
    return mix(col, glass, win);
  }

  // --- through the glass -----------------------------------------------------------
  /** Heavy effects: carry on through a pane and light what is behind it plainly. */
  vec3 throughGlass(vec3 w, vec3 rd, vec3 n) {
    vec3 ro = w + rd * (0.18 / max(abs(dot(rd, n)), 0.15));
    float t = 0.0;
    for (int i = 0; i < SEETHRU_STEPS; i++) {
      vec3 p = ro + rd * t;
      float d = map(p);
      if (d < 0.002 + 0.002 * t) {
        vec3 nn = normalAt(p, t);
        vec3 col;
        if (abs(gMat - M_FACADE) < 0.5) col = skyBase(toWorld(reflect(rd, nn))) * 0.35 + vec3(0.03, 0.035, 0.04);
        else if (gMat < 0.5 || abs(gMat - M_FROST) < 0.5) col = mix(sky(rd, p.y, 1.0), skyBase(toWorld(reflect(rd, nn))), 0.2);
        else col = vec3(0.3) * (ambient(nn) + direct(nn, 1.0));
        return mix(col, fogCol(rd), 1.0 - exp(-(t + 0.5) * gHaze));
      }
      t += d * 0.85;
      if (t > SEETHRU_DIST) break;
    }
    return sky(rd, w.y, 1.0);
  }

  /** Light the surface the march stopped at. The scene globals hold its material. */
  vec3 shade(vec3 w, vec3 rd, float t) {
    float mat = gMat;
    vec4 info = gInfo;
    vec3 bc = gBoxC, bh = gBoxH;
    vec3 n = normalAt(w, t);
    gMat = mat; gInfo = info; gBoxC = bc; gBoxH = bh;
    float px = t / (iResolution.y * 1.25);

    if (abs(mat - M_FACADE) < 0.5) return shadeFacade(w, n, rd, t, px);
    if (abs(mat - M_STEEL) < 0.5) return shadeSteel(w, n, rd);
    if (abs(mat - M_CONCRETE) < 0.5) return shadeConcrete(w, n);
    if (abs(mat - M_TRAIN) < 0.5) return shadeTrain(w, n, rd, info);

    vec3 behind = uHeavy > 0.5 ? throughGlass(w, rd, n) : sky(rd, w.y, 1.0);
    if (abs(mat - M_FROST) < 0.5) return shadeFrost(w, n, rd, behind, px);

    vec3 pc = unbend(w);
    float sun = sunlight(w + n * 0.05);
    vec4 cr = vec4(0.0);
    if (info.x > 0.5 && info.x < 1.5) {
      if (info.w > 0.0) {
        cr = vec4(0.6, 0.0, fract(info.y * 0.37 + info.z * 0.61), 1.0);   // falling: wholly crazed
      } else {
        float ix = info.y, iz = info.z;
        vec4 fate = deckPane(ix, iz, (iz + 0.5) * PANE_L);
        cr = spiderweb(vec2(pc.x - ix * PANE_W, pc.z - (iz + 0.5) * PANE_L) - fate.zw, iTime - fate.x, hash21(vec2(ix, iz) + 0.37), px, 0.95);
        cr.x = max(cr.x, runningCrack(pc, px));
      }
    } else if (info.x > 1.5) {
      cr = panelCracks(pc, canonDir(n, pc.z), px, info.x);
      cr.x *= 0.6;
      if (info.x > 4.5) cr = max(cr, vec4(0.5, 0.0, 0.5, 1.0));
    }
    vec3 col = shadeGlass(w, n, rd, behind, cr, sun);
    if (info.x > 3.5 && info.x < 4.5) col += caustics(pc.xz) * gSunCol * 0.012 * sun;
    return col;
  }
`
