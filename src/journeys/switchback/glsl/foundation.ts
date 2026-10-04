import { HASH21 } from '@wjh/glsl/hash'
import { SD_BOX, SD_BOX2, SD_ROUND_BOX } from '@wjh/glsl/sdf'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'


export const foundationGlsl = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;

  uniform vec4 uSecA[3];
  uniform vec4 uSecB[3];
  uniform vec4 uSecC[3];
  uniform vec4 uBend;
  uniform vec4 uCart;
  uniform vec4 uRide;
  uniform vec4 uAtm;
  uniform vec4 uSun;
  uniform vec4 uUp;

  /**
   * The fall and the fissures.
   *   x  0..1 how far into the shaft
   *   y  0..1 speed past everything the railway was capable of, logarithmic
   *   z  the shaft's corkscrew, radians, wrapped
   *   w  0..1 fissure density — grows every lap, saturates in the shaft
   */
  uniform vec4 uFall;

  const float PI = 3.14159265;

  // Room types. Kept in step with kinematics.ts by hand, which is the one piece
  // of duplication this design could not remove: a fragment shader cannot import.
  const float T_PLATFORM  = 0.0;
  const float T_DRIFT     = 1.0;
  const float T_SCAFFOLD  = 2.0;
  const float T_CONCOURSE = 3.0;
  const float T_CHAPEL    = 4.0;
  const float T_OVERLOOK  = 5.0;

  // The seventh room, which is not in the lap and is not a room. Past four laps
  // the rails stop and this is what is on the other side of them.
  const float T_FALL      = 6.0;

  // Half the track gauge. Narrow, because this is an ore railway that something
  // later decided to run a train of open tubs down.
  const float GAUGE = 0.45;

  // Sleeper and trestle-bay pitches. Both divide PHASE_WRAP on the CPU side —
  // that is what lets the phase be folded without the whole railway jumping.
  const float TIE_PITCH  = 2.5;
  const float BENT_PITCH = 10.0;

  // Ditto: the chapel's fold is mirrored on this period so that it, too, survives
  // the fold in the phase. Nothing else in the journey is aperiodic along z.
  const float FOLD_PITCH = 64.0;

  // Rooms extend this far past both ends of their nominal z-range. Load bearing:
  // two adjacent air volumes would otherwise only touch on a plane, the union
  // would read exactly 0 there, and the march would see the portal as sealed.
  const float OVERLAP = 1.2;

  // The swept clearance, as a cross-section. Every prop is intersected with the
  // complement of this, so nothing can be authored into the cart's path. In a
  // rectified space the swept tube is a constant, which is the whole trick.
  const vec2 CLEAR_C = vec2(0.0, 1.05);
  const vec2 CLEAR_H = vec2(1.32, 1.20);

  // How far the march is allowed to reach. Past this everything is fog anyway,
  // and the bend fit is pinned at 56 — beyond that the quadratic is extrapolating.
  const float T_MAX = 92.0;

  /**
   * Volumetric sampling: a fixed step in metres, not a fixed fraction of however
   * far this particular ray got.
   *
   * A fraction of the hit distance is the obvious way to write it and it is the
   * one that draws a hard line across the picture. The estimator scales with the
   * spacing, the spacing scales with the hit distance, and the hit distance jumps
   * by tens of metres across a silhouette — so every silhouette in the frame gets
   * a step change in the glow *beside* it, and in a tunnel that dives away from
   * you the silhouette is the roofline: one razor-straight horizontal edge, from
   * one side of the screen to the other, that no geometry accounts for.
   *
   * With a fixed step, moving the far end only adds or removes the last sample,
   * and that one is faded in over its own step (see VOL_FADE below) so even that
   * is continuous. Sixteen steps of 2.6m reaches past where any of this fog lets
   * you see anyway.
   */
  const float VOL_STEP = 2.6;

  /** Everything one room knows about itself. Resolved from a depth by roomAt. */
  struct Room {
    float type;
    float bore;
    float ceilH;
    float floorD;
    float lamp;    // pitch along the track
    float lampY;   // and the height they hang at
    float grime;
    float sky;
    float lit;
  };

  ${HASH21}

  ${valueNoise2('hash21')}
  ${fbm2({ octaves: 4, next: 'p = mat2(1.6, 1.2, -1.2, 1.6) * p;' })}

  /** Grid Run's hue ramp. Three phase-shifted sines, and it never leaves gamut. */
  vec3 hue(float a) { return 0.5 + 0.5 * sin(3.14159 * a + vec3(1.0, 2.0, 3.0)); }

  // ---- primitives. Exact, all of them, so the step factor can stay near 1. ----

  ${SD_BOX2}
  ${SD_BOX}
  ${SD_ROUND_BOX}

  /**
   * Fold onto the nearest cell of an unbounded lattice. Exact for identical
   * axis-aligned instances — on a lattice of congruent shapes the nearest centre
   * really is the nearest instance, which is why nothing repeated in this file
   * jitters its *position*, however much it would like to.
   */
  float latt(float x, float cell) { return x - (floor(x / cell) + 0.5) * cell; }

  /**
   * The same fold, continuous. 'latt' jumps by a whole cell at every boundary, so
   * anything *accumulated along a ray* from it draws the lattice instead of the
   * light — natatorium learned this the expensive way, with a volumetric that
   * rendered as a flat tile-shaped rectangle instead of a shaft. abs() of it is a
   * triangle wave, is continuous everywhere, and is still 1-Lipschitz, which is
   * what both a swept term and a mirrored SDF need.
   */
  float lattAbs(float x, float cell) { return abs(latt(x, cell)); }

  // ---- the bend ------------------------------------------------------------

  vec2 bendAt(float z)  { return vec2(uBend.x * z + uBend.y * z * z, uBend.z * z + uBend.w * z * z); }
  vec2 bendDot(float z) { return vec2(uBend.x + 2.0 * uBend.y * z, uBend.z + 2.0 * uBend.w * z); }

  /** Camera space -> track space. Exact. */
  vec3 toTrack(vec3 p) {
    vec2 b = bendAt(p.z);
    return vec3(p.x - b.x, p.y - b.y + uCart.w, p.z);
  }

  /** A *direction* into track space, at the depth it is being used at. */
  vec3 toTrackDir(vec3 v, float z) {
    vec2 b = bendDot(z);
    return normalize(vec3(v.x - b.x * v.z, v.y - b.y * v.z, v.z));
  }

  /** The Lipschitz bound of that shear. Never below 1, so it can only shorten a step. */
  float lipschitz(float z) { return 1.0 + length(bendDot(z)); }

  /** Distance along the track, folded, for everything that repeats. */
  float phaseAt(float z) { return z + uCart.x; }

  // ---- the fissures --------------------------------------------------------
  //
  // One field, read twice: once by the surface, where it is a split in the wall,
  // and once by the volumetrics, where it is the beam coming through the split.
  // Sharing it is not an optimisation — it is the only way a beam reliably has a
  // crack at the end of it, and two fields tuned to look alike drift apart the
  // moment either is touched.

  /**
   * The vein field. Its zero set is the fissure; a widens it and, separately,
   * lowers the patch threshold, so the first lap shows one split in a wall and
   * the fourth shows a craquelure.
   */
  float fissure(vec2 uv, float a) {
    float v = fbm(uv * 0.55) - 0.5;
    float w = 0.010 + a * 0.030;
    float seam = smoothstep(w, w * 0.15, abs(v));

    // The patch term is what keeps this a set of cracks rather than a texture.
    // Without it — or with it opened too far — the seams reach everywhere at
    // once and the wall stops reading as broken and starts reading as red.
    float patch = smoothstep(0.60 - a * 0.30, 0.88 - a * 0.30, fbm(uv * 0.12 + 4.7));
    return seam * patch;
  }

  /**
   * Where on the wall a point is, as the fissure field's coordinates.
   *
   * Low frequency on purpose: a crack is metres long. At the frequency this
   * started at the field was finer than the fog could resolve, so every beam
   * landed on top of every other one and the whole shaft turned into static.
   */
  vec2 fissureUV(vec3 q, float side) {
    return vec2(phaseAt(q.z) * 0.42, q.y * 1.15 + side * 4.3);
  }

  /**
   * The shaft's corkscrew.
   *
   * The rotation is an isometry and costs the sphere trace nothing. The lateral
   * snake after it is a shear, and its slope is held at 0.07 so mapTrack's claim
   * to be 1-Lipschitz is still true to within the 0.92 the march already steps at.
   */
  vec3 fallWarp(vec3 q) {
    float a = uFall.z + q.z * 0.0125;
    float c = cos(a), sn = sin(a);
    q.xy = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
    q.x += sin(q.z * 0.032 + uFall.z * 2.0) * 2.2 * uFall.x;
    return q;
  }

`
