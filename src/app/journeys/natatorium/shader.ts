// THE NATATORIUM — a flooded pool building, carved out of solid rock.
//
// Single pass via lib/shaderQuad.ts, driven by createNatatoriumSimulation in
// route.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch, no
// dynamic array indexing, no bitwise ops.
//
// The shader holds NO route table. Every frame the CPU uploads the affine
// transform carrying a point from the camera's current section into each of the
// three resident sections (prev, current, next). This loops over them, applies
// each transform, evaluates one generic sectionAir(), unions with `min`, and
// negates to get the concrete. Turn #500 costs exactly what turn #1 did.
//
// SDF discipline, because this is where this design would die:
//   `min` (union) and `max` (clip) are provably conservative — inside a union,
//   min under-estimates the distance to the boundary, which is the safe
//   direction for a sphere trace. `smin` is NOT: it returns up to k/4 below its
//   inputs, so negating a smoothed union OVER-estimates and a grazing ray at a
//   door jamb punches through the wall. Corners get rounded via sdRoundBox
//   (exact outside, conservative inside) instead — which is also what real
//   tiled pool halls have, since coved corners are what you can mop.
//   Tiles, grout, mildew, caustics: shading only, never the SDF.
//
// Uniforms (see route.ts `uniforms()`), three slots each:
//   uSecA[i] (cos, sin, tx, tz)          inverse xz transform into slot i
//   uSecB[i] (ty, halfW, ceilH, len)
//   uSecC[i] (slope, type, grime, lampPitch)
//   uCam     (camX, camY, camZ, yaw)     camera in the CURRENT section's frame
//   uLook    (pitch, roll, above, depth)
//   uWave    (waterY-local, lap, dist, curType)

const COMMON = `
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  uPointer;
  uniform float uHeavy;

  uniform vec4 uSecA[3];
  uniform vec4 uSecB[3];
  uniform vec4 uSecC[3];
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

  // Coving radius on every room corner. Exact outside, conservative inside.
  const float COVE = 0.06;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  float sdRoundBox(vec3 p, vec3 b, float r) {
    return sdBox(p, b - r) - r;
  }

  // --- the route ------------------------------------------------------------

  // Carry a point from the current section's frame into slot i's frame. The CPU
  // already inverted the rigid transform, so there is no trig here at all.
  vec3 toLocal(vec3 p, vec4 A, float ty) {
    vec2 d = p.xz - vec2(A.z, A.w);
    return vec3(A.x * d.x - A.y * d.y, p.y - ty, A.y * d.x + A.x * d.y);
  }

  // The same rotation for a DIRECTION: no translation, and y is untouched
  // because every section frame shares one up axis. Normals and view rays both
  // need this before they meet anything expressed in a section's own frame —
  // mixing a world-frame ray with a local-frame normal silently produces a
  // specular highlight in the wrong place, which is the kind of bug that reads
  // as "the lighting is a bit off" for a week.
  vec3 dirToLocal(vec3 v, vec4 A) {
    return vec3(A.x * v.x - A.y * v.z, v.y, A.y * v.x + A.x * v.z);
  }

  // The air volume of one section: a box whose floor ramps at C.x.
  //
  // Shearing y to flatten the ramp scales the metric by sqrt(1 + s*s), so the
  // result is divided back down — without that the SDF over-estimates by up to
  // 4% on THE RISER's grade, and over-estimating is the direction that punches
  // through walls. (stairwell skips this correction and gets away with it only
  // because its surface epsilon is generous.)
  float sectionAir(vec3 q, vec4 B, vec4 C) {
    float s   = C.x;
    float inv = inversesqrt(1.0 + s * s);

    // Clamp the shear to the section's own span so the floor levels off at the
    // doorways instead of shearing away to infinity out in the solid.
    float zc = clamp(q.z, 0.0, B.w);
    vec3  qs = vec3(q.x, q.y + s * zc, q.z);

    float h = B.z * 0.5;
    return sdRoundBox(qs - vec3(0.0, h, B.w * 0.5),
                      vec3(B.y, h, B.w * 0.5 + OVERLAP), COVE) * inv;
  }

  // Union of the resident air volumes. Negative inside the walkable space.
  float mapAir(vec3 p) {
    float air = 1e5;              // large POSITIVE — starting at 0 is the classic bug
    for (int i = 0; i < 3; i++)
      air = min(air, sectionAir(toLocal(p, uSecA[i], uSecB[i].x), uSecB[i], uSecC[i]));
    return air;
  }

  // The concrete. Positive in the air, which is where the march lives.
  float mapScene(vec3 p) {
    return -mapAir(p);
  }

  // Which resident section owns this point, and the point in THAT section's own
  // frame. Deliberately not folded into mapAir: the march calls that ~96 times
  // per pixel and needs only the minimum, while shading needs the winner twice
  // (the primary hit, and the hit behind the water reflection).
  //
  // Everything downstream used to read uSecB[1] / uSecC[1] — the section the
  // CAMERA is in — and evaluate it against p in the camera's frame. So the room
  // on the far side of a doorway was lit with this room's width, ceiling height
  // and lamp pitch, with its lamp rows running along the wrong axis; and the
  // instant the slot window rotated, that whole far room snapped. The README
  // states the rule for the camera ("every per-section quantity goes through the
  // corner blend, not just position"); this is that rule applied to shading.
  void resolveSlot(vec3 p, out vec4 A, out vec4 B, out vec4 C,
                   out vec3 q, out float margin) {
    float best   = 1e5;
    float second = 1e5;

    // Seeded from the current slot only so the compiler sees them assigned; the
    // loop below always overwrites, since every distance beats 1e5.
    A = uSecA[1]; B = uSecB[1]; C = uSecC[1]; q = p;

    for (int i = 0; i < 3; i++) {
      vec3  qi = toLocal(p, uSecA[i], uSecB[i].x);
      float d  = sectionAir(qi, uSecB[i], uSecC[i]);
      if (d < best) {
        second = best;
        best   = d;
        A = uSecA[i]; B = uSecB[i]; C = uSecC[i]; q = qi;
      }
      else if (d < second) second = d;
    }

    // How much the winner won by. Near zero means this point sits in the overlap
    // where two rooms interpenetrate — i.e. in a door jamb.
    margin = second - best;
  }

  // 4-tap tetrahedron rather than 6-tap central differences: mapScene evaluates
  // three transformed boxes, so a third fewer taps is a real saving per pixel.
  vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(1.0, -1.0) * (0.0015 + 0.0016 * t);
    return normalize(
      e.xyy * mapScene(p + e.xyy) +
      e.yyx * mapScene(p + e.yyx) +
      e.yxy * mapScene(p + e.yxy) +
      e.xxx * mapScene(p + e.xxx));
  }

  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 4; i++) {
      float h = 0.04 + 0.22 * float(i);
      occ += (h - mapScene(p + n * h)) * sca;
      sca *= 0.72;
    }
    return clamp(1.0 - 1.1 * occ, 0.0, 1.0);
  }

  // --- water ----------------------------------------------------------------

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

  vec3 waterNormal(vec2 xz, float t) {
    float e = 0.06;
    float h  = waveH(xz, t);
    float hx = waveH(xz + vec2(e, 0.0), t);
    float hz = waveH(xz + vec2(0.0, e), t);
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

  // Tile. The normal perturbation is what makes tile look like tile rather than
  // like wallpaper, and it is nearly free: the derivative of fract() is +-1.
  void tileSurface(vec3 p, vec3 n, float wy, float grime,
                   out vec3 alb, out vec3 nOut, out float rough) {
    vec2 uv; vec3 tu, tv;
    if (abs(n.y) > 0.7)      { uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
    else if (abs(n.x) > 0.7) { uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
    else                     { uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }

    // Real pools run a contrasting mosaic course at the water line.
    float band = smoothstep(0.20, 0.14, abs(p.y - wy));
    float size = mix(abs(n.y) > 0.7 ? 0.30 : 0.22, 0.11, band);

    vec2  g = uv / size;
    vec2  f = fract(g) - 0.5;
    float d = (0.5 - max(abs(f.x), abs(f.y))) * size;
    float groove = 1.0 - smoothstep(0.0, 0.014, d);

    nOut = normalize(n - (tu * sign(f.x) + tv * sign(f.y)) * groove * 0.5);

    float id = hash21(floor(g));
    alb = vec3(0.86, 0.89, 0.87) * (0.93 + 0.13 * id);
    alb = mix(alb, vec3(0.30, 0.36, 0.34), band * 0.55);          // the mosaic course
    alb = mix(alb, vec3(0.44, 0.46, 0.44), step(0.995, id));      // a missing tile

    float mildew = groove * (0.35 + 0.65 * band) * grime;
    alb = mix(alb, vec3(0.30, 0.36, 0.28), mildew * 0.75);
    alb *= mix(1.0, 0.6, groove);                                  // grout is darker

    // Splash zone: wet tile above the line is darker and much glossier.
    float wet = exp(-max(p.y - wy, 0.0) * 2.5);
    alb  *= mix(1.0, 0.72, wet);
    rough = mix(0.32, 0.06, wet);

    // Scum line: a dirty ring exactly at the water level.
    alb *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.y - wy)) * grime;
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
    return inZ * inX * lampAlive(band, C);
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

  // Lamp halos, added whether or not the ray hit anything. This is what replaces
  // a bloom post pass — there is no FBO in a single-pass journey.
  // Unlike the others this one is swept along the RAY from the camera, and the
  // camera is by definition in the current section — so it keeps slot 1, and
  // takes it as a parameter only to keep every lamp routine reading the same way.
  vec3 lampGlow(vec3 ro, vec3 rd, float tMax, vec4 B, vec4 C) {
    vec3  acc = vec3(0.0);
    float sp  = max(C.w, 2.0);
    float H   = B.z;
    float band = floor(ro.z / sp);

    for (int k = 0; k < 3; k++) {
      float bi = band - 1.0 + float(k);
      float on = lampAlive(bi, C);
      if (on < 0.01) continue;
      vec3  lp = vec3(0.0, H - 0.12, (bi + 0.5) * sp);
      vec3  v  = lp - ro;
      float proj = clamp(dot(v, rd), 0.0, tMax);
      float dist = length(v - rd * proj);
      acc += vec3(0.85, 0.92, 1.0) * on * 0.05 / (1.0 + dist * dist * 2.2);
    }
    return acc;
  }
`

// Camera, march, water split and the inline post chain.
const SCENE = `
  vec3 shadeFace(vec3 p, vec3 n, vec3 rd) {
    vec4 A, B, C; vec3 q; float margin;
    resolveSlot(p, A, B, C, q, margin);

    // Into the owning room's coordinates: the point, the normal and the view
    // ray together. Carrying only some of them across is worse than carrying
    // none, because the errors stop being a uniform offset.
    vec3  nq  = dirToLocal(n, A);
    vec3  rdq = dirToLocal(rd, A);
    float wy  = waterYIn(B);

    vec3 alb, nn; float rough;
    tileSurface(q, nq, wy, C.z, alb, nn, rough);

    vec3 c = stripLight(q, nn, alb, rough, rdq, B, C);
    c += alb * 0.06;

    // Caustics stay in the CURRENT frame on purpose. The water is one flat
    // plane through the entire building and depth below it is the only quantity
    // that has to be right; projecting the pattern in each room's own frame
    // would make it swim sideways every time you crossed a join.
    if (p.y < waterY()) c += alb * causticAt(p) * 0.9;
    if (n.y < -0.6) c += vec3(0.95, 0.99, 1.0) * ceilPanel(q, B, C) * 3.2;
    return c;
  }

  // First bounce off the water. A short secondary march rather than an analytic
  // box exit: the camera is often near a boundary between wildly different
  // sections (a 1.6m corridor mouth opening into an 18m hall), and a single
  // box is simply the wrong shape there. 20 steps against exact box SDFs covers
  // plenty of distance, and the reflection is the whole look of a pool.
  vec3 reflectShade(vec3 p, vec3 r) {
    float rt = 0.06;
    for (int i = 0; i < 20; i++) {
      float d = mapScene(p + r * rt);
      if (d < 0.004 * (1.0 + rt * 0.02)) {
        vec3 q = p + r * rt;
        return mix(HAZE, shadeFace(q, calcNormal(q, rt), r), exp(-rt * 0.035));
      }
      rt += d * 0.95;
      if (rt > 45.0) break;
    }
    return HAZE;
  }

  // Six taps along the primary ray, each projected up to the surface along the
  // light and evaluated with the SAME caustic function, weighted by forward
  // scattering. Marching real shafts is not affordable; this is.
  vec3 lightShafts(vec3 ro, vec3 rd, float t) {
    if (uHeavy < 0.5) return vec3(0.0);
    float phase = pow(max(dot(rd, LDIR), 0.0), 8.0);
    if (phase < 0.002) return vec3(0.0);
    float acc = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3 sp = ro + rd * (t * (float(k) + 0.5) / 6.0);
      float dep = waterY() - sp.y;
      vec2 cp = (sp + LDIR * (dep / LDIR.y)).xz;
      acc += caustic(cp, iTime * 0.6) * exp(-max(dep, 0.0) * 0.22);
    }
    return vec3(0.55, 0.85, 0.92) * acc * (1.0 / 6.0) * phase * 0.9;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float yaw   = uCam.w + uPointer.x * 0.45;
    float pitch = uLook.x + uPointer.y * 0.28;
    float roll  = uLook.y;

    // The camera lives in the current section's own frame, which is why nothing
    // here ever grows: local z runs 0..len and resets at every section.
    vec3 ro = vec3(uCam.x, uCam.y, uCam.z);

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);

    float cr = cos(roll), sr = sin(roll);
    vec3  r2 = rgt * cr - up * sr;
    up  = rgt * sr + up * cr;
    rgt = r2;

    vec3 rd = normalize(uv.x * rgt + uv.y * up + 1.05 * fwd);

    // Exact box SDFs, so the step factor can sit near 1.0 — the fbm-displaced
    // journeys in this repo have to undershoot to 0.55-0.72, this one does not.
    // The cone-widening epsilon terminates grazing rays earlier and can only
    // ever end the march sooner, never overshoot it.
    float t   = 0.05;
    bool  hit = false;
    for (int i = 0; i < 96; i++) {
      vec3  p = ro + rd * t;
      float d = mapScene(p);
      if (d < 0.0025 * (1.0 + t * 0.012)) { hit = true; break; }
      t += d * 0.95;
      if (t > 70.0) break;
    }

    float above  = uLook.z;                 // 1 = head above water, 0 = under
    bool  camWet = above < 0.5;

    // Humid haze above, and the real thing below: wavelength-dependent
    // absorption. Red dies first, which is most of why underwater reads as
    // underwater at all.
    vec3 hazeCol = vec3(0.070, 0.088, 0.095);
    vec3 deepCol = vec3(0.030, 0.085, 0.105);
    vec3 murk    = vec3(0.34, 0.15, 0.11);

    vec3  col = hazeCol;
    float tEnd = min(t, 70.0);

    if (hit) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p, t);
      col = shadeFace(p, n, rd) * calcAO(p, n);
    }

    float tW = waterHit(ro, rd);
    bool  crosses = tW > 0.0 && (!hit || tW < t);

    if (!camWet) {
      // --- above the surface ---
      col = mix(hazeCol, col, exp(-tEnd * 0.030));

      if (crosses) {
        vec3 wp = ro + rd * tW;
        vec3 wn = waterNormal(wp.xz, iTime);

        // Everything beyond the surface is seen through the water.
        vec3 under = hit ? col : deepCol;
        under = mix(deepCol, under, exp(-max(t - tW, 0.0) * 0.55));
        under += vec3(0.35, 0.62, 0.68) * causticAt(wp) * 0.25;

        vec3 rr   = reflect(rd, wn);
        vec3 refl = reflectShade(wp, rr);

        // Schlick: near-mirror at the far end of the pool, glassy underfoot.
        float cosT = clamp(dot(wn, -rd), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        col = mix(under, refl, fres);
        col = mix(hazeCol, col, exp(-tW * 0.030));
      }
    }
    else {
      // --- submerged ---
      col = mix(deepCol, col, exp(-tEnd * 0.115));
      col *= exp(-tEnd * murk * 0.26);
      col += deepCol * 0.35;                       // in-scattered ambient, not just darkness
      col += lightShafts(ro, rd, tEnd);
      col += motes(rd, tEnd);

      if (crosses) {
        // Snell's window: looking up, everything outside the 48.6 degree cone is
        // a perfect mirror of the floor, and inside it the whole world above is
        // squeezed into a bright ellipse. Six instructions, and it is the shot.
        float sinT = length(rd.xz);
        float tir  = smoothstep(0.735, 0.762, sinT);
        vec3  wp   = ro + rd * tW;
        vec3  wn   = waterNormal(wp.xz, iTime);

        vec3  win  = vec3(0.72, 0.86, 0.90) * (1.0 + causticAt(wp) * 0.8);
        vec3  mirr = col * 0.55 + deepCol * 0.5;
        vec3  surf = mix(win, mirr, tir);

        col = mix(surf, col, 1.0 - exp(-tW * 0.30));
      }
    }

    col += lampGlow(ro, rd, tEnd, uSecB[1], uSecC[1]) * (camWet ? 0.55 : 1.0);

    // --- inline post (no FBO in a single-pass journey) ---

    // stairwell's flicker trick: the cheapest convincing fluorescent buzz.
    float age = clamp(uWave.y * 0.12, 0.0, 0.45);
    col *= 1.0 - age * 0.5 * step(0.96, hash21(vec2(floor(iTime * 14.0), 7.0)));

    col *= 1.0 - smoothstep(0.42, 1.15, length(uv)) * (0.45 + 0.2 * (1.0 - above));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.6, lum) * 0.4;
    col  = pow(clamp(col, 0.0, 1.8), vec3(0.92));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.028;

    gl_FragColor = vec4(col, 1.0);
  }
`

export const natatoriumFrag = COMMON + SCENE

// Hover preview. Self-driving from iTime alone: ShaderPreviewLayer attaches no
// simulation, so uSec/uCam would all read zero and the real shader would render
// a black frame. No raymarch either — every card in the grid shares one GL
// context. The job is to read as a swimming pool at 300px, which is what the
// rippled fluorescent strips smearing down across the waterline do.
export const natatoriumPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Ridged sum-of-sines sharpened into filaments. The pow() is the whole trick:
  // without it this is noise, with it it is caustics.
  float caustic(vec2 p, float t) {
    float k = 0.0;
    vec2  q = p;
    for (int i = 0; i < 3; i++) {
      vec2  w = q * (1.0 + float(i) * 0.9);
      float a = sin(w.x + t * (1.0 + float(i) * 0.31)) + sin(w.y * 1.13 - t * 0.87);
      float b = sin((w.x + w.y) * 0.71 + t * 1.21);
      k += 1.0 - abs(a * 0.5 + b * 0.35);
      q  = mat2(0.80, 0.60, -0.60, 0.80) * q;
    }
    return pow(max(k / 3.0, 0.0), 6.0);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;

    float horizon = 0.06 + 0.05 * sin(iTime * 0.25);

    // Ground-plane trick: perspective floor out of a divide, scrolling toward us.
    float fy = max(horizon - uv.y, 1e-3);
    vec2  fp = vec2(uv.x / fy, 1.0 / fy + iTime * 0.35);

    vec2  g     = fract(fp * 3.0) - 0.5;
    float grout = 1.0 - smoothstep(0.0, 0.06, 0.5 - max(abs(g.x), abs(g.y)));
    float c     = caustic(fp * 1.6, iTime);

    vec3 below = mix(vec3(0.16, 0.34, 0.38), vec3(0.52, 0.74, 0.76), 1.0 - grout * 0.55);
    below += vec3(0.60, 0.90, 0.95) * c * 0.85;
    // Depth fade over the range the floor actually spans: 1/fy is already ~2.4
    // at the bottom edge of the card, so a fade ending at 2.5 blacks out the
    // entire floor and the tiles never read.
    below = mix(below, vec3(0.05, 0.13, 0.19), smoothstep(2.5, 15.0, 1.0 / fy));

    // Above the line: pale tile and the fluorescent strips.
    float strip = 0.0;
    for (int i = 0; i < 4; i++) {
      float sy = horizon + 0.09 + float(i) * 0.10;
      strip += 0.018 / (abs(uv.y - sy) + 0.020);
    }
    vec3 above = vec3(0.74, 0.78, 0.77) + vec3(1.0, 0.97, 0.88) * strip * 0.32;

    // The strips smear down across the water, rippled. This is the tell.
    float ripple = sin(uv.x * 18.0 + iTime * 1.7) * 0.012;
    below += vec3(1.0, 0.97, 0.88) * (0.030 / (abs(uv.y - horizon + ripple) + 0.06)) * 0.9;

    vec3 col = mix(below, above, smoothstep(-0.004, 0.004, uv.y - horizon + ripple * 0.5));
    col *= 1.0 - 0.5 * length(uv * vec2(0.8, 1.0));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 51.7) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`
