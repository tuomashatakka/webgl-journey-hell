// THE SWITCHBACK — six rooms seen from a mine cart that never stops.
//
// Single pass via lib/shaderQuad.ts, driven by createSwitchbackSimulation in
// kinematics.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch,
// no `tanh` (that is ES 3.00 — there is a two-line one below), and uniform arrays
// may only be indexed by a *constant-index-expression*. That last one is why no
// function here takes a slot index: they take the three vec4s, and the indexing
// happens at the call site under the loop counter. A function parameter is not a
// constant-index-expression, however reliably the compiler inlines it.
//
// ---------------------------------------------------------------------------
// Everything here is straight
// ---------------------------------------------------------------------------
//
// The camera sits at the origin looking down +Z and never moves. The track is
// the +Z axis. The real railway's curve arrives as four floats — see the long
// note at the top of kinematics.ts — and a point is looked up at
// `p.xy - bend(p.z)`. So rails, sleepers, trestle bents and lamps are lattices
// along a straight axis, which is the cheapest geometry there is, and the
// hardest question the other journeys in this repo had to answer (how does a
// point in one room get expressed in another's frame?) does not exist: there is
// one frame and every room is a range of z in it.
//
// Two consequences worth stating, because both were bugs elsewhere:
//
//   * natatorium's `resolveSlot` rule — shading must work out *whose* room it
//     hit, not assume the camera's — still holds, and every lighting term below
//     resolves the room from the point's own depth. But the frame-rotation half
//     of that bug is structurally impossible here, since a point's coordinates
//     never depend on which room owns it.
//   * "nothing added to the SDF may enter the walked tube" is trivial when the
//     walked tube is the +Z axis. CLEAR_* below is a cross-section, subtracted
//     from every prop, and it cannot fail to clear the cart.
//
// SDF discipline is natatorium's, unchanged: rooms are carved by unioning air
// volumes and negating, with `min` and `max` only. `smin` returns up to k/4
// *below* its inputs, so negating a smoothed union over-estimates and a grazing
// ray at a portal punches through the rock.
//
// ---------------------------------------------------------------------------
// Two spaces, and which one everything lives in
// ---------------------------------------------------------------------------
//
// *Track space* is where the world is: rail head at y = 0, track along +Z, the
// cart's eye at (0, eye, 0). `mapTrack` is the scene, it is built from exact
// primitives, and it is genuinely 1-Lipschitz. Shadows, occlusion, normals and
// every lighting term run here, natively, with no correction of any kind.
//
// *Camera space* exists only for the primary march, because that is the one
// place a ray has to be straight. `mapScene(p) = mapTrack(toTrack(p)) / k(z)`,
// where the divisor is the shear's Lipschitz bound: for T(p) = (p.xy - bend(z), z)
// the Jacobian is the identity plus bend'(z) in one column, so |grad(f o T)| is
// at most 1 + |bend'(z)| and dividing by that is provably conservative. It is a
// function of z, so near geometry marches at full speed and only the far end of
// a hard turn pays.
//
// The hit point crosses over once, exactly, via toTrack — which is exact, not an
// approximation — and after that nothing downstream knows the bend exists. Doing
// it the other way round (shading in camera space) means every normal is the
// gradient of the *sheared* field and every light direction is wrong by an angle
// that grows down the hall.
//
// Uniforms (see kinematics.ts `uniforms()`), three slots each:
//   uSecA[i] (z0, z1, type, bore)      section bounds as depth ahead of the cart
//   uSecB[i] (ceilH, floorD, lampPitch, grime)
//   uSecC[i] (sky, id, lit, -)
//   uBend    (ax, bx, ay, by)          bend(z) = (ax*z+bx*z*z, ay*z+by*z*z)
//   uCart    (phase, speed, lapF, eye)
//   uRide    (lookYaw, lookPitch, headRoll, sky)
//   uAtm     (lightFail, decay, grade, bank)
//   uSun     (sun direction in the track's frame, intensity)
//   uUp      (world up in the track's frame, sky of the current room)

const COMMON = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;

  uniform vec4 uSecA[3];
  uniform vec4 uSecB[3];
  uniform vec4 uSecC[3];
  uniform vec4 uBend;
  uniform vec4 uCart;
  uniform vec4 uRide;
  uniform vec4 uAtm;
  uniform vec4 uSun;
  uniform vec4 uUp;

  /**
   * The fall and the fissures.
   *   x  0..1 how far into the shaft
   *   y  0..1 speed past everything the railway was capable of, logarithmic
   *   z  the shaft's corkscrew, radians, wrapped
   *   w  0..1 fissure density — grows every lap, saturates in the shaft
   */
  uniform vec4 uFall;

  const float PI = 3.14159265;

  // Room types. Kept in step with kinematics.ts by hand, which is the one piece
  // of duplication this design could not remove: a fragment shader cannot import.
  const float T_PLATFORM  = 0.0;
  const float T_DRIFT     = 1.0;
  const float T_SCAFFOLD  = 2.0;
  const float T_CONCOURSE = 3.0;
  const float T_CHAPEL    = 4.0;
  const float T_OVERLOOK  = 5.0;

  // The seventh room, which is not in the lap and is not a room. Past four laps
  // the rails stop and this is what is on the other side of them.
  const float T_FALL      = 6.0;

  // Half the track gauge. Narrow, because this is an ore railway that something
  // later decided to run a train of open tubs down.
  const float GAUGE = 0.45;

  // Sleeper and trestle-bay pitches. Both divide PHASE_WRAP on the CPU side —
  // that is what lets the phase be folded without the whole railway jumping.
  const float TIE_PITCH  = 2.5;
  const float BENT_PITCH = 10.0;

  // Ditto: the chapel's fold is mirrored on this period so that it, too, survives
  // the fold in the phase. Nothing else in the journey is aperiodic along z.
  const float FOLD_PITCH = 64.0;

  // Rooms extend this far past both ends of their nominal z-range. Load bearing:
  // two adjacent air volumes would otherwise only touch on a plane, the union
  // would read exactly 0 there, and the march would see the portal as sealed.
  const float OVERLAP = 1.2;

  // The swept clearance, as a cross-section. Every prop is intersected with the
  // complement of this, so nothing can be authored into the cart's path. In a
  // rectified space the swept tube is a constant, which is the whole trick.
  const vec2 CLEAR_C = vec2(0.0, 1.05);
  const vec2 CLEAR_H = vec2(1.32, 1.20);

  // How far the march is allowed to reach. Past this everything is fog anyway,
  // and the bend fit is pinned at 56 — beyond that the quadratic is extrapolating.
  const float T_MAX = 92.0;

  /**
   * Volumetric sampling: a fixed step in metres, not a fixed fraction of however
   * far this particular ray got.
   *
   * A fraction of the hit distance is the obvious way to write it and it is the
   * one that draws a hard line across the picture. The estimator scales with the
   * spacing, the spacing scales with the hit distance, and the hit distance jumps
   * by tens of metres across a silhouette — so every silhouette in the frame gets
   * a step change in the glow *beside* it, and in a tunnel that dives away from
   * you the silhouette is the roofline: one razor-straight horizontal edge, from
   * one side of the screen to the other, that no geometry accounts for.
   *
   * With a fixed step, moving the far end only adds or removes the last sample,
   * and that one is faded in over its own step (see VOL_FADE below) so even that
   * is continuous. Sixteen steps of 2.6m reaches past where any of this fog lets
   * you see anyway.
   */
  const float VOL_STEP = 2.6;

  /** Everything one room knows about itself. Resolved from a depth by roomAt. */
  struct Room {
    float type;
    float bore;
    float ceilH;
    float floorD;
    float lamp;    // pitch along the track
    float lampY;   // and the height they hang at
    float grime;
    float sky;
    float lit;
  };

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      a *= 0.5;
    }
    return s;
  }

  /** Grid Run's hue ramp. Three phase-shifted sines, and it never leaves gamut. */
  vec3 hue(float a) { return 0.5 + 0.5 * sin(3.14159 * a + vec3(1.0, 2.0, 3.0)); }

  // ---- primitives. Exact, all of them, so the step factor can stay near 1. ----

  float sdBox2(vec2 p, vec2 b) {
    vec2 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  float sdRoundBox(vec3 p, vec3 b, float r) { return sdBox(p, b - r) - r; }

  /**
   * Fold onto the nearest cell of an unbounded lattice. Exact for identical
   * axis-aligned instances — on a lattice of congruent shapes the nearest centre
   * really is the nearest instance, which is why nothing repeated in this file
   * jitters its *position*, however much it would like to.
   */
  float latt(float x, float cell) { return x - (floor(x / cell) + 0.5) * cell; }

  /**
   * The same fold, continuous. 'latt' jumps by a whole cell at every boundary, so
   * anything *accumulated along a ray* from it draws the lattice instead of the
   * light — natatorium learned this the expensive way, with a volumetric that
   * rendered as a flat tile-shaped rectangle instead of a shaft. abs() of it is a
   * triangle wave, is continuous everywhere, and is still 1-Lipschitz, which is
   * what both a swept term and a mirrored SDF need.
   */
  float lattAbs(float x, float cell) { return abs(latt(x, cell)); }

  // ---- the bend ------------------------------------------------------------

  vec2 bendAt(float z)  { return vec2(uBend.x * z + uBend.y * z * z, uBend.z * z + uBend.w * z * z); }
  vec2 bendDot(float z) { return vec2(uBend.x + 2.0 * uBend.y * z, uBend.z + 2.0 * uBend.w * z); }

  /** Camera space -> track space. Exact. */
  vec3 toTrack(vec3 p) {
    vec2 b = bendAt(p.z);
    return vec3(p.x - b.x, p.y - b.y + uCart.w, p.z);
  }

  /** A *direction* into track space, at the depth it is being used at. */
  vec3 toTrackDir(vec3 v, float z) {
    vec2 b = bendDot(z);
    return normalize(vec3(v.x - b.x * v.z, v.y - b.y * v.z, v.z));
  }

  /** The Lipschitz bound of that shear. Never below 1, so it can only shorten a step. */
  float lipschitz(float z) { return 1.0 + length(bendDot(z)); }

  /** Distance along the track, folded, for everything that repeats. */
  float phaseAt(float z) { return z + uCart.x; }

  // ---- the fissures --------------------------------------------------------
  //
  // One field, read twice: once by the surface, where it is a split in the wall,
  // and once by the volumetrics, where it is the beam coming through the split.
  // Sharing it is not an optimisation — it is the only way a beam reliably has a
  // crack at the end of it, and two fields tuned to look alike drift apart the
  // moment either is touched.

  /**
   * The vein field. Its zero set is the fissure; a widens it and, separately,
   * lowers the patch threshold, so the first lap shows one split in a wall and
   * the fourth shows a craquelure.
   */
  float fissure(vec2 uv, float a) {
    float v = fbm(uv * 0.55) - 0.5;
    float w = 0.010 + a * 0.030;
    float seam = smoothstep(w, w * 0.15, abs(v));

    // The patch term is what keeps this a set of cracks rather than a texture.
    // Without it — or with it opened too far — the seams reach everywhere at
    // once and the wall stops reading as broken and starts reading as red.
    float patch = smoothstep(0.60 - a * 0.30, 0.88 - a * 0.30, fbm(uv * 0.12 + 4.7));
    return seam * patch;
  }

  /**
   * Where on the wall a point is, as the fissure field's coordinates.
   *
   * Low frequency on purpose: a crack is metres long. At the frequency this
   * started at the field was finer than the fog could resolve, so every beam
   * landed on top of every other one and the whole shaft turned into static.
   */
  vec2 fissureUV(vec3 q, float side) {
    return vec2(phaseAt(q.z) * 0.42, q.y * 1.15 + side * 4.3);
  }

  /**
   * The shaft's corkscrew.
   *
   * The rotation is an isometry and costs the sphere trace nothing. The lateral
   * snake after it is a shear, and its slope is held at 0.07 so mapTrack's claim
   * to be 1-Lipschitz is still true to within the 0.92 the march already steps at.
   */
  vec3 fallWarp(vec3 q) {
    float a = uFall.z + q.z * 0.0125;
    float c = cos(a), sn = sin(a);
    q.xy = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
    q.x += sin(q.z * 0.032 + uFall.z * 2.0) * 2.2 * uFall.x;
    return q;
  }

  // ---- rooms ---------------------------------------------------------------

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

  // ---- the scene -----------------------------------------------------------
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

const SCENE = `
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

  // ---- surfaces ------------------------------------------------------------

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

  // ---- lights --------------------------------------------------------------

  vec3 directLight(vec3 q, vec3 n, vec3 vdir, float rough, float ao) {
    Room r = roomAt(q.z);

    vec3 tint = lampTint(r.type);
    vec3 col = vec3(0.0);

    if (r.lamp > 0.5 && r.lit > 0.01) {
      vec3 lv = lampPos(q, r) - q;
      float ld = max(length(lv), 0.08);
      vec3 l = lv / ld;
      float atten = 1.0 / (1.0 + ld * 0.16 + ld * ld * 0.05);

      // Fluorescent buzz, and lamps that have started to give up. Per lamp, not
      // per room, so the failure reads as a building rather than as a dimmer.
      float flick = 1.0 - uAtm.x * 0.55 *
        step(0.90, hash21(vec2(floor(iTime * 12.0), floor(phaseAt(q.z) / max(r.lamp, 1.0)))));

      float sh = shadowTo(q, l, min(ld, 16.0));
      float k = atten * r.lit * flick * sh;

      col += tint * max(dot(n, l), 0.0) * k * 3.4;
      vec3 h = normalize(l + vdir);
      col += tint * pow(max(dot(n, h), 0.0), mix(8.0, 220.0, 1.0 - rough)) * k * (1.0 - rough) * 2.2;
    }

    // The cart's headlamp. The one light that is in every room, and the reason
    // the dark half of this journey is legible at all. Unshadowed on purpose —
    // it sits inside the cart's own geometry, and a shadow ray from there spends
    // its whole budget escaping the tub.
    {
      vec3 hv = vec3(0.0, 0.80, 1.5) - q;
      float hd = max(length(hv), 0.20);
      vec3 l = hv / hd;
      float cone = smoothstep(0.50, 0.95, dot(-l, normalize(vec3(uRide.z * 0.4, -0.10, -1.0))));
      float bump = 0.88 + 0.12 * sin(iTime * 37.0) * min(1.0, uCart.y / 12.0);
      col += vec3(1.00, 0.93, 0.80) * max(dot(n, l), 0.0) *
             (1.0 / (1.0 + hd * hd * 0.010)) * cone * bump * 2.8;
    }

    if (r.sky > 0.01) {
      // The sun's shadow is the one term here worth switching off. uHeavy is a
      // uniform, so the branch is coherent across the whole draw and the fourteen
      // map evaluations behind it are genuinely skipped rather than masked.
      float sh = uHeavy > 0.5 ? mix(1.0, shadowTo(q, uSun.xyz, 30.0), 0.85) : 1.0;
      vec3 sunCol = mix(vec3(1.00, 0.72, 0.58), vec3(0.78, 0.46, 0.52), uAtm.y * 0.6);
      col += sunCol * max(dot(n, uSun.xyz), 0.0) * r.sky * sh * 3.4;
    }

    // Ambient: the room's own fog bounced back, plus whatever the weather gets in.
    vec3 amb = roomFog(r.type, r.grime) * 3.0 + skyAmbient(r.type, uAtm.y) * r.sky * 0.65;
    return col + amb * (0.45 + 0.55 * max(dot(n, uUp.xyz), 0.0)) * ao;
  }

  // ---- volumetrics ---------------------------------------------------------

  /**
   * The lamps seen through the air rather than off a surface. Room resolved per
   * sample, for the same reason the surface term resolves it: a halo swept along
   * a ray goes wherever you look, so it has to be evaluated where it *is*, not
   * where the cart is — otherwise every halo on screen jumps the instant the slot
   * window advances while nothing behind it moves.
   */
  vec3 lampGlow(vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    // Jittered start, so sixteen samples do not draw sixteen shells.
    float j = hash21(gl_FragCoord.xy) * VOL_STEP;

    for (int k = 0; k < 16; k++) {
      float t = j + (float(k) + 0.5) * VOL_STEP;
      if (t > tMax) break;
      float w = clamp((tMax - t) / VOL_STEP, 0.0, 1.0);   // the boundary sample, faded

      vec3 q = toTrack(rd * t);
      Room r = roomAt(q.z);
      if (r.lamp < 0.5) continue;

      float d = length(q - lampPos(q, r));
      acc += lampTint(r.type) * r.lit * (0.05 / (0.06 + d * d * 0.24)) * w;
    }
    return acc * VOL_STEP * 0.055;
  }

  /**
   * Shafts: the vent holes over the drift, the clerestory over the concourse,
   * whatever is behind the chapel's ribs.
   *
   * Built from lattAbs rather than latt, because a term accumulated along a ray
   * has to be continuous in space or it draws its own quantisation — adjacent
   * pixels' taps land in the same cell, the per-cell answer is flat across it,
   * and what appears on screen is a rectangle rather than a shaft.
   */
  /**
   * Light coming through the fissures.
   *
   * Sampled on the wall the beam comes through rather than at the sample point:
   * a crack is a thing on a surface and the shaft of light is the air in front
   * of it. Reading the field where the sample happens to be gives fog with a
   * pattern in it — which is a completely different and much worse effect.
   */
  float riftBeam(vec3 q, Room r) {
    // A crack needs a wall to be in. The void and the overlook have none, and
    // putting beams in them hangs the light in mid-air across an open sky.
    if (uFall.w < 0.03 || r.bore > 50.0) return 0.0;

    float wall = r.bore;
    float side = q.x < 0.0 ? -1.0 : 1.0;
    float f = fissure(fissureUV(q, side), uFall.w);

    // The wedge: full against the wall, gone before the middle of the room.
    float inward = smoothstep(wall * 1.05, wall * 0.12, abs(q.x));
    return f * inward * uFall.w * (0.45 + uFall.x * 1.7);
  }

  vec3 shafts(vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    float j = hash21(gl_FragCoord.xy + 17.3) * VOL_STEP * 2.0;

    for (int k = 0; k < 10; k++) {
      float t = j + (float(k) + 0.5) * VOL_STEP * 2.0;
      if (t > tMax) break;
      float w = clamp((tMax - t) / (VOL_STEP * 2.0), 0.0, 1.0);

      vec3 q = toTrack(rd * t);

      Room r = roomAt(q.z);

      // The rift beams need no sky. The light is coming through the wall, and a
      // sealed room is exactly where that reads hardest — so this is accumulated
      // before the daylight branches, not inside them.
      acc += vec3(1.00, 0.09, 0.05) * riftBeam(q, r) * w * 2.0;

      if (r.sky < 0.03) continue;

      float zp = phaseAt(q.z);
      vec3 tone;
      float m;

      if (r.type < T_SCAFFOLD - 0.5) {
        // A vent every twenty-four metres, dropping a cone of daylight and dust.
        float h = clamp((q.y + r.floorD) / (r.ceilH + r.floorD), 0.0, 1.0);
        m = smoothstep(2.1, 0.0, lattAbs(zp, 24.0) + abs(q.x - 0.6) * 0.8) * mix(0.12, 1.0, h);
        tone = vec3(0.88, 0.90, 0.94);
      }
      else if (r.type < T_CHAPEL - 0.5) {
        // Between the mullions, raked across the concourse at sunset.
        m = smoothstep(0.42, 0.86, lattAbs(q.x, 1.9)) * smoothstep(-0.5, r.ceilH, q.y) * 0.9;
        tone = vec3(1.00, 0.68, 0.58);
      }
      else if (r.type < T_OVERLOOK - 0.5) {
        // The chapel. Broad, slow, gold, and coming from behind the ribs.
        m = smoothstep(2.2, 0.2, lattAbs(zp, 8.0)) * smoothstep(0.0, r.ceilH * 0.8, q.y) * 2.2;
        tone = vec3(1.00, 0.82, 0.50);
      }
      else continue;

      acc += tone * m * r.sky * w;
    }
    return acc * VOL_STEP * 2.0 * 0.012;
  }

  /**
   * The motes: chalk dust, rust flakes, ash, petals, whichever the room carries.
   *
   * Layered billboards on planes at fixed depths, which is what the Sakura pen
   * does with real geometry and a depth-of-field pass. The bokeh is the whole
   * effect — a mote near the focal plane is a point and one off it is a soft
   * disc, and that single fact is what makes flat sprites read as *air*.
   */
  vec3 motes(vec3 rd, float tMax, float type, float decay) {
    if (rd.z < 0.10) return vec3(0.0);

    vec3 tone;
    float rate, dens;
    if (type > T_OVERLOOK + 0.5)       { tone = vec3(1.00, 0.34, 0.18); rate = 0.55; dens = 0.34; }
    else if (type < T_DRIFT - 0.5)     { tone = vec3(0.80, 0.88, 0.82); rate = 0.10; dens = 0.26; }
    else if (type < T_SCAFFOLD - 0.5)  { tone = vec3(0.94, 0.86, 0.72); rate = 0.16; dens = 0.62; }
    else if (type < T_CONCOURSE - 0.5) { tone = vec3(0.58, 0.60, 0.80); rate = 0.30; dens = 0.30; }
    else if (type < T_CHAPEL - 0.5)    { tone = vec3(1.00, 0.80, 0.74); rate = 0.12; dens = 0.38; }
    else if (type < T_OVERLOOK - 0.5)  { tone = vec3(1.00, 0.88, 0.68); rate = 0.08; dens = 0.46; }
    else                               { tone = vec3(1.00, 0.72, 0.76); rate = 0.22; dens = 1.00; }

    // The overlook's are petals, not dust: bigger, slower, and they are the one
    // thing in this journey lifted whole from the Sakura pen. Everything else in
    // the air here is half a millimetre of somebody's ceiling.
    float grain = type > T_CHAPEL + 0.5 ? 1.9 : 1.0;
    if (type > T_OVERLOOK + 0.5) grain = 2.6;

    tone = mix(tone, vec3(0.44, 0.42, 0.42), decay * 0.7);

    vec3 acc = vec3(0.0);
    for (int k = 0; k < 5; k++) {
      float depth = 1.6 + float(k) * float(k) * 2.1;
      float near = smoothstep(depth, depth - 1.2, tMax);
      if (near > 0.999) break;                    // this layer is behind the surface

      // The plane at this depth, in metres, falling and drifting and dragged
      // backwards by the draught the cart makes.
      vec2 pl = rd.xy / rd.z * depth
              + vec2(sin(iTime * rate + float(k) * 2.1) * 0.7,
                     -iTime * rate * 2.2 - uCart.x * 0.06);

      // Cells are metres, not screen space. This is the whole difference between
      // dust and a lava lamp: a mote is a *thing*, half a centimetre across, so
      // its size on screen has to fall off with depth like everything else does.
      // Scaled in screen space it does the opposite — the nearest layer draws the
      // biggest cells, and the biggest cells draw the biggest discs.
      float cellW = 0.85 + float(k) * 0.35;
      vec2 cell = pl / cellW;
      vec2 id = floor(cell);
      float h = hash21(id + float(k) * 31.7);
      if (h > dens) continue;

      vec2 jitter = vec2(hash21(id + 4.1), hash21(id + 8.3)) - 0.5;
      float rm = length(fract(cell) - 0.5 - jitter * 0.7) * cellW;

      // Bokeh. A mote off the focal plane spreads into a disc, and a disc of the
      // same light spread wider is dimmer by its area — dropping that second half
      // is what turns a depth-of-field into a snowstorm.
      float blur = 1.0 + abs(depth - 3.2) * 0.22;
      float size = (0.020 + 0.012 * h) * blur * grain;
      acc += tone * smoothstep(size, size * 0.30, rm) * (0.35 + h) * (1.0 - near) / (blur * blur);
    }
    return max(acc, 0.0) * 0.55;
  }

  // ---- main ----------------------------------------------------------------

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // The camera does not move and does not turn — the world bends around it.
    // These three are the only angles in the journey, and none of them belongs to
    // the track: where the rider is looking, and how far their head has lagged
    // the car's roll.
    float yaw   = uRide.x + uPointer.x * 0.55;
    float pitch = uRide.y + uPointer.y * 0.33;
    float roll  = uRide.z;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up  = cross(fwd, rgt);

    float cr = cos(roll), sr = sin(roll);
    vec3 r2 = rgt * cr - up * sr;
    up  = rgt * sr + up * cr;
    rgt = r2;

    // Speed widens the lens. Oldest trick in the coaster-cam book, worth every
    // one of its three instructions: nothing else makes 60 km/h feel like 60 km/h
    // in a picture with no motion blur in it.
    float rush = clamp(uCart.y / 20.0, 0.0, 1.0);

    // uCart.y pins rush at twenty metres a second, which was the fastest this
    // railway ever went. The fall goes past that by two orders of magnitude, so
    // the lens keeps opening on a term that has no ceiling in it either.
    vec3 rd = normalize(uv.x * rgt + uv.y * up +
      (mix(1.20, 0.80, rush) - uFall.y * 0.30) * fwd);

    // --- march, in camera space, the one place the ray is straight ---
    //
    // The hit epsilon widens with distance at roughly one pixel per metre of
    // depth, which is the whole reason this journey can be shot down a
    // three-metre bore at all. A ray fired down a long narrow tunnel is grazing
    // the wall for its entire length: every step is small, positive and useless,
    // and with a tight epsilon it burns all hundred and ten of them without ever
    // converging. A cone epsilon ends those rays where the surface is already
    // sub-pixel, and it can only ever stop a march *earlier*, never overshoot it.
    float t = 0.03;
    bool hit = false;
    for (int i = 0; i < 110; i++) {
      float d = mapScene(rd * t);
      if (d < 0.0022 + t * 0.0016) { hit = true; break; }
      // 0.92 rather than natatorium's 0.95: the chapel's fold is a Chebyshev
      // bound rather than a euclidean distance — honest, but slack — and the
      // extra three percent is what stops its ribs stippling.
      t += d * 0.92;
      if (t > T_MAX) break;
    }

    // A ray that ran out of iterations short of T_MAX did not miss — it is
    // crawling along a surface it never quite touched. Calling that a miss is
    // how the chalk drift came to have a sunset in it: one wing-shaped hole
    // through the roof of a tunnel, in exactly the shape of the tunnel.
    if (!hit && t < T_MAX) hit = true;

    float tEnd = min(t, T_MAX);
    vec3 col;

    // A room is a range of *depth*, and a ray that is not looking straight down
    // the track covers less depth than distance. roomAt(tEnd) says a ray fired
    // sideways at ninety metres is ninety metres down the line, which is how the
    // chalk drift came to be lit — and skied — by the room two portals away.
    float zEnd = rd.z * tEnd;

    // The air near the cart, which is what the motes are floating in and what the
    // rush glow is picking up. Not the room at the far end of the ray.
    Room near = roomAt(rd.z * 2.0);

    // What is behind everything, seen from here. Evaluated once: it is both the
    // miss colour and, weighted by how open each room is, the colour the fog
    // tends to — which is the same statement twice, and writing it as two
    // different colours is what turned the overlook's sunset into a grey card.
    vec3 skyC = skyColor(toTrackDir(rd, 45.0), roomAt(zEnd).type, uAtm.y);

    if (hit) {
      vec3 p = rd * t;
      vec3 q = toTrack(p);                       // the one crossing, and it is exact
      vec3 n = calcNormal(q, t);

      // Re-evaluate at the converged point so gMat describes the surface actually
      // hit rather than wherever the normal's last tap happened to land.
      mapTrack(q);

      Room r = roomAt(q.z);

      float rough;
      vec3 emit;
      vec3 albedo = materialAlbedo(gMat, q, n, r, t, rough, emit);

      vec3 vdir = -toTrackDir(rd, p.z);
      col = albedo * directLight(q, n, vdir, rough, calcAO(q, n)) + emit;
    }
    else {
      col = skyC;
    }

    // --- atmosphere ---
    //
    // Sampled along the ray rather than taken from whatever it ended up hitting.
    // Rooms genuinely have different air, and the boundary between two of them is
    // a portal you can see through — so a ray that crosses one is carrying a
    // mixture, and reading the far room's fog all the way back to the lens turns
    // every portal into a colour that snaps.
    //
    // A ray that hit nothing is fogged too, and has to be. It only *looks* like a
    // ray to infinity; in a mine it is fifty metres of the drift's dust and then
    // the hole at the end of it, and skipping the fog there paints the far sky
    // over the near air at full strength.
    //
    // Each sample's fog tends toward the sky in proportion to how open its room
    // is, so a room with the roof off fogs toward exactly what is behind it and
    // the mix is a no-op — which is the only way an open section can have honest
    // aerial perspective on its trestle without laying haze over its own sunset.
    vec3 fogCol = vec3(0.0);
    float dens = 0.0;
    for (int k = 0; k < 3; k++) {
      Room fr = roomAt(zEnd * (0.2 + 0.35 * float(k)));
      fogCol += mix(roomFog(fr.type, fr.grime), skyC, fr.sky);
      dens += fogDensity(fr.type);
    }
    fogCol /= 3.0;
    dens *= (1.0 + uAtm.y * 0.5) / 3.0;

    // The fog has to be *complete* by the march limit, not merely thick.
    //
    // T_MAX is where a ray gives up, and either side of that limit it renders
    // two different things: the sky, or whatever it was about to hit. If any of
    // the surface still shows through at ninety-two metres, the boundary between
    // those two is a step — and since the boundary is the set of directions that
    // just barely reach something, it is a smooth curve across the picture. Over
    // the overlook it was a perfect dark arc hanging in the sunset with no object
    // anywhere near it.
    //
    // Forcing the last quarter of the range to full fog costs nothing (it is
    // already at a few percent there) and makes the seam unrepresentable.
    float f = exp(-tEnd * dens) * (1.0 - smoothstep(T_MAX * 0.72, T_MAX, tEnd));
    col = mix(fogCol, col, f);

    col += lampGlow(rd, tEnd);
    col += shafts(rd, tEnd) * (0.55 + uHeavy * 0.45);
    col += motes(rd, tEnd, near.type, uAtm.y);

    // Grid Run's atmosphere accumulator, which is as close as a single pass gets
    // to motion blur: light picked up along the whole ray, brightest where the
    // ray is shortest — so the walls whipping past the cart glow and the far end
    // of the hall does not. In the void it takes Grid Run's hue ramp with it,
    // because in a room with no light and no colour of its own, the only thing
    // left to tell you how fast you are going is what the steel is doing.
    float pickup = 0.05 / (0.05 + tEnd * 0.6);
    vec3 rushTint = near.type > T_DRIFT + 0.5 && near.type < T_CONCOURSE - 0.5
      ? hue(0.35 + tEnd * 0.02 + uCart.x * 0.004) * 1.4
      : lampTint(near.type);
    col += rushTint * pickup * rush * 0.45 * (1.0 + uFall.y * 2.4);

    // --- inline post (no FBO in a single-pass journey) ---

    // A power cut arriving one lap at a time.
    col *= 1.0 - uAtm.x * 0.28 * step(0.965, hash21(vec2(floor(iTime * 15.0), 3.0)));

    // Vignette, tightened by speed. The tunnel closing in is the sensation.
    col *= 1.0 - smoothstep(0.38, 1.20, length(uv * vec2(1.0, 1.08)))
      * (0.40 + rush * 0.24 + uFall.y * 0.26);

    // Cheap bloom: the bright half of the image added back to itself.
    col += col * smoothstep(0.70, 1.7, dot(col, vec3(0.299, 0.587, 0.114))) * 0.40;

    // Reinhard with a white point rather than a clamp. A clamp is what turns a lit
    // tile wall into featureless paper — everything past the ceiling becomes
    // exactly 1.0 and the grout, the courses and the cracks flatten into one area.
    // This compresses instead, so a highlight stays a highlight and keeps its
    // detail; past 2.7 it is a lamp, and lamps are allowed to be white.
    col = max(col, 0.0);
    col = col * (1.0 + col / (2.7 * 2.7)) / (1.0 + col);

    // atzedent's lift, kept on a short leash and on a very long falloff. Grid Run
    // roots the middle of the frame and multiplies it back up, which is glorious
    // over a lit lattice and ruinous over the void: a sixteenth of nothing is
    // still nothing until you take its square root, and then it is a grey card.
    //
    // The falloff has to reach past the corners. Anything that saturates inside
    // the frame draws its own boundary, and over a smooth gradient — the sunset
    // above the overlook, say — a term that stops changing halfway out is a
    // perfect circle hanging in the sky with nothing behind it.
    col = mix(col, sqrt(col) * 0.90, 0.15 * (1.0 - smoothstep(0.0, 1.6, dot(uv, uv))));

    col = pow(col, vec3(0.94));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.026;

    gl_FragColor = vec4(col, 1.0);
  }

`

export const switchbackFrag = COMMON + SCENE

// Hover preview. Self-driving from iTime alone: ShaderPreviewLayer attaches no
// simulation, so uBend/uCart/uSec would all read zero and the real shader would
// render one flat frame forever. No raymarch either — every card in the grid
// shares a single GL context. The job is to read as "you are in a mine cart" at
// 300px, which is what two rails converging into a headlamp pool, sleepers
// whipping under the nose, and the nose itself do, in that order.
export const switchbackPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.07;

    // The track sweeps as it would under a bend and dives as it would on a drop.
    float sweep = sin(iTime * 0.42) * 0.30;
    float horizon = 0.16 + cos(iTime * 0.31) * 0.10 - 0.02;

    float fy = max(horizon - uv.y, 1e-3);

    // Perspective floor out of one divide: depth runs to infinity at the horizon,
    // exactly as the real thing does.
    float depth = 0.55 / fy;
    float run = depth + iTime * 5.2;
    float lateral = (uv.x + sweep * depth * 0.10) * depth;

    vec3 col;

    if (uv.y > horizon) {
      float arch = length(vec2(uv.x * 1.25, (uv.y - horizon) * 0.9));
      col = mix(vec3(0.10, 0.09, 0.085), vec3(0.020, 0.018, 0.026), smoothstep(0.12, 0.62, arch));
      col += vec3(1.00, 0.72, 0.40) * smoothstep(0.55, 0.30, arch) * 0.10;
    }
    else {
      float grit = hash21(floor(vec2(lateral * 3.0, run * 3.0)));
      col = mix(vec3(0.20, 0.18, 0.16), vec3(0.10, 0.09, 0.08), grit);

      float tie = smoothstep(0.30, 0.16, abs(fract(run * 0.42) - 0.5) * 2.0 - 0.42);
      tie *= smoothstep(2.6, 2.2, abs(lateral));
      col = mix(col, vec3(0.26, 0.19, 0.12), tie);

      float rail = smoothstep(0.14, 0.03, abs(abs(lateral) - 1.05));
      col = mix(col, vec3(0.62, 0.63, 0.66), rail * 0.9);
      col += vec3(1.0, 0.86, 0.62) * rail * smoothstep(6.0, 1.2, depth) * 0.55;

      col *= smoothstep(15.0, 1.0, depth) * 1.5 + 0.06;
    }

    // The nose of the cart, always in frame.
    float edge = -0.30 - abs(uv.x) * 0.045;
    col = mix(col, vec3(0.15, 0.19, 0.17), smoothstep(0.0, 0.02, edge - uv.y));
    col = mix(col, vec3(0.34, 0.38, 0.35), smoothstep(0.02, 0.0, abs(uv.y - edge) - 0.012));

    // Dust in the beam.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 m = uv * (2.4 + fi) + vec2(sin(iTime * 0.3 + fi) * 0.4, -iTime * (0.15 + fi * 0.08));
      vec2 id = floor(m);
      float h = hash21(id + fi * 17.0);
      if (h > 0.28) continue;
      float r = length(fract(m) - 0.5 - (vec2(hash21(id + 3.0), hash21(id + 7.0)) - 0.5) * 0.6);
      col += vec3(0.9, 0.82, 0.7) * smoothstep(0.14, 0.03, r) * 0.16;
    }

    col *= 1.0 - smoothstep(0.4, 1.15, length(uv)) * 0.55;
    col = col * (1.0 + col / 4.0) / (1.0 + col);
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 51.7) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
