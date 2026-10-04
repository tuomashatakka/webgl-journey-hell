// THE NATATORIUM — a flooded pool building, carved out of solid rock.
//
// Single pass via lib/gl/shaderQuad.ts, driven by createNatatoriumSimulation in
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
//   uSecD[i] (deploy 0..1 of this section's entry, aisleY, sectionId, -)
//   uCam     (camX, camY, camZ, yaw)     camera in the CURRENT section's frame
//   uLook    (pitch, roll, above, depth)
//   uWave    (waterY-local, lap, dist, curType)

import { HASH11, HASH21 } from '@wjh/glsl/hash'
import { SD_BOX, SD_ROUND_BOX, SD_SPHERE } from '@wjh/glsl/sdf'
import { valueNoise2 } from '@wjh/glsl/noise'
import { foundationGlsl } from './glsl/foundation'
import { routeGlsl } from './glsl/route'
import { fittingsGlsl } from './glsl/fittings'
import { waterSurfacesGlsl } from './glsl/waterSurfaces'


const COMMON = foundationGlsl + routeGlsl + fittingsGlsl + waterSurfacesGlsl

// Camera, march, water split and the inline post chain.
const SCENE = `
  vec3 shadeFace(vec3 p, vec3 n, vec3 rd) {
    vec4 A, B, C, A2, B2, C2; vec3 q; float w;
    resolveSlot(p, A, B, C, A2, B2, C2, q, w);

    // Into the owning room's coordinates: the point, the normal and the view ray
    // together. Carrying only some of them across is worse than carrying none,
    // because then the errors stop being a uniform offset.
    vec3 nq  = dirToLocal(n, A);
    vec3 rdq = dirToLocal(rd, A);

    // ...and then into the SHEARED frame, which is the one the geometry was
    // actually built in. On the two ramped sections that is the difference
    // between tile that follows the floor and tile that slides underneath it;
    // everywhere else the shear is zero and the two frames are identical. The
    // flood is flat in world so it picks up the same shear on the way in, and the
    // normal picks up the inverse transpose, which for a shear is one subtract.
    float zc  = clamp(q.z, 0.0, B.w);
    vec3  qs  = vec3(q.x, q.y + C.x * zc, q.z);
    vec3  ns  = normalize(vec3(nq.x, nq.y, nq.z - C.x * nq.y));
    float wy  = waterYIn(B) + C.x * zc;
    float dec = decay();

    vec3 alb, nn; float rough;
    tileSurface(qs, ns, wy, C.z, alb, nn, rough);

    // Was it the building, or something standing in it? One extra evaluation of
    // the fittings, at the hit point only. The march never reads gMat, so the
    // material costs a pixel rather than ninety-six steps -- and re-deriving it
    // from the geometry instead would mean writing every fitting out twice.
    float pd = sectionProps(qs, B, C, uSecD[1]);
    if (pd < 0.035 && gMat > 0.5) {
      propSurface(qs, gMat, dec, alb, rough);
      nn = ns;
      crackGlow = 0.0;
    }

    vec3 c = stripLight(qs, nn, alb, rough, rdq, B, C);

    // In the throat of a doorway, light the surface as both rooms and mix. The
    // tile frame is NOT mixed -- coordinates from two rigid frames average into a
    // point in neither, and the grid would ghost -- but light is just a number,
    // and crossing it over is what stops the threshold reading as a line ruled
    // across the floor.
    if (w > 0.004) {
      vec3  q2  = toLocal(p, A2, B2.x);
      float zc2 = clamp(q2.z, 0.0, B2.w);
      vec3  qs2 = vec3(q2.x, q2.y + C2.x * zc2, q2.z);
      c = mix(c, stripLight(qs2, dirToLocal(n, A2), alb, rough, dirToLocal(rd, A2), B2, C2), w);
    }

    c += alb * 0.06;

    // Caustics stay in WORLD on purpose. The water is one flat plane through the
    // entire building and depth below it is the only quantity that has to be
    // right; projecting the pattern in each room's own frame would make it swim
    // sideways every time you crossed a join.
    if (p.y < waterY()) c += alb * causticAt(p) * 0.9;
    if (ns.y < -0.6) c += vec3(0.95, 0.99, 1.0) * ceilPanel(qs, B, C) * 3.2;

    // INSIDE A BREAK IN THE SHELL: past the nominal face plane, in the recess a
    // missing tile left behind. Whatever is behind this building is lit, and it
    // is not lit white. This is what the red rays come out of -- the surface half
    // of it; crackShafts does the air.
    // Depth first. What you see through a missing tile is a dark hole; the red
    // is what is at the BACK of it, so it falls off with how far in the surface
    // you are looking at actually is. Emitting a flat value over the whole recess
    // was the difference between a lit break and a red sticker.
    // A hole is DARK first. Almost all of what you can see of one is its own
    // unlit side walls, and only the very back of it is the source -- so the two
    // ramps are deliberately disjoint, the shadow reaching full a centimetre in
    // and the emission not starting until the far end. Overlapping them lit the
    // whole recess evenly, and a recess lit evenly across its whole depth is not
    // a hole, it is a red tile: flat, frontal and exactly tile-shaped, which is
    // precisely what it looked like.
    float face  = min(min(B.y - abs(qs.x), qs.y), B.z - qs.y);
    c *= 1.0 - 0.94 * smoothstep(-0.005, -0.055, face);
    c += vec3(1.00, 0.09, 0.02) * smoothstep(-0.155, -0.225, face) * (0.35 + 2.6 * dec);

    // ...and what it falls on. Suppressed inside the recess itself, where the
    // neighbours are on the other side of a wall and the surface is already the
    // source rather than something the source is lighting.
    if (face > -0.02 && dec > 0.12) {
      vec2  suv; float ssz, ssl;
      if (abs(ns.y) > 0.7)      { suv = qs.xz; ssz = TILE_F; ssl = ns.y > 0.0 ? SALT_FLR : SALT_CEIL; }
      else if (abs(ns.x) > 0.7) { suv = qs.zy; ssz = TILE_W; ssl = SALT_WALL; }
      else                      { suv = qs.xy; ssz = TILE_W; ssl = 5.5; }
      c += vec3(1.00, 0.13, 0.04) * holeSpill(suv, ssz, ssl, dec)
         * smoothstep(0.12, 0.55, dec) * 0.22 * (1.0 - lodFade(ssz * 0.5));
    }

    // ...and the same oxblood out of the hairlines, once they are deep enough to
    // have reached anything. Same tint foundry rots its grade toward, and the
    // only warm thing in a building lit entirely by dying fluorescents.
    c += vec3(1.00, 0.17, 0.06) * crackGlow * 3.0;
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
        vec3  q  = p + r * rt;
        // The reflected ray has travelled to the water and then on again, and the
        // tile it lands on is that far away however near the surface is.
        float keep = gDist;
        gDist = keep + rt;
        vec3 sc = shadeFace(q, calcNormal(q, rt), r);
        gDist = keep;
        return mix(HAZE, sc, exp(-rt * 0.035));
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

  // Red light bleeding out of the breaks, accumulated along the primary ray.
  // Deliberately the same six-tap shape as lightShafts above, so this is one
  // more instance of a pattern the file already has rather than a new mechanism.
  //
  // Each tap is weighted by how close it is to a surface. That proximity term is
  // what makes the glow hug the cracked walls and pool in the corners, instead
  // of hanging in the middle of the room like coloured fog.
  vec3 crackShafts(vec3 ro, vec3 rd, float tMax) {
    float dec = decay();
    if (dec < 0.12) return vec3(0.0);

    // Six taps along the primary ray, hugging whatever surface is nearest.
    //
    // This deliberately does NOT ask the tile lattice where the holes are, and
    // that is the whole design note. It did, and the result was not shafts: the
    // last tap of every ray landed in the same tile cell as its neighbours, the
    // per-cell answer is constant across a tile face, and what appeared on screen
    // was a flat tile-shaped red rectangle -- a quantised field projected through
    // a pinhole draws the quantisation, not the light. A volumetric term has to
    // be continuous in space or it will draw its own lattice.
    //
    // So: a smooth field, gated on proximity to concrete, which is where the
    // holes are and where the glow belongs. The surface half of the effect knows
    // about individual holes; the air half only has to know it is near a wall.
    float acc = 0.0;
    for (int k = 0; k < 6; k++) {
      vec3  sp   = ro + rd * (tMax * (float(k) + 0.35) / 6.0);
      float prox = exp(-max(mapScene(sp), 0.0) * 1.9);
      float v    = sin(sp.x * 2.3 + cos(sp.z * 1.7) * 1.4)
                 * cos(sp.z * 2.1 + sin(sp.y * 1.9) * 1.2);
      acc += smoothstep(0.25, 0.95, abs(v)) * prox;
    }
    return vec3(1.00, 0.15, 0.05) * acc * (1.0 / 6.0) * (0.10 + 0.55 * dec);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float yaw   = uCam.w - uPointer.x * 0.45; // right = cross(fwd, Y): negative yaw turns toward the pointer
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
    gDist = 0.0;
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
      gDist = t;
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
        under = mix(deepCol, under, exp(-max(t - tW, 0.0) * 0.40));
        under += vec3(0.35, 0.62, 0.68) * causticAt(wp) * 0.25;
        under += shoal(rd, max(t - tW, 0.0), 0.55);

        vec3 rr   = reflect(rd, wn);
        vec3 refl = reflectShade(wp, rr);

        // Schlick: near-mirror at the far end of the pool, glassy underfoot.
        float cosT = clamp(dot(wn, -rd), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        // Scum dulls the reflection where it sits, which is what makes the rest
        // of the surface read as water. It must stay LIGHTER than the water it
        // floats on -- a dark film reads as a hole in the pool, not as a skin on
        // it, and that is exactly how it read at first: a black amoeba lying flat
        // across THE SHALLOW END with a hard edge.
        float film = surfaceFilm(wp.xz, decay());
        fres *= 1.0 - film * 0.55;

        col = mix(under, refl, fres);
        col = mix(col, vec3(0.19, 0.22, 0.17) * (0.55 + causticAt(wp) * 0.55), film * 0.45);
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
      col += shoal(rd, tEnd, 1.0);

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

    col += lampGlow(ro, rd, tEnd) * (camWet ? 0.55 : 1.0);

    // Above and below the surface both: the red is the one thing in here that
    // does not care whether your head is under.
    col += crackShafts(ro, rd, tEnd);

    // --- inline post (no FBO in a single-pass journey) ---

    // stairwell's flicker trick: the cheapest convincing fluorescent buzz.
    float age = clamp(uWave.y * 0.12, 0.0, 0.45);
    col *= 1.0 - age * 0.5 * step(0.96, hash21(vec2(floor(iTime * 14.0), 7.0)));

    col *= 1.0 - smoothstep(0.42, 1.15, length(uv)) * (0.45 + 0.2 * (1.0 - above));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.6, lum) * 0.4;

    // Reinhard shoulder rather than clamp(col, 0.0, 1.8). The clamp was the real
    // reason bright tile turned into featureless white paper: every value past
    // 1.8 became exactly 1.0, so grout lines, mosaic courses and cracks all
    // flattened into the same flat area the moment a wall came near a lamp. This
    // compresses instead, so the highlights stay highlights and keep their
    // detail. White point at 2.6: anything beyond that is a lamp, and lamps are
    // allowed to be white.
    col = max(col, 0.0);
    col = col * (1.0 + col / (2.6 * 2.6)) / (1.0 + col);
    col = pow(col, vec3(0.92));
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

  ${HASH21}

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
