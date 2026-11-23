export const skyAndRoomsGlsl = `
  // ---- room parameters at a depth -----------------------------------------
  //
  // Resolved from the point's own depth, never from the cart's. A room seen
  // through a portal has to be lit by *its* lamps at *its* pitch with *its*
  // ceiling height, and getting that wrong is the bug natatorium spent the
  // longest on. Slots are contiguous and ordered, so this is two compares.

  Room roomAt(float z) {
    vec4 A, B, C;
    if (z < uSecA[1].x)      { A = uSecA[0]; B = uSecB[0]; C = uSecC[0]; }
    else if (z < uSecA[2].x) { A = uSecA[1]; B = uSecB[1]; C = uSecC[1]; }
    else                     { A = uSecA[2]; B = uSecB[2]; C = uSecC[2]; }
    return Room(A.z, A.w, B.x, B.y, B.z, C.w, B.w, C.x, C.z, A.x, A.y);
  }

  /**
   * How far down the line a ray that hit nothing can be said to have got: the
   * start of the first walled room ahead of the depth, if the depth is past it.
   * A walled room is one with a bore (an open section's is 400); the shaft
   * counts as open, since its sky is the abyss and that is what is out there.
   */
  float openReach(float z) {
    if (z >= uSecA[1].x && uSecA[1].w < 100.0 && uSecA[1].z < T_OVERLOOK + 0.5)
      return uSecA[1].x - 0.05;
    if (z >= uSecA[2].x && uSecA[2].w < 100.0 && uSecA[2].z < T_OVERLOOK + 0.5)
      return uSecA[2].x - 0.05;
    return z;
  }

  /**
   * The nearest lamp of the room a point is in, in track space. The platform's
   * are battens, a line over each deck, so its nearest lamp is the nearest point
   * on the nearer tube: the light is long, and so is its halo.
   */
  vec3 lampPos(vec3 q, Room r) {
    float lz = latt(phaseAt(q.z), r.lamp);
    if (r.type < T_DRIFT - 0.5)
      return vec3(q.x < 0.0 ? -STATION_LAMP_X : STATION_LAMP_X, r.lampY - 0.05, q.z - lz + clamp(lz, -1.3, 1.3));
    return vec3(0.0, r.lampY, q.z - lz);
  }

  /** The colour a room's lamps burn. */
  vec3 lampTint(float type) {
    if (type > T_OVERLOOK + 0.5)  return vec3(1.00, 0.16, 0.10);  // the rift, and nothing else
    if (type < T_DRIFT - 0.5)     return vec3(0.70, 0.94, 0.80);  // sick fluorescent
    if (type < T_SCAFFOLD - 0.5)  return vec3(1.00, 0.72, 0.40);  // caged tungsten
    if (type < T_CONCOURSE - 0.5) return vec3(1.00, 0.84, 0.58);  // sodium work-lamp
    if (type < T_CHAPEL - 0.5)    return vec3(0.94, 0.90, 1.00);  // mall cold-white
    if (type < T_OVERLOOK - 0.5)  return vec3(1.00, 0.80, 0.48);  // votive
    return vec3(1.00, 0.90, 0.78);
  }

  /** The colour of the chapel's daylight. Gold, and greyer as the laps go by. */
  vec3 naveSunTint() {
    return mix(vec3(1.00, 0.76, 0.42), vec3(0.74, 0.56, 0.50), uAtm.y * 0.6);
  }

  /** The colour the fog goes to. This is most of what makes six rooms six. */
  vec3 roomFog(float type, float grime) {
    vec3 c;
    if (type > T_OVERLOOK + 0.5)       c = vec3(0.032, 0.007, 0.009);
    else if (type < T_DRIFT - 0.5)     c = vec3(0.100, 0.132, 0.116);
    else if (type < T_SCAFFOLD - 0.5)  c = vec3(0.120, 0.100, 0.076);
    else if (type < T_CONCOURSE - 0.5) c = vec3(0.017, 0.014, 0.028);
    else if (type < T_CHAPEL - 0.5)    c = vec3(0.155, 0.082, 0.094);
    else if (type < T_OVERLOOK - 0.5)  c = vec3(0.052, 0.058, 0.088);
    else                               c = vec3(0.230, 0.180, 0.205);
    return mix(c, c * vec3(1.0, 0.86, 0.80), grime * 0.5);
  }

  float fogDensity(float type) {
    // Thick. Nothing in the shaft is worth resolving at range, and the fog is
    // what keeps the scenery from strobing once the speed has no ceiling on it.
    if (type > T_OVERLOOK + 0.5)  return 0.034;
    if (type < T_DRIFT - 0.5)     return 0.026;
    if (type < T_SCAFFOLD - 0.5)  return 0.038;
    if (type < T_CONCOURSE - 0.5) return 0.013;
    if (type < T_CHAPEL - 0.5)    return 0.019;
    if (type < T_OVERLOOK - 0.5)  return 0.021;
    return 0.014;
  }

  /**
   * The sky as one colour rather than as a direction field.
   *
   * This is what an interior is allowed to see of the weather. skyColor draws a
   * cloud sea, and a cloud sea has a horizon in it — mix that into the fog of a
   * room with a roof on and a razor-straight line appears across the picture at
   * the height of a horizon that is nowhere near the building. Fog is ambient by
   * definition; give it an ambient colour.
   */
  vec3 skyAmbient(float type, float decay) {
    if (type > T_OVERLOOK + 0.5)
      return vec3(0.036, 0.006, 0.008);
    if (type > T_DRIFT + 0.5 && type < T_CONCOURSE - 0.5)
      return vec3(0.020, 0.017, 0.032);
    return mix(vec3(0.66, 0.40, 0.50), vec3(0.34, 0.20, 0.27), decay * 0.7);
  }

  // ---- the overlook's weather ----------------------------------------------
  //
  // Open sky with nothing near in it, so the sky is the room. A gradient on its
  // own read as a lilac card with the parapet in front of it, and the cloud sea
  // the room is named for sat below the parapet where the cart never looks.
  // Three things make it weather: a deck of high cloud lit from underneath by a
  // sun that is nearly down, a wall of cumulus standing on the horizon, and the
  // sea itself in relief, its tops lit on the side that faces the sun.
  //
  // Directions are measured round the sun rather than along the track: the sun
  // is fixed in the world, so a basis built on it is too, and the far cloud
  // stays where it is while the railway turns under it. All of it is at
  // infinity or as good as, so none of it needs the cart's position, only the
  // wind (uCart.x, which is the distance ridden and so seeks exactly).

  vec3 overlookWeather(vec3 rd, vec3 c, float h, float sunDot, float decay) {
    vec3 up  = uUp.xyz;
    vec3 fwd = normalize(uSun.xyz - up * dot(uSun.xyz, up));
    vec3 sde = cross(up, fwd);
    vec2 az  = vec2(dot(rd, sde), dot(rd, fwd));
    vec2 azN = az / max(length(az), 1e-4);
    float toSun = azN.y;                         // 1 under the sun, -1 behind you
    float wind  = uCart.x * 0.0011;

    vec3 sunCol  = mix(vec3(1.00, 0.66, 0.46), vec3(0.70, 0.46, 0.42), decay * 0.7);
    vec3 shadeCl = mix(vec3(0.42, 0.30, 0.42), vec3(0.22, 0.15, 0.20), decay * 0.7);
    vec3 litCl   = mix(vec3(1.00, 0.66, 0.52), vec3(0.62, 0.42, 0.42), decay * 0.7);
    float sunSide = toSun * 0.5 + 0.5;

    // Haze on the horizon, gold under the sun and lilac away from it. This is
    // the air between the cart and the far cloud, and it is what sits them back.
    float band = exp(-abs(h + 0.01) * 16.0);
    vec3 haze  = mix(vec3(0.78, 0.52, 0.62), sunCol, sunSide * sunSide);
    c = mix(c, haze, band * 0.55);

    // The high deck: altocumulus in rolls across the wind, on a plane far up.
    // Its perspective is the 1 / h, and it thins toward the zenith and goes to
    // haze toward the horizon, where its cells would be finer than a pixel.
    if (h > 0.02) {
      vec2 uv = az / h * 1.7 + vec2(wind, wind * 0.4) * 4.0;
      vec2 rl = vec2(uv.x * 0.55 + uv.y * 0.30, uv.y * 1.9 - uv.x * 0.45);
      float d = fbm(rl + vnoise(rl * 0.23) * 2.2) * 0.75 + vnoise(rl * 0.17 + 3.1) * 0.35;
      float cov = smoothstep(0.60, 0.72, d)
                * smoothstep(0.10, 0.36, h) * smoothstep(0.95, 0.35, h);
      // Away from the sun a cell takes the light on its underside and goes
      // rose; toward it the cell is between you and the light, so it is dark
      // and only its thin edges let the sun through, gold round each one.
      float thin  = 1.0 - smoothstep(0.60, 0.76, d);
      vec3 rose   = mix(vec3(0.74, 0.40, 0.56), vec3(0.34, 0.22, 0.30), decay * 0.7);
      vec3 under  = mix(rose, shadeCl * 1.25, sunSide * sunSide * 0.85);
      under += sunCol * thin * sunSide * sunSide * (0.35 + 0.9 * max(sunDot, 0.0));
      c = mix(c, under, cov * 0.8);
    }

    // The cumulus wall: towers standing on the sea all round the horizon, their
    // tops a fractal of the azimuth (read off the unit circle, so there is no
    // seam behind the cart). A tower toward the sun is backlit, dark with a hot
    // rim; one away from it takes the light on its face.
    float hz   = -0.012;                          // where the sea meets the sky
    float tops = hz + 0.11 * smoothstep(0.38, 0.80, fbm(azN * 2.4 + 7.3))
                    + 0.026 * fbm(azN * 30.0) * smoothstep(0.30, 0.60, fbm(azN * 2.4 + 7.3));
    if (h < tops && h > hz - 0.02) {
      float lump = vnoise(vec2(azN.x * 60.0 + azN.y * 23.0, h * 90.0)) * 0.6
                 + vnoise(vec2(azN.x * 170.0 - azN.y * 61.0, h * 260.0)) * 0.4;
      float up01 = clamp((h - hz) / max(tops - hz, 1e-3), 0.0, 1.0);
      float lit  = (1.0 - sunSide * 0.7) * (0.25 + 0.75 * up01) * (0.6 + 0.6 * lump);
      vec3 tower = mix(shadeCl, litCl, clamp(lit, 0.0, 1.0));
      float rim  = smoothstep(tops - 0.014, tops, h) * sunSide * sunSide;
      float glow = max(sunDot, 0.0);
      glow *= glow * glow;
      tower += sunCol * (rim * 0.9 + glow * glow * (0.10 + 0.25 * up01));
      // Distance: thirty kilometres of air in front of them.
      tower = mix(tower, haze, 0.38 + 0.3 * (1.0 - up01));
      c = mix(c, tower, smoothstep(tops, tops - 0.0025, h));
    }

    // The sea. A plane ninety metres down as before, but in relief: the field
    // is read twice, the second time a step toward the sun, and the difference
    // is which way each top faces. The far sea goes to the haze rather than to
    // a texture finer than the pixels it lands on.
    if (h < hz) {
      vec3 hit = rd * (-90.0 / min(h, -0.012));
      vec2 uv  = vec2(hit.x, hit.z) * 0.004 + vec2(0.0, uCart.x * 0.002);
      vec2 sTo = normalize(vec2(uSun.x, uSun.z) + vec2(1e-4, 0.0)) * 0.06;
      float w  = fbm(uv * 6.0) * 0.8;
      float f  = fbm(uv * 3.0 + w);
      float f2 = fbm((uv + sTo) * 3.0 + w);
      float facing = clamp(0.55 + (f2 - f) * 9.0, 0.0, 1.0);
      vec3 sea = mix(shadeCl * 1.2, litCl, facing * (0.55 + 0.45 * f));
      sea += sunCol * facing * pow(max(sunDot, 0.0), 12.0) * 0.6;
      sea  = mix(sea, vec3(0.40, 0.29, 0.35), decay * 0.55);
      float far = smoothstep(hz - 0.26, hz - 0.004, h);
      sea = mix(sea, haze, sqrt(far));
      c = mix(c, sea, smoothstep(hz, hz - 0.012, h));
    }

    return c;
  }

  // ---- sky -----------------------------------------------------------------
  //
  // There is no world position, so there is no world horizon either — only a
  // direction. uUp is world up expressed in the track's frame and it carries the
  // whole bank, which is why the sky rolls over the void and the drop and does
  // not roll in a tunnel. That is also exactly what a real POV camera does: the
  // car does not turn under the rider, the world turns around them.

  vec3 skyColor(vec3 rd, float type, float decay) {
    float h = dot(rd, uUp.xyz);
    float sunDot = dot(rd, uSun.xyz);

    if (type > T_OVERLOOK + 0.5) {
      // The abyss, in liminal's key: black, with a red core where a horizon
      // would be if the shaft had one, and nothing else in it at all.
      float core = pow(max(0.0, 1.0 - abs(h)), 4.0);
      vec3 c = mix(vec3(0.014, 0.004, 0.005), vec3(0.001, 0.000, 0.001),
                   smoothstep(-0.4, 0.9, h));
      return c + vec3(0.62, 0.035, 0.020) * core * (0.5 + uFall.x * 1.8);
    }

    if (type > T_DRIFT + 0.5 && type < T_CONCOURSE - 0.5) {
      // THE SCAFFOLD VOID is not sky. It is the absence of a room, with a bruise
      // where the horizon would be if there were one.
      vec3 c = mix(vec3(0.030, 0.024, 0.046), vec3(0.005, 0.004, 0.011),
                   smoothstep(-0.2, 0.7, h));
      return c + vec3(0.10, 0.05, 0.15) * pow(max(0.0, 1.0 - abs(h)), 6.0) * 0.55;
    }

    // Dreamcore sunset: a hot low sun, a peach band, a lilac zenith. The Sakura
    // pen's background is one exponential blob of near-white against a near-black
    // plum, and most of this journey's palette came off it.
    vec3 zenith  = mix(vec3(0.30, 0.20, 0.56), vec3(0.11, 0.08, 0.20), decay * 0.7);
    vec3 horizon = mix(vec3(1.00, 0.56, 0.62), vec3(0.58, 0.30, 0.38), decay * 0.7);
    vec3 below   = vec3(0.34, 0.20, 0.32);

    vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.65, h));
    c = mix(below, c, smoothstep(-0.12, 0.02, h));

    // A sun, not a searchlight: a tight disc, a small hot corona and a wide
    // gentle wash. One broad power term on its own reads as an eighty-pixel
    // white ellipse floating in front of the sky.
    float sd = max(0.0, sunDot);
    c += vec3(1.00, 0.82, 0.70) * pow(sd, 6.0) * 0.16;
    c += vec3(1.00, 0.86, 0.74) * pow(sd, 220.0) * 1.10;
    c += vec3(1.00, 0.96, 0.92) * smoothstep(0.9986, 0.9994, sunDot) * 6.0;

    // The overlook is the one room that sees the weather whole. Every other
    // room keeps the cloud sea below, which is all a doorway ever shows of it.
    if (type > T_OVERLOOK - 0.5) return overlookWeather(rd, c, h, sunDot, decay);

    // The cloud sea. No world position to intersect a plane against, so it hangs
    // a fixed distance below the cart instead — as true as anything else in here,
    // and it takes the bank with it for nothing.
    if (h < -0.02) {
      vec3 hit = rd * (-90.0 / h);
      vec2 uv = vec2(hit.x, hit.z) * 0.004 + vec2(0.0, uCart.x * 0.002);
      float f = fbm(uv * 3.0 + fbm(uv * 6.0) * 0.8);
      vec3 cloud = mix(vec3(0.70, 0.54, 0.58), vec3(1.00, 0.90, 0.86), f);
      cloud = mix(cloud, vec3(0.40, 0.29, 0.35), decay * 0.55);
      c = mix(c, cloud, smoothstep(-0.02, -0.22, h) * 0.92);
    }

    return c;
  }

`
