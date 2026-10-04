export const shadingGlsl = `  // ============================ SHADING ====================================

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

  /**
   * Anisotropic highlight. Rolled and ground steel scatters along its grain, so
   * the specular lobe is stretched across the direction the surface was worked
   * in — the single cheapest thing that stops metal looking like plastic.
   */
  float anisoSpec(vec3 n, vec3 ld, vec3 rd, vec3 tang, float rough, float aniso) {
    vec3 h = normalize(ld - rd);
    float e = mix(mix(90.0, 8.0, rough), mix(90.0, 8.0, rough) * (1.0 - aniso * 0.9),
                  abs(dot(h, tang)));
    return pow(max(dot(h, n), 0.0), max(e, 2.0));
  }

  // The three nearest corridor lamps dominate; approximating the strip as a few
  // point lights is far cheaper than iterating the hall and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, vec3 tang,
                 float W, float H, float sec) {
    vec3 acc = vec3(0.0);
    float sp = secLampSpacing(sec);
    vec3 lcol = mix(secLampColour(sec), vec3(1.00, 0.30, 0.16), decay() * 0.55);
    float lpow = secLampPower(sec);
    float band = floor(p.z / sp);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      if (hash11(bi * 3.17 + 11.0) < decay() * 0.38) continue;  // this one has failed
      float lz = (bi + 0.5) * sp;
      vec3 lp = vec3(side * (W - 0.22), H - 0.62, lz);
      vec3 ld = lp - p;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = smoothstep(0.15, 0.75, deployStation(lz)) / (1.0 + dist * dist * 0.030);
      // Half-lambert: real halls are full of bounce light off the plate, and a
      // hard terminator here just crushes everything to black.
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = anisoSpec(n, ld, rd, tang, rough, 0.7);
      acc += (albedo * diff + spec * (1.0 - rough) * 0.40) * atten * lcol * lpow;
    }
    return acc;
  }

  /** The shaft's own lamps, stacked up the wall instead of along the hall. */
  vec3 shaftLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, vec3 tang, float dzl) {
    vec3 acc = vec3(0.0);
    float band = floor(p.y / 9.0);
    // Everything here is in the shaft's own frame, where z measures across the
    // shaft rather than along the lap.
    vec3 pl = vec3(p.x, p.y, dzl);
    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      vec3 lp = vec3(side * (SHAFT_R - 0.22), (bi + 0.5) * 9.0, 0.0);
      vec3 ld = lp - pl;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = 1.0 / (1.0 + dist * dist * 0.026);
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = anisoSpec(n, ld, rd, tang, rough, 0.7);
      acc += (albedo * diff + spec * (1.0 - rough) * 0.35) * atten
        * vec3(1.00, 0.80, 0.58) * 4.0;
    }
    return acc;
  }

  /** The cage's dome lamp — the only thing lighting you once the shutter drops. */
  vec3 domeLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd, float dzl) {
    vec3 lp = vec3(0.0, cageY() + CAGE_H - 0.14, 0.0);
    vec3 ld = lp - vec3(p.x, p.y, dzl);
    float dist = length(ld);
    if (dist > 9.0) return vec3(0.0);
    ld /= max(dist, 0.001);
    float atten = 1.0 / (1.0 + dist * dist * 0.55);
    float diff = dot(n, ld) * 0.5 + 0.5;
    return albedo * diff * diff * atten * vec3(1.00, 0.86, 0.66) * 3.0;
  }

  // The melt under the folding span: a warm updraft that only reaches the last
  // hall of the lap.
  vec3 furnaceLight(vec3 p, vec3 n, vec3 albedo, float zc) {
    float near = 1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 16.0, abs(cycd(zc - SPAN_MID)));
    if (near < 0.01) return vec3(0.0);
    // The melt is an enormous area source in an enclosure, so it does not only
    // light what faces down into it — the whole cut glows. Undersides still take
    // most of it; the walkway takes enough to be walkable.
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0) * 0.75 + 0.30;
    float depth = clamp((p.y - MELT_Y) / 34.0, 0.0, 1.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.z * 0.4, iTime * 1.7));
    return albedo * up * near * (1.0 - depth * 0.55) * flick * vec3(1.30, 0.44, 0.10);
  }

  vec3 shadeSurface(vec3 p, vec3 nGeo, vec3 rd, float dist, float zc, float dzl,
                    float W, float H, float sec) {
    float mat = gMat, wear = gWear;

    // Lamp glass is emissive and takes no lighting at all.
    if (mat > 3.5 && mat < 4.5)
      return mix(vec3(0.06, 0.06, 0.07), vec3(1.0, 0.76, 0.42) * 2.6, gGlow);

    // Molten metal is its own light source; the churn is what reads as liquid.
    if (mat > 7.5) {
      float churn = fbm(vec2(p.x * 0.5, p.z * 0.5 - iTime * 0.35));
      float crust = smoothstep(0.42, 0.30, churn);
      vec3 hot = mix(vec3(1.5, 0.42, 0.06), vec3(2.6, 1.5, 0.45), churn);
      return mix(hot * (0.55 + 0.45 * churn), vec3(0.10, 0.045, 0.03), crust * 0.8);
    }

    vec2 uv = surfUV(p, nGeo);
    float lod = detailFade(dist);
    vec3 n = bumpNormal(p, nGeo, mat, wear, 0.045 + 0.030 * lod, lod);
    float cav = mix(1.0, cavity(p, nGeo, mat, wear, lod), 0.55 + 0.45 * lod);
    // Plate is rolled along the hall, so the grain runs with +Z on the walls and
    // ceiling and across the floor.
    vec3 tang = abs(nGeo.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);

    // Broad corrosion blooms, metres across. Layered *under* the per-material
    // wear so the same wall is not the same wall twice thirty metres apart.
    float macro = bloom(uv);
    wear = clamp(wear * 0.72 + macro * 0.55, 0.0, 1.0);

    vec3 albedo; float rough;
    if (mat < 0.5) {
      // Structural plate: dark steel, rust blooming out of the wear field and
      // biting deepest in the pits, weld beads bright, grime running down.
      float rust = smoothstep(0.60, 0.95, wear + pitting(uv) * 0.35);
      albedo = mix(vec3(0.085, 0.090, 0.100), vec3(0.24, 0.115, 0.055), rust);
      albedo = mix(albedo, vec3(0.20, 0.21, 0.23), weldSeam(uv) * 0.55);
      albedo *= 1.0 - streaks(p, nGeo) * 0.35;
      albedo *= 1.0 + treadPlate(uv) * step(0.72, nGeo.y) * 0.45 * lod;
      albedo *= 0.85 + 0.30 * grain(uv);
      rough = mix(0.68, 0.94, rust);
    } else if (mat < 1.5) {
      // Painted frame: hazard stripes over primer, chipped back to bare steel
      // wherever it has been knocked.
      float stripe = step(0.5, fract((p.x * 0.6 + p.y * 0.6 + p.z * 0.6)));
      vec3 paint = mix(vec3(0.34, 0.24, 0.05), vec3(0.055, 0.050, 0.048), stripe);
      float chip = smoothstep(0.42, 0.72, wear + pitting(uv) * 0.4);
      albedo = mix(paint, vec3(0.11, 0.10, 0.10), chip);
      albedo *= 1.0 - streaks(p, nGeo) * 0.30;
      rough = mix(0.55, 0.90, chip);
    } else if (mat < 2.5) {
      // Offcut: hot-rolled mill scale, blue-black over grey steel.
      float scale = smoothstep(0.35, 0.75, fbm(uv * 9.0));
      albedo = mix(vec3(0.115, 0.125, 0.155), vec3(0.26, 0.16, 0.10), scale * wear);
      rough = mix(0.52, 0.82, scale);
    } else if (mat < 3.5) {
      // Machined: ground steel carrying the lamps as hard stretched highlights,
      // with an oil film pooled in the grooves.
      float turn = 0.5 + 0.5 * sin(uv.y * 210.0);
      albedo = mix(vec3(0.30, 0.315, 0.35), vec3(0.44, 0.45, 0.49), turn);
      albedo = mix(albedo, vec3(0.20, 0.19, 0.14), smoothstep(0.55, 0.9, fbm(uv * 3.0)) * 0.6);
      rough = mix(0.14, 0.34, turn * 0.5 + wear * 0.5);
    } else if (mat < 5.5) {
      // Rail steel: polished bright where the shoes ride, corroded either side.
      float pol = smoothstep(0.55, 0.15, abs(uv.x - floor(uv.x + 0.5)));
      albedo = mix(vec3(0.20, 0.19, 0.18), vec3(0.42, 0.43, 0.46), pol);
      albedo = mix(albedo, vec3(0.26, 0.13, 0.06), pitting(uv) * 0.8);
      rough = mix(0.52, 0.20, pol);
    } else {
      // Span plate: pale machined deck, brushed, hinge seams worn bright, and
      // scorched along the edges that have spent this long over a melt.
      albedo = vec3(0.40, 0.42, 0.48) * (0.86 + 0.28 * grain(uv));
      albedo = mix(albedo, vec3(0.19, 0.10, 0.07),
                  smoothstep(0.45, 0.85, fbm(uv * 2.2)) * 0.7);
      albedo *= 1.0 + treadPlate(uv) * 0.32 * lod;
      rough = mix(0.30, 0.62, macro);
    }

    // Dried coolant and efflorescence run down every vertical face. Pale, matte,
    // and the only thing in the palette that is not steel or rust.
    float salt = salting(p, nGeo);
    albedo = mix(albedo, vec3(0.42, 0.44, 0.43), salt * 0.55);
    rough = mix(rough, 0.96, salt * 0.7);

    // Cavity: crevices hold less light and no highlight at all.
    albedo *= 0.55 + 0.45 * cav;
    rough = mix(rough, min(1.0, rough + 0.25), 1.0 - cav);

    vec3 col = albedo * vec3(0.13, 0.145, 0.185);         // cool ambient bounce
    if (p.y < CEIL_MAX)
      col += lampLight(p, n, albedo, rough, rd, tang, W, H, sec);
    if (abs(dzl) < 7.0) {
      col += domeLight(p, n, albedo, rough, rd, dzl);
      if (p.y > 1.0)
        col += shaftLight(p, n, albedo, rough, rd, tang, dzl);
    }
    col += furnaceLight(p, n, albedo, zc);

    // Brake sparks throw a hard white-hot key off the rail contact patch, which
    // is the only thing lighting the cage while the shoes are working.
    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * 1.90, cageY() + 0.1, 0.0);
      vec3 sd = sp - vec3(p.x, p.y, dzl);
      float sdist = length(sd);
      float att = 1.0 / (1.0 + sdist * sdist * 0.10);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0) * att * spark()
        * vec3(3.4, 2.6, 1.5);
    }

    // Fresnel rim keeps the metal from flattening out at grazing angles, and the
    // cavity term occludes it: a rim highlight that survives inside a pit is the
    // single most plastic-looking thing a metal shader can do.
    col += vec3(0.10, 0.11, 0.14) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0)
      * (1.0 - rough) * cav;

    // What is behind the plate, once the plate has split.
    //
    // A mix, not an add. The additive version of this term is the one that blows
    // the whole frame out the moment the decay saturates — liminal makes exactly
    // this choice and it is the reason its abyss stays legible.
    float crack = crackField(p, decay());
    if (crack > 0.001) {
      vec3 core = vec3(2.2, 0.42, 0.05) * (0.75 + 0.55 * fbm(vec2(p.y * 2.0, iTime * 1.4)));
      col = mix(col, core, clamp(crack * 1.4, 0.0, 1.0));
    }
    return col;
  }

  /**
   * Oblivion has no lamps, no hall and no shaft, so none of the corridor's
   * lighting applies. What is left is the cage's own dome lamp, whatever the
   * shoes are still throwing off the rails above, and a red that comes up from
   * underneath and never gets any closer.
   */
  vec3 shadeOblivion(vec3 p, vec3 nGeo, vec3 rd, float dist, float dzl) {
    float mat = gMat, wear = gWear;
    if (mat > 3.5 && mat < 4.5)
      return mix(vec3(0.06, 0.06, 0.07), vec3(1.0, 0.76, 0.42) * 2.6, gGlow);

    vec2 uv = surfUV(p, nGeo);
    float lod = detailFade(dist);
    vec3 n = bumpNormal(p, nGeo, mat, wear, 0.045 + 0.030 * lod, lod);
    float cav = mix(1.0, cavity(p, nGeo, mat, wear, lod), 0.55 + 0.45 * lod);

    // Everything down here is the same scorched machine steel.
    float turn = 0.5 + 0.5 * sin(uv.y * 210.0);
    vec3 albedo = mix(vec3(0.22, 0.215, 0.235), vec3(0.36, 0.34, 0.34), turn);
    albedo = mix(albedo, vec3(0.30, 0.13, 0.05), smoothstep(0.42, 0.86, bloom(uv)));
    albedo *= 0.55 + 0.45 * cav;

    vec3 col = albedo * vec3(0.055, 0.050, 0.062);
    col += domeLight(p, n, albedo, 0.4, rd, dzl);

    // The updraft. Lit from below by something that is always the same distance
    // away, which is the only way a fall with no end can be lit at all.
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0) * 0.85 + 0.15;
    float flick = 0.80 + 0.20 * fbm(vec2(p.y * 0.5, iTime * 2.1));
    col += albedo * up * flick * vec3(1.05, 0.26, 0.05);

    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * 1.90, cageY() + 0.1, 0.0);
      vec3 sd = sp - vec3(p.x, p.y, dzl);
      float sdist = length(sd);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0)
        / (1.0 + sdist * sdist * 0.10) * spark() * vec3(3.4, 2.6, 1.5);
    }

    col += vec3(0.14, 0.06, 0.05) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * cav;
    return col;
  }

`
