// THE FOUNDRY — a first-person walk around a machine hall that never ends.
//
// Companion piece to THE LIMINAL JOURNEY: the same endlessly repeating
// first-person traversal, but the corridors are machinery and the motion is not
// authored. Every moving thing in this shader is positioned by uniforms produced
// by the rigid-body integrator in physics.ts — the walker's gait (head height on
// a leg spring, lateral sway, roll and yaw all read off footfalls), a hoist cage
// falling in the shaft that crosses the corridor, six tumbling debris bodies
// (position + orientation quaternion), the exact slider-crank piston extension,
// and two pendulums swung by the cage's acceleration and by your own footsteps.
// The shader draws state; it does not invent motion.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only. Uniforms beyond the shared set:
//   uWalk    = (cyclicZ, smoothLoop, decay, headRoll)
//   uGait    = (eyeY, swayX, headYaw, headPitch)
//   uCage    = (floorY, velocity, acceleration, phase)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, cageHookAngle, hallChainAngle)
//   uDebris  = 6 x (cageX, worldY, cageZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion
//   uFold0/1 = fold coordinate of the 8 folding-span cubes
//
// THE LOOP. The world is periodic in the walk: seven 36 m halls (loading bay,
// piston gallery, long run, coolant tier, gearworks, brake run, furnace floor)
// laid end to end, and everything is keyed off mod(z, CYCLE) — so the seventh
// hall runs straight back into the first with no seam, no fade and no teleport.
// Every boundary, the wrap included, is handled by exactly one rule (see
// secBlend): the last TRANS metres funnel the corridor profile into the next
// hall's proportions, the last FEAT_FADE metres erode this hall's machinery
// away while the next hall's already stands beyond the doorway, and a bulkhead
// portal is bolted across the join. Seven identical doorways. Two events
// punctuate the circuit: the hoist shaft crossing mid-way down the brake run,
// where the cable parts and the cage plunges past you into its buffers, and the
// folding span over the melt, where the floor is gone and the only walkway is a
// line of cubes unfolding their faces a moment before you stand on them.
//
// THE DECAY. Each completed loop leaves the foundry a little less sure of
// itself: the corridor snakes and breathes, the walls close in, lamps fail,
// the lens barrels, whole scanlines tear sideways and the grade rots toward
// oxblood. Same road, worse every time round.

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (steam volumetrics, extra sparks)

  uniform vec4 uWalk;          // cyclicZ, smoothLoop, decay, headRoll
  uniform vec4 uGait;          // eyeY, swayX, headYaw, headPitch
  uniform vec4 uCage;          // floorY, velocity, acceleration, phase
  uniform vec4 uSim;           // shakeX, shakeY, brakeSpark, cableIntact
  uniform vec4 uMech;          // crank, pistonExtension, hookAngle, chainAngle
  uniform vec4 uDebris[6];     // xz = cage-frame position, y = world height, w = scale
  uniform vec4 uDebrisQ[6];    // orientation quaternion
  uniform vec4 uFold0;         // fold coordinate of span cubes 0..3
  uniform vec4 uFold1;         // fold coordinate of span cubes 4..7

  const float PI = 3.14159265359;

  // --- the loop (mirrors physics.ts) ---------------------------------------
  const float SEC_LEN = 36.0;
  const float SEC_COUNT = 7.0;
  const float CYCLE = 252.0;   // SEC_LEN * SEC_COUNT
  const float TRANS = 9.0;      // profile funnel length at every boundary
  const float FEAT_FADE = 3.0;  // machinery dissolve length at every boundary
  const float FEAT_ERODE = 2.2; // how far a dissolving fitting is offset away

  // --- the hoist shaft crossing (mirrors physics.ts) ------------------------
  const float CROSS_Z = 198.0;  // mid brake run, clear of the bulkheads
  const float SHAFT_R = 2.4;
  const float SHAFT_HEAD = 34.0;
  const float WELL_Y = -46.0;
  const float CAGE_R = 1.5;
  const float CAGE_H = 2.6;

  // --- the folding span (mirrors physics.ts) --------------------------------
  const float SPAN_Z0 = 220.0;
  const float CUBE_SP = 4.0;
  const float CUBE_H = 1.2;
  const float PANEL_T = 0.07;
  const float SPAN_MID = 234.0;  // centre of the cut in the furnace floor
  const float SPAN_HALF = 16.0;  // half-length of that cut
  const float MELT_Y = -30.0;

  // Material/look state written by the SDF at the nearest hit.
  float gMat;      // 0 hall steel, 1 frame, 2 debris, 3 chrome, 4 lamp, 5 rail, 6 panel, 8 melt
  float gWear;     // 0..1 rust/paint-chip weight
  float gGlow;     // emissive weight

  // --- hash / noise --------------------------------------------------------
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < FBM_OCTAVES; i++) { s += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
    return s;
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // Rotate v by quaternion q / by its inverse. Used to bring a world-space
  // sample point into each debris body's local frame.
  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  vec3 qinv(vec4 q, vec3 v) { return qrot(vec4(-q.xyz, q.w), v); }

  // --- SDF primitives ------------------------------------------------------
  float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
  float sdBox2(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  float sdCylY(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdCylX(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.yz) - r, abs(p.x) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdTorusX(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.yz) - R, p.x);
    return length(q) - r;
  }

  // --- the loop's coordinate system ----------------------------------------
  // The walk is unbounded but the world is not: everything is a function of the
  // position *within* one circuit. cycd() is the signed version — continuous
  // across the seam, which is what lets a ray march through the wrap without
  // ever seeing it.
  float cyc(float z) { return z - CYCLE * floor(z / CYCLE); }
  float cycd(float z) { return z - CYCLE * floor(z / CYCLE + 0.5); }

  float secIndexAt(float zc) { return clamp(floor(zc / SEC_LEN), 0.0, SEC_COUNT - 1.0); }

  /**
   * The one transition rule, applied at all seven boundaries including the wrap.
   * It has two halves, because a corridor and the machinery bolted to it want
   * different transitions:
   *   t  — the profile funnel. The corridor's width and height ease from one
   *        hall's proportions into the next over the last TRANS metres, so the
   *        walls visibly flare or choke down as you approach the bulkhead.
   *   tf — the machinery dissolve. Morphing one hall's SDF into another's
   *        leaves ghosts hanging in mid-air (a coolant pipe growing out of
   *        nothing halfway down the long run), so instead each hall's fittings
   *        are *eroded* — offset outward until they thin to nothing — over the
   *        last FEAT_FADE metres, and the next hall's are already standing
   *        beyond the doorway when you get there.
   */
  void secBlend(float zc, out float a, out float b, out float t, out float tf) {
    a = secIndexAt(zc);
    float local = zc - a * SEC_LEN;
    t = smoothstep(SEC_LEN - TRANS, SEC_LEN, local);
    tf = smoothstep(SEC_LEN - FEAT_FADE, SEC_LEN, local);
    b = mod(a + 1.0, SEC_COUNT);
  }

  // Per-hall corridor profile: (half-width, ceiling height). The circuit
  // breathes — tight and riveted at the top, cavernous through the long run,
  // choked down to a slot for the brake run, then opened over the melt.
  vec2 secProfile(float i) {
    if (i < 0.5) return vec2(2.3, 3.4);   // loading bay
    if (i < 1.5) return vec2(3.1, 4.6);   // piston gallery
    if (i < 2.5) return vec2(7.5, 11.0);  // long run
    if (i < 3.5) return vec2(2.6, 3.9);   // coolant tier
    if (i < 4.5) return vec2(4.2, 6.4);   // gearworks
    if (i < 5.5) return vec2(2.1, 3.0);   // brake run
    return vec2(5.0, 8.0);                // furnace floor
  }

  // Per-hall rib and lamp cadence, in metres. Every spacing divides SEC_LEN, so
  // the pattern lands square on each boundary instead of drifting.
  float secRibSpacing(float i) {
    if (i < 0.5) return 3.0;
    if (i < 1.5) return 6.0;
    if (i < 2.5) return 18.0;  // long run: almost nothing to measure against
    if (i < 3.5) return 4.0;
    if (i < 4.5) return 12.0;
    if (i < 5.5) return 3.0;   // brake run: dense, so the pace is legible
    return 9.0;
  }
  float secLampSpacing(float i) {
    if (i < 0.5) return 6.0;
    if (i < 1.5) return 6.0;
    if (i < 2.5) return 18.0;
    if (i < 3.5) return 6.0;
    if (i < 4.5) return 12.0;
    if (i < 5.5) return 4.0;
    return 12.0;
  }

  // --- convenience ---------------------------------------------------------
  float cageY() { return uCage.x; }
  float cageA() { return uCage.z; }
  float spark() { return uSim.z; }
  float decay() { return uWalk.z; }
  float walkZ() { return uWalk.x; }
  // Free fall reads as weightlessness: the cage's acceleration approaches -g.
  float weightless() { return smoothstep(-6.0, -9.2, cageA()); }

  // ============================ GEOMETRY ===================================

  // The hall: floor plate, side walls, ceiling, and the structural ribs at the
  // band's cadence. Positive inside.
  float mapHall(vec3 p, float zc, float W, float H, float sec, out float wear) {
    // The furnace floor is cut away over the melt; the folding span crosses it.
    float hole = sdBox(vec3(p.x, p.y, cycd(zc - SPAN_MID)), vec3(60.0, 60.0, SPAN_HALF));
    float floorD = max(p.y, -hole);

    // Ribs bite into the walls and ceiling only — a rib across the floor would
    // be a trip hazard you can feel through the gait.
    float shell = min(W - abs(p.x), H - p.y);
    float rsp = secRibSpacing(sec);
    float rz = abs(mod(p.z + rsp * 0.5, rsp) - rsp * 0.5);
    shell -= smoothstep(0.30, 0.0, rz) * 0.26;

    // Rivet dimples along each rib — pure surface detail, so only bias the
    // distance slightly rather than building real geometry.
    float rv = hash21(floor(vec2(p.x * 3.0 + p.y * 7.0, p.z * 2.0)));
    shell -= smoothstep(0.16, 0.0, rz) * rv * 0.02;

    wear = fbm(vec2(p.x * 1.3 + p.y * 2.1, p.z * 0.55));
    return min(shell, floorD);
  }

  // Caged wall lamps, staggered left/right at the hall's cadence. They are
  // placed in world z rather than loop-local z, so no lamp is ever cut in half
  // by the seam — and they start failing as the loop decays.
  float mapLamps(vec3 p, float W, float H, float sec, out float glow) {
    float sp = secLampSpacing(sec);
    float band = floor(p.z / sp);
    float lz = p.z - (band + 0.5) * sp;
    float side = mod(band, 2.0) * 2.0 - 1.0;
    float dead = step(hash11(band * 3.17 + 11.0), decay() * 0.38);
    vec3 lp = vec3(p.x - side * (W - 0.22), p.y - (H - 0.62), lz);
    float bulb = sdCylX(lp, 0.17, 0.14);
    // Cage bars over the bulb, so the light throws a striped shadow pattern.
    float bars = abs(mod(atan(lp.z, lp.y) * 3.0 / PI + 0.5, 1.0) - 0.5) - 0.16;
    glow = (1.0 - dead) * (1.0 - smoothstep(0.0, 0.02, max(bulb, -bars - 0.4)));
    return bulb;
  }

  // --- hall 0: LOADING BAY -------------------------------------------------
  // Recessed landing doors every 12 m, alternating walls.
  float mapLandings(vec3 p, float zc, float W, float H, out float mat) {
    mat = 5.0;
    float st = floor(zc / 12.0);
    float lz = zc - (st + 0.5) * 12.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    // Wall-local frame: x is depth out of the wall, y is height, z is along.
    vec3 lp = vec3((p.x - side * W) * -side, p.y, lz);
    float frame = sdBox(lp - vec3(-0.10, 1.05, 0.0), vec3(0.22, 1.30, 0.95));
    float hole = sdBox(lp - vec3(-0.40, 1.00, 0.0), vec3(0.60, 1.05, 0.70));
    return max(frame, -hole);
  }

  // --- hall 1: PISTON GALLERY ----------------------------------------------
  // Slider-crank rams driven by the CPU's exact closed-form displacement.
  float mapPistons(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    float st = floor(zc / 6.0);
    float lz = zc - (st + 0.5) * 6.0;

    // Normalise the mechanism's 1.28..2.52 m throw into the corridor's width,
    // and phase-offset each station so the gallery pulses as a wave.
    float ext = 0.55 + (uMech.y - 1.28) * 0.45 + 0.10 * sin(uMech.x + st * 1.7);

    // Rams face each other across the corridor. Folding on |x| puts the sample
    // in one wall's frame, so a single evaluation covers the pair: x is depth
    // out of the wall, y is height, z is along the corridor.
    vec3 lp = vec3(W - abs(p.x), p.y - 1.55, lz);
    float body = sdCylX(lp - vec3(-0.30, 0.0, 0.0), 0.42, 0.55);
    float rod = sdCylX(lp - vec3(-0.30 + ext * 0.5, 0.0, 0.0), 0.13, ext * 0.5 + 0.2);
    float head = sdCylX(lp - vec3(-0.30 + ext + 0.10, 0.0, 0.0), 0.30, 0.09);

    // Flywheel + crank pin, spun by the integrated angular velocity.
    vec3 fp = lp - vec3(-0.40, 0.0, 1.85);
    float wheel = sdTorusX(fp, 0.66, 0.10);
    vec3 cp = fp;
    cp.yz = rot(uMech.x) * cp.yz;
    float pin = sdCylX(cp - vec3(0.0, 0.52, 0.0), 0.07, 0.16);

    return min(min(body, min(rod, head)), min(wheel, pin));
  }

  // --- hall 2: THE LONG RUN ------------------------------------------------
  // Nearly empty and far too big. A hoist beam crosses the void every 9 m with
  // a chain hanging off it — swinging, because your own footfalls shake it.
  float mapLongRun(vec3 p, float zc, float W, float H, out float mat) {
    mat = 1.0;
    float st = floor(zc / 9.0);
    float lz = zc - (st + 0.5) * 9.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;

    float beam = sdBox(vec3(p.x, p.y - (H - 0.9), lz), vec3(W, 0.20, 0.26));
    float tie = sdCylY(vec3(abs(p.x) - W * 0.72, p.y - H * 0.5, lz), 0.09, H * 0.5);

    // The chain: a capsule from the beam to the hook, laid along the pendulum.
    float ca = uMech.w;
    vec3 anchor = vec3(side * W * 0.45, H - 1.10, 0.0);
    vec3 tip = anchor + vec3(sin(ca) * 2.4, -cos(ca) * 2.4, 0.0);
    vec3 ab = tip - anchor;
    vec3 ap = vec3(p.x, p.y, lz) - anchor;
    float tt = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    float chain = length(ap - ab * tt) - 0.035;
    float hook = sdTorusX(vec3(p.x, p.y, lz) - tip - vec3(0.0, -0.14, 0.0), 0.13, 0.04);

    return min(min(beam, tie), min(chain, hook));
  }

  // --- hall 3: COOLANT TIER ------------------------------------------------
  // Pipe bundles chased along all four corners; the hall is choked with
  // plumbing and the valve wheels turn with the flywheel.
  float mapCoolant(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    // Folding by abs() puts the sample in one corner's frame, so a single
    // length() is the exact distance to all four pipe runs at once.
    vec2 q = abs(vec2(p.x, p.y - H * 0.5)) - vec2(W - 0.42, H * 0.5 - 0.42);
    float pipe = length(q) - 0.24;
    float bundle = length(abs(q) - 0.34) - 0.13;

    float st = floor(zc / 6.0);
    float lz = zc - (st + 0.5) * 6.0;
    vec3 vp = vec3(W - abs(p.x), p.y - 1.35, lz);
    vp.yz = rot(uMech.x * 0.35 + st) * vp.yz;
    float wheel = sdTorusX(vp - vec3(-0.14, 0.0, 0.0), 0.42, 0.06);

    return min(min(pipe, bundle), wheel);
  }

  // --- hall 4: GEARWORKS ---------------------------------------------------
  // Meshing gear pairs set into the walls, turning at the integrated flywheel
  // rate. The winch starts lowering the cage while you are still in here.
  float gearX(vec3 a) {
    float disc = sdCylX(a, 1.55, 0.22);
    float teeth = abs(mod(atan(a.z, a.y) * 9.0 / PI + 0.5, 1.0) - 0.5) - 0.30;
    return min(disc, max(sdCylX(a, 1.82, 0.20), teeth * 0.35));
  }
  float mapGearworks(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    float st = floor(zc / 12.0);
    float lz = zc - (st + 0.5) * 12.0;
    vec3 gp = vec3(W - abs(p.x), p.y - 2.3, lz);

    // Counter-rotating pair; the second is offset so the teeth interleave.
    float spin = uMech.x * (mod(st, 2.0) < 0.5 ? 1.0 : -1.0);
    vec3 a = gp - vec3(-0.10, 0.0, -1.7);
    a.yz = rot(spin) * a.yz;
    vec3 b = gp - vec3(-0.10, 0.0, 1.7);
    b.yz = rot(-spin + 0.22) * b.yz;

    return min(gearX(a), gearX(b));
  }

  // --- hall 5: BRAKE RUN ---------------------------------------------------
  // The narrowest hall. Guide rails run its whole length at shoulder height
  // with shoe housings clamped on every 3 m — the hardware that just stopped
  // the cage you watched go past.
  float mapBrakeRun(vec3 p, float zc, float W, float H, out float mat) {
    mat = 5.0;
    float rail = sdBox2(vec2(abs(p.x) - (W - 0.30), p.y - 1.75), vec2(0.30, 0.13));
    float st = floor(zc / 3.0);
    float lz = zc - (st + 0.5) * 3.0;
    vec3 hp = vec3(abs(p.x) - (W - 0.42), p.y - 1.75, lz);
    float housing = sdBox(hp, vec3(0.34, 0.32, 0.50));
    float bolt = sdCylX(vec3(hp.x, hp.y, abs(hp.z) - 0.38), 0.07, 0.40);
    return min(rail, min(housing, bolt));
  }

  // --- hall 6: FURNACE FLOOR -----------------------------------------------
  // Molten tap channels run the walls, and a kerb marks the lip where the
  // plate stops and the folding span takes over.
  float mapFurnace(vec3 p, float zc, float W, float H, out float mat) {
    mat = 8.0;
    float channel = sdBox2(vec2(abs(p.x) - (W - 0.12), p.y - 1.15), vec2(0.16, 0.30));
    float hood = sdBox2(vec2(abs(p.x) - (W - 0.34), p.y - 1.70), vec2(0.38, 0.10));
    float kerb = sdBox(vec3(p.x, p.y - 0.13, abs(cycd(zc - SPAN_MID)) - SPAN_HALF),
                       vec3(W, 0.13, 0.20));
    if (hood < channel) { channel = hood; mat = 0.0; }
    if (kerb < channel) { channel = kerb; mat = 1.0; }
    return channel;
  }

  /** Dispatch a sample to one hall's signature machinery. */
  float secFeature(float i, vec3 p, float zc, float W, float H, out float mat) {
    if (i < 0.5) return mapLandings(p, zc, W, H, mat);
    if (i < 1.5) return mapPistons(p, zc, W, H, mat);
    if (i < 2.5) return mapLongRun(p, zc, W, H, mat);
    if (i < 3.5) return mapCoolant(p, zc, W, H, mat);
    if (i < 4.5) return mapGearworks(p, zc, W, H, mat);
    if (i < 5.5) return mapBrakeRun(p, zc, W, H, mat);
    return mapFurnace(p, zc, W, H, mat);
  }

  // --- every boundary, made physical ---------------------------------------
  // A bulkhead portal stands on each of the seven joins. It is the same frame
  // every time, sized to the profile the cross-fade has already funnelled the
  // corridor down to — so walking the loop is a walk through seven identical
  // doorways, and the seam from the last hall to the first is one of them.
  float mapPortal(vec3 p, float zc, float W, float H) {
    float dz = zc - floor(zc / SEC_LEN + 0.5) * SEC_LEN;
    float slab = sdBox(vec3(p.x, p.y - H * 0.5, dz), vec3(W + 1.2, H * 0.5 + 1.2, 0.36));
    float hole = sdBox(vec3(p.x, p.y - H * 0.5 - 0.10, dz), vec3(W - 0.16, H * 0.5 - 0.06, 1.0));
    float frame = max(slab, -hole);
    // A shallow threshold plate you can see (and feel) yourself step over.
    float sill = sdBox(vec3(p.x, p.y - 0.03, dz), vec3(W, 0.03, 0.30));
    return min(frame, sill);
  }

  // ====================== THE HOIST SHAFT CROSSING =========================
  // A vertical shaft crosses the corridor mid-way down the brake run. Its
  // interior is *unioned* with the hall's — max() of two positive-inside
  // fields — which is what opens the ceiling and cuts the well in the floor
  // without any explicit boolean geometry.

  float shaftInterior(vec3 p, float dz) {
    return min(SHAFT_R - max(abs(p.x), abs(dz)),
               min(p.y - WELL_Y, SHAFT_HEAD - p.y));
  }

  // Rails, catwalk and buffer rams — everything solid in the shaft that is not
  // the cage itself.
  float mapCrossing(vec3 p, float dz, out float mat) {
    mat = 5.0;
    // Guide rails the emergency shoes clamp, running the shaft's full height.
    float rail = sdBox2(vec2(abs(p.x) - (SHAFT_R - 0.34), dz), vec2(0.34, 0.13));

    // A grating catwalk carries the corridor across the open well.
    float deck = sdBox(vec3(p.x, p.y + 0.07, dz), vec3(1.05, 0.07, SHAFT_R + 0.5));
    float barX = abs(mod(p.x + 0.11, 0.22) - 0.11) - 0.014;
    float barZ = abs(mod(dz + 0.11, 0.22) - 0.11) - 0.014;
    deck = max(deck, min(barX, barZ));

    // Four hydraulic buffer rams standing on the well floor.
    vec2 bc = abs(vec2(p.x, dz)) - 1.20;
    float ram = sdCylY(vec3(bc.x, p.y - (WELL_Y + 1.4), bc.y), 0.30, 1.4);

    return min(rail, min(deck, ram));
  }

  // The cage: corner posts, floor slab, roof, and a woven grating skin.
  float mapCage(vec3 p, float dz, out float mat) {
    mat = 1.0;
    vec3 c = vec3(p.x, p.y - cageY(), dz);

    float posts = sdBox(vec3(abs(c.x) - CAGE_R, c.y - CAGE_H * 0.5, abs(c.z) - CAGE_R),
                        vec3(0.075, CAGE_H * 0.5, 0.075));
    // Open mesh floor — from the catwalk you watch it come down through its
    // own deck, with the offcuts loose on the other side of the mesh.
    float floorPlate = sdBox(c - vec3(0.0, -0.04, 0.0), vec3(CAGE_R, 0.035, CAGE_R));
    float fbarX = abs(mod(c.x + 0.11, 0.22) - 0.11) - 0.012;
    float fbarZ = abs(mod(c.z + 0.11, 0.22) - 0.11) - 0.012;
    float floorSlab = max(floorPlate, min(fbarX, fbarZ));
    float roof = sdBox(c - vec3(0.0, CAGE_H, 0.0), vec3(CAGE_R + 0.06, 0.06, CAGE_R + 0.06));

    // Woven grating on two side panels only — a fully enclosed cage puts a mesh
    // wall across the frame and everything behind it becomes unreadable.
    float slab = max(c.y - CAGE_H, -c.y);
    float ring = abs(abs(c.x) - CAGE_R) - 0.016;
    float vbar = abs(mod(c.z + 0.08, 0.16) - 0.08) - 0.013;
    float hbar = abs(mod(c.y + 0.1, 0.2) - 0.1) - 0.013;
    float grate = max(max(ring, min(vbar, hbar)), max(slab, abs(c.z) - CAGE_R));

    float rails = sdBox(vec3(c.x, abs(c.y - 1.05) - 0.42, abs(c.z) - CAGE_R),
                        vec3(CAGE_R, 0.035, 0.035));

    float d = min(min(posts, floorSlab), min(roof, min(grate, rails)));

    // Hanging hook on a chain, swinging by the integrated pendulum angle.
    float ha = uMech.z;
    vec2 hd = vec2(sin(ha), -cos(ha)) * 1.35;
    vec3 anchor = vec3(0.75, CAGE_H - 0.06, -0.55);
    vec3 tip = anchor + vec3(hd.x, hd.y, 0.0);
    vec3 ab = tip - anchor;
    vec3 ap = c - anchor;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    float chain = length(ap - ab * t) - 0.028;
    float hook = sdTorusX(c - tip - vec3(0.0, -0.12, 0.0), 0.11, 0.035);
    if (min(chain, hook) < d) { d = min(chain, hook); mat = 5.0; }

    return d;
  }

  // Six free rigid bodies, each transformed into its own frame by the
  // orientation quaternion the integrator produced.
  float mapDebris(vec3 p, float dz) {
    float d = 1e9;
    vec3 q0 = vec3(p.x, p.y, dz);
    for (int i = 0; i < 6; i++) {
      vec3 ctr = vec3(uDebris[i].x, uDebris[i].y, uDebris[i].z);
      float s = uDebris[i].w;
      // Cheap bounding-sphere reject keeps the per-step cost near zero when the
      // body is far from the ray. The radius must be the box's *circumradius*
      // (|(0.55, 0.32, 0.42)| ≈ 0.766) — a tighter sphere would over-estimate
      // the distance and the march would step straight through corners.
      float bound = length(q0 - ctr) - s * 0.78;
      if (bound < 0.6) {
        vec3 q = qinv(uDebrisQ[i], q0 - ctr);
        d = min(d, sdBox(q, vec3(0.55, 0.32, 0.42) * s));
      } else {
        d = min(d, bound);
      }
    }
    return d;
  }

  // Hoist cables above the cage — present only while the cable is intact.
  float mapCables(vec3 p, float dz) {
    if (uSim.w < 0.5) return 1e9;
    if (p.y < cageY() + CAGE_H) return 1e9;
    vec2 off = abs(vec2(p.x, dz)) - vec2(0.42, 0.42);
    return length(max(off, 0.0)) + min(max(off.x, off.y), 0.0) - 0.035;
  }

  // ======================= THE FOLDING SPAN ================================
  // The furnace floor is cut away over the melt. The only walkway is a line of
  // cubes that unfold their six faces about hinge edges — panels swinging out
  // along all three axes to lay a floor a moment before it is stood on, then
  // closing again behind. Each cube's fold coordinate is a damped hinge
  // integrated on the CPU (physics.ts), so the panels overshoot and settle
  // instead of easing, and they ring when a boot lands on them.

  /** Fold coordinate of span cube 'i', unpacked from the two vec4 slots. */
  float foldAt(int i) {
    if (i == 0) return uFold0.x;
    if (i == 1) return uFold0.y;
    if (i == 2) return uFold0.z;
    if (i == 3) return uFold0.w;
    if (i == 4) return uFold1.x;
    if (i == 5) return uFold1.y;
    if (i == 6) return uFold1.z;
    return uFold1.w;
  }

  /**
   * One hinged face. 'q' is the sample relative to the hinge edge, with the
   * hinge running along local Z. At a = 0 the panel stands vertical (closed
   * cube); at a = -PI/2 it lies flat, extending the walkway.
   */
  float foldPanel(vec3 q, float a) {
    q.xy = rot(-a) * q.xy;
    return sdBox(q - vec3(0.0, CUBE_H, 0.0), vec3(PANEL_T, CUBE_H, CUBE_H));
  }

  /** A single cube of the span, centred at the origin, unfolded by 'f' (0..1). */
  float mapCube(vec3 q, float f) {
    float a = -f * PI * 0.5;

    // Base plate: the face you actually stand on. Always present.
    float d = sdBox(q - vec3(0.0, -CUBE_H, 0.0), vec3(CUBE_H, PANEL_T, CUBE_H));

    // Four side faces, hinged on the base plate's four edges and swinging out
    // along ±X and ±Z — the "all axes" fold.
    d = min(d, foldPanel(vec3(q.x - CUBE_H, q.y + CUBE_H, q.z), a));
    d = min(d, foldPanel(vec3(-q.x - CUBE_H, q.y + CUBE_H, q.z), a));
    d = min(d, foldPanel(vec3(q.z - CUBE_H, q.y + CUBE_H, q.x), a));
    d = min(d, foldPanel(vec3(-q.z - CUBE_H, q.y + CUBE_H, q.x), a));

    // Lid: the Y-axis fold. Hinged on the +X top edge, it swings through a
    // half turn — from lying closed across the top, up through vertical, to
    // flat again on the far side — opening the cube into an overhead canopy.
    // foldPanel measures its panel from +Y, so the extra quarter turn starts it
    // pointing along -X.
    d = min(d, foldPanel(vec3(q.x - CUBE_H, q.y - CUBE_H, q.z), -f * PI + PI * 0.5));

    return d;
  }

  /**
   * The eight cubes of the span. Each is rejected by a bounding sphere first,
   * so a ray typically pays for one or two cubes rather than all eight.
   */
  float mapSpan(vec3 p, float zc) {
    float d = 1e9;
    for (int i = 0; i < 8; i++) {
      float dzi = cycd(zc - (SPAN_Z0 + float(i) * CUBE_SP));
      vec3 q = vec3(p.x, p.y - CUBE_H, dzi);
      // The unfolded net reaches ~2 cube-halves past the body diagonal.
      float bound = length(q) - CUBE_H * 3.4;
      if (bound < 0.5) d = min(d, mapCube(q, foldAt(i)));
      else d = min(d, bound);
    }
    return d;
  }

  // ============================== THE MAP ==================================

  float mapScene(vec3 p) {
    float zc = cyc(p.z);
    float a, b, t, tf;
    secBlend(zc, a, b, t, tf);

    // --- per-loop decay: the corridor snakes, breathes and closes in --------
    // Guarded to leave the walker's immediate surroundings alone, otherwise at
    // high iterations the walls fold through the camera.
    float dec = decay();
    if (dec > 0.005) {
      float guard = smoothstep(1.2, 8.0, abs(p.z - walkZ()));
      float snake = sin(p.z * 0.055 + iTime * 1.1) * dec * 1.6;
      float wx = sin(p.z * 1.7 + iTime * 2.0) * cos(p.y * 1.4) * 0.42 * dec;
      float wy = cos(p.z * 1.5 + iTime * 1.5) * sin(p.x * 1.2) * 0.34 * dec;
      p.x += (snake + wx) * guard;
      p.y += wy * guard;
    }

    vec2 pr = mix(secProfile(a), secProfile(b), t);
    float squeeze = 1.0 - dec * 0.18;
    float W = pr.x * squeeze;
    float H = pr.y * squeeze;

    float wear;
    float d = mapHall(p, zc, W, H, a, wear);
    gMat = 0.0; gWear = wear; gGlow = 0.0;

    // The hoist shaft's interior unions with the hall's, opening the ceiling
    // and the well. Far from the crossing it is deeply negative and does
    // nothing; the hall's own width still bounds the step size, so the march
    // can never leap over it.
    float dzc = cycd(zc - CROSS_Z);
    d = max(d, shaftInterior(p, dzc));

    // --- the hall's signature machinery, dissolved at the boundary ----------
    float fmA;
    float feat = secFeature(a, p, zc, W, H, fmA) + tf * FEAT_ERODE;
    float fmat = fmA;
    if (tf > 0.002) {
      float fmB;
      float featB = secFeature(b, p, zc, W, H, fmB) + (1.0 - tf) * FEAT_ERODE;
      if (featB < feat) { feat = featB; fmat = fmB; }
    }
    if (feat < d) { d = feat; gMat = fmat; gWear = 0.10; }

    float portal = mapPortal(p, zc, W, H);
    if (portal < d) { d = portal; gMat = 1.0; gWear = 0.45; }

    // --- the crossing: rails, catwalk, cage, debris, cables ----------------
    if (abs(dzc) < 34.0) {
      float cm;
      float cross = mapCrossing(p, dzc, cm);
      if (cross < d) { d = cross; gMat = cm; gWear = 0.25; }

      float gm;
      float cage = mapCage(p, dzc, gm);
      if (cage < d) { d = cage; gMat = gm; gWear = 0.55; }

      float deb = mapDebris(p, dzc);
      if (deb < d) { d = deb; gMat = 2.0; gWear = 0.75; }

      float cab = mapCables(p, dzc);
      if (cab < d) { d = cab; gMat = 5.0; gWear = 0.30; }
    }

    // --- the folding span and the melt under it ----------------------------
    if (abs(cycd(zc - SPAN_MID)) < SPAN_HALF + 4.0) {
      float span = mapSpan(p, zc);
      if (span < d) { d = span; gMat = 6.0; gWear = 0.20; }

      if (p.y < 0.4) {
        float surf = MELT_Y + fbm(vec2(p.x * 0.22, p.z * 0.22 + iTime * 0.10)) * 1.3;
        float melt = p.y - surf;
        if (melt < d) { d = melt; gMat = 8.0; gWear = 0.0; gGlow = 1.0; }
      }
    }

    float lg;
    float lamp = mapLamps(p, W, H, a, lg);
    if (lamp < d) { d = lamp; gMat = 4.0; gGlow = lg; }

    // Two dissolving fitting sets plus a funnelling profile leave the field
    // non-Lipschitz for a few metres either side of a boundary; shorten the
    // step to absorb it.
    if (t > 0.02 && t < 0.995) d *= 0.78;
    return d;
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy) - mapScene(p - e.xyy),
      mapScene(p + e.yxy) - mapScene(p - e.yxy),
      mapScene(p + e.yyx) - mapScene(p - e.yyx)));
  }

  // ============================ SHADING ====================================

  // Per-hall lamp colour and intensity. This is what actually sells the halls
  // as different places — sodium in the bay, mercury-cold in the long run,
  // sickly green through the coolant tier, furnace-red at the end of the lap.
  vec3 secLampColour(float i) {
    if (i < 0.5) return vec3(1.00, 0.82, 0.62);  // loading bay   — warm sodium
    if (i < 1.5) return vec3(1.00, 0.74, 0.40);  // piston gallery— hot tungsten
    if (i < 2.5) return vec3(0.62, 0.74, 1.00);  // long run      — cold mercury
    if (i < 3.5) return vec3(0.52, 1.00, 0.72);  // coolant tier  — sickly green
    if (i < 4.5) return vec3(1.00, 0.88, 0.70);  // gearworks     — work lamps
    if (i < 5.5) return vec3(1.00, 0.36, 0.30);  // brake run     — red alarm
    return vec3(1.00, 0.55, 0.22);               // furnace floor — molten
  }
  float secLampPower(float i) {
    if (i > 1.5 && i < 2.5) return 6.2;  // few lamps, so each must carry further
    if (i > 4.5 && i < 5.5) return 2.1;  // brake run: dense lamps, so dial each down
    if (i > 5.5) return 2.6;             // furnace floor is half-lit by the melt
    return 3.4;
  }

  // The three nearest lamps dominate; approximating the strip as a few point
  // lights is far cheaper than iterating the corridor and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, float W, float H, float sec) {
    vec3 acc = vec3(0.0);
    float sp = secLampSpacing(sec);
    vec3 lcol = mix(secLampColour(sec), vec3(1.00, 0.30, 0.16), decay() * 0.55);
    float lpow = secLampPower(sec);
    float band = floor(p.z / sp);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      if (hash11(bi * 3.17 + 11.0) < decay() * 0.38) continue;  // this one has failed
      vec3 lp = vec3(side * (W - 0.22), H - 0.62, (bi + 0.5) * sp);
      vec3 ld = lp - p;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = 1.0 / (1.0 + dist * dist * 0.030);
      // Half-lambert: real halls are full of bounce light off the plate, and a
      // hard terminator here just crushes everything to black.
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = pow(max(dot(reflect(-ld, n), -rd), 0.0), mix(90.0, 8.0, rough));
      acc += (albedo * diff + spec * (1.0 - rough) * 0.32) * atten * lcol * lpow;
    }
    return acc;
  }

  // The melt under the folding span: a warm updraft that only reaches the last
  // hall of the lap, and the well, where the cage's own sparks light it.
  vec3 furnaceLight(vec3 p, vec3 n, vec3 albedo, float zc) {
    float near = 1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 16.0, abs(cycd(zc - SPAN_MID)));
    if (near < 0.01) return vec3(0.0);
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0) * 0.8 + 0.2;
    float depth = clamp((p.y - MELT_Y) / 34.0, 0.0, 1.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.z * 0.4, iTime * 1.7));
    return albedo * up * near * (1.0 - depth * 0.75) * flick * vec3(1.30, 0.44, 0.10);
  }

  vec3 shadeSurface(vec3 p, vec3 n, vec3 rd, float dist, float zc, float W, float H, float sec) {
    float mat = gMat, wear = gWear;
    vec3 albedo; float rough;

    if (mat < 0.5) {
      // Hall steel — dark plate, rust blooming out of the noise field, and a
      // tread pattern wherever the surface is walkable.
      vec3 steel = vec3(0.085, 0.088, 0.098);
      vec3 rust = vec3(0.22, 0.11, 0.055);
      albedo = mix(steel, rust, smoothstep(0.62, 0.95, wear));
      float tread = step(0.72, n.y) *
        step(0.6, max(sin(p.x * 9.0) * sin(p.z * 9.0), 0.0));
      albedo *= 1.0 + tread * 0.5;
      rough = 0.82;
    } else if (mat < 1.5) {
      // Frames and bulkheads — hazard yellow, chipped back to primer.
      float chip = smoothstep(0.38, 0.66, wear);
      albedo = mix(vec3(0.30, 0.21, 0.045), vec3(0.09, 0.085, 0.08), chip);
      rough = 0.80;
    } else if (mat < 2.5) {
      // Debris — raw steel offcuts, mill-scale blue.
      albedo = mix(vec3(0.13, 0.14, 0.17), vec3(0.26, 0.15, 0.09), wear * 0.5);
      rough = 0.68;
    } else if (mat < 3.5) {
      // Piston chrome — polished, so it carries the lamps as hard highlights.
      albedo = vec3(0.40, 0.42, 0.47);
      rough = 0.22;
    } else if (mat < 4.5) {
      // Lamp glass — emissive, unaffected by lighting.
      return mix(vec3(0.06, 0.06, 0.07), vec3(1.0, 0.76, 0.42) * 2.6, gGlow);
    } else if (mat < 5.5) {
      // Rails / chain / catwalk — worn bright steel.
      albedo = vec3(0.34, 0.35, 0.38);
      rough = 0.30;
    } else if (mat < 7.0) {
      // Folding-span panels — pale machined plate.
      albedo = vec3(0.42, 0.44, 0.50);
      rough = 0.34;
    } else {
      // Molten metal — emissive, and the brighter for being looked at from
      // directly above through a hole in the floor.
      float churn = fbm(vec2(p.x * 0.5, p.z * 0.5 - iTime * 0.35));
      vec3 hot = mix(vec3(1.5, 0.42, 0.06), vec3(2.6, 1.5, 0.45), churn);
      return hot * (0.55 + 0.45 * churn);
    }

    vec3 col = albedo * vec3(0.13, 0.145, 0.185);         // cool ambient bounce
    col += lampLight(p, n, albedo, rough, rd, W, H, sec);
    col += furnaceLight(p, n, albedo, zc);

    // Brake sparks throw a hard white-hot key from the rail contact patch in
    // the well, which is what lights the catwalk as you cross it.
    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * (SHAFT_R - 0.6), cageY() + 0.1, walkZ() + cycd(CROSS_Z - cyc(walkZ())));
      vec3 sd = sp - p;
      float sdist = length(sd);
      float att = 1.0 / (1.0 + sdist * sdist * 0.10);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0) * att * spark() * vec3(3.4, 2.6, 1.5);
    }

    // Fresnel rim keeps the metal from flattening out at grazing angles.
    col += vec3(0.10, 0.11, 0.14) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * (1.0 - rough);
    return col;
  }

  // ============================ CAMERA =====================================

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float dec = decay();

    // A glitch surge every time the lap turns over — the one moment the loop
    // admits to being a loop.
    float wrap = step(0.5, uWalk.y) * exp(-walkZ() * 0.45);

    // --- lens: barrel distortion that tightens as the loop decays -----------
    float r2 = dot(uv, uv);
    uv += uv * r2 * (0.030 + 0.34 * dec + 0.5 * wrap);

    // --- torn scanlines: whole slices of the world shift sideways -----------
    float tear = dec * 0.30 + wrap;
    if (tear > 0.02) {
      float bandY = floor(uv.y * 26.0 + iTime * 31.0);
      if (hash11(bandY * 0.137 + 3.0) < tear * 0.30)
        uv.x += (hash11(bandY * 1.71) - 0.5) * tear * 0.10;
    }

    // The camera is the walker. Eye height, sway, yaw, pitch and roll are all
    // outputs of the gait integrator in physics.ts — the head drops on each
    // heel strike and rebounds on the leg spring, the body rolls into the
    // sway, and the buffer slam arrives through the floor as a tremor. None of
    // it is a function of iTime.
    vec3 ro = vec3(uGait.y + uSim.x * 0.018, uGait.x + uSim.y * 0.018, walkZ());
    float yaw = uGait.z + uPointer.x * 0.75 + uSim.x * 0.008;
    float pitch = uGait.w + uPointer.y * 0.50;
    float roll = uWalk.w + uSim.x * 0.02;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.20;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    float dist = 0.0, hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.0016 * dist + 0.0008) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    float zc = cyc(p.z);
    float sa, sb, st, stf;
    secBlend(zc, sa, sb, st, stf);
    vec2 pr = mix(secProfile(sa), secProfile(sb), st);
    float squeeze = 1.0 - dec * 0.18;

    // Background: the halls have no sky, only the melt burning under the last
    // one and the cold nothing of a corridor that runs out of lamps.
    vec3 col = vec3(0.012, 0.010, 0.014)
      + vec3(0.34, 0.10, 0.02) * pow(max(-rd.y, 0.0), 2.0)
        * (1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 20.0, abs(cycd(zc - SPAN_MID))));

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      col = shadeSurface(p, n, rd, dist, zc, pr.x * squeeze, pr.y * squeeze, sa);
      float fogDen = 0.038 + dec * 0.012;
      vec3 fogCol = mix(vec3(0.030, 0.026, 0.030), vec3(0.045, 0.016, 0.012), dec);
      float fog = 1.0 - exp(-dist * fogDen);
      col = mix(col, fogCol, fog);
    }

    // --- spark shower off the guide rails while the shoes are biting --------
    if (spark() > 0.01) {
      float railZ = walkZ() + cycd(CROSS_Z - cyc(walkZ()));
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        // Sparks are thrown off the rail and fall behind the still-moving cage.
        vec3 sp = vec3(sign(seed - 0.5) * (SHAFT_R - 0.5),
                       cageY() + 0.2 + fract(seed * 7.3) * 2.4,
                       railZ + (fract(seed * 3.1) - 0.5) * 1.6);
        vec3 to = sp - ro;
        float along = dot(to, rd);
        if (along > 0.0) {
          float perp = length(to - rd * along);
          float g = exp(-perp * perp * 900.0) * exp(-along * 0.10);
          col += vec3(1.6, 0.95, 0.42) * g * spark() * 2.2;
        }
      }
    }

    // --- steam drifting off the machinery (heavy effects only) --------------
    if (uHeavy > 0.5) {
      float steam = fbm(vec2(uv.x * 3.0 + iTime * 0.15, uv.y * 3.0 - iTime * 0.55 + walkZ() * 0.2));
      steam *= smoothstep(0.6, 1.0, steam) * 0.5;
      col += vec3(0.16, 0.15, 0.17) * steam * (0.3 + 0.7 * weightless());
    }

    // --- grade --------------------------------------------------------------
    // The brake flash blows the highlights out; the decay rots the whole grade
    // toward oxblood and pulls the colour out from the edges of the frame.
    col += vec3(1.0, 0.8, 0.55) * spark() * 0.06;
    if (dec > 0.02) {
      vec3 rotten = vec3(col.r * 1.18, col.g * 0.74, col.b * 0.66);
      col = mix(col, rotten, dec * 0.55);
      // Spectral fringing: a single-pass march has no framebuffer to resample,
      // so the channels are separated radially on the graded image instead —
      // strongest at the edges, exactly where a real lens loses them.
      float fr = dot(uv, uv) * (dec * 0.55 + wrap);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col.r = mix(col.r, col.r * 1.25 + lum * 0.10, fr);
      col.b = mix(col.b, col.b * 0.80 + lum * 0.16, fr);
    }

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.7, lum) * 0.5;                  // pseudo-bloom
    col = pow(clamp(col, 0.0, 1.8), vec3(0.90));

    // Thin TV scanlines, heavier the further round the loop you are.
    col -= (0.02 + 0.05 * dec) * sin(gl_FragCoord.y * 1.6 + iTime * 12.0);

    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * (0.65 + 0.12 * dec); // vignette
    // Sensor grain, heavier as the foundry comes apart.
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.050 * dec + 0.12 * wrap);

    gl_FragColor = vec4(col, 1.0);
  }
`

// Full-quality variant used by the route page.
export const foundryFrag = `
#define RM_STEPS 96
#define MAX_DIST 90.0
#define STEP_K 0.72
#define FBM_OCTAVES 3
#define SPARK_LAYERS 14
${COMMON}`

// The hover thumbnail runs without a simulation attached (uWalk et al. are all
// zero), so it gets its own compact, self-driving shader rather than a cheaper
// build of the one above: an analytic walk up a corridor past ribs, lamps and a
// piston, with a head bob on the stride and the brake flash on a slow cycle.
export const foundryPreviewFrag = `
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
    uv += uPointer * 0.10;

    // Gait: the frame rides a stride bob and rolls into the sway, so even the
    // thumbnail reads as somebody walking rather than a camera on rails.
    float walk = iTime * 2.4;
    float stride = walk / 0.875 * 1.5707963;
    uv.y -= abs(sin(stride)) * 0.012;
    uv.x -= sin(stride * 0.5) * 0.010;

    // Fake-perspective corridor: |uv| drives distance to the wall, so the frame
    // reads as looking down a square hall.
    float q = max(abs(uv.x), abs(uv.y));
    float depth = 0.42 / max(q, 0.02);

    // Ribs streaming past, plus a brake-flash cycle every ~9 s.
    float rib = fract(depth * 0.9 - walk * 0.55);
    float ribHi = smoothstep(0.0, 0.06, rib) * (1.0 - smoothstep(0.14, 0.22, rib));
    float brake = smoothstep(0.72, 0.92, fract(iTime * 0.11));

    float shade = clamp(1.6 / depth, 0.04, 1.0);
    vec3 col = vec3(0.085, 0.088, 0.098) * shade;
    col = mix(col, vec3(0.28, 0.12, 0.05) * shade, hash21(floor(vec2(uv * 14.0))) * 0.5);
    col += ribHi * shade * 0.14;

    // Caged wall lamps, staggered, streaming toward you as you walk.
    float lampPhase = fract(depth * 0.30 - walk * 0.18);
    float lamp = smoothstep(0.03, 0.0, abs(lampPhase - 0.5)) * smoothstep(0.55, 0.25, abs(uv.x));
    col += vec3(1.0, 0.72, 0.38) * lamp * 1.6;

    // A piston ram on the right wall, extending on the exact slider-crank curve.
    float crank = iTime * 3.1;
    float ext = 0.62 * cos(crank) + sqrt(max(0.0, 3.61 - 0.3844 * sin(crank) * sin(crank)));
    float ram = smoothstep(0.035, 0.0, abs(uv.y + 0.06))
              * step(0.30, uv.x) * step(uv.x, 0.30 + ext * 0.11);
    col += vec3(0.55, 0.57, 0.62) * ram * 0.9;

    // Brake sparks + the melt burning somewhere below the floor.
    float sparkle = step(0.985, hash21(floor(uv * 90.0) + floor(iTime * 30.0)));
    col += vec3(1.6, 0.95, 0.42) * sparkle * brake * 1.4;
    col += vec3(0.30, 0.09, 0.02) * pow(max(-uv.y, 0.0), 2.0) * 1.2;

    col *= 1.0 - smoothstep(0.40, 1.05, length(uv)) * 0.6;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 96 raymarch steps x (hall + blended machinery + portal +
// 6 quaternion-rotated debris boxes + 8 folding cubes) is the heaviest journey
// in the set; the bounding-sphere rejects and the crossing/span distance gates
// keep the common case near the cost of the corridor alone. ~1 draw call, no
// textures, no render targets.
