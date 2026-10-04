export const roomsGlsl = `  // ---- rooms ---------------------------------------------------------------

  /**
   * The air a room is carved out of: a box up to the springing line, unioned
   * with the barrel vault above it, clipped to the room's z-range.
   *
   * One profile serves all six rooms because the arch radius is *derived* rather
   * than authored — three quarters of the ceiling height, capped at the bore. A
   * low wide room (the platform) gets a shallow subway vault; a tall narrow one
   * (the chapel) gets thirteen metres of wall and then a nave; a room with no
   * walls at all gets a four-hundred-metre box, which is a finite number a
   * sphere trace can step against where an infinity would poison the 'min'.
   */
  float roomProfile(vec3 q, float bore, float ceilH, float floorD) {
    float archR = min(bore, ceilH * 0.75);
    float archY = ceilH - archR;

    float boxHalf = 0.5 * (archY + floorD);
    float boxCy   = 0.5 * (archY - floorD);

    float box  = sdBox2(vec2(q.x, q.y - boxCy), vec2(bore, boxHalf));
    float arch = length(vec2(q.x, q.y - archY)) - archR;
    return min(box, arch);
  }

  float roomAir(vec3 q, vec4 A, vec4 B) {
    float slab = max(A.x - OVERLAP - q.z, q.z - A.y - OVERLAP);
    vec3 w = A.z > T_FALL - 0.5 ? fallWarp(q) : q;
    return max(roomProfile(w, A.w, B.x, B.y), slab);
  }

  /**
   * A collar around a room's mouth, at both of its ends.
   *
   * Six rooms of six different sizes meet at five joins a lap, and without
   * something built at the join the change is a raw edge where one bore stops
   * being the bore. It is also what an open section needs most: past the end of
   * the trestle the next room's rock fills the whole sky, and a portal turns that
   * from a dark shape into a tunnel mouth the track is about to go into.
   *
   * The profile is already computed, so the ring is two compares on it: outside
   * the bore, within COLLAR_W of it, within COLLAR_D of an end plane.
   */
  float portalCollar(vec3 q, vec4 A, vec4 B) {
    if (A.w > 50.0) return 1e5;                    // an open section has no mouth

    float end = abs(q.z - A.x) < abs(q.z - A.y) ? A.x : A.y;
    float dz  = abs(q.z - end) - 0.34;
    if (dz > 0.05) return dz;                      // bound, handed back while it is clear

    float prof = roomProfile(q, A.w, B.x, B.y);
    return max(max(prof - 0.70, -prof), dz);
  }

  // ---- the permanent way ---------------------------------------------------

  /** Rail head and web, as one extruded 2D box. Extrusion along an axis the
   *  section does not vary in is exact, and it costs four operations. */
  float railSolid(vec3 q) {
    return sdBox2(vec2(abs(q.x) - GAUGE, q.y + 0.048), vec2(0.030, 0.058));
  }

  /** Sleepers, and the longitudinal stringer under them. */
  float tieSolid(vec3 q) {
    float tie = sdBox(vec3(q.x, q.y + 0.165, latt(phaseAt(q.z), TIE_PITCH)),
                      vec3(GAUGE + 0.32, 0.055, 0.095));
    float spine = sdBox2(vec2(q.x, q.y + 0.34), vec2(0.15, 0.10));
    return min(tie, spine);
  }

  /**
   * The cart. Two metres long, so the bend across it is nothing, and bolted to
   * the rail, so the track's frame is exactly its frame — it is simply part of
   * the world at z near zero.
   *
   * An open ore tub, hollowed. It is the only object in the journey that never
   * leaves the frame, and it is most of why any of this reads as a ride rather
   * than as a camera flying down a corridor.
   */
  float cartSolid(vec3 q) {
    vec3 c = q - vec3(0.0, 0.44, 0.16);

    // Bound first — the tub is small and the ray spends most of its life nowhere
    // near it. Bail only while the bound is clear of the hit epsilon: a bound
    // allowed to reach zero is stopped on and shaded as though it were a surface,
    // which is how natatorium ended up with a tiled sphere over its grand hall.
    float bound = sdBox(c, vec3(0.80, 0.64, 1.48));
    if (bound > 0.05) return bound;

    float shell  = sdRoundBox(c, vec3(0.62, 0.40, 1.28), 0.07);
    float hollow = sdRoundBox(c - vec3(0.0, 0.14, 0.0), vec3(0.55, 0.38, 1.21), 0.05);
    float tub    = max(shell, -hollow);

    float band = sdBox(vec3(abs(c.x) - 0.62, c.y, lattAbs(c.z, 0.62) - 0.02),
                       vec3(0.035, 0.40, 0.045));
    float lampBox = sdRoundBox(c - vec3(0.0, 0.22, 1.26), vec3(0.115, 0.105, 0.075), 0.035);

    return min(tub, min(band, lampBox));
  }

  // ---- per-room dressing ---------------------------------------------------
  //
  // Everything below is intersected with the complement of CLEAR_*, so no room
  // can be authored into the cart's path, and everything bails on a bound before
  // it costs anything.

  float clearance(vec3 q) { return sdBox2(q.xy - CLEAR_C, CLEAR_H); }

  /** Ballast under the track, wherever there is a floor to rest it on. */
  float ballast(vec3 q, float floorD) {
    if (floorD > 5.0) return 1e5;             // nothing to rest it on
    float top = -0.24;
    float h   = 0.5 * (top + floorD);
    return sdBox2(vec2(q.x, q.y - (top - h)), vec2(1.15, h));
  }

  /** THE BOARDING PLATFORM: two raised decks, queue stanchions, strip lights. */
  float platformProps(vec3 q, float bore, float ceilH, float lamp, float lampY) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);

    float deck = sdBox2(vec2(ax - (bore * 0.5 + 1.55), q.y - 0.20), vec2(bore * 0.5 - 0.05, 0.72));

    float post = length(vec2(ax - 1.62, latt(zp, 3.2))) - 0.035;
    post = max(post, abs(q.y - 1.30) - 0.42);

    float tube = sdBox(vec3(q.x, q.y - lampY, latt(zp, lamp)), vec3(0.90, 0.09, 0.62));

    return min(deck, min(post, tube));
  }

  /** THE CHALK DRIFT: timber sets, crown lagging, and a caged bulb on the cap. */
  float driftProps(vec3 q, float bore, float ceilH, float lamp, float lampY) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);
    float fz = latt(zp, 3.2);

    float leg = sdBox(vec3(ax - (bore - 0.20), q.y - 0.55, fz), vec3(0.15, 1.30, 0.11));
    float cap = sdBox(vec3(q.x, q.y - (ceilH - 0.80), fz), vec3(bore * 0.60, 0.14, 0.11));

    float lag = sdBox2(vec2(latt(q.x, 0.42), q.y - (ceilH - 0.22)), vec2(0.15, 0.06));
    lag = max(lag, ax - bore * 0.72);

    float bulb = length(vec3(q.x, q.y - lampY, latt(zp, lamp))) - 0.11;
    float hangTop = ceilH - 0.30;
    float flex = sdBox(vec3(q.x, q.y - 0.5 * (lampY + hangTop), latt(zp, lamp)),
                       vec3(0.016, max(0.0, 0.5 * (hangTop - lampY)), 0.016));

    return min(min(leg, cap), min(lag, min(bulb, flex)));
  }

  /**
   * THE SCAFFOLD VOID: an endless lattice of girders hung in nothing, and the
   * trestle the track crosses it on. Domain repetition at two scales, which is
   * lifted almost verbatim from atzedent's "Grid Run" — the whole structure is
   * one fold and three boxes.
   */
  float scaffoldProps(vec3 q, float grime) {
    float zp = phaseAt(q.z);
    float bz = latt(zp, BENT_PITCH);

    float leg = sdBox(vec3(abs(q.x) - 1.05, q.y + 15.0, bz), vec3(0.14, 15.0, 0.14));
    float cap = sdBox(vec3(q.x, q.y + 0.62, bz), vec3(1.25, 0.13, 0.15));

    // Diagonal bracing as a box in a sheared coordinate. A shear is not an
    // isometry, so the box's distance is over-stated by exactly the shear's own
    // Lipschitz constant — sqrt(1 + 0.42^2) — and dividing it out is the same
    // correction the bend gets, for the same reason.
    float sx = abs(q.x) + q.y * 0.42;
    float diag = sdBox(vec3(sx - 1.05, q.y + 3.2, bz), vec3(0.09, 3.0, 0.10)) / 1.0846;

    vec3 g = vec3(latt(q.x, 6.0), latt(q.y - 2.6, 6.0), latt(zp + 3.0, 6.0));
    float r = 0.085 + grime * 0.02;
    float bars = min(min(sdBox2(g.xy, vec2(r)), sdBox2(g.yz, vec2(r))), sdBox2(g.zx, vec2(r)));
    bars = min(bars, sdBox(g, vec3(r * 2.4)));

    return min(min(leg, cap), min(diag, bars));
  }

  /** THE CARPET CONCOURSE: shopfront pylons, dead escalators, planters, mullions. */
  float concourseProps(vec3 q, float bore, float ceilH) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);

    float pz = latt(zp, 6.0);
    float pylon  = sdBox(vec3(ax - (bore - 0.9), q.y - 1.6, pz), vec3(0.55, 2.2, 0.55));
    float fascia = sdBox2(vec2(ax - (bore - 0.9), q.y - 3.9), vec2(0.62, 0.42));

    float ez = latt(zp, 24.0);
    float ramp = sdBox(vec3(ax - bore * 0.62, q.y - 1.9 - ez * 0.30, ez),
                       vec3(0.80, 0.28, 5.4)) / 1.0440;

    float planter = sdBox(vec3(ax - 3.6, q.y + 0.10, latt(zp, 8.0)), vec3(0.50, 0.36, 1.30));

    float mull = sdBox2(vec2(latt(q.x, 1.9), q.y - (ceilH - 0.35)), vec2(0.09, 0.30));
    mull = max(mull, ax - bore * 0.62);

    return min(min(pylon, fascia), min(min(ramp, planter), mull));
  }

  /**
   * THE CHAPEL OF FOLDS: a kaleidoscopic fold, after atzedent's "Remains".
   *
   * Every step is abs(), a rotation and a translation, and all three are
   * isometries — so the composed field is 1-Lipschitz and the Chebyshev box at
   * the end is too. It under-estimates the true distance and never over-estimates
   * it, which is exactly the direction a sphere trace is allowed to be wrong in.
   * That is why a fractal can be dropped into a 'min' next to exact boxes without
   * dragging the whole journey's step factor down with it.
   *
   * Taken as a shell (abs(d) - t) rather than as a solid, because a solid fold
   * fills the room and a shell is a nave of ribs with light behind them. And fed
   * a *mirrored* z, so it survives the phase fold — it is the one thing in here
   * with no natural period, and 64 metres divides PHASE_WRAP.
   */
  float chapelProps(vec3 q, float bore, float ceilH) {
    // Bring the room into the fold's own range before folding it.
    //
    // A fold's structure lives at the scale it subtracts by, and the Chebyshev
    // box at the end is dominated by whichever coordinate is largest. Feed a
    // sixteen-metre nave straight into a two-metre fold and every point in the
    // room is metres away from every rib, so the room comes out as a smooth
    // corridor with nothing in it — which is exactly how this looked first.
    //
    // So: repeat the plan on a bay, mirrored (lattAbs is a triangle wave, so it
    // is continuous where latt is not, and still 1-Lipschitz), and compress the
    // height. Compressing is a scale below one, which shrinks the gradient — the
    // field under-states distance, which is the direction a sphere trace is
    // allowed to be wrong in.
    vec3 p = vec3(lattAbs(q.x, 5.6) - 1.35,
                  (q.y - 4.0) * 0.55,
                  lattAbs(phaseAt(q.z), 9.0) - 2.05);

    float d = 1e5;
    float f = 1.0;

    // One angle, compounded, rather than a different one per octave. Same family
    // of kaleidoscope, and it takes the two trig calls out of the loop, which is
    // most of what this room used to cost. The angle drifts with the lap, so the
    // chapel is a slightly different building every time round.
    float a = 0.62 + sin(uCart.z * 0.7) * 0.14;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));

    for (int i = 0; i < 5; i++) {
      p.xz = R * p.xz;
      p = abs(p) - 1.45 * f;
      d = min(d, max(p.x, max(p.y, p.z)));
      f *= 0.62;
    }

    float shell = abs(d) - 0.16;
    return max(shell, -(length(vec2(q.x, q.y - 1.5)) - bore * 0.34));
  }

  /** THE OVERLOOK: nothing but the trestle, a handrail, and a very long way down. */
  float overlookProps(vec3 q) {
    float zp = phaseAt(q.z);
    float bz = latt(zp, BENT_PITCH);
    float ax = abs(q.x);

    float leg = sdBox(vec3(ax - 1.05, q.y + 22.0, bz), vec3(0.13, 22.0, 0.13));
    float cap = sdBox(vec3(q.x, q.y + 0.62, bz), vec3(1.30, 0.13, 0.15));
    float sx = ax + q.y * 0.42;
    float diag = sdBox(vec3(sx - 1.05, q.y + 3.4, bz), vec3(0.085, 3.2, 0.10)) / 1.0846;

    float rail = sdBox2(vec2(ax - 1.44, q.y - 0.95), vec2(0.05, 0.05));
    float stanchion = sdBox(vec3(ax - 1.44, q.y - 0.45, latt(zp, TIE_PITCH)), vec3(0.045, 0.55, 0.045));

    return min(min(leg, cap), min(diag, min(rail, stanchion)));
  }

  /**
   * THE FALL. Not a room — the inside of something that has come apart.
   *
   * Two things only, because at the speed this is seen at nothing smaller than
   * a slab registers: the buckled ribs that were holding the shaft open, and the
   * pieces of wall that are no longer in it.
   */
  float fallProps(vec3 q, float grime) {
    vec3 w = fallWarp(q);
    float zp = phaseAt(q.z);

    float rad = length(w.xy);
    float ang = atan(w.y, w.x);
    float rib = max(abs(rad - 24.5) - 0.55, abs(latt(zp, 18.0)) - 0.5);
    // Broken into arcs. ang * radius is arc length, which is the metric the
    // lattice has to be measured in or the gaps pinch shut near the axis.
    rib = max(rib, lattAbs(ang * 24.5, 21.0) - 7.0);

    vec3 sl = w;
    float cell = floor(zp / 33.0);
    sl.z = latt(zp, 33.0);
    float sa = hash21(vec2(cell, 3.0)) * 6.28318 + uFall.z * 3.0;
    float cs = cos(sa), ss = sin(sa);
    sl.xy = vec2(cs * sl.x - ss * sl.y, ss * sl.x + cs * sl.y);
    sl.x -= 11.0 + hash21(vec2(cell, 9.0)) * 9.0;
    float slab = sdRoundBox(sl, vec3(3.2, 0.34, 2.4), 0.12);

    return min(rib, slab);
  }

  float roomProps(vec3 q, vec4 A, vec4 B, vec4 C) {
    // The room's own z-slab is the outermost bound every prop shares. Handed back
    // as a distance only while it is comfortably clear of the hit epsilon.
    float slab = max(A.x - OVERLAP - q.z, q.z - A.y - OVERLAP);
    if (slab > 0.05) return slab;

    float t = A.z;
    float d;

    if (t < T_DRIFT - 0.5)          d = platformProps(q, A.w, B.x, B.z, C.w);
    else if (t < T_SCAFFOLD - 0.5)  d = driftProps(q, A.w, B.x, B.z, C.w);
    else if (t < T_CONCOURSE - 0.5) d = scaffoldProps(q, B.w);
    else if (t < T_CHAPEL - 0.5)    d = concourseProps(q, A.w, B.x);
    else if (t < T_OVERLOOK - 0.5)  d = chapelProps(q, A.w, B.x);
    else if (t < T_FALL - 0.5)      d = overlookProps(q);
    else                            d = fallProps(q, B.w);

    // No ballast in the shaft. There is no track for it to be under.
    if (t < T_FALL - 0.5)
      d = min(d, ballast(q, B.y));

    // Nothing may enter the swept tube. It cannot fail to clear the cart,
    // because it is defined by where the cart goes.
    d = max(max(d, -clearance(q)), slab);

    // ...and the portal collar is outside the bore by construction, so it does
    // not go through the clearance test and cannot be eaten by it.
    return min(d, portalCollar(q, A, B));
  }

`
