export const surfaceTextureGlsl = `  // ========================= SURFACE TEXTURE ===============================
  // No image textures: one draw call, no render targets, no assets. Every
  // material is built from a height field, and that one field does three jobs —
  // it tints the albedo, it drives the roughness, and its gradient perturbs the
  // normal, which is what actually makes plate read as plate rather than as a
  // flat-shaded box.

  /** Planar projection onto whichever axis the surface faces least. */
  vec2 surfUV(vec3 p, vec3 n) {
    vec3 a = abs(n);
    if (a.y > a.x && a.y > a.z) return p.xz;
    if (a.x > a.z) return p.zy;
    return p.xy;
  }

  /**
   * Triplanar blend weights, sharpened.
   *
   * surfUV picks one axis and stops, which is right up until a surface faces
   * two of them at once — and every rivet head, gear tooth and rounded box
   * corner in this shader does. The pick then swaps abruptly across the corner
   * and the texture visibly shears. Blending three projections costs three
   * evaluations instead of one, and it is the difference between a material and
   * a decal. The exponent keeps the blend narrow so flat faces stay crisp.
   */
  vec3 triWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(6.0));
    return w / max(w.x + w.y + w.z, 1e-4);
  }

  /**
   * Detail fade.
   *
   * The finest layers are around a millimetre of feature at a metre's range, and
   * past a few metres a pixel covers many of them — evaluating them there is
   * paying full price for aliasing. This is the shader's stand-in for a mip
   * chain, which a procedural material does not otherwise get.
   */
  float detailFade(float dist) {
    return 1.0 - smoothstep(3.0, 16.0, dist);
  }

  /** Anisotropic rolling grain — the direction the plate came off the mill. */
  float grain(vec2 uv) {
    return vnoise(vec2(uv.x * 1.6, uv.y * 42.0)) * 0.6 + vnoise(uv * 7.0) * 0.4;
  }

  /**
   * The micro layer: orange-peel under the mill scale, at two scales an order of
   * magnitude apart. This is the one that stops a surface reading as "shaded
   * geometry" at conversational distance — real steel is never smooth at 5 mm,
   * and the eye knows it even when it cannot name what it is looking at.
   */
  float micro(vec2 uv) {
    return vnoise(uv * 96.0) * 0.62 + vnoise(uv * 310.0) * 0.38;
  }

  /**
   * The macro layer: broad corrosion blooms metres across, drifting slowly out
   * of the low frequencies. Wear alone is one octave of noise and it tiles to
   * the eye; this breaks the repeat at the scale a whole wall is read at.
   */
  float bloom(vec2 uv) {
    return fbm(uv * 0.16) * 0.7 + fbm(uv * 0.44 + 11.3) * 0.3;
  }

  /** Runs of pale efflorescence and dried coolant, following gravity. */
  float salting(vec3 p, vec3 n) {
    float run = fbm(vec2(p.x * 3.1 + p.z * 3.1, p.y * 0.12 - 4.0));
    return (1.0 - abs(n.y)) * smoothstep(0.58, 0.86, run) *
      smoothstep(0.30, 0.70, fbm(vec2(p.x * 0.7, p.z * 0.7)));
  }

  /** Corrosion: sparse deep pits scattered through the broad rust blooms. */
  float pitting(vec2 uv) {
    vec2 c = floor(uv * 18.0);
    vec2 f = fract(uv * 18.0) - 0.5 -
      (vec2(hash21(c + 3.1), hash21(c + 7.7)) - 0.5) * 0.7;
    return smoothstep(0.42, 0.0, length(f)) * step(0.66, hash21(c));
  }

  /** Weld beads where plate meets plate, on a 1.2 m grid. */
  float weldSeam(vec2 uv) {
    vec2 g = abs(fract(uv / 1.2 + 0.5) - 0.5) * 1.2;
    return smoothstep(0.05, 0.0, min(g.x, g.y)) * (0.7 + 0.3 * vnoise(uv * 22.0));
  }

  /** Rivet heads following the weld lines. */
  float rivets(vec2 uv) {
    vec2 g = abs(fract(uv / 1.2 + 0.5) - 0.5) * 1.2;
    vec2 q = fract(uv / 0.16) - 0.5;
    return smoothstep(0.055, 0.0, min(g.x, g.y)) * smoothstep(0.34, 0.10, length(q));
  }

  /** Grime running down from every horizontal edge. */
  float streaks(vec3 p, vec3 n) {
    return (1.0 - abs(n.y)) *
      smoothstep(0.42, 0.95, fbm(vec2(p.x * 2.6 + p.z * 2.6, p.y * 0.22)));
  }

  /**
   * Raised diamond tread on the walking surfaces.
   *
   * Scaled to real deck plate: the raised pattern on industrial floor plate is
   * 60–90 mm across, not the third of a metre this used to draw. At that
   * frequency it aliases hard past a few metres, which is what detailFade is
   * for — the tread is a near-field layer and nothing else.
   */
  float treadPlate(vec2 uv) {
    vec2 q = uv * 17.0;
    vec2 a = fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5;
    return smoothstep(0.36, 0.18, max(abs(a.x), abs(a.y)));
  }

  /**
   * The height field, per material. Everything the eye reads as "machined" or
   * "corroded" or "walked on" is this function plus the gradient of it.
   */
  /** The height field on one planar projection. */
  float matHeightUV(vec2 uv, float mat, float wear, float lod) {
    if (mat < 0.5) {
      // Structural plate: welded, riveted, pitted, treaded where you walk, and
      // orange-peeled everywhere.
      float h = weldSeam(uv) * 0.9 + rivets(uv) * 0.7 + grain(uv) * 0.10;
      h -= pitting(uv) * smoothstep(0.4, 0.9, wear) * 1.4;
      h += bloom(uv) * 0.22 + micro(uv) * 0.07 * lod;
      return h;
    }
    if (mat < 1.5)
      // Painted frame: a smooth film, broken where it has chipped to primer,
      // and orange-peeled the way a sprayed film always is.
      return grain(uv) * 0.20 - smoothstep(0.42, 0.72, wear) * 0.9
        + micro(uv) * 0.05 * lod;
    if (mat < 2.5)
      // Offcut: hot-rolled scale, coarse and scabby, flaking at the edges.
      return fbm(uv * 14.0) * 1.1 + micro(uv) * 0.12 * lod;
    if (mat < 3.5)
      // Machined: fine turning grooves, the odd score, and the tool's own
      // chatter under both.
      return sin(uv.y * 210.0) * 0.10 + vnoise(uv * 40.0) * 0.10
        + sin(uv.y * 1180.0) * 0.022 * lod + micro(uv) * 0.03 * lod;
    if (mat < 5.5)
      // Rail steel: worn glassy on the running face, pitted off it.
      return grain(uv) * 0.35 - pitting(uv) * 0.7 + micro(uv) * 0.04 * lod;
    // Span plate: brushed deck, hinge seams proud, tread where boots land.
    return grain(uv) * 0.30 + weldSeam(uv * 1.7) * 0.5
      + treadPlate(uv) * 0.55 * lod + micro(uv) * 0.06 * lod;
  }

  /**
   * The height field, per material, triplanar-blended.
   *
   * Everything the eye reads as "machined" or "corroded" or "walked on" is this
   * function plus the gradient of it, so it carries three scales at once: the
   * bloom that a whole wall is read at, the plate/weld/rivet layer a step away,
   * and the micro layer that only exists within arm's reach — the last of these
   * faded out with distance, because past a few metres it is nothing but noise
   * in a pixel that cannot resolve it.
   */
  float matHeight(vec3 p, vec3 n, float mat, float wear, float lod) {
    if (lod < 0.02) return matHeightUV(surfUV(p, n), mat, wear, 0.0);
    vec3 w = triWeights(n);
    float h = 0.0;
    if (w.y > 0.002) h += w.y * matHeightUV(p.xz, mat, wear, lod);
    if (w.x > 0.002) h += w.x * matHeightUV(p.zy, mat, wear, lod);
    if (w.z > 0.002) h += w.z * matHeightUV(p.xy, mat, wear, lod);
    // Tread is the one layer that is not a property of the material but of which
    // way the surface faces: it is raised on the plate you walk on and nowhere
    // else, so it goes on after the blend rather than inside it.
    if (mat < 0.5) h += treadPlate(p.xz) * step(0.72, n.y) * 1.1 * lod;
    return h;
  }

  /**
   * Perturb the shading normal by the gradient of the height field, projected
   * onto the surface. Four extra field evaluations, but only at the hit point —
   * the march itself never pays for them.
   */
  vec3 bumpNormal(vec3 p, vec3 n, float mat, float wear, float amp, float lod) {
    vec2 e = vec2(0.02, 0.0);
    float h0 = matHeight(p, n, mat, wear, lod);
    vec3 g = vec3(matHeight(p + e.xyy, n, mat, wear, lod),
                  matHeight(p + e.yxy, n, mat, wear, lod),
                  matHeight(p + e.yyx, n, mat, wear, lod)) - h0;
    g = clamp(g / e.x, -12.0, 12.0);
    g -= n * dot(n, g);
    return normalize(n - g * amp);
  }

  /**
   * Cavity from the same height field: how far below its neighbours a point sits.
   *
   * This is what a normal map cannot do. A perturbed normal tells the light
   * which way a pit faces; it says nothing about the fact that a pit is a hole
   * with less of the room visible from inside it. Darkening the crevices and
   * killing the specular in them is most of what separates "bumpy" from "worn",
   * and it costs one extra evaluation because h0 is already in hand.
   */
  float cavity(vec3 p, vec3 n, float mat, float wear, float lod) {
    float h0 = matHeight(p, n, mat, wear, lod);
    float hw = (matHeight(p + vec3(0.06, 0.0, 0.0), n, mat, wear, lod) +
                matHeight(p + vec3(0.0, 0.06, 0.0), n, mat, wear, lod) +
                matHeight(p + vec3(0.0, 0.0, 0.06), n, mat, wear, lod)) / 3.0;
    return clamp(0.5 + (h0 - hw) * 1.6, 0.0, 1.0);
  }

`
