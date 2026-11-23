export const stationGlsl = `  // ---- the station ---------------------------------------------------------
  //
  // THE BOARDING PLATFORM's surfaces: glazed brick-bond tile on the walls and
  // round the vault, a bottle-green dado over the decks and an oxblood frieze at
  // the springing, with the water that comes through the vault running down it
  // in wet streaks; decks of small grey tile with standing water on them; and
  // the fittings: battens, poster frames, nameboards, benches, brake and chain.

  /**
   * Joints of a brick bond, 0..1, faded to their mean with range.
   *
   * Six millimetres of joint at forty metres is a fraction of a pixel, and a
   * fraction of a pixel of dark sampled once per pixel is not a joint, it is
   * moire. There is no mip chain here and ES 1.00 has no derivatives, so the
   * footprint is estimated from distance and the joint widens as it fades:
   * widening keeps the wall reading as tiled, fading stops it shimmering.
   */
  float stationBond(vec2 uv, vec2 cell, float t) {
    vec2  b = uv / cell;
    b.x    += 0.5 * mod(floor(b.y), 2.0);
    vec2  g = abs(fract(b) - 0.5) * cell;
    float w = 0.006 + t * 0.0011;
    return max(smoothstep(0.5 * cell.x - w, 0.5 * cell.x, g.x), smoothstep(0.5 * cell.y - w, 0.5 * cell.y, g.y))
         * smoothstep(40.0, 10.0, t);
  }

  /** The tile's own tone: one glaze per tile, a little different from the next. */
  float stationGlaze(vec2 uv, vec2 cell) {
    vec2 b = uv / cell;
    b.x   += 0.5 * mod(floor(b.y), 2.0);
    return hash21(floor(b) + 3.7);
  }

  /**
   * The hall's shell. The vault is unrolled round its own arc, so its courses
   * carry on from the wall's without a seam at the springing and keep their
   * size up to the crown.
   */
  vec3 stationShell(vec3 q, vec3 n, Room r, float t, out float rough) {
    float zp = phaseAt(q.z);
    float ax = abs(q.x);
    rough = 0.32;

    // The track well's floor, beside the ballast: wet concrete.
    if (n.y > 0.6) {
      rough = 0.30;
      return mix(vec3(0.16, 0.17, 0.16), vec3(0.08, 0.085, 0.08), fbm(vec2(q.x, zp) * 2.3));
    }

    // Up the wall, then round the vault from the springing.
    float spring = r.ceilH - STATION_RISE;
    float rad    = (r.bore * r.bore + STATION_RISE * STATION_RISE) / (2.0 * STATION_RISE);
    float cy     = r.ceilH - rad;
    float up     = q.y;
    if (q.y > spring && abs(n.z) < 0.7)
      up = spring + rad * (atan(r.bore, spring - cy) - atan(ax, q.y - cy));

    // The ends of the hall, round the portals, take the same tile laid square.
    vec2 uv   = abs(n.z) > 0.7 ? vec2(q.x, q.y) : vec2(zp, up);
    vec2 cell = vec2(0.24, 0.12);

    float glaze = stationGlaze(uv, cell);
    vec3  c     = mix(vec3(0.74, 0.77, 0.70), vec3(0.84, 0.85, 0.78), glaze);

    // The dado, from the deck to shoulder height, and the black line on it.
    float deckH = STATION_DECK;
    if (up < deckH + 0.66) c = mix(vec3(0.07, 0.20, 0.15), vec3(0.10, 0.27, 0.20), glaze);
    else if (up < deckH + 0.74) c = vec3(0.05, 0.05, 0.05);

    // The frieze at the springing: oxblood between two cream fillets.
    float fr = abs(up - (spring - 0.10));
    if (fr < 0.20) c = fr < 0.15 ? mix(vec3(0.36, 0.08, 0.07), vec3(0.46, 0.12, 0.09), glaze) : vec3(0.86, 0.80, 0.62);

    float joint = stationBond(uv, cell, t);
    c = mix(c, vec3(0.30, 0.31, 0.28), joint * 0.75);
    rough = mix(rough, 0.85, joint);

    // Soot toward the crown, and the grime of the place over everything.
    float crown = smoothstep(spring, r.ceilH + 1.6, up);
    c *= 1.0 - 0.35 * crown * (0.5 + r.grime);
    c *= 1.0 - r.grime * 0.35 * smoothstep(0.40, 0.80, fbm(uv * 0.9 + 1.3));

    // Seepage: water through the vault, running down the tile in streaks that
    // are darker, browner and shine.
    float run = smoothstep(0.52, 0.78, fbm(vec2(zp * 0.9, up * 0.05) + 5.3))
              * smoothstep(-0.4, 1.4, up - deckH);
    c = mix(c, c * vec3(0.52, 0.47, 0.36), run * (0.45 + 0.4 * r.grime));
    rough = mix(rough, 0.12, run);
    return c;
  }

  /**
   * Between the rails, in the platform and the drift's first beat: the chain's
   * links on its trough, and the brake shoes.
   */
  vec3 liftWayAlbedo(vec3 q, vec3 n, float t, out float rough) {
    float ax = abs(q.x);
    rough = 0.35;
    if (ax < 0.08 && n.y > 0.6) {
      // The chain moves with the cart while it hauls it, so its links are
      // drawn in the cart's frame: a long link, then a short one on its edge.
      float lk   = fract(q.z / 0.16);
      float link = max(smoothstep(0.07, 0.04, abs(lk - 0.25) - 0.13) * smoothstep(0.050, 0.035, ax),
                       smoothstep(0.06, 0.03, abs(lk - 0.75) - 0.05) * smoothstep(0.016, 0.008, ax));
      link = mix(0.45, link, smoothstep(30.0, 6.0, t));
      return mix(vec3(0.06, 0.055, 0.05), vec3(0.42, 0.40, 0.38), link);
    }
    if (ax > 0.11 && n.y > 0.6) { rough = 0.18; return vec3(0.62, 0.60, 0.58); }   // shoes, worn bright
    return mix(vec3(0.20, 0.12, 0.08), vec3(0.11, 0.10, 0.09), fbm(vec2(phaseAt(q.z), q.y) * 9.0));
  }

  /**
   * Everything the station has standing in it. 'emit' carries the battens'
   * light, buzzing on the same roll the lighting makes.
   */
  vec3 stationProp(vec3 q, vec3 n, Room r, float t, float toLamp, out float rough, out vec3 emit) {
    float zp = phaseAt(q.z);
    float ax = abs(q.x);
    float fine = smoothstep(30.0, 6.0, t);
    rough = 0.6;

    // The battens: an opal diffuser under a white enamelled housing, on rods.
    if (toLamp < 0.16) {
      if (n.y < -0.4) {
        float flick = 1.0 - uAtm.x * 0.55 *
          step(0.90, hash21(vec2(floor(iTime * 12.0), floor(zp / max(r.lamp, 1.0)))));
        float ends = smoothstep(1.44, 1.30, abs(latt(zp, r.lamp)));
        emit = lampTint(r.type) * 2.4 * r.lit * flick * ends;
        rough = 0.5;
        return vec3(0.92, 0.95, 0.92);
      }
      rough = 0.4;
      return vec3(0.70, 0.72, 0.68);
    }
    if (abs(ax - STATION_LAMP_X) < 0.05 && q.y > r.lampY) { rough = 0.45; return vec3(0.22, 0.22, 0.21); }

    // On the walls: poster frames, nameboards, benches.
    if (ax > r.bore - 0.10 && q.y > 1.40) {
      float bz = latt(zp, STATION_BAY);
      if (abs(bz) < 1.26 && q.y > 2.38) {
        // The nameboard: blue enamel in a white border, the name in white,
        // chipped back to the iron at its edges.
        vec2  e    = vec2(1.25 - abs(bz), 0.22 - abs(q.y - 2.62));
        float rim  = smoothstep(0.035, 0.05, min(e.x, e.y));
        float edge = smoothstep(0.08, 0.0, min(e.x, e.y)) * smoothstep(0.6, 0.75, fbm(vec2(zp, q.y) * 7.0));
        float side = q.x < 0.0 ? 1.0 : 2.0;
        float gl   = mallGlyphs(vec2(bz / 0.17, (q.y - 2.52) / 0.20), 5.0, 17.0 + side);
        gl = mix(0.3, gl, fine);
        rough = 0.22;
        vec3 c = mix(vec3(0.88, 0.88, 0.84), mix(vec3(0.07, 0.13, 0.36), vec3(0.88, 0.88, 0.84), gl), rim);
        return mix(c, vec3(0.16, 0.10, 0.07), edge);
      }

      float fz = latt(zp + 0.5 * STATION_BAY, STATION_BAY);
      if (abs(fz) < 1.06 && q.y < 2.82) {
        // The poster: an aluminium frame, and what is left of the bill in it.
        vec2  e   = vec2(1.05 - abs(fz), 0.66 - abs(q.y - 2.15));
        float frm = smoothstep(0.05, 0.065, min(e.x, e.y));
        float id  = floor((zp + 0.5 * STATION_BAY) / STATION_BAY) + (q.x < 0.0 ? 57.0 : 0.0);
        float h   = hash21(vec2(id, 4.2));
        vec3  ink = hue(h * 7.0 + 0.4) * 0.55 + 0.12;
        vec2  pu  = vec2(fz, q.y - 2.15);
        float blk = step(abs(pu.y - mix(-0.25, 0.25, h)), 0.22) * step(abs(pu.x - mix(-0.4, 0.4, fract(h * 5.3))), 0.45);
        vec3  pap = mix(vec3(0.80, 0.76, 0.66), ink, 0.35 + 0.5 * blk * fine);
        float gl  = mallGlyphs(vec2(fz / 0.11, (q.y - 2.56) / 0.12), 6.0, id);
        pap = mix(pap, vec3(0.10, 0.09, 0.09), gl * 0.8 * fine);
        // Torn back where it is damp, the backing paper under it.
        float tear = smoothstep(0.62, 0.70, fbm(pu * 2.6 + h * 9.0) + 0.25 * smoothstep(0.4, -0.66, pu.y) * r.grime);
        pap = mix(pap, vec3(0.62, 0.60, 0.52), tear);
        rough = mix(0.30, 0.75, frm);
        return mix(vec3(0.50, 0.51, 0.52), pap, frm);
      }
    }
    if (ax > r.bore - 0.80 && q.y > 0.90 && q.y < 1.92) {
      // The bench: slatted hardwood on a cast frame.
      float sz = latt(zp, 2.0 * STATION_BAY);
      if (abs(sz) > 0.82 && abs(sz) < 0.90) { rough = 0.5; return vec3(0.08, 0.08, 0.075); }
      float slat = smoothstep(0.30, 0.42, abs(fract((n.y > 0.6 ? ax : q.y) / 0.07) - 0.5));
      rough = 0.55;
      return mix(vec3(0.34, 0.20, 0.11), vec3(0.12, 0.07, 0.04), max(slat * fine, 0.15));
    }

    // The coping: pale stone, with the yellow line on it.
    if (ax < 1.79 && q.y > 0.82) {
      rough = 0.5;
      vec3 c = mix(vec3(0.58, 0.57, 0.53), vec3(0.46, 0.45, 0.42), fbm(vec2(ax, zp) * 6.0));
      if (n.y > 0.6) c = mix(c, vec3(0.78, 0.62, 0.14), smoothstep(0.012, 0.0, abs(ax - 1.70) - 0.05) * (1.0 - r.grime * 0.5));
      return c;
    }

    // The decks: small grey tile with water standing in the low spots, which
    // is the mirror the battens are seen in.
    if (n.y > 0.6) {
      vec2  uv    = vec2(q.x, zp);
      float grout = stationBond(vec2(uv.y, uv.x), vec2(0.20, 0.20), t);
      vec3  deck  = mix(vec3(0.40, 0.41, 0.39), vec3(0.50, 0.50, 0.47), stationGlaze(uv, vec2(0.2)));
      deck = mix(deck, vec3(0.20, 0.21, 0.21), grout * 0.8);
      float wet = smoothstep(0.50, 0.62, fbm(uv * 0.45 + 2.0) + 0.12 * smoothstep(2.8, 1.8, ax));
      rough = mix(mix(0.55, 0.85, grout), 0.04, wet);
      return mix(deck, deck * 0.45, wet);
    }

    // The deck's face, down to the well, in the darker course every station
    // platform has, laid the other way up.
    float grout = stationBond(vec2(zp, q.y), vec2(0.24, 0.12), t);
    rough = 0.4;
    return mix(vec3(0.14, 0.17, 0.16), vec3(0.06, 0.07, 0.07), grout);
  }

`
