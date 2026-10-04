import { HASH11, HASH21 } from '@wjh/glsl/hash'
import { SD_BOX, SD_ROUND_BOX, SD_SPHERE } from '@wjh/glsl/sdf'


export const foundationGlsl = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;

  uniform vec4 uSecA[3];
  uniform vec4 uSecB[3];
  uniform vec4 uSecC[3];
  uniform vec4 uSecD[3];
  uniform vec4 uCam;
  uniform vec4 uLook;
  uniform vec4 uWave;

  const float PI = 3.14159265;

  // Humid haze above the surface; the flooded dark below it.
  const vec3 HAZE = vec3(0.070, 0.088, 0.095);
  const vec3 DEEP = vec3(0.030, 0.085, 0.105);

  // Sections extend this far past both ends of their nominal length. Load
  // bearing: at a near-straight join two boxes would otherwise only touch on a
  // plane, the union would read exactly 0 there, and the march would see a
  // sealed doorway. Turns overlap on their own (the next section's half-width
  // sweeps back across the pivot) but the opening must not depend on that.
  const float OVERLAP = 0.35;

  // How far a section's doorway recesses reach past its own ends. Long enough to
  // read as an opening rather than a panel, short enough that two of them back
  // to back cannot bridge a section that is not resident.
  const float DOOR_STUB = 2.2;

  // ...and how big it is. Fixed, not proportional -- see sectionAir.
  const float DOOR_W = 1.05;
  const float DOOR_H = 2.25;

  // Coving radius on every room corner. Exact outside, conservative inside.
  const float COVE = 0.06;

  ${HASH11}
  ${HASH21}

  ${SD_BOX}
  ${SD_ROUND_BOX}

  // The fittings need more than boxes. All exact — nothing here is a cheap
  // approximation with a Lipschitz constant above 1, which is the failure that
  // would force the step factor down for the whole journey.
  ${SD_SPHERE}

  float sdCapsuleX(vec3 p, float h, float r) { p.x -= clamp(p.x, -h, h); return length(p) - r; }
  float sdCapsuleY(vec3 p, float h, float r) { p.y -= clamp(p.y, -h, h); return length(p) - r; }
  float sdCapsuleZ(vec3 p, float h, float r) { p.z -= clamp(p.z, -h, h); return length(p) - r; }

  // Ring in the plane of p.xy, axis along p.z. Swizzle the argument to turn it.
  float sdTorus(vec3 p, float R, float r) {
    return length(vec2(length(p.xy) - R, p.z)) - r;
  }

  // Segment capsule between two arbitrary points. Exact, and the only primitive
  // here that can be aimed: fronds do not grow axis-aligned.
  float sdSeg(vec3 p, vec3 a, vec3 b, float r) {
    vec3  pa = p - a;
    vec3  ba = b - a;
    float h  = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  // Fold onto the nearest lattice cell, unbounded or clamped to a run of 2n+1.
  // Exact for identical axis-aligned instances: on a lattice of congruent shapes
  // the nearest centre really is the nearest instance — which is why nothing
  // repeated in this file jitters its position, however much it would like to.
  float latt(float x, float cell) { return x - (floor(x / cell) + 0.5) * cell; }
  float lattN(float x, float cell, float n) {
    return x - clamp(floor(x / cell + 0.5), -n, n) * cell;
  }

  // --- materials -------------------------------------------------------------
  //
  // Which surface the march last decided on. foundry's gWear pattern: written
  // where the geometry is chosen, read exactly one call later by shadeFace, and
  // eliminated out of the march itself because nothing there reads it. ES 1.00
  // cannot return a struct from a min chain, and re-deriving the material at the
  // hit point would mean writing every fitting out twice.
  const float MAT_TILE  = 0.0;
  const float MAT_FLOAT = 1.0;   // lane rope floats
  const float MAT_METAL = 2.0;   // ladders, conduit, rails, valve wheels
  const float MAT_PAINT = 3.0;   // lockers, benches, pump housings, the flume
  const float MAT_LEAF  = 4.0;   // everything green
  const float MAT_CONC  = 5.0;   // columns, pillars, the dive platform

  float gMat;

  // The min chain, with the material riding along. A plain min cannot say which
  // branch won, and which branch won is the entire question.
#define PUT(E, M) { float dd = (E); if (dd < d) { d = dd; gMat = (M); } }

  // --- decay -----------------------------------------------------------------
  //
  // How far gone the building is, riding the lapF that kinematics ramps across
  // THE DIVING WELL..THE CISTERN -- so each lap's escalation arrives while you
  // are under water and well past a doorway, rather than stepping in the one
  // frame that crosses a seam.
  //
  // The floor is deliberately not zero. It was, and the consequence was that the
  // first circuit -- the only one most people ever see -- was a building in
  // perfect repair, which is not what a natatorium carved out of solid rock and
  // left to flood looks like. A tenth is a scatter of broken tiles and a handful
  // of lit holes. The coarse concrete patches and the missing courses are what
  // has to wait, and they are gated on their own thresholds further down.
  float decay() { return min(0.90, 0.10 + uWave.y * 0.32); }

  // --- the tiles that have let go --------------------------------------------
  //
  // Shading cannot do this one. A painted hole has no depth to be dark inside,
  // no lip for the strip light to rake across, and nowhere for the red to come
  // out of; a painted proud tile does not catch the light on its edge. So the
  // damage is geometry, cut on the same lattice tileSurface draws on, and a hole
  // is exactly and only where a tile is missing.
  //
  // Two halves sharing one face-selection:
  //
  //   hole   a recess cut INTO the shell, unioned into the air with min. Only
  //          the cell the point is in is ever evaluated, never its neighbours,
  //          which makes this an OVER-estimate of the air -- and over-stating
  //          air under-states the concrete, the one direction a sphere trace is
  //          allowed to be wrong in. The zero set is still exact, because a
  //          point inside a recess is inside that recess's own cell by
  //          construction.
  //
  //   proud  a tile standing out of the wall, as a non-negative offset ADDED to
  //          the shell. Adding a positive number moves the surface into the room
  //          and can only ever shorten a step. The one price is paid at the
  //          silhouette of a proud tile, where the neighbouring cell's offset is
  //          not seen and a grazing ray can bite up to PROUD off a corner --
  //          three centimetres, off a three-centimetre feature.
  //
  // Suppressed in the coving, where two faces are equidistant and the choice
  // between them flips: that is the one place where the discontinuity would
  // matter, and a coved corner is a single moulded piece in a real pool anyway.
  const float TILE_W = 0.22;   // wall tile, matching tileSurface
  const float TILE_F = 0.30;   // floor and ceiling tile, ditto
  const float HOLE_D = 0.24;   // how far into the wall a missing tile goes
  const float PROUD  = 0.032;  // how far out of it the survivors are pushed

  // Per-face salt, so the same cell index on the floor and on the wall is not the
  // same tile. tileSurface derives these from the normal and must agree.
  const float SALT_WALL = 0.0;
  const float SALT_FLR  = 3.7;
  const float SALT_CEIL = 8.1;

  void tileBreak(vec3 qs, vec4 B, float dec, out float proud, out float hole) {
    proud = 0.0;
    hole  = 1e5;

    // Not in the doorways. The recesses there are the doorways.
    if (qs.z < 0.35 || qs.z > B.w - 0.35) return;

    float dx = B.y - abs(qs.x);
    float dy = qs.y;
    float dz = B.z - qs.y;

    float m1, m2, salt, ts;
    vec2  uv;
    if (dx <= dy && dx <= dz) { m1 = dx; m2 = min(dy, dz); uv = vec2(qs.z, qs.y); salt = SALT_WALL; ts = TILE_W; }
    else if (dy <= dz)        { m1 = dy; m2 = min(dx, dz); uv = vec2(qs.x, qs.z); salt = SALT_FLR;  ts = TILE_F; }
    else                      { m1 = dz; m2 = min(dx, dy); uv = vec2(qs.x, qs.z); salt = SALT_CEIL; ts = TILE_F; }
    if (m2 - m1 < 0.30) return;

    vec2  g    = floor(uv / ts);
    float id   = hash21(g + salt);

    if (id < 0.004 + dec * 0.16) {
      // The recess pokes two centimetres proud of the nominal face, so a ray
      // arriving at the wall finds its way in rather than stopping on the plane
      // in front of it.
      vec2 f = uv - (g + 0.5) * ts;
      hole = sdBox(vec3(f.x, f.y, m1 + (HOLE_D - 0.02) * 0.5),
                   vec3(ts * 0.42, ts * 0.42, (HOLE_D + 0.02) * 0.5));
    }
    else {
      float pr = hash21(g + salt + 41.3);
      proud = step(pr, 0.02 + dec * 0.18) * PROUD * (0.35 + 0.65 * fract(pr * 53.0));
    }
  }

`
