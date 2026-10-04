// The end of the city, on one clock: gE, seconds since the detonation at the
// lap-three boundary (spec section 6). The route is a pure function of iTime,
// so the event seeks like everything else.
//
// The cloud is an impostor in the sky: a 2D signed field in the vertical plane
// through ground zero, 16 km out, its edges displaced by fbm that rolls round
// the cap's lobes and climbs the stem. Being in the sky, it is in every
// reflection too. Lengths below are km unless they say otherwise.

export const blastGlsl = /* glsl */`
  const float GZ_DIST = 16000.0;      // metres to ground zero
  const float GZ_HEADING = 0.42;      // true-world heading of ground zero: ahead-right
  const float FRONT_SPEED = 1600.0;   // the shockfront, m/s (time is compressed here)

  float capH(float e) { return 0.4 + 7.5 * (1.0 - exp(-max(e, 0.0) / 18.0)); }
  float capR(float e) { return 0.25 + 3.6 * (1.0 - exp(-max(e, 0.0) / 14.0)); }

  /** The white-out: a pulse, never a step, or the whole run stays blown out. */
  float blastFlash(float e) {
    return e < 0.0 ? 0.0 : exp(-e / 0.22);
  }

  /** What the fireball throws on everything, colour times intensity. */
  vec3 blastLight(float e) {
    if (e < 0.0) return vec3(0.0);
    float i = 38.0 * exp(-e / 0.3) + 6.0 * exp(-e / 2.8) + 1.1 * exp(-e / 14.0);
    return mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.45, 0.14), smoothstep(0.3, 6.0, e)) * i;
  }

  void setupBlast() {
    gE = iTime - BLAST_T;
    #ifdef NO_BLAST
    gE = -1.0;
    #endif
    gGZ = routeW(BLAST_T * SPEED) + vec2(sin(GZ_HEADING), cos(GZ_HEADING)) * GZ_DIST;
    vec2 to = gGZ - gCamW;
    gArrive = length(to) / FRONT_SPEED;
    #ifdef NO_BLAST
    gArrive = 1e9;
    #endif
    vec2 u = to / max(length(to), 1.0);
    gBlastW = normalize(vec3(u.x, capH(gE) * 600.0 / GZ_DIST, u.y));
    gBlastDir = toRender(gBlastW);
    gBlastCol = blastLight(gE);
  }

  /** The cloud without its billows: cap (a torus rolling under a dome), stem, base surge. */
  float cloudField(vec2 q, float e, float H, float R, float m) {
    vec2 c = q - vec2(0.0, H);
    vec2 ab = vec2(R, R * mix(1.0, 0.56, m));
    float cap = (length(c / ab) - 1.0) * ab.y;
    float lobe = length(vec2(abs(c.x) - R * 0.62, c.y + R * 0.22)) - R * 0.40;
    cap = mix(cap, smin(cap, lobe, R * 0.25), m);
    float under = (length((c + vec2(0.0, R * 0.62)) / vec2(R * 0.42, R * 0.38)) - 1.0) * R * 0.38;
    cap = mix(cap, max(cap, -under), m);
    float top = (H - R * 0.3) * smoothstep(1.5, 12.0, e);
    float sr = R * 0.15 * (1.0 + 1.6 * exp(-max(q.y, 0.0) / max(0.35 * H, 0.2))) * m;
    float stem = max(abs(q.x) - sr, max(-q.y, q.y - top));
    float sw = max(0.0, 1.2 + 0.32 * (e - 4.0)) * smoothstep(4.0, 7.0, e);
    float surge = (length(vec2(q.x / max(sw, 0.05), q.y / 0.6)) - 1.0) * 0.6;
    return min(smin(cap, stem, R * 0.35), surge);
  }

  /** The cloud for true-world direction d, as colour (not premultiplied) and coverage. */
  vec4 mushroom(vec3 d) {
    float e = gE;
    if (e <= 0.0) return vec4(0.0);
    vec2 to = gGZ - gCamW;
    vec2 fwd = to / max(length(to), 1.0);
    vec2 side = vec2(fwd.y, -fwd.x);
    float k = dot(d.xz, fwd);
    if (k < 0.15) return vec4(0.0);
    vec2 q = vec2(dot(d.xz, side), d.y) / k * (length(to) * 0.001);
    q.y += 0.12;   // the eye rides about 120 m over the cloud tops

    float H = capH(e), R = capR(e);
    float wide = max(R * 1.35, 1.2 + 0.32 * max(e - 4.0, 0.0));
    if (abs(q.x) > wide + 0.8 || q.y > H + R * 1.3 + 0.6 || q.y < -0.3) return vec4(0.0);

    float m = smoothstep(2.0, 9.0, e);
    vec2 c = q - vec2(0.0, H);
    float capW = smoothstep(H - R * 1.6, H - R * 0.6, q.y);

    // Billows: rolled round the lobes as the torus turns over, climbing in the stem.
    float sx = q.x < 0.0 ? -1.0 : 1.0;
    vec2 lob = rot(e * 0.06) * vec2(abs(q.x) - R * 0.6, c.y + R * 0.15);
    vec2 nq = mix(q - vec2(0.0, e * 0.09), vec2(sx * (lob.x + R * 0.6), lob.y - R * 0.15 + H), capW);
    float n = fbm(nq * (1.7 / max(R, 0.6)) + vec2(4.1, 1.7));
    float n2 = vnoise(nq * 6.5 + vec2(e * 0.05, 0.0));
    float n3 = vnoise(nq * 15.0 - vec2(0.0, e * 0.04));

    float f0 = cloudField(q, e, H, R, m);
    float body = f0 + (n - 0.5) * R * 0.55 + (n2 - 0.5) * 0.22 + (n3 - 0.5) * 0.09;
    float a = smoothstep(0.12, -0.28, body);

    // Lit from the sun through a pseudo-normal: the field's slope without its billows.
    vec2 g = vec2(cloudField(q + vec2(0.06, 0.0), e, H, R, m) - f0, cloudField(q + vec2(0.0, 0.06), e, H, R, m) - f0);
    vec2 sunQ = normalize(vec2(dot(gSunW.xz, side), gSunW.y) + 1e-4);
    float lambert = clamp(0.35 + 0.65 * dot(normalize(g + 1e-6), sunQ), 0.0, 1.0);
    float deep = clamp(-body / (R * 0.6), 0.0, 1.0);
    vec3 smoke = mix(vec3(0.52, 0.46, 0.40), vec3(0.34, 0.29, 0.26), capW);
    vec3 amb = mix(gHorizon, gZenith, 0.5);
    vec3 col = smoke * (amb * (0.35 + 0.5 * n + 0.3 * n3) + gSunCol * 0.13 * lambert * lambert * max(gSunW.y + 0.15, 0.1) * (1.0 - 0.6 * deep));

    // Heat: a fire first, then a glow in the cap's heart and under it for most of a minute.
    float heat = exp(-e / 6.0);
    float core = length(c / vec2(R, R * mix(1.0, 0.56, m)));
    vec3 fire = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.86, 0.6), heat);
    float glow = exp(-core * core * 2.2) * (heat * 9.0 + 0.9 * exp(-e / 26.0) * capW);
    glow += 0.55 * exp(-e / 30.0) * smoothstep(0.0, -R * 0.6, c.y) * capW * (1.0 - smoothstep(0.0, R * 0.7, abs(c.x) - R * 0.35));
    col += fire * glow * (0.6 + 0.6 * n);
    col = mix(col, vec3(1.0, 0.92, 0.75) * 14.0, exp(-e / 0.7));

    // The pileus: a smooth ice cap riding the top while the updraught is strong.
    float pf = smoothstep(6.0, 9.0, e) * (1.0 - smoothstep(18.0, 26.0, e));
    if (pf > 0.0) {
      vec2 pc = (q - vec2(0.0, H + R * 0.62 + 0.25)) / vec2(R * 1.15, R * 0.09 + 0.05);
      float pa = smoothstep(1.0, 0.55, length(pc)) * pf * 0.8;
      col = mix(col, vec3(0.95, 0.96, 1.0) * (amb + gSunCol * 0.1 * max(gSunW.y, 0.2)), pa * (1.0 - 0.5 * a));
      a = max(a, pa);
    }

    // The condensation ring: a shell of cloud flickering round the fireball.
    float cf = smoothstep(0.4, 0.8, e) * (1.0 - smoothstep(2.0, 3.6, e));
    if (cf > 0.0) {
      float x = (length(c) - R * (1.15 + 0.9 * (e - 0.4))) / 0.09;
      float ra = exp(-x * x) * cf * 0.6;
      col = mix(col, vec3(1.0), ra);
      a = max(a, ra);
    }

    // 16 km of air between here and there.
    col = mix(col, gHorizon * 0.9, 0.2);
    return vec4(col, a);
  }

  /** The shockfront crossing the cloud sea, at true-world point p (metres). */
  vec3 seaShock(vec2 p, vec3 col, float detail) {
    if (gE <= 0.0) return col;
    float r = length(p - gGZ);
    float front = FRONT_SPEED * gE;
    float x = (r - front) / 500.0;
    float ring = exp(-x * x) * (1.0 - smoothstep(GZ_DIST * 0.9, GZ_DIST * 1.3, front));
    float behind = smoothstep(front + 400.0, front - 1500.0, r);
    col = mix(col, col * vec3(0.75, 0.66, 0.58) + vec3(0.05, 0.035, 0.02), behind * 0.7);
    return col + vec3(1.0, 0.92, 0.82) * ring * (1.3 + 0.8 * detail);
  }
`
