export const cameraGlsl = `  // ============================ CAMERA =====================================

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float dec = decay();

    // A glitch surge every time the lap turns over — the one moment the loop
    // admits to being a loop.
    float wrap = step(0.5, uWalk.y) * exp(-walkZ() * 0.45);

    // --- lens: barrel distortion that tightens as the lap decays -------------
    float r2 = dot(uv, uv);
    uv += uv * r2 * (0.030 + 0.34 * dec + 0.5 * wrap);

    // --- torn scanlines: whole slices of the world shift sideways -----------
    float tear = dec * 0.30 + wrap;
    if (tear > 0.02) {
      float bandY = floor(uv.y * 26.0 + iTime * 31.0);
      if (hash11(bandY * 0.137 + 3.0) < tear * 0.30)
        uv.x += (hash11(bandY * 1.71) - 0.5) * tear * 0.10;
    }

    // The camera is whatever the simulation is doing to you. Riding the cage it
    // is carried by the car, with the shake read off its jerk and the offcuts
    // hammering its floor; on foot it is the gait — the head drops on each heel
    // strike and rebounds on the leg spring, and the body rolls into the sway.
    // None of it is a function of iTime.
    vec3 ro = vec3(uGait.y + uSim.x * 0.018, uGait.x + uSim.y * 0.018, walkZ());
    float yaw = uGait.z + uPointer.x * 0.75 + uSim.x * 0.008;
    float pitch = uGait.w + uPointer.y * 0.50;
    float roll = uWalk.w + uSim.x * 0.02;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    // The fall widens the lens; nothing sells speed like the frame opening up.
    // In oblivion the cage reaches terminal velocity and its *acceleration* goes
    // back to nought, so weightless() lets go exactly when the fall is fastest —
    // down there the lens has to read the speed itself.
    float fov = 1.20 - 0.16 * weightless()
      - oblivion() * 0.13 * smoothstep(8.0, 44.0, abs(uCage.y));
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    float dist = 0.0, hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.0016 * dist + 0.0008) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    float zc = cyc(p.z);
    float dzl = cycd(zc - LIFT_Z);
    float sa, sb, st, stf;
    secBlend(zc, sa, sb, st, stf);
    vec2 pr = mix(secProfile(sa), secProfile(sb), st);
    float squeeze = 1.0 - dec * 0.18;

    // Background: the halls have no sky, only the melt burning under the last
    // one and the cold nothing of a shaft that runs out of lamps.
    vec3 col = vec3(0.012, 0.010, 0.014)
      + vec3(0.34, 0.10, 0.02) * pow(max(-rd.y, 0.0), 2.0)
        * (1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 20.0, abs(cycd(zc - SPAN_MID))));

    if (oblivion() > 0.5) {
      // No sky, no melt, no horizon. Only a red that is always the same distance
      // below and a dark that closes much faster than the halls' ever did.
      col = vec3(0.008, 0.006, 0.009)
        + vec3(0.40, 0.07, 0.015) * pow(max(-rd.y, 0.0), 3.0);
    }

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      if (oblivion() > 0.5) {
        col = mix(shadeOblivion(p, n, rd, dist, dzl), vec3(0.020, 0.008, 0.008),
                  1.0 - exp(-dist * 0.085));
      } else {
        col = shadeSurface(p, n, rd, dist, zc, dzl, pr.x * squeeze, pr.y * squeeze, sa);
        float fogDen = mix(0.038, 0.022, riding()) + dec * 0.012;
        vec3 fogCol = mix(vec3(0.030, 0.026, 0.030), vec3(0.045, 0.016, 0.012), dec);
        float fog = 1.0 - exp(-dist * fogDen);
        col = mix(col, fogCol, fog);
      }
    }

    // --- spark shower off the guide rails while the shoes are biting --------
    if (spark() > 0.01) {
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        // Sparks are thrown off the rail and fall behind the still-moving cage.
        vec3 sp = vec3(sign(seed - 0.5) * 1.90,
                       cageY() + 0.2 + fract(seed * 7.3) * 2.4,
                       walkZ() + cycd(LIFT_Z - walkZ()) + (fract(seed * 3.1) - 0.5) * 1.6);
        vec3 to = sp - ro;
        float along = dot(to, rd);
        if (along > 0.0) {
          float perp = length(to - rd * along);
          float g = exp(-perp * perp * 900.0) * exp(-along * 0.10);
          col += vec3(1.6, 0.95, 0.42) * g * spark() * 2.2;
        }
      }
    }

    // --- steam drifting off the machinery (heavy effects only) --------------
    if (uHeavy > 0.5) {
      float steam = fbm(vec2(uv.x * 3.0 + iTime * 0.15, uv.y * 3.0 - iTime * 0.55 + ro.y * 0.2));
      steam *= smoothstep(0.6, 1.0, steam) * 0.5;
      col += vec3(0.16, 0.15, 0.17) * steam * (0.3 + 0.7 * weightless());
    }

    // --- grade --------------------------------------------------------------
    // Free fall desaturates and cools, the brake flash blows the highlights out,
    // and the decay rots the whole grade toward oxblood.
    float wl = weightless();
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), wl * 0.30);
    col *= mix(vec3(1.0), vec3(0.86, 0.92, 1.10), wl);
    col += vec3(1.0, 0.8, 0.55) * spark() * 0.06;
    if (dec > 0.02) {
      vec3 rotten = vec3(col.r * 1.18, col.g * 0.74, col.b * 0.66);
      col = mix(col, rotten, dec * 0.55);
      // Spectral fringing: a single-pass march has no framebuffer to resample,
      // so the channels are separated radially on the graded image instead —
      // strongest at the edges, exactly where a real lens loses them.
      float fr = dot(uv, uv) * (dec * 0.55 + wrap);
      float lum0 = dot(col, vec3(0.299, 0.587, 0.114));
      col.r = mix(col.r, col.r * 1.25 + lum0 * 0.10, fr);
      col.b = mix(col.b, col.b * 0.80 + lum0 * 0.16, fr);
    }

    // Oblivion grades hard toward the thing underneath it, and the picture gets
    // noisier the longer the fall runs — which is the ramp the signal loss then
    // takes over from. See lib/signalLoss.
    float ob = oblivion();
    if (ob > 0.5) {
      float deep = clamp(fallen() / 900.0, 0.0, 1.0);
      col = mix(col, vec3(col.r * 1.35, col.g * 0.52, col.b * 0.44), 0.45 + deep * 0.35);
      col *= 1.0 - deep * 0.30;
    }

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.7, lum) * 0.5;                  // pseudo-bloom
    col = pow(clamp(col, 0.0, 1.8), vec3(0.90));

    // Thin TV scanlines, heavier the further round the lap you are.
    col -= (0.02 + 0.05 * dec) * sin(gl_FragCoord.y * 1.6 + iTime * 12.0);

    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * (0.65 + 0.12 * dec); // vignette
    // Sensor grain, heavier under acceleration and as the foundry comes apart.
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.050 * dec + 0.12 * wrap + 0.04 * clamp(abs(cageA()) / 40.0, 0.0, 1.0)
              + ob * 0.10 * clamp(fallen() / 600.0, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`
