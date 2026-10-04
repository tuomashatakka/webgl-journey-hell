export const cameraGlsl = /* glsl */`
  // ============================ CAMERA =====================================

  /** One lamp's glow in the air along the ray, in closed form (Macklin's single scattering). */
  float glowOf(vec3 ro, vec3 rd, vec3 lp, float tmax) {
    vec3 o = ro - lp;
    float b = dot(rd, o);
    float h = sqrt(max(dot(o, o) - b * b, 1e-4));
    return (atan((tmax + b) / h) - atan(b / h)) / h;
  }

  /** The glow of hall sec's lamps, five of them from world z0 on. */
  vec3 hallGlow(vec3 ro, vec3 rd, float tmax, float sec, float z0) {
    vec2 pr = secProfile(sec) * (1.0 - decay() * 0.18);
    float sp = secLampSpacing(sec);
    float band = floor(z0 / sp);
    float g = 0.0;
    for (int k = 0; k < 5; k++) {
      float bi = band + float(k);
      float lz = (bi + 0.5) * sp;
      if (abs(secIndexAt(cyc(lz)) - sec) > 0.5 || lampDead(bi)) continue;
      float side = mod(bi, 2.0) * 2.0 - 1.0;
      g += glowOf(ro, rd, vec3(side * (pr.x - 0.22), pr.y - 0.62, lz), tmax) * smoothstep(0.15, 0.75, deployStation(lz));
    }
    return lampRadiance(sec) * g;
  }

  /**
   * Red light leaking through the split plate, as the air carries it: sheets
   * off the cracks in the walls and up out of the floor. From the second lap.
   */
  float leakAt(vec3 p, float W) {
    float dv = decayVis();
    if (dv < 0.12) return 0.0;
    // The crack field's own veins, taken wide: the light fans out of a split.
    vec3 w = vec3((p.x < 0.0 ? -1.0 : 1.0) * W, p.y, p.z);
    float vw = sin(w.x * 3.5 + cos(w.z * 4.5)) * cos(w.z * 3.1 + sin(w.y * 4.0));
    float vf = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1);
    float wall = smoothstep(0.1, 0.0, abs(vw)) * exp(-max(W - abs(p.x), 0.0) * 0.8);
    float flo = smoothstep(0.1, 0.0, abs(vf)) * exp(-max(p.y, 0.0) * 0.6);
    float blot = smoothstep(0.3, 0.75, sin(p.x * 0.35) * cos(p.z * 0.45) * 0.5 + 0.3 + dv * 0.4);
    float shafts = 0.55 + 0.45 * sin(p.y * 2.3 + p.z * 1.7 + iTime * 0.8) * sin(p.z * 3.1 - iTime * 0.5);
    return (wall + flo) * blot * shafts * dv;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float dec = decayVis();

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
    // hammering its floor; on foot it is the gait. None of it is a function of
    // iTime. Falling, the head goes down: you watch the shaft come up through
    // the mesh floor, and the faster it comes the further down you look.
    vec3 ro = vec3(uGait.y + uSim.x * 0.018, uGait.x + uSim.y * 0.018, walkZ());
    float fallLook = riding() * (0.45 * weightless() + 0.30 * smoothstep(3.0, 18.0, -uCage.y)) + oblivion() * 0.35;
    float yaw = uGait.z + uPointer.x * 0.75 + uSim.x * 0.008;
    float pitch = max(uGait.w + uPointer.y * 0.50 - fallLook, -1.25);
    float roll = uWalk.w + uSim.x * 0.02;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    // The fall widens the lens; nothing sells speed like the frame opening up.
    float fov = 1.20 - 0.16 * weightless()
      - oblivion() * 0.13 * smoothstep(8.0, 44.0, abs(uCage.y));
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    // The march gathers the air on the way: steam off the flanges, and the red
    // the cracks let through.
    float dist = 0.0, hit = -1.0;
    float steam = 0.0, leak = 0.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.0016 * dist + 0.0008) { hit = 1.0; break; }
      float stepL = d * STEP_K;
      if (oblivion() < 0.5 && p.y < CEIL_MAX) {
        float zc = cyc(p.z);
        float sec = secIndexAt(zc);
        vec2 pr = secProfile(sec) * (1.0 - decay() * 0.18);
        float w = min(stepL, 1.2);
        steam += steamAt(p, zc, pr.x, pr.y, sec) * w;
        leak += leakAt(p, pr.x) * w;
      }
      dist += stepL;
      if (dist > MAX_DIST) break;
    }

    // Derivatives of the hit for the texture lookups, taken here where every
    // pixel of the quad still runs the same code.
    vec3 dpx = dFdx(p), dpy = dFdy(p);

    float zc = cyc(p.z);
    float dzl = cycd(zc - LIFT_Z);
    float sa, sb, st, stf;
    secBlend(zc, sa, sb, st, stf);
    vec2 pr = mix(secProfile(sa), secProfile(sb), st);
    float squeeze = 1.0 - decay() * 0.18;

    // Background: the halls have no sky, only the melt burning under the last
    // one and the cold nothing of a shaft that runs out of lamps.
    vec3 col = lin(vec3(0.012, 0.010, 0.014))
      + vec3(0.6, 0.1, 0.01) * pow(max(-rd.y, 0.0), 2.0)
        * (1.0 - smoothstep(SPAN_HALF, SPAN_HALF + 20.0, abs(cycd(zc - SPAN_MID))));
    if (oblivion() > 0.5)
      col = vec3(0.00006) + vec3(0.7, 0.05, 0.004) * pow(max(-rd.y, 0.0), 3.0);

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      if (oblivion() > 0.5) {
        col = mix(shadeOblivion(p, n, rd, dzl, dpx, dpy), vec3(0.0003, 0.00005, 0.00005), 1.0 - exp(-dist * 0.085));
      } else {
        col = shadeSurface(p, n, rd, zc, dzl, pr.x * squeeze, pr.y * squeeze, sa, dpx, dpy);
        float fogDen = mix(0.038, 0.022, riding()) + dec * 0.012;
        col = mix(col, lin(mix(vec3(0.030, 0.026, 0.030), vec3(0.045, 0.016, 0.012), dec)), 1.0 - exp(-dist * fogDen));
      }
    }

    // --- the air: lamp glow, steam, the leaks --------------------------------
    if (oblivion() < 0.5) {
      float zc0 = cyc(ro.z);
      float a0 = secIndexAt(zc0);
      float start = ro.z - (zc0 - a0 * SEC_LEN);
      float sp = secLampSpacing(a0);
      vec3 glow = hallGlow(ro, rd, dist, a0, ro.z - sp) + hallGlow(ro, rd, dist, mod(a0 + 1.0, SEC_COUNT), start + SEC_LEN);
      col += glow * 0.005 * (1.0 + dec * 0.6);
      vec3 steamCol = hallAmbient(a0) * 3.0 + lampRadiance(a0) * 0.04;
      col = mix(col, steamCol, 1.0 - exp(-steam * 1.4));
      // Saturating: by the fourth lap the air is red, never a red wall.
      col += vec3(1.0, 0.08, 0.02) * (1.0 - exp(-leak * leakI() * 0.9)) * 1.1;
    }

    // --- spark shower off the guide rails while the shoes are biting --------
    if (spark() > 0.01) {
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        vec3 sp = vec3(sign(seed - 0.5) * 1.90,
                       cageY() + 0.2 + fract(seed * 7.3) * 2.4,
                       walkZ() + cycd(LIFT_Z - walkZ()) + (fract(seed * 3.1) - 0.5) * 1.6);
        vec3 to = sp - ro;
        float along = dot(to, rd);
        if (along > 0.0) {
          float perp = length(to - rd * along);
          col += vec3(4.0, 1.9, 0.5) * exp(-perp * perp * 900.0) * exp(-along * 0.10) * spark() * 2.2;
        }
      }
    }

    // --- grade --------------------------------------------------------------
    // Free fall desaturates and cools, the brake flash blows the highlights
    // out, and the decay rots the whole grade toward oxblood.
    float wl = weightless();
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), wl * 0.30);
    col *= mix(vec3(1.0), vec3(0.86, 0.92, 1.10), wl);
    col += vec3(1.0, 0.6, 0.3) * spark() * 0.02;
    col = aces(col * 0.9);
    if (dec > 0.02) {
      col = mix(col, vec3(col.r * 1.18, col.g * 0.74, col.b * 0.66), dec * 0.55);
      float fr = dot(uv, uv) * (dec * 0.55 + wrap);
      float lum0 = dot(col, vec3(0.299, 0.587, 0.114));
      col.r = mix(col.r, col.r * 1.25 + lum0 * 0.10, fr);
      col.b = mix(col.b, col.b * 0.80 + lum0 * 0.16, fr);
    }
    float ob = oblivion();
    if (ob > 0.5) {
      float deep = clamp(fallen() / 900.0, 0.0, 1.0);
      col = mix(col, vec3(col.r * 1.35, col.g * 0.52, col.b * 0.44), 0.45 + deep * 0.35);
      col *= 1.0 - deep * 0.30;
    }
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));

    // Thin TV scanlines, heavier the further round the lap you are.
    col -= (0.02 + 0.05 * dec) * sin(gl_FragCoord.y * 1.6 + iTime * 12.0);
    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * (0.65 + 0.12 * dec);
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.050 * dec + 0.12 * wrap + 0.04 * clamp(abs(cageA()) / 40.0, 0.0, 1.0)
              + ob * 0.10 * clamp(fallen() / 600.0, 0.0, 1.0));

    fragColor = vec4(col, 1.0);
  }
`
