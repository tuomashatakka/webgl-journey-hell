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
