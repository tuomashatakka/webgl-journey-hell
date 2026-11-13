export const dressingGlsl = `  // --- dressing -------------------------------------------------------------
  //
  // What a real pool hall has on top of its tile: the lane markings on the
  // basin floor, a coloured frieze course and a dark cove at the skirting, vents
  // in the upper wall, housings round the fittings, and the dirt -- tide lines
  // left by every level the flood has held, rust and lime running down from the
  // ceiling, silt banked against the walls, stains spreading across the soffit.
  //
  // Shading only, once per shaded point, after tileSurface. Everything is in the
  // sheared section frame tileSurface used, so it follows the ramps; everything
  // with an edge goes to its mean through lodFade before it can alias, for the
  // same reason the grout does.
  //
  // Skipped inside a break in the shell: a hole has no frieze.
  void dressSurface(vec3 qs, vec3 ns, float wy, vec4 B, vec4 C,
                    inout vec3 alb, inout vec3 nn, inout float rough) {
    float W    = B.y;
    float H    = B.z;
    float typ  = C.y;
    float dec  = decay();
    float face = min(min(W - abs(qs.x), qs.y), H - qs.y);
    if (face < -0.012) return;

    float far = lodFade(0.05);

    if (ns.y > 0.7) {
      // THE BASIN. The swimming halls are glazed in a pale aqua; the service
      // rooms keep the plain grey-white.
      alb *= typ < 0.5 ? vec3(0.78, 0.95, 0.98) : vec3(0.94, 0.95, 0.91);

      if (typ < 0.5) {
        // Lane lines down the middle of each lane (the ropes are between them),
        // with the T a metre and a half short of each end wall.
        float lx = abs(latt(qs.x + 1.2, 2.4));
        float lw = 0.10 + gDist * 0.002;
        float ln = (1.0 - smoothstep(lw, lw + 0.02, lx)) * step(abs(qs.x), W - 1.0);
        float ez = min(abs(qs.z - 1.5), abs(qs.z - (B.w - 1.5)));
        ln = max(ln, (1.0 - smoothstep(lw, lw + 0.02, ez)) * step(lx, 0.55) * step(abs(qs.x), W - 0.6));
        ln = mix(ln, 0.08, far);
        alb = mix(alb, vec3(0.05, 0.08, 0.22), ln * 0.85);
      }

      // A sump grate against each wall every nine metres: slots, and a dark
      // ring of silt drawn into it.
      vec2  dg = vec2(abs(qs.x) - (W - 0.55), latt(qs.z, 9.0));
      float gb = max(abs(dg.x), abs(dg.y));
      float gr = (1.0 - smoothstep(0.20, 0.22, gb)) * (1.0 - far);
      alb *= 1.0 - gr * (0.45 + 0.40 * step(0.5, fract(dg.y * 16.0)));
      alb *= 1.0 - 0.30 * smoothstep(0.55, 0.20, gb) * (1.0 - far * 0.5);
      rough = mix(rough, 0.25, gr);

      // Silt banked into the cove, deeper as the building goes.
      float bank = smoothstep(1.1, 0.0, W - abs(qs.x));
      alb = mix(alb, vec3(0.20, 0.22, 0.15), bank * (0.20 + 0.45 * dec) * C.z * 1.4);
    }
    else if (ns.y < -0.7) {
      // THE SOFFIT. Damp has come through it in rings: a pale bloom with a
      // darker tide edge, the brown that runs down the walls from here.
      float st = vnoise(qs.xz * 0.30 + B.w) * 0.65 + vnoise(qs.xz * 1.20 + 3.3) * 0.35;
      float sm = smoothstep(0.52, 0.80, st) * (0.30 + 0.50 * dec);
      float rim = smoothstep(0.05, 0.0, abs(st - 0.56)) * (0.20 + 0.40 * dec) * (1.0 - far);
      alb = mix(alb, vec3(0.46, 0.38, 0.26), sm * 0.6);
      alb *= 1.0 - rim * 0.45;

      // The housing round every fitting: a dark enamel tray a hand wider than
      // the diffuser. The panel itself is the emissive term in shadeFace.
      float sp = max(C.w, 2.0);
      float lz = qs.z - (floor(qs.z / sp) + 0.5) * sp;
      vec2  hb = abs(vec2(qs.x, lz)) - vec2(W * 0.56 + 0.07, 0.34);
      float hs = 1.0 - smoothstep(0.0, 0.015 + gDist * 0.002, max(hb.x, hb.y));
      alb   = mix(alb, vec3(0.16, 0.17, 0.17), hs);
      rough = mix(rough, 0.35, hs);

      // Shadow pooling into the ceiling corners.
      alb *= 0.62 + 0.38 * smoothstep(0.0, 0.9, W - abs(qs.x));
    }
    else {
      // THE WALLS.
      float y = qs.y;
      float u = abs(ns.x) > 0.7 ? qs.z : qs.x;

      // A dark cove course at the skirting, the way pool walls are finished,
      // and the frieze: one course of colour at about head height, a different
      // one for each kind of room, and a cream bead tile over it. Tile courses
      // both, so the raw concrete rooms have neither.
      if (typ < 4.5) {
        alb = mix(alb, alb * vec3(0.32, 0.38, 0.40), 1.0 - smoothstep(0.12, 0.16, y));
        float fy  = min(2.10, H - 0.75);
        vec3  frc = typ < 0.5 ? vec3(0.10, 0.42, 0.46)
                  : (typ < 2.5 ? vec3(0.16, 0.30, 0.55) : vec3(0.42, 0.40, 0.22));
        float fr  = 1.0 - smoothstep(0.10, 0.11, abs(y - fy));
        float bd  = 1.0 - smoothstep(0.022, 0.03, abs(y - fy - 0.14));
        alb = mix(alb, alb * frc * 1.5, fr);
        alb = mix(alb, alb * vec3(1.02, 0.96, 0.80), bd * (1.0 - far));
      }

      // Tide lines: every level the flood held before this one, brown and
      // ragged, fading the further above the present one they are.
      for (int k = 0; k < 3; k++) {
        float fk  = float(k);
        float jag = (vnoise(vec2(u * 1.7, fk * 5.0)) - 0.5) * 0.08;
        float yk  = wy + 0.24 + fk * 0.23 + jag;
        float tl  = 1.0 - smoothstep(0.012, 0.045, abs(y - yk));
        alb = mix(alb, alb * vec3(0.62, 0.55, 0.42), tl * (0.55 - fk * 0.14) * (0.5 + C.z));
      }

      // Runs down from the soffit: rust and lime in streaks that start at the
      // ceiling and thin out toward the water.
      float sr = vnoise(vec2(u * 5.5, y * 0.22 + B.w)) * vnoise(vec2(u * 1.6 + 4.0, y * 0.11));
      float sk = smoothstep(0.24, 0.48, sr) * smoothstep(wy + 0.2, H, y) * (0.25 + 0.55 * dec + C.z * 0.3);
      alb = mix(alb, alb * vec3(0.66, 0.52, 0.36), sk);

      // Dark in the corners: under the soffit, into the cove, and round the
      // doorway reveals at both ends.
      alb *= 0.70 + 0.30 * smoothstep(0.0, 0.7, H - y);
      alb *= 0.80 + 0.20 * smoothstep(0.0, 0.35, y);

      // Ventilation grilles high on the side walls, one every second lamp: a
      // painted frame, slats that catch the light on their top edge, and a dirt
      // shadow fanning up the wall above each one.
      if (abs(ns.x) > 0.7 && H > 2.7) {
        float sp  = max(C.w, 2.0) * 2.0;
        vec2  vg  = vec2(latt(qs.z, sp), y - (H - 0.62));
        vec2  vb  = abs(vg) - vec2(0.38, 0.17);
        float vm  = max(vb.x, vb.y);
        float fin = (1.0 - smoothstep(-0.005, 0.0, vm)) * (1.0 - far);
        float frm = (1.0 - smoothstep(0.035, 0.045, vm)) * (1.0 - far);
        float sl  = fract(vg.y * 18.0);
        alb   = mix(alb, vec3(0.34, 0.35, 0.33), frm);
        alb   = mix(alb, vec3(0.05, 0.05, 0.05) + vec3(0.30) * smoothstep(0.65, 0.95, sl), fin);
        nn    = normalize(nn + vec3(0.0, (sl - 0.5) * 0.8, 0.0) * fin);
        rough = mix(rough, 0.40, frm);
        alb  *= 1.0 - 0.35 * smoothstep(0.6, 0.0, length(vec2(vg.x * 0.8, max(vg.y - 0.17, 0.0) * 1.3))) * (1.0 - frm);
      }
    }
  }

`
