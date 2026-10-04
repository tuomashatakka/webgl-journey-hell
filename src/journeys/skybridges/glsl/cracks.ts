// How glass breaks here: a spiderweb round an impact, a crack that outruns the
// runner, and the schedules that decide when each pane goes (spec section 2).
// The patterns are shading; the schedules also drive the geometry, so a pane
// falls exactly when its cracks say it should.

export const cracksGlsl = /* glsl */`
  /** 0 at the start of the run, 1 by the end of lap two: how much the city has given. */
  float damageAt(float t) { return clamp((t - 20.0) / (1.6 * LAP_T), 0.0, 1.0); }

  /**
   * A spiderweb fracture in a pane's plane. q: metres from the impact; age:
   * seconds since it; px: the pixel's footprint in metres; reach: how far the
   * radials run. Returns (line, crush, shard id, inside): line 0..1 on a crack,
   * crush 0..1 in the powdered zone at the impact, a per-fragment id for its
   * tilt, and 1 wherever the fracture has reached.
   */
  vec4 spiderweb(vec2 q, float age, float seed, float px, float reach) {
    if (age <= 0.0) return vec4(0.0);
    float r = length(q);
    float grow = clamp(age / 0.12, 0.0, 1.0);
    float rmax = reach * grow;
    if (r > rmax + 0.05) return vec4(0.0);

    float n = floor(7.0 + seed * 5.99);
    float w = 2.0 * PI / n;
    float wob = (vnoise(vec2(r * 7.0, seed * 31.0)) - 0.5) * 0.35 + (vnoise(vec2(r * 23.0, seed * 7.0)) - 0.5) * 0.12;
    float u = (atan(q.y, q.x) + PI) / w + wob;
    float k = floor(u);
    float fu = fract(u);
    float rlen = (0.45 + 0.55 * hash21(vec2(k, seed * 13.0))) * rmax;
    float lw = px * 1.2 + 0.0012;
    float radial = (1.0 - smoothstep(lw * 0.5, lw, min(fu, 1.0 - fu) * w * r)) * step(r, rlen);

    // Chords between neighbouring radials, appearing for seconds as the load creeps.
    float creep = clamp(age / 3.0, 0.0, 1.0);
    float rc = r * cos((fu - 0.5) * w);
    float cw = cos(0.5 * w);
    float ring = 0.0, band = 0.0;
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      float hj = hash21(vec2(k * 3.1 + fj, seed * 5.7));
      float rj = (0.06 + 0.11 * fj + 0.05 * fj * fj) * (0.75 + 0.5 * hj) * reach;
      float on = step(fj * 0.22 + hj * 0.3, creep + 0.12) * step(rj, rlen);
      ring = max(ring, on * (1.0 - smoothstep(lw * 0.4, lw * 0.9, abs(rc - rj * cw))));
      band += step(rj * cw, rc);
    }
    float crush = (1.0 - smoothstep(0.012, 0.04 + 0.02 * seed, r)) * grow;
    return vec4(max(radial, ring * 0.85), crush, hash21(vec2(k + seed * 7.0, band)), step(r, rmax));
  }

  /** A crack racing ahead of the runner along the deck: it runs, stalls, and runs again. */
  float runningCrack(vec3 pc, float px) {
    float on = max(win(gZL, 182.0, 186.0, 222.0, 225.0), win(gZL, 300.0, 304.0, 330.0, 336.0));
    if (gE > gArrive) on = 1.0;
    if (on < 0.01) return 0.0;
    float ep = floor(gTm / 4.0);
    float ph = fract(gTm / 4.0);
    float tip = gZ + 7.0 * min(1.0, ph * 3.0) - 2.0 * ph;
    float x = 0.28 * sin(pc.z * 1.3 + ep * 2.1) + 0.12 * (vnoise(vec2(pc.z * 4.0, ep)) - 0.5);
    float lw = px * 1.2 + 0.0015;
    return on * (1.0 - smoothstep(lw * 0.5, lw, abs(pc.x - x))) * step(pc.z, tip) * step(gZ - 30.0, pc.z);
  }

  /**
   * A deck pane's fate: x = when it cracks, y = when it lets go (absolute
   * seconds; 1e9 = never), zw = the impact relative to the pane centre. ix is
   * the pane across (0 = under the runner), iz along; zc its centre z.
   */
  vec4 deckPane(float ix, float iz, float zc) {
    float h = hash21(vec2(ix * 3.7 + 1.3, iz));
    float h2 = hash21(vec2(iz * 0.37, ix + 9.1));
    float centre = step(abs(ix), 0.5);
    float zImp = zc + (h - 0.5) * 0.7;
    float tRun = zImp / SPEED;
    float dmg = damageAt(tRun);
    vec2 imp = centre > 0.5
      ? vec2(mod(iz, 2.0) < 1.0 ? -0.2 : 0.2, zImp - zc)
      : vec2((h2 - 0.5) * 0.6, (h - 0.5) * 0.9);
    float p = centre > 0.5 ? 0.35 + 0.65 * dmg : (0.1 + 0.6 * dmg) / max(abs(ix), 1.0);
    float tc = h2 < p ? tRun + (1.0 - centre) * (0.25 + abs(ix) * 0.3 + h * 1.2) : 1e9;

    // The catch cracks its deck end to end, a front running along it at 40 m/s.
    float zl = mod(zc, LOOP_Z);
    if (zl > 300.0 && zl < 336.0) tc = min(tc, (zc - zl + 300.0) / SPEED + (zl - 300.0) / 40.0 + h * 0.2);
    // The shockfront cracks every pane at once.
    tc = min(tc, BLAST_T + gArrive + h * 0.25);

    // A cracked pane lets go a second or two after the runner is off it.
    float tr = tc < 1e8 ? max(tc, tRun) + 0.9 + h2 * 1.6 : 1e9;
    return vec4(tc, tr, imp);
  }

  /**
   * A facade pane's fate: x = seconds since it cracked (<= 0: intact), y = 1
   * once it has blown out. A crack front spreads from origin as the runner
   * comes past (tPass); the shockfront (eHit, seconds after the detonation)
   * finishes what is left.
   */
  vec2 facadeFate(vec2 id, float seed, vec3 pane, vec3 origin, float tPass, float eHit) {
    float h = hash21(id + seed * 17.3);
    float h2 = hash21(id.yx * 1.7 + seed * 3.1);
    float dmg = damageAt(tPass);
    float tFront = tPass - 7.0 + 3.0 * fract(seed * 3.3) + length(pane - origin) / (6.0 + 4.0 * fract(seed * 7.7));
    float tc = h < 0.25 + 0.7 * dmg ? tFront + h2 * 0.6 : 1e9;
    float tb = BLAST_T + eHit;
    tc = min(tc, tb + h2 * 0.4);
    float blow = step(h2, 0.10 + 0.35 * dmg) * step(tc + 0.6 + h * 2.0, iTime);
    blow = max(blow, step(h, 0.65) * step(tb + 0.15 + h2 * 0.8, iTime));
    return vec2(iTime - tc, blow);
  }
`
