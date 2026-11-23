export const hallsGlsl = `  // ============================ GEOMETRY ===================================

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
    float dead = step(hash11(band * 3.17 + 11.0), decayVis() * 0.38);
    float dep = deployStation((band + 0.5) * sp);
    vec3 lp = p - lampAt(band, sec, W, H);
    // Striking: the filament comes up unevenly over the first metres of sight.
    float strike = smoothstep(0.15, 0.75, dep) *
      (0.75 + 0.25 * step(0.35, hash11(band * 7.7 + floor(iTime * 11.0)) + dep));
    if (abs(sec - 2.0) < 0.5) {
      // A high-bay: a spun reflector open underneath, its gear box on top and a
      // drop rod up to the bridge. Only the lens under the bowl is lit.
      vec2 rq = vec2(length(lp.xz), lp.y);
      float bowl = max((rq.x + 0.73 * rq.y - 0.36) * 0.81, abs(rq.y - 0.15) - 0.15);
      float gear = sdCylY(lp - vec3(0.0, 0.38, 0.0), 0.13, 0.09);
      float rod = sdCylY(lp - vec3(0.0, 0.80, 0.0), 0.022, 0.36);
      glow = (1.0 - dead) * strike * (1.0 - smoothstep(0.0, 0.02, lp.y)) * step(rq.x, 0.33);
      return min(bowl, min(gear, rod));
    }
    float bulb = sdCylX(lp, 0.17, 0.14);
    // Cage bars over the bulb, so the light throws a striped shadow pattern.
    float bars = abs(mod(atan(lp.z, lp.y) * 3.0 / PI + 0.5, 1.0) - 0.5) - 0.16;
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
  // Nearly empty and far too big: a crane hall with nothing left to lift. A
  // stanchion stands proud of each wall every 9 m, carrying a plate girder
  // runway with the crane rail on top; at each pair a bridge lowers itself out
  // of the roof onto the rails, with a chain hanging off it (swinging, because
  // your own footfalls shake it) and a high-bay under it (mapLamps).
  float mapLongRun(vec3 p, float zc, float W, float H, out float mat) {
    mat = 1.0;
    float st = floor(zc / 9.0);
    float lz = zc - (st + 0.5) * 9.0;
    float side = mod(st, 2.0) * 2.0 - 1.0;
    float dep = deployStation((st + 0.5) * 9.0);

    float drop = (1.0 - dep) * 3.2;   // stowed up in the ceiling until called
    float beam = sdBox(vec3(p.x, p.y - (H - 0.9) - drop, lz), vec3(W, 0.20, 0.26));

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
    float d = min(chain, hook);
    if (beam < d) d = beam;
    else mat = 5.0;

    // The steelwork along the walls, folded onto one wall: u is the depth out
    // of it. It runs over the first three stations and ends on a stanchion: the
    // fourth is in the funnel, where the walls lean in. All of it lies inside
    // u < 0.79 and run < 0, so well clear of that one bound answers for the lot.
    float u = W - abs(p.x);
    float run = abs(zc - SEC_LEN * floor(zc / SEC_LEN) - 13.5) - 9.34;
    float bound = max(u - 0.79, run);
    if (bound > 0.3) return min(d, bound);
    float yc = H - 1.66;   // the runway's centre line; the rail's head is at H - 1.10
    vec2 g = vec2(u - 0.45, p.y - yc);
    float girder = min(sdBox2(vec2(g.x, abs(g.y) - 0.40), vec2(0.22, 0.04)), sdBox2(g, vec2(0.03, 0.40)));
    float rail = max(sdBox2(g - vec2(0.0, 0.50), vec2(0.04, 0.06)), run);
    vec2 c = vec2(u - 0.45, lz);
    float col = min(sdBox2(vec2(abs(c.x) - 0.23, c.y), vec2(0.025, 0.22)), sdBox2(c, vec2(0.23, 0.02)));
    col = min(max(col, p.y - (yc - 0.44)), sdBox(vec3(c.x, p.y - 0.02, c.y), vec3(0.34, 0.02, 0.32)));
    if (rail < d) { d = rail; mat = 5.0; }
    float frame = min(max(girder, run), col);
    if (frame < d) { d = frame; mat = 11.0; }
    return d;
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
  // A gear train stands out of each wall at every 12 m station: two 18-tooth
  // wheels side by side and a 10-tooth pinion driving the first from above,
  // each on its shaft out of a pillow block on a cast bedplate. The wheels
  // drive out of the wall and spin up to the integrated flywheel rate as you
  // come level with them; a guard rail keeps the walkway off them.

  /** A 2D section extruded half-width h along x. */
  float extrudeX(float d2, float x, float h) {
    vec2 w = vec2(d2, abs(x) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
  }

  /**
   * A spur gear on the x axis, turned to angle ang: N teeth on pitch radius Rp
   * (module 2 Rp / N, full-depth teeth, a 0.15 face half-width). The bare
   * teeth go to 'rim'; the painted ring, the hub and the arms (or a plain web
   * when arms is 0) are the return. Outside its tip cylinder only that cylinder is answered.
   */
  float spurGear(vec3 a, float ang, float N, float Rp, float arms, out float rim) {
    float m = 2.0 * Rp / N;
    float Rt = Rp + m;
    float r = length(a.yz);
    rim = 1e3;
    if (r - Rt > 0.25) return max(r - Rt, abs(a.x) - 0.21);
    float Rr = Rp - 1.25 * m;
    float Ri = Rr - m;
    float sect = 2.0 * PI / N;
    float fl = (fract(ang / sect + 0.5) - 0.5) * sect;
    vec2 q = r * vec2(cos(fl), sin(fl));
    // A tapered tooth: 0.30 of the pitch wide at the root, 0.17 at the tip.
    float hw = Rp * sect * mix(0.30, 0.17, clamp((q.x - Rr) / (Rt - Rr), 0.0, 1.0));
    float tooth = max(abs(q.y) - hw, q.x - Rt) * 0.8;
    rim = extrudeX(max(tooth, Rr - 0.02 - q.x), a.x, 0.15);
    float ring = extrudeX(max(r - Rr, Ri - r), a.x, 0.15);
    float hub = min(ring, extrudeX(r - 0.13 - 0.12 * Rp, a.x, 0.21));
    if (arms < 0.5) return min(hub, extrudeX(r - Ri - 0.02, a.x, 0.07));
    float sa = 2.0 * PI / arms;
    float fa = (fract(ang / sa + 0.5) - 0.5) * sa;
    vec2 k = r * vec2(cos(fa), sin(fa));
    float arm = max(abs(k.y) - mix(0.11, 0.075, clamp(r / Ri, 0.0, 1.0)), r - Ri - 0.04);
    return min(hub, extrudeX(arm, a.x, 0.06));
  }

  float mapGearworks(vec3 p, float zc, float W, float H, out float mat) {
    mat = 12.0;
    float u = W - abs(p.x);   // depth out of the wall, both walls folded onto one

    // The guard rail, 1.95 m out: a top and a mid rail on posts every 2.45 m,
    // from 1.5 m inside the bulkhead to the funnel, where the walls close in.
    float local = zc - 4.0 * SEC_LEN;
    float run = abs(local - 13.75) - 12.25;
    float ug = u - 1.95;
    float rails = min(length(vec2(ug, p.y - 1.05)) - 0.03, length(vec2(ug, p.y - 0.55)) - 0.022);
    float pz = local - 1.5 - 2.45 * floor((local - 1.5) / 2.45 + 0.5);
    float post = max(length(vec2(ug, pz)) - 0.03, p.y - 1.05);
    float d = max(min(rails, post), run - 0.05);
    // Everything else lies within 0.9 m of the wall.
    if (u > 1.2) return min(d, u - 0.9);

    float st = floor(zc / 12.0);
    float dir = mod(st, 2.0) < 0.5 ? 1.0 : -1.0;
    float dep = deployStation((st + 0.5) * 12.0);
    // Wall-local: x out of the wall, y up, z along (mirrored every other station).
    vec3 w = vec3(u, p.y, (zc - (st + 0.5) * 12.0) * dir);

    // The bedplate, a cast iron frame on the wall behind the train.
    vec3 bp = w - vec3(0.0, 2.55, -0.7);
    float plate = sdBox(bp - vec3(0.03, 0.0, 0.0), vec3(0.03, 2.35, 4.25));
    float border = max(sdBox(bp - vec3(0.06, 0.0, 0.0), vec3(0.06, 2.35, 4.25)),
                       -sdBox(bp, vec3(0.2, 2.23, 4.13)));
    float frame = min(plate, border);

    // Three shafts: wheel A, wheel B meshing with it, pinion C over A at 60 deg.
    vec2 cA = vec2(2.3, -1.62);
    vec2 cB = vec2(2.3, 1.62);
    vec2 cC = vec2(3.56, -3.802);
    float blocks = min(sdBox(w - vec3(0.22, cA), vec3(0.14, 0.24, 0.24)),
                   min(sdBox(w - vec3(0.22, cB), vec3(0.14, 0.24, 0.24)),
                       sdBox(w - vec3(0.22, cC), vec3(0.14, 0.18, 0.18)))) - 0.02;

    // What turns drives out of the wall and spins up as the station deploys.
    vec3 m = w + vec3((1.0 - dep) * 1.3, 0.0, 0.0);
    float spin = uMech.x * dep;
    vec3 a = m - vec3(0.55, cA);
    vec3 b = m - vec3(0.55, cB);
    vec3 c = m - vec3(0.55, cC);
    float shafts = min(min(sdCylX(a - vec3(-0.15, 0.0, 0.0), 0.10, 0.40),
                           sdCylX(b - vec3(-0.15, 0.0, 0.0), 0.10, 0.40)),
                       sdCylX(c - vec3(-0.15, 0.0, 0.0), 0.08, 0.40));
    float caps = min(min(sdCylX(a - vec3(0.27, 0.0, 0.0), 0.14, 0.04),
                         sdCylX(b - vec3(0.27, 0.0, 0.0), 0.14, 0.04)),
                     sdCylX(c - vec3(0.27, 0.0, 0.0), 0.11, 0.04));
    // Phased so the teeth mesh at both contacts: B a half tooth behind A,
    // C a sixth of a tooth on, turning 1.8 times as fast.
    float sb = 2.0 * PI / 18.0;
    float rimA, rimB, rimC;
    float gA = spurGear(a, atan(a.z, a.y) + spin, 18.0, 1.62, 6.0, rimA);
    float gB = spurGear(b, atan(b.z, b.y) - spin + 0.5 * sb, 18.0, 1.62, 6.0, rimB);
    float gC = spurGear(c, atan(c.z, c.y) - spin * 1.8 + PI / 30.0, 10.0, 0.90, 0.0, rimC);
    float body = min(blocks, min(gA, min(gB, gC)));
    float bright = min(min(rimA, rimB), min(rimC, caps));
    float steel = min(frame, shafts);

    if (body < d) { d = body; mat = 11.0; }
    if (steel < d) { d = steel; mat = 5.0; }
    if (bright < d) { d = bright; mat = 3.0; }
    return d;
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

`
