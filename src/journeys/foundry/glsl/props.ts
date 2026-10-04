// The clutter: crates, drums, hydraulic power packs and the pipework that feeds
// them, stood along the walls between each hall's own machinery, and the steam
// that the pipework loses on the way.

export const propsGlsl = /* glsl */`
  // ============================ THE CLUTTER =================================
  // Placed on a per-hall lattice that falls *between* the machine stations, so
  // a crate never stands where a ram drives out or a gear rises. The brake run
  // is too narrow to stand anything in, and the furnace floor is mostly a hole.

  /** Hall i's prop lattice: x = spacing (0 = none), y = offset. */
  vec2 propSlot(float i) {
    if (i < 0.5) return vec2(12.0, 0.0);
    if (i < 1.5) return vec2(6.0, 0.0);
    if (i < 2.5) return vec2(9.0, 0.0);
    if (i < 3.5) return vec2(6.0, 0.0);
    if (i < 4.5) return vec2(12.0, 0.0);
    return vec2(0.0);
  }

  float sdCylZ(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xy) - r, abs(p.z) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  /** A 200 l drum: body, two rolling hoops, a lip at each end. */
  float drum(vec3 q) {
    float body = sdCylY(q, 0.29, 0.44);
    float hoops = length(vec2(length(q.xz) - 0.295, abs(abs(q.y) - 0.15) )) - 0.012;
    float lips = length(vec2(length(q.xz) - 0.29, abs(q.y) - 0.44)) - 0.02;
    return min(body, min(hoops, lips));
  }

  /** A slatted crate: the box, with the end battens standing proud. */
  float crate(vec3 q, vec3 h) {
    float box = sdBox(q, h - 0.02);
    float battens = sdBox(vec3(q.x, q.y, abs(q.z) - h.z + 0.04), vec3(h.x, h.y, 0.04));
    float rails = sdBox(vec3(abs(q.x) - h.x + 0.04, abs(q.y) - h.y + 0.08, q.z), vec3(0.04, 0.06, h.z));
    return min(box, min(battens, rails));
  }

  float sdSeg(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r;
  }

  /** A hose from a to b, sagging between them. */
  float hose(vec3 q, vec3 a, vec3 b, float sag) {
    vec3 m = (a + b) * 0.5 - vec3(0.0, sag, 0.0);
    return min(sdSeg(q, a, m, 0.045), sdSeg(q, m, b, 0.045));
  }

  /**
   * One station's props, in the wall's frame: x out of the wall, y up from the
   * floor, z along the hall. mat: 9 crate, 10 drum, 12 power pack, 3 machined,
   * 13 hose.
   */
  float stationProps(vec3 q, float h, float H, out float mat, out float paint) {
    float kind = floor(fract(h * 7.13) * 4.0);
    float d = 1e3;
    mat = 9.0;
    paint = 0.0;
    if (kind < 0.5 || kind > 2.5) {
      // Crates, stacked as they were dropped.
      float s = 0.36 + 0.12 * fract(h * 3.7);
      float c = crate(q - vec3(s + 0.06, s, -0.55), vec3(s));
      vec3 t = q - vec3(s + 0.08, s * 2.0 + 0.3, -0.5);
      t.xz = rot(0.35 * (fract(h * 9.1) - 0.5)) * t.xz;
      c = min(c, crate(t, vec3(0.3)));
      c = min(c, crate(q - vec3(0.4, 0.34, 0.45), vec3(0.34)));
      d = c;
    }
    if (kind > 0.5 && kind < 1.5 || kind > 2.5) {
      // Drums, one of them on its side where it was knocked over.
      float dz = kind > 2.5 ? 1.0 : 0.0;
      float r0 = drum(q - vec3(0.36, 0.44, -0.7 + dz));
      float r1 = drum(q - vec3(0.36, 0.44, dz));
      float r2 = kind < 2.5 ? drum(q - vec3(0.98, 0.44, -0.35)) : 1e3;
      vec3 lie = q - vec3(1.0, 0.3, 0.75 + dz);
      float r3 = min(sdCylZ(lie, 0.29, 0.44), length(vec2(length(lie.xy) - 0.295, abs(abs(lie.z) - 0.15))) - 0.012);
      float r = min(min(r0, r1), min(r2, r3));
      // Each drum its own batch of paint.
      float which = r == r0 ? 0.0 : r == r1 ? 1.0 : r == r2 ? 2.0 : 3.0;
      if (r < d) { d = r; mat = 10.0; paint = fract(h * 13.1 + which * 0.37); }
    }
    if (kind > 1.5 && kind < 2.5) {
      // A hydraulic power pack: the tank, the motor on it, an accumulator, and
      // the hoses climbing to the service pipes.
      float tank = sdBox(q - vec3(0.52, 0.42, 0.0), vec3(0.46, 0.42, 0.78));
      float plinth = sdBox(q - vec3(0.52, 0.03, 0.0), vec3(0.52, 0.03, 0.84));
      d = min(tank, plinth);
      mat = 12.0;
      float motor = min(sdCylZ(q - vec3(0.5, 1.08, 0.25), 0.22, 0.34), sdCylZ(q - vec3(0.5, 1.08, -0.18), 0.1, 0.12));
      float acc = sdCylY(q - vec3(0.38, 1.2, -0.52), 0.15, 0.36) - 0.02;
      float m = min(motor, acc);
      if (m < d) { d = m; mat = 3.0; }
      float hs = min(hose(q, vec3(0.38, 1.6, -0.52), vec3(0.42, H - 0.55, -0.9), 0.25),
                     hose(q, vec3(0.6, 0.9, 0.7), vec3(0.75, H - 0.45, 1.2), 0.35));
      if (hs < d) { d = hs; mat = 13.0; }
    }
    return d;
  }

  /** Service pipes along both walls under the ceiling: two runs, flanged every 3 m, on brackets. */
  float mapPipes(vec3 p, float zc, float W, float H) {
    vec2 q = vec2(W - abs(p.x), p.y);
    float fz = mod(zc + 1.5, 3.0) - 1.5;
    float a = length(q - vec2(0.32, H - 0.55)) - 0.13;
    float b = length(q - vec2(0.64, H - 0.42)) - 0.085;
    float fa = max(length(q - vec2(0.32, H - 0.55)) - 0.19, abs(fz) - 0.035);
    float fb = max(length(q - vec2(0.64, H - 0.42)) - 0.13, abs(fz) - 0.03);
    float bracket = sdBox(vec3(q.x - 0.4, q.y - (H - 0.3), fz - 0.45), vec3(0.4, 0.03, 0.03));
    return min(min(min(a, b), min(fa, fb)), bracket);
  }

  /** The props of the station p is in, plus the pipework. mat as stationProps, 11 for pipe. */
  float mapProps(vec3 p, float zc, float W, float H, float sec, out float mat, out float paint) {
    mat = 11.0;
    paint = hash11(floor(zc / 6.0) + (p.x < 0.0 ? 7.0 : 0.0)) + (p.y > H - 0.5 ? 0.5 : 0.0);
    float d = 1e3;
    if (sec < 5.5 && abs(sec - 3.0) > 0.5) d = mapPipes(p, zc, W, H);

    vec2 slot = propSlot(sec);
    if (slot.x < 0.5 || W < 2.4) return d;
    float st = floor((zc - slot.y) / slot.x + 0.5);
    float zs = st * slot.x + slot.y;
    float lz = zc - zs;
    // A bulkhead stands on every hall boundary; nothing is stood against it.
    if (abs(zs - SEC_LEN * floor(zs / SEC_LEN + 0.5)) < 1.5) return min(d, slot.x - abs(lz) - 2.6);
    float h = hash11(st * 7.31 + sec * 3.7);
    float side = h < 0.5 ? -1.0 : 1.0;
    vec3 q = vec3(W - side * p.x, p.y, lz);
    if (q.x > 2.6 || abs(lz) > 2.8) return min(d, max(max(q.x - 2.3, abs(lz) - 2.5), 0.3));
    float pm, pp;
    float s = stationProps(q, h, H, pm, pp);
    if (s < d) { d = s; mat = pm; paint = pp; }
    return d;
  }

  /**
   * Steam lost from the pipe flanges: a jet out of the joint that slows,
   * spreads and rises. Density at p, for the march to gather.
   */
  float steamAt(vec3 p, float zc, float W, float H, float sec) {
    if (sec > 5.5) return 0.0;
    float fi = floor(zc / 3.0 + 0.5);
    float side = p.x < 0.0 ? -1.0 : 1.0;
    float h = hash11(fi * 3.91 + side * 1.3 + sec);
    if (h > 0.3) return 0.0;
    vec3 q = vec3(W - side * p.x, p.y, zc - fi * 3.0) - vec3(0.5, H - 0.55, 0.0);
    // Jet into the hall, bending upward as it slows.
    float s = max(q.x, 0.0);
    vec3 axis = vec3(s, 0.35 * s * s * 0.25 - 0.05 * s, 0.0);
    float w = 0.06 + 0.22 * s;
    vec3 r = q - axis;
    float dens = exp(-dot(r.yz, r.yz) / (w * w)) * exp(-s * 0.55) * step(-0.1, q.x);
    float puff = 0.6 + 0.4 * sin(iTime * (5.0 + h * 9.0) + h * 40.0);
    float churn = vnoise(vec2(s * 3.0 - iTime * 4.0, q.y * 5.0 + q.z * 3.0));
    return dens * puff * (0.5 + churn);
  }
`
