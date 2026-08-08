// THE FOUNDRY — a lift drop into a machine hall that never ends.
//
// Companion piece to THE LIMINAL JOURNEY: the same endlessly repeating
// first-person traversal, but the corridors are machinery and the motion is not
// authored. Every moving thing in this shader is positioned by uniforms produced
// by the rigid-body integrator in physics.ts — the falling cage, six tumbling
// debris bodies loose in it, the walker's gait (head height on a leg spring,
// lateral sway, roll and yaw all read off footfalls), the exact slider-crank
// piston extension, and two pendulums swung by the cage's acceleration and by
// your own footsteps. The shader draws state; it does not invent motion.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only. Uniforms beyond the shared set:
//   uWalk    = (cyclicZ, smoothLoop, decay, headRoll)
//   uGait    = (eyeY, swayX, headYaw, headPitch)
//   uRide    = (riding, shutterClosed, gateOpen, phaseSeconds)
//   uCage    = (floorY, velocity, acceleration, mode)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, cageHookAngle, hallChainAngle)
//   uDebris  = 6 x (cageX, worldY, cageZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion
//   uFold0/1 = fold coordinate of the 8 folding-span cubes
//
// THE LAP. It opens inside the cage, part-way down a 128 m hoist shaft, with the
// cable already gone: free fall, then the emergency shoes on the guide rails,
// then a governed shudder onto the landing and the gate rattling up. From there
// it is a walk through seven 36 m halls (loading bay, piston gallery, long run,
// coolant tier, gearworks, brake run, furnace floor) laid end to end, and
// everything is keyed off mod(z, CYCLE) — so the seventh hall runs straight back
// into the first with no seam, no fade and no teleport. Every boundary, the wrap
// included, is handled by exactly one rule (see secBlend): the last TRANS metres
// funnel the corridor profile into the next hall's proportions, the last
// FEAT_FADE metres erode this hall's machinery away while the next hall's
// already stands beyond the doorway, and a bulkhead portal is bolted across the
// join. The lap ends where it began, back in the cage, and the shutter coming
// down over its open faces is the only thing that is ever cut away from.
//
// NOTHING IS SIMPLY THERE. Every mechanism drives itself into place as it comes
// into view — rams telescope out of the wall, gears rise in their recesses and
// spin up, valve wheels swing out, shoe housings clamp onto the rails, hoist
// beams lower on their hangers, bulkhead shutters roll up, lamps strike. They
// all run on one closed-form damped hinge (deployAt) evaluated against distance
// to the walker, so they overshoot and ring down instead of easing.
//
// TEXTURE. There are no image textures here — one draw call, no render targets,
// no assets — so every surface is built from a height field which tints the
// albedo, drives the roughness, and whose gradient perturbs the normal.
//
// THE DECAY. Each completed lap leaves the foundry a little less sure of itself:
// the corridor snakes and breathes, the walls close in, lamps fail, the lens
// barrels, whole scanlines tear sideways and the grade rots toward oxblood.
// Same road, one level deeper, worse every time round.

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (steam volumetrics, extra sparks)

  uniform vec4 uWalk;          // cyclicZ, smoothLoop, decay, headRoll
  uniform vec4 uGait;          // eyeY, swayX, headYaw, headPitch
  uniform vec4 uRide;          // riding, shutterClosed, gateOpen, phaseSeconds
  uniform vec4 uCage;          // floorY, velocity, acceleration, mode
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
  const float CYCLE = 252.0;    // SEC_LEN * SEC_COUNT
  const float TRANS = 9.0;      // profile funnel length at every boundary
  const float FEAT_FADE = 3.0;  // machinery dissolve length at every boundary
  const float FEAT_ERODE = 2.2; // how far a dissolving fitting is offset away
  const float CEIL_MAX = 11.5;  // above every hall's ceiling — nothing but shaft

  // --- the hoist shaft (mirrors physics.ts) ---------------------------------
  const float LIFT_Z = 18.0;
  const float SHAFT_R = 3.0;
  const float SHAFT_HEAD = 128.0;
  const float PIT_Y = -3.0;
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

  // --- deployment ------------------------------------------------------------
  const float DEPLOY_SIGHT = 20.0; // metres ahead at which a mechanism wakes up
  const float DEPLOY_RUN = 8.0;    // metres over which it drives out and settles

  // Material/look state written by the SDF at the nearest hit.
  float gMat;      // 0 plate, 1 painted frame, 2 offcut, 3 machined, 4 lamp,
                   // 5 rail steel, 6 span panel, 8 molten
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

  // --- convenience ---------------------------------------------------------
  float cageY() { return uCage.x; }
  float cageA() { return uCage.z; }
  float spark() { return uSim.z; }
  float decay() { return uWalk.z; }
  float walkZ() { return uWalk.x; }
  float riding() { return uRide.x; }
  float shutter() { return uRide.y; }
  float gateOpen() { return uRide.z; }
  // Free fall reads as weightlessness: the cage's acceleration approaches -g.
  float weightless() { return smoothstep(-6.0, -9.2, cageA()); }

  // --- the loop's coordinate system ----------------------------------------
  // The walk is unbounded but the world is not: everything is a function of the
  // position *within* one circuit. cycd() is the signed version — continuous
  // across the seam, which is what lets a ray march through the wrap without
  // ever seeing it.
  float cyc(float z) { return z - CYCLE * floor(z / CYCLE); }
  float cycd(float z) { return z - CYCLE * floor(z / CYCLE + 0.5); }

  float secIndexAt(float zc) { return clamp(floor(zc / SEC_LEN), 0.0, SEC_COUNT - 1.0); }

  /**
   * Deployment coordinate for a mechanism whose station centre is 'ahead' metres
   * in front of the walker. Everything mechanical in the foundry runs on this:
   * nothing is simply *there* when it comes into view — it drives out of the
   * wall as you approach, overshoots on its stops and rings down.
   *
   * This is the closed-form response of the same damped second-order hinge the
   * folding span integrates on the CPU, evaluated against distance rather than
   * time. The walker holds a near-constant pace, so the two are the same curve,
   * and a distance-keyed version costs no state: a hall 200 m away is not being
   * simulated, it is simply not deployed yet.
   */
  float deployAt(float ahead) {
    float x = (DEPLOY_SIGHT - ahead) / DEPLOY_RUN;
    if (x <= 0.0) return 0.0;
    if (x > 4.0) return 1.0;
    // Underdamped, and deliberately slack: it reaches its stops around x = 0.7,
    // overshoots by about a tenth, and is still ringing as you walk up to it.
    return 1.0 - exp(-1.6 * x) * cos(2.2 * x);
  }

  /** Deployment of the station at cyclic position 'sz'. */
  float deployStation(float sz) { return deployAt(cycd(sz - walkZ())); }

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
  // breathes — tight and riveted at the landing, cavernous through the long run,
  // choked down to a slot for the brake run, then opened over the melt.
  vec2 secProfile(float i) {
    if (i < 0.5) return vec2(2.6, 3.6);   // loading bay
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

    wear = fbm(vec2(p.x * 1.3 + p.y * 2.1, p.z * 0.55));
    return min(shell, floorD);
  }

  // Caged wall lamps, staggered left/right at the hall's cadence. They are
  // placed in world z rather than loop-local z, so no lamp is ever cut in half
  // by the seam — they strike as they come into view, and they start failing as
  // the lap decays.
  float mapLamps(vec3 p, float W, float H, float sec, out float glow) {
    float sp = secLampSpacing(sec);
    float band = floor(p.z / sp);
    float lz = p.z - (band + 0.5) * sp;
    float side = mod(band, 2.0) * 2.0 - 1.0;
    float dead = step(hash11(band * 3.17 + 11.0), decay() * 0.38);
    float dep = deployStation((band + 0.5) * sp);
    vec3 lp = vec3(p.x - side * (W - 0.22), p.y - (H - 0.62), lz);
    float bulb = sdCylX(lp, 0.17, 0.14);
    // Cage bars over the bulb, so the light throws a striped shadow pattern.
    float bars = abs(mod(atan(lp.z, lp.y) * 3.0 / PI + 0.5, 1.0) - 0.5) - 0.16;
    // Striking: the filament comes up unevenly over the first metres of sight.
    float strike = smoothstep(0.15, 0.75, dep) *
      (0.75 + 0.25 * step(0.35, hash11(band * 7.7 + floor(iTime * 11.0)) + dep));
    glow = (1.0 - dead) * strike *
      (1.0 - smoothstep(0.0, 0.02, max(bulb, -bars - 0.4)));
    return bulb;
  }

  // --- hall 0: LOADING BAY -------------------------------------------------
  // Recessed landing doors every 12 m, alternating walls, their leaves rolling
  // aside as you come up on them.
  float mapLandings(vec3 p, float zc, float W, float H, out float mat) {
    mat = 5.0;
    float st = floor(zc / 12.0);
    float lz = zc - (st + 0.5) * 12.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    float dep = deployStation((st + 0.5) * 12.0);

    // Wall-local frame: x is depth out of the wall, y is height, z is along.
    vec3 lp = vec3((p.x - side * W) * -side, p.y, lz);
    float frame = sdBox(lp - vec3(-0.10, 1.05, 0.0), vec3(0.22, 1.30, 0.95));
    float hole = sdBox(lp - vec3(-0.40, 1.00, 0.0), vec3(0.60, 1.05, 0.70));
    float d = max(frame, -hole);

    // The leaf itself, sliding into the jamb.
    float leaf = sdBox(lp - vec3(-0.30, 1.00, dep * 1.34), vec3(0.06, 1.00, 0.66));
    return min(d, leaf);
  }

  // --- hall 1: PISTON GALLERY ----------------------------------------------
  // Slider-crank rams driven by the CPU's exact closed-form displacement, which
  // telescope out of their wall boxes as you come into range.
  float mapPistons(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    float st = floor(zc / 6.0);
    float lz = zc - (st + 0.5) * 6.0;
    float dep = deployStation((st + 0.5) * 6.0);

    // Normalise the mechanism's 1.28..2.52 m throw into the corridor's width,
    // and phase-offset each station so the gallery pulses as a wave. The stroke
    // itself only reaches full travel once the ram has driven out.
    float ext = (0.55 + (uMech.y - 1.28) * 0.45 + 0.10 * sin(uMech.x + st * 1.7)) * dep;

    // Rams face each other across the corridor. Folding on |x| puts the sample
    // in one wall's frame, so a single evaluation covers the pair: x is depth
    // out of the wall, y is height, z is along the corridor.
    vec3 lp = vec3(W - abs(p.x) - (1.0 - dep) * 1.25, p.y - 1.55, lz);
    float body = sdCylX(lp - vec3(-0.30, 0.0, 0.0), 0.42, 0.55);
    float rod = sdCylX(lp - vec3(-0.30 + ext * 0.5, 0.0, 0.0), 0.13, ext * 0.5 + 0.2);
    float head = sdCylX(lp - vec3(-0.30 + ext + 0.10, 0.0, 0.0), 0.30, 0.09);

    // Flywheel + crank pin, spun by the integrated angular velocity.
    vec3 fp = lp - vec3(-0.40, 0.0, 1.85);
    float wheel = sdTorusX(fp, 0.66 * dep, 0.10);
    vec3 cp = fp;
    cp.yz = rot(uMech.x) * cp.yz;
    float pin = sdCylX(cp - vec3(0.0, 0.52 * dep, 0.0), 0.07, 0.16);

    return min(min(body, min(rod, head)), min(wheel, pin));
  }

  // --- hall 2: THE LONG RUN ------------------------------------------------
  // Nearly empty and far too big. A hoist beam lowers itself across the void
  // every 9 m with a chain hanging off it — swinging, because your own footfalls
  // shake it.
  float mapLongRun(vec3 p, float zc, float W, float H, out float mat) {
    mat = 1.0;
    float st = floor(zc / 9.0);
    float lz = zc - (st + 0.5) * 9.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    float dep = deployStation((st + 0.5) * 9.0);

    float drop = (1.0 - dep) * 3.2;   // stowed up in the ceiling until called
    float beam = sdBox(vec3(p.x, p.y - (H - 0.9) - drop, lz), vec3(W, 0.20, 0.26));
    float tie = sdCylY(vec3(abs(p.x) - W * 0.72, p.y - H * 0.5, lz), 0.09, H * 0.5 * dep);

    // The chain: a capsule from the beam to the hook, laid along the pendulum.
    float ca = uMech.w;
    float len = 2.4 * dep;
    vec3 anchor = vec3(side * W * 0.45, H - 1.10 - drop, 0.0);
    vec3 tip = anchor + vec3(sin(ca) * len, -cos(ca) * len, 0.0);
    vec3 ab = tip - anchor;
    vec3 ap = vec3(p.x, p.y, lz) - anchor;
    float tt = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float chain = length(ap - ab * tt) - 0.035;
    float hook = sdTorusX(vec3(p.x, p.y, lz) - tip - vec3(0.0, -0.14, 0.0), 0.13, 0.04);

    return min(min(beam, tie), min(chain, hook));
  }

  // --- hall 3: COOLANT TIER ------------------------------------------------
  // Pipe bundles chased along all four corners; the hall is choked with
  // plumbing, and the valve wheels swing out and start turning as you arrive.
  float mapCoolant(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    // Folding by abs() puts the sample in one corner's frame, so a single
    // length() is the exact distance to all four pipe runs at once.
    vec2 q = abs(vec2(p.x, p.y - H * 0.5)) - vec2(W - 0.42, H * 0.5 - 0.42);
    float pipe = length(q) - 0.24;
    float bundle = length(abs(q) - 0.34) - 0.13;

    float st = floor(zc / 6.0);
    float lz = zc - (st + 0.5) * 6.0;
    float dep = deployStation((st + 0.5) * 6.0);
    vec3 vp = vec3(W - abs(p.x) - (1.0 - dep) * 0.85, p.y - 1.35, lz);
    vp.yz = rot(uMech.x * 0.35 * dep + st) * vp.yz;
    float wheel = sdTorusX(vp - vec3(-0.14, 0.0, 0.0), 0.42 * dep, 0.06);

    return min(min(pipe, bundle), wheel);
  }

  // --- hall 4: GEARWORKS ---------------------------------------------------
  // Meshing gear pairs that rise out of their wall recesses and spin up to the
  // integrated flywheel rate as you come level with them.
  float gearX(vec3 a, float dep) {
    float disc = sdCylX(a, 1.55 * dep, 0.22);
    float teeth = abs(mod(atan(a.z, a.y) * 9.0 / PI + 0.5, 1.0) - 0.5) - 0.30;
    return min(disc, max(sdCylX(a, 1.82 * dep, 0.20), teeth * 0.35));
  }
  float mapGearworks(vec3 p, float zc, float W, float H, out float mat) {
    mat = 3.0;
    float st = floor(zc / 12.0);
    float lz = zc - (st + 0.5) * 12.0;
    float dep = deployStation((st + 0.5) * 12.0);
    vec3 gp = vec3(W - abs(p.x) - (1.0 - dep) * 2.1, p.y - 2.3, lz);

    // Counter-rotating pair; the second is offset so the teeth interleave.
    float spin = uMech.x * dep * (mod(st, 2.0) < 0.5 ? 1.0 : -1.0);
    vec3 a = gp - vec3(-0.10, 0.0, -1.7);
    a.yz = rot(spin) * a.yz;
    vec3 b = gp - vec3(-0.10, 0.0, 1.7);
    b.yz = rot(-spin + 0.22) * b.yz;

    return min(gearX(a, dep), gearX(b, dep));
  }

  // --- hall 5: BRAKE RUN ---------------------------------------------------
  // The narrowest hall. Guide rails run its whole length at shoulder height and
  // the shoe housings clamp onto them, one bank at a time, as you walk up.
  float mapBrakeRun(vec3 p, float zc, float W, float H, out float mat) {
    mat = 5.0;
    float rail = sdBox2(vec2(abs(p.x) - (W - 0.30), p.y - 1.75), vec2(0.30, 0.13));
    float st = floor(zc / 3.0);
    float lz = zc - (st + 0.5) * 3.0;
    float dep = deployStation((st + 0.5) * 3.0);
    vec3 hp = vec3(abs(p.x) - (W - 0.42) - (1.0 - dep) * 0.42, p.y - 1.75, lz);
    float housing = sdBox(hp, vec3(0.34, 0.32, 0.50));
    float bolt = sdCylX(vec3(hp.x, hp.y, abs(hp.z) - 0.38), 0.07, 0.40);
    return min(rail, min(housing, bolt));
  }

  // --- hall 6: FURNACE FLOOR -----------------------------------------------
  // Molten tap channels run the walls behind hoods that slide back as you pass,
  // and a kerb marks the lip where the plate stops and the folding span begins.
  float mapFurnace(vec3 p, float zc, float W, float H, out float mat) {
    mat = 8.0;
    float st = floor(zc / 9.0);
    float dep = deployStation((st + 0.5) * 9.0);
    float channel = sdBox2(vec2(abs(p.x) - (W - 0.12), p.y - 1.15), vec2(0.16, 0.30));
    float hood = sdBox2(vec2(abs(p.x) - (W - 0.34), p.y - 1.70 + (1.0 - dep) * 0.52),
                        vec2(0.38, 0.10));
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
  // corridor down to — so walking the lap is a walk through seven identical
  // doorways, and the seam from the last hall to the first is one of them. Each
  // one is shut when you first see it and rolls its shutter up as you approach.
  float mapPortal(vec3 p, float zc, float W, float H) {
    float nearest = floor(zc / SEC_LEN + 0.5) * SEC_LEN;
    float dz = zc - nearest;
    float dep = deployStation(nearest);

    float slab = sdBox(vec3(p.x, p.y - H * 0.5, dz), vec3(W + 1.2, H * 0.5 + 1.2, 0.36));
    float hole = sdBox(vec3(p.x, p.y - H * 0.5 - 0.10, dz), vec3(W - 0.16, H * 0.5 - 0.06, 1.0));
    float frame = max(slab, -hole);

    // The roller shutter, corrugated, riding up into the lintel.
    float sy = p.y - dep * (H + 0.2);
    float corr = abs(mod(sy + 0.09, 0.18) - 0.09) - 0.055;
    float leaf = sdBox(vec3(p.x, sy - H * 0.5, dz), vec3(W - 0.18, H * 0.5, 0.05 + corr * 0.2));

    // A shallow threshold plate you can see (and feel) yourself step over.
    float sill = sdBox(vec3(p.x, p.y - 0.03, dz), vec3(W, 0.03, 0.30));
    return min(min(frame, sill), leaf);
  }

  // ========================== THE HOIST SHAFT ==============================
  // The shaft rises 128 m above the landing at the head of the loading bay. Its
  // interior is *unioned* with the hall's — max() of two positive-inside fields
  // — which is what opens the ceiling without any explicit boolean geometry.

  float shaftInterior(vec3 p, float dz) {
    return min(SHAFT_R - max(abs(p.x), abs(dz)),
               min(p.y - PIT_Y, SHAFT_HEAD - p.y));
  }

  // Everything solid in the shaft that is not the cage: guide rails the shoes
  // clamp, ring ribs, and landing doors flashing past on the way down.
  float mapShaftFittings(vec3 p, float dz, out float mat) {
    mat = 5.0;
    // Guide rails, running the shaft's full height. They stand off the wall on
    // brackets so they sit just clear of the cage, where the shoes can reach.
    float rail = sdBox2(vec2(abs(p.x) - 1.90, dz), vec2(0.16, 0.13));
    float bracket = max(sdBox2(vec2(abs(p.x) - (SHAFT_R - 0.5), dz), vec2(0.5, 0.07)),
                        abs(mod(p.y + 0.6, 1.2) - 0.6) - 0.09);
    rail = min(rail, bracket);

    // Ring ribs every 2.4 m — a band of the *wall*, so the inner box has to be
    // subtracted or the rib becomes a floor across the whole shaft.
    float ry = abs(mod(p.y + 1.2, 2.4) - 1.2);
    // Negating the box SDF selects its *complement* — the wall side — which is
    // the half the rib lives on. Intersecting the box itself would put a solid
    // disc straight across the shaft every 2.4 m.
    float rib = max(-sdBox2(vec2(p.x, dz), vec2(SHAFT_R - 0.16, SHAFT_R - 0.16)), ry - 0.11);

    // Landing doors every 24 m, alternating walls, opening as they come level.
    float st = floor(p.y / 24.0);
    float ly = p.y - (st + 0.5) * 24.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    float dep = deployAt(abs(cageY() - (st + 0.5) * 24.0) - 4.0);
    vec3 lp = vec3((dz - side * SHAFT_R) * -side, ly, p.x);
    float frame = sdBox(lp - vec3(-0.10, 0.0, 0.0), vec3(0.20, 1.35, 1.05));
    float hole = sdBox(lp - vec3(-0.40, -0.05, 0.0), vec3(0.60, 1.10, 0.78));
    float door = max(frame, -hole);
    float leaf = sdBox(lp - vec3(-0.30, 0.0, dep * 1.5), vec3(0.06, 1.05, 0.74));

    float d = min(rail, min(rib, min(door, leaf)));
    if (rib < rail && rib < door) mat = 0.0;
    return d;
  }

  // The cage: corner posts, floor slab, roof, a woven grating skin, the gate
  // across its two open faces and the shutter that comes down over them.
  float mapCage(vec3 p, float dz, out float mat) {
    mat = 1.0;
    vec3 c = vec3(p.x, p.y - cageY(), dz);

    float posts = sdBox(vec3(abs(c.x) - CAGE_R, c.y - CAGE_H * 0.5, abs(c.z) - CAGE_R),
                        vec3(0.075, CAGE_H * 0.5, 0.075));
    // Open mesh floor — you ride down looking through your own feet at the shaft
    // coming up, which is the whole point of the drop.
    float floorPlate = sdBox(c - vec3(0.0, -0.04, 0.0), vec3(CAGE_R, 0.035, CAGE_R));
    float fbarX = abs(mod(c.x + 0.11, 0.22) - 0.11) - 0.012;
    float fbarZ = abs(mod(c.z + 0.11, 0.22) - 0.11) - 0.012;
    float floorSlab = max(floorPlate, min(fbarX, fbarZ));
    float roof = sdBox(c - vec3(0.0, CAGE_H + 0.22, 0.0), vec3(CAGE_R + 0.06, 0.28, CAGE_R + 0.06));

    // Woven grating on the two side panels only — a fully enclosed cage puts a
    // mesh wall across the frame and everything behind it becomes unreadable.
    float slab = max(c.y - CAGE_H, -c.y);
    float ring = abs(abs(c.x) - CAGE_R) - 0.016;
    float vbar = abs(mod(c.z + 0.08, 0.16) - 0.08) - 0.013;
    float hbar = abs(mod(c.y + 0.1, 0.2) - 0.1) - 0.013;
    float grate = max(max(ring, min(vbar, hbar)), max(slab, abs(c.z) - CAGE_R));

    float d = min(min(posts, floorSlab), min(roof, grate));

    // The gate: a barred grille across both open faces, riding up as it opens.
    if (gateOpen() < 0.985) {
      float gy = c.y - gateOpen() * (CAGE_H - 0.06);
      vec3 gp = vec3(c.x, gy, abs(c.z) - CAGE_R);
      float panel = sdBox(gp - vec3(0.0, CAGE_H * 0.5, 0.0), vec3(CAGE_R, CAGE_H * 0.5, 0.035));
      float bars = abs(mod(gp.x + 0.17, 0.34) - 0.17) - 0.016;
      float rails = abs(abs(gy - CAGE_H * 0.5) - CAGE_H * 0.45) - 0.05;
      float gate = max(panel, min(bars, rails));
      if (gate < d) { d = gate; mat = 5.0; }
    }

    // The shutter: a solid corrugated plate, stowed in the roof header until the
    // end of the lap, when it comes down and seals the cage.
    if (shutter() > 0.015) {
      float sy = c.y - CAGE_H + shutter() * CAGE_H;
      float corr = abs(mod(sy + 0.08, 0.16) - 0.08) - 0.05;
      vec3 sp = vec3(c.x, sy - CAGE_H * 0.5, abs(c.z) - CAGE_R);
      float shut = sdBox(sp, vec3(CAGE_R + 0.03, CAGE_H * 0.5, 0.04 + corr * 0.25));
      if (shut < d) { d = shut; mat = 1.0; }
    }

    // Dome lamp under the roof — the only light in here once the shutter is down.
    float dome = sdCylY(c - vec3(0.0, CAGE_H - 0.10, 0.0), 0.16, 0.07);
    if (dome < d) { d = dome; mat = 4.0; }

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

  // What is left of the hoist cable: intact and taut above the cage, or a few
  // metres of severed rope whipping after it.
  float mapCable(vec3 p, float dz) {
    float top = cageY() + CAGE_H + 0.5;
    if (p.y < top) return 1e9;
    if (uSim.w > 0.5) {
      vec2 off = abs(vec2(p.x, dz)) - vec2(0.42, 0.42);
      return length(max(off, 0.0)) + min(max(off.x, off.y), 0.0) - 0.035;
    }
    // Severed: the loose end lashes about as it falls with the cage.
    float h = p.y - top;
    if (h > 5.0) return h - 5.0;
    float whip = sin(h * 1.6 + iTime * 9.0) * 0.30 * h / 5.0;
    return length(vec2(p.x - whip, dz - whip * 0.6)) - 0.035;
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
    float dzl = cycd(zc - LIFT_Z);
    gMat = 0.0; gWear = 0.4; gGlow = 0.0;

    // --- the shaft, which is all there is above the halls' ceilings ---------
    float d = shaftInterior(p, dzl);
    if (p.y < CEIL_MAX) {
      float a, b, t, tf;
      secBlend(zc, a, b, t, tf);

      // --- per-loop decay: the corridor snakes, breathes and closes in ------
      // Guarded to leave the walker's immediate surroundings alone, otherwise at
      // high iterations the walls fold through the camera.
      vec3 pw = p;
      float dec = decay();
      if (dec > 0.005) {
        float guard = smoothstep(1.2, 8.0, abs(p.z - walkZ()));
        float snake = sin(p.z * 0.055 + iTime * 1.1) * dec * 1.6;
        float wx = sin(p.z * 1.7 + iTime * 2.0) * cos(p.y * 1.4) * 0.42 * dec;
        float wy = cos(p.z * 1.5 + iTime * 1.5) * sin(p.x * 1.2) * 0.34 * dec;
        pw.x += (snake + wx) * guard;
        pw.y += wy * guard;
      }

      vec2 pr = mix(secProfile(a), secProfile(b), t);
      float squeeze = 1.0 - dec * 0.18;
      float W = pr.x * squeeze;
      float H = pr.y * squeeze;

      float wear;
      float hall = mapHall(pw, zc, W, H, a, wear);
      // The shaft's interior unions with the hall's, opening the ceiling above
      // the landing. Far from it the shaft is deeply negative and does nothing.
      d = max(hall, d);
      gWear = wear;

      // --- the hall's signature machinery, dissolved at the boundary --------
      float fmA;
      float feat = secFeature(a, pw, zc, W, H, fmA) + tf * FEAT_ERODE;
      float fmat = fmA;
      if (tf > 0.002) {
        float fmB;
        float featB = secFeature(b, pw, zc, W, H, fmB) + (1.0 - tf) * FEAT_ERODE;
        if (featB < feat) { feat = featB; fmat = fmB; }
      }
      if (feat < d) { d = feat; gMat = fmat; gWear = 0.10; }

      float portal = mapPortal(pw, zc, W, H);
      if (portal < d) { d = portal; gMat = 1.0; gWear = 0.45; }

      // --- the folding span and the melt under it --------------------------
      if (abs(cycd(zc - SPAN_MID)) < SPAN_HALF + 4.0) {
        float span = mapSpan(pw, zc);
        if (span < d) { d = span; gMat = 6.0; gWear = 0.20; }

        if (p.y < 0.4) {
          float surf = MELT_Y + fbm(vec2(p.x * 0.22, p.z * 0.22 + iTime * 0.10)) * 1.3;
          float melt = p.y - surf;
          if (melt < d) { d = melt; gMat = 8.0; gWear = 0.0; gGlow = 1.0; }
        }
      }

      float lg;
      float lamp = mapLamps(pw, W, H, a, lg);
      if (lamp < d) { d = lamp; gMat = 4.0; gGlow = lg; }

      // Two dissolving fitting sets plus a funnelling profile leave the field
      // non-Lipschitz for a few metres either side of a boundary; shorten the
      // step to absorb it.
      if (t > 0.02 && t < 0.995) d *= 0.78;
    }

    // --- the shaft's own fittings, the cage, and what is loose in it --------
    if (abs(dzl) < 26.0) {
      float sm;
      float fit = mapShaftFittings(p, dzl, sm);
      if (fit < d) { d = fit; gMat = sm; gWear = 0.30; }

      float cm;
      float cage = mapCage(p, dzl, cm);
      // The cage's own dome lamp is the one emissive thing on it.
      if (cage < d) { d = cage; gMat = cm; gWear = 0.55; gGlow = step(3.5, cm) * step(cm, 4.5); }

      float deb = mapDebris(p, dzl);
      if (deb < d) { d = deb; gMat = 2.0; gWear = 0.75; gGlow = 0.0; }

      float cab = mapCable(p, dzl);
      if (cab < d) { d = cab; gMat = 5.0; gWear = 0.30; gGlow = 0.0; }
    }

    return d;
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy) - mapScene(p - e.xyy),
      mapScene(p + e.yxy) - mapScene(p - e.yxy),
      mapScene(p + e.yyx) - mapScene(p - e.yyx)));
  }

  // ========================= SURFACE TEXTURE ===============================
  // No image textures: one draw call, no render targets, no assets. Every
  // material is built from a height field, and that one field does three jobs —
  // it tints the albedo, it drives the roughness, and its gradient perturbs the
  // normal, which is what actually makes plate read as plate rather than as a
  // flat-shaded box.

  /** Planar projection onto whichever axis the surface faces least. */
  vec2 surfUV(vec3 p, vec3 n) {
    vec3 a = abs(n);
    if (a.y > a.x && a.y > a.z) return p.xz;
    if (a.x > a.z) return p.zy;
    return p.xy;
  }

  /** Anisotropic rolling grain — the direction the plate came off the mill. */
  float grain(vec2 uv) {
    return vnoise(vec2(uv.x * 1.6, uv.y * 42.0)) * 0.6 + vnoise(uv * 7.0) * 0.4;
  }

  /** Corrosion: sparse deep pits scattered through the broad rust blooms. */
  float pitting(vec2 uv) {
    vec2 c = floor(uv * 18.0);
    vec2 f = fract(uv * 18.0) - 0.5 -
      (vec2(hash21(c + 3.1), hash21(c + 7.7)) - 0.5) * 0.7;
    return smoothstep(0.42, 0.0, length(f)) * step(0.66, hash21(c));
  }

  /** Weld beads where plate meets plate, on a 1.2 m grid. */
  float weldSeam(vec2 uv) {
    vec2 g = abs(fract(uv / 1.2 + 0.5) - 0.5) * 1.2;
    return smoothstep(0.05, 0.0, min(g.x, g.y)) * (0.7 + 0.3 * vnoise(uv * 22.0));
  }

  /** Rivet heads following the weld lines. */
  float rivets(vec2 uv) {
    vec2 g = abs(fract(uv / 1.2 + 0.5) - 0.5) * 1.2;
    vec2 q = fract(uv / 0.16) - 0.5;
    return smoothstep(0.055, 0.0, min(g.x, g.y)) * smoothstep(0.34, 0.10, length(q));
  }

  /** Grime running down from every horizontal edge. */
  float streaks(vec3 p, vec3 n) {
    return (1.0 - abs(n.y)) *
      smoothstep(0.42, 0.95, fbm(vec2(p.x * 2.6 + p.z * 2.6, p.y * 0.22)));
  }

  /** Raised diamond tread on the walking surfaces. */
  float treadPlate(vec2 uv) {
    vec2 q = uv * 3.4;
    vec2 a = fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5;
    return smoothstep(0.36, 0.18, max(abs(a.x), abs(a.y)));
  }

  /**
   * The height field, per material. Everything the eye reads as "machined" or
   * "corroded" or "walked on" is this function plus the gradient of it.
   */
  float matHeight(vec3 p, vec3 n, float mat, float wear) {
    vec2 uv = surfUV(p, n);
    if (mat < 0.5) {
      // Structural plate: welded, riveted, pitted, and treaded where you walk.
      float h = weldSeam(uv) * 0.9 + rivets(uv) * 0.7 + grain(uv) * 0.10;
      h -= pitting(uv) * smoothstep(0.4, 0.9, wear) * 1.4;
      h += treadPlate(uv) * step(0.72, n.y) * 1.1;
      return h;
    }
    if (mat < 1.5)
      // Painted frame: a smooth film, broken where it has chipped to primer.
      return grain(uv) * 0.20 - smoothstep(0.42, 0.72, wear) * 0.9;
    if (mat < 2.5)
      // Offcut: hot-rolled scale, coarse and scabby.
      return fbm(uv * 14.0) * 1.1;
    if (mat < 3.5)
      // Machined: fine turning grooves plus the odd score.
      return sin(uv.y * 210.0) * 0.10 + vnoise(uv * 40.0) * 0.10;
    if (mat < 5.5)
      // Rail steel: worn smooth on the running face, pitted off it.
      return grain(uv) * 0.35 - pitting(uv) * 0.7;
    // Span panel: brushed plate, with the hinge seams standing proud.
    return grain(uv) * 0.30 + weldSeam(uv * 1.7) * 0.5;
  }

  /**
   * Perturb the shading normal by the gradient of the height field, projected
   * onto the surface. Four extra field evaluations, but only at the hit point —
   * the march itself never pays for them.
   */
  vec3 bumpNormal(vec3 p, vec3 n, float mat, float wear, float amp) {
    vec2 e = vec2(0.03, 0.0);
    float h0 = matHeight(p, n, mat, wear);
    vec3 g = vec3(matHeight(p + e.xyy, n, mat, wear),
                  matHeight(p + e.yxy, n, mat, wear),
                  matHeight(p + e.yyx, n, mat, wear)) - h0;
    g = clamp(g / e.x, -9.0, 9.0);
    g -= n * dot(n, g);
    return normalize(n - g * amp);
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
    if (i > 4.5 && i < 5.5) return 2.1;  // brake run: dense lamps, dial each down
    if (i > 5.5) return 2.6;             // furnace floor is half-lit by the melt
    return 3.4;
  }

  /**
   * Anisotropic highlight. Rolled and ground steel scatters along its grain, so
   * the specular lobe is stretched across the direction the surface was worked
   * in — the single cheapest thing that stops metal looking like plastic.
   */
  float anisoSpec(vec3 n, vec3 ld, vec3 rd, vec3 tang, float rough, float aniso) {
    vec3 h = normalize(ld - rd);
    float e = mix(mix(90.0, 8.0, rough), mix(90.0, 8.0, rough) * (1.0 - aniso * 0.9),
                  abs(dot(h, tang)));
    return pow(max(dot(h, n), 0.0), max(e, 2.0));
  }

  // The three nearest corridor lamps dominate; approximating the strip as a few
  // point lights is far cheaper than iterating the hall and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, vec3 tang,
                 float W, float H, float sec) {
    vec3 acc = vec3(0.0);
    float sp = secLampSpacing(sec);
    vec3 lcol = mix(secLampColour(sec), vec3(1.00, 0.30, 0.16), decay() * 0.55);
    float lpow = secLampPower(sec);
    float band = floor(p.z / sp);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      if (hash11(bi * 3.17 + 11.0) < decay() * 0.38) continue;  // this one has failed
      float lz = (bi + 0.5) * sp;
      vec3 lp = vec3(side * (W - 0.22), H - 0.62, lz);
      vec3 ld = lp - p;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = smoothstep(0.15, 0.75, deployStation(lz)) / (1.0 + dist * dist * 0.030);
      // Half-lambert: real halls are full of bounce light off the plate, and a
      // hard terminator here just crushes everything to black.
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = anisoSpec(n, ld, rd, tang, rough, 0.7);
      acc += (albedo * diff + spec * (1.0 - rough) * 0.40) * atten * lcol * lpow;
    }
    return acc;
  }

  /** The shaft's own lamps, stacked up the wall instead of along the hall. */
  vec3 shaftLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, vec3 tang, float dzl) {
    vec3 acc = vec3(0.0);
    float band = floor(p.y / 9.0);
    // Everything here is in the shaft's own frame, where z measures across the
    // shaft rather than along the lap.
    vec3 pl = vec3(p.x, p.y, dzl);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      vec3 lp = vec3(side * (SHAFT_R - 0.22), (bi + 0.5) * 9.0, 0.0);
      vec3 ld = lp - pl;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = 1.0 / (1.0 + dist * dist * 0.026);
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = anisoSpec(n, ld, rd, tang, rough, 0.7);
      acc += (albedo * diff + spec * (1.0 - rough) * 0.35) * atten
        * vec3(1.00, 0.80, 0.58) * 4.0;
    }
    return acc;
  }

  /** The cage's dome lamp — the only thing lighting you once the shutter drops. */
  vec3 domeLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, float dzl) {
    vec3 lp = vec3(0.0, cageY() + CAGE_H - 0.14, 0.0);
    vec3 ld = lp - vec3(p.x, p.y, dzl);
    float dist = length(ld);
    if (dist > 9.0) return vec3(0.0);
    ld /= max(dist, 0.001);
    float atten = 1.0 / (1.0 + dist * dist * 0.55);
    float diff = dot(n, ld) * 0.5 + 0.5;
    return albedo * diff * diff * atten * vec3(1.00, 0.86, 0.66) * 3.0;
  }

  // The melt under the folding span: a warm updraft that only reaches the last
  // hall of the lap.
  vec3 furnaceLight(vec3 p, vec3 n, vec3 albedo, float zc) {
    float near = 1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 16.0, abs(cycd(zc - SPAN_MID)));
    if (near < 0.01) return vec3(0.0);
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0) * 0.8 + 0.2;
    float depth = clamp((p.y - MELT_Y) / 34.0, 0.0, 1.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.z * 0.4, iTime * 1.7));
    return albedo * up * near * (1.0 - depth * 0.75) * flick * vec3(1.30, 0.44, 0.10);
  }

  vec3 shadeSurface(vec3 p, vec3 nGeo, vec3 rd, float dist, float zc, float dzl,
                    float W, float H, float sec) {
    float mat = gMat, wear = gWear;

    // Lamp glass is emissive and takes no lighting at all.
    if (mat > 3.5 && mat < 4.5)
      return mix(vec3(0.06, 0.06, 0.07), vec3(1.0, 0.76, 0.42) * 2.6, gGlow);

    // Molten metal is its own light source; the churn is what reads as liquid.
    if (mat > 7.5) {
      float churn = fbm(vec2(p.x * 0.5, p.z * 0.5 - iTime * 0.35));
      float crust = smoothstep(0.42, 0.30, churn);
      vec3 hot = mix(vec3(1.5, 0.42, 0.06), vec3(2.6, 1.5, 0.45), churn);
      return mix(hot * (0.55 + 0.45 * churn), vec3(0.10, 0.045, 0.03), crust * 0.8);
    }

    vec2 uv = surfUV(p, nGeo);
    vec3 n = bumpNormal(p, nGeo, mat, wear, 0.045);
    // Plate is rolled along the hall, so the grain runs with +Z on the walls and
    // ceiling and across the floor.
    vec3 tang = abs(nGeo.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);

    vec3 albedo; float rough;
    if (mat < 0.5) {
      // Structural plate: dark steel, rust blooming out of the wear field and
      // biting deepest in the pits, weld beads bright, grime running down.
      float rust = smoothstep(0.60, 0.95, wear + pitting(uv) * 0.35);
      albedo = mix(vec3(0.085, 0.090, 0.100), vec3(0.24, 0.115, 0.055), rust);
      albedo = mix(albedo, vec3(0.20, 0.21, 0.23), weldSeam(uv) * 0.55);
      albedo *= 1.0 - streaks(p, nGeo) * 0.35;
      albedo *= 1.0 + treadPlate(uv) * step(0.72, nGeo.y) * 0.55;
      albedo *= 0.85 + 0.30 * grain(uv);
      rough = mix(0.68, 0.94, rust);
    } else if (mat < 1.5) {
      // Painted frame: hazard stripes over primer, chipped back to bare steel
      // wherever it has been knocked.
      float stripe = step(0.5, fract((p.x * 0.6 + p.y * 0.6 + p.z * 0.6)));
      vec3 paint = mix(vec3(0.34, 0.24, 0.05), vec3(0.055, 0.050, 0.048), stripe);
      float chip = smoothstep(0.42, 0.72, wear + pitting(uv) * 0.4);
      albedo = mix(paint, vec3(0.11, 0.10, 0.10), chip);
      albedo *= 1.0 - streaks(p, nGeo) * 0.30;
      rough = mix(0.55, 0.90, chip);
    } else if (mat < 2.5) {
      // Offcut: hot-rolled mill scale, blue-black over grey steel.
      float scale = smoothstep(0.35, 0.75, fbm(uv * 9.0));
      albedo = mix(vec3(0.115, 0.125, 0.155), vec3(0.26, 0.16, 0.10), scale * wear);
      rough = mix(0.52, 0.82, scale);
    } else if (mat < 3.5) {
      // Machined: ground steel carrying the lamps as hard stretched highlights,
      // with an oil film pooled in the grooves.
      float turn = 0.5 + 0.5 * sin(uv.y * 210.0);
      albedo = mix(vec3(0.30, 0.315, 0.35), vec3(0.44, 0.45, 0.49), turn);
      albedo = mix(albedo, vec3(0.20, 0.19, 0.14), smoothstep(0.55, 0.9, fbm(uv * 3.0)) * 0.6);
      rough = mix(0.14, 0.34, turn * 0.5 + wear * 0.5);
    } else if (mat < 5.5) {
      // Rail steel: polished bright where the shoes ride, corroded either side.
      float pol = smoothstep(0.55, 0.15, abs(uv.x - floor(uv.x + 0.5)));
      albedo = mix(vec3(0.20, 0.19, 0.18), vec3(0.42, 0.43, 0.46), pol);
      albedo = mix(albedo, vec3(0.26, 0.13, 0.06), pitting(uv) * 0.8);
      rough = mix(0.52, 0.20, pol);
    } else {
      // Span panel: pale machined plate, brushed, with the hinge seams worn.
      albedo = vec3(0.40, 0.42, 0.48) * (0.86 + 0.28 * grain(uv));
      rough = 0.34;
    }

    vec3 col = albedo * vec3(0.13, 0.145, 0.185);         // cool ambient bounce
    if (p.y < CEIL_MAX)
      col += lampLight(p, n, albedo, rough, rd, tang, W, H, sec);
    if (abs(dzl) < 7.0) {
      col += domeLight(p, n, albedo, rough, rd, dzl);
      if (p.y > 1.0)
        col += shaftLight(p, n, albedo, rough, rd, tang, dzl);
    }
    col += furnaceLight(p, n, albedo, zc);

    // Brake sparks throw a hard white-hot key off the rail contact patch, which
    // is the only thing lighting the cage while the shoes are working.
    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * 1.90, cageY() + 0.1, 0.0);
      vec3 sd = sp - vec3(p.x, p.y, dzl);
      float sdist = length(sd);
      float att = 1.0 / (1.0 + sdist * sdist * 0.10);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0) * att * spark()
        * vec3(3.4, 2.6, 1.5);
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

    // --- lens: barrel distortion that tightens as the lap decays -------------
    float r2 = dot(uv, uv);
    uv += uv * r2 * (0.030 + 0.34 * dec + 0.5 * wrap);

    // --- torn scanlines: whole slices of the world shift sideways -----------
    float tear = dec * 0.30 + wrap;
    if (tear > 0.02) {
      float bandY = floor(uv.y * 26.0 + iTime * 31.0);
      if (hash11(bandY * 0.137 + 3.0) < tear * 0.30)
        uv.x += (hash11(bandY * 1.71) - 0.5) * tear * 0.10;
    }

    // The camera is whatever the simulation is doing to you. Riding the cage it
    // is carried by the car, with the shake read off its jerk and the offcuts
    // hammering its floor; on foot it is the gait — the head drops on each heel
    // strike and rebounds on the leg spring, and the body rolls into the sway.
    // None of it is a function of iTime.
    vec3 ro = vec3(uGait.y + uSim.x * 0.018, uGait.x + uSim.y * 0.018, walkZ());
    float yaw = uGait.z + uPointer.x * 0.75 + uSim.x * 0.008;
    float pitch = uGait.w + uPointer.y * 0.50;
    float roll = uWalk.w + uSim.x * 0.02;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    // The fall widens the lens; nothing sells speed like the frame opening up.
    float fov = 1.20 - 0.16 * weightless();
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
    float dzl = cycd(zc - LIFT_Z);
    float sa, sb, st, stf;
    secBlend(zc, sa, sb, st, stf);
    vec2 pr = mix(secProfile(sa), secProfile(sb), st);
    float squeeze = 1.0 - dec * 0.18;

    // Background: the halls have no sky, only the melt burning under the last
    // one and the cold nothing of a shaft that runs out of lamps.
    vec3 col = vec3(0.012, 0.010, 0.014)
      + vec3(0.34, 0.10, 0.02) * pow(max(-rd.y, 0.0), 2.0)
        * (1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 20.0, abs(cycd(zc - SPAN_MID))));

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      col = shadeSurface(p, n, rd, dist, zc, dzl, pr.x * squeeze, pr.y * squeeze, sa);
      float fogDen = mix(0.038, 0.022, riding()) + dec * 0.012;
      vec3 fogCol = mix(vec3(0.030, 0.026, 0.030), vec3(0.045, 0.016, 0.012), dec);
      float fog = 1.0 - exp(-dist * fogDen);
      col = mix(col, fogCol, fog);
    }

    // --- spark shower off the guide rails while the shoes are biting --------
    if (spark() > 0.01) {
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        // Sparks are thrown off the rail and fall behind the still-moving cage.
        vec3 sp = vec3(sign(seed - 0.5) * 1.90,
                       cageY() + 0.2 + fract(seed * 7.3) * 2.4,
                       walkZ() + cycd(LIFT_Z - walkZ()) + (fract(seed * 3.1) - 0.5) * 1.6);
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
      float steam = fbm(vec2(uv.x * 3.0 + iTime * 0.15, uv.y * 3.0 - iTime * 0.55 + ro.y * 0.2));
      steam *= smoothstep(0.6, 1.0, steam) * 0.5;
      col += vec3(0.16, 0.15, 0.17) * steam * (0.3 + 0.7 * weightless());
    }

    // --- grade --------------------------------------------------------------
    // Free fall desaturates and cools, the brake flash blows the highlights out,
    // and the decay rots the whole grade toward oxblood.
    float wl = weightless();
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), wl * 0.30);
    col *= mix(vec3(1.0), vec3(0.86, 0.92, 1.10), wl);
    col += vec3(1.0, 0.8, 0.55) * spark() * 0.06;
    if (dec > 0.02) {
      vec3 rotten = vec3(col.r * 1.18, col.g * 0.74, col.b * 0.66);
      col = mix(col, rotten, dec * 0.55);
      // Spectral fringing: a single-pass march has no framebuffer to resample,
      // so the channels are separated radially on the graded image instead —
      // strongest at the edges, exactly where a real lens loses them.
      float fr = dot(uv, uv) * (dec * 0.55 + wrap);
      float lum0 = dot(col, vec3(0.299, 0.587, 0.114));
      col.r = mix(col.r, col.r * 1.25 + lum0 * 0.10, fr);
      col.b = mix(col.b, col.b * 0.80 + lum0 * 0.16, fr);
    }

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.7, lum) * 0.5;                  // pseudo-bloom
    col = pow(clamp(col, 0.0, 1.8), vec3(0.90));

    // Thin TV scanlines, heavier the further round the lap you are.
    col -= (0.02 + 0.05 * dec) * sin(gl_FragCoord.y * 1.6 + iTime * 12.0);

    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * (0.65 + 0.12 * dec); // vignette
    // Sensor grain, heavier under acceleration and as the foundry comes apart.
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.050 * dec + 0.12 * wrap + 0.04 * clamp(abs(cageA()) / 40.0, 0.0, 1.0));

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
// build of the one above: the journey's opening shot, an analytic plunge down a
// shaft past ribs, lamps and a landing door, with the brake flash on a cycle.
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

    // The drop runs on a cycle: free fall, shoes, stop, and away again.
    float cycle = fract(iTime * 0.085);
    float speed = 26.0 * (1.0 - smoothstep(0.62, 0.86, cycle));
    float brake = smoothstep(0.62, 0.70, cycle) * (1.0 - smoothstep(0.84, 0.94, cycle));
    float fall = iTime * 14.0 - 60.0 * smoothstep(0.62, 0.86, cycle);
    // The stop throws the frame down and lets it rebound.
    uv.y += brake * 0.05 * sin(cycle * 90.0) * exp(-(cycle - 0.62) * 14.0);

    // Fake-perspective shaft: |uv| drives distance to the wall, so the frame
    // reads as looking down a square well.
    float q = max(abs(uv.x), abs(uv.y));
    float depth = 0.42 / max(q, 0.02);

    // Ribs streaming up past the cage.
    float rib = fract(depth * 0.9 + fall * 0.06);
    float ribHi = smoothstep(0.0, 0.06, rib) * (1.0 - smoothstep(0.14, 0.22, rib));

    float shade = clamp(1.6 / depth, 0.04, 1.0);
    vec3 col = vec3(0.085, 0.088, 0.098) * shade;
    col = mix(col, vec3(0.26, 0.12, 0.06) * shade, hash21(floor(vec2(uv * 14.0))) * 0.5);
    col += ribHi * shade * 0.16;

    // Caged wall lamps, staggered, streaming upward as the cage falls.
    float lampPhase = fract(depth * 0.30 + fall * 0.02);
    float lamp = smoothstep(0.03, 0.0, abs(lampPhase - 0.5)) * smoothstep(0.55, 0.25, abs(uv.x));
    col += vec3(1.0, 0.72, 0.38) * lamp * 1.6;

    // Motion blur along the fall, which is what actually reads as speed.
    col *= 1.0 - clamp(speed, 0.0, 26.0) / 26.0 * 0.35 * smoothstep(0.1, 0.6, abs(uv.y));

    // The cage's own gate — the bars you are looking out through.
    float bars = min(abs(fract(uv.x * 9.0) - 0.5), abs(fract(uv.y * 9.0) - 0.5));
    col *= mix(1.0, 0.35, smoothstep(0.06, 0.0, bars));

    // Brake sparks off the guide rails, and the melt burning far below.
    float sparkle = step(0.985, hash21(floor(uv * 90.0) + floor(iTime * 30.0)));
    col += vec3(1.6, 0.95, 0.42) * sparkle * brake * 1.8;
    col += vec3(0.30, 0.09, 0.02) * pow(max(-uv.y, 0.0), 2.0) * 1.2;

    col *= 1.0 - smoothstep(0.40, 1.05, length(uv)) * 0.6;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 96 raymarch steps x (hall + deployed machinery + portal +
// shaft + cage + 6 quaternion-rotated debris boxes + 8 folding cubes), plus four
// height-field evaluations for the bump normal at the hit. The bounding-sphere
// rejects, the ceiling test that skips the whole corridor while you are up the
// shaft, and the shaft/span distance gates keep the common case near the cost of
// the corridor alone. ~1 draw call, no textures, no render targets.
