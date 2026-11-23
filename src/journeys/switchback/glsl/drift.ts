export const driftGlsl = `  // ---- the drift -----------------------------------------------------------
  //
  // THE CHALK DRIFT's surfaces: chalk as the pick left it, with the strokes in
  // rows, seams of flint nodules lying in it, marl partings, the damp coming
  // down from the crown and green growing round the bulbs; a floor trodden to
  // a paste with water standing in it; and the timber: round posts, squared
  // caps and boards, wet and dark at the foot, chalk dust on everything that
  // faces up.

  /** The daylight at the top of a raise. Greyer as the laps go by. */
  vec3 driftDaylight() {
    return mix(vec3(0.80, 0.86, 0.96), vec3(0.58, 0.55, 0.62), uAtm.y * 0.7);
  }

  // Down a raise the sky is a small square a long way up, so its light is all
  // but vertical: a little off the plumb, the way the shaft was sunk.
  const vec3 DRIFT_VENT_L = vec3(-0.087, 0.985, 0.149);

  /**
   * How much of the raise's daylight reaches a point, 0..1. The point is carried
   * back up the light to the raise's foot and to its top, and both squares are
   * tested there, so the pool on the floor, the lit side of the shaft and the
   * beam in the dust are one field. Each test is soft by how far it carried:
   * the sky is a square, not a point. 'spread' softens it further, for the
   * beam, whose samples are metres apart and would otherwise stipple.
   */
  float driftVentLight(vec3 q, float ceilH, float spread) {
    float lit = 1.0;
    for (int i = 0; i < 2; i++) {
      float h = i == 0 ? ceilH - 0.7 : ceilH + DRIFT_VENT_H;
      float k = (h - q.y) / DRIFT_VENT_L.y;
      if (k < 0.0) continue;
      vec2  p = vec2(q.x + DRIFT_VENT_L.x * k - DRIFT_VENT_X,
                     latt(phaseAt(q.z + DRIFT_VENT_L.z * k) + 0.5 * DRIFT_VENT, DRIFT_VENT));
      float soft = 0.12 + 0.07 * k + spread;
      lit *= smoothstep(soft, -soft, max(abs(p.x), abs(p.y)) - DRIFT_VENT_W);
    }
    return lit;
  }

  /**
   * One seam of flint nodules along the drift at height 'band' (in the
   * profile's own coordinate). Returns the nodule, 0..1; 'rim' is its white
   * cortex. A nodule to a cell of 0.55 m, half the cells, each its own size
   * and a little off the seam's line.
   */
  float driftFlint(float zp, float v, float band, out float rim) {
    float cell = floor(zp / 0.55);
    float h    = hash21(vec2(cell, band * 7.1));
    float dz   = latt(zp, 0.55) - (h - 0.5) * 0.24;
    float dy   = v - band - (hash21(vec2(cell, band + 3.3)) - 0.5) * 0.10
               - (vnoise(vec2(zp * 0.6, band)) - 0.5) * 0.16;
    vec2  r    = vec2(0.05 + 0.08 * h, 0.03 + 0.03 * fract(h * 13.0));
    float e    = length(vec2(dz, dy) / r) + (vnoise(vec2(zp, v) * 18.0) - 0.5) * 0.55;
    float on   = step(0.50, h);
    rim = (smoothstep(1.18, 1.0, e) - smoothstep(1.0, 0.86, e)) * on;
    return smoothstep(1.0, 0.86, e) * on;
  }

  vec3 driftShell(vec3 q, vec3 n, Room r, float t, out float rough, out vec3 emit) {
    float zp   = phaseAt(q.z);
    float near = smoothstep(24.0, 5.0, t);
    rough = 0.84;
    emit  = vec3(0.0);

    // The top of a raise is the sky.
    if (q.y > r.ceilH + DRIFT_VENT_H - 0.06) {
      emit = driftDaylight() * 4.0;
      return vec3(0.0);
    }

    float v     = q.y + abs(q.x);
    vec2  u     = vec2(zp, v);
    float broad = fbm(u * 0.45 + 7.0);
    float fine  = mix(0.5, fbm(u * 3.2 + 2.0), near);

    vec3 c = mix(vec3(0.88, 0.86, 0.79), vec3(0.72, 0.69, 0.62), broad);
    c *= 0.88 + 0.20 * fine;

    // Marl partings: grey, soft, a hand's breadth, wandering.
    float marl = abs(fract(v / 0.95 + 0.35 * fbm(u * vec2(0.3, 0.6))) - 0.5);
    c = mix(c, c * vec3(0.84, 0.84, 0.86), smoothstep(0.09, 0.0, marl) * 0.4);

    // The pick: a stroke to a cell, in rows, each a groove with its lit lip
    // beside it, raking down at the angle a right-handed swing leaves.
    vec2  pc   = vec2(zp / 0.17, v / 0.24);
    vec2  pf   = fract(pc) - 0.5;
    float hp   = hash21(floor(pc) + 13.1);
    float line = pf.x + pf.y * 0.55 + 0.30 * (hp - 0.5);
    float len  = smoothstep(0.5, 0.25, abs(pf.y));
    float on   = step(0.28, hp) * len * near;
    c *= 1.0 - 0.24 * smoothstep(0.10, 0.0, abs(line)) * on;
    c *= 1.0 + 0.10 * smoothstep(0.10, 0.0, abs(line - 0.12)) * on;

    // Three seams of flint, black in a white cortex, faded to a grey line.
    float rim, rimAll = 0.0, flint = 0.0;
    flint = max(flint, driftFlint(zp, v, 0.42, rim)); rimAll = max(rimAll, rim);
    flint = max(flint, driftFlint(zp, v, 1.66, rim)); rimAll = max(rimAll, rim);
    flint = max(flint, driftFlint(zp, v, 3.05, rim)); rimAll = max(rimAll, rim);
    vec3 stone = mix(vec3(0.15, 0.15, 0.17), vec3(0.30, 0.29, 0.30), fbm(u * 9.0 + 1.3));
    c = mix(c, vec3(0.96, 0.94, 0.88), rimAll * 0.7 * near);
    c = mix(c, stone, flint * mix(0.3, 0.9, near));
    rough = mix(rough, 0.30, flint * near);

    // Damp: streaks from the crown, darker and wetter than the chalk round them.
    float seep = smoothstep(0.58, 0.80, fbm(vec2(zp * 1.3, v * 0.10) + 3.0)) * smoothstep(-0.2, 1.2, q.y);
    c *= 1.0 - 0.32 * seep * (0.6 + r.grime * 0.6);
    rough = mix(rough, 0.55, seep);

    // Green round every bulb, where the light has kept something alive.
    vec3  lp    = lampPos(q, r);
    float green = smoothstep(1.7, 0.5, length(q - lp)) * smoothstep(0.35, 0.65, fbm(u * 1.4 + 5.0));
    c = mix(c, vec3(0.30, 0.40, 0.20), green * 0.55);

    // Splash and handling up the foot of the walls.
    c = mix(c, vec3(0.46, 0.43, 0.37), smoothstep(0.75, -0.25, q.y) * 0.65);

    // The floor: chalk trodden to a paste, with water standing in the low spots.
    float isFloor = smoothstep(0.55, 0.85, n.y);
    if (isFloor > 0.0) {
      vec2  fu   = vec2(q.x, zp);
      vec3  mud  = mix(vec3(0.44, 0.42, 0.37), vec3(0.27, 0.25, 0.22), fbm(fu * 1.3 + 4.0));
      float pool = smoothstep(0.56, 0.62, fbm(fu * vec2(0.9, 0.45) + 11.0));
      mud  *= 1.0 - 0.40 * pool;
      c     = mix(c, mud, isFloor);
      rough = mix(rough, mix(0.70, 0.05, pool), isFloor);
    }

    return c * (1.0 - r.grime * 0.18 * broad);
  }

  /** Sawn or round, its grain along 'along', one tone per piece of timber. */
  vec3 driftWood(float along, float across, float id, float near) {
    float h = hash21(vec2(id, 4.7));
    vec3  c = mix(vec3(0.38, 0.27, 0.16), vec3(0.25, 0.17, 0.10), h);
    float g = sin(across * 46.0 + fbm(vec2(along * 0.9, across * 5.0) + h * 9.0) * 7.0);
    return c * (0.90 + 0.12 * mix(0.0, g, near) + 0.10 * (fbm(vec2(along * 2.0, across) + id) - 0.5));
  }

  vec3 driftProp(vec3 q, vec3 n, Room r, float t, float toLamp, out float rough, out vec3 emit) {
    float zp   = phaseAt(q.z);
    float near = smoothstep(20.0, 4.0, t);
    rough = 0.80;

    // The bulb in its cage, and the holder it hangs from. Told apart by where
    // the wires are rather than by radius: a hit is up to a cone epsilon off
    // its surface, which at range is more than the gap between glass and cage.
    if (toLamp < 0.2 && q.y < DRIFT_CAP_Y - 0.10) {
      vec3  b    = vec3(q.x, q.y - r.lampY, latt(zp, r.lamp));
      float wire = min(length(vec2(length(b.xz) - 0.10, b.y)),
                       min(length(vec2(length(b.xy) - 0.10, b.z)), length(vec2(length(b.zy) - 0.10, b.x))));
      float cage = smoothstep(0.016, 0.008, wire) * near;
      if (b.y < 0.065 && cage < 0.5) {
        emit = lampTint(r.type) * 6.0 * r.lit;
        rough = 0.2;
        return vec3(1.0, 0.92, 0.78);
      }
      rough = 0.45;
      return vec3(0.07, 0.065, 0.06);
    }

    float sz = latt(zp, DRIFT_SET);
    float id = floor(zp / DRIFT_SET);
    vec3  c;

    if (q.y > DRIFT_CAP_Y + 0.095)                                        // the boards
      c = driftWood(zp, q.x, floor((q.x + 0.135) / 0.27) + 31.0, near) * vec3(0.92, 0.94, 0.96);
    else if (q.y > DRIFT_CAP_Y - 0.105 && abs(sz) < 0.125)                // a cap
      c = driftWood(q.x, q.y + sz, id, near);
    else {                                                                // a post, or a collar
      float round = atan(sz, abs(q.x) - DRIFT_LEG_X + DRIFT_LEG_B * (q.y + r.floorD)) * 0.12;
      c = driftWood(q.y, round, id * 2.0 + step(0.0, q.x), near);
      float foot = smoothstep(0.35, -0.30, q.y);
      c = mix(c, vec3(0.11, 0.09, 0.065), foot * 0.75);
      rough = mix(rough, 0.35, foot);
    }

    // Chalk dust on everything that faces up, and on the timber nearest the rock.
    c = mix(c, vec3(0.74, 0.71, 0.64), smoothstep(0.45, 0.90, n.y) * 0.55);
    return c * (1.0 - r.grime * 0.22);
  }

`
