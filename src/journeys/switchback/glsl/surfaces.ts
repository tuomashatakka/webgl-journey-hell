export const surfacesGlsl = `  // ---- surfaces ------------------------------------------------------------

  /**
   * Grid lines on a plane, faded to their mean rather than to zero.
   *
   * Fourteen millimetres of grout at forty metres is a third of a pixel, and a
   * third of a pixel of black sampled once per pixel is not a joint, it is moire.
   * There is no mip chain here (nothing is textured) and ES 1.00 has no
   * derivatives, so the footprint is estimated from distance and the line
   * *widens* as it fades. Widening keeps the wall reading as tiled; fading stops
   * it shimmering.
   */
  float tiling(vec2 uv, float cell, float t) {
    float w = 0.02 + t * 0.0018;
    vec2 g = abs(fract(uv / cell) - 0.5);
    return smoothstep(0.5 - w, 0.5, max(g.x, g.y)) * smoothstep(48.0, 12.0, t);
  }

  vec3 shellAlbedo(vec3 q, vec3 n, float type, float grime, float t) {
    float isFloor = smoothstep(0.55, 0.85, n.y);
    float isCeil  = smoothstep(0.55, 0.85, -n.y);

    // Projection picked off the dominant normal axis, so nothing smears into
    // stripes; the along-track coordinate is the folded phase, not raw z, or
    // every surface would slide backwards as the cart moved.
    float zp = phaseAt(q.z);
    vec2 uvz = abs(n.y) > 0.6 ? vec2(q.x, zp) : (abs(n.x) > 0.6 ? vec2(zp, q.y) : vec2(q.x, q.y));

    vec3 c;

    if (type > T_OVERLOOK + 0.5) {
      // THE FALL. Rock with nothing left on it, and no light of its own — every
      // photon in this room comes through a crack in it.
      float grain = fbm(uvz * vec2(4.0, 1.6)) * 0.6 + fbm(uvz * 17.0) * 0.4;
      c = mix(vec3(0.086, 0.070, 0.072), vec3(0.020, 0.014, 0.016), grain);
      return c * (1.0 - grime * 0.4);
    }

    if (type < T_DRIFT - 0.5) {
      // THE BOARDING PLATFORM. Wet institutional tile, and a floor that is the
      // same tile with the shine walked off it.
      float grout = tiling(uvz, 0.15, t);
      c = mix(vec3(0.80, 0.83, 0.79), vec3(0.30, 0.34, 0.33), grout);
      c = mix(c, vec3(0.15, 0.18, 0.19), isFloor * 0.6);
      c *= 1.0 - grime * 0.45 * smoothstep(0.35, 0.75, fbm(uvz * 1.4));
    }
    else if (type < T_SCAFFOLD - 0.5) {
      // THE CHALK DRIFT. Cut chalk: bone, with the pick marks still in it.
      float pick = fbm(uvz * vec2(9.0, 3.2)) * 0.6 + fbm(uvz * 24.0) * 0.4;
      c = mix(vec3(0.90, 0.87, 0.78), vec3(0.56, 0.52, 0.44), pick);
      c = mix(c, vec3(0.24, 0.19, 0.14), isFloor * 0.6);
      c *= 1.0 - grime * 0.25 * fbm(uvz * 0.7 + 3.1);
    }
    else if (type < T_CONCOURSE - 0.5) {
      c = vec3(0.030, 0.028, 0.040);   // the void's far bound, never actually reached
    }
    else if (type < T_CHAPEL - 0.5) {
      // THE CARPET CONCOURSE. The floor is the point: a mall carpet, a repeating
      // geometric print in colours nobody has chosen since.
      float a = sin(uvz.x * 5.1) * sin(uvz.y * 5.1);
      float b = sin((uvz.x + uvz.y) * 3.3 + 1.2);
      float pat = smoothstep(-0.1, 0.35, a * 0.6 + b * 0.4);
      vec3 carpet = mix(vec3(0.20, 0.12, 0.30), vec3(0.62, 0.18, 0.32), pat);
      carpet = mix(carpet, vec3(0.10, 0.42, 0.44), smoothstep(0.72, 0.95, pat));

      vec3 wall = mix(vec3(0.72, 0.64, 0.62), vec3(0.36, 0.30, 0.33), tiling(uvz, 1.2, t));
      c = mix(wall, carpet, isFloor);
      c = mix(c, vec3(0.86, 0.82, 0.80), isCeil * 0.7);
      c *= 1.0 - grime * 0.30;
    }
    else if (type < T_OVERLOOK - 0.5) {
      // THE CHAPEL OF FOLDS. Dressed stone, laid in courses with the joints
      // broken: a block is a thing with its own tone, quarried on a different
      // day from the one beside it. The joints widen and fade with range like
      // the tile grout does, for the same reason.
      vec2  b     = vec2(uvz.x / 1.24, uvz.y / 0.62);
      b.x        += 0.5 * mod(floor(b.y), 2.0);
      vec2  g     = abs(fract(b) - 0.5);
      float w     = 0.030 + t * 0.0016;
      float joint = max(smoothstep(0.5 - w * 0.5, 0.5, g.x), smoothstep(0.5 - w, 0.5, g.y))
                  * smoothstep(52.0, 10.0, t);
      float tone  = hash21(floor(b) + 7.3);

      c = mix(vec3(0.47, 0.49, 0.54), vec3(0.60, 0.59, 0.58), tone);
      // Tooling across the face, and the damp that has come down it since.
      c *= 0.80 + 0.26 * fbm(uvz * vec2(2.4, 9.0)) + 0.10 * fbm(uvz * 21.0);
      float damp = smoothstep(0.42, 0.78, fbm(vec2(uvz.x * 0.9, uvz.y * 0.16) + 9.1));
      c = mix(c, c * vec3(0.46, 0.52, 0.50), damp * (0.35 + grime * 0.6) * (1.0 - isFloor));
      c = mix(c, vec3(0.20, 0.21, 0.24), joint * 0.85);

      // The floor is flags, worn pale down the middle of each.
      c = mix(c, c * 0.62 + 0.05 * (1.0 - 2.0 * max(g.x, g.y)), isFloor);
    }
    else {
      c = vec3(0.20, 0.19, 0.22);
    }

    return c * (1.0 - isCeil * 0.12);
  }

  /** Rivet heads on a pitch, as a falloff: 1 on the crown, 0 off it. */
  float rivets(vec2 uv, float pitch) {
    return smoothstep(0.013, 0.007, length(vec2(uv.x, latt(uv.y, pitch))));
  }

  /**
   * The cart, seen from inside it. It is the only thing in every frame of the
   * journey, a metre from the lens, so it is the one surface that is never far
   * enough away to get away with anything.
   *
   * An ore tub that has carried ore: works-green paint left on the outside and in
   * patches on the walls, bare steel where the load has scoured it, the floor
   * worn bright along the line it is tipped out, rust in the seams and running
   * down from the rivets. The headlamp's lens faces forward, so all the rider
   * ever sees of it is the back of a cast housing, its feed and a pilot jewel.
   */
  vec3 cartAlbedo(vec3 q, vec3 n, out float rough, out vec3 emit) {
    vec3 c = q - vec3(0.0, 0.44, 0.16);
    rough = 0.48;

    // The lens, on the housing's nose. Gated on the normal: tested by distance
    // alone, a sphere around the lens cuts through the housing's back plate too,
    // and that is a white disc in the bottom of every frame.
    if (n.z > 0.5 && c.z > 1.30 && length(c.xy - vec2(0.0, 0.22)) < 0.075) {
      emit = vec3(1.00, 0.93, 0.80) * 2.4;
      return vec3(1.0);
    }

    // The housing: cast, black, finned on the back where it sheds its heat.
    if (abs(c.x) < 0.13 && c.y > 0.10 && c.y < 0.34 && c.z > 1.17) {
      rough = 0.36;
      if (n.z < -0.5 && length(c.xy - vec2(0.065, 0.29)) < 0.011) {
        emit = vec3(1.00, 0.46, 0.10) * 0.9;     // the pilot: on, and that is all it says
        return vec3(0.9, 0.5, 0.2);
      }
      vec2  hb   = vec2(abs(c.x) - 0.115, abs(c.y - 0.22) - 0.105);
      float edge = smoothstep(-0.018, -0.004, max(hb.x, hb.y));      // the rim, rubbed back
      float fin  = smoothstep(0.25, 0.45, abs(fract(c.y / 0.028) - 0.5)) *
                   step(abs(c.y - 0.22), 0.07) * step(abs(c.x), 0.08);
      vec3  iron = mix(vec3(0.16, 0.16, 0.15), vec3(0.05, 0.05, 0.048), fin);
      return mix(iron, vec3(0.34, 0.34, 0.33), edge * 0.6);
    }

    // Its feed, a rubber-sheathed cable clipped to the wall.
    if (length(c.xz - vec2(0.0, 1.192)) < 0.022 && c.y < 0.16) {
      rough = 0.62;
      return vec3(0.035, 0.034, 0.032);
    }

    float ax = abs(c.x), az = abs(c.z);
    bool inside = ax < 0.556 && az < 1.216 && c.y > -0.245 && c.y < 0.37;

    // Paint, broken by the load. Two scales of noise, stretched along the way the
    // ore slides, so the bare patches read as scour rather than as a pattern.
    vec2 slide = abs(n.x) > 0.6 ? vec2(c.z, c.y) : (abs(n.z) > 0.6 ? vec2(c.x, c.y) : vec2(c.x, c.z));
    float scour = fbm(slide * vec2(1.6, 7.0) + 4.3) * 0.65 + fbm(slide * 19.0) * 0.35;
    vec3 green = mix(vec3(0.17, 0.23, 0.20), vec3(0.12, 0.16, 0.14), fbm(slide * 5.0 + 1.7));
    vec3 steel = mix(vec3(0.36, 0.36, 0.37), vec3(0.22, 0.21, 0.20), fbm(slide * 31.0));
    vec3 rust  = mix(vec3(0.30, 0.15, 0.08), vec3(0.18, 0.09, 0.05), fbm(slide * 11.0 + 7.1));

    float bare = 0.0;
    float rot  = 0.0;
    if (inside) {
      // Low on the walls the load has had the paint off; higher up it survives.
      bare = smoothstep(0.40, 0.70, scour + smoothstep(0.30, -0.20, c.y) * 0.35);
      // The floor: worn bright along the middle, where the ore is tipped out, and
      // grit and rust packed into the corners where it never quite leaves.
      if (n.y > 0.6) {
        bare = 0.55 + 0.45 * smoothstep(0.50, 0.20, ax);
        rough = mix(0.62, 0.30, smoothstep(0.45, 0.15, ax));
        rot = smoothstep(0.38, 0.54, ax) + smoothstep(1.02, 1.20, az);
      }
      rot = max(rot, smoothstep(-0.12, -0.24, c.y) * 0.8);
    }
    else {
      // Outside: the paint is mostly there, chipped back at the edges.
      bare = smoothstep(0.62, 0.80, scour);
    }

    // The rim: everything that has ever been climbed over or tipped across it has
    // polished the top of the lip to bare metal.
    float lip = smoothstep(0.355, 0.375, c.y);
    bare = max(bare, lip * smoothstep(0.30, 0.80, n.y) * (0.65 + 0.35 * scour));
    rough = mix(rough, 0.28, lip * step(0.5, n.y));

    // Rivets, in rows on the rib lines and under the lip, with the rust that runs
    // out of every one of them. A rivet head is the first thing to lose its paint
    // and the last thing anyone repaints.
    // The along-wall coordinate of the face the point is on, for the row under
    // the lip; the rib rows only exist on the side walls.
    float along = abs(n.x) > 0.6 ? c.z : c.x;
    float head  = abs(n.y) < 0.6 ? rivets(vec2(c.y - 0.33, along), 0.10) : 0.0;
    float drip  = (c.y - 0.33) / -0.26;            // 0 at the row, 1 a quarter-metre down
    float run   = smoothstep(0.010, 0.002, abs(latt(along, 0.10))) * step(abs(n.y), 0.6) *
                  smoothstep(0.3 + 0.7 * hash21(vec2(floor(along / 0.10), 5.0)), 0.0, drip) * step(0.0, drip);
    if (abs(n.x) > 0.6 && az < 1.0) {
      float rib = lattAbs(c.z + 0.31, 0.62);
      head = max(head, rivets(vec2(rib, c.y), 0.09));
      float below = latt(c.y, 0.09);               // negative under a rivet
      run = max(run, smoothstep(0.014, 0.0, rib) * smoothstep(-0.045, -0.008, below) * step(below, 0.0) * 0.6);
    }

    vec3 col = mix(green, steel, bare);
    col = mix(col, rust, clamp(rot + run * 0.55, 0.0, 1.0) * (1.0 - lip));
    col = mix(col, steel * 1.15, head * 0.75);
    rough = mix(rough, 0.32, head);

    // The headlamp spills back into the tub. Without it the inside of the cart is
    // a black rectangle across the bottom third of every frame in the journey,
    // and a hole in the picture is worse than a wrong colour in it.
    emit = vec3(1.00, 0.90, 0.76) * 0.12 * smoothstep(-0.4, 0.9, q.z) * max(0.0, -n.z * 0.5 + 0.5) * col * 0.6;
    return col;
  }

  vec3 materialAlbedo(float mat, vec3 q, vec3 n, Room r, float t,
                      out float rough, out vec3 emit) {
    rough = 0.85;
    emit = vec3(0.0);

    if (mat < M_RAIL - 0.5) {
      vec3 c = shellAlbedo(q, n, r.type, r.grime, t);

      // The fissures are lit from *behind*, so they are emission and not a dark
      // line in the albedo. A crack you can see through is the whole point; one
      // painted on reads as dirt, and dirt is what this railway already has.
      // The chapel's lancets are the room's own wall, where the embrasures
      // reach it: leaded quarries, and the day behind them.
      if (abs(r.type - T_CHAPEL) < 0.5 && q.x > r.bore - 0.4) {
        float glass = smoothstep(0.0, -0.10, lancet(q, r.bore));
        if (glass > 0.0) {
          float zc   = lattAbs(phaseAt(q.z) + 0.5 * NAVE_BAY, NAVE_BAY);
          vec2  dq   = vec2(zc + q.y, zc - q.y) / 0.36;
          float came = max(smoothstep(0.38, 0.47, abs(fract(dq.x) - 0.5)),
                           smoothstep(0.38, 0.47, abs(fract(dq.y) - 0.5)));
          came = max(came, smoothstep(0.07, 0.03, zc));             // the mullion
          float pane = 0.7 + 0.6 * hash21(floor(dq) + 2.9);
          emit = naveSunTint() * glass * (1.0 - came * 0.92) * pane * 3.6;
          return mix(c, vec3(0.05, 0.05, 0.06), glass);
        }
      }

      if (uFall.w > 0.03 && r.bore < 50.0) {
        float side = q.x < 0.0 ? -1.0 : 1.0;
        float cr = fissure(fissureUV(q, side), uFall.w) * uFall.w;
        // Faded with range. A crack network is finer than a pixel by forty
        // metres out, and left at full strength the far wall stipples — which
        // the volumetric beams then light up, so it reads as noise and not as
        // distance. The fog takes over from here.
        emit += vec3(1.55, 0.09, 0.05) * cr * (0.6 + uFall.x * 3.0)
          * (1.0 - smoothstep(18.0, 64.0, t) * 0.6);
        c *= 1.0 - cr * 0.65;
      }
      return c;
    }

    if (mat < M_TIE - 0.5) {
      // Rail. Polished on the head where the wheels ride, rusted everywhere else.
      float head = smoothstep(-0.02, 0.01, q.y);
      rough = mix(0.55, 0.10, head);
      vec3 rust = mix(vec3(0.30, 0.16, 0.10), vec3(0.44, 0.26, 0.14),
                      fbm(vec2(phaseAt(q.z) * 3.0, q.y * 8.0)));
      return mix(rust, vec3(0.74, 0.76, 0.80), head * (1.0 - r.grime * 0.3));
    }

    if (mat < M_PROP - 0.5)
      return mix(vec3(0.26, 0.20, 0.14), vec3(0.14, 0.12, 0.10), r.grime * 0.6);

    if (mat < M_CART - 0.5) {
      // A lamp fitting is a prop that happens to be a light, so it is recognised
      // the same way the lighting finds it: by distance to the lamp position the
      // room hands out. Geometry and illumination cannot disagree about where a
      // lamp is if neither of them owns the number.
      float toLamp = length(q - lampPos(q, r));

      // Ballast, wherever it is: directly under the track and below the sleepers.
      // One rule rather than six, because it is the same gravel in the station as
      // it is in the mall — that is most of what is wrong with the mall.
      if (abs(q.x) < 1.22 && q.y < -0.20) {
        float grit = fbm(vec2(q.x, phaseAt(q.z)) * 14.0);
        return mix(vec3(0.20, 0.18, 0.16), vec3(0.09, 0.085, 0.08), grit) *
               (0.7 + 0.5 * fbm(vec2(q.x, phaseAt(q.z)) * 46.0));
      }

      if (r.type < T_DRIFT - 0.5) {
        if (toLamp < 0.70) {
          emit = lampTint(r.type) * 4.0 * r.lit;
          rough = 0.40;
          return vec3(0.90, 0.94, 0.90);
        }
        // The deck. Small grey tiles, and the yellow line you are meant to stand
        // behind, which nobody has stood behind for a while.
        if (n.y > 0.6) {
          float grout = tiling(vec2(q.x, phaseAt(q.z)), 0.30, t);
          vec3 deck = mix(vec3(0.55, 0.56, 0.54), vec3(0.24, 0.26, 0.26), grout);
          float edge = smoothstep(0.16, 0.06, abs(abs(q.x) - 1.85));
          return mix(deck, vec3(0.72, 0.60, 0.16), edge * (1.0 - r.grime * 0.5));
        }
        if (abs(n.x) > 0.6) {
          // The deck's face, in the darker course every station platform has,
          // with the tiles laid the other way up.
          float grout = tiling(vec2(phaseAt(q.z), q.y), 0.22, t);
          return mix(vec3(0.30, 0.32, 0.31), vec3(0.13, 0.15, 0.15), grout);
        }
        return mix(vec3(0.62, 0.64, 0.62), vec3(0.28, 0.30, 0.29), r.grime * 0.6);
      }
      if (r.type < T_SCAFFOLD - 0.5) {
        if (toLamp < 0.20) { emit = lampTint(r.type) * 5.0 * r.lit; return vec3(1.0, 0.92, 0.78); }
        return mix(vec3(0.32, 0.23, 0.14), vec3(0.17, 0.12, 0.08),
                   fbm(vec2(phaseAt(q.z) * 6.0, q.y * 2.0)));
      }
      if (r.type < T_CONCOURSE - 0.5) {
        rough = 0.45;
        float rust = smoothstep(0.35, 0.85, fbm(vec2(phaseAt(q.z) * 1.6, q.y * 1.6)));
        return mix(vec3(0.36, 0.37, 0.40), vec3(0.40, 0.22, 0.13), rust * (0.4 + r.grime * 0.6));
      }
      if (r.type < T_CHAPEL - 0.5) {
        // The clerestory. Where the sunset gets in, so it is a light, not a wall.
        float mull = smoothstep(r.ceilH - 0.80, r.ceilH - 0.45, q.y);
        emit = vec3(1.00, 0.66, 0.58) * mull * 4.2;
        return mix(vec3(0.58, 0.54, 0.56), vec3(0.20, 0.20, 0.22), mull);
      }
      if (r.type < T_OVERLOOK - 0.5) {
        // The votive: a brass bowl with a flame in it, on a chain.
        if (toLamp < 0.30) {
          emit = lampTint(r.type) * 4.5 * r.lit * smoothstep(-0.06, 0.08, q.y - r.lampY);
          rough = 0.35;
          return vec3(0.62, 0.44, 0.18);
        }
        if (abs(q.x) < 0.03 && q.y > r.lampY) { rough = 0.4; return vec3(0.30, 0.24, 0.14); }

        // Everything else in here is the same stone the walls are. The fold's
        // leaves stand at every angle, so the courses run off the wall's own
        // projection and the tooling does the rest.
        rough = 0.78;
        return shellAlbedo(q, n, r.type, r.grime, t);
      }
      rough = 0.50;
      return mix(vec3(0.40, 0.41, 0.45), vec3(0.42, 0.24, 0.15), r.grime * 0.7);
    }

    return cartAlbedo(q, n, rough, emit);
  }

`
