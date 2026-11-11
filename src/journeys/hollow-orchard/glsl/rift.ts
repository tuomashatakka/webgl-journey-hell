// The breach: what the orchard is growing over, coming up through it from the
// second loop on (see BREACH_* in kinematics.ts for the ramp).
//
// One fissure pattern does all of it. It is a 2D Voronoi border network laid
// on the plane across RIFT_DIR and extruded along it, so it is constant along
// the direction the light travels. That one choice makes the cracks and the
// shafts agree without tracing anything: wherever a surface meets the pattern
// is a crack, and the shaft rising out of that crack is the same pattern in the
// air, so every shaft visibly comes out of a crack and goes into another one.
//
//   * riftCrack   on a surface: the fissure, its scorched lip, its red heat
//   * riftWarp    the writhing: a low domain warp the march slows down for
//   * riftShafts  in the air: the pattern sampled along the view ray
//
// uRift: breach · warp amplitude · shaft strength · heartbeat

export const riftGlsl = `  // --- the breach ------------------------------------------------------------
  uniform vec4 uRift;

  // The light rises out of the ground, leaning forward and to one side so its
  // shafts read as shafts rather than as a wall straight up.
  const vec3 RIFT_DIR = vec3(0.27, 0.89, 0.37);
  const vec3 RIFT_RED = vec3(1.0, 0.13, 0.05);

  vec2 hash22(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }

  float vnoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Where x lands on the fissure plane, in plates of about four metres. On a
  // surface the borders are shaken by a little noise so they run jagged instead
  // of tiling like paving; the shafts skip that, being too soft to show it.
  vec2 riftPlane(vec3 x) {
    vec3 u = normalize(cross(RIFT_DIR, vec3(0.0, 0.0, 1.0)));
    vec3 v = cross(RIFT_DIR, u);
    return vec2(dot(x, u), dot(x, v)) * 0.25;
  }
  vec2 riftJag(vec2 c) {
    return c + (vec2(vnoise2(c * 3.8), vnoise2(c * 3.8 + 5.2)) - 0.5) * 0.22;
  }

  // Distance to the nearest fissure, in cells (F2 - F1, one 3x3 pass), and how
  // open the fissures are here: they spread across the ground with the breach
  // rather than all appearing at once.
  vec2 riftEdge(vec2 c) {
    vec2  n  = floor(c);
    vec2  f  = fract(c);
    float d1 = 8.0, d2 = 8.0;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2  g = vec2(float(i), float(j));
        vec2  r = g + hash22(n + g) - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) d2 = d;
      }
    // A head start, so the first cracks are already there early in the second loop.
    float open = smoothstep(0.0, 0.25, uRift.x * 1.3 + 0.22 - vnoise2(c * 0.21 + 7.0));
    return vec2(sqrt(d2) - sqrt(d1), open);
  }

  // On a surface at p: x is the glowing fissure, y the scorched lip around it.
  // Hairline cracks branch off the fissures at three times the frequency once
  // the breach is under way; they glow but carry no shaft.
  vec2 riftCrack(vec3 p) {
    vec2  pc = riftJag(riftPlane(p));
    vec2  e  = riftEdge(pc);
    float w  = (0.012 + 0.024 * uRift.x) * e.y;
    float c  = 1.0 - smoothstep(w * 0.4, w, e.x);
    float l  = (1.0 - smoothstep(w, w * 4.0 + 0.04, e.x)) * e.y;
    vec2  e2 = riftEdge(pc * 4.3 + 3.7);
    float h  = (1.0 - smoothstep(0.0, 0.04, e2.x)) * smoothstep(0.15, 0.6, uRift.x) * e2.y;
    h       *= 1.0 - smoothstep(0.05, 0.3, e.x * 4.3 - 0.1);
    return vec2(max(c * e.y, h * 0.7), max(l, h * 0.5));
  }

  // The writhing. Low, slow and animated, applied after the route bend and
  // never to the aisle, which is what keeps the camera's way open through it.
  vec3 riftWarp(vec3 p) {
    float a = uRift.y;
    p.x += sin(p.y * 0.55 + p.z * 0.21 + iTime * 0.23) * a;
    p.y += sin(p.z * 0.17 + p.x * 0.43 - iTime * 0.19) * a * 0.55;
    p.z += sin(p.x * 0.31 + p.y * 0.37 + iTime * 0.13) * a * 0.5;
    return p;
  }

  // Red shafts between the eye and the hit at T: the fissure pattern sampled in
  // the air, densest near the cracks' own floor and thinning as it rises, with
  // per-pixel jitter so the samples dither instead of banding. Saturating, so a
  // full breach floods the air without clipping it flat.
  vec3 riftShafts(vec3 ro, vec3 rd, float T, float den) {
    float far = min(T, 26.0);
    float acc = 0.0;
    float jit = hash21(gl_FragCoord.xy + fract(iTime * 7.3) * 13.0);
    float n   = 8.0 + 8.0 * uHeavy;
    float prv = 0.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      if (fi >= n) break;
      float s  = (fi + jit) / n;
      float ti = far * s * s;
      vec3  x  = ro + rd * ti;
      vec2  e  = riftEdge(riftPlane(x));
      float sh = exp(-e.x * e.x * 120.0) * e.y;
      acc += sh * exp(-max(x.y + 1.0, 0.0) * 0.12) * exp(-ti * den) * (ti - prv);
      prv  = ti;
    }
    return RIFT_RED * (1.0 - exp(-acc * uRift.z * (0.55 + 0.45 * uRift.w) * 0.6));
  }

`
