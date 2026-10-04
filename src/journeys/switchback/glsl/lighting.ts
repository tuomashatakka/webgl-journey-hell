export const lightingGlsl = `  // ---- lights --------------------------------------------------------------

  vec3 directLight(vec3 q, vec3 n, vec3 vdir, float rough, float ao) {
    Room r = roomAt(q.z);

    vec3 tint = lampTint(r.type);
    vec3 col = vec3(0.0);

    if (r.lamp > 0.5 && r.lit > 0.01) {
      vec3 lv = lampPos(q, r) - q;
      float ld = max(length(lv), 0.08);
      vec3 l = lv / ld;
      float atten = 1.0 / (1.0 + ld * 0.16 + ld * ld * 0.05);

      // Fluorescent buzz, and lamps that have started to give up. Per lamp, not
      // per room, so the failure reads as a building rather than as a dimmer.
      float flick = 1.0 - uAtm.x * 0.55 *
        step(0.90, hash21(vec2(floor(iTime * 12.0), floor(phaseAt(q.z) / max(r.lamp, 1.0)))));

      float sh = shadowTo(q, l, min(ld, 16.0));
      float k = atten * r.lit * flick * sh;

      col += tint * max(dot(n, l), 0.0) * k * 3.4;
      vec3 h = normalize(l + vdir);
      col += tint * pow(max(dot(n, h), 0.0), mix(8.0, 220.0, 1.0 - rough)) * k * (1.0 - rough) * 2.2;
    }

    // The cart's headlamp. The one light that is in every room, and the reason
    // the dark half of this journey is legible at all. Unshadowed on purpose —
    // it sits inside the cart's own geometry, and a shadow ray from there spends
    // its whole budget escaping the tub.
    {
      vec3 hv = vec3(0.0, 0.80, 1.5) - q;
      float hd = max(length(hv), 0.20);
      vec3 l = hv / hd;
      float cone = smoothstep(0.50, 0.95, dot(-l, normalize(vec3(uRide.z * 0.4, -0.10, -1.0))));
      float bump = 0.88 + 0.12 * sin(iTime * 37.0) * min(1.0, uCart.y / 12.0);
      col += vec3(1.00, 0.93, 0.80) * max(dot(n, l), 0.0) *
             (1.0 / (1.0 + hd * hd * 0.010)) * cone * bump * 2.8;
    }

    if (r.sky > 0.01) {
      // The sun's shadow is the one term here worth switching off. uHeavy is a
      // uniform, so the branch is coherent across the whole draw and the fourteen
      // map evaluations behind it are genuinely skipped rather than masked.
      float sh = uHeavy > 0.5 ? mix(1.0, shadowTo(q, uSun.xyz, 30.0), 0.85) : 1.0;
      vec3 sunCol = mix(vec3(1.00, 0.72, 0.58), vec3(0.78, 0.46, 0.52), uAtm.y * 0.6);
      col += sunCol * max(dot(n, uSun.xyz), 0.0) * r.sky * sh * 3.4;
    }

    // Ambient: the room's own fog bounced back, plus whatever the weather gets in.
    vec3 amb = roomFog(r.type, r.grime) * 3.0 + skyAmbient(r.type, uAtm.y) * r.sky * 0.65;
    return col + amb * (0.45 + 0.55 * max(dot(n, uUp.xyz), 0.0)) * ao;
  }

  // ---- volumetrics ---------------------------------------------------------

  /**
   * The lamps seen through the air rather than off a surface. Room resolved per
   * sample, for the same reason the surface term resolves it: a halo swept along
   * a ray goes wherever you look, so it has to be evaluated where it *is*, not
   * where the cart is — otherwise every halo on screen jumps the instant the slot
   * window advances while nothing behind it moves.
   */
  vec3 lampGlow(vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    // Jittered start, so sixteen samples do not draw sixteen shells.
    float j = hash21(gl_FragCoord.xy) * VOL_STEP;

    for (int k = 0; k < 16; k++) {
      float t = j + (float(k) + 0.5) * VOL_STEP;
      if (t > tMax) break;
      float w = clamp((tMax - t) / VOL_STEP, 0.0, 1.0);   // the boundary sample, faded

      vec3 q = toTrack(rd * t);
      Room r = roomAt(q.z);
      if (r.lamp < 0.5) continue;

      float d = length(q - lampPos(q, r));
      acc += lampTint(r.type) * r.lit * (0.05 / (0.06 + d * d * 0.24)) * w;
    }
    return acc * VOL_STEP * 0.055;
  }

  /**
   * Shafts: the vent holes over the drift, the clerestory over the concourse,
   * whatever is behind the chapel's ribs.
   *
   * Built from lattAbs rather than latt, because a term accumulated along a ray
   * has to be continuous in space or it draws its own quantisation — adjacent
   * pixels' taps land in the same cell, the per-cell answer is flat across it,
   * and what appears on screen is a rectangle rather than a shaft.
   */
  /**
   * Light coming through the fissures.
   *
   * Sampled on the wall the beam comes through rather than at the sample point:
   * a crack is a thing on a surface and the shaft of light is the air in front
   * of it. Reading the field where the sample happens to be gives fog with a
   * pattern in it — which is a completely different and much worse effect.
   */
  float riftBeam(vec3 q, Room r) {
    // A crack needs a wall to be in. The void and the overlook have none, and
    // putting beams in them hangs the light in mid-air across an open sky.
    if (uFall.w < 0.03 || r.bore > 50.0) return 0.0;

    float wall = r.bore;
    float side = q.x < 0.0 ? -1.0 : 1.0;
    float f = fissure(fissureUV(q, side), uFall.w);

    // The wedge: full against the wall, gone before the middle of the room.
    float inward = smoothstep(wall * 1.05, wall * 0.12, abs(q.x));
    return f * inward * uFall.w * (0.45 + uFall.x * 1.7);
  }

  vec3 shafts(vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    float j = hash21(gl_FragCoord.xy + 17.3) * VOL_STEP * 2.0;

    for (int k = 0; k < 10; k++) {
      float t = j + (float(k) + 0.5) * VOL_STEP * 2.0;
      if (t > tMax) break;
      float w = clamp((tMax - t) / (VOL_STEP * 2.0), 0.0, 1.0);

      vec3 q = toTrack(rd * t);

      Room r = roomAt(q.z);

      // The rift beams need no sky. The light is coming through the wall, and a
      // sealed room is exactly where that reads hardest — so this is accumulated
      // before the daylight branches, not inside them.
      acc += vec3(1.00, 0.09, 0.05) * riftBeam(q, r) * w * 2.0;

      if (r.sky < 0.03) continue;

      float zp = phaseAt(q.z);
      vec3 tone;
      float m;

      if (r.type < T_SCAFFOLD - 0.5) {
        // A vent every twenty-four metres, dropping a cone of daylight and dust.
        float h = clamp((q.y + r.floorD) / (r.ceilH + r.floorD), 0.0, 1.0);
        m = smoothstep(2.1, 0.0, lattAbs(zp, 24.0) + abs(q.x - 0.6) * 0.8) * mix(0.12, 1.0, h);
        tone = vec3(0.88, 0.90, 0.94);
      }
      else if (r.type < T_CHAPEL - 0.5) {
        // Between the mullions, raked across the concourse at sunset.
        m = smoothstep(0.42, 0.86, lattAbs(q.x, 1.9)) * smoothstep(-0.5, r.ceilH, q.y) * 0.9;
        tone = vec3(1.00, 0.68, 0.58);
      }
      else if (r.type < T_OVERLOOK - 0.5) {
        // The chapel. Broad, slow, gold, and coming from behind the ribs.
        m = smoothstep(2.2, 0.2, lattAbs(zp, 8.0)) * smoothstep(0.0, r.ceilH * 0.8, q.y) * 2.2;
        tone = vec3(1.00, 0.82, 0.50);
      }
      else continue;

      acc += tone * m * r.sky * w;
    }
    return acc * VOL_STEP * 2.0 * 0.012;
  }

  /**
   * The motes: chalk dust, rust flakes, ash, petals, whichever the room carries.
   *
   * Layered billboards on planes at fixed depths, which is what the Sakura pen
   * does with real geometry and a depth-of-field pass. The bokeh is the whole
   * effect — a mote near the focal plane is a point and one off it is a soft
   * disc, and that single fact is what makes flat sprites read as *air*.
   */
  vec3 motes(vec3 rd, float tMax, float type, float decay) {
    if (rd.z < 0.10) return vec3(0.0);

    vec3 tone;
    float rate, dens;
    if (type > T_OVERLOOK + 0.5)       { tone = vec3(1.00, 0.34, 0.18); rate = 0.55; dens = 0.34; }
    else if (type < T_DRIFT - 0.5)     { tone = vec3(0.80, 0.88, 0.82); rate = 0.10; dens = 0.26; }
    else if (type < T_SCAFFOLD - 0.5)  { tone = vec3(0.94, 0.86, 0.72); rate = 0.16; dens = 0.62; }
    else if (type < T_CONCOURSE - 0.5) { tone = vec3(0.58, 0.60, 0.80); rate = 0.30; dens = 0.30; }
    else if (type < T_CHAPEL - 0.5)    { tone = vec3(1.00, 0.80, 0.74); rate = 0.12; dens = 0.38; }
    else if (type < T_OVERLOOK - 0.5)  { tone = vec3(1.00, 0.88, 0.68); rate = 0.08; dens = 0.46; }
    else                               { tone = vec3(1.00, 0.72, 0.76); rate = 0.22; dens = 1.00; }

    // The overlook's are petals, not dust: bigger, slower, and they are the one
    // thing in this journey lifted whole from the Sakura pen. Everything else in
    // the air here is half a millimetre of somebody's ceiling.
    float grain = type > T_CHAPEL + 0.5 ? 1.9 : 1.0;
    if (type > T_OVERLOOK + 0.5) grain = 2.6;

    tone = mix(tone, vec3(0.44, 0.42, 0.42), decay * 0.7);

    vec3 acc = vec3(0.0);
    for (int k = 0; k < 5; k++) {
      float depth = 1.6 + float(k) * float(k) * 2.1;
      float near = smoothstep(depth, depth - 1.2, tMax);
      if (near > 0.999) break;                    // this layer is behind the surface

      // The plane at this depth, in metres, falling and drifting and dragged
      // backwards by the draught the cart makes.
      vec2 pl = rd.xy / rd.z * depth
              + vec2(sin(iTime * rate + float(k) * 2.1) * 0.7,
                     -iTime * rate * 2.2 - uCart.x * 0.06);

      // Cells are metres, not screen space. This is the whole difference between
      // dust and a lava lamp: a mote is a *thing*, half a centimetre across, so
      // its size on screen has to fall off with depth like everything else does.
      // Scaled in screen space it does the opposite — the nearest layer draws the
      // biggest cells, and the biggest cells draw the biggest discs.
      float cellW = 0.85 + float(k) * 0.35;
      vec2 cell = pl / cellW;
      vec2 id = floor(cell);
      float h = hash21(id + float(k) * 31.7);
      if (h > dens) continue;

      vec2 jitter = vec2(hash21(id + 4.1), hash21(id + 8.3)) - 0.5;
      float rm = length(fract(cell) - 0.5 - jitter * 0.7) * cellW;

      // Bokeh. A mote off the focal plane spreads into a disc, and a disc of the
      // same light spread wider is dimmer by its area — dropping that second half
      // is what turns a depth-of-field into a snowstorm.
      float blur = 1.0 + abs(depth - 3.2) * 0.22;
      float size = (0.020 + 0.012 * h) * blur * grain;
      acc += tone * smoothstep(size, size * 0.30, rm) * (0.35 + h) * (1.0 - near) / (blur * blur);
    }
    return max(acc, 0.0) * 0.55;
  }

`
