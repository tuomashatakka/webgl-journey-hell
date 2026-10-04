// The things in the world, in canonical space (after unbend). Each structure
// writes its candidate material (cMat, cInfo, and for facades cBoxC/cBoxH);
// the scene map keeps the nearest.
//
// Set pieces live in z bands. Outside its band a set piece returns the distance
// to the band plus a margin no part of it comes closer than — a bound that is
// never a surface, so a ray crossing the band edge cannot "hit" the edge.
//
// cInfo.x on glass says what kind: 1 deck pane, 2 balustrade, 3 panelled glass
// (hall, spokes, spans, canopy), 4 the hall's floor, 5 the snapped catwalk.
// On facades it is the style: 0 generic, 1 the curtain wall, 2 the station,
// 3 the canyon, 4 the helix tower.

export const structuresGlsl = /* glsl */`
  // --- the deck ----------------------------------------------------------------
  /** Balustrades at lap z: x left on, y right on, z height. */
  vec3 railsAt(float zl) {
    vec3 r = vec3(1.0, 1.0, 1.1);
    if (zl > 181.0 && zl < 236.0) r.xy = vec2(0.0);   // the wire: a cable, and nothing
    if (zl > 82.0 && zl < 98.0) r.xy = vec2(0.0);     // inside the hall
    if (zl > 360.0 && zl < 420.0) r.xy = vec2(0.0);   // inside the tube
    if (zl > 420.0 && zl < 480.0) r.y = 0.0;          // the helix: the tower is the right-hand wall
    if (zl > 484.0 && zl < 536.0) r.z = 0.95;
    return r;
  }

  /** A skeleton segment's fall: x = seconds falling, y = drop (m), z = tip (rad). */
  vec3 segmentFall(float segZ) {
    float seed = hash21(vec2(floor(segZ / SEG), 7.3));
    float tau = max(gZ - segZ - 16.0 - seed * 14.0, 0.0) / SPEED;
    return vec3(tau, 0.5 * GRAV * tau * tau, min(tau * (0.4 + seed * 0.5), 1.3) * (seed < 0.5 ? -1.0 : 1.0));
  }

  /** Frame, stringers, cross beams and balustrades, in a segment's frame (y from the deck top). */
  float deckSkeleton(vec3 s, float hw, vec3 rails) {
    float bx = abs(fract(s.x / PANE_W) - 0.5) * PANE_W;
    float bz = abs(fract(s.z / PANE_L + 0.5) - 0.5) * PANE_L;
    float edge = abs(abs(s.x) - hw);
    float frame = max(min(min(bx, bz), edge) - 0.03, max(abs(s.y + 0.08) - 0.085, abs(s.x) - hw - 0.03));
    float str = sdBox(vec3(abs(s.x) - max(hw - 0.35, 0.2), s.y + 0.4, s.z), vec3(0.07, 0.22, SEG * 0.5));
    float beam = sdBox(vec3(s.x, s.y + 0.25, abs(fract(s.z / 3.0 + 0.5) - 0.5) * 3.0), vec3(hw, 0.07, 0.06));
    float d = min(frame, min(str, beam));
    cMat = M_STEEL; cInfo = vec4(0.0);
    if ((s.x < 0.0 ? rails.x : rails.y) > 0.5) {
      float ax = abs(s.x) - hw + 0.04;
      float h = rails.z;
      float metal = min(sdBox(vec3(ax, s.y - h, s.z), vec3(0.035, 0.028, SEG * 0.5)),
        min(sdBox(vec3(ax, s.y - h * 0.5, bz), vec3(0.03, h * 0.5, 0.025)), sdBox(vec3(ax, s.y - 0.05, s.z), vec3(0.045, 0.05, SEG * 0.5))));
      d = min(d, metal);
      float glass = sdBox(vec3(ax, s.y - h * 0.5 - 0.06, s.z), vec3(0.012, h * 0.5 - 0.06, SEG * 0.5));
      if (glass < d) { d = glass; cMat = M_GLASS; cInfo = vec4(2.0, s.x < 0.0 ? -1.0 : 1.0, 0.0, 0.0); }
    }
    return d;
  }

  /** One half of a broken pane: the pane cut by a line, dropping and tumbling on its own. */
  float paneHalf(vec3 lp, vec3 hs, float tau, float side, vec2 cutN, float seed) {
    vec3 piv = vec3(side * cutN.x * hs.x * 0.5, 0.0, side * cutN.y * hs.z * 0.5);
    vec3 q = lp - piv - vec3(side * tau * 0.15, -0.5 * GRAV * tau * tau, tau * (seed - 0.5) * 0.2);
    q.xy = rot(side * tau * (1.0 + seed * 2.0)) * q.xy;
    q.yz = rot(tau * (0.7 + seed)) * q.yz;
    q += piv;
    return max(sdBox(q, hs), -side * dot(q.xz, cutN));
  }

  /** The pane under p: whole, or its two halves on the way down. */
  float deckPanes(vec3 p, float top, float hw) {
    float ix = floor(p.x / PANE_W + 0.5);
    float iz = floor(p.z / PANE_L);
    float cx = ix * PANE_W, cz = (iz + 0.5) * PANE_L;
    float x0 = max(cx - PANE_W * 0.5, -hw), x1 = min(cx + PANE_W * 0.5, hw);
    if (x1 <= x0) return max(abs(p.x) - hw, 0.0) + 0.02;
    vec4 fate = deckPane(ix, iz, cz);
    vec3 hs = vec3((x1 - x0) * 0.5 - 0.012, 0.06, PANE_L * 0.5 - 0.012);
    vec3 lp = p - vec3((x0 + x1) * 0.5, top - 0.075, cz);
    float tau = iTime - fate.y;
    float d;
    if (tau <= 0.0) d = sdBox(lp, hs);
    else {
      float a = hash21(vec2(iz, ix + 4.0)) * PI;
      vec2 cutN = vec2(cos(a), sin(a));
      d = min(paneHalf(lp, hs, tau, 1.0, cutN, fract(a * 3.1)), paneHalf(lp, hs, tau * 1.08 + 0.05, -1.0, cutN, fract(a * 7.3)));
    }
    // Behind the runner panes are gone or going: never step past this cell's edge.
    if (p.z < gZ + 2.0) {
      vec2 cb = vec2(PANE_W, PANE_L) * 0.5 - abs(vec2(p.x - cx, p.z - cz));
      float bound = max(min(cb.x, cb.y), 0.0);
      if (p.y > top) bound = max(bound, p.y - top);
      d = min(d, bound + 0.12);
    }
    cInfo = vec4(1.0, ix, iz, max(tau, 0.0));
    return d;
  }

  /** Where the deck is missing, how far it is to either edge of the gap (x, y and z all bound it). */
  float gapBound(vec3 p, float zl) {
    float ax = abs(p.x) - 1.8;
    if (zl < 236.0) return max(min(max(zl - 225.0, abs(p.y - 10.5) - 2.0), max(236.0 - zl, abs(p.y - 0.5) - 2.0)), ax);
    return max(min(max(zl - 248.0, abs(p.y - 0.5) - 2.0), max(300.0 - zl, abs(p.y + 25.6) - 8.0)), ax);
  }

  float mapDeck(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float top = deckTop(p.z);
    if (top > 9000.0) return max(gapBound(p, zl), 0.05);
    float hw = deckHalfW(zl);
    // Far from the deck, a bound. Behind the runner the deck is falling, so not below it.
    float behind = p.z < gZ - 1.0 ? 1.0 : 0.0;
    float bound = max(abs(p.x) - hw - 0.6 - behind * 1.5, p.y - top - 1.6);
    if (behind < 0.5) bound = max(bound, top - 1.0 - p.y);
    if (bound > 0.4) return bound;

    // Ramps: the vertical distance overstates the real one by the slope.
    float slope = (deckTop(p.z + 0.25) - deckTop(p.z - 0.25)) * 2.0;
    float k = 1.0 / sqrt(1.0 + min(slope * slope, 64.0));

    float segZ = (floor(p.z / SEG) + 0.5) * SEG;
    vec3 fall = segmentFall(segZ);
    vec3 s = p - vec3(0.0, top, segZ);
    if (fall.x > 0.0) {
      s.y += fall.y;
      s.yz = rot(fall.z) * s.yz;
    }
    float d = deckSkeleton(s, hw, railsAt(zl));
    if (fall.x > 0.0 && p.y < top - 0.5) d = min(d, SEG * 0.5 - abs(p.z - segZ) + 0.2);
    float m = cMat;
    vec4 inf = cInfo;
    float dp = deckPanes(p, top, hw);
    if (dp < d) { d = dp; m = M_GLASS; inf = cInfo; }
    cMat = m; cInfo = inf;
    return d * k;
  }

  // --- 2 the interchange: a glass hall where the spans meet --------------------
  float mapNode(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(72.0 - zl, zl - 118.0);
    if (bz > 0.0) return bz + 10.0;
    vec3 q = vec3(p.x, p.y, zl - 90.0);
    float r = length(q.xz);
    vec2 s1 = turnXZ(q.xz, -1.2217), s2 = turnXZ(q.xz, 1.2217);

    // The spokes: spans leaving the hall at +-70 degrees, ending in the air.
    float d = 1e5;
    for (int i = 0; i < 2; i++) {
      vec2 s = i == 0 ? s1 : s2;
      d = min(d, min(sdBox(vec3(s.x, q.y + 0.08, s.y - 28.0), vec3(1.5, 0.08, 20.0)),
        sdBox(vec3(abs(s.x) - 1.46, q.y - 0.55, s.y - 28.0), vec3(0.015, 0.5, 20.0))));
    }
    cMat = M_GLASS; cInfo = vec4(3.0, 0.0, 0.0, 0.0);
    float bound = max(r - 9.5, max(q.y - 9.5, -0.6 - q.y));
    if (bound > 0.5) return min(d, bound);

    float flo = max(r - 8.0, abs(q.y + 0.08) - 0.08);
    float doors = max(min(abs(q.x) - 1.75, min(max(abs(s1.x) - 1.65, -s1.y), max(abs(s2.x) - 1.65, -s2.y))), q.y - 3.2);
    float drum = max(max(abs(r - 8.0) - 0.03, max(-q.y, q.y - 5.0)), -doors);
    float ang = atan(q.x, q.z);
    float ar = (fract(ang / (PI / 12.0) + 0.5) - 0.5) * (PI / 12.0);
    float ribs = max(max(max(abs(r * sin(ar)) - 0.05, abs(r * cos(ar) - 8.0) - 0.07), max(-q.y, q.y - 5.1)), -doors);
    float rings = min(length(vec2(r - 8.0, q.y - 5.1)) - 0.12, length(vec2(r - 8.0, q.y + 0.02)) - 0.09);
    float sph = length(q + vec3(0.0, 1.0, 0.0)) - 10.0;   // the dome: meets the drum at r 8, y 5
    float dome = max(abs(sph) - 0.03, 5.0 - q.y);
    float ar2 = (fract(ang / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0);
    float mer = max(max(abs(sph) - 0.08, abs(r * sin(ar2)) - 0.06), 5.0 - q.y);

    float glass = min(drum, dome);
    if (flo < d) { d = flo; cInfo = vec4(4.0, 0.0, 0.0, 0.0); }
    if (glass < d) { d = glass; cInfo = vec4(3.0, 0.0, 0.0, 0.0); }
    float steel = min(ribs, min(rings, mer));
    if (steel < d) { d = steel; cMat = M_STEEL; cInfo = vec4(0.0); }
    return d;
  }

  /** A glass span crossing the route; the panes over it drop out just before the runner arrives. */
  float crossSpan(vec3 p, float zl, float cz, float hy, float yaw, float id) {
    vec3 q = vec3(p.x, p.y - hy, zl - cz);
    q.xz = turnXZ(q.xz, -yaw);
    float iz = floor(q.z / PANE_L);
    float lz = (iz + 0.5) * PANE_L;
    float h = hash21(vec2(iz, id));
    float tau = abs(q.z) < 14.0 ? iTime - ((p.z - zl + cz) / SPEED - 2.6 + abs(q.z) * 0.07 + h * 1.4) : -1.0;
    vec3 c = q - vec3(0.0, 0.0, lz);
    if (tau > 0.0) {
      c.y += 0.5 * GRAV * tau * tau;
      c.xy = rot(tau * (h - 0.5) * 3.0) * c.xy;
    }
    float pane = sdBox(c, vec3(1.5, 0.08, PANE_L * 0.5 - 0.01));
    // Falling panes stay under the span and over its width: only there can a neighbour be nearer.
    if (abs(q.z) < 16.0) pane = min(pane, max(PANE_L * 0.5 - abs(q.z - lz), max(q.y - 0.15, abs(q.x) - 2.0)) + 0.15);
    pane = max(pane, abs(q.z) - 40.0);
    float rail = sdBox(vec3(abs(q.x) - 1.47, q.y - 0.55, q.z), vec3(0.015, 0.5, 40.0));
    float beam = sdBox(vec3(abs(q.x) - 1.1, q.y + 0.35, q.z), vec3(0.08, 0.22, 40.0));
    cMat = M_GLASS; cInfo = vec4(3.0, 0.0, 0.0, 0.0);
    float glass = min(pane, rail);
    if (beam < glass) { cMat = M_STEEL; cInfo = vec4(0.0); return beam; }
    return glass;
  }

  float mapCrossings(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(25.0 - zl, zl - 135.0);
    if (bz > 0.0) return bz + 7.0;
    float a = crossSpan(p, zl, 66.0, 6.5, 0.6, 1.0);
    float m = cMat; vec4 inf = cInfo;
    float b = crossSpan(p, zl, 112.0, -7.5, 1.9, 2.0);
    if (a < b) { cMat = m; cInfo = inf; return a; }
    return b;
  }

  // --- 3 the curtain wall: a tower's face, and the ramp bolted to it ------------
  float mapFacade(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(100.0 - zl, zl - 202.0);
    if (bz > 0.0) return bz + 4.0;
    vec3 c = vec3(-19.5, -85.0, p.z - zl + 151.0);
    vec3 h = vec3(15.0, 155.0, 47.0);
    float d = sdBox(p - c, h);
    cMat = M_FACADE; cBoxC = c; cBoxH = h; cInfo = vec4(1.0, 0.0, -1.0, 0.0);
    if (zl > 118.0 && zl < 182.0) {
      float top = deckTop(p.z);
      float fz = (fract(zl / 3.0 + 0.5) - 0.5) * 3.0;
      float br = min(sdBox(vec3(p.x + 3.05, p.y - top + 0.45, fz), vec3(1.45, 0.1, 0.07)),
        sdSeg(vec3(p.x, p.y - top, fz), vec3(-4.5, -2.4, 0.0), vec3(-1.7, -0.5, 0.0), 0.06));
      if (br < d) { d = br; cMat = M_STEEL; cInfo = vec4(0.0); }
    }
    return d;
  }

  // --- 4 the wire: a cable-stayed catwalk at crown height -----------------------
  float mapWire(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(176.0 - zl, zl - 236.0);
    if (bz > 0.0) return bz + 4.0;
    vec3 q = vec3(p.x, p.y, zl);
    vec3 m = q - vec3(-7.0, 0.0, 206.0);
    float d = min(sdBox(m - vec3(0.0, -76.0, 0.0), vec3(0.75, 128.0, 0.75)), sdBox(m - vec3(3.6, 9.62, 0.0), vec3(3.7, 0.22, 0.28)));
    vec3 head = vec3(-7.0, 50.0, 206.0);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float zz = fi < 2.5 ? 186.0 + fi * 7.0 : 194.0 + fi * 6.0;
      d = min(d, sdSeg(q, head, vec3(mod(fi, 2.0) < 0.5 ? -0.68 : 0.68, 10.05, zz), 0.07));
    }
    if (zl > 180.0 && zl < 225.0) {
      d = min(d, sdSeg(q, vec3(-0.66, 11.0, 180.0), vec3(-0.66, 11.0, 225.0), 0.022));
      d = min(d, sdBox(vec3(p.x + 0.66, p.y - 10.5, (fract(zl / 3.0 + 0.5) - 0.5) * 3.0), vec3(0.02, 0.5, 0.02)));
    }
    cMat = M_STEEL; cInfo = vec4(0.0);
    // The last six metres: whole until the runner is close, then torn down at the joint.
    float tau = max(iTime - (p.z - zl + 219.0) / SPEED, 0.0);
    vec3 e = q - vec3(0.0, 10.0, 225.0);
    e.yz = rot(min(tau * 2.2, 1.3) + 0.05 * sin(gTm * 1.7) * step(0.6, tau)) * e.yz;
    float hang = sdBox(e - vec3(0.0, -0.08, 3.0), vec3(0.7, 0.08, 3.0));
    if (hang < d) { d = hang; cMat = M_GLASS; cInfo = vec4(5.0, 0.0, 0.0, 0.0); }
    return d;
  }

  // --- 5 the glass line: a viaduct, a train, a station through a tower ----------
  float mapTrain(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(212.0 - zl, zl - 356.0);
    if (bz > 0.0) return bz + 4.0;
    float base = p.z - zl;
    float d = sdBox(vec3(p.x, p.y + 7.15, zl - 259.0), vec3(2.4, 0.55, 29.0));
    float pier = sdBox(vec3(p.x, p.y + 130.0, (fract((zl - 239.0) / 18.0 + 0.5) - 0.5) * 18.0), vec3(1.1, 122.0, 1.1));
    d = min(d, max(pier, max(230.0 - zl, zl - 280.0)));
    cMat = M_CONCRETE; cInfo = vec4(0.0);

    // Five cars, parked under the landing until the runner leaps, then carrying
    // them; the runner rides the front of the middle car. Past the sheared end at
    // 288 each car pitches over and falls.
    float tz = clamp(gZ - base, 248.0, 330.0);
    float cz0 = tz - 4.2;
    float k = clamp(floor((zl - cz0 + 4.8) / 9.6) + 2.0, 0.0, 4.0);
    float cc = cz0 + (k - 2.0) * 9.6;
    vec3 c = vec3(p.x, p.y + 5.05, zl - cc);
    float over = (cc + 4.6 - 288.0) / SPEED;
    if (over > 0.0) {
      c.y += 3.77 * over * over;
      c.yz = rot(min(over * 0.9, 1.3)) * c.yz;
    }
    float car = min(sdBox(c, vec3(1.37, 1.07, 4.47)) - 0.08,
      min(sdBox(c - vec3(0.0, 1.22, 0.0), vec3(0.8, 0.1, 2.6)), sdBox(vec3(c.x, c.y + 1.4, abs(c.z) - 3.0), vec3(1.1, 0.3, 0.9))));
    if (over > -1.0 && abs(zl - cc) < 4.8) car = min(car, max(4.8 - abs(zl - cc), max(abs(p.x) - 3.0, p.y + 2.5)) + 0.2);
    if (car < d) { d = car; cMat = M_TRAIN; cInfo = vec4(c, k); }

    // The station: a tower with a hall cut through it, balconies down both sides.
    vec3 sc = vec3(0.0, -82.5, base + 273.0);
    vec3 sh = vec3(22.0, 157.5, 11.0);
    float st = max(sdBox(p - sc, sh), -sdBox(p - vec3(0.0, -1.5, base + 273.0), vec3(9.0, 10.5, 12.0)));
    if (st < d) { d = st; cMat = M_FACADE; cBoxC = sc; cBoxH = sh; cInfo = vec4(2.0, 0.0, 0.0, 0.0); }
    float by = (fract((p.y + 12.0) / 4.2 + 0.5) - 0.5) * 4.2;
    float slab = max(sdBox(vec3(abs(p.x) - 7.6, by, zl - 273.0), vec3(1.4, 0.14, 11.0)), max(-12.5 - p.y, p.y - 8.5));
    if (slab < d) { d = slab; cMat = M_CONCRETE; cInfo = vec4(0.0); }
    return d;
  }

  // --- 6 the canyon: two towers 14 m apart ---------------------------------------
  float mapCanyon(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(276.0 - zl, zl - 346.0);
    if (bz > 0.0) return bz + 6.0;
    vec3 c = vec3(p.x < 0.0 ? -22.0 : 22.0, -97.5, p.z - zl + 311.0);
    vec3 h = vec3(15.0, 142.5, 29.0);
    cMat = M_FACADE; cBoxC = c; cBoxH = h; cInfo = vec4(3.0, 0.0, 0.0, 0.0);
    return sdBox(p - c, h);
  }

  // --- 7 frost gallery: a glass tube round the deck ------------------------------
  float mapTube(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(356.0 - zl, zl - 424.0);
    if (bz > 0.0) return bz + 6.0;
    vec2 c = vec2(p.x, p.y - deckTop(p.z) - 1.25);
    float r = length(c);
    float ends = max(362.0 - zl, zl - 418.0);
    float shell = max(abs(r - 2.6) - 0.03, ends);
    float rib = max(length(vec2(r - 2.63, (fract(zl / 3.0 + 0.5) - 0.5) * 3.0)) - 0.07, ends);
    cInfo = vec4(0.0);
    if (rib < shell) { cMat = M_STEEL; return rib; }
    cMat = M_FROST;
    return shell;
  }

  // --- 8 the night helix: the tower the route coils round -----------------------
  float mapHelix(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(410.0 - zl, zl - 490.0);
    if (bz > 0.0) return bz + 4.0;
    vec3 c = vec3(27.0, -90.0, p.z - zl + 450.0);
    vec3 h = vec3(20.0, 150.0, 36.0);
    float d = sdBox(p - c, h);
    cMat = M_FACADE; cBoxC = c; cBoxH = h; cInfo = vec4(4.0, 0.0, 0.0, 0.0);
    if (zl > 420.0 && zl < 480.0) {
      float br = sdBox(vec3(p.x - 4.3, p.y - deckTop(p.z) + 0.42, (fract(zl / 6.0 + 0.5) - 0.5) * 6.0), vec3(2.75, 0.12, 0.1));
      if (br < d) { d = br; cMat = M_STEEL; cInfo = vec4(0.0); }
    }
    return d;
  }

  // --- 9 the crown: a space frame over the plaza ---------------------------------
  float mapCrown(vec3 p) {
    float zl = mod(p.z, LOOP_Z);
    float bz = max(490.0 - zl, zl - 530.0);
    if (bz > 0.0) return bz + 6.0;
    float top = deckTop(p.z);
    float y = p.y - top - 7.0;
    float slabR = sdBox(vec3(p.x, y, zl - 510.0), vec3(6.4, 0.2, 14.0));
    vec2 g = abs(fract(vec2(p.x, zl) / 2.4) - 0.5) * 2.4;
    float bars = max(min(g.x, g.y) - 0.06, slabR);
    float cols = max(sdBox(vec3(abs(p.x) - 6.3, p.y - top - 3.5, (fract(zl / 4.8 + 0.5) - 0.5) * 4.8), vec3(0.12, 3.5, 0.12)), abs(zl - 510.0) - 14.0);
    float glass = sdBox(vec3(p.x, y - 0.22, zl - 510.0), vec3(6.4, 0.015, 14.0));
    float steel = min(bars, cols);
    if (glass < steel) { cMat = M_GLASS; cInfo = vec4(3.0, 0.0, 0.0, 0.0); return glass; }
    cMat = M_STEEL; cInfo = vec4(0.0);
    return steel;
  }

  // --- the city: glass towers down both flanks, one per 36 m cell -----------------
  /** Tower k on side s: its box, and 0 where a set piece owns the flank. */
  float towerBox(float k, float side, out vec3 c, out vec3 h) {
    float h1 = hash21(vec2(k, side * 3.1 + 7.0));
    float h2 = hash21(vec2(k * 1.7, side + 2.3));
    float h3 = hash21(vec2(side * 5.1, k * 0.3 + 1.1));
    float tz = k * 36.0 + 18.0 + (h1 - 0.5) * 10.0;
    float zl = mod(tz, LOOP_Z);
    float top = 28.0 + 70.0 * h3;
    if (zl > 176.0 && zl < 244.0) top = -12.0 + 32.0 * h3;   // the wire runs at crown height
    if (zl > 478.0) top = -55.0 + 30.0 * h3;                   // the crown looks down on the rest
    h = vec3(5.0 + 4.0 * h2, (top + 260.0) * 0.5, 5.0 + 3.5 * h1);
    c = vec3(side * (13.0 + 15.0 * fract(h2 * 7.13) + h.x), (top - 260.0) * 0.5, tz);
    float on = 1.0;
    if (side < 0.0 && zl > 96.0 && zl < 204.0) on = 0.0;      // the curtain wall
    if (zl > 62.0 && zl < 118.0) on = 0.0;                    // the interchange's spokes
    if (zl > 248.0 && zl < 348.0) on = 0.0;                   // the station and the canyon
    if (side > 0.0 && zl > 406.0 && zl < 494.0) on = 0.0;     // the helix tower
    return on;
  }

  float mapTowers(vec3 p) {
    float side = p.x < 0.0 ? -1.0 : 1.0;
    float zc = p.z / 36.0;
    float k = floor(zc);
    // The towers not evaluated are at least this far: the far flank, and cells beyond the next.
    float d = min(abs(p.x) + 10.0, 22.0);
    vec3 c, h;
    for (int i = 0; i < 2; i++) {
      float kk = i == 0 ? k : k + (fract(zc) < 0.5 ? -1.0 : 1.0);
      if (towerBox(kk, side, c, h) < 0.5) continue;
      float top = c.y + h.y;
      float sb = top - (14.0 + 20.0 * fract(kk * 0.618 + side * 0.3));
      float t = min(sdBox(p - vec3(c.x, (sb - 260.0) * 0.5, c.z), vec3(h.x, (sb + 260.0) * 0.5, h.z)),
        sdBox(p - vec3(c.x, (sb + top) * 0.5, c.z), vec3(h.x - 1.8, (top - sb) * 0.5, h.z - 1.8)));
      vec3 q = p - c;
      t = max(t, (abs(q.x) + abs(q.z) - (h.x + h.z - 1.6)) * 0.7071);
      if (t < d) { d = t; cMat = M_FACADE; cBoxC = c; cBoxH = h; cInfo = vec4(0.0, kk, side, 0.0); }
    }
    return d;
  }
`
