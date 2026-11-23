export const concourseGlsl = `  // ---- the concourse, dressed ----------------------------------------------
  //
  // Everything here is shading, evaluated once at the hit. The geometry and the
  // sun's way in are in the rooms pass (concourseProps, mallSun); this is what
  // the galleria is made of and what is still switched on in it.
  //
  // No derivatives and no mip chain, so every pattern carries the distance and
  // goes to its mean before it can shimmer: a line widens as it fades, a row of
  // lettering becomes a grey bar, a shelf of stock becomes a glow.
  //
  // Noise is budgeted: the shell and the props each take one weathering field
  // ('wx', four octaves) and one grain ('gr', one octave) at the top and hand
  // them down, so a hit costs two lookups whatever it turns out to be.

  /** The colour of the concourse's sun: deeper than the chapel's gold, greyer by the lap. */
  vec3 mallSunTint() {
    return mix(vec3(1.00, 0.60, 0.32), vec3(0.70, 0.47, 0.44), uAtm.y * 0.6);
  }

  /** A line on every multiple of 'cell', as coverage: 1 on the line. */
  float mallLine(float x, float cell, float hw, float t) {
    float w = hw + t * 0.0014;
    return smoothstep(w, w * 0.4, abs(latt(x + 0.5 * cell, cell)));
  }

  /** Whether a bay's shop has its lights on: about one in three, fewer by the lap, one in four of those flickering. */
  float mallShopLit(float id, float side, float lit) {
    float h    = hash21(vec2(id, side * 17.0 + 3.0));
    float live = step(0.68, h) * step(hash21(vec2(id, side * 7.0 + 1.0)), 0.30 + 0.70 * lit);
    float buzz = step(0.75, fract(h * 17.0)) * step(0.55, hash21(vec2(floor(iTime * 11.0), h * 91.0)));
    return live * (0.45 + 0.55 * lit) * (1.0 - 0.6 * buzz);
  }

  /** ...and the colour of them: tungsten, mint or pink. */
  vec3 mallShopTint(float id, float side) {
    float k = hash21(vec2(id, side * 5.0 + 23.0));
    if (k < 0.40) return vec3(1.00, 0.84, 0.60);
    if (k < 0.75) return vec3(0.62, 0.95, 0.90);
    return vec3(1.00, 0.52, 0.72);
  }

  /** A downlight in the arcade ceiling, one every 2.5 m: on or not, and how bright. */
  float mallDownlight(float zp, float side, float lit) {
    return step(hash21(vec2(floor(zp / 2.5), side * 5.0 + 11.0)), 0.22 + 0.50 * lit) * (0.4 + 0.6 * lit);
  }

  /**
   * Lettering nobody can read: a row of blocks, most with a corner bitten out
   * and some with a counter punched through. 'p' is in letter cells across and
   * 0..1 up the line; 'n' is how many letters stand either side of the middle.
   */
  float mallGlyphs(vec2 p, float n, float seed) {
    float cell = floor(p.x);
    if (abs(cell + 0.5) > n || p.y < 0.0 || p.y > 1.0) return 0.0;

    float h  = hash21(vec2(cell, seed));
    vec2  g  = vec2(fract(p.x) - 0.5, p.y - 0.5);
    float on = step(abs(g.x), 0.36) * step(0.10, h);
    vec2  qd = vec2(h > 0.55 ? 1.0 : -1.0, fract(h * 7.3) > 0.5 ? 1.0 : -1.0);
    on *= 1.0 - step(0.08, g.x * qd.x) * step(0.10, g.y * qd.y);
    on *= 1.0 - step(abs(g.x), 0.12) * step(abs(g.y), 0.16) * step(0.6, fract(h * 3.1));
    return on;
  }

  /**
   * The carpet. The floor is the point of this room: a print in colours nobody
   * has chosen since, lozenges and squiggles on a 1.25 m repeat with a pip on
   * every corner, bordered where it meets the track and the arcades.
   */
  vec3 mallCarpet(vec2 uv, float t, float grime, float wx, float gr) {
    const vec3 plum    = vec3(0.27, 0.15, 0.40);
    const vec3 crimson = vec3(0.80, 0.22, 0.38);
    const vec3 teal    = vec3(0.12, 0.55, 0.56);
    const vec3 mustard = vec3(0.92, 0.70, 0.22);

    // The pile blurs every edge and distance blurs it further. Seen this flat,
    // a pixel is a metre long by thirty metres out, so the print is its mean
    // well before that and only the borders, which run with the view, go on.
    float w    = 0.02 + t * 0.006;
    float keep = smoothstep(44.0, 12.0, t);

    vec2  cc  = uv / 1.25;
    vec2  id  = floor(cc);
    vec2  f   = fract(cc) - 0.5;
    float odd = mod(id.x + id.y, 2.0);

    float dia  = abs(f.x) + abs(f.y);
    float loz  = smoothstep(w, -w, dia - 0.40) * (1.0 - odd);
    float eye  = smoothstep(w, -w, dia - 0.17) * (1.0 - odd);
    float wave = smoothstep(w, -w, abs(f.y - 0.13 * sin(f.x * 12.566)) - 0.045)
               * smoothstep(w, -w, abs(f.x) - 0.40) * odd;
    float pip  = smoothstep(w, -w, max(0.5 - abs(f.x), 0.5 - abs(f.y)) - 0.09);

    vec3 c = mix(plum, crimson, loz);
    c = mix(c, teal, max(eye, pip));
    c = mix(c, mustard, wave);
    c = mix(vec3(0.354, 0.203, 0.401), c, keep);

    // The borders: a dark band with a mustard pinstripe, beside the ballast and
    // along the foot of the columns.
    float ax   = abs(uv.x);
    float wb   = 0.02 + t * 0.003;
    float band = max(smoothstep(wb, -wb, abs(ax - 1.50) - 0.20), smoothstep(wb, -wb, abs(ax - 6.02) - 0.20));
    float pin  = max(smoothstep(wb, 0.0, abs(ax - 1.78) - 0.02), smoothstep(wb, 0.0, abs(ax - 5.74) - 0.02));
    c = mix(c, vec3(0.110, 0.075, 0.160), band);
    c = mix(c, mustard * 0.85, pin * smoothstep(60.0, 20.0, t));

    // Twenty years of feet and whatever came through the roof.
    c *= 1.0 - (0.22 + 0.38 * grime) * smoothstep(0.45, 0.80, wx);
    c *= 1.0 + 0.24 * (gr - 0.5) * smoothstep(16.0, 4.0, t);
    return c;
  }

  /**
   * One shop's glazing, by what has become of the shop: a roller shutter with a
   * notice on it, dark glass with one taped inside, or the lights left on over
   * stock nobody came back for. 'p' is across the bay and up from the sill.
   */
  vec3 mallWindow(vec2 p, vec2 size, float h, float on, vec3 tint, float t, float wx, out float rough, out vec3 emit) {
    emit  = vec3(0.0);
    rough = 0.30;

    float fine = smoothstep(32.0, 9.0, t);

    // The frame, and the stiles of a door in the middle of anything with glass.
    float edge = min(size.x - abs(p.x), min(p.y, size.y - p.y));
    if (edge < 0.06 || (h > 0.40 && abs(abs(p.x) - 0.62) < 0.025))
      return vec3(0.40, 0.41, 0.43);

    if (h < 0.40) {
      vec2 np = p - vec2((fract(h * 91.0) - 0.5) * 2.0, size.y * 0.55);
      if (abs(np.x) < 0.30 && abs(np.y) < 0.21) {
        rough = 0.85;
        float line = step(abs(fract(np.y / 0.10) - 0.5), 0.22) * step(abs(np.x), 0.22);
        return mix(vec3(0.78, 0.75, 0.68), vec3(0.20, 0.19, 0.20), line * fine * 0.8);
      }

      float slat = mix(0.80, 0.58 + 0.42 * smoothstep(0.0, 0.55, fract(p.y / 0.09)), fine);
      rough = 0.42;
      return vec3(0.36, 0.38, 0.40) * slat * (0.70 + 0.45 * wx);
    }

    if (on < 0.01) {
      vec2 np = p - vec2(0.0, size.y * 0.52);
      if (fract(h * 31.0) > 0.45 && abs(np.x) < 0.46 && abs(np.y) < 0.30) {
        rough = 0.85;
        float bar = step(abs(np.y - 0.06), 0.09) * step(abs(np.x), 0.34);
        return mix(vec3(0.80, 0.78, 0.72), vec3(0.62, 0.10, 0.10), bar * (0.3 + 0.7 * fine));
      }

      rough = 0.07;
      emit  = vec3(0.010, 0.013, 0.018);
      return vec3(0.022, 0.026, 0.032);
    }

    // Shelves, and a block of colour for everything still on them.
    vec2  sc    = vec2(p.x / 0.24, p.y / 0.46);
    float stock = hash21(floor(sc) + h * 57.0);
    float shelf = step(0.14, fract(sc.y));
    float prod  = mix(0.62, (0.30 + 0.70 * stock) * shelf + 0.10 * (1.0 - shelf), fine);
    vec3  dye   = mix(vec3(1.0), hue(stock * 9.0 + h * 3.0), 0.45 * fine);

    rough = 0.10;
    emit  = tint * dye * prod * (0.55 + 0.45 * p.y / size.y) * on * 1.15;
    return vec3(0.030, 0.035, 0.040);
  }

  /** The arcade's ceiling and the underside of the gallery: lay-in tiles and downlights. */
  vec3 mallSoffit(vec3 q, float t, Room r, float wx, out vec3 emit) {
    float zp   = phaseAt(q.z);
    float side = q.x < 0.0 ? -1.0 : 1.0;
    vec2  uv   = vec2(abs(q.x), zp);

    float grid  = max(mallLine(uv.x, 0.625, 0.012, t), mallLine(uv.y, 0.625, 0.012, t)) * smoothstep(40.0, 10.0, t);
    float gone  = step(hash21(floor(uv / 0.625) + side * 31.0), 0.04 + r.grime * 0.08);
    float stain = smoothstep(0.50, 0.85, wx);

    vec3 c = mix(vec3(0.70, 0.68, 0.66), vec3(0.42, 0.34, 0.24), stain * (0.3 + r.grime));
    c = mix(c, vec3(0.30, 0.29, 0.29), grid);
    c = mix(c, vec3(0.035, 0.030, 0.030), gone);

    emit = vec3(1.00, 0.84, 0.62) * 3.2 * mallDownlight(zp, side, r.lit)
         * smoothstep(0.15, 0.11, length(vec2(abs(q.x) - 8.7, latt(zp, 2.5))));
    return c;
  }

  /**
   * What a pane of the clerestory lets in. The east side shows the sky the sun
   * is leaving, horizon at the sill and zenith at the head. The west side is
   * the sun itself in twenty years of dust, hotter the nearer the line of sight
   * runs to it. The eye is on the track, which is all a pane needs to know.
   */
  vec3 mallPane(vec3 q, float hy) {
    float up      = smoothstep(MALL_WIN_Y0, MALL_WIN_Y1, hy);
    vec3  zenith  = mix(vec3(0.30, 0.20, 0.56), vec3(0.11, 0.08, 0.20), uAtm.y * 0.7);
    vec3  horizon = mix(vec3(1.00, 0.56, 0.62), vec3(0.58, 0.30, 0.38), uAtm.y * 0.7);
    vec3  sky     = mix(horizon, zenith, up * 0.85);

    if (q.x > 0.0) {
      float glare = max(dot(normalize(q - vec3(0.0, uCart.w, 0.0)), MALL_SUN), 0.0);
      sky = sky * 0.6 + mallSunTint() * (1.5 + 2.6 * glare * glare * glare);
    }
    return sky;
  }

  /**
   * The concourse's shell: the carpet and the arcade floors, the shopfronts at
   * the back of the arcades, and the vault from the gallery up - the upper
   * shops, the clerestory, the crown and the lamps let into it.
   */
  vec3 mallShell(vec3 q, vec3 n, Room r, float t, out float rough, out vec3 emit) {
    rough = 0.85;
    emit  = vec3(0.0);

    float ax   = abs(q.x);
    float zp   = phaseAt(q.z);
    float side = q.x < 0.0 ? -1.0 : 1.0;
    float hy   = q.y - MALL_ARCH_Y;
    float wx   = fbm(vec2(zp * 0.8 + side * 7.0, (q.y + ax) * 0.8));
    float gr   = vnoise(vec2(zp, q.y + q.x) * 24.0);

    // The front, from the void: precast panels, and nothing else for four
    // hundred metres in every direction.
    if (abs(n.z) > 0.7) {
      vec3  c     = vec3(0.34, 0.31, 0.32) * (0.80 + 0.35 * wx);
      float joint = max(mallLine(q.y, 2.5, 0.02, t), mallLine(q.x, 5.0, 0.02, t));
      return mix(c, c * 0.45, joint * smoothstep(60.0, 15.0, t));
    }

    if (n.y > 0.5 && q.y < 0.0) {
      if (ax < MALL_GAL_X + 0.15) {
        rough = 0.95;
        return mallCarpet(vec2(q.x, zp), t, r.grime, wx, gr);
      }

      // Under the galleries the floor is terrazzo, with a brass strip where the
      // carpet stops.
      vec2  uv    = vec2(ax, zp);
      float joint = max(mallLine(uv.x, 0.625, 0.008, t), mallLine(uv.y, 0.625, 0.008, t)) * smoothstep(34.0, 8.0, t);
      vec3  c     = vec3(0.50, 0.47, 0.45) * (0.82 + 0.36 * gr * smoothstep(20.0, 5.0, t));
      c = mix(c, vec3(0.24, 0.22, 0.22), joint);
      c = mix(c, vec3(0.62, 0.48, 0.22), smoothstep(0.05, 0.03, abs(ax - MALL_GAL_X - 0.20)));
      rough = 0.32;
      return c * (1.0 - r.grime * 0.45 * smoothstep(0.40, 0.80, wx));
    }

    float sz = latt(zp + 2.5, MALL_BAY);
    float id = floor((zp + 2.5) / MALL_BAY);

    if (hy < 0.3) {
      if (n.y < -0.5) return mallSoffit(q, t, r, wx, emit);

      // A shopfront to a bay: a tiled pier, a stall riser, the glazing, and a
      // sign box on the fascia over it.
      float h  = hash21(vec2(id, side * 17.0 + 3.0));
      float on = mallShopLit(id, side, r.lit);

      if (abs(sz) > 2.20) {
        float joint = mallLine(q.y + 0.55, 0.30, 0.008, t) * smoothstep(30.0, 8.0, t);
        rough = 0.50;
        return mix(vec3(0.66, 0.60, 0.56), vec3(0.34, 0.30, 0.29), joint)
             * (1.0 - r.grime * 0.4 * wx);
      }
      if (q.y < -0.27) {
        rough = 0.45;
        return vec3(0.085, 0.080, 0.088);
      }
      if (q.y > 1.98) {
        vec2 sp = vec2(sz, q.y - 2.08);
        if (abs(sz) > 1.85 || sp.y < 0.0 || sp.y > 0.44) {
          rough = 0.50;
          return vec3(0.13, 0.12, 0.13);
        }

        float gl   = mallGlyphs(vec2(sz / 0.26, (sp.y - 0.10) / 0.24), 2.0 + floor(4.0 * fract(h * 13.7)), id + side * 3.0);
        vec3  face = hue(h * 9.0 + side);
        gl = mix(0.30 * step(abs(sp.y - 0.22), 0.12), gl, smoothstep(40.0, 12.0, t));

        rough = 0.32;
        if (on > 0.01) {
          emit = (face * 0.55 + vec3(1.00, 0.96, 0.90) * gl * 1.6) * on;
          return vec3(0.05);
        }
        return mix(face * 0.16 + 0.03, vec3(0.50, 0.48, 0.46), gl * 0.8);
      }
      return mallWindow(vec2(sz, q.y + 0.27), vec2(2.20, 2.25), h, on, mallShopTint(id, side), t, wx, rough, emit);
    }

    // The crown: plaster panels, the stains under every leak, and a lamp let
    // into it wherever the room hands one out.
    if (hy > MALL_WIN_Y1) {
      if (length(q - lampPos(q, r)) < 0.74) {
        emit  = lampTint(r.type) * 4.0 * r.lit;
        rough = 0.40;
        return vec3(0.90, 0.92, 0.95);
      }

      vec3  c     = vec3(0.76, 0.72, 0.70) * (0.94 + 0.12 * gr);
      float joint = max(mallLine(zp, 2.5, 0.012, t), mallLine(q.x, 1.3, 0.012, t)) * smoothstep(44.0, 12.0, t);
      float leak  = smoothstep(0.45, 0.80, wx);
      c = mix(c, c * 0.55, joint);
      return mix(c, c * vec3(0.50, 0.42, 0.34), leak * (0.3 + r.grime * 0.7));
    }

    // The clerestory: three lights high, a mullion every 1.25 m, bronze frames.
    if (hy > MALL_WIN_Y0) {
      float bar   = min(min(abs(hy - MALL_WIN_T0), abs(hy - MALL_WIN_T1)), min(hy - MALL_WIN_Y0, MALL_WIN_Y1 - hy));
      float wide  = 0.05 + t * 0.0014;
      float frame = max(mallLine(zp, 1.25, 0.04, t), smoothstep(wide, wide * 0.5, bar));

      // Every pane has weathered on its own, and a few have been boarded over.
      float row  = step(MALL_WIN_T0, hy) + step(MALL_WIN_T1, hy);
      float ph   = hash21(vec2(floor(zp / 1.25), row + side * 5.0));
      float tone = (0.80 + 0.20 * ph) * (1.0 - 0.75 * step(ph, 0.05 + r.grime * 0.10));
      float dirt = 0.72 + 0.28 * wx;

      emit  = mallPane(q, hy) * (1.0 - frame) * tone * dirt;
      rough = mix(0.12, 0.50, frame);
      return mix(vec3(0.030, 0.034, 0.040), vec3(0.10, 0.09, 0.085), frame);
    }

    // The gallery's wall: the upper shops, and over them the two stripes every
    // mall of this age was given.
    vec2 wp = vec2(sz, q.y - MALL_GAL_Y - 0.12);
    if (abs(sz) < 1.95 && wp.y > 0.0 && wp.y < 1.60) {
      float h = hash21(vec2(id, side * 17.0 + 41.0));
      return mallWindow(wp, vec2(1.95, 1.60), h, step(0.74, h) * (0.45 + 0.55 * r.lit),
                        mallShopTint(id + 50.0, side), t, wx, rough, emit);
    }

    vec3 c = vec3(0.74, 0.67, 0.61) * (0.94 + 0.12 * gr);
    c = mix(c, vec3(0.10, 0.42, 0.44), smoothstep(0.08, 0.06, abs(q.y - 5.42)));
    c = mix(c, vec3(0.62, 0.18, 0.32), smoothstep(0.04, 0.025, abs(q.y - 5.60)));

    // Water has been coming down from the sill of the glazing for years.
    float run = smoothstep(0.52, 0.86, fbm(vec2(zp * 1.9, q.y * 0.22) + side * 3.0)) * smoothstep(3.6, 5.9, q.y);
    return mix(c, c * vec3(0.42, 0.36, 0.30), run * (0.35 + r.grime * 0.6));
  }

  /**
   * Everything standing in the concourse, recognised by where it is: the
   * lunette over the way in, the ribs, the gallery and its balustrade, the
   * escalators, the columns, and the palms and benches on the hall floor.
   */
  vec3 mallProp(vec3 q, vec3 n, Room r, float t, out float rough, out vec3 emit) {
    rough = 0.60;
    emit  = vec3(0.0);

    float ax = abs(q.x);
    float zp = phaseAt(q.z);
    float hy = q.y - MALL_ARCH_Y;
    float rv = length(vec2(q.x, hy));
    float u  = q.z - r.z0;
    float wx = fbm(vec2(zp * 1.3, q.y * 1.3 + ax));
    float gr = vnoise(vec2(zp + ax, q.y) * 18.0);

    // The lunette: a fan of bronze glazing bars over a transom that still
    // carries the name of the place. From outside it glows with the hall.
    if (u > 1.0 && u < 1.7 && q.y > MALL_GAL_Y - 0.01 && abs(n.z) > 0.5) {
      if (q.y < MALL_GAL_Y + 0.62) {
        float gl = mallGlyphs(vec2(q.x / 0.42, (q.y - MALL_GAL_Y - 0.14) / 0.34), 7.0, 71.0);
        gl = mix(0.35, gl, smoothstep(70.0, 25.0, t));
        if (n.z < 0.0) emit = vec3(1.00, 0.30, 0.42) * gl * 1.5 * (0.4 + 0.6 * r.lit);
        rough = 0.40;
        return mix(vec3(0.070, 0.065, 0.070), vec3(0.46, 0.44, 0.44), gl * 0.5);
      }

      float wide  = 0.05 + t * 0.0014;
      float fan   = smoothstep(wide, wide * 0.4, rv * abs(latt(atan(hy, ax), 0.2618)));
      float ring  = smoothstep(wide, wide * 0.4, min(abs(rv - 2.6), abs(rv - 5.2)));
      float frame = max(max(fan, ring), step(MALL_R - 0.22, rv));

      emit  = (n.z < 0.0 ? vec3(1.00, 0.62, 0.44) * (0.74 - 0.05 * rv) * (0.70 + 0.30 * wx)
                         : vec3(0.012, 0.010, 0.022)) * (1.0 - frame);
      rough = mix(0.10, 0.50, frame);
      return mix(vec3(0.030, 0.034, 0.040), vec3(0.10, 0.09, 0.085), frame);
    }

    // A rib: white-painted steel, rusting where the glazing weeps onto it.
    if (q.y > MALL_GAL_Y + 0.01 && rv > MALL_R - 0.34 && lattAbs(zp, MALL_BAY) < 0.16) {
      float rust = smoothstep(0.40, 0.80, wx) * step(MALL_WIN_Y0, hy);
      rough = 0.45;
      return mix(vec3(0.80, 0.78, 0.75), vec3(0.42, 0.24, 0.14), rust * (0.25 + 0.5 * r.grime));
    }

    // The gallery: glass capped with a steel rail on its edge, terrazzo on
    // top, the arcade's ceiling underneath, and a fascia with a crimson band
    // between two brass trims facing the hall.
    if (ax > MALL_GAL_X - 0.02 && hy > -0.02) {
      if (q.y > MALL_GAL_Y + 0.005 && ax < MALL_GAL_X + 0.2) {
        if (q.y > MALL_GAL_Y + 1.0) {
          rough = 0.22;
          return vec3(0.60, 0.61, 0.63);
        }
        // Glass, which a single hit cannot see through: so it is drawn as what
        // glass mostly is from across a hall, a pale reflection of the far side.
        rough = 0.06;
        emit  = vec3(0.060, 0.075, 0.078) * (0.5 + 0.5 * smoothstep(MALL_GAL_Y, MALL_GAL_Y + 1.0, q.y));
        return mix(vec3(0.20, 0.27, 0.26), vec3(0.30, 0.32, 0.33), mallLine(zp, 1.25, 0.012, t));
      }
      if (n.y < -0.5) return mallSoffit(q, t, r, wx, emit);
      if (n.y > 0.5) {
        rough = 0.40;
        return vec3(0.46, 0.43, 0.41) * (0.85 + 0.30 * gr);
      }

      float trim = max(step(abs(q.y - MALL_GAL_Y + 0.05), 0.03), step(abs(hy - 0.05), 0.03));
      vec3  c    = mix(vec3(0.78, 0.74, 0.70), vec3(0.62, 0.18, 0.32), step(abs(q.y - 3.0), 0.09));
      rough = 0.50;
      return mix(c, vec3(0.62, 0.48, 0.22), trim) * (1.0 - 0.3 * r.grime * wx);
    }

    // An escalator: steps with a yellow line on every nose, brushed steel
    // skirts and a black rubber rail.
    float ez = latt(zp - 5.0, 40.0);
    float ex = ax - 5.7;
    if (abs(ex) < 0.62 && abs(ez) < 3.45) {
      float ys = q.y - (1.4125 + 0.5772 * ez);
      rough = 0.40;

      if (abs(ex) > 0.47) {
        if (ys > 0.84) return vec3(0.030, 0.030, 0.032);
        rough = 0.25;
        return ys > 0.05 ? vec3(0.46, 0.48, 0.50) * (0.85 + 0.30 * gr)
                         : vec3(0.60, 0.58, 0.56);
      }
      if (ys > -0.10 && n.y > 0.3) {
        float st = fract(ez / 0.40);
        vec3  c  = mix(vec3(0.10, 0.10, 0.11), vec3(0.06, 0.06, 0.065), smoothstep(0.1, 1.0, st));
        return mix(c, vec3(0.72, 0.60, 0.14), step(st, 0.10) * smoothstep(34.0, 10.0, t));
      }
      return vec3(0.58, 0.56, 0.55);
    }

    // A column: enamel cladding with a joint in it, a dark kick band, a brass
    // collar under the slab.
    if (ax > MALL_GAL_X) {
      vec3 c = mix(vec3(0.80, 0.77, 0.73), vec3(0.10, 0.095, 0.10), step(q.y, -0.25));
      c = mix(c, c * 0.5, step(abs(q.y - 1.05), 0.012));
      c = mix(c, vec3(0.62, 0.48, 0.22), step(2.42, q.y));
      rough = 0.30;
      return c * (1.0 - 0.25 * r.grime * wx);
    }

    // The hall floor's furniture. The palms are plastic, which is why they
    // are still green: only the tips have gone, and only to dust.
    float fx = ax - 4.2;
    float pz = latt(zp + 5.0, 10.0);
    float pr = length(vec2(fx, pz));

    if (pr < 0.70 && q.y < 0.08) {
      if (n.y > 0.5) {
        rough = 0.95;
        return mix(vec3(0.11, 0.085, 0.06), vec3(0.20, 0.16, 0.11), gr);
      }
      rough = 0.55;
      return mix(vec3(0.60, 0.56, 0.52) * (0.85 + 0.30 * wx), vec3(0.10, 0.10, 0.10), step(q.y, -0.42));
    }
    if (pr < 0.13 && q.y < 2.42) {
      rough = 0.90;
      return mix(vec3(0.30, 0.22, 0.14), vec3(0.17, 0.12, 0.08), smoothstep(0.3, 0.5, abs(fract(q.y / 0.11) - 0.5)));
    }
    if (q.y > 0.5 && pr < 2.0) {
      float fine = smoothstep(30.0, 6.0, t);
      vec3  c    = mix(vec3(0.10, 0.22, 0.08), vec3(0.22, 0.36, 0.12), mix(0.5, 0.5 + 0.5 * sin(pr * 80.0), fine));
      rough = 0.50;
      return mix(c, vec3(0.40, 0.31, 0.12), smoothstep(1.0, 1.75, pr) * (0.4 + 0.6 * r.grime));
    }
    if (q.y < 0.0 && abs(fx) < 0.30) {
      // A bench: timber slats on a block of dark laminate with a kick under it.
      if (n.y < 0.5) {
        rough = 0.35;
        return mix(vec3(0.16, 0.13, 0.12), vec3(0.045, 0.045, 0.050), step(q.y, -0.44));
      }
      float slat = step(0.10, abs(fract(fx / 0.13) - 0.5));
      return mix(vec3(0.10, 0.07, 0.05), vec3(0.44, 0.28, 0.15), slat) * (0.80 + 0.40 * gr);
    }

    // Whatever is left is the collar round the mouth.
    return vec3(0.36, 0.33, 0.34);
  }

  /**
   * How much of a crown lamp reaches a point: all of it in the hall and on the
   * galleries, and under a gallery only what gets in below the slab's edge.
   * The line to the lamp is taken in section, where it is one divide.
   */
  float mallLampShade(vec3 q, float lampY) {
    float ax = abs(q.x);
    if (ax < MALL_GAL_X || q.y > MALL_ARCH_Y) return 1.0;
    return smoothstep(0.15, -0.35, q.y + (ax - MALL_GAL_X) * (lampY - q.y) / ax - MALL_ARCH_Y);
  }

  /**
   * The concourse's light that is neither the sun nor the lamps in the crown.
   *
   * The ambient is what comes off the two clerestories - lilac from the east,
   * the sun's colour from the west, by which way a surface faces - over the
   * room's own haze, both falling away under the galleries, plus what the pool
   * on the far carpet throws back up. Returned is what the arcades are lit by
   * instead: the nearest downlight and the nearest lit shop window, each
   * windowed to nothing at the edge of its own cell so no cell edge shows.
   */
  vec3 mallFill(vec3 q, vec3 n, Room r, out vec3 amb) {
    float ax   = abs(q.x);
    float zp   = phaseAt(q.z);
    float side = q.x < 0.0 ? -1.0 : 1.0;

    float deep = smoothstep(MALL_GAL_X - 0.4, 10.6, ax) * smoothstep(MALL_ARCH_Y + 0.5, MALL_ARCH_Y - 0.1, q.y);
    vec3  skyl = mix(vec3(0.36, 0.28, 0.52), mallSunTint() * 0.80, 0.5 + 0.5 * n.x);

    amb  = (roomFog(r.type, r.grime) * 1.4 + skyl * (0.42 + 0.22 * max(n.y, 0.0))) * (1.0 - 0.80 * deep);
    amb += mallSunTint() * 0.10 * exp(-(q.x + 4.6) * (q.x + 4.6) * 0.06) * smoothstep(6.0, 0.0, q.y);

    float near = smoothstep(4.8, 6.4, ax) * step(q.y, MALL_ARCH_Y + 0.2);
    if (near < 0.001) return vec3(0.0);

    float lz = latt(zp, 2.5);
    vec3  lv = vec3(side * 8.7 - q.x, MALL_ARCH_Y - 0.03 - q.y, -lz);
    float l2 = dot(lv, lv);
    vec3  c  = vec3(1.00, 0.84, 0.62) * mallDownlight(zp, side, r.lit) * smoothstep(1.25, 0.45, abs(lz))
             * max(dot(n, lv), 0.0) / (sqrt(l2) * (0.35 + l2)) * 6.0;

    float sz = latt(zp + 2.5, MALL_BAY);
    float id = floor((zp + 2.5) / MALL_BAY);
    vec3  sv = vec3(side * 10.9 - q.x, 1.0 - q.y, -sz);
    float s2 = dot(sv, sv);
    c += mallShopTint(id, side) * mallShopLit(id, side, r.lit) * smoothstep(2.5, 1.0, abs(sz))
       * max(dot(n, sv), 0.0) / (sqrt(s2) * (1.0 + s2 * 0.12)) * 0.9;

    return c * near;
  }

`
