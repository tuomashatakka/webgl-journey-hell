// The runner's head, and main(): set the per-pixel state, place the eye, march,
// light, and then what the air and the event do to the picture.

export const cameraGlsl = /* glsl */`
  float wrapPi(float a) { return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }

  float camLateral(float z) {
    return sin(gTm * 2.6) * 0.06 + win(z, 360.0, 372.0, 408.0, 420.0) * sin(gTm * 1.3) * 0.25;
  }

  /** Specks drifting across the screen, at most one per cell: snow, sparks, glass, ash. */
  float specks(vec2 uv, float scale, vec2 vel, float seed, float size) {
    vec2 g = uv * scale + vel * gTm;
    vec2 cell = floor(g);
    float h = hash21(cell + seed);
    vec2 o = (vec2(h, fract(h * 31.7)) - 0.5) * 0.6;
    return step(0.55, fract(h * 13.3)) * smoothstep(size, 0.0, length(fract(g) - 0.5 - o));
  }

  void main() {
    gTm = mod(iTime, 1000.0);
    gZ = playerZ();
    gZL = mod(gZ, LOOP_Z);
    gCamH = turnHeading(gZ);
    gDamage = damageAt(iTime);
    gCamW = routeW(gZ);
    setupBlast();
    setupLight();

    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float z = gZL;

    // The shockfront reaches the runner: one shove, then a hard ring-down.
    float hitE = gE - gArrive;
    float shove = exp(-hitE * hitE * 60.0);
    float ringDown = hitE > 0.0 ? exp(-hitE * 3.0) * sin(hitE * 70.0) : 0.0;
    uv += vec2(shove * 0.06 + ringDown * 0.012, ringDown * 0.018 - shove * 0.03);

    // --- the head ---
    float air = clamp(win(z, 224.0, 226.0, 238.0, 241.0) + win(z, 247.0, 249.0, 304.0, 308.0), 0.0, 1.0);
    float stride = gTm * 2.8;
    float bob = (abs(sin(stride * PI)) - 0.64) * 0.07 * (1.0 - air);
    float jolt = exp(-fract(stride) * 14.0) * 0.012 * (1.0 - air) * (0.3 + gDamage);
    vec3 ro = vec3(camLateral(z), pathY(gZ) + bob, gZ);

    // Glances: down at the cracking deck, back at the collapse — none while
    // jumping, riding or falling, and none once the sky has gone up.
    float blastOn = smoothstep(0.2, 1.0, gE) * (1.0 - smoothstep(64.0, 72.0, gE));
    float quiet = (1.0 - win(z, 214.0, 220.0, 336.0, 342.0)) * (1.0 - blastOn);
    float c1 = fract(iTime / 13.0 + 0.35);
    float back = (smoothstep(0.0, 0.05, c1) - smoothstep(0.13, 0.2, c1)) * quiet;
    float c2 = fract(iTime / 9.0);
    float down = (smoothstep(0.0, 0.06, c2) - smoothstep(0.16, 0.24, c2)) * quiet * (1.0 - back);

    float pathYaw = turnHeading(gZ + LOOKAHEAD) - gCamH;
    float blastYaw = blastOn * clamp(wrapPi(atan(gBlastDir.x, gBlastDir.z) - pathYaw) * 0.85, -1.1, 1.1);
    float yaw = pathYaw - 2.6 * back + blastYaw + uPointer.x * 0.45;
    float pitch = -0.07 - 0.55 * down - 0.2 * back
      - 0.45 * win(z, 222.0, 226.0, 236.0, 241.0)     // the jump: watch the landing
      - 0.40 * win(z, 246.0, 249.0, 256.0, 262.0)     // onto the train
      - 0.85 * win(z, 286.0, 290.0, 300.0, 304.0)     // off the end
      + 0.30 * win(z, 300.0, 304.0, 312.0, 324.0)     // caught: up the curve
      + 0.12 * win(z, 120.0, 132.0, 168.0, 180.0)     // the climb
      + blastOn * (0.06 + 0.2 * smoothstep(4.0, 30.0, gE))
      + jolt + uPointer.y * 0.3;
    float roll = 0.16 * win(z, 420.0, 432.0, 468.0, 480.0) + 0.3 * win(z, 288.0, 292.0, 300.0, 306.0)
      + 0.03 * sin(gTm * 2.1) * win(z, 258.0, 262.0, 284.0, 288.0);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 r0 = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 u0 = cross(fwd, r0);
    vec3 rd = normalize(uv.x * (r0 * cos(roll) - u0 * sin(roll)) + uv.y * (u0 * cos(roll) + r0 * sin(roll)) + 1.25 * fwd);

    // --- the march ---
    float t = 0.0, hit = 0.0;
    for (int i = 0; i < RM_STEPS; i++) {
      float d = map(ro + rd * t);
      if (d < 0.0012 * t + 0.0015) { hit = 1.0; break; }
      t += d * STEP_K;
      if (t > MAX_DIST) break;
    }

    vec3 col;
    if (hit > 0.5) {
      vec3 p = ro + rd * t;
      col = shade(p, rd, t);
      // Below the cloud tops there is only cloud.
      vec3 cloud = 0.9 * (mix(gHorizon, gZenith, 0.35) * 0.8 + gSunCol * 0.04);
      col = mix(col, cloud, smoothstep(SEA_Y + 5.0, SEA_Y - 25.0, p.y));
      col = mix(col, fogCol(rd), 1.0 - exp(-t * gHaze));
    } else {
      col = sky(rd, ro.y, 1.0);
    }

    // --- the air ---
    vec3 amb = mix(gHorizon, gZenith, 0.5);
    float snow = specks(uv, 14.0, vec2(0.35, -0.9), 1.0, 0.12) + specks(uv, 26.0, vec2(0.5, -1.4), 2.0, 0.1) * 0.7;
    col = mix(col, vec3(0.9, 0.93, 1.0) * (amb + 0.2), clamp(snow, 0.0, 1.0) * gFrost * 0.8);
    float sparks = specks(uv * vec2(1.0, 4.0), 9.0, vec2(-1.6, 0.6), 4.0, 0.16) * smoothstep(-0.2, -0.45, uv.y);
    col += vec3(1.0, 0.55, 0.15) * 2.5 * sparks * win(z, 260.0, 264.0, 284.0, 288.0);
    if (hitE > 0.0) {
      float glass = specks(uv, 22.0, vec2(0.1, -0.25), 5.0, 0.06) * step(0.6, fract(hash21(floor(uv * 22.0)) + gTm * 7.0));
      col += vec3(1.6) * glass * (1.0 - smoothstep(6.0, 14.0, hitE));
    }
    float ash = specks(uv, 18.0, vec2(0.15, -0.12), 9.0, 0.09) + specks(uv, 31.0, vec2(0.08, -0.2), 7.0, 0.07);
    col *= 1.0 - 0.6 * clamp(ash, 0.0, 1.0) * smoothstep(14.0, 24.0, gE);

    // --- the picture ---
    col = aces(col * gExposure * 0.8 * (1.0 + shove * 2.0));
    col = pow(col, vec3(1.0 / 2.2));
    col = mix(col, vec3(1.0), blastFlash(gE) * 0.97);
    // The crown dissolves into light across the seam (from the second lap: the first starts in the dawn).
    float seam = smoothstep(522.0, 540.0, z) + (1.0 - smoothstep(0.0, 9.0, z)) * step(LOOP_Z, gZ);
    col = mix(col, vec3(1.0, 0.98, 0.95), clamp(seam, 0.0, 1.0) * 0.55);
    col *= 1.0 - 0.25 * dot(uv, uv);
    gl_FragColor = vec4(col, 1.0);
  }
`
