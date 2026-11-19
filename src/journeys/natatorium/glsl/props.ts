export const propsGlsl = `  // --- the props ------------------------------------------------------------
  //
  // The materials of everything sectionProps() puts in a room, read off gMat at
  // the hit point.

  // Anything that is not the building. The same if-chain shape as the fittings
  // themselves, because it has to answer in the same order they were built in.
  void propSurface(vec3 qs, float mat, float dec, vec4 B, out vec3 alb, out float rough) {
    float n1 = hash21(floor(qs.xz * 7.0) + floor(qs.y * 7.0));
    if (mat < 1.5) {
      // Lane rope floats: red, white and blue in RUNS. The run is what makes a
      // line of spheres read as a lane rope instead of as beads on a string.
      float k = fract(floor(qs.z / 1.35) * 0.37 + floor(qs.x) * 0.11);
      alb = k < 0.34 ? vec3(0.58, 0.09, 0.07)
          : (k < 0.67 ? vec3(0.82, 0.83, 0.82) : vec3(0.09, 0.20, 0.52));
      // Each float is moulded with ribs, and they are all slightly sun-bleached
      // by a different amount.
      float rib = 0.82 + 0.18 * abs(sin(qs.z * 52.0));
      alb  *= rib * (0.80 + 0.35 * hash21(vec2(floor(qs.z / 0.36), 3.0)));
      alb   = mix(alb, vec3(0.20, 0.26, 0.16), smoothstep(0.25, 0.85, dec) * 0.45);
      rough = 0.30;
    }
    else if (mat < 2.5) {
      // Galvanised steel, going over to rust as the laps pile up.
      alb   = mix(vec3(0.42, 0.44, 0.46), vec3(0.36, 0.16, 0.07),
                  smoothstep(0.08, 0.70, dec) * (0.35 + 0.65 * n1));
      rough = 0.20;
    }
    else if (mat < 3.5) {
      // Municipal enamel. There is precisely one colour this is ever painted.
      alb   = vec3(0.29, 0.41, 0.35) * (0.78 + 0.42 * n1);
      alb   = mix(alb, vec3(0.30, 0.14, 0.07), smoothstep(0.3, 0.9, dec) * n1 * 0.5);
      rough = 0.28;
    }
    else if (mat < 4.5) {
      // Green. Dark, matte, and the only hue in the building that is not either
      // fluorescent white or rust. Kept genuinely dark: a lamp two metres away in
      // a service corridor puts 2.4x on this, and anything brighter comes back as
      // moulded plastic rather than as something growing.
      alb   = vec3(0.045, 0.098, 0.042) * (0.55 + 0.95 * n1);
      rough = 0.80;
    }
    else if (mat < 5.5) {
      // Cast concrete: the lift joint every pour left, the grain of the
      // shuttering boards it was poured against, and a dark wet foot where the
      // silt has climbed it. Faded to its mean with distance like the grout.
      float lf   = lodFade(0.03);
      float lift = (1.0 - smoothstep(0.008, 0.022, abs(latt(qs.y, 1.2)))) * (1.0 - lf);
      float grn  = vnoise(vec2((qs.x + qs.z) * 2.2, qs.y * 14.0));
      alb   = vec3(0.40, 0.40, 0.38) * (0.85 + 0.30 * n1) * (0.90 + 0.18 * mix(grn, 0.5, lf));
      alb  *= 1.0 - lift * 0.45;
      alb   = mix(alb, vec3(0.20, 0.21, 0.17), smoothstep(0.9, 0.0, qs.y) * (0.35 + 0.4 * dec));
      rough = 0.74;
    }
    else if (mat < 6.5) {
      // The cistern's columns: a pale limestone with a vein through it, each
      // column its own cut of the bed, the drums of the shaft set every 1.1 m
      // with a dark bed joint, the waterline's calcite crust and a silt-dark
      // foot that climbs higher as the building goes.
      float lf  = lodFade(0.025);
      vec2  cc  = floor(vec2(qs.x / CIST_PX + 0.5, qs.z / CIST_PZ + 0.5));
      float ch  = hash21(cc + 17.0);
      float vn  = vnoise(vec2((qs.x + qs.z) * 3.1 + ch * 40.0, qs.y * 1.3));
      float vein = (1.0 - smoothstep(0.0, 0.035, abs(vn - 0.5))) * (1.0 - lf);
      float drum = (1.0 - smoothstep(0.006, 0.016, abs(latt(qs.y + ch * 0.4, 1.1)))) * (1.0 - lf);
      alb  = mix(vec3(0.50, 0.48, 0.43), vec3(0.58, 0.55, 0.50), ch) * (0.88 + 0.22 * n1);
      alb *= 1.0 - vein * 0.28 - drum * 0.45;
      float wy = uWave.x - B.x;
      alb  = mix(alb, vec3(0.62, 0.62, 0.56), (1.0 - smoothstep(0.0, 0.10, abs(qs.y - wy))) * 0.55);
      alb  = mix(alb, vec3(0.16, 0.17, 0.13), smoothstep(1.4 + dec, 0.0, qs.y) * (0.45 + 0.35 * dec));
      alb  = mix(alb, alb * vec3(0.55, 0.72, 0.52), smoothstep(0.3, 0.8, vnoise(qs.xz * 2.0 + qs.y * 1.7)) * smoothstep(wy, wy - 1.2, qs.y) * 0.5);
      rough = 0.55;
    }
    else if (mat < 7.5) {
      // The cistern's vault: brick laid in courses along each barrel, read off
      // whichever of the two barrels this point is on (the nearer one), with
      // the courses running round the arch. Lime mortar, a lime bloom bleeding
      // out of it down the groins, and the bricks each their own firing.
      float vs = B.z - CIST_RX - 0.12;
      float vx = latt(qs.x + CIST_PX * 0.5, CIST_PX);
      float vz = latt(qs.z + CIST_PZ * 0.5, CIST_PZ) * (CIST_RX / CIST_RZ);
      float vy = max(qs.y - vs, 0.0) + 1e-4;
      float r1 = length(vec2(vx, vy));
      float r2 = length(vec2(vz, vy));
      vec2  bu = r1 < r2 ? vec2(qs.z, atan(vx, vy) * CIST_RX) : vec2(qs.x, atan(vz, vy) * CIST_RX);
      float cy = floor(bu.y / 0.075);
      bu.x += 0.125 * mod(cy, 2.0);
      vec2  bf = vec2(fract(bu.x / 0.25) * 0.25, fract(bu.y / 0.075) * 0.075);
      float be = min(min(bf.x, 0.25 - bf.x), min(bf.y, 0.075 - bf.y));
      float lf = lodFade(0.012);
      float mo = (1.0 - smoothstep(0.004, 0.010, be)) * (1.0 - lf);
      float bh = hash21(vec2(floor(bu.x / 0.25), cy) + 5.3);
      alb  = mix(vec3(0.36, 0.16, 0.10), vec3(0.50, 0.27, 0.17), mix(bh, 0.5, lf)) * (0.85 + 0.25 * n1);
      alb  = mix(alb, vec3(0.52, 0.50, 0.44), mo * 0.8);
      float groin = 1.0 - smoothstep(0.0, 0.35, abs(r1 - r2));
      float bloom = smoothstep(0.35, 0.75, vnoise(qs.xz * 0.9 + qs.y)) * (0.25 + 0.55 * dec);
      alb  = mix(alb, vec3(0.62, 0.62, 0.56), max(bloom, groin * 0.35) * 0.55);
      rough = mix(0.70, 0.45, mo);
    }
    else {
      // The plant room's sand filters: steel in a faded municipal blue-grey,
      // each vessel its own repaint, the plate seams welded round the shell,
      // rust weeping from the girth flange and the manway down the dished head
      // and the shell, a lime crust at the waterline and the silt-dark below it.
      float lf = lodFade(0.02);
      vec2  fc = vec2(floor(qs.z / PLANT_BAY), sign(qs.x));
      float vh = hash21(fc + 23.0);
      float u  = atan(qs.x - sign(qs.x) * (B.y - PLANT_OFF), latt(qs.z, PLANT_BAY) + 1.9) * 0.9;
      float sm = (1.0 - smoothstep(0.004, 0.012, abs(latt(qs.y - 0.05, 0.75)))) * (1.0 - lf);
      float mot = vnoise(vec2(u * 3.0, qs.y * 2.2) + vh * 31.0);
      alb  = mix(vec3(0.20, 0.29, 0.36), vec3(0.27, 0.34, 0.38), vh) * (0.86 + 0.20 * mot);
      alb *= 1.0 - sm * 0.35;
      float run = smoothstep(0.55, 0.85, vnoise(vec2(u * 9.0, qs.y * 0.6 + vh * 13.0)))
                * smoothstep(0.6, 2.2, qs.y) * smoothstep(2.25, 2.05, qs.y);
      alb  = mix(alb, vec3(0.34, 0.15, 0.06), clamp(run * (0.35 + 0.65 * dec), 0.0, 1.0));
      float wy = uWave.x - B.x;
      alb  = mix(alb, vec3(0.58, 0.58, 0.52), (1.0 - smoothstep(0.0, 0.09, abs(qs.y - wy))) * 0.5);
      alb  = mix(alb, vec3(0.13, 0.14, 0.11), smoothstep(wy, wy - 0.6, qs.y) * (0.45 + 0.35 * dec));
      rough = mix(0.42, 0.70, smoothstep(0.2, 0.8, dec) * mot);
    }
  }
`
