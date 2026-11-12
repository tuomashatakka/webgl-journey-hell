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

    // The rolled lip round the top of the tub, and the doubled plate it is rolled
    // from. A plate edge seen end-on is a line one pixel wide; a lip is what makes
    // the rim read as steel with a thickness rather than as a cut in the picture.
    vec3  lc  = c - vec3(0.0, 0.40, 0.0);
    float lip = max(sdRoundBox(lc, vec3(0.655, 0.030, 1.315), 0.025),
                    -sdBox(lc, vec3(0.545, 0.10, 1.205)));

    // The headlamp's feed, out of the back of the housing and down the wall to
    // the floor, where whatever powers it lives.
    vec3  fc   = c - vec3(0.0, -0.045, 1.192);
    float feed = max(length(fc.xz) - 0.014, abs(fc.y) - 0.195);

    return min(min(tub, lip), min(band, min(lampBox, feed)));
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

  // ---- the concourse: a galleria, and the sunset let into it ----------------
  //
  // The room the route table carves is a mall's section already: a barrel vault
  // over the middle and a low aisle down either side. What it lacked was a
  // building. So a gallery runs along both springing lines on columns, the
  // aisles under it are arcades of shopfronts, a rib crosses the vault on every
  // bay, and a band of glazing runs round each haunch. As in the chapel, the
  // glazing is one set of numbers read by everything that needs it: the glass on
  // the vault, the pool of sun on the carpet and the beam in the air between.

  // The vault, as roomProfile strikes it from the table's 11 m bore and 10.5 m
  // ceiling: its radius, and the height of its centre.
  const float MALL_R      = 7.875;
  const float MALL_ARCH_Y = 2.625;

  // A bay: a rib, a column under it and a shopfront between two of them.
  // Divides PHASE_WRAP, and so do the mullions at a quarter of it.
  const float MALL_BAY = 5.0;

  // The gallery: how far off the track its edge is, and the height of its floor.
  const float MALL_GAL_X = 6.3;
  const float MALL_GAL_Y = 3.375;

  // The clerestory, as heights above the vault's centre: sill and head at 24 and
  // 60 degrees round the haunch, and the two transoms that make three lights of
  // it at 36 and 48.
  const float MALL_WIN_Y0 = 3.203;
  const float MALL_WIN_Y1 = 6.820;
  const float MALL_WIN_T0 = 4.629;
  const float MALL_WIN_T1 = 5.852;

  // Where the sun is, in the track's frame: ahead, off to the right and thirty
  // degrees up, so the beams come down across the hall toward the cart. A
  // constant and not uSun, for the chapel's reason: the glazing is built into
  // the vault and the vault turns with the track.
  const vec3 MALL_SUN = vec3(0.773, 0.503, 0.387);

  /** A bar across the light, as what gets past it: half-width, then softness. */
  float mallBar(float d, float hw, float soft) {
    return smoothstep(hw - soft, hw + soft, d);
  }

  /**
   * How much of the sun reaches a point through the clerestory, 0..1.
   *
   * The point is carried back along MALL_SUN to the vault (a circle in section,
   * so it is one square root) and the glazing is tested there: the band, its
   * transoms, the mullions and the ribs. 'soft' is the width of an edge in
   * metres; past a third of a metre the transoms and mullions are finer than
   * the question and are answered by their mean. 'back' is the distance to the
   * glass.
   */
  float mallSun(vec3 q, float soft, out float back) {
    vec2  o    = vec2(q.x, q.y - MALL_ARCH_Y);
    float b    = dot(o, MALL_SUN.xy);
    float dd   = dot(MALL_SUN.xy, MALL_SUN.xy);
    float disc = b * b - dd * (dot(o, o) - MALL_R * MALL_R);
    back = (sqrt(max(disc, 0.0)) - b) / dd;
    if (disc < 0.0 || back < 0.0) return 0.0;

    vec2  w  = o + MALL_SUN.xy * back;
    float zw = phaseAt(q.z + MALL_SUN.z * back);

    float lit = smoothstep(-soft, soft, w.y - MALL_WIN_Y0) * smoothstep(soft, -soft, w.y - MALL_WIN_Y1);
    if (lit < 0.002) return 0.0;

    lit *= mallBar(lattAbs(zw, MALL_BAY), 0.17, soft);
    if (soft < 0.33)
      lit *= mallBar(abs(w.y - MALL_WIN_T0), 0.05, soft) * mallBar(abs(w.y - MALL_WIN_T1), 0.05, soft)
           * mallBar(lattAbs(zw + 0.625, 1.25), 0.045, soft);
    else
      lit *= 0.84;

    // Under the far gallery the slab is in the way: only what clears its edge
    // gets in, and that reaches the foot of the shopfronts and no higher.
    if (q.x < -MALL_GAL_X && q.y < MALL_ARCH_Y + 0.1)
      lit *= smoothstep(soft, -soft, q.y - (q.x + MALL_GAL_X) * 0.6507 - MALL_ARCH_Y);

    return lit;
  }

  /**
   * THE CARPET CONCOURSE: a galleria that has been shut for a while.
   *
   * Extrusions along the track wherever they will do (the gallery, its glass
   * and its rail are three 2D shapes), lattices on the bay for the rest. Three
   * groups, and each hands back a bound until a ray is near it: what is on the
   * walls, what stands on the hall floor, and the escalators. A ray down the
   * middle of the hall, which is most of them, pays for one square root.
   */
  float concourseProps(vec3 q, vec4 A) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);

    // Everything on the walls is past the gallery's edge or within a rib's
    // depth of the vault, so out in the hall the nearer of those two is the
    // answer and none of it is evaluated.
    float under = MALL_R - 0.30 - length(vec2(q.x, q.y - MALL_ARCH_Y));
    float d     = min(MALL_GAL_X - ax, under);
    if (d < 0.3) {
      float bz = latt(zp, MALL_BAY);

      // The gallery: a slab off the springing line and a glass balustrade
      // standing on its edge, capped with a rail the shading draws.
      float slab  = sdBox2(vec2(ax - (MALL_GAL_X + 1.1), q.y - (MALL_GAL_Y - 0.375)), vec2(1.1, 0.375));
      float glass = sdBox2(vec2(ax - (MALL_GAL_X + 0.07), q.y - (MALL_GAL_Y + 0.54)), vec2(0.025, 0.54));

      // A column under the gallery's edge and a rib over the vault, on every bay.
      float col = max(length(vec2(ax - (MALL_GAL_X + 0.32), bz)) - 0.25, q.y - MALL_ARCH_Y - 0.1);
      float rib = max(max(under, abs(bz) - 0.11), MALL_GAL_Y - q.y);

      d = min(min(slab, glass), min(col, rib));
    }

    // The hall floor, 4.2 m off the track on both sides: a palm in a tub on the
    // tens and a bench on the fives between them.
    float fx = ax - 4.2;
    float fb = max(abs(fx) - 1.9, q.y - 3.1);
    if (fb > 0.25) d = min(d, fb);
    else {
      float pz = latt(zp + 5.0, 10.0);
      float pr = length(vec2(fx, pz));
      float f  = min(max(pr - 0.62, q.y - 0.05), max(pr - 0.085, q.y - 2.35));

      // The fronds: two surfaces of revolution about the trunk, one arching up
      // and one hanging, each cut into blades by angle. The height above a
      // curved sheet is not the distance to it, so each is scaled by the
      // steepest slope its curve reaches, which can only under-state.
      float cy = q.y - 2.30;
      float cb = max(pr - 1.80, abs(cy + 0.20) - 0.78);
      if (cb > 0.2) f = min(f, cb);
      else {
        float a  = atan(pz, fx);
        float bw = 0.012 + 0.20 * smoothstep(0.0, 0.45, pr) * (1.0 - smoothstep(0.85, 1.75, pr));
        float fu = max(max(abs(cy - (0.85 - 0.42 * pr) * pr) * 0.76 - 0.014, pr * abs(latt(a, 0.8976)) - bw), pr - 1.75);
        float fd = max(max(abs(cy - (0.22 - 0.50 * pr) * pr) * 0.60 - 0.014, pr * abs(latt(a + 0.5, 1.0472)) - bw), pr - 1.55);
        f = min(f, 0.9 * min(fu, fd));
      }

      // The bench: one block, slatted on top by the shading.
      d = min(d, min(f, sdBox(vec3(fx, q.y + 0.33, latt(zp, 10.0)), vec3(0.26, 0.22, 0.95))));
    }

    // Escalators up to the gallery, a pair every forty metres, stopped, each
    // between two palms. A pair that an end of the room would cut in half is
    // left out: its nearest neighbour is sixteen metres off, further than
    // anything else in the hall.
    float ex = ax - 5.7;
    if (abs(ex) > 0.95) d = min(d, abs(ex) - 0.65);
    else {
      float ez = latt(zp - 5.0, 40.0);
      float ec = q.z - ez;
      float eb = abs(ez) - 3.4;
      if (min(ec - A.x, A.y - ec) > 7.0) {
        if (eb > 0.3) d = min(d, eb);
        else {
          // Thirty degrees, as a shear in height: the truss and the two
          // balustrades standing on it, hard against the gallery's edge.
          float ys    = q.y - (1.4125 + 0.5772 * ez);
          float truss = sdBox(vec3(ex, ys + 0.40, ez), vec3(0.60, 0.42, 3.4));
          float sides = sdBox(vec3(abs(ex) - 0.53, ys - 0.45, ez), vec3(0.045, 0.47, 3.4));
          d = min(d, min(truss, sides) / 1.1547);
        }
      }
    }

    // The front. Seen from the void the hall is a section drawing with the lid
    // off, so the vault is closed over the way in by a glazed lunette standing
    // on the gallery, and the way in is everything under it.
    d = min(d, max(abs(q.z - A.x - 1.35) - 0.15, MALL_GAL_Y - q.y));

    // Nothing of the hall stands out past its own front, in the void's air, or
    // through the chapel's gable at the other end.
    return max(d, max(A.x + 1.2 - q.z, q.z - A.y + 0.45));
  }

  // ---- the chapel's nave, and the light let into it -------------------------
  //
  // The fold on its own is a solid with no way through it and no order in it, so
  // three things are cut into it and all three are read by more than one caller:
  // the map carves them, the albedo finds the glass by them, and the lighting and
  // the volumetrics take the beam from them. One set of numbers, so a shaft of
  // light cannot fail to have a window at the end of it.

  // The nave: walls to a springing line, then a pointed vault struck from two
  // centres. Half-width, springing height, and how far each centre sits past the
  // axis; the radius is their sum and the apex comes out at 9.7 m.
  const float NAVE_W      = 3.3;
  const float NAVE_SPRING = 4.6;
  const float NAVE_C      = 2.3;

  // A bay. Ribs stand on its ends and a lancet in its middle. Divides PHASE_WRAP.
  const float NAVE_BAY = 8.0;

  // The way the light travels, in the track's frame: in through the east wall,
  // down across the nave, and a little along it. A constant, not uSun — these
  // windows are built into the wall and the wall turns with the track.
  const vec3 NAVE_SUN = vec3(-0.8646, -0.4925, 0.0985);

  /** The nave's air, as a cross-section. Negative inside. */
  float naveAir(vec3 q) {
    float box  = sdBox2(vec2(q.x, q.y - 1.9), vec2(NAVE_W, 2.7));
    float arch = length(vec2(abs(q.x) + NAVE_C, q.y - NAVE_SPRING)) - (NAVE_W + NAVE_C);
    return min(box, arch);
  }

  /**
   * A lancet in the east wall, seen along the light: negative where a beam is.
   *
   * The point is carried back along NAVE_SUN to the plane of the wall and tested
   * against the window there, which makes this the window on the wall, the
   * embrasure cut through the fold behind it, and the beam in the air, all at
   * once. Carrying it back is a shear, so as a distance it over-states by the
   * shear's Lipschitz constant, 1 / |NAVE_SUN.x|, and is scaled back down by it.
   * lattAbs rather than latt: the volumetrics accumulate this along a ray.
   */
  float lancet(vec3 q, float bore) {
    float back = (q.x - bore) / NAVE_SUN.x;
    vec3  w    = q - NAVE_SUN * back;
    float zc   = lattAbs(phaseAt(w.z) + 0.5 * NAVE_BAY, NAVE_BAY);

    float box  = sdBox2(vec2(zc, w.y - 4.7), vec2(1.15, 1.5));
    float head = length(vec2(zc + 1.15, w.y - 6.2)) - 2.3;
    return min(box, head) * 0.8646;
  }

  /**
   * THE CHAPEL OF FOLDS: a kaleidoscopic fold, after atzedent's "Remains", with a
   * nave cut down the middle of it.
   *
   * Every step is abs(), a rotation and a translation, and all three are
   * isometries — so the composed field is 1-Lipschitz and the Chebyshev box at
   * the end is too. It under-estimates the true distance and never over-estimates
   * it, which is exactly the direction a sphere trace is allowed to be wrong in.
   * That is why a fractal can be dropped into a 'min' next to exact boxes without
   * dragging the whole journey's step factor down with it.
   *
   * Taken as a shell (abs(d) - t) rather than as a solid, because a solid fold
   * fills the room and a shell is leaves of stone with light behind them. And fed
   * a *mirrored* z on the bay, so it survives the phase fold and every second bay
   * is the first one turned round.
   */
  float chapelProps(vec3 q, vec4 A, vec4 B, vec4 C) {
    float bore  = A.w;
    float lamp  = B.z;
    float lampY = C.w;
    float zp    = phaseAt(q.z);
    float nave  = naveAir(q);

    // The ribs: the nave's own profile, thickened, on every bay line. They are
    // what makes the cut through the fold read as a building — the fold has no
    // period the eye can find, and an arch every eight metres is nothing else.
    float rib = max(abs(nave - 0.07) - 0.30, lattAbs(zp, NAVE_BAY) - 0.24);

    // The votive lamp and the chain it hangs on, from the crown of the vault.
    float lz    = latt(zp, lamp);
    float crown = NAVE_SPRING + 5.1;
    float bowl  = length(vec3(q.x, (q.y - lampY) * 0.8, lz)) - 0.15;
    float chain = max(length(vec2(q.x, lz)) - 0.012, abs(q.y - 0.5 * (lampY + crown)) - 0.5 * (crown - lampY));
    float fit   = min(rib, min(bowl, chain));

    // The fronts. A fold cut off square at the end of its room is a section
    // drawing, so both ends get a wall across the whole profile with the nave's
    // arch for a doorway. Looking back from the overlook it is a gable with a
    // door in it; coming in off the concourse it is the first thing that says
    // what kind of room this is.
    float inside = min(q.z - A.x, A.y - q.z);
    float dz     = abs(inside) - 0.45;
    if (dz < 1.5)
      fit = min(fit, max(max(dz, -nave), roomProfile(q, bore, B.x, B.y) - 0.70));

    // Deep in the nave's air the cut is the nearer surface whatever the fold is
    // doing, and '-nave' is a bound on the whole carve (it is one side of a max).
    // Handing it back skips the fold for most of every ray that looks down the
    // track, which is most of every frame in this room.
    if (nave < -1.1) return min(fit, -nave);

    // Bring the room into the fold's own range before folding it.
    //
    // A fold's structure lives at the scale it subtracts by, and the Chebyshev
    // box at the end is dominated by whichever coordinate is largest. Feed a
    // sixteen-metre nave straight into a two-metre fold and every point in the
    // room is metres away from every leaf, so the room comes out as a smooth
    // corridor with nothing in it — which is exactly how this looked first.
    //
    // So: repeat the plan on a bay, mirrored (lattAbs is a triangle wave, so it
    // is continuous where latt is not, and still 1-Lipschitz), and compress the
    // height. Compressing is a scale below one, which shrinks the gradient — the
    // field under-states distance, which is the direction a sphere trace is
    // allowed to be wrong in.
    vec3 p = vec3(lattAbs(q.x, 5.6) - 1.35,
                  (q.y - 4.0) * 0.55,
                  lattAbs(zp, NAVE_BAY) - 2.05);

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

    // The embrasures go through the fold with the nave: a beam is only a beam if
    // nothing is standing in it.
    float air   = min(nave, lancet(q, bore));
    float shell = abs(d) - 0.16;

    // ...and the fold stops at the fronts. The room's slab runs OVERLAP past
    // them, and a fold left to fill it stands proud of its own gable.
    return min(fit, max(max(shell, -air), -inside));
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
    else if (t < T_CHAPEL - 0.5)    d = concourseProps(q, A);
    else if (t < T_OVERLOOK - 0.5)  d = chapelProps(q, A, B, C);
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
