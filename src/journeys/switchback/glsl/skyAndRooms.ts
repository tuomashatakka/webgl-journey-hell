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
    return Room(A.z, A.w, B.x, B.y, B.z, C.w, B.w, C.x, C.z);
  }

  /** The nearest lamp of the room a point is in, in track space. */
  vec3 lampPos(vec3 q, Room r) {
    return vec3(0.0, r.lampY, q.z - latt(phaseAt(q.z), r.lamp));
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
