export const sceneGlsl = `  // ---- the scene -----------------------------------------------------------
  //
  // gMat is written as the map runs, so during the march it holds whatever the
  // last evaluation happened to see. That is the usual arrangement: the map is
  // evaluated once more at the converged hit point, immediately before anything
  // reads it, which is natatorium's resolveSlot in the one form this needs.

  float gMat;

  const float M_SHELL = 0.0;
  const float M_RAIL  = 1.0;
  const float M_TIE   = 2.0;
  const float M_PROP  = 3.0;
  const float M_CART  = 4.0;

  float take(float d, float best, float m) {
    if (d < best) { gMat = m; return d; }
    return best;
  }

  /**
   * The depth at which the rails stop, or a long way off if they do not.
   *
   * Read off the resident slots rather than through roomAt, which is declared
   * further down and which this does not need: the question is not "what room is
   * at this z" but "where does the last one end", and that is one number.
   */
  float railEndZ() {
    for (int i = 0; i < 3; i++)
      if (uSecA[i].z > T_FALL - 0.5) return uSecA[i].x;
    return 1e5;
  }

  // ---- the headland --------------------------------------------------------
  //
  // A walled room is carved out of an unbounded solid, which is right from the
  // inside and wrong from the overlook: the line ran out of open sky into a
  // tiled half-space that filled the whole of it, sixty metres off, and the fog
  // let its courses through as terraces and rings in the sunset. So while the
  // overlook is in the window with a walled room after it, the rock past it is
  // cut down to a headland: a ridge on the line that rises into the hill, falls
  // away to both sides into the cloud, and is cut square across the track by a
  // dressed headwall round the portal. It only ever takes solid away, outside
  // the bore and the collar, so nothing it does can reach the cart, and every
  // frame without the overlook in it is the same frame.

  const float HEAD_TOP   = 11.0;   // the crest over the portal, above the rail
  const float HEAD_RISE  = 0.45;   // ...and how fast the hill climbs behind it
  const float HEAD_FALL  = 0.55;   // the flanks, per metre out from the line
  const float HEAD_WALL  = 9.0;    // the headwall's half-width and its height

  /** The overlook's ends while a walled room follows it in the window. */
  vec2 headlandSpan() {
    if (abs(uSecA[0].z - T_OVERLOOK) < 0.5 && uSecA[1].z < T_FALL - 0.5) return uSecA[0].xy;
    if (abs(uSecA[1].z - T_OVERLOOK) < 0.5 && uSecA[2].z < T_FALL - 0.5) return uSecA[1].xy;
    if (abs(uSecA[2].z - T_OVERLOOK) < 0.5) return uSecA[2].xy;
    return vec2(1e5, 0.0);
  }

  /**
   * Where rock is kept, signed: negative inside the headland. The rock's own
   * relief is three octaves on the surface; the divisor is their slope bound
   * plus the planes', so the field still steps safely at the march's 0.92.
   */
  float headland(vec3 q, vec2 span) {
    // Before the overlook starts there is no headland to cut: keep everything.
    if (q.z < span.x) return q.z - span.x;

    float dz = q.z - span.y;
    float shoulder = sqrt(q.x * q.x + 36.0) - 6.0;    // a rounded crest, not a ridge line
    float base = q.y + HEAD_FALL * shoulder - HEAD_TOP - HEAD_RISE * dz;
    float wall = max(abs(q.x) - HEAD_WALL, q.y - HEAD_WALL);
    float face = span.y + OVERLAP - q.z + 0.7 * max(wall, 0.0);

    // The relief is between -3 and +4.9 m, so it can only move the surface so
    // far: well clear of the headland, which is all of the overlook's own air,
    // a lower bound is an honest step and costs no noise. Deep in the hill,
    // which is every bore and its walls, the relief cannot bring the answer
    // within a metre and a half of zero, and what the map makes of it there is
    // the room's own surface: hand back the upper bound.
    if (face > 4.0 || base > 7.0)
      return max((face - 1.5) / 1.9, (base - 4.9) / 2.4);
    if (base < -9.0 && face < -4.0)
      return max((base + 3.0) / 2.4, (face + 0.9) / 1.9);

    float rock = (fbm(vec2(q.x, dz) * 0.05 + 3.7) - 0.5) * 6.0
               + vnoise(vec2(q.x + dz, q.y) * 0.21) * 1.4
               + vnoise(vec2(q.x - q.y, dz + q.y) * 0.55) * 0.9;
    float hill  = (base - rock) / 2.4;

    // Outside the headwall the face leans back into the hill.
    float front = (face - rock * 0.3) / 1.9;
    return max(hill, front);
  }

  /** The whole scene, in track space, where it is honestly 1-Lipschitz. */
  float mapTrack(vec3 q) {
    float air   = 1e5;
    float props = 1e5;

    for (int i = 0; i < 3; i++) {
      air   = min(air, roomAir(q, uSecA[i], uSecB[i]));
      props = min(props, roomProps(q, uSecA[i], uSecB[i], uSecC[i]));
    }

    gMat = M_SHELL;
    float d = -air;

    vec2 span = headlandSpan();
    if (span.x < 1e4) d = max(d, headland(q, span));
    d = take(props, d, M_PROP);

    // The permanent way stops where the shaft starts. Not faded out, not buried
    // under anything — the rails are simply not there, and the sleeper at the
    // portal is the last sleeper. That abruptness is the whole event.
    if (q.z < railEndZ()) {
      d = take(railSolid(q), d, M_RAIL);
      d = take(tieSolid(q), d, M_TIE);
    }

    d = take(cartSolid(q), d, M_CART);
    return d;
  }

  /** ...and in camera space, where the ray is straight. Only the march uses this. */
  float mapScene(vec3 p) { return mapTrack(toTrack(p)) / lipschitz(p.z); }

  vec3 calcNormal(vec3 q, float t) {
    // Scaled with distance: a fixed epsilon is noise up close and inside the
    // surface far away, and this journey spans ninety metres in one frame.
    float e = 0.0015 * (1.0 + t * 0.05);
    vec2  k = vec2(1.0, -1.0);
    return normalize(
      k.xyy * mapTrack(q + k.xyy * e) +
      k.yyx * mapTrack(q + k.yyx * e) +
      k.yxy * mapTrack(q + k.yxy * e) +
      k.xxx * mapTrack(q + k.xxx * e));
  }

  float calcAO(vec3 q, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.02 + 0.13 * float(i);
      occ += (h - mapTrack(q + n * h)) * sca;
      sca *= 0.62;
    }
    return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
  }

  /** Soft shadow toward a light, in track space. */
  float shadowTo(vec3 q, vec3 l, float maxd) {
    float s = 1.0, t = 0.08;
    for (int i = 0; i < 14; i++) {
      if (t > maxd) break;
      float h = mapTrack(q + l * t);
      if (h < 0.003) return 0.0;
      s = min(s, 11.0 * h / t);
      t += clamp(h, 0.09, 1.6);
    }
    return clamp(s, 0.0, 1.0);
  }
`
