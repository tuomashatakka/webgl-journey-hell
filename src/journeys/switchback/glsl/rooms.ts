export const roomsGlsl = `  // ---- rooms ---------------------------------------------------------------

  // ---- the station -----------------------------------------------------------
  //
  // THE BOARDING PLATFORM is a station hall, not a bore: a segmental vault over
  // the whole width, wall to wall, springing STATION_RISE under the crown, so
  // both decks have a storey of headroom and the walls stand straight up off
  // them. Struck from the table's own bore and ceiling, so the route table
  // keeps its numbers and the collars and the headland follow the hall.

  const float STATION_RISE   = 2.4;    // crown over the springing line
  const float STATION_LAMP_X = 3.4;    // the two lines of battens, over the decks
  const float STATION_DECK   = 0.92;   // deck top above the rail head
  const float STATION_BAY    = 8.0;    // posters on it, nameboards between them

  /** The hall's air, as a cross-section: negative inside. */
  float stationVault(vec3 q, float bore, float ceilH, float floorD) {
    float rad  = (bore * bore + STATION_RISE * STATION_RISE) / (2.0 * STATION_RISE);
    float vault = length(vec2(q.x, q.y - (ceilH - rad))) - rad;
    float box   = sdBox2(vec2(q.x, q.y - 0.5 * (ceilH - floorD)), vec2(bore, 0.5 * (ceilH + floorD)));
    return max(box, vault);
  }

  // ---- the drift -------------------------------------------------------------
  //
  // THE CHALK DRIFT is an adit cut by hand: walls battered in from the floor to
  // a segmental crown, every face left as the pick left it, a three-piece
  // timber set every DRIFT_SET (two round posts leaning in with the walls, a
  // squared cap across their heads, boards laid over the caps), and a raise up
  // to the daylight every DRIFT_VENT, between two sets.

  const float DRIFT_SET    = 1.6;    // set pitch: divides the lamp pitch and PHASE_WRAP
  const float DRIFT_HALF   = 2.30;   // the wall's half-width at the floor
  const float DRIFT_BATTER = 0.12;   // ...and how far it leans in per metre up
  const float DRIFT_SPRING = 1.5;    // where the crown springs from the walls
  const float DRIFT_CAP_Y  = 2.55;   // the cap's centre line
  const float DRIFT_LEG_X  = 2.02;   // a post's centre at the floor
  const float DRIFT_LEG_B  = 0.166;  // ...and its batter, per metre up
  const float DRIFT_HEW    = 0.10;   // the most the hewing moves a face
  const float DRIFT_VENT   = 32.0;   // a raise every this far, divides PHASE_WRAP
  const float DRIFT_VENT_X = 0.5;    // its centre, off the line
  const float DRIFT_VENT_W = 0.6;    // its half-width
  const float DRIFT_VENT_H = 6.0;    // how far it climbs past the crown

  /**
   * The drift's air, as a cross-section: a trapezoid up to the springing and
   * a circle through the springing points and the crown above it. The wall
   * plane is divided by its own length, so the distance stays euclidean.
   */
  float driftBore(vec3 q, float ceilH, float floorD) {
    float ws    = DRIFT_HALF - DRIFT_BATTER * (DRIFT_SPRING + floorD);
    float yc    = (ceilH * ceilH - ws * ws - DRIFT_SPRING * DRIFT_SPRING) / (2.0 * (ceilH - DRIFT_SPRING));
    float wall  = (abs(q.x) - DRIFT_HALF + DRIFT_BATTER * (q.y + floorD)) / sqrt(1.0 + DRIFT_BATTER * DRIFT_BATTER);
    float trap  = max(max(wall, -floorD - q.y), q.y - DRIFT_SPRING);
    float crown = max(length(vec2(q.x, q.y - yc)) - (ceilH - yc), -floorD - q.y);
    return min(trap, crown);
  }

  /** The raise, as air: a square shaft from the crown up to the daylight. */
  float driftVent(vec3 q, float ceilH) {
    float y0 = ceilH - 0.7, y1 = ceilH + DRIFT_VENT_H;
    vec3  v  = vec3(q.x - DRIFT_VENT_X, q.y - 0.5 * (y0 + y1), latt(phaseAt(q.z) + 0.5 * DRIFT_VENT, DRIFT_VENT));
    return sdBox(v, vec3(DRIFT_VENT_W, 0.5 * (y1 - y0), DRIFT_VENT_W));
  }

  /**
   * The faces as the pick left them: two octaves of relief, up to DRIFT_HEW
   * either way, laid along the profile (y + |x| runs up the wall and across
   * the crown without a seam). The floor is trodden flat, so the relief comes
   * in over the first half metre of wall, and it goes at both ends, where the
   * collars are struck from the smooth profile. Their slopes add to about
   * half, hence the divisor; a metre clear of the wall the relief cannot
   * reach and the plain profile, moved by the most it could, is the bound.
   */
  float driftHewn(vec3 q, float prof, vec4 A, vec4 B) {
    float vent = driftVent(q, B.x);
    if (prof < -0.45) return min(prof + DRIFT_HEW, vent);

    vec2  u   = vec2(phaseAt(q.z), q.y + abs(q.x));
    float rel = 0.12 * (vnoise(u * 0.8 + 1.7) - 0.5) + 0.04 * (vnoise(u * 2.4 + 5.3) - 0.5);
    rel *= smoothstep(0.05 - B.y, 0.65 - B.y, q.y) * smoothstep(0.4, 1.9, min(q.z - A.x, A.y - q.z));
    return min((prof + rel) / 1.5, vent);
  }

  /**
   * The air a room is carved out of: a box up to the springing line, unioned
   * with the barrel vault above it, clipped to the room's z-range.
   *
   * One profile serves five of the rooms because the arch radius is *derived*
   * rather than authored — three quarters of the ceiling height, capped at the
   * bore. A tall narrow one (the chapel) gets thirteen metres of wall and then a
   * nave; a room with no walls at all gets a four-hundred-metre box, which is a
   * finite number a sphere trace can step against where an infinity would
   * poison the 'min'. The platform is the exception (stationVault): a vault
   * struck from the track alone brought its haunches down onto the decks. So
   * is the drift (driftBore), which was cut by hand and not struck at all.
   */
  float roomProfile(vec3 q, float type, float bore, float ceilH, float floorD) {
    if (type < T_DRIFT - 0.5) return stationVault(q, bore, ceilH, floorD);
    if (type < T_DRIFT + 0.5) return driftBore(q, ceilH, floorD);

    float archR = min(bore, ceilH * 0.75);
    float archY = ceilH - archR;

    float boxHalf = 0.5 * (archY + floorD);
    float boxCy   = 0.5 * (archY - floorD);

    float box  = sdBox2(vec2(q.x, q.y - boxCy), vec2(bore, boxHalf));
    float arch = length(vec2(q.x, q.y - archY)) - archR;
    return min(box, arch);
  }

  /**
   * A room's own z-slab, OVERLAP past both ends, so two neighbours' air
   * overlaps rather than touching on a plane. The station is the exception at
   * its far end: it is the bigger room there, so the drift's air reaching back
   * into it is the overlap, and the hall stops at its own end plane, with a
   * tiled end wall and the drift's mouth in it, rather than a metre and more
   * into the chalk.
   */
  float roomSlab(vec3 q, vec4 A) {
    return max(A.x - OVERLAP - q.z, q.z - A.y - (A.z < T_DRIFT - 0.5 ? 0.0 : OVERLAP));
  }

  float roomAir(vec3 q, vec4 A, vec4 B) {
    float slab = roomSlab(q, A);
    vec3 w = A.z > T_FALL - 0.5 ? fallWarp(q) : q;
    float prof = roomProfile(w, A.z, A.w, B.x, B.y);
    if (abs(A.z - T_DRIFT) < 0.5) prof = driftHewn(q, prof, A, B);
    return max(prof, slab);
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
    if (dz > 1.0) return dz;                       // bound, handed back while it is clear

    float prof = roomProfile(q, A.z, A.w, B.x, B.y);
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

  /**
   * THE BOARDING PLATFORM: two decks with a stone coping on the edge, battens
   * hung from the vault over each, and on the walls a poster frame every bay,
   * a nameboard between two, and a bench under every other nameboard. Behind
   * one bound for the walls and one for the lights, so a ray down the track
   * pays for the deck and two compares.
   */
  float platformProps(vec3 q, float bore, float lamp, float lampY) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);

    float deck  = sdBox2(vec2(ax - (bore * 0.5 + 1.55), q.y - 0.20), vec2(bore * 0.5 - 0.05, 0.72));
    float cope  = sdBox2(vec2(ax - 1.68, q.y - 0.885), vec2(0.10, 0.055));
    float d     = min(deck, cope);

    // The battens: a slim fitting a lamp pitch apart over each deck's edge,
    // on two rods up to the vault.
    float lb = max(abs(ax - STATION_LAMP_X) - 0.2, abs(q.y - lampY - 0.3) - 0.45);
    if (lb > 0.3) d = min(d, lb);
    else {
      float lz  = latt(zp, lamp);
      float fit = sdRoundBox(vec3(ax - STATION_LAMP_X, q.y - lampY, lz), vec3(0.09, 0.045, 1.42), 0.02);
      float rod = max(length(vec2(ax - STATION_LAMP_X, abs(lz) - 1.05)) - 0.012, abs(q.y - lampY - 0.35) - 0.35);
      d = min(d, min(fit, rod));
    }

    // The walls: frames, boards and benches stand within a metre of them.
    float wb = bore - 0.75 - ax;
    if (wb > 0.3) return min(d, wb);

    float fz     = latt(zp + 0.5 * STATION_BAY, STATION_BAY);
    float poster = sdBox(vec3(ax - bore, q.y - 2.15, fz), vec3(0.05, 0.66, 1.05));
    float bz     = latt(zp, STATION_BAY);
    float board  = sdBox(vec3(ax - bore, q.y - 2.62, bz), vec3(0.06, 0.22, 1.25));

    float sz    = latt(zp, 2.0 * STATION_BAY);
    float seat  = sdBox(vec3(ax - (bore - 0.50), q.y - 1.36, sz), vec3(0.21, 0.035, 1.0));
    float back  = sdBox(vec3(ax - (bore - 0.27), q.y - 1.66, sz), vec3(0.025, 0.24, 1.0));
    float legs  = sdBox(vec3(ax - (bore - 0.50), q.y - 1.13, abs(sz) - 0.86), vec3(0.17, 0.21, 0.035));
    float bench = min(seat, min(back, legs));

    return min(d, min(min(poster, board), bench));
  }

  // The platform's chain beat starts here, two thirds of the way down the room,
  // and the drift's first beat, which the chain runs on over, is this long.
  const float STATION_CHAIN = 48.0;
  const float DRIFT_CHAIN   = 26.0;

  /**
   * The chain, in its trough between the rails, from depth z0 to z1. Laid
   * under the cart's floor, so it is added after the clearance rather than cut
   * by it; its links are drawn by the shading.
   */
  float chainWay(vec3 q, float z0, float z1) {
    return sdBox(vec3(q.x, q.y + 0.10, q.z - 0.5 * (z0 + z1)), vec3(0.075, 0.038, 0.5 * (z1 - z0)));
  }

  /**
   * The platform's permanent way: brake shoes along the first beat, which the
   * cart comes in on, and the chain along the last, which hauls it out.
   */
  float platformWay(vec3 q, vec4 A) {
    float shoe = sdBox(vec3(abs(q.x) - 0.14, q.y + 0.07, q.z - A.x - 12.0), vec3(0.014, 0.062, 9.0));
    return min(shoe, chainWay(q, A.x + STATION_CHAIN, A.y));
  }

  /**
   * THE CHALK DRIFT: a set every DRIFT_SET (two posts battered in with the
   * walls, a cap across their heads), boards laid along the drift over the
   * caps with the raises left open, and a caged bulb hung from the cap of
   * every set a lamp pitch apart. Behind one bound for the sets, so a ray
   * between two of them pays for the boards and a compare.
   */
  float driftProps(vec3 q, float ceilH, float floorD, float lamp, float lampY) {
    float ax = abs(q.x);
    float zp = phaseAt(q.z);

    float lag = max(sdBox2(vec2(latt(q.x + 0.135, 0.27), q.y - DRIFT_CAP_Y - 0.13), vec2(0.105, 0.03)), ax - 1.3);
    float hole = max(abs(q.x - DRIFT_VENT_X), lattAbs(zp + 0.5 * DRIFT_VENT, DRIFT_VENT)) - DRIFT_VENT_W - 0.02;
    lag = max(lag, -hole);

    float sz  = latt(zp, DRIFT_SET);
    float set = abs(sz) - 0.14;
    if (set > 0.3) return min(lag, set);

    float py   = q.y + floorD;
    float lx   = ax - (DRIFT_LEG_X - DRIFT_LEG_B * py);
    float post = max(length(vec2(lx, sz)) / 1.014 - 0.105, max(-py, q.y - DRIFT_CAP_Y + 0.10));
    float cap  = sdBox(vec3(q.x, q.y - DRIFT_CAP_Y, sz), vec3(1.80, 0.10, 0.11));
    float d    = min(lag, min(post, cap));

    // The bulb: a holder under the cap, the glass, and a cage of three hoops.
    vec3  b  = vec3(q.x, q.y - lampY, latt(zp, lamp));
    float lb = length(b) - 0.2;
    if (lb > 0.1) return min(d, lb);

    float hold  = sdBox(b - vec3(0.0, DRIFT_CAP_Y - 0.12 - lampY, 0.0), vec3(0.035, 0.05, 0.035));
    float glass = length(b) - 0.075;
    float hoops = min(length(vec2(length(b.xz) - 0.10, b.y)),
                      min(length(vec2(length(b.xy) - 0.10, b.z)), length(vec2(length(b.zy) - 0.10, b.x)))) - 0.007;
    return min(d, min(min(hold, glass), max(hoops, -b.y - 0.085)));
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
      fit = min(fit, max(max(dz, -nave), roomProfile(q, T_CHAPEL, bore, B.x, B.y) - 0.70));

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
    // as a distance only while it is comfortably clear of the hit epsilon, and
    // that is the epsilon at the far end of the march (0.15 m at T_MAX) times
    // the bend's Lipschitz divisor, not the epsilon at the near end: a bound
    // under it is a hit, and with nothing behind the slab, as past the
    // overlook's headland, that hit was a wall across the whole sky.
    float slab = roomSlab(q, A);
    if (slab > 1.0) return slab;

    float t = A.z;
    float d;

    if (t < T_DRIFT - 0.5)          d = platformProps(q, A.w, B.z, C.w);
    else if (t < T_SCAFFOLD - 0.5)  d = max(driftProps(q, B.x, B.y, B.z, C.w), A.x - q.z);
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

    // The brake and the chain, between the rails, where nothing else goes.
    float way = max(abs(q.x) - 0.25, abs(q.y + 0.08) - 0.12);
    if (way < 0.3) {
      if (t < T_DRIFT - 0.5)         way = platformWay(q, A);
      else if (t < T_SCAFFOLD - 0.5) way = chainWay(q, A.x - OVERLAP, A.x + DRIFT_CHAIN);
      else                           way = 1e5;
    }
    d = min(d, max(way, slab));

    // ...and the portal collar is outside the bore by construction, so it does
    // not go through the clearance test and cannot be eaten by it.
    return min(d, portalCollar(q, A, B));
  }

`
