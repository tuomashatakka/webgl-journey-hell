export const oblivionGlsl = `  // ============================= OBLIVION ==================================
  //
  // Past the pit there is no shaft, no landing and no bottom — only the machine
  // that the foundry was always feeding, running in the dark on either side of
  // the cage. Gear rims and piston rods come through the fall close enough to
  // take the cage apart and keep missing it.
  //
  // The world here is periodic in Y with period OB_PERIOD, and the cage's own
  // height wraps inside it (see physics.ts). That is not a shortcut, it is the
  // only way a fall with no end stays representable: an unbounded y is a float
  // that runs out of mantissa in a few minutes, and it would do it while the
  // camera is the only thing in shot.

  /** One toothed rim, axis along local X, spinning at 'sp'. */
  float obGear(vec3 a, float R, float sp) {
    a.yz = rot(sp) * a.yz;
    float rim = max(sdCylX(a, R, 0.16), -sdCylX(a, R - 0.55, 1.0));
    // Teeth: a radial comb standing proud of the rim, cut square.
    float teeth = abs(mod(atan(a.z, a.y) * 13.0 / PI + 0.5, 1.0) - 0.5) - 0.26;
    float ring = max(sdCylX(a, R + 0.34, 0.13), teeth * 0.30);
    float spoke = max(sdCylX(a, R, 0.09),
                      abs(mod(atan(a.z, a.y) * 3.0 / PI + 0.5, 1.0) - 0.5) * 0.9 - 0.10);
    return min(min(rim, ring), min(spoke, sdCylX(a, 0.22, 0.30)));
  }

  float mapOblivion(vec3 p) {
    gMat = 3.0; gWear = 0.55; gGlow = 0.0;
    // The cage never leaves the shaft's z, so everything is still placed against
    // it — it is only the floor of the world that has gone.
    float dz = cycd(cyc(p.z) - LIFT_Z);

    // Everything is placed against the *cage*, and the cage's y wraps, so the
    // machine is laid out in a band that repeats every OB_PERIOD. The fall is
    // going nowhere and it is meant to look like it.
    float band = floor(p.y / OB_PERIOD);
    float ly = p.y - (band + 0.5) * OB_PERIOD;
    float side = mod(band, 2.0) * 2.0 - 1.0;
    float spin = uFall.x * 0.09 + iTime * 2.2;

    // Two gear rims per band, on opposite walls, cutting through the fall line.
    float d = obGear(vec3(p.x - side * 3.5, ly - 9.0, dz), 2.9, spin);
    d = min(d, obGear(vec3(p.x + side * 3.9, ly + 11.5, dz - 1.4), 3.6, -spin * 0.72));
    d = min(d, obGear(vec3(p.x - side * 4.4, ly - 24.0, dz + 1.1), 2.2, spin * 1.9));

    // Piston rods reciprocating across the shaft. uMech.y is the exact
    // slider-crank displacement the flywheel is already driving upstairs.
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float py = ly + 26.0 - fk * 19.0;
      float ph = uMech.y + sin(fk * 2.1 + spin * 0.5) * 0.6;
      float reach = 2.2 + ph * 1.7;
      vec3 rp = vec3(abs(p.x) - reach, py, dz - 0.6 + fk * 0.9);
      d = min(d, sdCylX(rp, 0.16, 2.6));
      d = min(d, sdBox(vec3(rp.x - 2.4, rp.y, rp.z), vec3(0.34, 0.46, 0.46)));
    }

    // Cage and contents. Nothing else: there is no wall to fall past.
    float cm;
    float cage = mapCage(p, dz, cm);
    if (cage < d) { d = cage; gMat = cm; gWear = 0.70; gGlow = step(3.5, cm) * step(cm, 4.5); }
    float deb = mapDebris(p, dz);
    if (deb < d) { d = deb; gMat = 2.0; gWear = 0.85; gGlow = 0.0; }

    // The machine is coming apart too, at the rate everything else does.
    return d + fieldBoil(p, decay()) * 0.6;
  }

  // ============================== THE MAP ==================================

  float mapScene(vec3 p) {
    if (oblivion() > 0.5) return mapOblivion(p);

    float zc = cyc(p.z);
    float dzl = cycd(zc - LIFT_Z);
    gMat = 0.0; gWear = 0.4; gGlow = 0.0;

    // --- the shaft, which is all there is above the halls' ceilings ---------
    float d = shaftInterior(p, dzl);
    if (p.y < CEIL_MAX) {
      float a, b, t, tf;
      secBlend(zc, a, b, t, tf);

      // --- per-loop decay: the corridor splits and boils ---------------------
      // Not displacement. See crackField/fieldBoil: the plate comes apart along
      // a vein field and the field itself corrupts, which is damage rather than
      // weather. The guard keeps both off the walker's immediate surroundings —
      // at high iterations an unguarded version puts the breakage inside the
      // camera, and a corridor that is cracking open two metres away is far
      // worse than one you are standing in the middle of.
      vec3 pw = p;
      float dec = decay();
      float guard = dec > 0.005 ? smoothstep(1.2, 7.0, abs(p.z - walkZ())) : 0.0;

      vec2 pr = mix(secProfile(a), secProfile(b), t);
      float squeeze = 1.0 - dec * 0.18;
      float W = pr.x * squeeze;
      float H = pr.y * squeeze;

      float wear;
      float hall = mapHall(pw, zc, W, H, a, wear);
      // The plate splits open. Subtracting the crack field pulls the surface
      // back along its own veins, so the split is a hole in the wall with the
      // melt behind it rather than a line drawn on the wall.
      // This field is positive *inside*, so a groove cut into the wall is a
      // larger value, not a smaller one — the opposite sign to liminal's, whose
      // field is the usual outside-positive kind.
      if (guard > 0.0) {
        hall += crackField(p, dec) * 0.55 * guard;
        hall += fieldBoil(p, dec) * guard;
      }
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
      // The cracks do the same thing, harder: a term that *adds* to a
      // positive-inside field is an over-estimate of the distance to the wall,
      // and over-estimates are exactly what a sphere trace cannot survive. It
      // steps straight through the plate and the corridor fills with holes. The
      // step has to come down with the decay, and this is what it costs.
      if (dec > 0.05) d *= mix(1.0, 0.60, min(1.0, dec * 1.2));
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

`
