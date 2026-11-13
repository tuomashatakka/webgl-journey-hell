import { valueNoise2 } from '@wjh/glsl/noise'


export const waterSurfacesGlsl = `  // --- water ----------------------------------------------------------------

  // The water level, in the current section's local frame.
  float waterY() { return uWave.x; }

  // ...and in some other slot's frame. The flood is one flat plane through the
  // whole building; toLocal subtracts B.x from y, so a section whose floor
  // origin sits higher carries the surface correspondingly lower in its own
  // coordinates. Getting this wrong puts the scum line and the mosaic course at
  // different heights on either side of a doorway.
  float waterYIn(vec4 B) { return uWave.x - B.x; }

  // Kept deliberately shallow in amplitude: this displaces the *plane solve*,
  // not the SDF, so it costs nothing and cannot break the march.
  float waveH(vec2 xz, float t) {
    float h = sin(xz.x * 1.7 + t * 1.10) * 0.50
            + sin(xz.y * 2.3 - t * 0.90) * 0.40
            + sin((xz.x + xz.y) * 3.1 + t * 1.70) * 0.25;
    return h * 0.020;
  }

  // Chop. Deliberately NOT folded into waveH: waveH displaces the plane solve and
  // has to stay shallow or the surface parts company with the walls it meets,
  // while the normal wants detail an order of magnitude finer. Ten times the
  // slope for none of the displacement, which is what real water is -- and it is
  // the whole difference between a pool and a sheet of black glass with a hard
  // edge, which is what this was.
  float chopH(vec2 xz, float t) {
    float h = 0.0;
    float a = 0.011;
    vec2  q = xz;
    for (int i = 0; i < 3; i++) {
      h += sin(q.x * 3.1 + t * 1.30) * sin(q.y * 2.6 - t * 1.07) * a;
      q  = mat2(0.86, 0.51, -0.51, 0.86) * q * 2.07;
      a *= 0.52;
    }
    return h;
  }

  ${valueNoise2('hash21')}

  // What is floating ON it. A dead flat mirror is the most artificial thing a
  // shader can put in a room; a pool nobody has skimmed in years is not a mirror
  // at all in patches, and the patches are what tell you which way it is drifting.
  float surfaceFilm(vec2 xz, float dec) {
    float n = vnoise(xz * 0.42 + vec2(iTime * 0.013, -iTime * 0.009)) * 0.62
            + vnoise(xz * 1.70 - vec2(iTime * 0.022,  iTime * 0.017)) * 0.38;
    // A wide ramp, not a threshold. Scum has no edge -- it thins out. A tight
    // smoothstep over a two-octave noise gave the sharp-edged blob that read as a
    // hole in the water rather than as something floating on it.
    return smoothstep(0.40, 0.86, n) * (0.20 + 0.55 * dec);
  }

  vec3 waterNormal(vec2 xz, float t) {
    float e = 0.05;
    float h  = waveH(xz, t)                  + chopH(xz, t);
    float hx = waveH(xz + vec2(e, 0.0), t)   + chopH(xz + vec2(e, 0.0), t);
    float hz = waveH(xz + vec2(0.0, e), t)   + chopH(xz + vec2(0.0, e), t);
    return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  }

  // Plane solve plus one heightfield refinement. The refinement is what gives a
  // wobbling meniscus across the lens at the crossing instead of a razor line.
  float waterHit(vec3 ro, vec3 rd) {
    if (abs(rd.y) < 1e-4) return -1.0;
    float tW = (waterY() - ro.y) / rd.y;
    if (tW <= 0.0) return -1.0;
    vec2 xz = (ro + rd * tW).xz;
    tW = (waterY() + waveH(xz, iTime) - ro.y) / rd.y;
    return tW > 0.0 ? tW : -1.0;
  }

  // Ridged sum-of-sines sharpened into filaments. The pow() is the whole trick:
  // without it this is noise, with it it is caustics.
  float caustic(vec2 p, float t) {
    float k = 0.0;
    vec2  q = p;
    for (int i = 0; i < 3; i++) {
      if (float(i) > 1.0 + uHeavy) break;
      vec2  w = q * (1.0 + float(i) * 0.9);
      float a = sin(w.x + t * (1.0 + float(i) * 0.31)) + sin(w.y * 1.13 - t * 0.87);
      float b = sin((w.x + w.y) * 0.71 + t * 1.21);
      k += 1.0 - abs(a * 0.5 + b * 0.35);
      q  = mat2(0.80, 0.60, -0.60, 0.80) * q;
    }
    return pow(max(k / 3.0, 0.0), 6.0);
  }

  const vec3 LDIR = vec3(0.14, 0.976, 0.17); // down from the ceiling lamps

  // Caustics must be projected along the LIGHT, not straight down — that is what
  // makes them stretch up the walls instead of looking like noise on the floor.
  float causticAt(vec3 p) {
    float dep = waterY() - p.y;
    vec2  cp  = (p + LDIR * (dep / LDIR.y)).xz;

    // Depth defocuses them: amplitude falls, scale grows, pattern blurs to mean.
    cp *= 1.0 / (1.0 + max(dep, 0.0) * 0.25);
    float c = caustic(cp, iTime * 0.6);
    c = mix(c, 0.35, smoothstep(0.5, 5.0, dep));
    c *= exp(-max(dep, 0.0) * 0.25);

    // The band of reflected light thrown ~0.5m ABOVE the waterline. Almost
    // nobody implements this and it is a huge part of reading as a real pool.
    c += caustic(cp * 1.4, iTime * 0.9) * exp(-max(p.y - waterY(), 0.0) * 3.0) * 0.6;
    return c;
  }

  // --- surfaces -------------------------------------------------------------


  // The fracture field, built on the tile lattice tileSurface already has. No
  // fbm and no value noise: generic crazing sits ON a tile rather than in it, and
  // real glazed tile crazes per tile and lets go per tile. Each tile picks a
  // bearing from its own hash and splits along it.
  //
  // The gradient comes free by the same trick the grout uses two functions down
  // (d|dot(f,dir)|/df is just sign(e) * dir), which is what makes a crack catch
  // the light instead of reading as printed-on dirt.
  //
  // Two things stop it reading as a scratch, which is exactly what it read as
  // before: the split KINKS, by an offset that is a function of the across-crack
  // coordinate alone (so it bends the line without a noise lookup and without
  // touching the gradient trick), and it TAPERS to nothing at the grout, because
  // a break in glazed tile stops at the edge of the tile.
  void crackAt(vec2 cell, vec2 f, float id, float dec,
               out float hair, out float spall, out vec2 grad) {
    float a   = id * 6.2831;
    vec2  dir = vec2(cos(a), sin(a));
    vec2  per = vec2(-dir.y, dir.x);
    float ac  = dot(f, per);

    float e = dot(f, dir) + (fract(id * 17.13) - 0.5) * 0.45
            + sin(ac * 17.0 + id * 41.0) * 0.022
            + sin(ac * 43.0 - id * 13.0) * 0.009;

    float taper = 1.0 - smoothstep(0.26, 0.50, max(abs(f.x), abs(f.y)));
    float wdt   = max((0.007 + 0.032 * dec) * taper, 0.0015);

    hair  = (1.0 - smoothstep(0.0, wdt, abs(e))) * taper;
    hair *= step(hash21(cell + 5.1), 0.015 + dec * 0.62);
    grad  = dir * sign(e);

    // ...and the ones that have let go of the wall entirely. Held back until the
    // crazing has had a lap to establish itself, so the two read as a sequence.
    spall = step(1.0 - max(dec - 0.26, 0.0) * 0.66, hash21(cell + 19.7));
  }

  // Tile. The normal perturbation is what makes tile look like tile rather than
  // like wallpaper, and it is nearly free: the derivative of fract() is +-1.
  // Set by tileSurface, read by shadeFace. A global rather than a seventh out
  // parameter, following foundry's gWear: the value is wanted by exactly one
  // caller, one call later.
  float crackGlow;

  // How far the shaded point is from the eye, in metres. Set once by the march.
  //
  // Everything in tileSurface is a hard step across a lattice: 14mm of grout on
  // a 220mm tile, a crack a few millimetres wide, the lip of a hole. At the far
  // end of a twenty-two metre hall those are a third of a pixel across, and a
  // third of a pixel of pure black sampled once per pixel is not a grout line,
  // it is moire -- the interference pattern that made every far wall in this
  // building look like corduroy. There is no mip chain to lean on here (nothing
  // is textured) and no derivatives (ES 1.00 has no dFdx without an extension),
  // so the footprint is estimated from distance and the detail is faded into its
  // own mean before it can alias. This is what a mip chain does; it is just done
  // by hand, and it is why detail must go to its MEAN and not to zero.
  float gDist;

  // 0 at arm's length, 1 once one tile is about a pixel across.
  float lodFade(float feature) {
    return smoothstep(feature * 260.0, feature * 900.0, gDist);
  }

  // Evaluated in the SHEARED frame, on the SAME lattice tileBreak cuts the
  // geometry on -- same cell size, same per-face salt, same hash. That agreement
  // is the whole point: a tile that reads as missing is missing, because the hole
  // it left is real, and the grout line at its edge is the lip of that hole.
  void tileSurface(vec3 p, vec3 n, float wy, float grime,
                   out vec3 alb, out vec3 nOut, out float rough) {
    vec2 uv; vec3 tu, tv; float size; float salt;
    if (abs(n.y) > 0.7) {
      uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0);
      size = TILE_F; salt = n.y > 0.0 ? SALT_FLR : SALT_CEIL;
    } else if (abs(n.x) > 0.7) {
      uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0);
      size = TILE_W; salt = SALT_WALL;
    } else {
      uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0);
      size = TILE_W; salt = 5.5;               // the end walls, which are not holed
    }

    vec2  g = uv / size;
    vec2  f = fract(g) - 0.5;
    float d = (0.5 - max(abs(f.x), abs(f.y))) * size;

    // Grout, widening and fading with distance rather than thinning to nothing.
    // Widening is what keeps a far wall reading as tiled at all; fading is what
    // stops it reading as corduroy.
    float lodG   = lodFade(0.014);
    float groove = (1.0 - smoothstep(0.0, mix(0.014, 0.030, lodG), d)) * (1.0 - lodG * 0.62);

    // Real pools run a contrasting mosaic course at the water line. It used to be
    // drawn by shrinking the lattice; the lattice is shared with the geometry now
    // and cannot move, so the finer course is an extra grout line through the
    // middle of each tile instead.
    float band = smoothstep(0.20, 0.14, abs(p.y - wy));
    groove = max(groove, band * (1.0 - smoothstep(0.0, 0.016,
                                   min(abs(f.x), abs(f.y)) * size)));

    float dec  = decay();
    vec2  cell = floor(g);
    float id   = hash21(cell + salt);

    float hair, spall; vec2 cg;
    crackAt(cell + salt, f, id, dec, hair, spall, cg);

    // The crack cuts the surface as well as marking it. Same form as the grout
    // perturbation above and about as cheap.
    // ...and no two glazed tiles were ever set quite flat to each other. A few
    // hundredths of tilt per tile is what breaks one long reflection of a tube
    // into a stepped run of them, which is how a tiled wall gives itself away.
    vec2 tilt = (vec2(hash21(cell + salt + 2.9), hash21(cell + salt + 6.1)) - 0.5)
              * 0.07 * (1.0 - lodFade(size * 0.5));
    nOut = normalize(n - (tu * sign(f.x) + tv * sign(f.y)) * groove * 0.5
                       - (tu * cg.x + tv * cg.y) * hair * 0.35
                       + tu * tilt.x + tv * tilt.y);

    // The per-tile shade variation is a lattice too, and the first thing to turn
    // into a shimmer. Half a tile per pixel is where it stops being detail.
    alb = vec3(0.86, 0.89, 0.87) * (0.93 + 0.13 * mix(id, 0.5, lodFade(size * 0.5)));
    // The mosaic course, in the three blues pool mosaic is always laid in. The
    // split lines are a quarter of a tile apart, so each quarter takes its own.
    float mq = hash21(floor(g * 2.0) + salt + 1.3);
    vec3  mc = mq < 0.34 ? vec3(0.10, 0.20, 0.42) : (mq < 0.67 ? vec3(0.14, 0.32, 0.52) : vec3(0.22, 0.46, 0.58));
    alb = mix(alb, mix(mc, vec3(0.16, 0.32, 0.50), lodFade(size * 0.25)), band * 0.85);

    // A tile standing proud of the wall. The relief itself is geometry; this is
    // only the dirt line that a tile with a lifted edge collects around it, and
    // it uses tileBreak's hash so it lands on the tiles that actually moved.
    float pr = hash21(cell + salt + 41.3);
    float up = step(pr, 0.02 + dec * 0.18);
    alb *= 1.0 - up * 0.18 * smoothstep(0.30, 0.50, max(abs(f.x), abs(f.y)));

    // Whole courses gone, on a lattice four times coarser than the tiles
    // themselves, reusing the same hash rather than paying for a second field.
    // The most destructive of the stages, so it is the last to arrive: below half
    // decay the wall is damaged, not demolished.
    float patch = step(0.92 - dec * 0.34, hash21(floor(g * 0.25) + 3.7))
                * smoothstep(0.42, 0.60, dec);
    vec3  conc  = vec3(0.38, 0.39, 0.37) * (0.86 + 0.28 * hash21(cell * 2.3));
    alb = mix(alb, conc, max(spall * 0.85, patch * 0.75));

    hair *= 1.0 - lodFade(0.004);
    spall = mix(spall, 0.18, lodFade(size * 0.5));

    float mildew = groove * (0.35 + 0.65 * band) * grime;
    alb = mix(alb, vec3(0.30, 0.36, 0.28), mildew * 0.75);
    alb *= mix(1.0, 0.6, groove);                                  // grout is darker
    alb *= 1.0 - hair * 0.55;                                      // and the cracks darker still

    // Splash zone: wet tile above the line is darker and much glossier.
    float wet = exp(-max(p.y - wy, 0.0) * 2.5);

    // Water finding its way out of the cracks and running down the wall. Fed into
    // the wet term rather than painted on, so the roughness term below makes the
    // seep glossy for free, which is the whole read.
    float seep = hair * (1.0 - abs(n.y)) * smoothstep(0.18, 0.45, dec);
    wet = max(wet, seep);

    alb  *= mix(1.0, 0.72, wet);
    rough = mix(0.32, 0.06, wet);

    // Scum line: a dirty ring exactly at the water level.
    alb *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.y - wy)) * grime;

    // Late on, the breaks stop being dark and start giving off light. Only some
    // of them and not equally: a constant emission on every crack reads as a neon
    // wireframe laid over the wall rather than as something behind it showing
    // through. The per-tile hash is already computed, so the variation is free.
    float lit = smoothstep(0.55, 0.95, fract(id * 7.77));
    crackGlow = hair * lit * smoothstep(0.20, 0.62, dec);
  }

  // Below the tile line. THE STAIR DOWN, THE DRAIN, THE CISTERN and THE RISER
  // were never meant to be seen by the public, so nobody tiled them: they are
  // the concrete the pool was poured against, struck from its formwork and left.
  // They used to be shaded as the same white glaze as the swimming halls, which
  // made the whole flooded third of the lap one more tiled room.
  //
  // Board-formed walls and soffit: 150 mm boards, each its own tone and grain,
  // butted in staggered runs, the seam between two boards a fin of cement that
  // leaked through it. A pour lift every 1.2 m with the bleed under it, form-tie
  // holes on a 0.6 m grid inside each lift, efflorescence weeping out of both,
  // and cracks that wander instead of following a lattice. The floor is a
  // trowelled slab with saw cuts every three metres.
  //
  // The geometry still holes on tileBreak's lattice (tileBreak is told not to
  // push anything proud here), so a missing "tile" is a square pocket where the
  // face has spalled off the rebar. Same outs as tileSurface, and it sets
  // crackGlow the same way, so shadeFace does not know which one it called.
  const float BOARD  = 0.15;   // board width, walls and soffit
  const float LIFT   = 1.20;   // pour lift height
  const float TIE    = 0.60;   // form-tie spacing, both ways
  const float SLAB   = 3.00;   // floor saw-cut spacing

  void concreteSurface(vec3 p, vec3 n, float wy, float grime,
                       out vec3 alb, out vec3 nOut, out float rough) {
    float dec = decay();
    float lf  = lodFade(0.012);
    vec3  tu, tv; vec2 uv;
    if (abs(n.y) > 0.7)      { uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
    else if (abs(n.x) > 0.7) { uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
    else                     { uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }

    // Cement, a little warm, mottled at two scales so no two square metres
    // match. The low octave is what a pour looks like from across a room.
    float mot = vnoise(uv * 0.55 + 17.0) * 0.6 + vnoise(uv * 2.3 + 3.1) * 0.4;
    alb  = vec3(0.60, 0.59, 0.55) * (0.80 + 0.32 * mot);
    vec3 nb   = vec3(0.0);
    float line = 0.0;   // anything that collects dirt: seams, joints, ties

    if (n.y > 0.7) {
      // THE SLAB. Steel-trowelled, so the mottle is in arcs and the surface is
      // smoother than the walls; saw-cut both ways, with the cut filled with silt.
      float sw = abs(vnoise(uv * 1.6 + 8.0) - 0.5);
      alb *= 0.94 + 0.10 * smoothstep(0.0, 0.18, sw) * (1.0 - lf);
      vec2  sc = vec2(latt(uv.x, SLAB), latt(uv.y, SLAB));
      float cx = 1.0 - smoothstep(0.004, mix(0.010, 0.030, lf), abs(sc.x));
      float cz = 1.0 - smoothstep(0.004, mix(0.010, 0.030, lf), abs(sc.y));
      line = max(cx, cz) * (1.0 - lf * 0.7);
      nb   = (tu * sign(sc.x) * cx + tv * sign(sc.y) * cz) * 0.35;
    }
    else {
      // THE FORMWORK. Walls take their boards horizontal and the soffit takes
      // them along the room, so on both the seams run the way the eye travels.
      // The along-board axis is uv.x on the walls and uv.y on the soffit.
      bool  ceil = n.y < -0.7;
      float a    = ceil ? uv.y : uv.x;
      float c    = ceil ? uv.x : uv.y;
      vec3  ta   = ceil ? tv : tu;
      vec3  tc   = ceil ? tu : tv;

      float row  = floor(c / BOARD);
      float run  = 2.4 + 1.2 * hash11(row * 1.91);              // board lengths differ by course
      float col  = floor(a / run + hash11(row * 7.3));          // and the butts are staggered
      float bid  = hash21(vec2(row, col) + 4.4);
      float fc   = fract(c / BOARD) - 0.5;
      float fa   = fract(a / run + hash11(row * 7.3)) - 0.5;

      // Each board printed its own tone and its own grain into the face. The
      // grain is stretched along the board and offset per board, so the figure
      // stops at every seam the way timber does.
      float grain = vnoise(vec2(a * 1.3 + bid * 40.0, c * 26.0 + bid * 9.0));
      alb *= mix(0.88 + 0.22 * bid, 1.0, lf);
      alb *= mix(0.93 + 0.12 * grain, 1.0, lodFade(0.004));

      // The seams: a raised fin along each course where the paste leaked
      // between two boards, and a butt joint at the end of each board.
      float sd   = (0.5 - abs(fc)) * BOARD;
      float fin  = 1.0 - smoothstep(0.0, mix(0.005, 0.016, lf), sd);
      float butt = 1.0 - smoothstep(0.0, mix(0.004, 0.014, lf), (0.5 - abs(fa)) * run);
      line = max(fin * 0.55, butt * 0.45) * (1.0 - lf * 0.6);
      nb = tc * sign(fc) * fin * 0.30 + ta * sign(fa) * butt * 0.25;

      // Boards bow between their nails, so each face is very slightly dished.
      nb += tc * fc * 0.08 * (1.0 - lodFade(BOARD * 0.5));

      if (!ceil) {
        // Pour lifts. The joint is a dark line with a lip, the paste that bled
        // out of it runs down the face below, and the new pour is a shade off
        // the old one.
        float lk  = floor(c / LIFT);
        float ly  = c - lk * LIFT;
        float lj  = 1.0 - smoothstep(0.006, mix(0.012, 0.030, lf), min(ly, LIFT - ly));
        alb *= 0.95 + 0.10 * hash11(lk * 3.3 + 1.0);
        float bleed = smoothstep(0.55, 0.0, LIFT - ly)
                    * smoothstep(0.35, 0.65, vnoise(vec2(a * 4.0, lk * 7.0)));
        alb *= 1.0 - bleed * 0.16;
        line = max(line, lj * (1.0 - lf * 0.5));
        nb  += tc * (ly < LIFT * 0.5 ? -1.0 : 1.0) * lj * 0.4;

        // Form ties: a plugged cone every 0.6 m, mid-lift, rust round the ones
        // the plug fell out of and a white weep running down from them.
        vec2  tg = vec2(latt(a + 0.3, TIE), latt(c - LIFT * 0.25, TIE));
        vec2  tk = floor(vec2(a + 0.3, c - LIFT * 0.25) / TIE);
        float tr = length(tg);
        float th = hash21(tk + 2.2);
        float tie  = (1.0 - smoothstep(0.016, 0.022, tr)) * (1.0 - lodFade(0.02));
        float ring = smoothstep(0.06, 0.02, tr) * step(th, 0.25 + dec * 0.5) * (1.0 - lodFade(0.03));
        alb = mix(alb, vec3(0.12, 0.11, 0.10), tie * (0.55 + 0.4 * step(th, 0.4)));
        alb = mix(alb, alb * vec3(0.78, 0.52, 0.34), ring * 0.7);
        nb += (tc * tg.y + ta * tg.x) / max(tr, 0.001) * tie * 0.5;

        // Efflorescence: salts the water carried through the wall and left on
        // its face. Under the lift joints and under the ties, drawn down the
        // wall by the same seep that makes them, heavier as the flood ages.
        float wv  = vnoise(vec2(a * 2.6, c * 0.35)) * vnoise(vec2(a * 9.0 + 5.0, c * 0.8));
        float wl  = smoothstep(0.75, 0.05, ly) * smoothstep(0.10, 0.30, wv);
        float wt  = smoothstep(0.035, 0.0, abs(tg.x + sin(tg.y * 9.0) * 0.01))
                  * smoothstep(0.0, -0.40, tg.y) * step(th, 0.35 + dec * 0.4) * (1.0 - lodFade(0.03));
        float eff = max(wl, wt) * (0.20 + 0.65 * dec) * smoothstep(wy - 0.05, wy + 0.25, p.y);
        alb = mix(alb, vec3(0.78, 0.78, 0.74), eff * 0.55);
      }
    }

    // Cracks, which in poured concrete go where the stress went: a wandering
    // ridge of noise, not a lattice. The gradient of the ridge is taken from
    // two more lookups so the crack catches the strip light along one lip.
    float cn  = vnoise(uv * 0.9 + 31.0) + 0.35 * vnoise(uv * 3.1 + 7.0);
    float cw  = (0.004 + 0.012 * dec) * (1.0 + lf * 2.0);
    float hair = (1.0 - smoothstep(0.0, cw, abs(cn - 0.66)))
               * smoothstep(0.30, 0.55, vnoise(uv * 0.35 + 50.0) + dec * 0.4)
               * (1.0 - lodFade(0.004));
    float cgx = vnoise((uv + vec2(0.02, 0.0)) * 0.9 + 31.0) - vnoise(uv * 0.9 + 31.0);
    float cgy = vnoise((uv + vec2(0.0, 0.02)) * 0.9 + 31.0) - vnoise(uv * 0.9 + 31.0);
    vec2  cg  = normalize(vec2(cgx, cgy) + 1e-5) * sign(cn - 0.66);

    nOut = normalize(n + nb - (tu * cg.x + tv * cg.y) * hair * 0.35);

    // Dirt in every line, mildew where it is damp, the cracks darkest of all.
    alb *= 1.0 - line * 0.45;
    alb  = mix(alb, vec3(0.24, 0.28, 0.21), line * grime * 0.5 * smoothstep(wy + 1.5, wy, p.y));
    alb *= 1.0 - hair * 0.6;

    // Concrete drinks water: dark well above the line, where tile only beaded
    // it, and glossy only where it is actually running.
    float wet  = exp(-max(p.y - wy, 0.0) * 1.4);
    float seep = hair * (1.0 - abs(n.y)) * smoothstep(0.18, 0.45, dec);
    alb  *= mix(1.0, 0.78, max(wet, seep));
    rough = mix(0.82, 0.30, max(wet * 0.7, seep));
    alb  *= 1.0 - 0.30 * smoothstep(0.04, 0.0, abs(p.y - wy)) * grime;

    float lit = smoothstep(0.55, 0.95, fract(hash21(floor(uv * 1.7)) * 7.77));
    crackGlow = hair * lit * smoothstep(0.20, 0.62, dec);
  }

  // What the light coming out of a hole lands on: the wall around it.
  //
  // The emission inside a recess alone cannot read as a source, because a source
  // is only ever recognised by what it lights. This walks the eight neighbouring
  // tiles, asks each the same question tileBreak asks -- is this one missing --
  // and accumulates a smooth falloff from the ones that are. Nine hashes, once
  // per PIXEL, not once per march step; the same nine in the map would be
  // unaffordable and this is why the geometry and the shading each ask the
  // question in the place that suits them.
  float holeSpill(vec2 uv, float size, float salt, float dec) {
    vec2  g   = uv / size;
    vec2  c0  = floor(g);
    float thr = 0.004 + dec * 0.16;
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2  c = c0 + vec2(float(i), float(j));
        if (hash21(c + salt) >= thr) continue;
        float r = length(g - (c + 0.5)) * size;
        acc += exp(-r * 3.4);
      }
    }
    return acc;
  }

  // Anything that is not the building. The same if-chain shape as the fittings
  // themselves, because it has to answer in the same order they were built in.
  void propSurface(vec3 qs, float mat, float dec, out vec3 alb, out float rough) {
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
    else {
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
  }

  // Ceiling fluorescents. Emissive is a shading term on ceiling hits, not
  // geometry — keeping them out of the SDF saves their cost on every march step.
  float deadFrac(vec4 C) {
    return clamp(0.10 + uWave.y * 0.22 + C.z * 0.30, 0.0, 0.85);
  }

  // Salted with the section's own lamp pitch, so two rooms visible through one
  // doorway do not fail the same tubes in the same order.
  float lampAlive(float band, vec4 C) {
    float dead = step(hash11(band * 3.17 + 11.0 + C.w * 7.31), deadFrac(C));
    float buzz = 0.72 + 0.28 * step(0.30, hash11(band * 7.7 + floor(iTime * 9.0) + C.w));
    return (1.0 - dead) * buzz;
  }

  // A fluorescent tube IS a segment, so light it as one: the closest-point-on-
  // segment costs about five instructions and produces the long specular streak
  // across wet tile and water that a point light simply cannot.
  vec3 stripLight(vec3 p, vec3 n, vec3 alb, float rough, vec3 rd, vec4 B, vec4 C) {
    vec3  acc = vec3(0.0);
    float sp  = max(C.w, 2.0);
    float W   = B.y;
    float H   = B.z;
    float band = floor(p.z / sp);

    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float on = lampAlive(bi, C);
      if (on < 0.01) continue;

      vec3 a  = vec3(-W * 0.55, H - 0.12, (bi + 0.5) * sp);
      vec3 ab = vec3(W * 1.10, 0.0, 0.0);
      float u = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
      vec3  lp = a + ab * u;

      vec3  ld = lp - p;
      float ds = length(ld);
      ld /= max(ds, 0.001);

      float atten = 1.0 / (1.0 + ds * ds * 0.045);
      float diff  = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;

      vec3  h    = normalize(ld - rd);
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), mix(16.0, 220.0, 1.0 - rough));

      acc += (alb * diff + spec * (1.0 - rough) * 0.5) * atten * vec3(0.95, 0.99, 1.0) * on * 2.4;
    }
    return acc;
  }

  // The lit face of a recessed ceiling panel. Emissive only — it is a shading
  // term on ceiling hits, so it costs nothing on the other 95 march steps.
  float ceilPanel(vec3 p, vec4 B, vec4 C) {
    float sp   = max(C.w, 2.0);
    float W    = B.y;
    float band = floor(p.z / sp);
    float lz   = p.z - (band + 0.5) * sp;
    float inZ  = 1.0 - smoothstep(0.20, 0.27, abs(lz));
    float inX  = 1.0 - smoothstep(W * 0.50, W * 0.56, abs(p.x));

    // A prismatic diffuser is not a flat white card: its ribs run across the
    // tube, the tube ends are darker than its middle where the cathodes are,
    // and two tubes behind one diffuser show as two brighter bars. All of it
    // goes to its mean by the time a rib is a pixel across.
    float lf   = lodFade(0.02);
    float rib  = mix(0.80 + 0.20 * abs(sin(p.x * 70.0)), 0.90, lf);
    float tube = mix(0.78 + 0.32 * exp(-abs(abs(lz) - 0.09) * 40.0), 0.92, lf);
    float ends = 0.70 + 0.30 * smoothstep(W * 0.56, W * 0.38, abs(p.x));
    return inZ * inX * lampAlive(band, C) * rib * tube * ends;
  }

  // Suspended particulate. Nothing else says "this space is full of water"
  // quite as cheaply — a dark corridor and a flooded one look identical until
  // something is drifting between you and the far wall.
  vec3 motes(vec3 rd, float t) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      if (fi > 2.0 + uHeavy * 2.0) break;
      float dz = 1.2 + fi * 2.2;
      if (dz > t) break;
      vec2  g = rd.xy / max(abs(rd.z), 0.2) * (4.0 + fi * 2.5)
              + vec2(iTime * 0.03, -iTime * 0.06 + fi * 3.1);
      vec2  f  = fract(g) - 0.5;
      float rn = hash21(floor(g) + fi * 31.0);
      if (rn < 0.82) continue;
      acc += vec3(0.55, 0.78, 0.84) * smoothstep(0.15, 0.0, length(f)) * 0.42 / (1.0 + dz * 0.5);
    }
    return acc;
  }

  // Fish. Impostors in the in-scatter beside motes(): a body that is an ellipse
  // in the ray's own lattice, a tail that beats, and a drift across the beam so
  // the shoal crosses it rather than hanging in it. Shading only, which is the
  // only reason a shoal is affordable at all -- one evaluation per PIXEL instead
  // of one per march step, in a map() that has no room left in it.
  vec3 shoal(vec3 rd, float tMax, float lit) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float dz = 3.0 + fi * 5.0;
      if (dz > tMax) break;

      // The lattice scale is what sets apparent SIZE, and getting it wrong does
      // not read as "big fish", it reads as a flying saucer: at 2.4 a body was
      // most of a cell across and a shoal was a row of dinner plates. At 9 and up
      // they are hand-sized at three metres, which is what they should be.
      float sw = iTime * (0.13 + fi * 0.04);
      vec2  g  = rd.xy / max(abs(rd.z), 0.25) * (9.0 + fi * 5.0)
               + vec2(sw, sin(sw * 1.7) * 0.10 + fi * 7.3);
      vec2  c  = floor(g);
      float rn = hash21(c + fi * 13.0);
      if (rn < 0.86) continue;

      vec2 f = fract(g) - 0.5;
      f.y += sin(iTime * 1.9 + rn * 31.0) * 0.06;
      f.x *= rn > 0.93 ? -1.0 : 1.0;          // half of them are facing the other way

      // Body and tail as two ellipses, four to one along the swim direction. The
      // tail beats about its own root, which is what separates a fish from a
      // grain of rice.
      float body = length(vec2(f.x * 0.85, f.y * 3.4)) - 0.100;
      float tail = length(vec2((f.x + 0.105) * 2.6,
                               (f.y - sin(iTime * 8.0 + rn * 20.0) * 0.030) * 5.0)) - 0.048;
      float m = smoothstep(0.030, 0.004, min(body, tail));

      // Silhouettes, not lamps. They are BETWEEN you and the far wall, so they
      // are dark against it and only just catch the light.
      acc += vec3(0.30, 0.40, 0.38) * m * lit / (1.0 + dz * 0.55);
    }
    return acc;
  }

  // Lamp halos, added whether or not the ray hit anything. This is what replaces
  // a bloom post pass -- there is no FBO in a single-pass journey.
  //
  // Over ALL THREE resident slots, and that is the fix rather than the flourish.
  // This was the last thing in the file still hard-wired to uSecB[1]/uSecC[1] --
  // the section the camera happens to be in -- while being swept along a ray that
  // goes wherever you are looking. Every quantity it uses is per-section: the
  // lamp pitch sets which bands exist, the ceiling height sets how high they
  // hang, and the frame sets which way the row runs. So the instant idx advanced
  // and the slot window rotated, every halo on screen was recomputed against a
  // different room's pitch in a different room's frame and jumped somewhere else
  // -- an overlay moving on a section change, with nothing in the picture behind
  // it moving at all. resolveSlot fixed this for surfaces a while ago; the halos
  // are the same rule and they were simply missed.
  //
  // Nine iterations of about ten instructions, once per PIXEL. The march is
  // ninety-six steps against three slots and does not go near this.
  vec3 lampGlow(vec3 ro, vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec4  B  = uSecB[i];
      vec4  C  = uSecC[i];
      vec3  o  = toLocal(ro, uSecA[i], B.x);
      vec3  r  = dirToLocal(rd, uSecA[i]);
      float sp = max(C.w, 2.0);
      float band = floor(o.z / sp);

      for (int k = 0; k < 3; k++) {
        float bi = band - 1.0 + float(k);

        // Only lamps this section actually has. Without this, a corridor's lamp
        // row carries on into the rock beyond both its ends and lights the room
        // next door through a solid wall.
        float lz = (bi + 0.5) * sp;
        if (lz < -1.0 || lz > B.w + 1.0) continue;

        float on = lampAlive(bi, C);
        if (on < 0.01) continue;

        vec3  lp   = vec3(0.0, B.z - 0.12, lz);
        vec3  v    = lp - o;
        float proj = clamp(dot(v, r), 0.0, tMax);
        float dist = length(v - r * proj);
        acc += vec3(0.85, 0.92, 1.0) * on * 0.05 / (1.0 + dist * dist * 2.2);
      }
    }
    return acc;
  }
`
