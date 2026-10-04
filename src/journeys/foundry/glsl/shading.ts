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

  /** The shaft's own lamps, stacked up the wall instead of along the hall. */
  vec3 shaftLight(vec3 p, Surface s, vec3 V, float dzl) {
    vec3 acc = vec3(0.0);
    float band = floor(p.y / 9.0);
    vec3 pl = vec3(p.x, p.y, dzl);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      vec3 ld = vec3(side * (SHAFT_R - 0.22), (bi + 0.5) * 9.0, 0.0) - pl;
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

  /** The material, as sampled at the hit, and dressed: paint, rubber, machining, rust. */
  Surface surfaceAt(vec3 p, vec3 nGeo, float zc, float sec, vec3 dpx, vec3 dpy) {
    float mat = gMat;
    vec3 tp = vec3(p.x, p.y, zc);
    Surface s = sampleTriplanarGrad(layerFor(mat, sec, nGeo), tp, nGeo, 4.0, dpx, dpy);
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
                    float W, float H, float sec, vec3 dpx, vec3 dpy) {
    float mat = gMat;
    // Lamp glass is emissive and takes no lighting at all.
    if (mat > 3.5 && mat < 4.5)
      return mix(vec3(0.004), lampRadiance(sec) * 6.0, gGlow);
    // Molten metal is its own light source; the churn is what reads as liquid.
    if (mat > 7.5 && mat < 8.5) {
      float churn = fbm(vec2(p.x * 0.5, p.z * 0.5 - iTime * 0.35));
      float crust = smoothstep(0.42, 0.30, churn);
      vec3 hot = mix(vec3(4.0, 0.9, 0.08), vec3(8.0, 3.6, 0.8), churn);
      return mix(hot * (0.55 + 0.45 * churn), vec3(0.02, 0.006, 0.003), crust * 0.8);
    }

    Surface s = surfaceAt(p, nGeo, zc, sec, dpx, dpy);
    vec3 V = -rd;
    vec3 amb = hallAmbient(sec);
    vec3 col = shadeAmbient(s, V, amb, amb * 1.5, 1.0);
    if (p.y < CEIL_MAX) col += lampLight(p, s, V, W, H, sec);
    if (abs(dzl) < 7.0) {
      col += domeLight(p, s, V, dzl);
      if (p.y > 1.0) col += shaftLight(p, s, V, dzl);
    }
    col += furnaceLight(p, s, zc) + sparkLight(p, s, V, dzl);

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
