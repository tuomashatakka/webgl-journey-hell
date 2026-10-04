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
      // THE CHAPEL OF FOLDS. Cold dressed stone with a course line in it.
      float course = smoothstep(0.46, 0.5, abs(fract(uvz.y / 0.62) - 0.5));
      c = mix(vec3(0.50, 0.52, 0.56), vec3(0.29, 0.30, 0.35), course);
      c *= 0.85 + 0.30 * fbm(uvz * 2.2);
      c = mix(c, vec3(0.17, 0.18, 0.21), isFloor * 0.5);
    }
    else {
      c = vec3(0.20, 0.19, 0.22);
    }

    return c * (1.0 - isCeil * 0.12);
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
        rough = 0.75;
        return mix(vec3(0.46, 0.47, 0.52), vec3(0.33, 0.32, 0.39), fbm(q.xz * 1.4));
      }
      rough = 0.50;
      return mix(vec3(0.40, 0.41, 0.45), vec3(0.42, 0.24, 0.15), r.grime * 0.7);
    }

    // The cart. Works-green over pitted steel, with the headlamp on its nose. The
    // lens is small and its emission is modest on purpose: it sits a metre and a
    // half from the lens at the bottom of every frame in the journey, so a value
    // that would read as "a lamp" anywhere else reads here as a hole in the film.
    if (length(q - vec3(0.0, 0.66, 1.40)) < 0.085) {
      emit = vec3(1.00, 0.93, 0.80) * 2.4;
      return vec3(1.0);
    }
    rough = 0.42;
    float wear = smoothstep(0.3, 0.8, fbm(vec2(q.z * 3.0 + q.x * 2.0, q.y * 4.0)));
    vec3 paint = mix(vec3(0.19, 0.25, 0.22), vec3(0.34, 0.20, 0.13), wear * 0.8);

    // The headlamp spills back into the tub. Without it the inside of the cart is
    // a black rectangle across the bottom third of every frame in the journey,
    // and a hole in the picture is worse than a wrong colour in it.
    emit = vec3(1.00, 0.90, 0.76) * 0.12 * smoothstep(-0.4, 0.9, q.z) * max(0.0, -n.z * 0.5 + 0.5);
    return paint;
  }

`
