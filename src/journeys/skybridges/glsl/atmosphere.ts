// Light per section and the sky behind everything. The sky is looked up in
// true-world directions (toWorld), so it stays put while the route turns under
// it — the sun swings across the frame through every bend.
//
// Units: sunCol is the sun's strength such that a white surface square to it
// reads sunCol * 0.1; the sky colours are radiance as seen. Exposure, then
// ACES, happen once at the end of main().

export const atmosphereGlsl = /* glsl */`
  vec3 sunAt(float az, float el) { return vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el)); }

  void setupLight() {
    float z = gZL;
    gW1 = sectionW(z, 0.0, 60.0);    gW2 = sectionW(z, 60.0, 120.0);  gW3 = sectionW(z, 120.0, 180.0);
    gW4 = sectionW(z, 180.0, 240.0); gW5 = sectionW(z, 240.0, 300.0); gW6 = sectionW(z, 300.0, 360.0);
    gW7 = sectionW(z, 360.0, 420.0); gW8 = sectionW(z, 420.0, 480.0); gW9 = sectionW(z, 480.0, 540.0);

    vec3 sun = vec3(0.0), sc = vec3(0.0), ze = vec3(0.0), ho = vec3(0.0);
    float hz = 0.0, ex = 0.0, cl = 0.0, bl = 0.0;
    float w;
    // 1 DAWN APPROACH — 4 degrees up, ahead-left, gold
    w = gW1; sun += w * sunAt(-0.44, 0.07); sc += w * vec3(1.0, 0.58, 0.32) * 7.0;
    ze += w * vec3(0.10, 0.16, 0.34); ho += w * vec3(0.95, 0.62, 0.42); hz += w * 0.0022; ex += w * 0.9; cl += w * 0.35; bl += w * 0.6;
    // 2 THE INTERCHANGE — cool white, 28 degrees
    w = gW2; sun += w * sunAt(-0.17, 0.49); sc += w * vec3(1.0, 0.96, 0.9) * 9.0;
    ze += w * vec3(0.13, 0.30, 0.62); ho += w * vec3(0.62, 0.74, 0.88); hz += w * 0.0016; ex += w * 0.75; cl += w * 0.3; bl += w * 0.45;
    // 3 THE CURTAIN WALL — high, from the right, so the facade is a mirror
    w = gW3; sun += w * sunAt(1.22, 0.79); sc += w * vec3(1.0, 0.97, 0.93) * 10.0;
    ze += w * vec3(0.10, 0.28, 0.62); ho += w * vec3(0.60, 0.74, 0.90); hz += w * 0.0014; ex += w * 0.7; cl += w * 0.25; bl += w * 0.4;
    // 4 THE WIRE — thin high-altitude teal, deep zenith
    w = gW4; sun += w * sunAt(2.79, 1.08); sc += w * vec3(0.95, 0.98, 1.0) * 10.0;
    ze += w * vec3(0.04, 0.17, 0.42); ho += w * vec3(0.45, 0.70, 0.78); hz += w * 0.0010; ex += w * 0.72; cl += w * 0.15; bl += w * 0.4;
    // 5 THE GLASS LINE — low, hard, from the right
    w = gW5; sun += w * sunAt(0.52, 0.21); sc += w * vec3(1.0, 0.82, 0.60) * 8.5;
    ze += w * vec3(0.12, 0.22, 0.45); ho += w * vec3(0.85, 0.70, 0.58); hz += w * 0.0018; ex += w * 0.85; cl += w * 0.4; bl += w * 0.55;
    // 6 THE CANYON — golden, 3 degrees, ahead-right
    w = gW6; sun += w * sunAt(-0.52, 0.05); sc += w * vec3(1.0, 0.50, 0.20) * 7.0;
    ze += w * vec3(0.14, 0.14, 0.32); ho += w * vec3(1.0, 0.55, 0.30); hz += w * 0.0024; ex += w * 0.95; cl += w * 0.45; bl += w * 0.7;
    // 7 FROST GALLERY — overcast, snow
    w = gW7; sun += w * sunAt(1.05, 0.31); sc += w * vec3(0.85, 0.90, 1.0) * 1.2;
    ze += w * vec3(0.30, 0.34, 0.40); ho += w * vec3(0.46, 0.50, 0.56); hz += w * 0.009; ex += w * 0.85; cl += w * 1.0; bl += w * 0.3;
    // 8 NIGHT HELIX — the moon, the tower's windows, aurora
    w = gW8; sun += w * sunAt(2.62, 0.61); sc += w * vec3(0.55, 0.65, 0.95) * 0.5;
    ze += w * vec3(0.004, 0.008, 0.022); ho += w * vec3(0.02, 0.03, 0.06); hz += w * 0.0012; ex += w * 3.2; cl += w * 0.2; bl += w * 0.8;
    // 9 THE CROWN — noon, brilliant
    w = gW9; sun += w * sunAt(-1.05, 1.22); sc += w * vec3(1.0, 0.98, 0.95) * 12.0;
    ze += w * vec3(0.12, 0.32, 0.70); ho += w * vec3(0.75, 0.85, 0.95); hz += w * 0.0012; ex += w * 0.75; cl += w * 0.2; bl += w * 0.9;

    gSunW = normalize(sun);
    gSunCol = sc; gZenith = ze; gHorizon = ho;
    gHaze = hz; gExposure = ex; gCloud = cl; gBloom = bl;
    gNight = gW8; gFrost = gW7; gAurora = gW8;

    // The end, applied to the light rather than painted on the sky: every surface
    // on the run takes its key and its ambient from here.
    if (gE > 0.0) {
      float warm = smoothstep(0.5, 6.0, gE);
      float pall = smoothstep(12.0, 45.0, gE);
      gZenith = mix(gZenith, vec3(0.16, 0.10, 0.08), warm * 0.55 + pall * 0.3);
      gHorizon = mix(gHorizon, vec3(0.62, 0.34, 0.18), warm * 0.6);
      gHorizon = mix(gHorizon, vec3(0.30, 0.20, 0.15), pall * 0.6);
      gSunCol *= 1.0 - 0.7 * pall;
      gHaze += 0.0035 * smoothstep(9.0, 30.0, gE);
      gNight *= 1.0 - warm;
      gAurora *= 1.0 - warm;
    }
    gSun = toRender(gSunW);
  }

  // --- the sky ---------------------------------------------------------------
  /** Sky radiance without clouds or discs, for true-world direction d. */
  vec3 skyBase(vec3 d) {
    float hz = exp(-max(d.y, 0.0) * 7.0);
    vec3 col = mix(gZenith, gHorizon, hz);
    float cs = dot(d, gSunW);
    float mie = 0.0028 / pow(max(1.0001 - 0.96 * cs, 1e-4), 1.5);
    col += gSunCol * (mie * (0.35 + 0.65 * hz) + 0.012 * (1.0 + cs * cs) * hz) * (1.0 - gNight * 0.85);
    float cb = max(dot(d, gBlastW), 0.0);
    float cb2 = cb * cb;
    col += gBlastCol * 0.02 * (cb2 * cb2 + 0.15 * cb);
    return col;
  }

  vec3 sunDisc(vec3 d) {
    float disc = smoothstep(0.99990, 0.99996, dot(d, gSunW));
    vec3 c = gSunCol * 40.0 * (1.0 - gNight) + vec3(0.9, 0.95, 1.0) * 3.0 * gNight;
    return c * disc * (1.0 - 0.9 * gFrost);
  }

  /** Cumulus 1.6 km up, lit from the sun's side, silver at the edge. */
  vec4 cloudLayer(vec3 d, float camY) {
    if (d.y < 0.015) return vec4(0.0);
    float t = (1600.0 - camY) / d.y;
    vec2 p = (gCamW + d.xz * t) * 0.00032 + vec2(gTm * 0.004, gTm * 0.0016);
    float n = fbm(p) + 0.35 * (vnoise(p * 5.3) - 0.5);
    float cov = smoothstep(0.78 - gCloud * 0.42, 0.98 - gCloud * 0.30, n);
    float sunUp = clamp(gSunW.y * 3.0 + 0.2, 0.0, 1.0);
    float cs = max(dot(d, gSunW), 0.0);
    float cs2 = cs * cs;
    vec3 col = mix(gHorizon, gZenith, 0.6) * 1.1 + gSunCol * (0.11 * sunUp * (1.2 - cov * 0.6) + 0.05 * cs2 * cs2 * cs2 * cs2);
    return vec4(col, cov * smoothstep(0.015, 0.14, d.y) * (0.9 - gNight * 0.5));
  }

  /** The cloud sea: cloud tops 120 m below the deck, met by the ray, lit from the sun's side. */
  vec3 cloudSea(vec3 d, float camY) {
    float t = (camY - SEA_Y) / max(-d.y, 0.0006);
    vec2 pw = gCamW + d.xz * t;
    vec2 q = pw * 0.0042 + vec2(gTm * 0.010, gTm * 0.004);
    float far = smoothstep(1500.0, 7000.0, t);
    float body = mix(fbm(q) + (vnoise(q * 4.7 + 3.1) - 0.5) * 0.2, 0.5, far);
    vec2 sxz = gSunW.xz / max(length(gSunW.xz), 1e-3);
    float lit = mix(clamp(0.55 + (body - fbm(q + sxz * 0.12)) * 3.2, 0.0, 1.0), 0.6, far);
    float hollow = smoothstep(0.25, 0.75, body);
    vec3 amb = mix(gHorizon, gZenith, 0.35);
    float sunUp = clamp(gSunW.y * 2.5 + 0.15, 0.0, 1.0);
    vec3 col = 0.92 * (amb * (0.55 + 0.45 * hollow) + gSunCol * 0.1 * sunUp * (0.25 + 0.75 * lit) * (0.6 + 0.4 * hollow));
    col += vec3(1.0, 0.45, 0.16) * 0.10 * gNight * smoothstep(0.55, 0.28, body);
    col = seaShock(pw, col, lit);
    return mix(col, gHorizon, 1.0 - exp(-t * (gHaze * 0.25 + 0.00004)));
  }

  /** Glass towers standing in the cloud sea all the way round the horizon. */
  vec3 skyline(vec3 d, vec3 col) {
    float az = atan(d.x, d.z);
    vec2 sunH = normalize(gSunW.xz + 1e-4);
    vec2 dH = normalize(d.xz + 1e-4);
    for (int layer = 0; layer < 2; layer++) {
      float fl = float(layer);
      float u = az * (34.0 + fl * 21.0) + fl * 17.0;
      float cell = floor(u);
      float fu = fract(u);
      float h1 = hash21(vec2(cell, 3.7 + fl));
      float body = step(0.3, hash21(vec2(cell, 1.3 + fl))) * step(0.10 + 0.1 * h1, fu) * step(fu, 0.9 - 0.08 * h1);
      float top = (0.004 + 0.03 * h1 * h1 + 0.008 * hash21(vec2(cell, 9.1))) * (0.6 + 0.6 * fl);
      float m = body * step(d.y, top) * step(-0.006, d.y);
      vec3 g = mix(gHorizon * 0.55, gZenith * 0.9, 0.35 + 0.3 * h1);
      g += gSunCol * 0.03 * smoothstep(0.92, 1.0, dot(dH, sunH)) * (1.0 - gNight);
      float floors = fract(d.y * 900.0);
      g += vec3(1.0, 0.75, 0.45) * 0.25 * gNight * step(0.6, hash21(vec2(cell, floor(d.y * 900.0)))) * step(0.3, floors);
      col = mix(col, mix(g, gHorizon, 0.55 - fl * 0.2), m);
    }
    return col;
  }

  /** Stars and aurora curtains, at night. */
  vec3 nightSky(vec3 d) {
    if (gNight < 0.01 || d.y < 0.0) return vec3(0.0);
    vec2 s = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0))) * 160.0;
    vec2 cell = floor(s);
    float h = hash21(cell);
    vec2 off = fract(s) - 0.5 - (vec2(hash21(cell + 7.1), hash21(cell + 3.3)) - 0.5) * 0.6;
    vec3 col = vec3(step(0.985, h) * smoothstep(0.12, 0.0, length(off)) * (0.4 + 0.6 * fract(h * 37.0)) * 0.6);
    float az = atan(d.x, d.z);
    float curtain = fbm(vec2(az * 2.6 + gTm * 0.02, gTm * 0.015));
    float rays = vnoise(vec2(az * 70.0, gTm * 0.25));
    float hb = smoothstep(0.06, 0.22, d.y) * (1.0 - smoothstep(0.3, 0.75, d.y));
    vec3 ac = mix(vec3(0.12, 1.0, 0.45), vec3(0.85, 0.22, 0.75), smoothstep(0.2, 0.55, d.y));
    col += ac * hb * smoothstep(0.42, 0.78, curtain) * (0.45 + 0.55 * rays) * 0.18 * gAurora;
    return col * gNight;
  }

  /** The env map as highlight detail only: it was shot in one light and this run has nine. */
  vec3 envTex(vec3 d) {
    if (uEnvLoaded < 0.5) return vec3(0.0);
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
    return max(texture2D(uEnv, uv).rgb - 0.6, 0.0) * 1.5 * (1.0 - gNight);
  }

  /**
   * Everything beyond the scene in render direction rd, seen from eye height
   * camY. direct = 1 for the view itself; 0 for reflections, which take the sun
   * from the specular term instead of the disc.
   */
  vec3 sky(vec3 rd, float camY, float direct) {
    vec3 d = toWorld(rd);
    vec3 col = skyBase(d) + (sunDisc(d) + nightSky(d)) * direct + envTex(d) * (1.0 - direct);
    vec4 cl = cloudLayer(d, camY);
    col = mix(col, cl.rgb, cl.a);
    col = skyline(d, col);
    if (d.y < 0.0) col = mix(col, cloudSea(d, camY), smoothstep(0.0, -0.004, d.y));
    vec4 mc = mushroom(d);
    return mix(col, mc.rgb, mc.a);
  }

  /** The colour distance fades to: the sky low in that direction. */
  vec3 fogCol(vec3 rd) {
    vec3 d = toWorld(rd);
    return skyBase(normalize(vec3(d.x, max(d.y, 0.0) * 0.4 + 0.02, d.z)));
  }
`
