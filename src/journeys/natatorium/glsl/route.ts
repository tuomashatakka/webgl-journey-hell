export const routeGlsl = `  // --- the route ------------------------------------------------------------

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

`
