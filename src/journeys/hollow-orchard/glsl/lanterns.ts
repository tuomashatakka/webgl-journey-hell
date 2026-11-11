// The lanterns: bioluminescent bodies planted beside the walked line, one trail
// per stage. They are what the orchard is lit by. The key light alone left every
// stage one colour under one flat light, with nothing to look at and nothing
// leading anywhere; a line of foxfire receding into the spores gives each stage
// a focal point, a second colour against its palette, and a direction.
//
// Each stage lays its lanterns out along z at its own spacing, one per cell,
// jittered and on a hashed side. A lantern is a position in the straight frame
// (the one the stages are authored in) plus a style. Three things read it:
//   * sdLantern     its body, added to the stage it belongs to
//   * lanternLight  the light it throws on whatever surface was hit
//   * lanternHalo   the glow of the spore-laden air around it, integrated along
//                   the view ray in closed form, so it costs no march steps
// Colour and brightness are the CPU's (uLantern); layout and shape are here.

export const lanternsGlsl = `  // --- the lanterns ---------------------------------------------------------
  // Styles: 0 ground cluster · 1 pod on a cord · 2 wall nodule · 3 drifting wisp

  float lanternSpacing(float id) {
    if (id < 1.5)  return 5.0;
    if (id < 2.5)  return 7.0;
    if (id < 3.5)  return 5.5;
    if (id < 4.5)  return 5.0;
    if (id < 5.5)  return 4.5;
    if (id < 6.5)  return 7.0;
    if (id < 7.5)  return 7.0;
    if (id < 8.5)  return 5.0;
    if (id < 9.5)  return 5.5;
    if (id < 10.5) return 4.0;
    if (id < 11.5) return 6.0;
    return 4.5;
  }

  // Lantern k of stage id: xyz in the straight frame, w the style. Placed clear
  // of the aisle (about 1.3 either side of the walked line), or the carve that
  // keeps the camera's path open would eat them.
  vec4 lanternAt(float id, float k) {
    float S  = lanternSpacing(id);
    float h1 = hash11(k * 3.17 + id * 11.3);
    float h2 = hash11(k * 5.71 + id * 7.9);
    float h3 = hash11(k * 9.13 + id * 2.3);
    float z  = (k + 0.5 + (h1 - 0.5) * 0.5) * S;
    float sd = h2 < 0.5 ? -1.0 : 1.0;
    float x  = trackX(z);

    if (id < 1.5) return vec4(x + sd * mix(1.9, 2.8, h3), -0.08, z, 0.0);
    if (id < 2.5) return vec4(x + sd * 2.3, mix(3.2, 4.4, h3), z, 1.0);
    if (id < 3.5) return vec4(x + sd * mix(1.9, 2.6, h3), -0.08, z, 0.0);
    if (id < 4.5) return vec4(x + sd * 1.35, rootArch(z).y - 0.6, z, 1.0);
    if (id < 5.5) {
      // On the wall of the tube, anywhere but its floor, riding in with the
      // wall where a sphincter clenches.
      vec2  c = fruitingAxis(z);
      float a = mix(-0.3, 3.44, h3);
      float r = fruitingBore(z).x - 0.35;
      return vec4(c.x + cos(a) * r, c.y + sin(a) * r, z, 2.0);
    }
    if (id < 6.5) return vec4(x + sd * mix(2.0, 3.0, h3), -0.08, z, 0.0);
    if (id < 7.5) return vec4(x + sd * 2.6, mix(4.0, 5.5, h3), z, 1.0);
    if (id < 8.5) {
      float a = mix(-0.5, 3.64, h3);
      return vec4(cos(a) * 4.9, 1.5 + sin(a) * 4.9, z, 2.0);
    }
    if (id < 9.5)  return vec4(x + sd * 2.0, mix(2.6, 4.0, h3), z, 1.0);
    if (id < 10.5) return vec4(x + sd * mix(1.4, 2.4, h3), mix(-0.4, 2.4, h1) + sin(iTime * 0.9 + k) * 0.2, z, 3.0);
    if (id < 11.5) return vec4(x + sd * 2.4, mix(3.0, 4.5, h3), z, 1.0);
    // COMPOST: will-o'-the-wisps, bobbing over the sludge.
    return vec4(x + sd * mix(1.4, 2.2, h3), mix(0.2, 1.0, h1) + sin(iTime * 1.3 + k * 2.1) * 0.25, z, 3.0);
  }

  // How bright lantern k is right now, 0..1. They pulse slowly; in TRANSITION
  // they are dying and gutter, and the wisps in COMPOST waver.
  float lanternPower(float id, float k) {
    float h = hash11(k * 7.77 + id * 3.3);
    float p = mix(0.65, 1.0, h) * (0.82 + 0.18 * sin(iTime * (0.6 + h) + h * 20.0));
    if (id > 5.5 && id < 6.5)
      p *= 0.35 + 0.65 * smoothstep(-0.3, 0.6, sin(iTime * (3.0 + h * 5.0) + h * 40.0) + sin(iTime * 1.7 + h * 9.0));
    if (id > 11.5)
      p *= 0.6 + 0.4 * sin(iTime * 2.3 + h * 17.0);
    return p;
  }

  // Where its light comes from: the caps of a ground cluster, not its foot.
  vec3 lanternCentre(vec4 L) {
    return L.xyz + vec3(0.0, L.w < 0.5 ? 0.4 : 0.0, 0.0);
  }

  // The body of one lantern, local to it. x: distance, y: 1 if the emitting
  // part is the nearer one, 0 for a stem or a cord.
  vec2 lanternBody(vec3 o, float style, float k) {
    if (style < 0.5) {
      // Three small caps on thin stems, rooted in the floor.
      float bound = length(o - vec3(0.0, 0.3, 0.0)) - 0.95;
      if (bound > 0.3) return vec2(bound, 0.0);
      float stem = 1e4, cap = 1e4;
      float a0   = hash11(k * 1.9) * TAU;
      for (int i = 0; i < 3; i++) {
        float fi  = float(i);
        float a   = a0 + fi * 2.4;
        vec3  off = vec3(cos(a), 0.0, sin(a)) * (fi < 0.5 ? 0.0 : 0.2 + fi * 0.08);
        float hg  = 0.52 - fi * 0.13;
        float r   = 0.26 - fi * 0.05;
        stem = min(stem, sdVertCone(o - off, hg, 0.045, 0.03));
        cap  = min(cap, sdCap(o - off - vec3(0.0, hg, 0.0), r, r * 0.55));
      }
      return cap < stem ? vec2(cap, 1.0) : vec2(stem, 0.0);
    }
    if (style < 1.5) {
      // A swollen pod hung on a cord from whatever is overhead.
      float pod  = sdEllipsoid(o, vec3(0.26, 0.4, 0.26));
      float cord = sdCapsule(o, vec3(0.0, 0.2, 0.0), vec3(0.0, 6.0, 0.0), 0.018);
      return pod < cord ? vec2(pod, 1.0) : vec2(cord, 0.0);
    }
    if (style < 2.5) {
      // Nodules grown out of a wall.
      float d = sdSphere(o, 0.27);
      d = smin(d, sdSphere(o - vec3(0.2, 0.18, 0.14), 0.16), 0.08);
      d = smin(d, sdSphere(o - vec3(-0.16, -0.12, 0.2), 0.12), 0.08);
      return vec2(d, 1.0);
    }
    return vec2(sdSphere(o, 0.13), 1.0);
  }

  // Nearest lantern body to p (straight frame). A cell's lantern sits in the
  // middle half of the cell, so the cell and its neighbour on the near side are
  // enough for bodies this small. Writes the lantern's power to gLanternPower.
  float gLanternPower;
  vec2 sdLantern(vec3 p, float id) {
    float S  = lanternSpacing(id);
    float k  = floor(p.z / S);
    float kn = k + (fract(p.z / S) < 0.5 ? -1.0 : 1.0);
    vec4  La = lanternAt(id, k);
    vec4  Lb = lanternAt(id, kn);
    vec2  a  = lanternBody(p - La.xyz, La.w, k);
    vec2  b  = lanternBody(p - Lb.xyz, Lb.w, kn);
    gLanternPower = lanternPower(id, a.x < b.x ? k : kn);
    return a.x < b.x ? a : b;
  }

  // Light from the three nearest lanterns on a surface at ps (straight frame)
  // with normal n. Windowed to nothing by 1.2 cells, which is closer than any
  // lantern outside the three can be, so no cell edge shows in the light.
  vec3 lanternLight(vec3 ps, vec3 n, float id) {
    float S   = lanternSpacing(id);
    float k0  = floor(ps.z / S);
    float acc = 0.0;
    for (int j = 0; j < 3; j++) {
      float k  = k0 - 1.0 + float(j);
      vec4  L  = lanternAt(id, k);
      vec3  v  = lanternCentre(L) - ps;
      float d2 = dot(v, v);
      float dd = sqrt(d2);
      float w  = 1.0 - smoothstep(0.45 * S, 1.2 * S, dd);
      float nl = clamp(dot(n, v / max(dd, 1e-3)) * 0.8 + 0.2, 0.0, 1.0);
      acc += nl * w * lanternPower(id, k) / (1.0 + d2 * 0.35);
    }
    return uLantern * acc;
  }

  // The shine of the same three lanterns on a wet surface: FRUITING BODY is a
  // gut, and a gut is read by its highlights before its colour.
  float lanternGloss(vec3 ps, vec3 n, vec3 rd, float id) {
    float S   = lanternSpacing(id);
    float k0  = floor(ps.z / S);
    float acc = 0.0;
    for (int j = 0; j < 3; j++) {
      float k  = k0 - 1.0 + float(j);
      vec3  v  = lanternCentre(lanternAt(id, k)) - ps;
      float d2 = dot(v, v);
      float dd = sqrt(d2);
      float w  = 1.0 - smoothstep(0.45 * S, 1.2 * S, dd);
      vec3  h  = normalize(v / max(dd, 1e-3) - rd);
      acc += pow(clamp(dot(n, h), 0.0, 1.0), 24.0) * w * lanternPower(id, k) / (1.0 + d2 * 0.12);
    }
    return acc;
  }

  // The halo: the light each lantern scatters off the spores between the eye
  // and whatever the ray hit at distance T. The kernel r^2 / (r^2 + d^2) has a
  // closed-form integral along a line, so seven lanterns cost fourteen atans.
  vec3 lanternHalo(vec3 ro, vec3 rd, float T, float id, float den) {
    float S   = lanternSpacing(id);
    float k0  = floor(gRo.z / S);
    float acc = 0.0;
    const float R2 = 0.36;
    for (int j = 0; j < 7; j++) {
      float k = k0 - 1.0 + float(j);
      vec4  L = lanternAt(id, k);
      vec3  c = lanternCentre(L);
      vec3  v = vec3(c.x + pathX(c.z), c.y, c.z) - ro;
      float b = dot(v, rd);
      float s = sqrt(R2 + max(dot(v, v) - b * b, 0.0));
      float I = R2 / s * (atan((T - b) / s) - atan(-b / s));
      acc += I * lanternPower(id, k) * exp(-max(b, 0.0) * den);
    }
    return uLantern * acc;
  }

`
