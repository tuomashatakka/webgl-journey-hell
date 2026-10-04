export const fittingsGlsl = `  // --- the fittings ---------------------------------------------------------
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

`
