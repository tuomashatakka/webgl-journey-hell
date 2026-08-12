// THE NATATORIUM — a flooded pool building, carved out of solid rock.
//
// Single pass via lib/shaderQuad.ts, driven by createNatatoriumSimulation in
// route.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch, no
// dynamic array indexing, no bitwise ops.
//
// The shader holds NO route table. Every frame the CPU uploads the affine
// transform carrying a point from the camera's current section into each of the
// three resident sections (prev, current, next). This loops over them, applies
// each transform, evaluates one generic sectionAir(), unions with `min`, and
// negates to get the concrete. Turn #500 costs exactly what turn #1 did.
//
// SDF discipline, because this is where this design would die:
//   `min` (union) and `max` (clip) are provably conservative — inside a union,
//   min under-estimates the distance to the boundary, which is the safe
//   direction for a sphere trace. `smin` is NOT: it returns up to k/4 below its
//   inputs, so negating a smoothed union OVER-estimates and a grazing ray at a
//   door jamb punches through the wall. Corners get rounded via sdRoundBox
//   (exact outside, conservative inside) instead — which is also what real
//   tiled pool halls have, since coved corners are what you can mop.
//   Tiles, grout, mildew, caustics: shading only, never the SDF.
//
// Uniforms (see route.ts `uniforms()`), three slots each:
//   uSecA[i] (cos, sin, tx, tz)          inverse xz transform into slot i
//   uSecB[i] (ty, halfW, ceilH, len)
//   uSecC[i] (slope, type, grime, lampPitch)
//   uSecD[i] (deploy 0..1 of this section's entry, aisleY, sectionId, -)
//   uCam     (camX, camY, camZ, yaw)     camera in the CURRENT section's frame
//   uLook    (pitch, roll, above, depth)
//   uWave    (waterY-local, lap, dist, curType)

const COMMON = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;

  uniform vec4 uSecA[3];
  uniform vec4 uSecB[3];
  uniform vec4 uSecC[3];
  uniform vec4 uSecD[3];
  uniform vec4 uCam;
  uniform vec4 uLook;
  uniform vec4 uWave;

  const float PI = 3.14159265;

  // Humid haze above the surface; the flooded dark below it.
  const vec3 HAZE = vec3(0.070, 0.088, 0.095);
  const vec3 DEEP = vec3(0.030, 0.085, 0.105);

  // Sections extend this far past both ends of their nominal length. Load
  // bearing: at a near-straight join two boxes would otherwise only touch on a
  // plane, the union would read exactly 0 there, and the march would see a
  // sealed doorway. Turns overlap on their own (the next section's half-width
  // sweeps back across the pivot) but the opening must not depend on that.
  const float OVERLAP = 0.35;

  // How far a section's doorway recesses reach past its own ends. Long enough to
  // read as an opening rather than a panel, short enough that two of them back
  // to back cannot bridge a section that is not resident.
  const float DOOR_STUB = 2.2;

  // Coving radius on every room corner. Exact outside, conservative inside.
  const float COVE = 0.06;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  float sdRoundBox(vec3 p, vec3 b, float r) {
    return sdBox(p, b - r) - r;
  }

  // The fittings need more than boxes. All exact — nothing here is a cheap
  // approximation with a Lipschitz constant above 1, which is the failure that
  // would force the step factor down for the whole journey.
  float sdSphere(vec3 p, float r) { return length(p) - r; }

  float sdCapsuleX(vec3 p, float h, float r) { p.x -= clamp(p.x, -h, h); return length(p) - r; }
  float sdCapsuleY(vec3 p, float h, float r) { p.y -= clamp(p.y, -h, h); return length(p) - r; }
  float sdCapsuleZ(vec3 p, float h, float r) { p.z -= clamp(p.z, -h, h); return length(p) - r; }

  // Ring in the plane of p.xy, axis along p.z. Swizzle the argument to turn it.
  float sdTorus(vec3 p, float R, float r) {
    return length(vec2(length(p.xy) - R, p.z)) - r;
  }

  // Fold onto the nearest lattice cell, unbounded or clamped to a run of 2n+1.
  // Exact for identical axis-aligned instances: on a lattice of congruent shapes
  // the nearest centre really is the nearest instance — which is why nothing
  // repeated in this file jitters its position, however much it would like to.
  float latt(float x, float cell) { return x - (floor(x / cell) + 0.5) * cell; }
  float lattN(float x, float cell, float n) {
    return x - clamp(floor(x / cell + 0.5), -n, n) * cell;
  }

  // --- the route ------------------------------------------------------------

  // Carry a point from the current section's frame into slot i's frame. The CPU
  // already inverted the rigid transform, so there is no trig here at all.
  vec3 toLocal(vec3 p, vec4 A, float ty) {
    vec2 d = p.xz - vec2(A.z, A.w);
    return vec3(A.x * d.x - A.y * d.y, p.y - ty, A.y * d.x + A.x * d.y);
  }

  // The same rotation for a DIRECTION: no translation, and y is untouched
  // because every section frame shares one up axis. Normals and view rays both
  // need this before they meet anything expressed in a section's own frame —
  // mixing a world-frame ray with a local-frame normal silently produces a
  // specular highlight in the wrong place, which is the kind of bug that reads
  // as "the lighting is a bit off" for a week.
  vec3 dirToLocal(vec3 v, vec4 A) {
    return vec3(A.x * v.x - A.y * v.z, v.y, A.y * v.x + A.x * v.z);
  }

  // The air volume of one section: a box whose floor ramps at C.x.
  //
  // Shearing y to flatten the ramp scales the metric by sqrt(1 + s*s), so the
  // result is divided back down — without that the SDF over-estimates by up to
  // 4% on THE RISER's grade, and over-estimating is the direction that punches
  // through walls. (stairwell skips this correction and gets away with it only
  // because its surface epsilon is generous.)
  // qs comes back out because the aisle, the join blocks and every fitting
  // want to work in it: the shear is what flattens the floor ramp, so in that
  // space the room is an axis-aligned box, the walked line is a straight
  // cylinder, and a bench standing on a 23% grade is just a bench. Recomputing
  // it in four places would be four chances to drop the inversesqrt correction.
  float sectionAir(vec3 q, vec4 B, vec4 C, out vec3 qs) {
    float s   = C.x;
    float inv = inversesqrt(1.0 + s * s);

    // Clamp the shear to the section's own span so the floor levels off at the
    // doorways instead of shearing away to infinity out in the solid.
    float zc = clamp(q.z, 0.0, B.w);
    qs = vec3(q.x, q.y + s * zc, q.z);

    float h = B.z * 0.5;
    float room = sdRoundBox(qs - vec3(0.0, h, B.w * 0.5),
                            vec3(B.y, h, B.w * 0.5 + OVERLAP), COVE);

    // Every section carries its own doorways, at both ends, whether or not the
    // room on the far side is loaded.
    //
    // Only three sections are resident, so the fourth one along does not exist
    // yet — and if a doorway were merely the place where two air boxes happen to
    // overlap, then the far wall of the next room would be solid until the room
    // beyond IT became resident, at which point a hole would punch through it in
    // one frame. That is exactly what happened crossing into THE LANE POOL: its
    // far wall was blank, and the instant the slot window advanced, OVERFLOW
    // CHANNEL arrived and opened a door in it while you were looking straight at
    // it. (The route table's fourth invariant was supposed to prevent this, but
    // it constrains the span of three sections, not the distance from the camera
    // to the far end of them — which is barely half that, and well inside the
    // fog.)
    //
    // A stub, being part of the section, is there from the moment the section
    // is. Before its neighbour loads it reads as a shallow dark recess, which is
    // what a doorway looks like at thirty metres anyway; when the neighbour does
    // load, the recess simply continues into it, and nothing changes on screen.
    // Same aperture the join dressing clips itself against, so the two agree.
    float ax = min(1.15, B.y * 0.62);
    float ay = min(2.45, B.z * 0.78);
    float door = sdBox(vec3(qs.x,
                            qs.y - (0.30 + ay) * 0.5,
                            qs.z - B.w * 0.5),
                       vec3(ax, (ay - 0.30) * 0.5, B.w * 0.5 + DOOR_STUB));

    // Union of two exact primitives, so still an under-estimate everywhere.
    // Inside the room the stub is strictly contained by the room and changes
    // nothing; it only ever adds the two recesses past the ends.
    return min(room, door) * inv;
  }

  // --- the aisle ------------------------------------------------------------
  //
  // Everything added below stands where the camera walks: the route runs down
  // each section's local +Z at x = sway, which is exactly where a column, a
  // bench or a sliding wall slab would otherwise be. Rather than hand-dodging
  // six different layouts, the route bores its own tube — the fittings are
  // intersected with the complement of a cylinder swept along the walked line.
  // It cannot fail to clear the camera, because it is defined by where the
  // camera goes. (hollow-orchard bores the same aisle with a capsule.)
  //
  // In the sheared frame the eye sits at exactly qs.y = EYE whatever the grade,
  // so the tube follows every ramp for free and costs one length().
  const float JOIN_SPAN = 5.0;   // how far into a room its entry dressing reaches

  // Every early-out below hands back a BOUND, not a distance. A bound that is
  // allowed to reach zero IS geometry: the march stops on it and shades it as
  // tile. That is where the ghost ball hanging in THE GRAND HALL came from (the
  // flume's bounding sphere, radius 5.2, four metres outside the flume), and the
  // black lid over every pool (the slab bound around the lane ropes, 0.12 above
  // the waterline), and the wall inset 1.55 into every room approaching a join.
  // So bail only while the bound is comfortably clear of the hit epsilon — which
  // tops out at 0.0046 at the far plane — and evaluate the real thing inside it.
  // Everything a bound protects is thin, so the band this opens up is thin too.
  const float BOUND_SLACK = 0.30;

  float aisleAt(vec3 qs, vec4 B, vec4 D) {
    // Scales with the room. One radius sized for THE GRAND HALL would be three
    // quarters of the width of OVERFLOW CHANNEL and would swallow every fitting
    // in all four corridors; the camera is a point, not a body, so it needs
    // only enough clearance not to clip.
    float r = min(0.95, min(B.y, B.z * 0.5) * 0.60);
    return length(vec2(qs.x, qs.y - D.y)) - r;
  }

  // --- the joins ------------------------------------------------------------
  //
  // Each section dresses its OWN entry, once. A join between A and B is built by
  // B and by nobody else, which is half the cost and removes any possibility of
  // two block sets disagreeing about where the doorway is.
  //
  // Approaching it, the building is not finished: jamb courses stand out of the
  // walls, a lintel hangs from the ceiling, a threshold plate is raised, a
  // ceiling tier is still sliding in along z. All of it seats flush as you
  // arrive. Because the only slot ever mid-deployment is the next one, the live cost
  // is confined to one slot's five-metre window.
  //
  // Every offset here is a function of D.x ALONE — a uniform. Not one of them
  // reads qs to decide how far something has moved. That is deliberate and it is
  // the whole reason this is affordable: an offset that varied with position
  // would add d(offset)/dz to the gradient, and in a NEGATED field an
  // over-estimate is not an artifact, it is a grazing ray leaving the building.
  // foundry pays a 22% step-factor cut for exactly that (foundry/shader.ts:786);
  // this pays nothing and keeps the 0.95.
  float joinBlocks(vec3 qs, vec4 B, vec4 D, float wd) {
    // Built and flush. One compare on a uniform, coherent across the whole draw.
    if (D.x >= 1.0) return 1e5;

    // Outside the dressed zone, return the distance to that zone rather than a
    // sentinel: 1e5 would be a hole the march could step straight into.
    float ez = max(qs.z - JOIN_SPAN, -0.25 - qs.z);
    if (ez > BOUND_SLACK) return ez;

    // Nothing here reaches more than the lintel's 1.5 in from the shell, so a
    // point further into the room than that cannot be inside a block — and
    // wd - 1.55 is how much further. Returning that rather than a sentinel is
    // what keeps this an under-estimate and therefore safe.
    float bz = wd - 1.55;
    if (bz > BOUND_SLACK) return bz;

    float W = B.y;
    float H = B.z;
    float dep = D.x;

    // One deployment scalar, sliced into phase-shifted courses. The stagger is
    // in the curve, never in space.
    // Slopes and offsets chosen together so the LAST course finishes exactly at
    // dep = 1 ((1 + 0.70) / 1.7): a course still mid-travel when the cull fires
    // is a block that disappears while moving. Earlier courses finish sooner,
    // which is the stagger.
    float e0 = 1.0 - clamp(dep * 1.7,        0.0, 1.0);
    float e1 = 1.0 - clamp(dep * 1.7 - 0.23, 0.0, 1.0);
    float e2 = 1.0 - clamp(dep * 1.7 - 0.46, 0.0, 1.0);
    float e3 = 1.0 - clamp(dep * 1.7 - 0.70, 0.0, 1.0);

    float T  = min(0.55, W * 0.30);   // travel, proportional to the room
    float x  = abs(qs.x);             // both cheeks out of one primitive
    float ch = H * 0.34;

    // THE INVARIANT, and every offset below is written to satisfy it: at e = 0
    // each block is EXACTLY coincident with the shell — inner face exactly on
    // the wall, underside exactly on the ceiling, top exactly on the floor. It
    // has to be exact, because the moment deploy reaches 1 the whole set is
    // rejected by the compare above, and anything still protruding by so much
    // as a centimetre would vanish in one frame. Flush, then gone, is seamless;
    // nearly flush, then gone, is a pop at every doorway in the building.

    // Three courses of jamb, sliding out of the wall bottom-first.
    float d = sdRoundBox(vec3(x - (W + T - T * e0), qs.y - ch * 0.5, qs.z - 1.1),
                         vec3(T, ch * 0.5, 1.0), 0.05);
    d = min(d, sdRoundBox(vec3(x - (W + T - T * e1), qs.y - ch * 1.5, qs.z - 1.1),
                          vec3(T, ch * 0.5, 1.0), 0.05));
    d = min(d, sdRoundBox(vec3(x - (W + T - T * e2), qs.y - ch * 2.5, qs.z - 1.1),
                          vec3(T, ch * 0.5, 1.0), 0.05));

    // The lintel drops out of the ceiling. At e2 = 0 its underside sits exactly
    // at H — outside the air, which is to say it does not exist.
    d = min(d, sdRoundBox(vec3(qs.x, qs.y - (H + 0.45 - e2 * 1.5), qs.z - 1.1),
                          vec3(W, 0.45, 1.0), 0.05));

    // The threshold rises out of the floor and sinks flush. You watch a 22cm
    // step go down as you walk up to it.
    d = min(d, sdRoundBox(vec3(qs.x, qs.y - (0.22 * e3 - 0.22), qs.z - 0.55),
                          vec3(W, 0.22, 0.5), 0.04));

    // A ceiling tier, travelling along z as well as up — a second motion axis,
    // which is what stops the join reading as one machine working one lever.
    // The y term is not decoration: sliding on z alone it could never be flush,
    // and it would be the one block that popped.
    d = min(d, sdRoundBox(vec3(qs.x, qs.y - (H + 0.60 - 0.90 * e3), qs.z - (3.4 + e3 * 3.0)),
                          vec3(W * 0.8, 0.60, 1.2), 0.05));

    // THE APERTURE, cut out of all of it with an exact sdBox — exact inside as
    // well as out, which sdRoundBox is not, and which is why this one is plain.
    //
    // Not a safety bolt-on: this IS the door. The clip is what carves the
    // opening through the lintel and the jamb, and the blocks are what the
    // building assembles around it. No arrangement of them can close it.
    // Proportional to the room, so a 1.4m corridor still has wall to build with.
    float ax = min(1.15, W * 0.62);
    float ay = min(2.45, H * 0.78);
    float ap = sdBox(vec3(qs.x, qs.y - (0.30 + ay) * 0.5, qs.z - JOIN_SPAN * 0.5),
                     vec3(ax, (ay - 0.30) * 0.5, JOIN_SPAN * 0.5 + 1.0));
    return max(d, -ap);
  }

  // --- the fittings ---------------------------------------------------------
  //
  // Dispatched on the section's type, mirroring foundry's secFeature(): an
  // if-chain on a float, because GLSL ES 1.00 has no switch and cannot index an
  // array with anything but a loop counter.
  //
  // Everything repeats through latt()/lattN(), so a row of forty lockers costs
  // one rounded box and a lane of rope floats costs one sphere.
  //
  // Each family opens by declaring how far it reaches in off the surface it
  // hangs on, and hands back that bound when the point is clear of it. Without
  // this every step of a march across a twenty-two metre pool evaluates a lane
  // rope it is nowhere near, and the wide rooms — the ones with the most open
  // air to cross — pay the most. It is worth roughly half the frame.
  //
  // The distance used has to be per-AXIS, which is the part that is easy to get
  // wrong: the obvious -air is the distance to the nearest face of the shell
  // counting floor and ceiling, so in a room 4.2 high it never exceeds 2.1, and
  // a bound written against it for something reaching 3.2 in off a side wall can
  // never clear no matter how far away you stand. Wall fittings are bounded on
  // hx, ceiling fittings on hy, and a fitting in a corner on the max of the two
  // — max, because outside a box the distance is at least the largest of the
  // per-axis overshoots, which makes it both correct and the tightest of the
  // cheap options.
  float sectionProps(vec3 qs, vec4 B, vec4 C, vec4 D) {
    float W = B.y;
    float H = B.z;
    float t = C.y;
    float d = 1e5;

    float hx = W - abs(qs.x);   // to the nearer side wall
    float hy = H - qs.y;        // to the ceiling

    // The flood in this section's own frame, held off the floor and the ceiling
    // so what floats on it still reads once the building is full.
    float wy = clamp(uWave.x - B.x, 0.35, H - 0.5);

    if (t < 0.5) {
      // Ropes sit in a thin slab at the waterline and span the room; the ladder
      // hugs the wall, and the platform reaches 3.2 in — but only in the one
      // hall tall enough to have one, so the shallow rooms are not made to pay
      // for it. Branching on H is free here: it is a uniform.
      float reach = H > 8.0 ? 3.25 : 0.50;
      float bt = min(abs(qs.y - wy) - 0.12, hx - reach);
      if (bt > BOUND_SLACK) return bt;
      // TILE — the swimming halls.
      // Lane ropes, bobbing on the flood. Offset half a lane off centre so the
      // aisle does not have to eat one whole rope to let you through.
      float bob   = sin(qs.z * 0.7 + iTime * 0.9) * 0.03;
      float lanes = floor(max(W - 2.0, 0.0) / 2.4);
      d = min(d, sdSphere(vec3(lattN(qs.x - 1.2, 2.4, lanes),
                               qs.y - wy - bob, latt(qs.z, 0.36)), 0.075));

      // A wall ladder: two stringers 0.44 apart, rungs every 0.30.
      vec3 lp = vec3(abs(qs.x) - (W - 0.18), qs.y - 1.1, qs.z - B.w * 0.32);
      d = min(d, sdCapsuleY(vec3(lp.x, lp.y, abs(lp.z) - 0.22), 1.1, 0.045));
      d = min(d, sdCapsuleZ(vec3(lp.x, lattN(lp.y, 0.30, 3.0), lp.z), 0.22, 0.030));

      // The deep room gets a dive platform. Among the tiled halls only THE
      // DIVING WELL is this tall, so the height is the test.
      if (H > 8.0) {
        vec3 dp = vec3(abs(qs.x) - (W - 1.5), qs.y - H * 0.55, qs.z - B.w * 0.70);
        d = min(d, sdRoundBox(dp, vec3(1.5, 0.10, 1.1), 0.05));
        d = min(d, sdCapsuleY(vec3(dp.x, qs.y - H * 0.275, dp.z), H * 0.275, 0.13));
      }
    }
    else if (t < 1.5) {
      // Conduit runs the ceiling corner, so it is bounded on both axes at once.
      float bt = max(hx - 0.34, hy - 0.62);
      if (bt > BOUND_SLACK) return bt;

      // GUTTER — the service runs. Three conduits along the ceiling, and a
      // junction box dropped off them every few metres.
      vec3 cp = vec3(abs(qs.x) - (W - 0.22), qs.y - (H - 0.30), qs.z);
      d = min(d, sdCapsuleZ(vec3(cp.x, lattN(cp.y, 0.26, 1.0), 0.0), 1e4, 0.055));
      d = min(d, sdRoundBox(vec3(cp.x, cp.y + 0.55, latt(qs.z, 4.2)),
                            vec3(0.12, 0.20, 0.26), 0.03));
    }
    else if (t < 2.5) {
      // The columns hug the walls; the flume swings far out into the room, so
      // it gets its own bounding sphere rather than dragging the columns' bound
      // out to meet it.
      vec3  fc = vec3(qs.x - (W - 5.0), qs.y - H * 0.62, qs.z - B.w * 0.5);
      float bt = min(hx - 2.30, length(fc) - 5.2);
      if (bt > BOUND_SLACK) return bt;

      // VAULT — THE GRAND HALL. Columns down both sides, and the flume.
      d = min(d, sdCapsuleY(vec3(abs(qs.x) - (W - 1.7), qs.y - H * 0.5, latt(qs.z, 6.0)),
                            H * 0.5, 0.55));

      // The waterslide: a quarter of a torus swooping from high on one wall down
      // toward the water. A swept tube is not an exact SDF and is not worth the
      // step factor; a clipped torus is exact, and reads as a flume.
      vec3  fp    = vec3(qs.x - (W - 5.0), qs.y - H * 0.62, qs.z - B.w * 0.5);
      float flume = sdTorus(fp.yzx, 4.2, 0.80);
      flume = max(flume, fp.y);    // the descending half
      flume = max(flume, -fp.z);   // ...and only the near quarter of it
      d = min(d, flume);
      d = min(d, sdCapsuleY(vec3(fp.x, qs.y - H * 0.31, fp.z - 4.2), H * 0.31, 0.16));
    }
    else if (t < 3.5) {
      float bt = max(hx - 1.10, qs.y - 2.00);
      if (bt > BOUND_SLACK) return bt;

      // LOCKER — a run of lockers down both walls, with a bench under them.
      d = min(d, sdRoundBox(vec3(abs(qs.x) - (W - 0.24), qs.y - 0.95, qs.z - B.w * 0.5),
                            vec3(0.24, 0.95, B.w * 0.55), 0.03));
      d = min(d, sdRoundBox(vec3(abs(qs.x) - (W - 0.85), qs.y - 0.44, latt(qs.z, 5.0)),
                            vec3(0.22, 0.05, 1.30), 0.03));
    }
    else if (t < 4.5) {
      float bt = hx - 1.45;
      if (bt > BOUND_SLACK) return bt;

      // PLANT — pumps and pipework, the only warm light in the building.
      vec3 pp = vec3(abs(qs.x) - (W - 0.30), qs.y, qs.z);
      d = min(d, sdCapsuleZ(vec3(pp.x, lattN(pp.y - 1.9, 0.42, 3.0), 0.0), 1e4, 0.085));
      d = min(d, sdRoundBox(vec3(pp.x - 0.55, qs.y - 0.55, latt(qs.z, 7.0)),
                            vec3(0.55, 0.55, 0.80), 0.10));
      d = min(d, sdTorus(vec3(pp.x, qs.y - 1.35, latt(qs.z, 7.0) - 0.95).zyx, 0.26, 0.045));
    }
    else {
      // RAW — bare concrete. The big room gets pillars, the tight ones a rail.
      if (W > 6.0) {
        // Offset half a bay so no pillar stands on the walked line: the aisle
        // would carve a tunnel clean through it and leave a floating stump.
        d = min(d, sdCapsuleY(vec3(lattN(qs.x - 2.75, 5.5, 2.0), qs.y - H * 0.5, latt(qs.z, 6.5)),
                              H * 0.5, 0.62));
      }
      else {
        float bt = hx - 0.25;
        if (bt > BOUND_SLACK) return bt;

        vec3 rp = vec3(abs(qs.x) - (W - 0.16), qs.y - 1.02, qs.z);
        d = min(d, sdCapsuleZ(vec3(rp.x, rp.y, 0.0), 1e4, 0.045));
        d = min(d, sdCapsuleY(vec3(rp.x, qs.y - 0.51, latt(qs.z, 2.4)), 0.51, 0.035));
      }
    }

    return d;
  }

  // Everything one section owns that is solid. The aisle is applied last, so
  // whatever the branches above decided, none of it can reach the camera.
  float sectionSolid(vec3 q, vec3 qs, vec4 B, vec4 C, vec4 D, float wd) {
    float pr = sectionProps(qs, B, C, D);
    float bl = joinBlocks(qs, B, D, wd);

    // Clear of everything this section owns. Tested before the erode, which can
    // only push the fittings further away, so the bail is conservative. And
    // skipping the aisle returns a value no larger than the true one, which is
    // the safe direction: the clip is air = max(air, -solid), so under-stating
    // the solid over-states the air, and over-stated air only ever shortens the
    // march's next step.
    if (min(pr, bl) > 0.75) return min(pr, bl);

    // foundry's FEAT_ERODE: additively push the fittings away as they near a
    // doorway. Additive rather than a fade, because f + c erodes a shape while
    // staying Lipschitz, whereas a fade would leave a ghost with no surface for
    // the march to stop against. The join blocks are exempt — standing near a
    // doorway is their whole job, and they hug the surfaces, not the aperture.
    float endFade = smoothstep(0.0, 1.6, min(q.z, B.w - q.z));
    return max(min(pr + (1.0 - endFade) * 3.0, bl), -aisleAt(qs, B, D));
  }

  // Union of the resident air volumes. Negative inside the walkable space.
  float mapAir(vec3 p) {
    float air = 1e5;              // large POSITIVE — starting at 0 is the classic bug
    for (int i = 0; i < 3; i++) {
      vec3  qs;
      vec3  q = toLocal(p, uSecA[i], uSecB[i].x);
      float a = sectionAir(q, uSecB[i], uSecC[i], qs);

      // Only a room you are INSIDE can put anything between you and its shell.
      // If a >= 0 the clip could only raise a, and either some other slot is
      // negative and wins the min anyway, or none is and the march has already
      // stopped. Exact, and it frees two slots in three on essentially every
      // step — which is what pays for all of this.
      if (a < 0.0) {
        // The same sqrt(1+s*s) the shell is divided by. Everything built in the
        // sheared frame inherits the sheared metric; on THE RISER's 23% grade
        // that is 2.5%, and 2.5% the over-estimating way is a hole in a wall.
        float sInv = inversesqrt(1.0 + uSecC[i].x * uSecC[i].x);
        a = max(a, -sectionSolid(q, qs, uSecB[i], uSecC[i], uSecD[i], -a) * sInv);
      }

      air = min(air, a);
    }
    return air;
  }

  // The concrete. Positive in the air, which is where the march lives.
  float mapScene(vec3 p) {
    return -mapAir(p);
  }

  // Which resident section owns this point, and the point in THAT section's own
  // frame. Deliberately not folded into mapAir: the march calls that ~96 times
  // per pixel and needs only the minimum, while shading needs the winner twice
  // (the primary hit, and the hit behind the water reflection).
  //
  // Everything downstream used to read uSecB[1] / uSecC[1] — the section the
  // CAMERA is in — and evaluate it against p in the camera's frame. So the room
  // on the far side of a doorway was lit with this room's width, ceiling height
  // and lamp pitch, with its lamp rows running along the wrong axis; and the
  // instant the slot window rotated, that whole far room snapped. The README
  // states the rule for the camera ("every per-section quantity goes through the
  // corner blend, not just position"); this is that rule applied to shading.
  // Returns the runner-up as well, because in a doorway the two answers can be
  // wildly different — a 1.4m service corridor lights its walls from 1.3m away,
  // the 16m hall it opens into lights the same wall from across a swimming pool
  // — and switching between them on a hard argmin puts a visible seam down the
  // middle of every threshold. w is how much of the runner-up to mix in: a
  // half at a dead tie, nothing once the two rooms have separated by a metre.
  void resolveSlot(vec3 p,
                   out vec4 A,  out vec4 B,  out vec4 C,
                   out vec4 A2, out vec4 B2, out vec4 C2,
                   out vec3 q,  out float w) {
    float best   = 1e5;
    float second = 1e5;

    // Seeded from the current slot only so the compiler sees them assigned; the
    // loop below always overwrites, since every distance beats 1e5.
    A = uSecA[1]; B = uSecB[1]; C = uSecC[1]; q = p;
    A2 = A; B2 = B; C2 = C;

    for (int i = 0; i < 3; i++) {
      vec3  qsi;
      vec3  qi = toLocal(p, uSecA[i], uSecB[i].x);
      float d  = sectionAir(qi, uSecB[i], uSecC[i], qsi);
      if (d < best) {
        second = best;
        A2 = A; B2 = B; C2 = C;
        best   = d;
        A = uSecA[i]; B = uSecB[i]; C = uSecC[i]; q = qi;
      }
      else if (d < second) {
        second = d;
        A2 = uSecA[i]; B2 = uSecB[i]; C2 = uSecC[i];
      }
    }

    w = 0.5 - 0.5 * smoothstep(0.0, 1.1, second - best);
  }

  // 4-tap tetrahedron rather than 6-tap central differences: mapScene evaluates
  // three transformed boxes, so a third fewer taps is a real saving per pixel.
  vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(1.0, -1.0) * (0.0015 + 0.0016 * t);
    return normalize(
      e.xyy * mapScene(p + e.xyy) +
      e.yyx * mapScene(p + e.yyx) +
      e.yxy * mapScene(p + e.yxy) +
      e.xxx * mapScene(p + e.xxx));
  }

  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 4; i++) {
      float h = 0.04 + 0.22 * float(i);
      occ += (h - mapScene(p + n * h)) * sca;
      sca *= 0.72;
    }
    return clamp(1.0 - 1.1 * occ, 0.0, 1.0);
  }

  // --- water ----------------------------------------------------------------

  // The water level, in the current section's local frame.
  float waterY() { return uWave.x; }

  // ...and in some other slot's frame. The flood is one flat plane through the
  // whole building; toLocal subtracts B.x from y, so a section whose floor
  // origin sits higher carries the surface correspondingly lower in its own
  // coordinates. Getting this wrong puts the scum line and the mosaic course at
  // different heights on either side of a doorway.
  float waterYIn(vec4 B) { return uWave.x - B.x; }

  // Kept deliberately shallow in amplitude: this displaces the *plane solve*,
  // not the SDF, so it costs nothing and cannot break the march.
  float waveH(vec2 xz, float t) {
    float h = sin(xz.x * 1.7 + t * 1.10) * 0.50
            + sin(xz.y * 2.3 - t * 0.90) * 0.40
            + sin((xz.x + xz.y) * 3.1 + t * 1.70) * 0.25;
    return h * 0.020;
  }

  vec3 waterNormal(vec2 xz, float t) {
    float e = 0.06;
    float h  = waveH(xz, t);
    float hx = waveH(xz + vec2(e, 0.0), t);
    float hz = waveH(xz + vec2(0.0, e), t);
    return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  }

  // Plane solve plus one heightfield refinement. The refinement is what gives a
  // wobbling meniscus across the lens at the crossing instead of a razor line.
  float waterHit(vec3 ro, vec3 rd) {
    if (abs(rd.y) < 1e-4) return -1.0;
    float tW = (waterY() - ro.y) / rd.y;
    if (tW <= 0.0) return -1.0;
    vec2 xz = (ro + rd * tW).xz;
    tW = (waterY() + waveH(xz, iTime) - ro.y) / rd.y;
    return tW > 0.0 ? tW : -1.0;
  }

  // Ridged sum-of-sines sharpened into filaments. The pow() is the whole trick:
  // without it this is noise, with it it is caustics.
  float caustic(vec2 p, float t) {
    float k = 0.0;
    vec2  q = p;
    for (int i = 0; i < 3; i++) {
      if (float(i) > 1.0 + uHeavy) break;
      vec2  w = q * (1.0 + float(i) * 0.9);
      float a = sin(w.x + t * (1.0 + float(i) * 0.31)) + sin(w.y * 1.13 - t * 0.87);
      float b = sin((w.x + w.y) * 0.71 + t * 1.21);
      k += 1.0 - abs(a * 0.5 + b * 0.35);
      q  = mat2(0.80, 0.60, -0.60, 0.80) * q;
    }
    return pow(max(k / 3.0, 0.0), 6.0);
  }

  const vec3 LDIR = vec3(0.14, 0.976, 0.17); // down from the ceiling lamps

  // Caustics must be projected along the LIGHT, not straight down — that is what
  // makes them stretch up the walls instead of looking like noise on the floor.
  float causticAt(vec3 p) {
    float dep = waterY() - p.y;
    vec2  cp  = (p + LDIR * (dep / LDIR.y)).xz;

    // Depth defocuses them: amplitude falls, scale grows, pattern blurs to mean.
    cp *= 1.0 / (1.0 + max(dep, 0.0) * 0.25);
    float c = caustic(cp, iTime * 0.6);
    c = mix(c, 0.35, smoothstep(0.5, 5.0, dep));
    c *= exp(-max(dep, 0.0) * 0.25);

    // The band of reflected light thrown ~0.5m ABOVE the waterline. Almost
    // nobody implements this and it is a huge part of reading as a real pool.
    c += caustic(cp * 1.4, iTime * 0.9) * exp(-max(p.y - waterY(), 0.0) * 3.0) * 0.6;
    return c;
  }

  // --- surfaces -------------------------------------------------------------

  // How far gone the building is, 0..0.85, riding the lapF that kinematics ramps
  // across THE DIVING WELL..THE CISTERN — so each lap's escalation arrives while
  // you are under water and well past a doorway, rather than stepping in the one
  // frame that crosses the seam.
  //
  // Zero on the first circuit and steep after it. Both halves matter and they
  // pull in opposite directions: at 0.14 a lap the escalation sat below every
  // threshold downstream and nothing was ever visibly wrong, but lifting the
  // floor to 0.12 turned lap one into static — a quarter of every wall already
  // broken back to concrete before you had walked anywhere. The first lap is
  // meant to be a tiled building that is merely wet. The damage is what arrives.
  float decay() { return min(0.85, uWave.y * 0.30); }

  // The fracture field, built on the tile lattice that tileSurface already has.
  // No fbm and no value noise: a generic crazing would sit ON the tile rather
  // than in it, and real glazed tile crazes per tile and lets go per tile. Each
  // tile picks a bearing from its own hash and splits along it.
  //
  // The gradient comes free by the same trick the grout already uses two
  // functions down — d|dot(f,dir)|/df is just sign(e) * dir — which is what
  // makes the cracks catch the light instead of reading as printed-on dirt.
  void crackAt(vec2 cell, vec2 f, float id, float dec,
               out float hair, out float spall, out vec2 grad) {
    float a   = id * 6.2831;
    vec2  dir = vec2(cos(a), sin(a));

    // Offset off centre by the tile's own hash, so the split is not a neat
    // bisector through every tile in the building.
    float e = dot(f, dir) + (fract(id * 17.13) - 0.5) * 0.45;

    hair  = 1.0 - smoothstep(0.0, 0.02 + 0.05 * dec, abs(e));
    hair *= step(hash21(cell + 5.1), 0.04 + dec * 0.85);
    grad  = dir * sign(e);

    // ...and the ones that have let go of the wall entirely.
    // Tiles off the wall entirely. Held back until the crazing has had a lap to
    // establish itself, so the two stages read as a sequence and not as one.
    spall = step(1.0 - max(dec - 0.22, 0.0) * 0.62, hash21(cell + 19.7));
  }

  // Tile. The normal perturbation is what makes tile look like tile rather than
  // like wallpaper, and it is nearly free: the derivative of fract() is +-1.
  // Set by tileSurface, read by shadeFace. A global rather than a seventh out
  // parameter, following foundry's gWear: the value is wanted by exactly one
  // caller, one call later.
  float crackGlow;

  void tileSurface(vec3 p, vec3 n, float wy, float grime,
                   out vec3 alb, out vec3 nOut, out float rough) {
    vec2 uv; vec3 tu, tv;
    if (abs(n.y) > 0.7)      { uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
    else if (abs(n.x) > 0.7) { uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
    else                     { uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }

    // Real pools run a contrasting mosaic course at the water line.
    float band = smoothstep(0.20, 0.14, abs(p.y - wy));
    float size = mix(abs(n.y) > 0.7 ? 0.30 : 0.22, 0.11, band);

    vec2  g = uv / size;
    vec2  f = fract(g) - 0.5;
    float d = (0.5 - max(abs(f.x), abs(f.y))) * size;
    float groove = 1.0 - smoothstep(0.0, 0.014, d);

    float dec = decay();
    vec2  cell = floor(g);
    float id   = hash21(cell);

    float hair, spall; vec2 cg;
    crackAt(cell, f, id, dec, hair, spall, cg);

    // The crack cuts the surface as well as marking it. Same form as the grout
    // perturbation above and about as cheap.
    nOut = normalize(n - (tu * sign(f.x) + tv * sign(f.y)) * groove * 0.5
                       - (tu * cg.x + tv * cg.y) * hair * 0.35);

    alb = vec3(0.86, 0.89, 0.87) * (0.93 + 0.13 * id);
    alb = mix(alb, vec3(0.30, 0.36, 0.34), band * 0.55);          // the mosaic course

    // A missing tile. The threshold walks down out of the original 0.5%, so the
    // wall loses tiles at a rate rather than having always been missing them.
    alb = mix(alb, vec3(0.44, 0.46, 0.44), step(0.995 - dec * 0.35, id));

    // Whole blocks of tile gone, on a lattice four times coarser than the tiles
    // themselves — reusing the same hash rather than paying for a second field.
    // This is what turns scattered damage into a wall that is coming down.
    // Whole courses gone. The most destructive of the three, so it is the last
    // to arrive — below half decay the wall is damaged, not demolished.
    float patch = step(0.92 - dec * 0.34, hash21(floor(g * 0.25) + 3.7))
                * smoothstep(0.42, 0.60, dec);
    vec3  conc  = vec3(0.38, 0.39, 0.37) * (0.86 + 0.28 * hash21(cell * 2.3));
    alb = mix(alb, conc, max(spall * 0.85, patch * 0.75));

    float mildew = groove * (0.35 + 0.65 * band) * grime;
    alb = mix(alb, vec3(0.30, 0.36, 0.28), mildew * 0.75);
    alb *= mix(1.0, 0.6, groove);                                  // grout is darker
    alb *= 1.0 - hair * 0.55;                                      // and the cracks darker still

    // Splash zone: wet tile above the line is darker and much glossier.
    float wet = exp(-max(p.y - wy, 0.0) * 2.5);

    // Water finding its way out of the cracks and running down the wall. Fed
    // into the wet term rather than painted on, so the existing roughness term below
    // makes the seep glossy for free — which is the whole read.
    float seep = hair * (1.0 - abs(n.y)) * smoothstep(0.18, 0.45, dec);
    wet = max(wet, seep);

    alb  *= mix(1.0, 0.72, wet);
    rough = mix(0.32, 0.06, wet);

    // Scum line: a dirty ring exactly at the water level.
    alb *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.y - wy)) * grime;

    // Late on, the breaks stop being dark and start giving off light. Only some
    // of them, and not equally: a constant emission on every crack reads as a
    // neon wireframe laid over the wall rather than as something behind it
    // showing through. The per-tile hash is already computed, so the variation
    // is free.
    float lit = smoothstep(0.55, 0.95, fract(id * 7.77));
    crackGlow = hair * lit * smoothstep(0.26, 0.66, dec);
  }

  // Ceiling fluorescents. Emissive is a shading term on ceiling hits, not
  // geometry — keeping them out of the SDF saves their cost on every march step.
  float deadFrac(vec4 C) {
    return clamp(0.10 + uWave.y * 0.22 + C.z * 0.30, 0.0, 0.85);
  }

  // Salted with the section's own lamp pitch, so two rooms visible through one
  // doorway do not fail the same tubes in the same order.
  float lampAlive(float band, vec4 C) {
    float dead = step(hash11(band * 3.17 + 11.0 + C.w * 7.31), deadFrac(C));
    float buzz = 0.72 + 0.28 * step(0.30, hash11(band * 7.7 + floor(iTime * 9.0) + C.w));
    return (1.0 - dead) * buzz;
  }

  // A fluorescent tube IS a segment, so light it as one: the closest-point-on-
  // segment costs about five instructions and produces the long specular streak
  // across wet tile and water that a point light simply cannot.
  vec3 stripLight(vec3 p, vec3 n, vec3 alb, float rough, vec3 rd, vec4 B, vec4 C) {
    vec3  acc = vec3(0.0);
    float sp  = max(C.w, 2.0);
    float W   = B.y;
    float H   = B.z;
    float band = floor(p.z / sp);

    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float on = lampAlive(bi, C);
      if (on < 0.01) continue;

      vec3 a  = vec3(-W * 0.55, H - 0.12, (bi + 0.5) * sp);
      vec3 ab = vec3(W * 1.10, 0.0, 0.0);
      float u = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
      vec3  lp = a + ab * u;

      vec3  ld = lp - p;
      float ds = length(ld);
      ld /= max(ds, 0.001);

      float atten = 1.0 / (1.0 + ds * ds * 0.045);
      float diff  = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;

      vec3  h    = normalize(ld - rd);
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), mix(16.0, 220.0, 1.0 - rough));

      acc += (alb * diff + spec * (1.0 - rough) * 0.5) * atten * vec3(0.95, 0.99, 1.0) * on * 2.4;
    }
    return acc;
  }

  // The lit face of a recessed ceiling panel. Emissive only — it is a shading
  // term on ceiling hits, so it costs nothing on the other 95 march steps.
  float ceilPanel(vec3 p, vec4 B, vec4 C) {
    float sp   = max(C.w, 2.0);
    float W    = B.y;
    float band = floor(p.z / sp);
    float lz   = p.z - (band + 0.5) * sp;
    float inZ  = 1.0 - smoothstep(0.20, 0.27, abs(lz));
    float inX  = 1.0 - smoothstep(W * 0.50, W * 0.56, abs(p.x));
    return inZ * inX * lampAlive(band, C);
  }

  // Suspended particulate. Nothing else says "this space is full of water"
  // quite as cheaply — a dark corridor and a flooded one look identical until
  // something is drifting between you and the far wall.
  vec3 motes(vec3 rd, float t) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      if (fi > 2.0 + uHeavy * 2.0) break;
      float dz = 1.2 + fi * 2.2;
      if (dz > t) break;
      vec2  g = rd.xy / max(abs(rd.z), 0.2) * (4.0 + fi * 2.5)
              + vec2(iTime * 0.03, -iTime * 0.06 + fi * 3.1);
      vec2  f  = fract(g) - 0.5;
      float rn = hash21(floor(g) + fi * 31.0);
      if (rn < 0.82) continue;
      acc += vec3(0.55, 0.78, 0.84) * smoothstep(0.15, 0.0, length(f)) * 0.42 / (1.0 + dz * 0.5);
    }
    return acc;
  }

  // Lamp halos, added whether or not the ray hit anything. This is what replaces
  // a bloom post pass — there is no FBO in a single-pass journey.
  // Unlike the others this one is swept along the RAY from the camera, and the
  // camera is by definition in the current section — so it keeps slot 1, and
  // takes it as a parameter only to keep every lamp routine reading the same way.
  vec3 lampGlow(vec3 ro, vec3 rd, float tMax, vec4 B, vec4 C) {
    vec3  acc = vec3(0.0);
    float sp  = max(C.w, 2.0);
    float H   = B.z;
    float band = floor(ro.z / sp);

    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float on = lampAlive(bi, C);
      if (on < 0.01) continue;
      vec3  lp = vec3(0.0, H - 0.12, (bi + 0.5) * sp);
      vec3  v  = lp - ro;
      float proj = clamp(dot(v, rd), 0.0, tMax);
      float dist = length(v - rd * proj);
      acc += vec3(0.85, 0.92, 1.0) * on * 0.05 / (1.0 + dist * dist * 2.2);
    }
    return acc;
  }
`

// Camera, march, water split and the inline post chain.
const SCENE = `
  vec3 shadeFace(vec3 p, vec3 n, vec3 rd) {
    vec4 A, B, C, A2, B2, C2; vec3 q; float w;
    resolveSlot(p, A, B, C, A2, B2, C2, q, w);

    // Into the owning room's coordinates: the point, the normal and the view
    // ray together. Carrying only some of them across is worse than carrying
    // none, because the errors stop being a uniform offset.
    vec3  nq  = dirToLocal(n, A);
    vec3  rdq = dirToLocal(rd, A);
    float wy  = waterYIn(B);

    vec3 alb, nn; float rough;
    tileSurface(q, nq, wy, C.z, alb, nn, rough);

    vec3 c = stripLight(q, nn, alb, rough, rdq, B, C);

    // In the throat of a doorway, light the surface as both rooms and mix. The
    // tile frame is NOT mixed — coordinates from two rigid frames average into a
    // point in neither, and the grid would ghost — but the light is just a
    // number, and crossing it over is what stops the threshold reading as a line
    // ruled across the floor.
    if (w > 0.004) {
      vec3 q2 = toLocal(p, A2, B2.x);
      c = mix(c, stripLight(q2, dirToLocal(n, A2), alb, rough, dirToLocal(rd, A2), B2, C2), w);
    }

    c += alb * 0.06;

    // Caustics stay in the CURRENT frame on purpose. The water is one flat
    // plane through the entire building and depth below it is the only quantity
    // that has to be right; projecting the pattern in each room's own frame
    // would make it swim sideways every time you crossed a join.
    if (p.y < waterY()) c += alb * causticAt(p) * 0.9;
    if (n.y < -0.6) c += vec3(0.95, 0.99, 1.0) * ceilPanel(q, B, C) * 3.2;

    // Whatever is behind the walls by now. Same oxblood foundry's decay rots
    // its grade toward, and the only warm thing in a building lit entirely by
    // dying fluorescents.
    c += vec3(1.00, 0.17, 0.06) * crackGlow * 3.0;
    return c;
  }

  // First bounce off the water. A short secondary march rather than an analytic
  // box exit: the camera is often near a boundary between wildly different
  // sections (a 1.6m corridor mouth opening into an 18m hall), and a single
  // box is simply the wrong shape there. 20 steps against exact box SDFs covers
  // plenty of distance, and the reflection is the whole look of a pool.
  vec3 reflectShade(vec3 p, vec3 r) {
    float rt = 0.06;
    for (int i = 0; i < 20; i++) {
      float d = mapScene(p + r * rt);
      if (d < 0.004 * (1.0 + rt * 0.02)) {
        vec3 q = p + r * rt;
        return mix(HAZE, shadeFace(q, calcNormal(q, rt), r), exp(-rt * 0.035));
      }
      rt += d * 0.95;
      if (rt > 45.0) break;
    }
    return HAZE;
  }

  // Six taps along the primary ray, each projected up to the surface along the
  // light and evaluated with the SAME caustic function, weighted by forward
  // scattering. Marching real shafts is not affordable; this is.
  vec3 lightShafts(vec3 ro, vec3 rd, float t) {
    if (uHeavy < 0.5) return vec3(0.0);
    float phase = pow(max(dot(rd, LDIR), 0.0), 8.0);
    if (phase < 0.002) return vec3(0.0);
    float acc = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3 sp = ro + rd * (t * (float(k) + 0.5) / 6.0);
      float dep = waterY() - sp.y;
      vec2 cp = (sp + LDIR * (dep / LDIR.y)).xz;
      acc += caustic(cp, iTime * 0.6) * exp(-max(dep, 0.0) * 0.22);
    }
    return vec3(0.55, 0.85, 0.92) * acc * (1.0 / 6.0) * phase * 0.9;
  }

  // Red light bleeding out of the breaks, accumulated along the primary ray.
  // Deliberately the same six-tap shape as lightShafts above, so this is one
  // more instance of a pattern the file already has rather than a new mechanism.
  //
  // Each tap is weighted by how close it is to a surface. That proximity term is
  // what makes the glow hug the cracked walls and pool in the corners, instead
  // of hanging in the middle of the room like coloured fog.
  vec3 crackShafts(vec3 ro, vec3 rd, float t) {
    float dec = decay();
    if (dec < 0.18) return vec3(0.0);

    float acc = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3  sp = ro + rd * (t * (float(k) + 0.5) / 6.0);
      float prox = 1.0 - clamp(mapScene(sp) * 0.5, 0.0, 1.0);

      // A coarse standing field rather than the per-tile one: this is sampled in
      // mid-air, where there is no tile lattice to fracture along.
      float v = sin(sp.x * 1.7 + cos(sp.z * 2.1)) * cos(sp.z * 1.9 + sin(sp.y * 1.5));
      acc += (1.0 - smoothstep(0.0, 0.16 + 0.30 * dec, abs(v))) * prox * prox;
    }
    return vec3(1.00, 0.17, 0.06) * acc * (1.0 / 6.0) * dec * 1.7;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float yaw   = uCam.w + uPointer.x * 0.45;
    float pitch = uLook.x + uPointer.y * 0.28;
    float roll  = uLook.y;

    // The camera lives in the current section's own frame, which is why nothing
    // here ever grows: local z runs 0..len and resets at every section.
    vec3 ro = vec3(uCam.x, uCam.y, uCam.z);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);

    float cr = cos(roll), sr = sin(roll);
    vec3  r2 = rgt * cr - up * sr;
    up  = rgt * sr + up * cr;
    rgt = r2;

    vec3 rd = normalize(uv.x * rgt + uv.y * up + 1.05 * fwd);

    // Exact box SDFs, so the step factor can sit near 1.0 — the fbm-displaced
    // journeys in this repo have to undershoot to 0.55-0.72, this one does not.
    // The cone-widening epsilon terminates grazing rays earlier and can only
    // ever end the march sooner, never overshoot it.
    float t   = 0.05;
    bool  hit = false;
    for (int i = 0; i < 96; i++) {
      vec3  p = ro + rd * t;
      float d = mapScene(p);
      if (d < 0.0025 * (1.0 + t * 0.012)) { hit = true; break; }
      t += d * 0.95;
      if (t > 70.0) break;
    }

    float above  = uLook.z;                 // 1 = head above water, 0 = under
    bool  camWet = above < 0.5;

    // Humid haze above, and the real thing below: wavelength-dependent
    // absorption. Red dies first, which is most of why underwater reads as
    // underwater at all.
    vec3 hazeCol = vec3(0.070, 0.088, 0.095);
    vec3 deepCol = vec3(0.030, 0.085, 0.105);
    vec3 murk    = vec3(0.34, 0.15, 0.11);

    vec3  col = hazeCol;
    float tEnd = min(t, 70.0);

    if (hit) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p, t);
      col = shadeFace(p, n, rd) * calcAO(p, n);
    }

    float tW = waterHit(ro, rd);
    bool  crosses = tW > 0.0 && (!hit || tW < t);

    if (!camWet) {
      // --- above the surface ---
      col = mix(hazeCol, col, exp(-tEnd * 0.030));

      if (crosses) {
        vec3 wp = ro + rd * tW;
        vec3 wn = waterNormal(wp.xz, iTime);

        // Everything beyond the surface is seen through the water.
        vec3 under = hit ? col : deepCol;
        under = mix(deepCol, under, exp(-max(t - tW, 0.0) * 0.55));
        under += vec3(0.35, 0.62, 0.68) * causticAt(wp) * 0.25;

        vec3 rr   = reflect(rd, wn);
        vec3 refl = reflectShade(wp, rr);

        // Schlick: near-mirror at the far end of the pool, glassy underfoot.
        float cosT = clamp(dot(wn, -rd), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        col = mix(under, refl, fres);
        col = mix(hazeCol, col, exp(-tW * 0.030));
      }
    }
    else {
      // --- submerged ---
      col = mix(deepCol, col, exp(-tEnd * 0.115));
      col *= exp(-tEnd * murk * 0.26);
      col += deepCol * 0.35;                       // in-scattered ambient, not just darkness
      col += lightShafts(ro, rd, tEnd);
      col += motes(rd, tEnd);

      if (crosses) {
        // Snell's window: looking up, everything outside the 48.6 degree cone is
        // a perfect mirror of the floor, and inside it the whole world above is
        // squeezed into a bright ellipse. Six instructions, and it is the shot.
        float sinT = length(rd.xz);
        float tir  = smoothstep(0.735, 0.762, sinT);
        vec3  wp   = ro + rd * tW;
        vec3  wn   = waterNormal(wp.xz, iTime);

        vec3  win  = vec3(0.72, 0.86, 0.90) * (1.0 + causticAt(wp) * 0.8);
        vec3  mirr = col * 0.55 + deepCol * 0.5;
        vec3  surf = mix(win, mirr, tir);

        col = mix(surf, col, 1.0 - exp(-tW * 0.30));
      }
    }

    col += lampGlow(ro, rd, tEnd, uSecB[1], uSecC[1]) * (camWet ? 0.55 : 1.0);

    // Above and below the surface both: the red is the one thing in here that
    // does not care whether your head is under.
    col += crackShafts(ro, rd, tEnd);

    // --- inline post (no FBO in a single-pass journey) ---

    // stairwell's flicker trick: the cheapest convincing fluorescent buzz.
    float age = clamp(uWave.y * 0.12, 0.0, 0.45);
    col *= 1.0 - age * 0.5 * step(0.96, hash21(vec2(floor(iTime * 14.0), 7.0)));

    col *= 1.0 - smoothstep(0.42, 1.15, length(uv)) * (0.45 + 0.2 * (1.0 - above));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.6, lum) * 0.4;

    // Reinhard shoulder rather than clamp(col, 0.0, 1.8). The clamp was the real
    // reason bright tile turned into featureless white paper: every value past
    // 1.8 became exactly 1.0, so grout lines, mosaic courses and cracks all
    // flattened into the same flat area the moment a wall came near a lamp. This
    // compresses instead, so the highlights stay highlights and keep their
    // detail. White point at 2.6: anything beyond that is a lamp, and lamps are
    // allowed to be white.
    col = max(col, 0.0);
    col = col * (1.0 + col / (2.6 * 2.6)) / (1.0 + col);
    col = pow(col, vec3(0.92));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.028;

    gl_FragColor = vec4(col, 1.0);
  }
`

export const natatoriumFrag = COMMON + SCENE

// Hover preview. Self-driving from iTime alone: ShaderPreviewLayer attaches no
// simulation, so uSec/uCam would all read zero and the real shader would render
// a black frame. No raymarch either — every card in the grid shares one GL
// context. The job is to read as a swimming pool at 300px, which is what the
// rippled fluorescent strips smearing down across the waterline do.
export const natatoriumPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Ridged sum-of-sines sharpened into filaments. The pow() is the whole trick:
  // without it this is noise, with it it is caustics.
  float caustic(vec2 p, float t) {
    float k = 0.0;
    vec2  q = p;
    for (int i = 0; i < 3; i++) {
      vec2  w = q * (1.0 + float(i) * 0.9);
      float a = sin(w.x + t * (1.0 + float(i) * 0.31)) + sin(w.y * 1.13 - t * 0.87);
      float b = sin((w.x + w.y) * 0.71 + t * 1.21);
      k += 1.0 - abs(a * 0.5 + b * 0.35);
      q  = mat2(0.80, 0.60, -0.60, 0.80) * q;
    }
    return pow(max(k / 3.0, 0.0), 6.0);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;

    float horizon = 0.06 + 0.05 * sin(iTime * 0.25);

    // Ground-plane trick: perspective floor out of a divide, scrolling toward us.
    float fy = max(horizon - uv.y, 1e-3);
    vec2  fp = vec2(uv.x / fy, 1.0 / fy + iTime * 0.35);

    vec2  g     = fract(fp * 3.0) - 0.5;
    float grout = 1.0 - smoothstep(0.0, 0.06, 0.5 - max(abs(g.x), abs(g.y)));
    float c     = caustic(fp * 1.6, iTime);

    vec3 below = mix(vec3(0.16, 0.34, 0.38), vec3(0.52, 0.74, 0.76), 1.0 - grout * 0.55);
    below += vec3(0.60, 0.90, 0.95) * c * 0.85;
    // Depth fade over the range the floor actually spans: 1/fy is already ~2.4
    // at the bottom edge of the card, so a fade ending at 2.5 blacks out the
    // entire floor and the tiles never read.
    below = mix(below, vec3(0.05, 0.13, 0.19), smoothstep(2.5, 15.0, 1.0 / fy));

    // Above the line: pale tile and the fluorescent strips.
    float strip = 0.0;
    for (int i = 0; i < 4; i++) {
      float sy = horizon + 0.09 + float(i) * 0.10;
      strip += 0.018 / (abs(uv.y - sy) + 0.020);
    }
    vec3 above = vec3(0.74, 0.78, 0.77) + vec3(1.0, 0.97, 0.88) * strip * 0.32;

    // The strips smear down across the water, rippled. This is the tell.
    float ripple = sin(uv.x * 18.0 + iTime * 1.7) * 0.012;
    below += vec3(1.0, 0.97, 0.88) * (0.030 / (abs(uv.y - horizon + ripple) + 0.06)) * 0.9;

    vec3 col = mix(below, above, smoothstep(-0.004, 0.004, uv.y - horizon + ripple * 0.5));
    col *= 1.0 - 0.5 * length(uv * vec2(0.8, 1.0));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 51.7) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`
