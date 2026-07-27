// THE FOUNDRY — a simulated descent down a machine shaft.
//
// Companion piece to THE LIMINAL JOURNEY: the same first-person plunge into the
// dark, but the abyss is replaced by machinery, and the motion is not authored.
// Every moving thing in this shader is positioned by uniforms produced by the
// rigid-body integrator in physics.ts — cage height, velocity and acceleration,
// six tumbling debris bodies (position + orientation quaternion), the exact
// slider-crank piston extension, and a pendulum hook swung by the cage's own
// acceleration. The shader draws state; it does not invent motion.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only. Uniforms beyond the shared set:
//   uCage    = (floorY, velocity, acceleration, phase)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, hookAngle, flywheelOmega)
//   uDebris  = 6 x (worldX, worldY, worldZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion (x, y, z, w)
//   uWalk    = (walkZ, cubeBaseIndex, walkBlend, walkSpeed)
//   uFold0/1 = fold coordinate of the 8 live path cubes
//
// The journey is in two movements. The shaft is seven 200 m bands, each its own
// machine environment (loading bay, piston gallery, long run, coolant tier,
// gearworks, brake run, furnace floor) with its own width, rib and lamp cadence
// and lamp colour. Then the cage lands, the gate opens, and the second movement
// is a walk forward over an infinite fall on a path of cubes that unfold their
// faces about hinge edges to lay the floor a moment before it is stood on.

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (steam volumetrics, extra sparks)

  uniform vec4 uCage;          // floorY, velocity, acceleration, phase
  uniform vec4 uSim;           // shakeX, shakeY, brakeSpark, cableIntact
  uniform vec4 uMech;          // crank, pistonExtension, hookAngle, flywheelOmega
  uniform vec4 uDebris[6];     // xyz = world position, w = half-extent scale
  uniform vec4 uDebrisQ[6];    // orientation quaternion
  uniform vec4 uWalk;          // walkZ, cubeBase, walkBlend, walkSpeed
  uniform vec4 uFold0;         // fold coordinate of live cubes 0..3
  uniform vec4 uFold1;         // fold coordinate of live cubes 4..7

  const float PI = 3.14159265359;
  const float CAGE_R = 1.5;      // cage interior half-width — mirrors physics.ts
  const float CAGE_H = 2.6;
  const float EYE = 1.62;        // eye height above the cage floor
  const float SEC_LEN = 200.0;   // section length — mirrors physics.ts
  const float FLOOR_Y = -1400.0; // hydraulic buffer floor — mirrors physics.ts

  // The shaft is seven 200 m bands, each a different machine environment:
  //   0 LOADING BAY  1 PISTON GALLERY  2 THE LONG RUN  3 COOLANT TIER
  //   4 GEARWORKS    5 BRAKE RUN       6 FURNACE FLOOR
  // Geometry is keyed off the *sample point's* band, so a ray only ever
  // evaluates the one or two bands it actually passes through — never all seven.
  float secIndex(float y) { return clamp(floor(-y / SEC_LEN), 0.0, 6.0); }

  // Per-band shaft half-width. The shaft breathes: tight at the top, cavernous
  // through the long run, choked down again for the brake run.
  float secRadius(float i) {
    if (i < 0.5) return 4.6;   // loading bay   — tight, riveted
    if (i < 1.5) return 5.6;   // piston gallery
    if (i < 2.5) return 11.0;  // long run      — cavernous, vertiginous
    if (i < 3.5) return 5.0;   // coolant tier  — choked with pipework
    if (i < 4.5) return 7.2;   // gearworks
    if (i < 5.5) return 3.9;   // brake run     — narrowest, walls close in
    return 8.0;                // furnace floor — opens into the melt
  }

  // Continuous radius: blend across the last fifth of each band so the seams
  // are a funnel rather than a step.
  float shaftR(float y) {
    float f = clamp(-y / SEC_LEN, 0.0, 6.999);
    float i = floor(f);
    float t = fract(f);
    return mix(secRadius(i), secRadius(min(i + 1.0, 6.0)), smoothstep(0.78, 1.0, t));
  }

  // Per-band rib and lamp cadence. Sparse lamps in the long run are what make
  // it feel empty; dense ones in the brake run make the speed legible.
  float secRibSpacing(float i) {
    if (i < 0.5) return 3.0;
    if (i < 1.5) return 6.0;
    if (i < 2.5) return 16.0;
    if (i < 3.5) return 4.0;
    if (i < 4.5) return 12.0;
    if (i < 5.5) return 2.0;
    return 9.0;
  }
  float secLampSpacing(float i) {
    if (i < 0.5) return 6.0;
    if (i < 1.5) return 8.0;
    if (i < 2.5) return 20.0;  // long run: sparse, but not featureless
    if (i < 3.5) return 7.0;
    if (i < 4.5) return 11.0;
    if (i < 5.5) return 4.0;   // brake run: strobing past
    return 16.0;
  }

  // Material/look state written by the SDF at the nearest hit.
  float gMat;      // 0 shaft steel, 1 cage frame, 2 debris, 3 chrome, 4 lamp, 5 rail
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
  float cageV() { return uCage.y; }
  float cageA() { return uCage.z; }
  float phase() { return uCage.w; }
  float spark() { return uSim.z; }
  // Free fall reads as weightlessness: the cage's acceleration approaches -g.
  float weightless() { return smoothstep(-6.0, -9.2, cageA()); }

  // ============================ GEOMETRY ===================================

  // Shaft: a square steel well whose width, rib cadence and rail treatment all
  // come from the sample's band. Positive inside.
  float mapShaft(vec3 p, out float mat, out float wear) {
    mat = 0.0;
    float sec = secIndex(p.y);
    float R = shaftR(p.y);
    float d = R - max(abs(p.x), abs(p.z));

    // Inward-protruding structural ribs at the band's cadence.
    float rsp = secRibSpacing(sec);
    float ry = abs(mod(p.y + rsp * 0.5, rsp) - rsp * 0.5);
    d -= smoothstep(0.30, 0.0, ry) * 0.26;

    // Rivet dimples along each rib — pure surface detail, so only bias the
    // distance slightly rather than building real geometry.
    float rv = hash21(floor(vec2(p.x * 3.0 + p.z * 7.0, p.y * 2.0)));
    d -= smoothstep(0.16, 0.0, ry) * rv * 0.02;

    wear = fbm(vec2(p.x * 1.3 + p.z * 2.1, p.y * 0.55));

    // Guide rails: T-section runners on the +x/-x walls at z = 0. They fatten
    // through the brake run, where they are the thing doing the stopping.
    float railW = sec > 4.5 && sec < 5.5 ? 0.52 : 0.30;
    vec3 rp = vec3(abs(p.x) - (R - railW - 0.04), p.y, p.z);
    float rail = sdBox(vec3(rp.x, 0.0, rp.z), vec3(railW, 1.0, 0.13));
    if (rail < d) { d = rail; mat = 5.0; wear = 0.15; }

    return d;
  }

  // Caged wall lamps, staggered left/right at the band's cadence.
  float mapLamps(vec3 p, out float glow) {
    float sp = secLampSpacing(secIndex(p.y));
    float band = floor(p.y / sp);
    float ly = p.y - (band + 0.5) * sp;
    float side = mod(band, 2.0) * 2.0 - 1.0;
    vec3 lp = vec3(p.x - side * (shaftR(p.y) - 0.25), ly, p.z);
    float bulb = sdCylX(lp, 0.17, 0.14);
    // Cage bars over the bulb, so the light throws a striped shadow pattern.
    float bars = abs(mod(atan(lp.z, lp.y) * 3.0 / PI + 0.5, 1.0) - 0.5) - 0.16;
    glow = 1.0 - smoothstep(0.0, 0.02, max(bulb, -bars - 0.4));
    return bulb;
  }

  // --- band 0: LOADING BAY -------------------------------------------------
  // Recessed landing doors every 40 m, light spilling from the ones left open.
  float mapLandings(vec3 p, out float mat) {
    mat = 5.0;
    float R = shaftR(p.y);
    float bay = floor(p.y / 40.0);
    float by = p.y - (bay + 0.5) * 40.0;
    float side = hash11(bay) > 0.5 ? 1.0 : -1.0;
    vec3 lp = vec3((p.x - side * R) * -side, by, p.z);
    // Door frame: a rectangular lintel + threshold set into the wall.
    float frame = sdBox(lp - vec3(-0.10, 0.0, 0.0), vec3(0.22, 1.5, 2.0));
    float hole = sdBox(lp - vec3(-0.40, -0.1, 0.0), vec3(0.60, 1.3, 1.7));
    return max(frame, -hole);
  }

  // --- band 1: PISTON GALLERY ---------------------------------------------
  // Slider-crank rams driven by the CPU's exact closed-form displacement.
  float mapPistons(vec3 p, out float mat) {
    mat = 3.0;
    float R = shaftR(p.y);
    float station = floor(p.y / 12.0);
    float py = p.y - (station + 0.5) * 12.0;
    float side = mod(station, 2.0) * 2.0 - 1.0;

    // Phase-offset each station so the gallery pulses as a wave, not in unison.
    float ext = uMech.y + 0.18 * sin(uMech.x + station * 1.7);

    vec3 lp = vec3((p.x - side * R) * -side, py, p.z);
    float body = sdCylX(lp - vec3(0.55, 0.0, 0.0), 0.42, 0.55);
    float rod = sdCylX(lp - vec3(0.55 + ext * 0.5, 0.0, 0.0), 0.13, ext * 0.5 + 0.2);
    float head = sdCylX(lp - vec3(0.55 + ext + 0.1, 0.0, 0.0), 0.30, 0.09);

    // Flywheel + crank pin, spun by the integrated angular velocity.
    vec3 fp = lp - vec3(0.16, 0.0, 1.35);
    float wheel = sdTorusX(fp, 0.66, 0.10);
    vec3 cp = fp;
    cp.yz = rot(uMech.x) * cp.yz;
    float pin = sdCylX(cp - vec3(0.0, 0.52, 0.0), 0.07, 0.16);

    return min(min(body, min(rod, head)), min(wheel, pin));
  }

  // --- band 2: THE LONG RUN ------------------------------------------------
  // Nearly empty. A single spine of hoist beams crosses the void every 50 m,
  // so there is just enough parallax to read the speed.
  float mapLongRun(vec3 p, out float mat) {
    mat = 1.0;
    float span = floor(p.y / 50.0);
    float sy = p.y - (span + 0.5) * 50.0;
    // Alternate the beam axis so the void reads as three-dimensional.
    vec3 q = mod(span, 2.0) < 0.5 ? vec3(p.x, sy, p.z) : vec3(p.z, sy, p.x);
    float beam = sdBox(q, vec3(shaftR(p.y), 0.16, 0.22));
    float tie = sdCylY(vec3(q.x - 3.0, sy, q.z), 0.07, 3.0);
    return min(beam, tie);
  }

  // --- band 3: COOLANT TIER ------------------------------------------------
  // Vertical pipe bundles with valve wheels; the shaft is choked with plumbing.
  float mapCoolant(vec3 p, out float mat) {
    mat = 3.0;
    float R = shaftR(p.y);
    // Four bundles, one per corner, each a triple of pipes.
    vec2 c = abs(p.xz) - (R - 0.55);
    float pipe = length(max(c, 0.0)) + min(max(c.x, c.y), 0.0) - 0.26;
    vec2 c2 = abs(abs(p.xz) - (R - 0.55)) - 0.34;
    float pipe2 = length(max(c2, 0.0)) + min(max(c2.x, c2.y), 0.0) - 0.15;

    // Valve wheels every 16 m, turning with the flywheel.
    float st = floor(p.y / 16.0);
    float vy = p.y - (st + 0.5) * 16.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    vec3 vp = vec3((p.x - side * (R - 0.55)) * -side, vy, p.z - 0.0);
    vp.yz = rot(uMech.x * 0.35 + st) * vp.yz;
    float wheel = sdTorusX(vp - vec3(0.45, 0.0, 0.0), 0.42, 0.06);

    return min(min(pipe, pipe2), wheel);
  }

  // --- band 4: GEARWORKS ---------------------------------------------------
  // Meshing gear wheels set into opposite walls, turning at the integrated
  // flywheel rate. This is where the cable parts.
  float mapGearworks(vec3 p, out float mat) {
    mat = 3.0;
    float R = shaftR(p.y);
    float st = floor(p.y / 18.0);
    float gy = p.y - (st + 0.5) * 18.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    vec3 gp = vec3((p.x - side * R) * -side, gy, p.z);

    // Counter-rotating pair; the second is offset so the teeth interleave.
    float spin = uMech.x * (mod(st, 2.0) < 0.5 ? 1.0 : -1.0);
    vec3 a = gp - vec3(1.1, 0.0, 0.0);
    a.yz = rot(spin) * a.yz;
    vec3 b = gp - vec3(1.1, 0.0, 3.4);
    b.yz = rot(-spin + 0.22) * b.yz;

    // Disc + radial teeth via angular repetition.
    float da = sdCylX(a, 1.7, 0.22);
    float ta = abs(mod(atan(a.z, a.y) * 9.0 / PI + 0.5, 1.0) - 0.5) - 0.30;
    da = min(da, max(sdCylX(a, 1.95, 0.20), ta * 0.35));

    float db = sdCylX(b, 1.7, 0.22);
    float tb = abs(mod(atan(b.z, b.y) * 9.0 / PI + 0.5, 1.0) - 0.5) - 0.30;
    db = min(db, max(sdCylX(b, 1.95, 0.20), tb * 0.35));

    return min(da, db);
  }

  // --- band 5: BRAKE RUN ---------------------------------------------------
  // Brake-shoe housings clamped around the rails every 6 m — the hardware that
  // is about to be doing the work.
  float mapBrakeRun(vec3 p, out float mat) {
    mat = 5.0;
    float R = shaftR(p.y);
    float st = floor(p.y / 6.0);
    float sy = p.y - (st + 0.5) * 6.0;
    vec3 hp = vec3(abs(p.x) - (R - 0.56), sy, p.z);
    float housing = sdBox(hp, vec3(0.34, 0.30, 0.62));
    float bolt = sdCylX(vec3(hp.x, hp.y, abs(hp.z) - 0.48), 0.07, 0.40);
    return min(housing, bolt);
  }

  // --- band 6: FURNACE FLOOR ----------------------------------------------
  // Molten channels in the walls and the buffer rams waiting at the bottom.
  float mapFurnace(vec3 p, out float mat) {
    mat = 0.0;
    float R = shaftR(p.y);
    // Tap channels: horizontal slots cut into the plate, glowing from within.
    float st = floor(p.y / 11.0);
    float cy = p.y - (st + 0.5) * 11.0;
    vec3 tp = vec3(abs(p.x) - R, cy, p.z);
    float channel = sdBox(tp - vec3(0.30, 0.0, 0.0), vec3(0.42, 0.34, 6.0));

    // Four hydraulic buffer rams standing on the floor.
    vec2 bc = abs(p.xz) - 1.9;
    float ram = sdCylY(vec3(bc.x, p.y - (FLOOR_Y + 1.4), bc.y), 0.34, 1.4);
    return min(channel, ram);
  }

  // ======================= THE FOLDING PATH ================================
  // Past the bottom of the shaft the walker steps out over an infinite fall.
  // The only floor is a line of cubes that unfold their six faces about hinge
  // edges — panels swinging out along all three axes to lay a walkway a moment
  // before it is stood on, then closing again behind. Each cube's fold
  // coordinate is a damped hinge integrated on the CPU (physics.ts), so the
  // panels overshoot and settle instead of easing.

  const float CUBE_SP = 4.0;   // cube spacing — mirrors physics.ts
  const float CUBE_H = 1.2;    // cube half-size — mirrors physics.ts
  const float PANEL_T = 0.07;  // panel thickness
  // The path leads away from the parked cage, so it sits at the shaft floor —
  // otherwise the walk transition would teleport the camera 1400 m upward.
  const float PATH_Y = FLOOR_Y;

  float walkBlend() { return uWalk.z; }

  /** Fold coordinate of live cube 'i', unpacked from the two vec4 slots. */
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

  /** A single cube of the path, centred at the origin, unfolded by 'f' (0..1). */
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
   * The live window of cubes. Each is rejected by a bounding sphere first, so
   * a ray typically pays for one or two cubes rather than all eight.
   */
  float mapPath(vec3 p, out float mat) {
    mat = 6.0;
    float d = 1e9;
    float base = uWalk.y;
    for (int i = 0; i < 8; i++) {
      float cz = (base + float(i)) * CUBE_SP;
      vec3 q = vec3(p.x, p.y - (PATH_Y + CUBE_H), p.z - cz);
      // The unfolded net reaches ~2 cube-halves past the body diagonal.
      float bound = length(q) - CUBE_H * 3.2;
      if (bound < 0.5) d = min(d, mapCube(q, foldAt(i)));
      else d = min(d, bound);
    }
    return d;
  }

  /** Dispatch the sample point to its band's signature structure. */
  float mapSectionFeature(vec3 p, out float mat) {
    float sec = secIndex(p.y);
    if (sec < 0.5) return mapLandings(p, mat);
    if (sec < 1.5) return mapPistons(p, mat);
    if (sec < 2.5) return mapLongRun(p, mat);
    if (sec < 3.5) return mapCoolant(p, mat);
    if (sec < 4.5) return mapGearworks(p, mat);
    if (sec < 5.5) return mapBrakeRun(p, mat);
    return mapFurnace(p, mat);
  }

  // The cage: corner posts, floor slab, roof, and a woven grating skin.
  float mapCage(vec3 p, out float mat) {
    mat = 1.0;
    float base = cageY();
    vec3 c = vec3(p.x, p.y - base, p.z);

    float posts = sdBox(vec3(abs(c.x) - CAGE_R, c.y - CAGE_H * 0.5, abs(c.z) - CAGE_R),
                        vec3(0.075, CAGE_H * 0.5, 0.075));
    // Open mesh floor — you ride down looking through your own feet at the
    // shaft below, which is the whole point of the descent.
    float floorPlate = sdBox(c - vec3(0.0, -0.04, 0.0), vec3(CAGE_R, 0.035, CAGE_R));
    float fbarX = abs(mod(c.x + 0.11, 0.22) - 0.11) - 0.012;
    float fbarZ = abs(mod(c.z + 0.11, 0.22) - 0.11) - 0.012;
    float floorSlab = max(floorPlate, min(fbarX, fbarZ));
    float roof = sdBox(c - vec3(0.0, CAGE_H, 0.0), vec3(CAGE_R + 0.06, 0.06, CAGE_R + 0.06));

    // Woven grating, but only on the two side panels — the front and back faces
    // are open gates. A fully enclosed cage puts a mesh wall across the entire
    // frame and the shaft behind it becomes unreadable.
    float slab = max(c.y - CAGE_H, -c.y);            // clip to cage height
    float ring = abs(abs(c.x) - CAGE_R) - 0.016;
    float vbar = abs(mod(c.z + 0.08, 0.16) - 0.08) - 0.013;
    float hbar = abs(mod(c.y + 0.1, 0.2) - 0.1) - 0.013;
    float grate = max(max(ring, min(vbar, hbar)), max(slab, abs(c.z) - CAGE_R));

    // Waist-height safety rails across the open faces, so they still read as
    // "enclosed" without blocking the view.
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
  float mapDebris(vec3 p) {
    float d = 1e9;
    for (int i = 0; i < 6; i++) {
      vec3 ctr = uDebris[i].xyz;
      float s = uDebris[i].w;
      // Cheap bounding-sphere reject keeps the per-step cost near zero when the
      // body is far from the ray. The radius must be the box's *circumradius*
      // (|(0.55, 0.32, 0.42)| ≈ 0.766) — a tighter sphere would over-estimate
      // the distance and the march would step straight through corners.
      float bound = length(p - ctr) - s * 0.78;
      if (bound < 0.6) {
        vec3 q = qinv(uDebrisQ[i], p - ctr);
        d = min(d, sdBox(q, vec3(0.55, 0.32, 0.42) * s));
      } else {
        d = min(d, bound);
      }
    }
    return d;
  }

  // Hoist cables above the cage — present only while the cable is intact.
  float mapCables(vec3 p) {
    if (uSim.w < 0.5) return 1e9;
    if (p.y < cageY() + CAGE_H) return 1e9;
    vec2 off = abs(p.xz) - vec2(0.42, 0.42);
    return length(max(off, 0.0)) + min(max(off.x, off.y), 0.0) - 0.035;
  }

  float mapScene(vec3 p) {
    float mat, wear, glow;

    // Once the walk begins the shaft is gone entirely — there is nothing out
    // there but the folding path and the fall under it. Evaluating only one of
    // the two worlds also keeps the step cost flat across the transition.
    if (walkBlend() > 0.5) {
      float pm;
      float d = mapPath(p, pm);
      gMat = pm; gWear = 0.25; gGlow = 0.0;
      return d;
    }

    float d = mapShaft(p, mat, wear);
    gMat = mat; gWear = wear; gGlow = 0.0;

    float pm;
    float feat = mapSectionFeature(p, pm);
    if (feat < d) { d = feat; gMat = pm; gWear = 0.1; }

    float cm;
    float cage = mapCage(p, cm);
    if (cage < d) { d = cage; gMat = cm; gWear = 0.55; }

    float deb = mapDebris(p);
    if (deb < d) { d = deb; gMat = 2.0; gWear = 0.75; }

    float cab = mapCables(p);
    if (cab < d) { d = cab; gMat = 5.0; gWear = 0.3; }

    float lg;
    float lamp = mapLamps(p, lg);
    if (lamp < d) { d = lamp; gMat = 4.0; gGlow = 1.0; }

    // Hydraulic buffer floor at the bottom of the shaft.
    float bed = p.y - FLOOR_Y + 0.4;
    if (bed < d) { d = bed; gMat = 0.0; gWear = 0.18; }

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

  // Per-band lamp colour and intensity. This is what actually sells the
  // sections as different places — sodium at the top, mercury-cold in the long
  // run, sickly green through the coolant tier, furnace-red at the bottom.
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
    if (i < 2.5 && i > 1.5) return 5.4;  // few lamps, so each must carry further
    if (i > 5.5) return 2.2;             // furnace floor is lit by the melt
    return 3.4;
  }

  // Nearest two lamps dominate; approximating the strip as a pair of point
  // lights is far cheaper than iterating the whole shaft and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd) {
    vec3 acc = vec3(0.0);
    float sec = secIndex(p.y);
    float sp = secLampSpacing(sec);
    vec3 lcol = secLampColour(sec);
    float lpow = secLampPower(sec);
    float band = floor(p.y / sp);
    for (int k = 0; k < 2; k++) {
      float b = band + float(k);
      float side = mod(b, 2.0) * 2.0 - 1.0;
      float ly = (b + 0.5) * sp;
      vec3 lp = vec3(side * (shaftR(ly) - 0.25), ly, 0.0);
      vec3 ld = lp - p;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = 1.0 / (1.0 + dist * dist * 0.022);
      // Half-lambert: real shafts are full of bounce light off the plate, and a
      // hard terminator here just crushes everything to black.
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = pow(max(dot(reflect(-ld, n), -rd), 0.0), mix(90.0, 8.0, rough));
      acc += (albedo * diff + spec * (1.0 - rough) * 0.32) * atten * lcol * lpow;
    }
    return acc;
  }

  // The furnace under the shaft: a warm updraft that grows as the cage falls.
  vec3 furnaceLight(vec3 p, vec3 n, vec3 albedo) {
    float depth = clamp((FLOOR_Y + 22.0 - p.y) / 46.0, 0.0, 1.0);
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.y * 0.4, iTime * 1.7));
    return albedo * up * depth * flick * vec3(0.85, 0.28, 0.065);
  }

  vec3 shadeSurface(vec3 p, vec3 n, vec3 rd, float dist) {
    float mat = gMat, wear = gWear;
    vec3 albedo; float rough;

    if (mat < 0.5) {
      // Shaft steel — dark plate, rust blooming out of the noise field.
      vec3 steel = vec3(0.085, 0.088, 0.098);
      vec3 rust = vec3(0.30, 0.13, 0.055);
      albedo = mix(steel, rust, smoothstep(0.52, 0.85, wear));
      rough = 0.82;
    } else if (mat < 1.5) {
      // Cage frame — hazard yellow paint, chipped back to primer on the edges.
      float chip = smoothstep(0.38, 0.66, wear);
      albedo = mix(vec3(0.30, 0.21, 0.045), vec3(0.09, 0.085, 0.08), chip);
      rough = 0.80;
    } else if (mat < 2.5) {
      // Debris — raw steel offcuts, mill-scale blue.
      albedo = mix(vec3(0.13, 0.14, 0.17), vec3(0.26, 0.15, 0.09), wear * 0.5);
      rough = 0.68;
    } else if (mat < 3.5) {
      // Piston chrome — polished, so it carries the lamps as hard highlights.
      albedo = vec3(0.55, 0.57, 0.62);
      rough = 0.16;
    } else if (mat < 4.5) {
      // Lamp glass — emissive, unaffected by lighting.
      return vec3(1.0, 0.76, 0.42) * 2.6;
    } else if (mat < 5.5) {
      // Guide rails / chain — worn bright steel.
      albedo = vec3(0.34, 0.35, 0.38);
      rough = 0.30;
    } else {
      // Folding path panels — pale machined plate with luminous hinge seams,
      // so the fold lines stay readable against the void.
      albedo = vec3(0.42, 0.44, 0.50);
      rough = 0.34;
    }

    if (walkBlend() > 0.5) {
      // The void has no fixtures. A single hard key from overhead is the only
      // light, so orientation alone separates the surfaces: the walkway reads
      // bright, the panels still standing on edge fall away into the dark, and
      // the undersides of the canopy are lit only by bounce off the path.
      vec3 key = normalize(vec3(0.22, 1.0, -0.30));
      float up = max(dot(n, key), 0.0);
      float down = max(dot(n, -key), 0.0);

      vec3 lit = albedo * up * vec3(0.86, 0.92, 1.10) * 1.9;   // top faces
      lit += albedo * down * vec3(0.10, 0.13, 0.20) * 0.9;      // undersides
      lit += albedo * vec3(0.022, 0.028, 0.042);                // void ambient

      // Specular sheen picks out the machined plate and, on a panel caught
      // mid-swing, flares as it rotates through the key — the fold reads as
      // motion even in a still frame.
      float spec = pow(max(dot(reflect(-key, n), -rd), 0.0), 42.0);
      lit += vec3(0.75, 0.85, 1.0) * spec * 0.55;

      // Cold rim against the black so silhouettes stay legible.
      float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.5);
      lit += vec3(0.22, 0.46, 0.70) * rim * 0.60;

      // Falloff into the dark ahead and behind, so the path arrives out of
      // nothing and dissolves back into it.
      return lit * exp(-max(0.0, abs(p.z - uWalk.x) - 7.0) * 0.055);
    }

    vec3 col = albedo * vec3(0.13, 0.145, 0.185);         // cool ambient bounce
    col += lampLight(p, n, albedo, rough, rd);
    col += furnaceLight(p, n, albedo);

    // Brake sparks throw a hard white-hot key from the rail contact patch.
    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * (shaftR(cageY()) - 0.60), cageY() + 0.1, 0.0);
      vec3 sd = sp - p;
      float sdist = length(sd);
      float att = 1.0 / (1.0 + sdist * sdist * 0.35);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0) * att * spark() * vec3(3.4, 2.6, 1.5);
    }

    // Fresnel rim keeps the metal from flattening out at grazing angles.
    col += vec3(0.10, 0.11, 0.14) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * (1.0 - rough);
    return col;
  }

  // ============================ CAMERA =====================================

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // The camera rides the cage. Shake, pitch and roll are all read from the
    // integrator: pitch follows velocity (you look where you are going), shake
    // follows |acceleration| and impacts, roll follows lateral shake.
    // Stand toward the back of the cage, looking out through the open gate.
    vec3 ro = vec3(uSim.x * 0.035, cageY() + EYE + uSim.y * 0.045, -0.55 + uSim.y * 0.03);

    float fallPitch = -0.42 * smoothstep(0.0, -26.0, cageV());
    // Base gaze is down the shaft; free fall drops it further toward vertical.
    float pitch = -0.62 + fallPitch + uPointer.y * 0.55 + uSim.y * 0.012;
    float yaw = uPointer.x * 0.85 + uSim.x * 0.010;
    float roll = uSim.x * 0.035 + weightless() * 0.05;

    // On the folding path the camera walks forward instead of riding down: a
    // gait bob at the stride frequency implied by the integrated walk speed,
    // and a gaze that lifts from the shaft's steep downward stare to level.
    float wb = walkBlend();
    if (wb > 0.0) {
      float stride = uWalk.x * 1.9;
      vec3 walkRo = vec3(
        sin(stride * 0.5) * 0.06,
        PATH_Y + EYE + abs(sin(stride)) * 0.045,
        uWalk.x);
      ro = mix(ro, walkRo, wb);
      // Look ahead down the path, with a slight downward cast at the drop.
      pitch = mix(pitch, -0.16 + uPointer.y * 0.55 + sin(stride) * 0.012, wb);
      roll = mix(roll, sin(stride * 0.5) * 0.02, wb);
    }

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.25;
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

    // Background: the shaft has no sky, only the furnace glow far below.
    vec3 col = vec3(0.012, 0.010, 0.014)
      + vec3(0.30, 0.09, 0.02) * pow(max(-rd.y, 0.0), 3.0)
        * clamp((FLOOR_Y + 60.0 - ro.y) / 80.0, 0.0, 1.0);

    // Over the fall there is no floor and no ceiling: a faint cold gradient
    // above, absolute black below, and nothing at all to catch the eye.
    if (wb > 0.0) {
      vec3 voidCol = vec3(0.020, 0.026, 0.040) * pow(max(rd.y, 0.0), 1.5)
        + vec3(0.004, 0.005, 0.008);
      col = mix(col, voidCol, wb);
    }

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      col = shadeSurface(p, n, rd, dist);
      float fogDen = mix(0.055, 0.030, wb);
      vec3 fogCol = mix(vec3(0.030, 0.026, 0.030), vec3(0.010, 0.013, 0.021), wb);
      float fog = 1.0 - exp(-dist * fogDen);
      col = mix(col, fogCol, fog);
    }

    // --- spark shower along the guide rails during braking ---
    if (spark() > 0.01) {
      float sy = ro.y - EYE;
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        // Sparks are thrown off the rail and fall behind the still-moving cage.
        vec3 sp = vec3(sign(seed - 0.5) * (shaftR(sy) - 0.66),
                       sy + 0.2 + fract(seed * 7.3) * 2.4,
                       (fract(seed * 3.1) - 0.5) * 0.9);
        vec3 to = sp - ro;
        float along = dot(to, rd);
        if (along > 0.0) {
          float perp = length(to - rd * along);
          float g = exp(-perp * perp * 900.0) * exp(-along * 0.22);
          col += vec3(1.6, 0.95, 0.42) * g * spark() * 2.2;
        }
      }
    }

    // --- steam drifting up from the machinery (heavy effects only) ---
    if (uHeavy > 0.5) {
      float steam = fbm(vec2(uv.x * 3.0 + iTime * 0.15, uv.y * 3.0 - iTime * 0.55 + ro.y * 0.2));
      steam *= smoothstep(0.6, 1.0, steam) * 0.5;
      col += vec3(0.16, 0.15, 0.17) * steam * (0.3 + 0.7 * weightless());
    }

    // --- grade ---
    // Free fall desaturates and cools; the brake flash blows the highlights out.
    float w = weightless();
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), w * 0.35);
    col *= mix(vec3(1.0), vec3(0.86, 0.92, 1.10), w);
    col += vec3(1.0, 0.8, 0.55) * spark() * 0.06;

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.7, lum) * 0.5;                  // pseudo-bloom
    col = pow(clamp(col, 0.0, 1.8), vec3(0.90));
    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * 0.65;         // vignette
    // Sensor grain, heavier as the cage accelerates.
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.05 * clamp(abs(cageA()) / 40.0, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`

// Full-quality variant used by the route page.
export const foundryFrag = `
#define RM_STEPS 88
#define MAX_DIST 90.0
#define STEP_K 0.72
#define FBM_OCTAVES 3
#define SPARK_LAYERS 14
${COMMON}`

// The hover thumbnail runs without a simulation attached (uCage et al. are all
// zero), so it gets its own compact, self-driving shader rather than a cheaper
// build of the one above: an analytic descent past ribs, lamps and a piston,
// with the brake-spark flash on a slow cycle.
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

    // Fake-perspective shaft: |uv| drives distance to the wall, so the frame
    // reads as looking down a square well.
    float q = max(abs(uv.x), abs(uv.y));
    float depth = 0.42 / max(q, 0.02);
    float fall = iTime * 6.5;

    // Ribs streaming past, plus a brake-flash cycle every ~9 s.
    float rib = fract(depth * 0.9 + fall * 0.28);
    float ribHi = smoothstep(0.0, 0.06, rib) * (1.0 - smoothstep(0.14, 0.22, rib));
    float brake = smoothstep(0.72, 0.92, fract(iTime * 0.11));

    float shade = clamp(1.6 / depth, 0.04, 1.0);
    vec3 col = vec3(0.085, 0.088, 0.098) * shade;
    col = mix(col, vec3(0.28, 0.12, 0.05) * shade, hash21(floor(vec2(uv * 14.0))) * 0.5);
    col += ribHi * shade * 0.14;

    // Caged wall lamps, staggered, streaming upward as the cage descends.
    float lampPhase = fract(depth * 0.30 + fall * 0.09);
    float lamp = smoothstep(0.03, 0.0, abs(lampPhase - 0.5)) * smoothstep(0.55, 0.25, abs(uv.x));
    col += vec3(1.0, 0.72, 0.38) * lamp * 1.6;

    // A piston ram on the right wall, extending on the exact slider-crank curve.
    float crank = iTime * 3.1;
    float ext = 0.62 * cos(crank) + sqrt(max(0.0, 3.61 - 0.3844 * sin(crank) * sin(crank)));
    float ram = smoothstep(0.035, 0.0, abs(uv.y + 0.06))
              * step(0.30, uv.x) * step(uv.x, 0.30 + ext * 0.11);
    col += vec3(0.55, 0.57, 0.62) * ram * 0.9;

    // Cage grating in the foreground — the bars you are looking through.
    float bars = min(abs(fract(uv.x * 9.0) - 0.5), abs(fract(uv.y * 9.0) - 0.5));
    col *= mix(1.0, 0.35, smoothstep(0.06, 0.0, bars));

    // Brake sparks + furnace glow from below.
    float sparkle = step(0.985, hash21(floor(uv * 90.0) + floor(iTime * 30.0)));
    col += vec3(1.6, 0.95, 0.42) * sparkle * brake * 1.4;
    col += vec3(0.30, 0.09, 0.02) * pow(max(-uv.y, 0.0), 2.0) * 1.2;

    col *= 1.0 - smoothstep(0.40, 1.05, length(uv)) * 0.6;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 88 raymarch steps x (shaft + 6 quaternion-rotated debris
// boxes + pistons + cage grating) is the heaviest journey in the set; the
// debris bounding-sphere reject keeps the common case near the cost of the
// shaft alone. ~1 draw call, no textures, no render targets.
