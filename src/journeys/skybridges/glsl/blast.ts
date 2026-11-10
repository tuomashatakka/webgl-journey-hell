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

  /**
   * The double flash. A spike from the bare fireball that its own shock cuts
   * off within a few hundredths of a second, a dip that reads as the picture
   * stuttering, and then the long second maximum as the fireball breaks through
   * the shock. Both are pulses, never steps, or the whole run stays blown out.
   */
  float flashFirst(float e) { return e < 0.0 ? 0.0 : exp(-e / 0.03); }
  float flashSecond(float e) {
    return e < 0.0 ? 0.0 : smoothstep(0.05, 0.18, e) * exp(-max(e - 0.18, 0.0) / 0.38);
  }

  /** The white-out on the picture. */
  float blastFlash(float e) {
    return clamp(max(flashFirst(e), 0.93 * flashSecond(e)), 0.0, 1.0);
  }

  /** What the fireball throws on everything, colour times intensity. */
  vec3 blastLight(float e) {
    if (e < 0.0) return vec3(0.0);
    float i = 30.0 * flashFirst(e) + 34.0 * flashSecond(e) + 6.0 * exp(-e / 2.8) + 1.1 * exp(-e / 14.0);
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
    float sr = R * 0.19 * (1.0 + 1.6 * exp(-max(q.y, 0.0) / max(0.35 * H, 0.2))) * m;
    float stem = max(abs(q.x) - sr, max(-q.y, q.y - top));
    float sw = max(0.0, 1.2 + 0.32 * (e - 4.0)) * smoothstep(4.0, 7.0, e);
    float surge = (length(vec2(q.x / max(sw, 0.05), q.y / 0.6)) - 1.0) * 0.6;
    return min(smin(cap, stem, R * 0.35), surge);
  }

  /**
   * The cloud as a reflection sees it: the same field and the same heat, none
   * of the billow lighting. It is inlined wherever glass reflects the sky, so
   * it has to be cheap; the view ray gets mushroom() once per pixel instead.
   */
  vec4 mushroomLite(vec3 d) {
    float e = gE;
    if (e <= 0.0) return vec4(0.0);
    vec2 to = gGZ - gCamW;
    vec2 fwd = to / max(length(to), 1.0);
    float k = dot(d.xz, fwd);
    if (k < 0.15) return vec4(0.0);
    vec2 q = vec2(dot(d.xz, vec2(fwd.y, -fwd.x)), d.y) / k * (length(to) * 0.001);
    q.y += 0.12;
    float H = capH(e), R = capR(e);
    float wide = max(R * 1.35, 1.2 + 0.32 * max(e - 4.0, 0.0));
    if (abs(q.x) > wide + 0.8 || q.y > H + R * 1.3 + 0.6 || q.y < -0.3) return vec4(0.0);
    float m = smoothstep(2.0, 9.0, e);
    float n = fbm(q * (1.7 / max(R, 0.6)) + vec2(4.1, 1.7 - e * 0.05));
    float body = cloudField(q, e, H, R, m) + (n - 0.5) * R * 0.55;
    vec2 c = q - vec2(0.0, H);
    float core = length(c / vec2(R, R * mix(1.0, 0.56, m)));
    vec3 col = vec3(0.42, 0.33, 0.27) * mix(gHorizon, gZenith, 0.5) * (0.5 + 0.6 * n);
    col += mix(vec3(1.0, 0.30, 0.06), vec3(1.0, 0.86, 0.6), exp(-e / 6.0)) * exp(-core * core * 2.2) * (9.0 * exp(-e / 6.0) + 0.6 * exp(-e / 26.0));
    col = mix(col, vec3(1.0, 0.92, 0.75) * 14.0, exp(-e / 0.7));
    return vec4(mix(col, gHorizon * 0.9, 0.2), smoothstep(0.06, -0.20, body));
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
    // The stem is an updraught: its texture is drawn out upwards, in streaks.
    vec2 nq = mix(vec2(q.x * 1.6, (q.y - e * 0.09) * 0.45), vec2(sx * (lob.x + R * 0.6), lob.y - R * 0.15 + H), capW);
    float n = fbm(nq * (1.7 / max(R, 0.6)) + vec2(4.1, 1.7));
    float n2 = vnoise(nq * 6.5 + vec2(e * 0.05, 0.0));
    float n3 = vnoise(nq * 15.0 - vec2(0.0, e * 0.04));
    // The two lobes are mirrored, and a mirror is a crease: along the middle the
    // billows fade over to an unmirrored field so the cap has no seam down it.
    float mid = (1.0 - smoothstep(0.0, R * 0.3, abs(q.x))) * capW;
    if (mid > 0.0) {
      vec2 uq = q + vec2(5.3, -e * 0.07);
      n  = mix(n,  fbm(uq * (1.7 / max(R, 0.6)) + vec2(4.1, 1.7)), mid);
      n2 = mix(n2, vnoise(uq * 6.5 + vec2(e * 0.05, 0.0)), mid);
    }

    // Cauliflower: rounded turrets, not fur. A ridged term is a field of domes
    // whose seams are sharp, which is what convection looks like from 16 km.
    float tur = 1.0 - abs(2.0 * vnoise(nq * 3.4 + vec2(1.3, e * 0.035)) - 1.0);

    float f0 = cloudField(q, e, H, R, m);
    float body = f0 + (n - 0.5) * R * 0.55 + (n2 - 0.5) * 0.22 + (n3 - 0.5) * 0.09 - tur * 0.08 * min(R, 2.0);
    float a = smoothstep(0.06, -0.20, body);

    // Lit from the sun through a pseudo-normal: the field's slope without its billows.
    vec2 g = vec2(cloudField(q + vec2(0.06, 0.0), e, H, R, m) - f0, cloudField(q + vec2(0.0, 0.06), e, H, R, m) - f0);
    vec2 sunQ = normalize(vec2(dot(gSunW.xz, side), gSunW.y) + 1e-4);
    float lambert = clamp(0.35 + 0.65 * dot(normalize(g + 1e-6), sunQ), 0.0, 1.0);
    float deep = clamp(-body / (R * 0.6), 0.0, 1.0);
    // Each turret lit on its sun side and shadowed on the other: the billow
    // noise read again a step towards the sun.
    float nt = vnoise(nq * 6.5 + vec2(e * 0.05, 0.0) + sunQ * 0.09);
    float self = mix(0.6, clamp(0.55 + (n2 - nt) * 3.0 + (tur - 0.5) * 0.5, 0.0, 1.0), 0.35 + 0.65 * capW);
    // Nitrogen dioxide: a real cap is rust-red for its first half minute.
    float no2 = 0.6 * smoothstep(3.0, 9.0, e) * (1.0 - smoothstep(28.0, 60.0, e));
    vec3 smoke = mix(vec3(0.50, 0.44, 0.39), vec3(0.30, 0.25, 0.22), capW) * mix(vec3(1.0), vec3(1.0, 0.62, 0.42), no2);
    vec3 amb = mix(gHorizon, gZenith, 0.5);
    vec3 col = smoke * (amb * (0.25 + 0.45 * n + 0.35 * self) + gSunCol * 0.15 * lambert * lambert * (0.4 + 0.6 * self) * max(gSunW.y + 0.15, 0.1) * (1.0 - 0.6 * deep));
    col *= 1.0 - 0.5 * deep * (1.0 - self);

    // Heat: a fire first, then a glow in the cap's heart and under it for most of a minute.
    float heat = exp(-e / 6.0);
    float core = length(c / vec2(R, R * mix(1.0, 0.56, m)));
    vec3 fire = mix(vec3(1.0, 0.30, 0.06), vec3(1.0, 0.86, 0.6), heat);
    // The fireball is not a lamp: it boils. Bright cells between dark seams, and
    // soot blooming over it as it cools, until what is left is a burning sponge.
    float cells = smoothstep(0.25, 0.80, n2) * (0.6 + 0.8 * n3);
    float soot = smoothstep(1.0, 7.0, e) * smoothstep(0.55, 0.30, n + 0.25 * (n3 - 0.5));
    float glow = exp(-core * core * 2.2) * (heat * 9.0 * mix(1.0, 0.25 + 1.4 * cells, smoothstep(0.3, 1.5, e)) + 0.9 * exp(-e / 26.0) * capW);
    glow *= 1.0 - 0.85 * soot;
    // Under the cap: incandescent veins showing through gaps in the smoke.
    float veins = smoothstep(0.42, 0.18, n3) * smoothstep(0.0, -R * 0.5, c.y) * capW;
    glow += (0.55 + 1.6 * veins) * exp(-e / 30.0) * smoothstep(0.0, -R * 0.6, c.y) * capW * (1.0 - smoothstep(0.0, R * 0.7, abs(c.x) - R * 0.35));
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

  /**
   * The pressure wave, seen: a wall of dust, spray and torn cloud rolling over
   * the cloud sea on the shockfront, with a white condensation crest riding it
   * while the air is still wet. It stands tall near ground zero and is about
   * as high as the bridges by the time it reaches them. d is a true-world
   * direction from eye height camY; sets gWallT to how far away it stands.
   */
  vec4 shockWall(vec3 d, float camY) {
    gWallT = 1e9;
    if (gE <= 0.0) return vec4(0.0);
    float R = FRONT_SPEED * gE;
    vec2 oc = gCamW - gGZ;
    float cc = dot(oc, oc) - R * R;
    if (cc < 0.0) return vec4(0.0);                 // it has passed: the camera is inside it
    float a2 = max(dot(d.xz, d.xz), 1e-6);
    float b = dot(oc, d.xz);
    float disc = b * b - a2 * cc;
    if (disc < 0.0 || b > 0.0) return vec4(0.0);
    float t = (-b - sqrt(disc)) / a2;
    if (t <= 0.0) return vec4(0.0);

    vec2 pw = gCamW + d.xz * t;
    float y = camY + d.y * t - SEA_Y;                 // metres above the cloud tops
    vec2 rel = pw - gGZ;
    float s = atan(rel.y, rel.x) * R;                 // metres along the front
    float hw = 330.0 + 1700.0 * exp(-R / 5000.0);
    float n = fbm(vec2(s / 260.0, y / 160.0 - gE * 0.8));
    float n2 = vnoise(vec2(s / 55.0, y / 40.0 - gE * 2.2));
    float top = hw * (0.70 + 0.55 * n);
    float cov = smoothstep(top, top * 0.72, y) * step(-20.0, y);
    cov *= 0.55 + 0.45 * smoothstep(0.25, 0.6, n + 0.3 * n2);
    if (cov <= 0.001) return vec4(0.0);

    // Lit by the day in front and by the fireball through it from behind.
    vec3 amb = mix(gHorizon, gZenith, 0.4);
    float hgt = clamp(y / max(top, 1.0), 0.0, 1.0);
    // Its face is towards the camera and away from the fireball: a dark, lumpy
    // backlit thing, lighter where it billows.
    vec3 col = vec3(0.28, 0.23, 0.19) * (amb * (0.45 + 0.8 * n2 * n) + gSunCol * 0.05 * max(gSunW.y, 0.1));
    col += gBlastCol * vec3(1.0, 0.55, 0.3) * 0.012 * smoothstep(0.55, 1.0, hgt) * (1.0 - cov * 0.6);
    // The crest: condensation where the pressure drops behind the front.
    float wet = 1.0 - smoothstep(4.0, 9.0, gE);
    float crest = smoothstep(0.62, 0.92, hgt) * (0.5 + 0.5 * n2);
    col = mix(col, vec3(1.0, 0.98, 0.96) * (amb + gSunCol * 0.08 + 0.15), crest * (0.35 + 0.5 * wet));
    // Its foot: the sea torn into spray where it is being lifted.
    col = mix(col, vec3(0.95, 0.93, 0.9) * (amb + 0.1), smoothstep(40.0, 0.0, y) * 0.5);

    col = mix(col, gHorizon * 0.9, 0.6 * (1.0 - exp(-t / 7000.0)));
    gWallT = t;
    return vec4(col, cov);
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
