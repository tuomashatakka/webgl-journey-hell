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

  // ...and how big it is. Fixed, not proportional -- see sectionAir.
  const float DOOR_W = 1.05;
  const float DOOR_H = 2.25;

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

  // Segment capsule between two arbitrary points. Exact, and the only primitive
  // here that can be aimed: fronds do not grow axis-aligned.
  float sdSeg(vec3 p, vec3 a, vec3 b, float r) {
    vec3  pa = p - a;
    vec3  ba = b - a;
    float h  = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  // Fold onto the nearest lattice cell, unbounded or clamped to a run of 2n+1.
  // Exact for identical axis-aligned instances: on a lattice of congruent shapes
  // the nearest centre really is the nearest instance — which is why nothing
  // repeated in this file jitters its position, however much it would like to.
  float latt(float x, float cell) { return x - (floor(x / cell) + 0.5) * cell; }
  float lattN(float x, float cell, float n) {
    return x - clamp(floor(x / cell + 0.5), -n, n) * cell;
  }

  // --- materials -------------------------------------------------------------
  //
  // Which surface the march last decided on. foundry's gWear pattern: written
  // where the geometry is chosen, read exactly one call later by shadeFace, and
  // eliminated out of the march itself because nothing there reads it. ES 1.00
  // cannot return a struct from a min chain, and re-deriving the material at the
  // hit point would mean writing every fitting out twice.
  const float MAT_TILE  = 0.0;
  const float MAT_FLOAT = 1.0;   // lane rope floats
  const float MAT_METAL = 2.0;   // ladders, conduit, rails, valve wheels
  const float MAT_PAINT = 3.0;   // lockers, benches, pump housings, the flume
  const float MAT_LEAF  = 4.0;   // everything green
  const float MAT_CONC  = 5.0;   // columns, pillars, the dive platform

  float gMat;

  // The min chain, with the material riding along. A plain min cannot say which
  // branch won, and which branch won is the entire question.
#define PUT(E, M) { float dd = (E); if (dd < d) { d = dd; gMat = (M); } }

  // --- decay -----------------------------------------------------------------
  //
  // How far gone the building is, riding the lapF that kinematics ramps across
  // THE DIVING WELL..THE CISTERN -- so each lap's escalation arrives while you
  // are under water and well past a doorway, rather than stepping in the one
  // frame that crosses a seam.
  //
  // The floor is deliberately not zero. It was, and the consequence was that the
  // first circuit -- the only one most people ever see -- was a building in
  // perfect repair, which is not what a natatorium carved out of solid rock and
  // left to flood looks like. A tenth is a scatter of broken tiles and a handful
  // of lit holes. The coarse concrete patches and the missing courses are what
  // has to wait, and they are gated on their own thresholds further down.
  float decay() { return min(0.90, 0.10 + uWave.y * 0.32); }

  // --- the tiles that have let go --------------------------------------------
  //
  // Shading cannot do this one. A painted hole has no depth to be dark inside,
  // no lip for the strip light to rake across, and nowhere for the red to come
  // out of; a painted proud tile does not catch the light on its edge. So the
  // damage is geometry, cut on the same lattice tileSurface draws on, and a hole
  // is exactly and only where a tile is missing.
  //
  // Two halves sharing one face-selection:
  //
  //   hole   a recess cut INTO the shell, unioned into the air with min. Only
  //          the cell the point is in is ever evaluated, never its neighbours,
  //          which makes this an OVER-estimate of the air -- and over-stating
  //          air under-states the concrete, the one direction a sphere trace is
  //          allowed to be wrong in. The zero set is still exact, because a
  //          point inside a recess is inside that recess's own cell by
  //          construction.
  //
  //   proud  a tile standing out of the wall, as a non-negative offset ADDED to
  //          the shell. Adding a positive number moves the surface into the room
  //          and can only ever shorten a step. The one price is paid at the
  //          silhouette of a proud tile, where the neighbouring cell's offset is
  //          not seen and a grazing ray can bite up to PROUD off a corner --
  //          three centimetres, off a three-centimetre feature.
  //
  // Suppressed in the coving, where two faces are equidistant and the choice
  // between them flips: that is the one place where the discontinuity would
  // matter, and a coved corner is a single moulded piece in a real pool anyway.
  const float TILE_W = 0.22;   // wall tile, matching tileSurface
  const float TILE_F = 0.30;   // floor and ceiling tile, ditto
  const float HOLE_D = 0.24;   // how far into the wall a missing tile goes
  const float PROUD  = 0.032;  // how far out of it the survivors are pushed

  // Per-face salt, so the same cell index on the floor and on the wall is not the
  // same tile. tileSurface derives these from the normal and must agree.
  const float SALT_WALL = 0.0;
  const float SALT_FLR  = 3.7;
  const float SALT_CEIL = 8.1;

  void tileBreak(vec3 qs, vec4 B, float dec, out float proud, out float hole) {
    proud = 0.0;
    hole  = 1e5;

    // Not in the doorways. The recesses there are the doorways.
    if (qs.z < 0.35 || qs.z > B.w - 0.35) return;

    float dx = B.y - abs(qs.x);
    float dy = qs.y;
    float dz = B.z - qs.y;

    float m1, m2, salt, ts;
    vec2  uv;
    if (dx <= dy && dx <= dz) { m1 = dx; m2 = min(dy, dz); uv = vec2(qs.z, qs.y); salt = SALT_WALL; ts = TILE_W; }
    else if (dy <= dz)        { m1 = dy; m2 = min(dx, dz); uv = vec2(qs.x, qs.z); salt = SALT_FLR;  ts = TILE_F; }
    else                      { m1 = dz; m2 = min(dx, dy); uv = vec2(qs.x, qs.z); salt = SALT_CEIL; ts = TILE_F; }
    if (m2 - m1 < 0.30) return;

    vec2  g    = floor(uv / ts);
    float id   = hash21(g + salt);

    if (id < 0.004 + dec * 0.16) {
      // The recess pokes two centimetres proud of the nominal face, so a ray
      // arriving at the wall finds its way in rather than stopping on the plane
      // in front of it.
      vec2 f = uv - (g + 0.5) * ts;
      hole = sdBox(vec3(f.x, f.y, m1 + (HOLE_D - 0.02) * 0.5),
                   vec3(ts * 0.42, ts * 0.42, (HOLE_D + 0.02) * 0.5));
    }
    else {
      float pr = hash21(g + salt + 41.3);
      proud = step(pr, 0.02 + dec * 0.18) * PROUD * (0.35 + 0.65 * fract(pr * 53.0));
    }
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

    // Broken tile, but only within reach of a surface. Outside that band the
    // whole term is provably zero, and outside that band is exactly where the
    // long steps are and therefore where the frame is actually spent.
    if (room > -0.55) {
      float proud, hole;
      tileBreak(qs, B, decay(), proud, hole);
      room = min(room + proud, hole);
    }

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
    // ONE doorway size for the whole building, shrunk only where the room is too
    // small to hold it. Proportional apertures meant a 16m hall and the 1.4m
    // corridor it opened into cut recesses of different sizes at the same join --
    // and since each section carries its own, you walked up to a doorway to find
    // a second, differently sized doorway nested inside it and offset from it.
    // The sill sits ON the floor for the same reason: a 30cm lip that only one of
    // the two rooms had read as a step that was there and then was not.
    float ax = min(DOOR_W, B.y * 0.72);
    float ay = min(DOOR_H, B.z * 0.80);
    float door = sdBox(vec3(qs.x, qs.y - ay * 0.5, qs.z - B.w * 0.5),
                       vec3(ax, ay * 0.5, B.w * 0.5 + DOOR_STUB));

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
    // A hand's width larger than the doorway itself, so the dressing frames the
    // opening instead of pinching it.
    float ax = min(DOOR_W, W * 0.72) + 0.12;
    float ay = min(DOOR_H, H * 0.80) + 0.12;
    float ap = sdBox(vec3(qs.x, qs.y - ay * 0.5, qs.z - JOIN_SPAN * 0.5),
                     vec3(ax, ay * 0.5, JOIN_SPAN * 0.5 + 1.0));
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
    float wy  = clamp(uWave.x - B.x, 0.35, H - 0.5);
    float dec = decay();
    gMat = MAT_TILE;

    // WHAT MOVED IN. Every room gets this, because the flood reaches every room:
    // a skirt of weed on the walls at the waterline, thickening with the lap.
    // Bounded on a slab of its own, so crossing the middle of a twenty-two metre
    // pool costs one max and one branch.
    // Scaled to the room, and hard. A frond sized for a sixteen-metre hall is a
    // green scaffold pole lying across a 1.8m service corridor -- the same
    // absolute size that reads as weed in THE CISTERN blocks THE DRAIN outright.
    float gs = clamp(min(W, H) * 0.28, 0.22, 0.75);
    float gb = max(abs(qs.y - wy) - gs, hx - gs * 0.85);
    if (gb < BOUND_SLACK) {
      float lz = latt(qs.z, 0.62);
      float gh = hash21(vec2(floor(qs.z / 0.62), sign(qs.x) * 3.0) + 7.7);
      float gr = (0.016 + 0.020 * gh) * gs * 1.4 * smoothstep(0.04, 0.60, dec);
      vec3  gp = vec3(abs(qs.x) - (W - 0.03), qs.y - wy + (gh - 0.5) * 0.22 * gs, lz);
      PUT(sdSeg(gp, vec3(0.0), gs * vec3(-0.50 - gh * 0.40, -0.42 - gh * 0.70, (gh - 0.5) * 0.6), gr), MAT_LEAF)
      PUT(sdSeg(gp, vec3(0.0), gs * vec3(-0.26 - gh * 0.30,  0.36 + gh * 0.40, (0.5 - gh) * 0.7), gr * 0.8), MAT_LEAF)
    }
    else d = gb;

    if (t < 0.5) {
      // Ropes sit in a thin slab at the waterline and span the room; the ladder
      // hugs the wall, and the platform reaches 3.2 in — but only in the one
      // hall tall enough to have one, so the shallow rooms are not made to pay
      // for it. Branching on H is free here: it is a uniform.
      float reach = H > 8.0 ? 3.25 : 1.35;
      float bt = min(abs(qs.y - wy) - 0.12, hx - reach);
      if (bt > BOUND_SLACK) return min(d, bt);
      // TILE — the swimming halls.
      // Lane ropes, bobbing on the flood. Offset half a lane off centre so the
      // aisle does not have to eat one whole rope to let you through.
      float bob   = sin(qs.z * 0.7 + iTime * 0.9) * 0.03;
      float lanes = floor(max(W - 2.0, 0.0) / 2.4);
      PUT(sdSphere(vec3(lattN(qs.x - 1.2, 2.4, lanes),
                        qs.y - wy - bob, latt(qs.z, 0.36)), 0.075), MAT_FLOAT)

      // A wall ladder: two stringers 0.44 apart, rungs every 0.30.
      vec3 lp = vec3(abs(qs.x) - (W - 0.18), qs.y - 1.1, qs.z - B.w * 0.32);
      PUT(sdCapsuleY(vec3(lp.x, lp.y, abs(lp.z) - 0.22), 1.1, 0.045), MAT_METAL)
      PUT(sdCapsuleZ(vec3(lp.x, lattN(lp.y, 0.30, 3.0), lp.z), 0.22, 0.030), MAT_METAL)

      // Poolside planters. The only green this building ever had on purpose, and
      // the reason sdSeg exists: three aimed capsules out of a pot is the
      // cheapest thing that still reads as a plant from across a pool.
      vec3 pl = vec3(abs(qs.x) - (W - 0.52), qs.y, latt(qs.z, 7.5));
      PUT(sdRoundBox(vec3(pl.x, pl.y - 0.25, pl.z), vec3(0.28, 0.25, 0.28), 0.06), MAT_PAINT)
      vec3 pb = vec3(pl.x, pl.y - 0.46, pl.z);
      PUT(min(min(sdSeg(pb, vec3(0.0), vec3(-0.58, 0.66, 0.16), 0.042),
                  sdSeg(pb, vec3(0.0), vec3(-0.16, 0.98, -0.38), 0.042)),
              sdSeg(pb, vec3(0.0), vec3(0.14, 0.82, 0.48), 0.042)), MAT_LEAF)

      // The deep room gets a dive platform. Among the tiled halls only THE
      // DIVING WELL is this tall, so the height is the test.
      if (H > 8.0) {
        vec3 dp = vec3(abs(qs.x) - (W - 1.5), qs.y - H * 0.55, qs.z - B.w * 0.70);
        PUT(sdRoundBox(dp, vec3(1.5, 0.10, 1.1), 0.05), MAT_CONC)
        PUT(sdCapsuleY(vec3(dp.x, qs.y - H * 0.275, dp.z), H * 0.275, 0.13), MAT_CONC)
      }
    }
    else if (t < 1.5) {
      // Conduit runs the ceiling corner, so it is bounded on both axes at once.
      float bt = max(hx - 0.34, hy - 0.62);
      if (bt > BOUND_SLACK) return min(d, bt);

      // GUTTER — the service runs. Three conduits along the ceiling, and a
      // junction box dropped off them every few metres.
      vec3 cp = vec3(abs(qs.x) - (W - 0.22), qs.y - (H - 0.30), qs.z);
      PUT(sdCapsuleZ(vec3(cp.x, lattN(cp.y, 0.26, 1.0), 0.0), 1e4, 0.055), MAT_METAL)
      PUT(sdRoundBox(vec3(cp.x, cp.y + 0.55, latt(qs.z, 4.2)),
                     vec3(0.12, 0.20, 0.26), 0.03), MAT_PAINT)
    }
    else if (t < 2.5) {
      // The columns hug the walls; the flume swings far out into the room, so
      // it gets its own bounding sphere rather than dragging the columns' bound
      // out to meet it.
      vec3  fc = vec3(qs.x - (W - 5.0), qs.y - H * 0.62, qs.z - B.w * 0.5);
      float bt = min(hx - 2.30, length(fc) - 5.2);
      if (bt > BOUND_SLACK) return min(d, bt);

      // VAULT — THE GRAND HALL. Columns down both sides, and the flume.
      PUT(sdCapsuleY(vec3(abs(qs.x) - (W - 1.7), qs.y - H * 0.5, latt(qs.z, 6.0)),
                     H * 0.5, 0.55), MAT_CONC)

      // Planters between the columns, on the scale of the room they stand in.
      vec3 vp = vec3(abs(qs.x) - (W - 0.80), qs.y, latt(qs.z - 3.0, 6.0));
      PUT(sdRoundBox(vec3(vp.x, vp.y - 0.36, vp.z), vec3(0.42, 0.36, 0.42), 0.07), MAT_PAINT)
      vec3 vb = vec3(vp.x, vp.y - 0.66, vp.z);
      PUT(min(min(sdSeg(vb, vec3(0.0), vec3(-0.86, 0.92, 0.24), 0.055),
                  sdSeg(vb, vec3(0.0), vec3(-0.22, 1.44, -0.56), 0.055)),
              sdSeg(vb, vec3(0.0), vec3(0.20, 1.20, 0.70), 0.055)), MAT_LEAF)

      // The waterslide: a quarter of a torus swooping from high on one wall down
      // toward the water. A swept tube is not an exact SDF and is not worth the
      // step factor; a clipped torus is exact, and reads as a flume.
      vec3  fp    = vec3(qs.x - (W - 5.0), qs.y - H * 0.62, qs.z - B.w * 0.5);
      float flume = sdTorus(fp.yzx, 4.2, 0.80);
      flume = max(flume, fp.y);    // the descending half
      flume = max(flume, -fp.z);   // ...and only the near quarter of it
      PUT(flume, MAT_PAINT)
      PUT(sdCapsuleY(vec3(fp.x, qs.y - H * 0.31, fp.z - 4.2), H * 0.31, 0.16), MAT_METAL)
    }
    else if (t < 3.5) {
      float bt = max(hx - 1.10, qs.y - 2.00);
      if (bt > BOUND_SLACK) return min(d, bt);

      // LOCKER — a run of lockers down both walls, with a bench under them.
      PUT(sdRoundBox(vec3(abs(qs.x) - (W - 0.24), qs.y - 0.95, qs.z - B.w * 0.5),
                     vec3(0.24, 0.95, B.w * 0.55), 0.03), MAT_PAINT)
      PUT(sdRoundBox(vec3(abs(qs.x) - (W - 0.85), qs.y - 0.44, latt(qs.z, 5.0)),
                     vec3(0.22, 0.05, 1.30), 0.03), MAT_PAINT)
    }
    else if (t < 4.5) {
      float bt = hx - 1.45;
      if (bt > BOUND_SLACK) return min(d, bt);

      // PLANT — pumps and pipework, the only warm light in the building.
      vec3 pp = vec3(abs(qs.x) - (W - 0.30), qs.y, qs.z);
      PUT(sdCapsuleZ(vec3(pp.x, lattN(pp.y - 1.9, 0.42, 3.0), 0.0), 1e4, 0.085), MAT_METAL)
      PUT(sdRoundBox(vec3(pp.x - 0.55, qs.y - 0.55, latt(qs.z, 7.0)),
                     vec3(0.55, 0.55, 0.80), 0.10), MAT_PAINT)
      PUT(sdTorus(vec3(pp.x, qs.y - 1.35, latt(qs.z, 7.0) - 0.95).zyx, 0.26, 0.045), MAT_METAL)
    }
    else {
      // RAW — bare concrete. The big room gets pillars, the tight ones a rail.
      if (W > 6.0) {
        // Offset half a bay so no pillar stands on the walked line: the aisle
        // would carve a tunnel clean through it and leave a floating stump.
        PUT(sdCapsuleY(vec3(lattN(qs.x - 2.75, 5.5, 2.0), qs.y - H * 0.5, latt(qs.z, 6.5)),
                       H * 0.5, 0.62), MAT_CONC)
      }
      else {
        float bt = hx - 0.25;
        if (bt > BOUND_SLACK) return min(d, bt);

        vec3 rp = vec3(abs(qs.x) - (W - 0.16), qs.y - 1.02, qs.z);
        PUT(sdCapsuleZ(vec3(rp.x, rp.y, 0.0), 1e4, 0.045), MAT_METAL)
        PUT(sdCapsuleY(vec3(rp.x, qs.y - 0.51, latt(qs.z, 2.4)), 0.51, 0.035), MAT_METAL)
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

  // Chop. Deliberately NOT folded into waveH: waveH displaces the plane solve and
  // has to stay shallow or the surface parts company with the walls it meets,
  // while the normal wants detail an order of magnitude finer. Ten times the
  // slope for none of the displacement, which is what real water is -- and it is
  // the whole difference between a pool and a sheet of black glass with a hard
  // edge, which is what this was.
  float chopH(vec2 xz, float t) {
    float h = 0.0;
    float a = 0.011;
    vec2  q = xz;
    for (int i = 0; i < 3; i++) {
      h += sin(q.x * 3.1 + t * 1.30) * sin(q.y * 2.6 - t * 1.07) * a;
      q  = mat2(0.86, 0.51, -0.51, 0.86) * q * 2.07;
      a *= 0.52;
    }
    return h;
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i),                 hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // What is floating ON it. A dead flat mirror is the most artificial thing a
  // shader can put in a room; a pool nobody has skimmed in years is not a mirror
  // at all in patches, and the patches are what tell you which way it is drifting.
  float surfaceFilm(vec2 xz, float dec) {
    float n = vnoise(xz * 0.42 + vec2(iTime * 0.013, -iTime * 0.009)) * 0.62
            + vnoise(xz * 1.70 - vec2(iTime * 0.022,  iTime * 0.017)) * 0.38;
    // A wide ramp, not a threshold. Scum has no edge -- it thins out. A tight
    // smoothstep over a two-octave noise gave the sharp-edged blob that read as a
    // hole in the water rather than as something floating on it.
    return smoothstep(0.40, 0.86, n) * (0.20 + 0.55 * dec);
  }

  vec3 waterNormal(vec2 xz, float t) {
    float e = 0.05;
    float h  = waveH(xz, t)                  + chopH(xz, t);
    float hx = waveH(xz + vec2(e, 0.0), t)   + chopH(xz + vec2(e, 0.0), t);
    float hz = waveH(xz + vec2(0.0, e), t)   + chopH(xz + vec2(0.0, e), t);
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


  // The fracture field, built on the tile lattice tileSurface already has. No
  // fbm and no value noise: generic crazing sits ON a tile rather than in it, and
  // real glazed tile crazes per tile and lets go per tile. Each tile picks a
  // bearing from its own hash and splits along it.
  //
  // The gradient comes free by the same trick the grout uses two functions down
  // (d|dot(f,dir)|/df is just sign(e) * dir), which is what makes a crack catch
  // the light instead of reading as printed-on dirt.
  //
  // Two things stop it reading as a scratch, which is exactly what it read as
  // before: the split KINKS, by an offset that is a function of the across-crack
  // coordinate alone (so it bends the line without a noise lookup and without
  // touching the gradient trick), and it TAPERS to nothing at the grout, because
  // a break in glazed tile stops at the edge of the tile.
  void crackAt(vec2 cell, vec2 f, float id, float dec,
               out float hair, out float spall, out vec2 grad) {
    float a   = id * 6.2831;
    vec2  dir = vec2(cos(a), sin(a));
    vec2  per = vec2(-dir.y, dir.x);
    float ac  = dot(f, per);

    float e = dot(f, dir) + (fract(id * 17.13) - 0.5) * 0.45
            + sin(ac * 17.0 + id * 41.0) * 0.022
            + sin(ac * 43.0 - id * 13.0) * 0.009;

    float taper = 1.0 - smoothstep(0.26, 0.50, max(abs(f.x), abs(f.y)));
    float wdt   = max((0.007 + 0.032 * dec) * taper, 0.0015);

    hair  = (1.0 - smoothstep(0.0, wdt, abs(e))) * taper;
    hair *= step(hash21(cell + 5.1), 0.015 + dec * 0.62);
    grad  = dir * sign(e);

    // ...and the ones that have let go of the wall entirely. Held back until the
    // crazing has had a lap to establish itself, so the two read as a sequence.
    spall = step(1.0 - max(dec - 0.26, 0.0) * 0.66, hash21(cell + 19.7));
  }

  // Tile. The normal perturbation is what makes tile look like tile rather than
  // like wallpaper, and it is nearly free: the derivative of fract() is +-1.
  // Set by tileSurface, read by shadeFace. A global rather than a seventh out
  // parameter, following foundry's gWear: the value is wanted by exactly one
  // caller, one call later.
  float crackGlow;

  // How far the shaded point is from the eye, in metres. Set once by the march.
  //
  // Everything in tileSurface is a hard step across a lattice: 14mm of grout on
  // a 220mm tile, a crack a few millimetres wide, the lip of a hole. At the far
  // end of a twenty-two metre hall those are a third of a pixel across, and a
  // third of a pixel of pure black sampled once per pixel is not a grout line,
  // it is moire -- the interference pattern that made every far wall in this
  // building look like corduroy. There is no mip chain to lean on here (nothing
  // is textured) and no derivatives (ES 1.00 has no dFdx without an extension),
  // so the footprint is estimated from distance and the detail is faded into its
  // own mean before it can alias. This is what a mip chain does; it is just done
  // by hand, and it is why detail must go to its MEAN and not to zero.
  float gDist;

  // 0 at arm's length, 1 once one tile is about a pixel across.
  float lodFade(float feature) {
    return smoothstep(feature * 260.0, feature * 900.0, gDist);
  }

  // Evaluated in the SHEARED frame, on the SAME lattice tileBreak cuts the
  // geometry on -- same cell size, same per-face salt, same hash. That agreement
  // is the whole point: a tile that reads as missing is missing, because the hole
  // it left is real, and the grout line at its edge is the lip of that hole.
  void tileSurface(vec3 p, vec3 n, float wy, float grime,
                   out vec3 alb, out vec3 nOut, out float rough) {
    vec2 uv; vec3 tu, tv; float size; float salt;
    if (abs(n.y) > 0.7) {
      uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0);
      size = TILE_F; salt = n.y > 0.0 ? SALT_FLR : SALT_CEIL;
    } else if (abs(n.x) > 0.7) {
      uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0);
      size = TILE_W; salt = SALT_WALL;
    } else {
      uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0);
      size = TILE_W; salt = 5.5;               // the end walls, which are not holed
    }

    vec2  g = uv / size;
    vec2  f = fract(g) - 0.5;
    float d = (0.5 - max(abs(f.x), abs(f.y))) * size;

    // Grout, widening and fading with distance rather than thinning to nothing.
    // Widening is what keeps a far wall reading as tiled at all; fading is what
    // stops it reading as corduroy.
    float lodG   = lodFade(0.014);
    float groove = (1.0 - smoothstep(0.0, mix(0.014, 0.030, lodG), d)) * (1.0 - lodG * 0.62);

    // Real pools run a contrasting mosaic course at the water line. It used to be
    // drawn by shrinking the lattice; the lattice is shared with the geometry now
    // and cannot move, so the finer course is an extra grout line through the
    // middle of each tile instead.
    float band = smoothstep(0.20, 0.14, abs(p.y - wy));
    groove = max(groove, band * (1.0 - smoothstep(0.0, 0.016,
                                   min(abs(f.x), abs(f.y)) * size)));

    float dec  = decay();
    vec2  cell = floor(g);
    float id   = hash21(cell + salt);

    float hair, spall; vec2 cg;
    crackAt(cell + salt, f, id, dec, hair, spall, cg);

    // The crack cuts the surface as well as marking it. Same form as the grout
    // perturbation above and about as cheap.
    nOut = normalize(n - (tu * sign(f.x) + tv * sign(f.y)) * groove * 0.5
                       - (tu * cg.x + tv * cg.y) * hair * 0.35);

    // The per-tile shade variation is a lattice too, and the first thing to turn
    // into a shimmer. Half a tile per pixel is where it stops being detail.
    alb = vec3(0.86, 0.89, 0.87) * (0.93 + 0.13 * mix(id, 0.5, lodFade(size * 0.5)));
    alb = mix(alb, vec3(0.30, 0.36, 0.34), band * 0.55);          // the mosaic course

    // A tile standing proud of the wall. The relief itself is geometry; this is
    // only the dirt line that a tile with a lifted edge collects around it, and
    // it uses tileBreak's hash so it lands on the tiles that actually moved.
    float pr = hash21(cell + salt + 41.3);
    float up = step(pr, 0.02 + dec * 0.18);
    alb *= 1.0 - up * 0.18 * smoothstep(0.30, 0.50, max(abs(f.x), abs(f.y)));

    // Whole courses gone, on a lattice four times coarser than the tiles
    // themselves, reusing the same hash rather than paying for a second field.
    // The most destructive of the stages, so it is the last to arrive: below half
    // decay the wall is damaged, not demolished.
    float patch = step(0.92 - dec * 0.34, hash21(floor(g * 0.25) + 3.7))
                * smoothstep(0.42, 0.60, dec);
    vec3  conc  = vec3(0.38, 0.39, 0.37) * (0.86 + 0.28 * hash21(cell * 2.3));
    alb = mix(alb, conc, max(spall * 0.85, patch * 0.75));

    hair *= 1.0 - lodFade(0.004);
    spall = mix(spall, 0.18, lodFade(size * 0.5));

    float mildew = groove * (0.35 + 0.65 * band) * grime;
    alb = mix(alb, vec3(0.30, 0.36, 0.28), mildew * 0.75);
    alb *= mix(1.0, 0.6, groove);                                  // grout is darker
    alb *= 1.0 - hair * 0.55;                                      // and the cracks darker still

    // Splash zone: wet tile above the line is darker and much glossier.
    float wet = exp(-max(p.y - wy, 0.0) * 2.5);

    // Water finding its way out of the cracks and running down the wall. Fed into
    // the wet term rather than painted on, so the roughness term below makes the
    // seep glossy for free, which is the whole read.
    float seep = hair * (1.0 - abs(n.y)) * smoothstep(0.18, 0.45, dec);
    wet = max(wet, seep);

    alb  *= mix(1.0, 0.72, wet);
    rough = mix(0.32, 0.06, wet);

    // Scum line: a dirty ring exactly at the water level.
    alb *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.y - wy)) * grime;

    // Late on, the breaks stop being dark and start giving off light. Only some
    // of them and not equally: a constant emission on every crack reads as a neon
    // wireframe laid over the wall rather than as something behind it showing
    // through. The per-tile hash is already computed, so the variation is free.
    float lit = smoothstep(0.55, 0.95, fract(id * 7.77));
    crackGlow = hair * lit * smoothstep(0.20, 0.62, dec);
  }

  // What the light coming out of a hole lands on: the wall around it.
  //
  // The emission inside a recess alone cannot read as a source, because a source
  // is only ever recognised by what it lights. This walks the eight neighbouring
  // tiles, asks each the same question tileBreak asks -- is this one missing --
  // and accumulates a smooth falloff from the ones that are. Nine hashes, once
  // per PIXEL, not once per march step; the same nine in the map would be
  // unaffordable and this is why the geometry and the shading each ask the
  // question in the place that suits them.
  float holeSpill(vec2 uv, float size, float salt, float dec) {
    vec2  g   = uv / size;
    vec2  c0  = floor(g);
    float thr = 0.004 + dec * 0.16;
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2  c = c0 + vec2(float(i), float(j));
        if (hash21(c + salt) >= thr) continue;
        float r = length(g - (c + 0.5)) * size;
        acc += exp(-r * 3.4);
      }
    }
    return acc;
  }

  // Anything that is not the building. The same if-chain shape as the fittings
  // themselves, because it has to answer in the same order they were built in.
  void propSurface(vec3 qs, float mat, float dec, out vec3 alb, out float rough) {
    float n1 = hash21(floor(qs.xz * 7.0) + floor(qs.y * 7.0));
    if (mat < 1.5) {
      // Lane rope floats: red, white and blue in RUNS. The run is what makes a
      // line of spheres read as a lane rope instead of as beads on a string.
      float k = fract(floor(qs.z / 1.35) * 0.37 + floor(qs.x) * 0.11);
      alb = k < 0.34 ? vec3(0.58, 0.09, 0.07)
          : (k < 0.67 ? vec3(0.82, 0.83, 0.82) : vec3(0.09, 0.20, 0.52));
      // Each float is moulded with ribs, and they are all slightly sun-bleached
      // by a different amount.
      float rib = 0.82 + 0.18 * abs(sin(qs.z * 52.0));
      alb  *= rib * (0.80 + 0.35 * hash21(vec2(floor(qs.z / 0.36), 3.0)));
      alb   = mix(alb, vec3(0.20, 0.26, 0.16), smoothstep(0.25, 0.85, dec) * 0.45);
      rough = 0.30;
    }
    else if (mat < 2.5) {
      // Galvanised steel, going over to rust as the laps pile up.
      alb   = mix(vec3(0.42, 0.44, 0.46), vec3(0.36, 0.16, 0.07),
                  smoothstep(0.08, 0.70, dec) * (0.35 + 0.65 * n1));
      rough = 0.20;
    }
    else if (mat < 3.5) {
      // Municipal enamel. There is precisely one colour this is ever painted.
      alb   = vec3(0.29, 0.41, 0.35) * (0.78 + 0.42 * n1);
      alb   = mix(alb, vec3(0.30, 0.14, 0.07), smoothstep(0.3, 0.9, dec) * n1 * 0.5);
      rough = 0.28;
    }
    else if (mat < 4.5) {
      // Green. Dark, matte, and the only hue in the building that is not either
      // fluorescent white or rust. Kept genuinely dark: a lamp two metres away in
      // a service corridor puts 2.4x on this, and anything brighter comes back as
      // moulded plastic rather than as something growing.
      alb   = vec3(0.045, 0.098, 0.042) * (0.55 + 0.95 * n1);
      rough = 0.80;
    }
    else {
      alb   = vec3(0.40, 0.40, 0.38) * (0.85 + 0.30 * n1);
      rough = 0.74;
    }
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

  // Fish. Impostors in the in-scatter beside motes(): a body that is an ellipse
  // in the ray's own lattice, a tail that beats, and a drift across the beam so
  // the shoal crosses it rather than hanging in it. Shading only, which is the
  // only reason a shoal is affordable at all -- one evaluation per PIXEL instead
  // of one per march step, in a map() that has no room left in it.
  vec3 shoal(vec3 rd, float tMax, float lit) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float dz = 3.0 + fi * 5.0;
      if (dz > tMax) break;

      // The lattice scale is what sets apparent SIZE, and getting it wrong does
      // not read as "big fish", it reads as a flying saucer: at 2.4 a body was
      // most of a cell across and a shoal was a row of dinner plates. At 9 and up
      // they are hand-sized at three metres, which is what they should be.
      float sw = iTime * (0.13 + fi * 0.04);
      vec2  g  = rd.xy / max(abs(rd.z), 0.25) * (9.0 + fi * 5.0)
               + vec2(sw, sin(sw * 1.7) * 0.10 + fi * 7.3);
      vec2  c  = floor(g);
      float rn = hash21(c + fi * 13.0);
      if (rn < 0.86) continue;

      vec2 f = fract(g) - 0.5;
      f.y += sin(iTime * 1.9 + rn * 31.0) * 0.06;
      f.x *= rn > 0.93 ? -1.0 : 1.0;          // half of them are facing the other way

      // Body and tail as two ellipses, four to one along the swim direction. The
      // tail beats about its own root, which is what separates a fish from a
      // grain of rice.
      float body = length(vec2(f.x * 0.85, f.y * 3.4)) - 0.100;
      float tail = length(vec2((f.x + 0.105) * 2.6,
                               (f.y - sin(iTime * 8.0 + rn * 20.0) * 0.030) * 5.0)) - 0.048;
      float m = smoothstep(0.030, 0.004, min(body, tail));

      // Silhouettes, not lamps. They are BETWEEN you and the far wall, so they
      // are dark against it and only just catch the light.
      acc += vec3(0.30, 0.40, 0.38) * m * lit / (1.0 + dz * 0.55);
    }
    return acc;
  }

  // Lamp halos, added whether or not the ray hit anything. This is what replaces
  // a bloom post pass -- there is no FBO in a single-pass journey.
  //
  // Over ALL THREE resident slots, and that is the fix rather than the flourish.
  // This was the last thing in the file still hard-wired to uSecB[1]/uSecC[1] --
  // the section the camera happens to be in -- while being swept along a ray that
  // goes wherever you are looking. Every quantity it uses is per-section: the
  // lamp pitch sets which bands exist, the ceiling height sets how high they
  // hang, and the frame sets which way the row runs. So the instant idx advanced
  // and the slot window rotated, every halo on screen was recomputed against a
  // different room's pitch in a different room's frame and jumped somewhere else
  // -- an overlay moving on a section change, with nothing in the picture behind
  // it moving at all. resolveSlot fixed this for surfaces a while ago; the halos
  // are the same rule and they were simply missed.
  //
  // Nine iterations of about ten instructions, once per PIXEL. The march is
  // ninety-six steps against three slots and does not go near this.
  vec3 lampGlow(vec3 ro, vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec4  B  = uSecB[i];
      vec4  C  = uSecC[i];
      vec3  o  = toLocal(ro, uSecA[i], B.x);
      vec3  r  = dirToLocal(rd, uSecA[i]);
      float sp = max(C.w, 2.0);
      float band = floor(o.z / sp);

      for (int k = 0; k < 3; k++) {
        float bi = band - 1.0 + float(k);

        // Only lamps this section actually has. Without this, a corridor's lamp
        // row carries on into the rock beyond both its ends and lights the room
        // next door through a solid wall.
        float lz = (bi + 0.5) * sp;
        if (lz < -1.0 || lz > B.w + 1.0) continue;

        float on = lampAlive(bi, C);
        if (on < 0.01) continue;

        vec3  lp   = vec3(0.0, B.z - 0.12, lz);
        vec3  v    = lp - o;
        float proj = clamp(dot(v, r), 0.0, tMax);
        float dist = length(v - r * proj);
        acc += vec3(0.85, 0.92, 1.0) * on * 0.05 / (1.0 + dist * dist * 2.2);
      }
    }
    return acc;
  }
`

// Camera, march, water split and the inline post chain.
const SCENE = `
  vec3 shadeFace(vec3 p, vec3 n, vec3 rd) {
    vec4 A, B, C, A2, B2, C2; vec3 q; float w;
    resolveSlot(p, A, B, C, A2, B2, C2, q, w);

    // Into the owning room's coordinates: the point, the normal and the view ray
    // together. Carrying only some of them across is worse than carrying none,
    // because then the errors stop being a uniform offset.
    vec3 nq  = dirToLocal(n, A);
    vec3 rdq = dirToLocal(rd, A);

    // ...and then into the SHEARED frame, which is the one the geometry was
    // actually built in. On the two ramped sections that is the difference
    // between tile that follows the floor and tile that slides underneath it;
    // everywhere else the shear is zero and the two frames are identical. The
    // flood is flat in world so it picks up the same shear on the way in, and the
    // normal picks up the inverse transpose, which for a shear is one subtract.
    float zc  = clamp(q.z, 0.0, B.w);
    vec3  qs  = vec3(q.x, q.y + C.x * zc, q.z);
    vec3  ns  = normalize(vec3(nq.x, nq.y, nq.z - C.x * nq.y));
    float wy  = waterYIn(B) + C.x * zc;
    float dec = decay();

    vec3 alb, nn; float rough;
    tileSurface(qs, ns, wy, C.z, alb, nn, rough);

    // Was it the building, or something standing in it? One extra evaluation of
    // the fittings, at the hit point only. The march never reads gMat, so the
    // material costs a pixel rather than ninety-six steps -- and re-deriving it
    // from the geometry instead would mean writing every fitting out twice.
    float pd = sectionProps(qs, B, C, uSecD[1]);
    if (pd < 0.035 && gMat > 0.5) {
      propSurface(qs, gMat, dec, alb, rough);
      nn = ns;
      crackGlow = 0.0;
    }

    vec3 c = stripLight(qs, nn, alb, rough, rdq, B, C);

    // In the throat of a doorway, light the surface as both rooms and mix. The
    // tile frame is NOT mixed -- coordinates from two rigid frames average into a
    // point in neither, and the grid would ghost -- but light is just a number,
    // and crossing it over is what stops the threshold reading as a line ruled
    // across the floor.
    if (w > 0.004) {
      vec3  q2  = toLocal(p, A2, B2.x);
      float zc2 = clamp(q2.z, 0.0, B2.w);
      vec3  qs2 = vec3(q2.x, q2.y + C2.x * zc2, q2.z);
      c = mix(c, stripLight(qs2, dirToLocal(n, A2), alb, rough, dirToLocal(rd, A2), B2, C2), w);
    }

    c += alb * 0.06;

    // Caustics stay in WORLD on purpose. The water is one flat plane through the
    // entire building and depth below it is the only quantity that has to be
    // right; projecting the pattern in each room's own frame would make it swim
    // sideways every time you crossed a join.
    if (p.y < waterY()) c += alb * causticAt(p) * 0.9;
    if (ns.y < -0.6) c += vec3(0.95, 0.99, 1.0) * ceilPanel(qs, B, C) * 3.2;

    // INSIDE A BREAK IN THE SHELL: past the nominal face plane, in the recess a
    // missing tile left behind. Whatever is behind this building is lit, and it
    // is not lit white. This is what the red rays come out of -- the surface half
    // of it; crackShafts does the air.
    // Depth first. What you see through a missing tile is a dark hole; the red
    // is what is at the BACK of it, so it falls off with how far in the surface
    // you are looking at actually is. Emitting a flat value over the whole recess
    // was the difference between a lit break and a red sticker.
    // A hole is DARK first. Almost all of what you can see of one is its own
    // unlit side walls, and only the very back of it is the source -- so the two
    // ramps are deliberately disjoint, the shadow reaching full a centimetre in
    // and the emission not starting until the far end. Overlapping them lit the
    // whole recess evenly, and a recess lit evenly across its whole depth is not
    // a hole, it is a red tile: flat, frontal and exactly tile-shaped, which is
    // precisely what it looked like.
    float face  = min(min(B.y - abs(qs.x), qs.y), B.z - qs.y);
    c *= 1.0 - 0.94 * smoothstep(-0.005, -0.055, face);
    c += vec3(1.00, 0.09, 0.02) * smoothstep(-0.155, -0.225, face) * (0.35 + 2.6 * dec);

    // ...and what it falls on. Suppressed inside the recess itself, where the
    // neighbours are on the other side of a wall and the surface is already the
    // source rather than something the source is lighting.
    if (face > -0.02 && dec > 0.12) {
      vec2  suv; float ssz, ssl;
      if (abs(ns.y) > 0.7)      { suv = qs.xz; ssz = TILE_F; ssl = ns.y > 0.0 ? SALT_FLR : SALT_CEIL; }
      else if (abs(ns.x) > 0.7) { suv = qs.zy; ssz = TILE_W; ssl = SALT_WALL; }
      else                      { suv = qs.xy; ssz = TILE_W; ssl = 5.5; }
      c += vec3(1.00, 0.13, 0.04) * holeSpill(suv, ssz, ssl, dec)
         * smoothstep(0.12, 0.55, dec) * 0.22 * (1.0 - lodFade(ssz * 0.5));
    }

    // ...and the same oxblood out of the hairlines, once they are deep enough to
    // have reached anything. Same tint foundry rots its grade toward, and the
    // only warm thing in a building lit entirely by dying fluorescents.
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
        vec3  q  = p + r * rt;
        // The reflected ray has travelled to the water and then on again, and the
        // tile it lands on is that far away however near the surface is.
        float keep = gDist;
        gDist = keep + rt;
        vec3 sc = shadeFace(q, calcNormal(q, rt), r);
        gDist = keep;
        return mix(HAZE, sc, exp(-rt * 0.035));
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
  vec3 crackShafts(vec3 ro, vec3 rd, float tMax) {
    float dec = decay();
    if (dec < 0.12) return vec3(0.0);

    // Six taps along the primary ray, hugging whatever surface is nearest.
    //
    // This deliberately does NOT ask the tile lattice where the holes are, and
    // that is the whole design note. It did, and the result was not shafts: the
    // last tap of every ray landed in the same tile cell as its neighbours, the
    // per-cell answer is constant across a tile face, and what appeared on screen
    // was a flat tile-shaped red rectangle -- a quantised field projected through
    // a pinhole draws the quantisation, not the light. A volumetric term has to
    // be continuous in space or it will draw its own lattice.
    //
    // So: a smooth field, gated on proximity to concrete, which is where the
    // holes are and where the glow belongs. The surface half of the effect knows
    // about individual holes; the air half only has to know it is near a wall.
    float acc = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3  sp   = ro + rd * (tMax * (float(k) + 0.35) / 6.0);
      float prox = exp(-max(mapScene(sp), 0.0) * 1.9);
      float v    = sin(sp.x * 2.3 + cos(sp.z * 1.7) * 1.4)
                 * cos(sp.z * 2.1 + sin(sp.y * 1.9) * 1.2);
      acc += smoothstep(0.25, 0.95, abs(v)) * prox;
    }
    return vec3(1.00, 0.15, 0.05) * acc * (1.0 / 6.0) * (0.10 + 0.55 * dec);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float yaw   = uCam.w - uPointer.x * 0.45; // right = cross(fwd, Y): negative yaw turns toward the pointer
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
    gDist = 0.0;
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
      gDist = t;
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
        under = mix(deepCol, under, exp(-max(t - tW, 0.0) * 0.40));
        under += vec3(0.35, 0.62, 0.68) * causticAt(wp) * 0.25;
        under += shoal(rd, max(t - tW, 0.0), 0.55);

        vec3 rr   = reflect(rd, wn);
        vec3 refl = reflectShade(wp, rr);

        // Schlick: near-mirror at the far end of the pool, glassy underfoot.
        float cosT = clamp(dot(wn, -rd), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        // Scum dulls the reflection where it sits, which is what makes the rest
        // of the surface read as water. It must stay LIGHTER than the water it
        // floats on -- a dark film reads as a hole in the pool, not as a skin on
        // it, and that is exactly how it read at first: a black amoeba lying flat
        // across THE SHALLOW END with a hard edge.
        float film = surfaceFilm(wp.xz, decay());
        fres *= 1.0 - film * 0.55;

        col = mix(under, refl, fres);
        col = mix(col, vec3(0.19, 0.22, 0.17) * (0.55 + causticAt(wp) * 0.55), film * 0.45);
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
      col += shoal(rd, tEnd, 1.0);

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

    col += lampGlow(ro, rd, tEnd) * (camWet ? 0.55 : 1.0);

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
