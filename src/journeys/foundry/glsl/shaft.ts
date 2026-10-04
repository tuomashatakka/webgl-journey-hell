export const shaftGlsl = `  // ========================== THE HOIST SHAFT ==============================
  // The shaft rises 128 m above the landing at the head of the loading bay. Its
  // interior is *unioned* with the hall's — max() of two positive-inside fields
  // — which is what opens the ceiling without any explicit boolean geometry.

  float shaftInterior(vec3 p, float dz) {
    return min(SHAFT_R - max(abs(p.x), abs(dz)),
               min(p.y - PIT_Y, uFall.z - p.y));
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

  // ====================== THE STEPPING STONES ==============================
  // The furnace floor is cut away over the melt, and the only way across is a
  // single steel plate that lays itself out ahead of you.
  //
  // It is *one* plate. Tile i is not a separate object: it is tile (i-1) rotated
  // a half turn about the edge the two of them share, so the thing tumbles end
  // over end across the gap and the tile under your boots is the hinge for the
  // next one. f = 0 has it stowed flat on its predecessor, f = 0.5 standing
  // vertical, f = 1 landed. The fold coordinate is a damped hinge integrated on
  // the CPU (physics.ts), so it overshoots and settles instead of easing, and it
  // rings when a boot lands on it.
  //
  // The route turns by flipping about a *side* edge rather than the leading one,
  // which is the whole reason the crossing can go left and right at all — and
  // why every step is exactly one tile wide.

  /** Fold coordinate of span tile 'i', unpacked from the four vec4 slots. */
  float foldAt(int i) {
    if (i < 4) {
      if (i == 0) return uFold0.x;
      if (i == 1) return uFold0.y;
      if (i == 2) return uFold0.z;
      return uFold0.w;
    }
    if (i < 8) {
      if (i == 4) return uFold1.x;
      if (i == 5) return uFold1.y;
      if (i == 6) return uFold1.z;
      return uFold1.w;
    }
    if (i < 12) {
      if (i == 8) return uFold2.x;
      if (i == 9) return uFold2.y;
      if (i == 10) return uFold2.z;
      return uFold2.w;
    }
    if (i == 12) return uFold3.x;
    if (i == 13) return uFold3.y;
    if (i == 14) return uFold3.z;
    return uFold3.w;
  }

  /**
   * Grid coordinate of tile 'i', in steps of TILE. Identical literals to
   * SPAN_IX / SPAN_IZ in physics.ts — the walker follows a spline through these
   * exact points, so a disagreement here is a walk into the melt.
   */
  vec2 tileGrid(int i) {
    if (i < 8) {
      if (i <= 0) return vec2( 0.0, 0.0);
      if (i == 1) return vec2( 0.0, 1.0);
      if (i == 2) return vec2( 0.0, 2.0);
      if (i == 3) return vec2(-1.0, 2.0);
      if (i == 4) return vec2(-2.0, 2.0);
      if (i == 5) return vec2(-2.0, 3.0);
      if (i == 6) return vec2(-2.0, 4.0);
      return vec2(-1.0, 4.0);
    }
    if (i == 8) return vec2( 0.0, 4.0);
    if (i == 9) return vec2( 1.0, 4.0);
    if (i == 10) return vec2( 2.0, 4.0);
    if (i == 11) return vec2( 2.0, 5.0);
    if (i == 12) return vec2( 2.0, 6.0);
    if (i == 13) return vec2( 2.0, 7.0);
    if (i == 14) return vec2( 2.0, 8.0);
    return vec2( 2.0, 9.0);
  }

  /** World (x, z) of tile 'i'. */
  vec2 tileAt(int i) {
    vec2 g = tileGrid(i);
    return vec2(g.x * TILE, SPAN_Z0 + g.y * TILE);
  }

  /**
   * Tile 'i', drawn where the flip has actually got it to.
   *
   * The hinge is the shared edge — the midpoint of the two centres — and the
   * rotation runs in the plane containing the step direction and Y. One box, not
   * six: at f = 1 the (u, y) frame is unrotated and the plate lies in its own
   * place, at f = 0 it has swung a full PI and is lying on its predecessor.
   */
  float mapTile(vec3 q, vec2 stepDir, float f) {
    // Sample relative to the hinge, which is half a step back along the arrival
    // direction — i.e. exactly the edge tile (i-1) is on the other side of.
    vec2 rel = vec2(q.x, q.z) + stepDir * TILE_H;
    float u = dot(rel, stepDir);
    float w = dot(rel, vec2(-stepDir.y, stepDir.x));

    vec2 r = rot((1.0 - f) * PI) * vec2(u, q.y);
    // Plate, plus a stiffening rib down its underside so the silhouette reads as
    // a machined deck rather than as a sheet of paper when it stands vertical.
    float plate = sdBox(vec3(r.x - TILE_H, r.y, w), vec3(TILE_H, PLATE_T, TILE_H));
    float rib = sdBox(vec3(r.x - TILE_H, r.y + PLATE_T * 2.4, w),
                      vec3(TILE_H * 0.82, PLATE_T * 1.7, PLATE_T * 2.0));
    return min(plate, rib);
  }


  /**
   * The sixteen tiles. Each is rejected against a cheap bound first, so a ray
   * pays for the two or three that are actually near it — and because a tile is
   * one box rather than a six-panel cube, sixteen of these cost less than the
   * eight cubes they replace.
   */
  float mapSpan(vec3 p, float zc) {
    float d = 1e9;
    // Tile 0 arrives along the walk, off the lip of the hall plate.
    vec2 prev = tileAt(0) - vec2(0.0, TILE);
    for (int i = 0; i < 16; i++) {
      vec2 c = tileAt(i);
      vec3 q = vec3(p.x - c.x, p.y, cycd(zc - c.y));
      // A flipped tile sweeps a half-disc of radius 2·TILE_H about its hinge.
      float bound = length(q) - TILE_H * 2.7;
      if (bound < 0.4) d = min(d, mapTile(q, normalize(c - prev), foldAt(i)));
      else d = min(d, bound);
      prev = c;
    }
    return d;
  }

`
