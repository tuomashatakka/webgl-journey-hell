export const cameraGlsl = `  // --- first-person camera choreography ------------------------------------
  // Periodic over-the-shoulder glance at the collapse (0..1), shared by yaw+pitch.
  float glanceAmt() {
    float cyc = fract(iTime * 0.11);
    return clamp(smoothstep(0.05, 0.12, cyc) - smoothstep(0.20, 0.34, cyc), 0.0, 1.0);
  }
  float camLateral(float z) {
    float x = sin(iTime * 2.5) * 0.10;                                 // run sway
    x += win(z, 360.0, 372.0, 408.0, 420.0) * sin(z * 0.12 + iTime * 1.5) * 1.3;  // 7 storm
    x += win(z, 420.0, 432.0, 468.0, 480.0) * sin((z - 420.0) / 60.0 * PI * 2.0) * 1.0; // 8 helix
    return x;
  }
  float camPitch(float z) {
    float p = 0.0;
    p += -0.50 * win(z, 222.0, 228.0, 238.0, 242.0);   // jump down: look down
    p += -0.42 * win(z, 240.0, 244.0, 250.0, 254.0);   // leap onto train
    p += -0.85 * win(z, 288.0, 292.0, 300.0, 304.0);   // free fall: pitch down hard
    p +=  0.16 * win(z, 120.0, 135.0, 165.0, 180.0);   // ascent: glance up
    p +=  0.18 * win(z, 300.0, 312.0, 324.0, 336.0);   // catch climb: glance up
    p += -0.34 * glanceAmt();                          // look down at the collapsing deck while glancing back
    p += sin(iTime * 9.0) * 0.012;                     // run bob pitch
    return p;
  }
  float camYaw(float z) {
    float y = pathHeading(z);
    y += glanceAmt() * (-2.7);                         // glance over the shoulder at the collapse (~155 deg)
    y += win(z, 288.0, 293.0, 300.0, 306.0) * (-2.7);  // forced look back during the fall
    return y;
  }
  float camRoll(float z) {
    float r = win(z, 420.0, 432.0, 468.0, 480.0) * 0.3 * sin((z - 420.0) / 60.0 * PI); // helix bank
    r += win(z, 288.0, 294.0, 300.0, 306.0) * 0.4;     // fall tilt
    return r;
  }

  void mainScene(out vec3 outCol) {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // The wave hits the camera. One shove and a hard ring-down — a shockfront is
    // a single overpressure edge, not a rumble, and drawing it as a rumble is
    // what makes most versions of this read as a stock earthquake.
    {
      float b = blast();
      if (b > 0.001) {
        float hk = (b - 0.30) * 22.0;
        float hit = exp(-hk * hk);
        float ring = exp(-max(0.0, b - 0.30) * 22.0) * sin(b * 620.0);
        uv += vec2(hit * 0.085 + ring * 0.020, ring * 0.030 - hit * 0.045);
        // ...and the air over a burning sky does not stay still afterwards.
        uv += (fbm(uv * 7.0 + iTime * 0.7) - 0.5) * smoothstep(0.10, 0.6, b) * 0.020;
      }
    }
    setupAtmosphere();

    float z = playerZ();
    float air = win(z, 224.0, 230.0, 238.0, 244.0) + win(z, 286.0, 290.0, 300.0, 308.0);
    float bob = sin(iTime * 9.0) * 0.05 * (1.0 - clamp(air, 0.0, 1.0));
    vec3 ro = vec3(camLateral(z), pathY(z) + bob, z);

    float towerLook = max(
      win(z, 174.0, 186.0, 226.0, 238.0),
      win(z, 354.0, 366.0, 414.0, 426.0)
    );
    float pitch = camPitch(z) + towerLook * 0.12 + uPointer.y * 0.25;
    float yaw   = camYaw(z) + uPointer.x * 0.45;
    float towerSide = mix(-1.0, 1.0, step(0.5, hash21(vec2(floor(z / 52.0), 4.7))));
    yaw += towerLook * towerSide * 0.55;
    float roll  = camRoll(z);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.3;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);
    float attention = clamp(win(z, 286.0, 292.0, 302.0, 308.0) + 0.5 * fract(iTime * 0.11), 0.0, 1.0);

    float dist = 0.0, hit = -1.0; vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.002 * dist + 0.001) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    vec3 col = skyBg(rd);
    if (hit > 0.0) {
      float thick = gThick, fell = gFell, spark = gSpark, matId = gMat;
      vec3 n = calcNormal(p);
      vec3 surf;
      if (matId > 1.5) {
        // skyscraper: cold curtain wall whose lit grid breaks apart with it
        float cosT = clamp(dot(n, -rd), 0.0, 1.0);
        float fres = 0.08 + 0.92 * pow(1.0 - cosT, 5.0);
        float windows = step(0.48, fract(p.y * 0.55)) * step(0.38, fract((p.x + p.z) * 0.42));
        vec3 wall = mix(vec3(0.12, 0.18, 0.24), gKeyCol * 0.62, windows * 0.7);
        surf = mix(wall, environment(reflect(rd, n), 2.5), 0.2 + fres * 0.48);
        surf += spark * gKeyCol * (0.12 + fres * 0.7);
      } else if (matId > 0.5) {
        // train: dark metal curtain, reflective, hot edge glints
        float cosT = clamp(dot(n, -rd), 0.0, 1.0);
        float fres = 0.05 + 0.95 * pow(1.0 - cosT, 5.0);
        vec3 metal = mix(vec3(0.05, 0.06, 0.08), vec3(0.14, 0.16, 0.20), step(0.5, fract(p.y * 0.7 + p.z * 0.3)));
        surf = mix(metal, environment(reflect(rd, n), gRough * 6.0), 0.30 + 0.5 * fres);
        surf += gKeyCol * pow(max(dot(reflect(rd, n), gKeyDir), 0.0), 90.0) * (1.0 + gBloom * 2.0);
      } else {
        surf = shadeGlass(rd, n, p, thick, fell);
        if (spark > 0.01) {
          float tw = hash21(floor(p.xz * 3.0) + floor(iTime * 30.0));
          surf += step(0.92, tw) * spark * 2.0 + spark * vec3(1.0, 0.98, 0.95) * 0.12;
        }
      }
      float haze = 1.0 - exp(-dist * gFogDen);
      col = mix(surf, skyBg(rd), haze);
    }

    // grade + pseudo-bloom
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.85, 1.6, lum) * gBloom * 0.45;
    col = pow(clamp(col, 0.0, 1.6), vec3(0.92));
    col *= mix(vec3(1.0), vec3(1.02, 1.03, 1.06), gSky);
    float edge = smoothstep(0.45, 0.98, length(uv));
    col = mix(col, mix(col, vec3(dot(col, vec3(0.33))), 0.25), edge * attention * 0.35);

    // --- what the detonation does to the camera itself --------------------
    float b = blast();
    if (b > 0.001) {
      float cool = smoothstep(0.16, 0.85, b);

      // The flash. A brief, total white-out — the sensor has no headroom for a
      // star at this range and neither would an eye. It is over in about a
      // second and everything after it is the recovery.
      float white = smoothstep(0.0, 0.035, b) * (1.0 - smoothstep(0.035, 0.14, b));
      col = mix(col, vec3(1.7), white * 0.96);

      // Then the sensor comes back wrong: bleached, then burnt down to ember,
      // with the highlights permanently blooming afterwards.
      // Bleached, then burnt down to ember — but *not* dimmed. A burning sky is
      // a bright thing, and the signal loss on top of this is already taking
      // most of the level out; dimming here as well left a black screen with a
      // caption on it instead of a world ending.
      col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))) * vec3(1.45, 0.66, 0.44),
                cool * 0.70);

      // The pressure wave arrives after the light does, and it arrives *here*.
      // A single hard shove through the frame, not a rumble: the geometry is
      // authored in GLSL so the camera cannot be shaken from the CPU, and this
      // is the honest place to do it.
      float hk = (b - 0.30) * 26.0;
      float hit = exp(-hk * hk);
      col += (hash21(gl_FragCoord.xy + fract(iTime) * 57.3) - 0.5) * hit * 0.55;
      col *= 1.0 + hit * 0.9;
    }
    outCol = col;
  }

  void main() { vec3 col; mainScene(col); gl_FragColor = vec4(col, 1.0); }
`
