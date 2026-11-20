// Curtain walls: the rooms behind the glass, how a pane takes the light and
// breaks, and the canyon's fins and its mirror of the tower across the slot.
// Spliced into materials.ts where it stands, after the frost and before the rest.

export const facadesGlsl = /* glsl */`  // --- curtain walls -------------------------------------------------------------
  /** Rooms behind the glass: one per three panes, ceiling panels, lit or dark. dir is the ray in face space (x along, y up, z in). */
  vec3 interior(vec2 uv, vec3 dir, float lit, float seed) {
    vec2 room = vec2(4.5, 3.6);
    vec2 cell = floor(uv / room);
    vec2 f = uv - cell * room;
    float h = hash21(cell + seed);
    float tx = dir.x > 0.0 ? (room.x - f.x) / dir.x : f.x / max(-dir.x, 1e-4);
    float ty = dir.y > 0.0 ? (room.y - f.y) / dir.y : f.y / max(-dir.y, 1e-4);
    float tz = (4.0 + 3.0 * fract(h * 7.1)) / max(dir.z, 1e-3);
    float tm = min(tx, min(ty, tz));
    vec3 hp = vec3(f, 0.0) + dir * tm;
    float on = step(1.0 - lit, fract(h * 13.7));
    vec3 lightC = mix(vec3(1.0, 0.82, 0.6), vec3(0.85, 0.92, 1.0), fract(h * 3.3));
    vec3 wallC = mix(vec3(0.55, 0.52, 0.48), vec3(0.35, 0.38, 0.42), fract(h * 5.9));
    float amb = 0.1 * (1.0 - gNight) + 0.01;
    on *= mix(1.0, 0.3, gNight);   // night exposure is high: a lit office must not burn out
    if (tm == ty && dir.y > 0.0) {
      vec2 g = fract(vec2(hp.x / 1.5, hp.z / 1.2));
      float panel = step(0.2, g.x) * step(g.x, 0.8) * step(0.3, g.y) * step(g.y, 0.7);
      return mix(wallC * (amb + 0.35 * on), lightC * 2.5, panel * on);
    }
    if (tm == ty) return vec3(0.12, 0.11, 0.10) * (amb + 0.6 * on);
    if (tm == tz) return wallC * (amb + 0.7 * on) * lightC * (0.85 + 0.15 * step(0.5, fract(hp.x * 0.6 + h)));
    return wallC * (amb + 0.5 * on);
  }

  /**
   * The canyon's glass sits 0.35 m behind champagne fins at every mullion. A ray
   * reaching the fins' plane at a along the bay (0 to 1.5 m) and drifting sh along
   * the face before it sinks to the glass meets a fin's side instead where it
   * crosses a mullion; once that is finer than a pixel the bay is averaged.
   * x is how much of the bay is fin, y how deep into the recess the side is met.
   */
  vec2 canyonFins(float a, float sh, float pxF) {
    float x = a + clamp(sh, -1.6, 1.6);
    float over = max(-x, x - 1.5);
    float edge = smoothstep(-pxF, pxF, over);
    float deep = clamp(1.0 - over / max(abs(sh), 1e-3), 0.0, 1.0);
    float avg = smoothstep(0.2, 0.75, pxF);
    return vec2(mix(edge, clamp(abs(sh) / 1.5, 0.0, 1.0), avg), mix(deep, 0.5, avg));
  }

  /**
   * At a grazing angle the canyon's glass is a mirror, and across a 14 m slot
   * what it mirrors is the other tower, not the sky: its panes and rooms, its
   * fins and spandrels, the low sun on whichever face it reaches. Pc and Rc are
   * canonical, N the face's outward normal; the other face is 14 m along it.
   * Past the other tower's top or its ends the sky is what it was.
   */
  vec3 canyonMirror(vec3 pc, vec3 Rc, vec3 N, vec3 skyR, vec3 tint, float lit, float seed, float pxQ) {
    if (Rc.x * N.x < 0.02) return skyR;
    float tA = (7.0 * N.x - pc.x) / Rc.x;
    vec3 q = pc + Rc * tA;
    float zl = mod(q.z, LOOP_Z);
    float on = step(q.y, 45.0) * step(282.0, zl) * step(zl, 340.0);
    if (on < 0.5) return skyR;
    pxQ *= 1.0 + tA;

    // The other face in its own frame: x along +z, y up, z into it.
    vec3 dirF = vec3(Rc.z, Rc.y, abs(Rc.x));
    float sh = dirF.x / max(dirF.z, 0.1) * 0.35;
    vec2 fin = canyonFins(fract(q.z / 1.5) * 1.5, sh, pxQ * 0.5 / max(dirF.z, 0.05));
    vec2 uv = vec2(q.z, q.y) + dirF.xy * 0.35 / max(dirF.z, 0.1);
    vec2 f = fract(uv / vec2(1.5, 3.6));

    vec2 sxz = turnXZ(gSunW.xz, -turnHeading(q.z));
    vec3 sd = normalize(vec3(sxz.x, gSunW.y, sxz.y)) + vec3(1e-5);
    vec3 qo = q - N * 0.05;
    float base = q.z - zl;
    float qs = gSunW.y < 0.02 ? 0.0 : boxClear(qo, sd, vec3(-22.0, -97.5, base + 311.0), vec3(15.0, 142.5, 29.0))
      * boxClear(qo, sd, vec3(22.0, -97.5, base + 311.0), vec3(15.0, 142.5, 29.0));
    vec3 amb = ambient(vec3(0.0));
    vec3 key = gSunCol * 0.1 * qs;

    vec3 R2 = vec3(-Rc.x, Rc.y, Rc.z);
    float F2 = fresnel(abs(Rc.x), 0.08);
    vec3 room = interior(uv, dirF, lit, seed + 17.0);
    vec3 col = mix(room * tint, skyBase(toWorld(renderDir(R2, q.z))), F2);
    if (f.y < 0.24) col = tint * 0.06 * (amb + key * max(-dot(N, sd), 0.0));
    float fade = clamp(0.05 / max(pxQ, 1e-4), 0.0, 1.0);
    float mull = max(1.0 - smoothstep(0.026, 0.026 + pxQ / 1.5, min(f.x, 1.0 - f.x)), 1.0 - smoothstep(0.012, 0.012 + pxQ / 3.6, abs(f.y - 0.24)));
    vec3 alu = vec3(0.2, 0.21, 0.22) * (amb + key * max(-dot(N, sd), 0.0));
    col = mix(col, alu, mull * fade * 0.9);
    col = mix(col, mix(col, alu, 0.15), 1.0 - fade);
    vec3 finC = vec3(0.24, 0.2, 0.15) * (amb * (1.0 - 0.6 * fin.y) + key * max(-sign(dirF.x) * sd.z, 0.0));
    col = mix(col, finC, fin.x);
    return mix(col, gHorizon * 0.5, 1.0 - exp(-gHaze * tA));
  }

  vec3 shadeFacade(vec3 w, vec3 n, vec3 rd, float t, float px) {
    float sun = sunlight(w + n * 0.1);
    vec3 pc = unbend(w);
    vec3 nc = canonDir(n, pc.z);
    vec3 rdc = canonDir(rd, pc.z);
    vec3 an = abs(nc);
    // The station's hall: its walls are inside, so they take the hall's light and mirror the hall.
    float inHall = step(abs(gInfo.x - 2.0), 0.5) * hallCover(pc);
    vec3 amb = inHall > 0.5 ? hallAmbient(n, pc) : ambient(n);
    if (an.y > an.x && an.y > an.z) {
      if (inHall > 0.5) {
        vec2 cf = abs(fract(vec2(pc.x / 3.0, pc.z / 3.0)) - 0.5) * 3.0;
        if (nc.y < 0.0) {
          // the hall's ceiling: deep coffers, a lamp in each
          float rib = step(1.3, max(cf.x, cf.y));
          float lamp = step(max(cf.x, cf.y), 0.5);
          return vec3(0.5, 0.48, 0.45) * amb * (1.0 - 0.45 * rib) + vec3(1.0, 0.86, 0.66) * 2.6 * lamp;
        }
        return vec3(0.2, 0.19, 0.18) * amb * (0.85 + 0.15 * step(1.45, max(cf.x, cf.y)));
      }
      // a roof: gravel and plant, nobody looks
      return vec3(0.16, 0.16, 0.17) * (ambient(n) + direct(n, sun));
    }
    vec3 N = an.x > an.z ? vec3(sign(nc.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(nc.z));
    vec3 T = an.x > an.z ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec2 uv = vec2(dot(pc, T), pc.y);
    float style = gInfo.x;

    // The canyon's inner faces: the box is the fins' plane, the glass behind it.
    float canyon = step(abs(style - 3.0), 0.5) * step(an.z, an.x) * step(pc.x * N.x, 0.0);
    vec2 finSide = vec2(0.0);
    vec3 finN = vec3(0.0);
    if (canyon > 0.5) {
      vec3 dirC = vec3(dot(rdc, T), rdc.y, -dot(rdc, N));
      float sh = dirC.x / max(dirC.z, 0.1) * 0.35;
      finSide = canyonFins(fract(uv.x / 1.5) * 1.5, sh, px * 0.5 / max(dirC.z, 0.05));
      finN = renderDir(-sign(dirC.x) * T, pc.z);
      uv += dirC.xy * 0.35 / max(dirC.z, 0.1);
    }
    vec2 g = uv / vec2(1.5, 3.6);
    vec2 id = floor(g);
    vec2 f = g - id;

    float seed = style < 0.5 ? hash21(gInfo.yz) : style * 0.173;
    float tsel = fract(seed * 4.7);
    vec3 tint = tsel < 0.25 ? vec3(0.55, 0.70, 0.74) : tsel < 0.5 ? vec3(0.50, 0.54, 0.58) : tsel < 0.75 ? vec3(0.66, 0.55, 0.42) : vec3(0.42, 0.56, 0.72);
    float lit = mix(0.3, 0.6, gNight);
    float f0 = 0.08;
    if (style > 0.5 && style < 1.5) { f0 = 0.16; tint = vec3(0.55, 0.66, 0.72); }
    if (style > 1.5 && style < 2.5) lit = 0.85;
    if (style > 2.5 && style < 3.5) tint = vec3(0.70, 0.60, 0.45);
    if (style > 3.5) { lit = 0.75; tint = vec3(0.60, 0.68, 0.74); }

    // The pane's fate: a crack front from near bridge height as the runner comes past.
    vec3 face = gBoxC + N * gBoxH;
    vec3 origin = vec3(an.x > an.z ? face.x : gBoxC.x, 0.0, an.x > an.z ? gBoxC.z + (seed - 0.5) * gBoxH.z : face.z);
    vec3 paneC = T * (id.x + 0.5) * 1.5 + vec3(0.0, (id.y + 0.5) * 3.6, 0.0) + N * dot(face, N);
    float eHit = gArrive + 1.5 * (seed - 0.5);
    vec2 fate = facadeFate(id + style * 101.0, seed, paneC, origin, gBoxC.z / SPEED, eHit);

    float h1 = hash21(id + seed), h2 = hash21(id.yx + seed * 3.0);
    float spandrel = step(f.y, 0.24);
    float near = 1.0 - smoothstep(120.0, 220.0, t);
    vec4 cr = vec4(0.0);
    if (fate.x > 0.0 && near > 0.0) cr = spiderweb((f - vec2(0.3 + 0.4 * h2, 0.45 + 0.4 * h1)) * vec2(1.5, 3.6), fate.x, h1, px, 1.4) * near;
    // The shockfront: every pane crazed at once, no star at all.
    #ifdef PLAIN_GLASS
    float crazed = 0.0;
    #else
    float hitAge = gE - eHit;
    float crazed = hitAge > 0.0 ? smoothstep(0.0, 0.06, hitAge) : 0.0;
    if (crazed > 0.0) {
      #ifdef LITE
      vec2 cz = vec2(0.45, h1);
      #else
      vec2 cz = crazing(uv + id * 0.37, px);
      #endif
      cr = vec4(max(cr.x * 0.4, cz.x * crazed), cr.y, cz.y, 1.0);
    }
    #endif

    // Oil-canning: every pane a fraction of a degree off true, and the shards more.
    vec3 Tr = renderDir(T, pc.z);
    vec3 nn = normalize(n + (Tr * (h1 - 0.5) + vec3(0.0, 1.0, 0.0) * (h2 - 0.5)) * 0.02);
    nn = shardNormal(nn, cr);
    float F = fresnel(clamp(dot(nn, -rd), 0.0, 1.0), f0);
    vec3 R = reflect(rd, nn);
    vec3 refl = sky(R, w.y, 0.0) + glint(R, sun, 0.04);
    if (canyon > 0.5) refl = canyonMirror(pc, canonDir(R, pc.z), N, refl, tint, lit, seed * 31.0, px / max(t, 1e-3));
    if (inHall > 0.5) {
      // across the hall is the other wall, lamps under its balconies; only along it the daylight
      vec3 Rc = canonDir(R, pc.z);
      vec3 across = vec3(0.09, 0.075, 0.06) + vec3(1.0, 0.82, 0.6) * 0.5 * smoothstep(0.92, 1.0, cos((Rc.y / max(abs(Rc.x), 0.05) * 18.0 + pc.y + 2.68) * 1.496));
      refl = mix(across, refl, smoothstep(0.6, 0.92, abs(Rc.z)));
    }
    vec3 dirF = vec3(dot(rdc, T), rdc.y, -dot(rdc, N));
    vec3 room = interior(uv, dirF, lit, seed * 31.0) * near + vec3(0.04, 0.045, 0.05) * (1.0 - near) * (0.4 + lit);

    // The heat pulse sets the rooms facing it alight: curtains and desks first,
    // whole floors a few seconds later, smoke banking under the ceilings.
    #ifndef PLAIN_GLASS
    if (gE > 0.6) {
      vec2 rm = floor(uv / vec2(4.5, 3.6));
      float hr = hash21(rm + seed * 7.0);
      float facing = smoothstep(0.05, 0.4, dot(n, gBlastDir));
      float burn = facing * smoothstep(0.6 + hr * 6.0, 3.0 + hr * 9.0, gE) * step(0.35, hr);
      if (burn > 0.0) {
        float lick = vnoise(vec2(uv.x * 1.3, uv.y * 0.9 - gTm * 2.2)) * 0.7 + vnoise(vec2(uv.x * 4.0 + hr, gTm * 9.0)) * 0.5;
        float vy = fract(uv.y / 3.6);
        vec3 flame = vec3(1.0, 0.36, 0.07) * (0.6 + 1.4 * lick) * smoothstep(0.95, 0.25, vy) * 1.6;
        room = mix(room, room * 0.2 + flame, burn);
        room *= 1.0 - 0.7 * burn * smoothstep(0.55, 0.9, vy);   // the smoke under the slab
      }
    }
    #endif

    vec3 col;
    if (spandrel > 0.5) col = mix(tint * 0.06 * (amb + direct(n, sun)), refl, F);
    else col = mix(room * tint, refl, F);
    vec3 litC = (inHall > 0.5 ? amb : ambient(nn)) + direct(nn, sun);
    col = mix(col, litC * 0.8 + 0.02, cr.x * 0.42 * (1.0 - spandrel));
    col = mix(col, litC * 0.5, cr.w * 0.14 * (1.0 - spandrel));      // a cracked pane scatters: it goes faintly milky
    // Round the impact the glass is ground to powder and goes pale.
    col = mix(col, litC * 0.7 + 0.03, cr.y * 0.6 * (1.0 - spandrel));
    col = mix(col, litC * 0.55 + room * tint * 0.3, crazed * 0.45 * (1.0 - spandrel));

    // Blown out: the room, and the jagged rim of glass still in the frame.
    if (fate.y > 0.5 && spandrel < 0.5) {
      vec2 e = min(f - vec2(0.0, 0.24), 1.0 - f) * vec2(1.5, 3.6);
      float rim = min(e.x, e.y) - 0.05 - 0.12 * vnoise(f * vec2(9.0, 21.0) + id);
      col = rim < 0.0 ? litC * 0.8 + 0.05 : room;
    }

    // Mullions and slab edges, faded to their average as they shrink below a pixel.
    float fade = clamp(0.05 / max(px, 1e-4), 0.0, 1.0);
    float mull = max(1.0 - smoothstep(0.026, 0.026 + px / 1.5, min(f.x, 1.0 - f.x)), 1.0 - smoothstep(0.012, 0.012 + px / 3.6, abs(f.y - 0.24)));
    vec3 alu = vec3(0.2, 0.21, 0.22) * (amb + direct(n, sun));
    col = mix(col, alu, mull * fade * 0.9);
    col = mix(col, mix(col, alu, 0.15), 1.0 - fade);
    // The fins' sides: anodised, golden where the low sun runs along the slot.
    if (finSide.x > 0.0) {
      vec3 finC = vec3(0.24, 0.2, 0.15) * (amb * (1.0 - 0.6 * finSide.y) + direct(finN, sun)) + skyBase(toWorld(reflect(rd, finN))) * 0.05;
      col = mix(col, finC, finSide.x);
    }
    return col;
  }
`
