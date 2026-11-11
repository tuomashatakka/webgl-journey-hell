export const shadingGlsl = /* glsl */`
  // ============================ SHADING ====================================
  //
  // Every surface is a Δ material — a real scan, packed by delta/ — lit the way
  // the loop line lights its bays: the nearest lamps through a GGX BRDF, the
  // hall's bounce light as the ambient, and (in main) each lamp's glow in the
  // air, scattered in closed form. Shading is in linear light; main() tone maps.

  /** A colour picked by eye, into linear light. */
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

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
    if (i > 5.5) return 4.8;             // furnace floor: wide hall, lamps far out
    if (i > 2.5 && i < 3.5) return 2.3;  // coolant tier: white tile in a tight hall glares
    return 3.4;
  }

  /** A hall's lamps as radiance: their colour rotting toward red as the loop goes. */
  vec3 lampRadiance(float sec) {
    return lin(mix(secLampColour(sec), vec3(1.00, 0.30, 0.16), decayVis() * 0.55)) * secLampPower(sec) * 0.6;
  }

  bool lampDead(float band) { return hash11(band * 3.17 + 11.0) < decayVis() * 0.38; }

  /** What the hall's lamps bounce back off everything, for the ambient. */
  vec3 hallAmbient(float sec) {
    return lin(secLampColour(sec)) * 0.03 + vec3(0.006, 0.0065, 0.009);
  }

  /** Which Δ layer a material is, in hall sec, facing n. */
  float layerFor(float m, float sec, vec3 n) {
    if (m < 0.5) {
      if (n.y > 0.7) return sec < 0.5 || abs(sec - 3.0) < 0.5 ? MAT_FLOOR : MAT_STEEL;
      if (n.y < -0.7) return MAT_CONCRETE;
      if (sec < 0.5) return MAT_BRICK;
      if (sec < 1.5) return MAT_PANEL;
      if (sec < 2.5) return MAT_CONCRETE;
      if (sec < 3.5) return MAT_TILE;
      if (sec < 4.5) return MAT_CORRUGATED;
      if (sec < 5.5) return MAT_STEEL;
      return MAT_BRICK;
    }
    if (m < 1.5) return MAT_HAZARD;
    if (m < 5.5) return MAT_STEEL;
    if (m < 6.5) return MAT_CORRUGATED;
    if (m < 9.5) return MAT_WOOD;
    if (m < 11.5) return MAT_STEEL;
    if (m < 12.5) return MAT_HAZARD;
    return MAT_STEEL;
  }

  /** Paint: drums by batch, pipes by service (gWear carries which). */
  vec3 paintFor(float m, float which) {
    if (m < 10.5) {
      return which < 0.3 ? vec3(0.10, 0.22, 0.52) : which < 0.55 ? vec3(0.55, 0.10, 0.06)
        : which < 0.8 ? vec3(0.70, 0.50, 0.06) : vec3(0.16, 0.30, 0.12);
    }
    float b = fract(which);
    return b < 0.4 ? vec3(0.18, 0.34, 0.16) : b < 0.7 ? vec3(0.55, 0.12, 0.07) : vec3(0.12, 0.18, 0.40);
  }

  // The three nearest corridor lamps dominate; approximating the strip as a few
  // point lights is far cheaper than iterating the hall and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, Surface s, vec3 V, float W, float H, float sec) {
    vec3 acc = vec3(0.0);
    float sp = secLampSpacing(sec);
    vec3 rad = lampRadiance(sec);
    float band = floor(p.z / sp);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      if (lampDead(bi)) continue;
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      float lz = (bi + 0.5) * sp;
      vec3 ld = vec3(side * (W - 0.22), H - 0.62, lz) - p;
      float d2 = dot(ld, ld);
      float atten = smoothstep(0.15, 0.75, deployStation(lz)) / (1.0 + d2 * 0.030);
      acc += shadeBrdf(s, V, ld * inversesqrt(max(d2, 1e-4))) * rad * atten * PI;
    }
    return acc;
  }

  /**
   * Where shaft lamp 'bi' hangs: alternate walls, and either side of the guide
   * rail rather than behind it, so the fixture itself can be seen.
   */
  vec3 shaftLampAt(float bi) {
    float side = mod(bi, 2.0) * 2.0 - 1.0;
    float fore = mod(floor(bi * 0.5), 2.0) * 2.0 - 1.0;
    return vec3(side * (SHAFT_R - 0.22), (bi + 0.5) * 9.0, fore * 0.95);
  }

  /** The shaft's own lamps, stacked up the wall instead of along the hall. */
  vec3 shaftLight(vec3 p, Surface s, vec3 V, float dzl) {
    vec3 acc = vec3(0.0);
    float band = floor(p.y / 9.0);
    vec3 pl = vec3(p.x, p.y, dzl);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      vec3 ld = shaftLampAt(bi) - pl;
      float d2 = dot(ld, ld);
      acc += shadeBrdf(s, V, ld * inversesqrt(max(d2, 1e-4))) / (1.0 + d2 * 0.026);
    }
    return acc * lin(vec3(1.00, 0.80, 0.58)) * 2.4 * PI;
  }

  /** The cage's dome lamp — the only thing lighting you once the shutter drops. */
  vec3 domeLight(vec3 p, Surface s, vec3 V, float dzl) {
    vec3 ld = vec3(0.0, cageY() + CAGE_H - 0.14, 0.0) - vec3(p.x, p.y, dzl);
    float d2 = dot(ld, ld);
    if (d2 > 81.0) return vec3(0.0);
    return shadeBrdf(s, V, ld * inversesqrt(max(d2, 1e-4))) / (1.0 + d2 * 0.55) * lin(vec3(1.00, 0.86, 0.66)) * 2.2 * PI;
  }

  // The melt under the folding span: a warm updraft that only reaches the last
  // hall of the lap. An enormous area source, so it is ambient-shaped, not a point.
  vec3 furnaceLight(vec3 p, Surface s, float zc) {
    float near = 1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 16.0, abs(cycd(zc - SPAN_MID)));
    if (near < 0.01) return vec3(0.0);
    float up = max(dot(s.normal, vec3(0.0, -1.0, 0.0)), 0.0) * 0.75 + 0.30;
    float depth = clamp((p.y - MELT_Y) / 34.0, 0.0, 1.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.z * 0.4, iTime * 1.7));
    return s.albedo * up * near * (1.0 - depth * 0.55) * flick * vec3(1.0, 0.22, 0.035);
  }

  /** Brake sparks off the rail contact patch, the only key light while the shoes bite. */
  vec3 sparkLight(vec3 p, Surface s, vec3 V, float dzl) {
    if (spark() < 0.01) return vec3(0.0);
    vec3 sd = vec3(sign(p.x) * 1.90, cageY() + 0.1, 0.0) - vec3(p.x, p.y, dzl);
    float d2 = dot(sd, sd);
    return shadeBrdf(s, V, sd * inversesqrt(max(d2, 1e-4))) / (1.0 + d2 * 0.10) * spark() * vec3(3.4, 2.4, 1.0) * PI;
  }

  // --- the detailing ---------------------------------------------------------
  // Everything below is analytic and lives in the shading only: no new geometry,
  // no extra march steps. Each pattern is filtered by the pixel's own footprint
  // (fw) and fades to its average before it can alias.

  /** Lines of width w every per, box-filtered over the footprint fw. */
  float lineCov(float x, float per, float w, float fw) {
    float d = abs(x - per * floor(x / per + 0.5));
    float sharp = 1.0 - smoothstep(w * 0.5 - fw * 0.5, w * 0.5 + fw * 0.5 + 1e-4, d);
    return mix(sharp, w / per, smoothstep(per * 0.15, per * 0.5, fw));
  }

  /** Safety paint, yellow and black at 45 degrees, in linear light. */
  vec3 hazardPaint(vec2 q) {
    return mix(vec3(0.50, 0.25, 0.004), vec3(0.012), step(0.5, fract((q.x + q.y) * 2.5)));
  }

  /** Does p lie on the hoist shaft's own walls (above the hall, or down the pit)? */
  bool onShaftWall(vec3 p, vec3 n, float dzl, float H) {
    return abs(n.y) < 0.5 && abs(dzl) < SHAFT_R + 0.3 && abs(p.x) < SHAFT_R + 0.3
      && (p.y > H + 0.02 || p.y < -0.05);
  }

  /**
   * Riveted plate, 1.2 m by 1.5 m sheets: dark seams, domed rivet heads in a
   * row either side of every seam, a tint per sheet, rust run down from the
   * seam above, soot. w = (along the wall, up), t1 the wall's horizontal tangent.
   */
  void rivetedPlate(inout Surface s, vec2 w, vec3 t1, float fw) {
    vec2 seamOff = vec2(w.x - 1.2 * floor(w.x / 1.2 + 0.5), w.y - 1.5 * floor(w.y / 1.5 + 0.5));
    float seams = lineCov(w.x, 1.2, 0.012, fw) + lineCov(w.y, 1.5, 0.012, fw);
    vec2 a = vec2(w.x - 0.15 * floor(w.x / 0.15 + 0.5), abs(seamOff.y) - 0.05);
    vec2 b = vec2(abs(seamOff.x) - 0.05, w.y - 0.15 * floor(w.y / 0.15 + 0.5));
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float head = (1.0 - smoothstep(0.014, 0.020 + fw, length(g))) * (1.0 - smoothstep(0.015, 0.05, fw));
    s.normal = normalize(s.normal + (t1 * g.x + vec3(0.0, g.y, 0.0)) * (head * 40.0));
    float tint = hash21(floor(w / vec2(1.2, 1.5)));
    s.albedo *= (0.70 + 0.55 * tint) * (1.0 - seams * 0.65);
    float runs = smoothstep(0.55, 0.9, vnoise(vec2(w.x * 9.0, w.y * 0.35))) * smoothstep(0.35, 1.0, fract(w.y / 1.5));
    s.albedo = mix(s.albedo, lin(vec3(0.40, 0.16, 0.06)), runs * 0.7);
    s.rough = mix(s.rough, 0.92, runs);
    s.metal *= 1.0 - runs * 0.8;
    s.albedo *= 1.0 - smoothstep(0.4, 0.85, vnoise(w * vec2(0.6, 0.25))) * 0.55;
    s.ao *= 1.0 - seams * 0.4;
  }

  /**
   * A hall's plate, dressed: a painted dado peeling off the lower wall, a
   * hazard kick band where the trolleys hit, grime splashed up the foot and
   * soot down from the ceiling, rain runs, a polished walking line and oil on
   * the floor with yellow walkway lines, and the ribs as riveted I-sections.
   */
  void dressHall(inout Surface s, vec3 p, vec3 n, float zc, float sec, float W, float H, float fw) {
    float wear = vnoise(vec2(zc * 0.9, p.y * 1.7 + p.x));
    if (abs(n.y) < 0.5) {
      float hgt = p.y;
      if (sec > 0.5 && sec < 2.5 || sec > 3.5 && sec < 4.5) {
        float top = 1.25;
        float dado = 1.0 - smoothstep(top - fw, top + fw, hgt);
        float peel = smoothstep(0.66, 0.80, vnoise(vec2(zc * 5.3, hgt * 7.1)) * 0.75 + vnoise(vec2(zc * 0.7, hgt)) * 0.25
          + (1.0 - hgt / top) * 0.10);
        vec3 paint = sec < 1.5 ? lin(vec3(0.22, 0.32, 0.25)) : sec < 2.5 ? lin(vec3(0.30, 0.32, 0.34)) : lin(vec3(0.18, 0.24, 0.32));
        float k = dado * (1.0 - peel);
        s.albedo = mix(s.albedo, paint * (0.75 + 0.35 * s.ao), k);
        s.rough = mix(s.rough, 0.45, k);
        s.metal *= 1.0 - k;
        s.albedo *= 1.0 - (1.0 - smoothstep(0.018, 0.022 + fw, abs(hgt - top - 0.03))) * 0.7;
      }
      if (sec < 0.5 || sec > 4.5) {
        float chip = smoothstep(0.62, 0.8, vnoise(vec2(zc * 4.0, hgt * 9.0)));
        float k = step(0.06, hgt) * step(hgt, 0.30) * (1.0 - chip);
        s.albedo = mix(s.albedo, hazardPaint(vec2(zc, hgt)), k);
        s.rough = mix(s.rough, 0.55, k);
        s.metal *= 1.0 - k;
      }
      // The coolant tier sweats: tea-coloured runs down the tile off the pipe
      // bundles, and black mould where the floor stays wet.
      if (abs(sec - 3.0) < 0.5) {
        float sweat = smoothstep(0.45, 0.85, vnoise(vec2(zc * 4.5, hgt * 0.45))) * smoothstep(0.2, 0.9, hgt / H);
        float mould = (1.0 - smoothstep(0.0, 0.9, hgt + (wear - 0.5) * 0.6)) * (0.6 + 0.4 * vnoise(vec2(zc * 3.0, hgt * 6.0)));
        s.albedo *= 0.5;
        s.albedo = mix(s.albedo, lin(vec3(0.26, 0.17, 0.08)), sweat * 0.8);
        s.albedo = mix(s.albedo, lin(vec3(0.05, 0.07, 0.04)), mould * 0.8);
        s.rough = mix(s.rough, 0.8, max(sweat, mould));
      }
      float foot = 1.0 - smoothstep(0.0, 0.45 + 0.5 * wear, hgt);
      float soot = smoothstep(H - 1.6, H, hgt) * (0.55 + 0.45 * wear);
      float runs = smoothstep(0.6, 0.85, vnoise(vec2(zc * 7.0, hgt * 0.3))) * smoothstep(0.3, 1.0, hgt / H);
      s.albedo *= (1.0 - foot * 0.55) * (1.0 - soot * 0.6) * (1.0 - runs * 0.35);
      s.rough = mix(s.rough, 0.95, foot * 0.5);
      s.ao *= 1.0 - foot * 0.35;
    } else if (n.y > 0.5) {
      // Quarry tile takes the dirt of every boot that ever crossed it.
      if (sec < 0.5 || abs(sec - 3.0) < 0.5) s.albedo *= 0.62;
      float path = 1.0 - smoothstep(0.5, 1.4, abs(p.x));
      s.rough *= 1.0 - path * 0.35;
      s.albedo *= 1.0 + path * 0.12;
      // Oil everywhere but the furnace floor, which is too hot to hold it.
      float oil = smoothstep(0.62, 0.78, vnoise(p.xz * 0.55 + 3.1) * 0.7 + vnoise(p.xz * 2.1) * 0.3) * step(sec, 5.5);
      s.albedo *= 1.0 - oil * 0.65;
      s.rough = mix(s.rough, 0.12, oil);
      s.metal *= 1.0 - oil;
      // Standing water in the coolant tier, black and glossy.
      if (abs(sec - 3.0) < 0.5) {
        float wet = smoothstep(0.5, 0.65, vnoise(p.xz * 0.8 + 7.0));
        s.albedo *= 1.0 - wet * 0.6;
        s.rough = mix(s.rough, 0.05, wet);
      }
      if (sec < 1.5 || abs(sec - 4.0) < 0.5) {
        float line = 1.0 - smoothstep(0.04, 0.04 + fw, abs(W - abs(p.x) - 0.45));
        float k = line * (1.0 - smoothstep(0.45, 0.7, vnoise(vec2(p.x * 3.0, zc * 1.3)))) * 0.85;
        s.albedo = mix(s.albedo, lin(vec3(0.75, 0.55, 0.06)), k);
        s.rough = mix(s.rough, 0.6, k);
        s.metal *= 1.0 - k;
      }
      float edge = 1.0 - smoothstep(0.0, 0.45, W - abs(p.x));
      s.albedo *= 1.0 - edge * 0.5;
      s.ao *= 1.0 - edge * 0.4;
    } else {
      s.albedo *= 0.7 + 0.25 * wear;
    }

    // The ribs: an I-section in oxide paint, a rivet row down the face of the
    // web, a dark line where the flange meets the plate.
    float rsp = secRibSpacing(sec);
    float rz = abs(mod(p.z + rsp * 0.5, rsp) - rsp * 0.5);
    if ((abs(n.x) > 0.5 || n.y < -0.5) && p.y > 0.05 && rz < 0.34) {
      float k = 1.0 - smoothstep(0.26, 0.32, rz);
      s.albedo = mix(s.albedo, lin(vec3(0.24, 0.12, 0.07)) * (0.6 + 0.6 * wear), k);
      s.metal = mix(s.metal, 0.35, k);
      s.rough = mix(s.rough, 0.6, k);
      float along = n.y < -0.5 ? p.x : p.y;
      float rv = length(vec2(rz, along - 0.14 * floor(along / 0.14 + 0.5)));
      s.albedo *= 1.0 + (1.0 - smoothstep(0.018, 0.025 + fw, rv)) * (1.0 - smoothstep(0.02, 0.06, fw)) * 1.2;
      s.albedo *= 1.0 - (1.0 - smoothstep(0.0, 0.03 + fw, abs(rz - 0.29))) * 0.6;
    }
  }

  /** The material, as sampled at the hit, and dressed: paint, rubber, machining, rust. */
  Surface surfaceAt(vec3 p, vec3 nGeo, float zc, float dzl, float sec, float W, float H, vec3 dpx, vec3 dpy) {
    float mat = gMat;
    vec3 tp = vec3(p.x, p.y, zc);
    bool shaft = mat < 0.5 && onShaftWall(p, nGeo, dzl, H);
    float layer = shaft ? MAT_STEEL : layerFor(mat, sec, nGeo);
    Surface s = sampleTriplanarGrad(layer, tp, nGeo, 4.0, dpx, dpy);
    float fw = max(length(dpx), length(dpy));
    if (shaft) {
      bool xw = abs(nGeo.x) > abs(nGeo.z);
      rivetedPlate(s, vec2(xw ? dzl : p.x, p.y), xw ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0), fw);
      // The ring ribs every 2.4 m are angle iron: dark web, a bright edge on top.
      float ry = p.y - 2.4 * floor(p.y / 2.4 + 0.5);
      float rib = 1.0 - smoothstep(0.11, 0.13 + fw, abs(ry));
      s.albedo = mix(s.albedo, s.albedo * 0.55, rib);
      s.albedo *= 1.0 + (1.0 - smoothstep(0.0, 0.025 + fw, abs(ry - 0.10))) * 1.5;
      // Oil weeping down the plate from under the rail brackets.
      float oil = (xw ? 1.0 - smoothstep(0.08, 0.40, abs(dzl)) : 0.0)
        * smoothstep(0.45, 0.8, vnoise(vec2(dzl * 6.0, p.y * 0.4)));
      s.albedo *= 1.0 - oil * 0.7;
      s.rough = mix(s.rough, 0.15, oil);
    } else if (mat < 0.5) {
      dressHall(s, p, nGeo, zc, sec, W, H, fw);
    }
    if (mat > 9.5 && mat < 11.5) {
      // Painted steel, chipped back to the scan wherever its own AO says it gets knocked.
      float chip = smoothstep(0.5, 0.85, 1.0 - s.ao + (fbm(tp.zy * 3.0) - 0.5) * 0.7);
      s.albedo = mix(lin(paintFor(mat, gWear)), s.albedo, chip);
      s.metal *= chip;
      s.rough = mix(0.45, s.rough, chip);
    }
    if (mat > 12.5) { s.albedo *= 0.12; s.metal = 0.0; s.rough = 0.55; }
    if (mat > 2.5 && mat < 3.5) { s.metal = 1.0; s.rough *= 0.45; s.albedo = mix(s.albedo, vec3(0.56, 0.57, 0.58), 0.6); }
    if (mat > 4.5 && mat < 5.5) { s.metal = 1.0; s.rough *= 0.7; }
    if (mat > 1.5 && mat < 2.5) s.metal = 0.6;
    // Rust and grime out of the wear field, worse every lap.
    float rust = smoothstep(0.55, 0.95, gWear * 0.55 * step(mat, 0.5) + fbm(tp.xz * 0.7 + tp.y * 0.31) * 0.6 + decayVis() * 0.3) * step(mat, 7.0);
    s.albedo = mix(s.albedo, vec3(0.13, 0.05, 0.02), rust * 0.65);
    s.rough = mix(s.rough, 0.95, rust * 0.6);
    s.metal *= 1.0 - rust;
    return s;
  }

  vec3 shadeSurface(vec3 p, vec3 nGeo, vec3 rd, float zc, float dzl,
                    float W, float H, float sec, float occ, vec3 dpx, vec3 dpy) {
    float mat = gMat;
    // Lamp glass is emissive and takes no lighting at all.
    if (mat > 3.5 && mat < 4.5)
      return mix(vec3(0.004), lampRadiance(sec) * 6.0, gGlow);
    // Molten metal is its own light source; the churn is what reads as liquid.
    // It floats a dark crust of slag that splits into plates along bright seams;
    // the hottest metal is deep orange, not white, so the tap never clips.
    if (mat > 7.5 && mat < 8.5) {
      // The pool is read across its surface, a tap channel's face up its side.
      vec2 mq = abs(nGeo.y) > 0.5 ? p.xz : vec2(p.z, p.y * 2.5);
      float churn = fbm(vec2(mq.x * 0.5, mq.y * 0.5 - iTime * 0.35));
      float plates = vnoise(mq * 1.7 + vec2(0.0, iTime * 0.12));
      float seam = 1.0 - smoothstep(0.0, 0.07, abs(plates - 0.5));
      float crust = smoothstep(0.46, 0.66, churn) * (1.0 - seam * 0.9);
      vec3 hot = mix(vec3(2.6, 0.48, 0.035), vec3(4.6, 1.45, 0.16), churn * churn);
      vec3 slag = vec3(0.06, 0.012, 0.004) + hot * 0.08 * (1.0 - churn);
      return mix(hot * (0.7 + 0.3 * churn), slag, crust * 0.85);
    }

    Surface s = surfaceAt(p, nGeo, zc, dzl, sec, W, H, dpx, dpy);
    vec3 V = -rd;
    vec3 amb = hallAmbient(sec);
    vec3 col = shadeAmbient(s, V, amb, amb * 1.5, occ);
    // The march's occlusion stands in for contact shadow on the direct light too:
    // a crate on the floor, a ram in its wall box, the corner of the hall.
    vec3 direct = vec3(0.0);
    if (p.y < CEIL_MAX) direct += lampLight(p, s, V, W, H, sec);
    if (abs(dzl) < 7.0) {
      direct += domeLight(p, s, V, dzl);
      if (p.y > 1.0) direct += shaftLight(p, s, V, dzl);
    }
    col += direct * mix(0.55, 1.0, occ);
    col += furnaceLight(p, s, zc) + sparkLight(p, s, V, dzl);

    // The shaft lamps' own fittings: a guarded bulb in a housing on the plate.
    if (gMat < 0.5 && onShaftWall(p, nGeo, dzl, H)) {
      vec3 lp = shaftLampAt(floor(p.y / 9.0));
      if (abs(nGeo.x) > 0.5 && lp.x * p.x > 0.0) {
        vec2 lq = vec2(dzl - lp.z, p.y - lp.y);
        float fw = max(length(dpx), length(dpy));
        float housing = 1.0 - smoothstep(0.15, 0.17 + fw, max(abs(lq.x), abs(lq.y) * 0.72));
        float bulb = 1.0 - smoothstep(0.05, 0.08 + fw, length(lq * vec2(1.0, 0.8)));
        float guard = lineCov(lq.y, 0.06, 0.012, fw);
        col = mix(col, vec3(0.004), housing * 0.85);
        col += lin(vec3(1.00, 0.80, 0.58)) * (bulb * 14.0 * (1.0 - guard * 0.6) + exp(-length(lq) * 7.0) * 0.6);
      }
    }

    // The furnace hall's tap channels radiate: the wall and floor around them
    // glow dull red, hotter the closer, under whatever the lamps do.
    if (sec > 5.5) {
      float dch = length(vec2(max(W - abs(p.x) - 0.28, 0.0), max(abs(p.y - 1.15) - 0.30, 0.0)));
      float flick = 0.85 + 0.15 * vnoise(vec2(zc * 0.8, iTime * 2.3));
      col += s.albedo * vec3(1.6, 0.30, 0.04) * exp(-dch * 2.4) * flick * (1.0 - s.metal * 0.5);
    }

    // What is behind the plate, once the plate has split. A mix, not an add:
    // the additive version blows the whole frame out when the decay saturates.
    float crack = crackField(p, decayVis());
    if (crack > 0.001) {
      vec3 core = vec3(5.0, 0.55, 0.05) * (0.75 + 0.55 * fbm(vec2(p.y * 2.0, iTime * 1.4)));
      col = mix(col, core, clamp(crack * 1.4, 0.0, 1.0));
    }
    return col;
  }

  /**
   * Oblivion has no lamps, no hall and no shaft. What is left is the cage's
   * dome lamp, whatever the shoes still throw off the rails, and a red that
   * comes up from underneath and never gets any closer.
   */
  vec3 shadeOblivion(vec3 p, vec3 nGeo, vec3 rd, float dzl, vec3 dpx, vec3 dpy) {
    if (gMat > 3.5 && gMat < 4.5)
      return mix(vec3(0.004), lin(vec3(1.0, 0.76, 0.42)) * 7.0, gGlow);
    Surface s = sampleTriplanarGrad(MAT_STEEL, vec3(p.x, p.y, cyc(p.z)), nGeo, 4.0, dpx, dpy);
    s.metal = 1.0;
    s.rough *= 0.6;
    s.albedo = mix(s.albedo, vec3(0.30, 0.10, 0.03), smoothstep(0.45, 0.9, fbm(p.xy * 0.3)) * 0.5);
    vec3 V = -rd;
    vec3 col = shadeAmbient(s, V, vec3(0.004, 0.003, 0.004), vec3(0.01, 0.004, 0.003), 1.0);
    col += domeLight(p, s, V, dzl) + sparkLight(p, s, V, dzl);
    float up = max(dot(s.normal, vec3(0.0, -1.0, 0.0)), 0.0) * 0.85 + 0.15;
    float flick = 0.80 + 0.20 * fbm(vec2(p.y * 0.5, iTime * 2.1));
    return col + s.albedo * up * flick * vec3(1.6, 0.22, 0.03);
  }
`
