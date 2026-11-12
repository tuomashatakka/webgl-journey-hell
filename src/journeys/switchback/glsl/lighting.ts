export const lightingGlsl = `  // ---- lights --------------------------------------------------------------

  vec3 directLight(vec3 q, vec3 n, vec3 vdir, float rough, float ao) {
    Room r = roomAt(q.z);
    bool mall = abs(r.type - T_CONCOURSE) < 0.5;

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

      // The concourse's lamps are ten metres up in the crown, the sun does the
      // modelling there, and the one thing they are ever really behind is a
      // gallery. So no ray is marched for them (a reach of nothing ends the
      // loop before its first step) and the gallery's shade is closed-form.
      float sh = shadowTo(q, l, mall ? -1.0 : min(ld, 16.0));
      if (mall) sh = mallLampShade(q, r.lampY);
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
      vec3  sl     = uSun.xyz;
      float reach  = 30.0;
      float gain   = r.sky;
      vec3  sunCol = mix(vec3(1.00, 0.72, 0.58), vec3(0.78, 0.46, 0.52), uAtm.y * 0.6);

      if (mall) {
        // The concourse has a roof on, so its sun is the clerestory's: the pool
        // on the carpet is the glazing carried down the light, mullion for
        // mullion. The shadow ray stops two metres short of the glass, which
        // keeps the vault it is about to meet out of its own penumbra.
        // Outside the beam its reach is nothing, so it ends before its first
        // step even where a compiler runs both sides of every branch.
        float back;
        gain   = mallSun(q, 0.14, back) * 1.25;
        sl     = MALL_SUN;
        reach  = gain > 0.003 ? min(back - 2.0, 12.0) : -1.0;
        sunCol = mallSunTint();
      }

      // The sun's shadow is the one term here worth switching off. uHeavy is a
      // uniform, so the branch is coherent across the whole draw and the fourteen
      // map evaluations behind it are genuinely skipped rather than masked.
      float sh = uHeavy > 0.5 ? mix(1.0, shadowTo(q, sl, reach), 0.85) : 1.0;
      col += sunCol * max(dot(n, sl), 0.0) * gain * sh * 3.4;
    }

    // Ambient: the room's own fog bounced back, plus whatever the weather gets in.
    vec3 amb = roomFog(r.type, r.grime) * 3.0 + skyAmbient(r.type, uAtm.y) * r.sky * 0.65;

    if (mall) {
      // ...except in the concourse, which has two clerestories, two arcades of
      // downlights and a few shops with the lights still on, and says so itself.
      vec3 fill = mallFill(q, n, r, amb);
      col += fill * ao;
    }

    if (r.type > T_CONCOURSE + 0.5 && r.type < T_OVERLOOK - 0.5) {
      // The chapel's daylight is the lancets' and nothing else's: the same field
      // the embrasures were cut with, so a pool of light on the floor is exactly
      // the shape of the window it came through. The shadow ray stops at the
      // glass, which is what keeps the wall behind the window out of it.
      float lan  = lancet(q, r.bore);
      float back = (q.x - r.bore) / NAVE_SUN.x;
      float beam = smoothstep(0.0, -0.30, lan);
      if (beam > 0.003) {
        // The ray runs the length of its own embrasure, a metre from the stone
        // all the way, so the usual penumbra would call the whole beam shade.
        // Only the first quarter of it is kept: things in the beam, not beside it.
        float sh = uHeavy > 0.5 ? smoothstep(0.0, 0.25, shadowTo(q, -NAVE_SUN, min(back, 16.0))) : 1.0;
        col += naveSunTint() * max(dot(n, -NAVE_SUN), 0.0) * beam * sh * 5.2;
      }

      // ...and what that light does besides land: the reveals of an embrasure
      // glow with what is going past them, and a warm fill comes back off the
      // floor and the west wall, strongest low down and facing the windows.
      amb += naveSunTint() * smoothstep(0.9, 0.0, lan) * exp(-max(back, 0.0) * 0.16) * 1.3;
      amb += naveSunTint() * (0.035 + 0.06 * max(n.x, 0.0)) * smoothstep(9.0, 0.0, q.y);
    }
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
   * Shafts: the vent holes over the drift. The chapel's are naveShafts and the
   * concourse's are mallShafts, both below.
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

  /**
   * The god-rays of the two rooms with windows in them: the chapel's lancets
   * and the concourse's clerestory, seen side-on through the dust.
   *
   * Their own loop rather than a branch of 'shafts', because a beam a metre and
   * a half across needs samples closer together than the five metres the vents
   * get by on. The step grows with range, so the bays near the cart are
   * resolved and the far ones are averaged, which is also what the fog does to
   * them. Nothing here touches the map: both beams are closed-form.
   *
   * One loop for both rooms, because they are neighbours: from the concourse
   * the chapel is always in the window, and a loop each was every sample's
   * crossing into track space paid for twice.
   */
  vec3 naveShafts(vec3 rd, float tMax) {
    // Neither is in the window at all: a handful of compares, and every other
    // room's frame is the frame it was.
    bool any = false;
    for (int i = 0; i < 3; i++)
      if (abs(uSecA[i].z - T_CHAPEL) < 0.5 || abs(uSecA[i].z - T_CONCOURSE) < 0.5) any = true;
    if (!any) return vec3(0.0);

    // Interleaved gradient noise for the jitter, not the white hash the other
    // volumetrics use: these beams are bright and hard-edged, and white noise on
    // them is a stipple where this is a weave too fine to see.
    float acc  = 0.0;
    float hall = 0.0;
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float t = 0.0;

    for (int k = 0; k < 26; k++) {
      float dt = 0.9 + 0.075 * float(k);
      float ts = t + j * dt;
      t += dt;
      if (ts > tMax) break;

      vec3 q = toTrack(rd * ts);
      Room r = roomAt(q.z);

      if (abs(r.type - T_CONCOURSE) < 0.5) {
        // The concourse's beam is a sheet five metres through rather than a
        // row of pencils, so its edge is softer still and its transoms and
        // mullions are below what a step can resolve: the band and the ribs'
        // shadows are all that is in it, and its dust is one slow ripple.
        float back;
        float beam = mallSun(q, 0.30 + 0.24 * dt, back);
        hall += beam * (0.78 + 0.22 * sin(q.y * 2.3 + phaseAt(q.z) * 0.9 - iTime * 0.2))
              * exp(-back * 0.05 - ts * 0.020) * dt;
        continue;
      }
      if (abs(r.type - T_CHAPEL) > 0.5) continue;

      // Brightest where it comes in, thinning as the dust takes it. Only the
      // air the nave and the embrasures actually have: behind the west wall
      // there is stone, and a beam drawn through stone is a searchlight.
      float back = (q.x - r.bore) / NAVE_SUN.x;
      // The edge is as soft as the step is long. A beam narrower than the gap
      // between two samples is not a beam any more, it is a coin toss.
      float soft = 0.12 + 0.17 * dt;
      float beam = smoothstep(soft, -soft, lancet(q, r.bore));
      float open = smoothstep(-NAVE_W - 0.6, -NAVE_W + 0.4, q.x) * smoothstep(-1.2, -0.2, q.y);
      float dust = 0.55 + 0.45 * fbm(vec2(phaseAt(q.z) * 0.35 + q.x * 0.5, q.y * 0.6 - iTime * 0.05));

      acc += beam * open * dust * exp(-back * 0.075) * exp(-ts * 0.022) * dt;
    }
    // The concourse's is brightest looking up the light, which is where the
    // cart is looking.
    float into = max(dot(toTrackDir(rd, 20.0), MALL_SUN), 0.0);
    return naveSunTint() * acc * 0.17 + mallSunTint() * hall * (0.045 + 0.11 * into * into);
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
