import { ACES } from '@wjh/glsl/color'
import { HASH21 } from '@wjh/glsl/hash'
import { valueNoise2 } from '@wjh/glsl/noise'


// The index-card preview: one flooded bay of THE LANE POOL, drifting down the
// hall. Self-driving from iTime alone, because the CRT attaches no simulation.
//
// Every channel of the index shares one GL context, so nothing here marches.
// The hall is a box with pilasters down both walls and beams across the
// ceiling, and every ray is solved against it in closed form: a plane divide per
// face, and the pilasters and beams by the two-plane trick in hallHit. A pixel
// above the water costs one hall solve; a pixel on the water costs three (the
// reflection, the refraction, and the rope test), which is the whole budget.
export const previewGlsl = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH21}
  ${valueNoise2('hash21')}
  ${ACES}

  const float HW   = 5.6;    // half width, wall to wall
  const float HC   = 6.4;    // ceiling, above the water
  const float DEP  = 1.75;   // floor, below it
  const float BAY  = 6.0;    // pilaster pitch
  const float PW   = 0.42;   // pilaster half width
  const float PD   = 0.30;   // ...and how far it stands out of the wall
  const float BMW  = 0.28;   // ceiling beam half width
  const float BMD  = 0.45;   // ...and depth
  const float LX   = 1.9;    // the two fluorescent runs
  const float ROPE = 1.6;    // the two lane ropes

  // Which face the last hallHit landed on: 0 wall, 1 pilaster, 2 ceiling,
  // 3 beam, 4 pool floor, 5 the end wall.
  float gKind;

  // The end of the hall, kept a fixed distance ahead. At thirty-odd metres in
  // the steam its lack of parallax does not show, and a hall that ends in a
  // doorway reads as a room where one that runs to a vanishing point does not.
  float gEnd;

  float latt(float x, float c) { return x - (floor(x / c) + 0.5) * c; }
  float pil(float z)           { return z - floor(z / BAY + 0.5) * BAY; }

  // Ridged sum-of-sines sharpened into filaments.
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
    return pow(clamp(k / 3.0, 0.0, 1.0), 6.0);
  }

  // The hall, in closed form. A pilaster is a box standing PD proud of the
  // wall: hit the plane of its face, and if that lands inside a pilaster it is
  // the face; if not, hit the wall, and if THAT lands inside one, the ray must
  // have crossed into it through its side on the way. Beams the same, on y.
  float hallHit(vec3 ro, vec3 rd, out vec3 n) {
    float s  = rd.x > 0.0 ? 1.0 : -1.0;
    float tw = (s * HW - ro.x) / rd.x;
    float tp = (s * (HW - PD) - ro.x) / rd.x;
    float zp = ro.z + rd.z * tp;
    float zw = ro.z + rd.z * tw;
    float t  = tw;
    n     = vec3(-s, 0.0, 0.0);
    gKind = 0.0;
    if (abs(pil(zp)) < PW) {
      t = tp; gKind = 1.0;
    }
    else if (abs(pil(zw)) < PW) {
      float zc = zw - pil(zw);
      float sz = rd.z > 0.0 ? 1.0 : -1.0;
      t = (zc - sz * PW - ro.z) / rd.z;
      n = vec3(0.0, 0.0, -sz); gKind = 1.0;
    }

    if (rd.z > 0.0) {
      float te = (gEnd - ro.z) / rd.z;
      if (te < t) { t = te; n = vec3(0.0, 0.0, -1.0); gKind = 5.0; }
    }

    if (rd.y > 0.0) {
      float tb = (HC - BMD - ro.y) / rd.y;
      float tc = (HC - ro.y) / rd.y;
      float zb = ro.z + rd.z * tb;
      float zc = ro.z + rd.z * tc;
      if (tb < t && abs(pil(zb)) < BMW) {
        t = tb; n = vec3(0.0, -1.0, 0.0); gKind = 3.0;
      }
      else if (tc < t) {
        if (abs(pil(zc)) < BMW) {
          float zm = zc - pil(zc);
          float sz = rd.z > 0.0 ? 1.0 : -1.0;
          t = (zm - sz * BMW - ro.z) / rd.z;
          n = vec3(0.0, 0.0, -sz); gKind = 3.0;
        }
        else {
          t = tc; n = vec3(0.0, -1.0, 0.0); gKind = 2.0;
        }
      }
    }
    else {
      float tf = (-DEP - ro.y) / rd.y;
      if (tf < t) { t = tf; n = vec3(0.0, 1.0, 0.0); gKind = 4.0; }
    }
    return t;
  }

  // Square tile: grout coverage, with the cell handed back for the per-tile
  // hash. The grout widens with the footprint and fades to its mean before it
  // can alias -- there is no mip chain here either.
  float tile(vec2 uv, float size, float fp, out vec2 cell) {
    vec2  g = uv / size;
    cell    = floor(g);
    vec2  f = fract(g) - 0.5;
    float d = (0.5 - max(abs(f.x), abs(f.y))) * size;
    float w = max(size * 0.05, fp);
    return (1.0 - smoothstep(0.0, w, d)) * (1.0 - smoothstep(size * 0.25, size * 0.9, fp) * 0.7);
  }

  // The fluorescent fittings: 1.5m tubes every 3m along both runs, salted so a
  // few are dead and one in a while is failing.
  float tubeOn(float z, float side) {
    float id = floor(z / 3.0);
    float h  = hash21(vec2(id, side));
    float on = step(0.16, h);
    on *= h > 0.92 ? step(0.4, hash21(vec2(floor(iTime * 11.0), id))) : 1.0;
    return on * (1.0 - smoothstep(0.68, 0.78, abs(latt(z, 3.0))));
  }

  // Light at p from the two runs, treated as lines along z (diffuse), plus the
  // streak they leave in anything glossy. Line lights are what put the long
  // highlight down a wet tiled wall that a point light cannot.
  vec3 hallLight(vec3 p, vec3 n, vec3 rd, float gloss) {
    vec3  acc = vec3(0.0);
    vec3  r   = reflect(rd, n);
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -LX : LX;
      vec2  v  = vec2(sx, HC - 0.12) - p.xy;
      float d2 = dot(v, v);
      vec2  l  = v * inversesqrt(d2);
      float on = 0.25 + 0.75 * tubeOn(p.z, float(i));
      float nd = max(dot(n.xy, l), 0.0);
      acc += vec3(1.0, 0.97, 0.90) * nd * on * 9.0 / (1.0 + d2 * 0.55);
      float rl = max(dot(normalize(r.xy + vec2(1e-4)), l), 0.0);
      acc += vec3(1.0, 0.98, 0.94) * pow(rl, 90.0) * gloss * on * 2.2 / (1.0 + d2 * 0.08);
    }
    return acc;
  }

  // Arched clerestory window in the bay, as a signed distance in the wall's
  // (z, y). Sill 3.0, springing 4.7, a full semicircle over a 1.4 half width.
  float windowD(float zb, float y) {
    float wy = y - 4.7;
    return wy > 0.0 ? length(vec2(zb, wy)) - 1.4 : max(abs(zb) - 1.4, 3.0 - y);
  }

  // Everything above the floor of the pool: walls, pilasters, ceiling, beams.
  // fp is the pixel footprint in metres at this distance.
  vec3 shadeHall(vec3 p, vec3 n, vec3 rd, float fp) {
    vec2  cell;
    vec3  alb;
    float gloss = 0.0;
    vec3  emit  = vec3(0.0);
    float ao    = 1.0;

    if (gKind < 1.5 || gKind > 4.5) {
      // Wall and pilaster faces. Side faces run their tiles along x.
      float u = abs(n.x) > 0.5 ? p.z : p.x;
      float y = p.y;
      float g;
      if (y < 0.20 && y > -0.30) {
        // The mosaic course at the waterline: small tiles, three blues.
        g = tile(vec2(u, y), 0.055, fp, cell);
        float h = hash21(cell);
        alb = h < 0.33 ? vec3(0.05, 0.16, 0.36) : (h < 0.66 ? vec3(0.08, 0.27, 0.46) : vec3(0.16, 0.42, 0.55));
        gloss = 0.8;
      }
      else if (y < 2.30) {
        g = tile(vec2(u, y), 0.20, fp, cell);
        float h = hash21(cell + 3.1);
        alb = vec3(0.80, 0.82, 0.79) * (0.90 + 0.14 * h);
        alb = mix(alb, vec3(0.62, 0.64, 0.58), step(0.94, h));   // a replacement that never matched
        gloss = 0.9;
      }
      else if (y < 2.52) {
        // The frieze: a dark green course and a thin cream bead over it.
        g = tile(vec2(u, y - 2.30), 0.11, fp, cell);
        alb = y < 2.44 ? vec3(0.06, 0.25, 0.22) * (0.85 + 0.3 * hash21(cell)) : vec3(0.74, 0.70, 0.58);
        gloss = 0.7;
      }
      else {
        // Painted render up to the vault, flaking.
        g   = 0.0;
        alb = vec3(0.56, 0.58, 0.54) * (0.82 + 0.30 * vnoise(vec2(u, y) * 1.3));
        alb = mix(alb, vec3(0.40, 0.42, 0.38), smoothstep(0.62, 0.70, vnoise(vec2(u, y) * 3.1 + 7.0)));
      }

      alb *= 1.0 - g * 0.32;
      gloss *= 1.0 - g;

      // Old water levels: brown tide lines, each dirtier and higher than the last.
      float y0 = 0.0;
      for (int k = 0; k < 3; k++) {
        y0 += 0.30 + float(k) * 0.12;
        float jag = (vnoise(vec2(u * 2.0, float(k))) - 0.5) * 0.06;
        alb *= 1.0 - 0.30 * smoothstep(0.035, 0.0, abs(y - y0 - jag)) / (1.0 + float(k));
      }
      // The waterline itself: wet, dark and glossy for a hand's width over it.
      float wet = exp(-max(y, 0.0) * 5.0);
      alb   *= 1.0 - 0.35 * wet;
      gloss  = mix(gloss, 1.0, wet);

      // Streaks: rust and lime running down from the windows and the beams.
      float st = vnoise(vec2(u * 7.0, y * 0.35)) * vnoise(vec2(u * 2.3, y * 0.15 + 3.0));
      alb = mix(alb, vec3(0.36, 0.26, 0.16), smoothstep(0.30, 0.55, st) * smoothstep(5.5, 1.0, y) * 0.55);

      if (gKind < 0.5) {
        float zb = latt(p.z, BAY);
        float wd = windowD(zb, y);
        if (wd < 0.0) {
          // Glazing: an iron grid of small panes, a few of them gone grey.
          vec2  pc = floor(vec2(zb, y) / vec2(0.35, 0.42));
          vec2  pf = fract(vec2(zb, y) / vec2(0.35, 0.42)) - 0.5;
          float bar = 1.0 - smoothstep(0.38, 0.44, max(abs(pf.x), abs(pf.y)));
          float ph  = hash21(pc + floor(p.z / BAY) * 7.0);
          vec3  sky = mix(vec3(0.62, 0.76, 0.92), vec3(0.95, 0.92, 0.82), smoothstep(3.0, 6.0, y));
          emit = sky * (ph < 0.12 ? 0.35 : 1.5 + 0.6 * ph) * bar * smoothstep(0.0, -0.12, wd) * 1.4;
          alb  = vec3(0.02);
        }
        // The reveal is deep and dark; an architrave of tile frames it.
        alb *= 1.0 - 0.75 * smoothstep(-0.16, -0.02, wd) * smoothstep(0.03, -0.02, wd);
        alb  = mix(alb, vec3(0.70, 0.68, 0.60), smoothstep(0.02, 0.0, abs(wd - 0.07)) * 0.6);
        // Light from the window washing the render under it.
        emit += vec3(0.40, 0.48, 0.56) * smoothstep(1.6, 0.0, abs(zb)) * smoothstep(1.4, 3.0, y) * smoothstep(3.6, 2.6, y) * alb * 0.8;

        // Corner shadow either side of each pilaster.
        ao *= 0.55 + 0.45 * smoothstep(0.0, 0.7, abs(pil(p.z)) - PW);
      }
      if (gKind > 4.5) {
        // The way on: an arched opening, black, with a lit EXIT box over it.
        float dd = windowD(p.x * 1.0, p.y + 3.3);
        alb *= 1.0 - 0.96 * smoothstep(0.04, -0.04, dd);
        alb  = mix(alb, vec3(0.70, 0.68, 0.60), smoothstep(0.03, 0.0, abs(dd - 0.10)) * 0.6);
        vec2 eb = abs(vec2(p.x, p.y - 3.55)) - vec2(0.36, 0.13);
        emit += vec3(0.25, 1.0, 0.45) * step(max(eb.x, eb.y), 0.0) * 1.6;
        ao *= 0.5 + 0.5 * smoothstep(0.0, 1.2, HW - abs(p.x));
      }
      // Under the vault and at the water both collect shadow.
      ao *= 0.6 + 0.4 * smoothstep(0.0, 1.2, HC - y);
      ao *= 0.75 + 0.25 * smoothstep(0.0, 0.5, y + 0.3);
    }
    else {
      // Ceiling and beams: painted board, a grid of acoustic panels and the
      // fittings. The fitting housings are drawn on the ceiling; the tubes glow.
      float g = tile(p.xz, 1.2, fp, cell);
      alb = vec3(0.42, 0.45, 0.45) * (0.85 + 0.25 * hash21(cell)) * (1.0 - g * 0.35);
      if (gKind > 2.5) alb = vec3(0.30, 0.31, 0.30) * (0.8 + 0.4 * vnoise(p.xz * 2.0));
      alb = mix(alb, vec3(0.30, 0.22, 0.14), smoothstep(0.55, 0.8, vnoise(p.xz * 0.8)) * 0.5);
      if (gKind < 2.5) {
        for (int i = 0; i < 2; i++) {
          float side = float(i);
          float dx   = abs(p.x - (i == 0 ? -LX : LX));
          float run  = 1.0 - smoothstep(0.74, 0.80, abs(latt(p.z, 3.0)));
          alb  = mix(alb, vec3(0.12), (1.0 - smoothstep(0.17, 0.20, dx)) * run);
          emit += vec3(1.0, 0.97, 0.90) * (1.0 - smoothstep(0.06, 0.09, dx)) * tubeOn(p.z, side) * 6.0;
        }
        ao *= 0.55 + 0.45 * smoothstep(0.0, 0.9, abs(pil(p.z)) - BMW);
      }
      ao *= 0.5 + 0.5 * smoothstep(0.0, 1.1, HW - abs(p.x));
    }

    // Bounce off the water below: an aqua fill that fades up the wall, and the
    // caustic band thrown back up onto it, which is most of why a pool reads.
    vec3 fill = vec3(0.10, 0.17, 0.19) + vec3(0.08, 0.20, 0.22) * exp(-max(p.y, 0.0) * 0.5);
    float cb  = caustic(vec2(p.z + p.x, p.y * 1.6) * 1.3, iTime * 0.9) * exp(-max(p.y, 0.0) * 1.4);
    vec3 c = alb * (fill + hallLight(p, n, rd, gloss) + vec3(0.45, 0.85, 0.90) * cb * 1.6) * ao;
    return c + emit;
  }

  // The floor of the pool and the walls under the water.
  vec3 shadeUnder(vec3 p, vec3 n, float fp) {
    vec2  cell;
    vec3  alb;
    float c;
    if (n.y > 0.5) {
      float g = tile(p.xz, 0.25, fp, cell);
      alb = vec3(0.58, 0.80, 0.84) * (0.92 + 0.12 * hash21(cell)) * (1.0 - g * 0.30);
      // Lane lines down the middle of each lane, with the T at the wall end.
      float lx = abs(latt(p.x + 1.6, 3.2));
      float ln = 1.0 - smoothstep(0.12, 0.12 + fp, lx);
      float zt = latt(p.z, 25.0);
      ln = max(ln, (1.0 - smoothstep(0.12, 0.12 + fp, abs(zt))) * step(lx, 0.55));
      alb = mix(alb, vec3(0.04, 0.07, 0.20), ln * step(abs(p.x), HW - 0.6));
      // A sump grate every second bay against the wall.
      vec2  dg = vec2(abs(p.x) - (HW - 0.55), latt(p.z, 12.0));
      float gr = step(max(abs(dg.x), abs(dg.y)), 0.28);
      alb *= 1.0 - gr * (0.55 + 0.35 * step(0.5, fract(dg.y * 14.0)));
      // Silt in the corners.
      alb = mix(alb, vec3(0.20, 0.24, 0.16), smoothstep(1.4, 0.0, HW - abs(p.x)) * 0.45);
      c = caustic(p.xz * 0.8, iTime * 0.8);
    }
    else {
      float u = abs(n.x) > 0.5 ? p.z : p.x;
      float g = tile(vec2(u, p.y), 0.20, fp, cell);
      alb = vec3(0.56, 0.76, 0.80) * (0.92 + 0.12 * hash21(cell)) * (1.0 - g * 0.30);
      c = caustic(vec2(u, p.y * 1.4) * 0.8, iTime * 0.8) * 0.6;
    }
    return alb * (vec3(0.26, 0.44, 0.48) + vec3(0.70, 0.95, 1.0) * c * 1.5);
  }

  // Ripples: two long swells and a fine chop, differentiated by hand.
  vec3 waterN(vec2 xz, float t, float fp) {
    vec2 g = vec2(0.0);
    g += vec2(1.7, 0.0)  * cos(xz.x * 1.7 + t * 1.1) * 0.016;
    g += vec2(0.0, 1.3)  * cos(xz.y * 1.3 - t * 0.9) * 0.018;
    g += vec2(2.1, 2.1)  * cos((xz.x + xz.y) * 2.1 + t * 1.7) * 0.009;
    float fine = 1.0 - smoothstep(0.05, 0.3, fp);
    g += vec2(6.3, -4.1) * cos(xz.x * 6.3 - xz.y * 4.1 + t * 2.9) * 0.006 * fine;
    g += vec2(3.7, 7.9)  * cos(xz.x * 3.7 + xz.y * 7.9 - t * 3.3) * 0.005 * fine;
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  // Halos round the tubes, integrated along a ray: the bloom there is no FBO
  // for.
  vec3 tubeGlow(vec3 ro, vec3 rd, float tMax) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec2  L  = vec2(i == 0 ? -LX : LX, HC - 0.12);
      vec2  o  = ro.xy - L;
      float tc = clamp(-dot(o, rd.xy) / max(dot(rd.xy, rd.xy), 1e-4), 0.0, tMax);
      vec2  d  = o + rd.xy * tc;
      float z  = ro.z + rd.z * tc;
      acc += vec3(1.0, 0.96, 0.88) * tubeOn(z, float(i)) * 0.010 / (dot(d, d) + 0.012) / (1.0 + tc * 0.08);
    }
    return acc;
  }

  // Humid air, thick at the water and thin under the vault, integrated in
  // closed form along the ray. Lit, so it reads as steam rather than dust.
  vec3 mist(vec3 ro, vec3 rd, float t, vec3 c) {
    float h   = 0.9;
    float ry  = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
    float lay = h / ry * (exp(-ro.y / h) - exp(-(ro.y + rd.y * t) / h));
    float den = 0.010 * t + 0.06 * max(lay, 0.0);
    float a   = 1.0 - exp(-den);
    return mix(c, vec3(0.22, 0.29, 0.31), a * 0.85);
  }

  void main() {
    vec2  uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t  = iTime;

    // Floating down the hall at a slow paddle, swaying with the swell, the head
    // turning now and then the way the route does.
    vec3  ro    = vec3(sin(t * 0.13) * 0.9, 1.05 + sin(t * 0.7) * 0.04, t * 0.75);
    float yaw   = sin(t * 0.09) * 0.30 + uPointer.x * 0.40;
    float pitch = -0.06 + sin(t * 0.21) * 0.03 + uPointer.y * 0.20;
    float roll  = sin(t * 0.6) * 0.012;
    vec3  fwd   = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3  rgt   = normalize(cross(vec3(sin(roll), cos(roll), 0.0), fwd));
    vec3  up    = cross(fwd, rgt);
    vec3  rd    = normalize(uv.x * rgt + uv.y * up + 1.0 * fwd);
    float px    = 1.3 / iResolution.y;
    gEnd = ro.z + 34.0;

    vec3  n;
    float th  = hallHit(ro, rd, n);
    vec3  col;
    float tEnd = th;

    if (rd.y < 0.0 && -ro.y / rd.y < th) {
      // --- the water ---
      float tw = -ro.y / rd.y;
      vec3  wp = ro + rd * tw;
      float fp = tw * px;
      vec3  wn = waterN(wp.xz, t, fp);
      tEnd = tw;

      vec3  rr = reflect(rd, wn);
      rr.y = abs(rr.y);
      vec3  rn;
      float tr   = hallHit(wp, rr, rn);
      vec3  refl = shadeHall(wp + rr * tr, rn, rr, (tw + tr) * px);
      refl = mist(wp, rr, tr, refl) + tubeGlow(wp, rr, tr);

      vec3  rf = refract(rd, wn, 0.75);
      vec3  fn;
      float tf   = hallHit(wp, rf, fn);
      vec3  fpnt = wp + rf * tf;
      vec3  under = shadeUnder(fpnt, fn, (tw + tf) * px);
      // Beer-Lambert per channel: red goes first, which is why it is blue.
      vec3 tr3 = exp(-tf * vec3(0.48, 0.13, 0.10));
      under = under * tr3 + vec3(0.02, 0.10, 0.12) * (1.0 - tr3);

      float cosT = clamp(dot(wn, -rd), 0.0, 1.0);
      float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      col = mix(under, refl, fres);

      // Where the water meets the wall: a dark meniscus and a skin of scum.
      float wall = min(HW - abs(wp.x), HW - PD - abs(wp.x) + step(PW, abs(pil(wp.z))) * 9.0);
      col *= 0.55 + 0.45 * smoothstep(0.0, 0.10, wall);
      float scum = smoothstep(0.55, 0.80, vnoise(wp.xz * 0.9 + vec2(t * 0.02, 0.0))) * smoothstep(1.6, 0.2, wall);
      col = mix(col, vec3(0.20, 0.23, 0.17), scum * 0.40);

      // The lane ropes: two horizontal cylinders of floats at the surface,
      // solved exactly, beaded along z, in red, white and blue runs.
      for (int i = 0; i < 2; i++) {
        vec2  c  = vec2(i == 0 ? -ROPE : ROPE, 0.02);
        vec2  oc = ro.xy - c;
        float a  = dot(rd.xy, rd.xy);
        float b  = dot(oc, rd.xy);
        float cc = dot(oc, oc) - 0.075 * 0.075;
        float h  = b * b - a * cc;
        if (h > 0.0) {
          float tc = (-b - sqrt(h)) / a;
          vec3  hp = ro + rd * tc;
          float zb = fract(hp.z / 0.30) - 0.5;
          float cov = smoothstep(0.47, 0.36, abs(zb));
          if (tc > 0.0 && tc < tEnd + 0.2 && cov > 0.0) {
            vec3  bn  = normalize(vec3(hp.xy - c, zb * 0.6));
            float run = fract(floor(hp.z / 2.4) * 0.37);
            vec3  ba  = run < 0.34 ? vec3(0.62, 0.07, 0.05) : (run < 0.67 ? vec3(0.85, 0.85, 0.82) : vec3(0.06, 0.18, 0.55));
            vec3  bc  = ba * (vec3(0.16, 0.22, 0.24) + vec3(1.0, 0.97, 0.9) * max(bn.y, 0.0) * 1.3)
                      + vec3(1.0) * pow(max(dot(reflect(rd, bn), vec3(0.0, 1.0, 0.0)), 0.0), 24.0) * 0.5;
            col  = mix(col, bc, cov);
            tEnd = min(tEnd, tc);
          }
        }
      }
    }
    else {
      col = shadeHall(ro + rd * th, n, rd, th * px);
    }

    col = mist(ro, rd, tEnd, col);
    col += tubeGlow(ro, rd, tEnd);

    // Grade: exposure, a filmic shoulder, teal shadows, and a vignette.
    col *= 1.15;
    col = aces(col);
    col = mix(col, col * vec3(0.92, 1.0, 1.04), 1.0 - smoothstep(0.0, 0.5, dot(col, vec3(0.333))));
    col = pow(col, vec3(0.95));
    col *= 1.0 - 0.38 * smoothstep(0.35, 1.05, length(uv * vec2(0.85, 1.0)));
    col += (hash21(gl_FragCoord.xy + fract(t) * 51.7) - 0.5) * 0.025;
    gl_FragColor = vec4(col, 1.0);
  }
`
