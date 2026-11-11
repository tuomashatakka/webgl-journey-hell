// THE STAIRWELL — six open industrial landscapes on one descending stair.
//
// GLSL ES 3.00, on WebGL2: the scene is shaded from the Δ library — every map
// of every ambientCG set, triplanar, under the act's own photographed sky — and
// the acts are joined in *space*, not in time.
//
// ---------------------------------------------------------------------------
// Seams, not crossfades
// ---------------------------------------------------------------------------
//
// The first version handed one act to the next by mixing their distance fields
// over the closing half of each act and hiding the morph behind a veil of fog.
// A mixed distance field is a blob that is neither place, and the veil meant
// half of every act was spent in soup.
//
// Now every act ends in a wall: a dam, a cliff face, a bulkhead — two hundred
// metres across and seventy high — with the stair running through a portal in
// it. The next act is *there*, beyond the wall, in its own coordinates shifted
// to meet the stair, and you see it framed in the far mouth of the tunnel long
// before you reach it. Everything that differs between two acts is decided by
// which side of the wall a ray ends on:
//
//   * a ray that hits geometry past the seam is shaded with the next act's
//     sun, sky light and air; one that hits before it, with this act's;
//   * a ray that escapes takes the next act's sky only if it crossed the seam
//     plane *below the top of the wall* — through the portal — and this act's
//     otherwise, so the sky above the wall is never split;
//   * the air is integrated in two pieces, this act's up to the seam and the
//     next act's beyond it.
//
// The stair itself is continuous across the seam: rise and run differ per act,
// so the slope is blended through the tunnel and the rail height is its
// integral, in closed form — a smoothstep integrates to u³ − u⁴/2 — which
// makes the landing exact at any z and the camera's height C¹ across the
// switch of coordinate systems. The CPU changes act when the camera passes the
// middle of the tunnel; at that instant the old act's coordinates and the new
// one's describe the same point, so nothing on screen moves.
//
// The Protean Weather Bridge's cloud volume is technically inspired by Nimitz's
// Protean Clouds (Shadertoy 3l23Rh, CC BY-NC-SA 3.0) but does not copy its
// field, constants, camera or palette. Fog is after Inigo Quilez's "Better Fog"
// (sun inscattering and extinction kept separate). Soft shadows are iq's
// penumbra estimate along the shadow ray.

import { ACES } from '@wjh/glsl/color'
import { HASH12 } from '@wjh/glsl/hash'
import { foundationGlsl } from './glsl/foundation'
import { shapeGlsl } from './glsl/shape'
import { actsGlsl } from './glsl/acts'
import { detailGlsl } from './glsl/detail'
import { skyAndMaterialsGlsl } from './glsl/skyAndMaterials'


export const fsScene = foundationGlsl + shapeGlsl + actsGlsl + detailGlsl + skyAndMaterialsGlsl

export const fsPost = /* glsl */`#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec2 iResolution;
uniform float iTime;
uniform float uHeavy;
uniform float uRupture;
uniform float uDecay;
uniform float uPurgatory;
uniform float uFinale;
uniform float uDecode;
uniform float uExposure;

out vec4 fragColor;

${HASH12}

vec3 fetch (vec2 uv, float lod) {
  vec3 c = textureLod(uTexture, uv, lod).rgb;
  if (uDecode > 0.5) c = c / max(1.0 - c, 1e-3);
  return c;
}

${ACES}

void main () {
  float t = mod(iTime, 3600.0);
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  vec2 center = uv - 0.5;
  float r2 = dot(center, center);
  vec2 warped = uv + center * r2 * mix(0.03, 0.12, uFinale);

  // How much of the image has gone: continuous in uDecay, calmed by the
  // residue (liminal's calm term), so the quiet end is quiet.
  float damage = (clamp(uDecay * 0.16, 0.0, 0.52) + uFinale * 0.42) * (1.0 - uPurgatory * 0.78);

  // liminal's two-tier interference: a hash-gated band displacement, and,
  // independently, an injected red flash.
  float band = floor(warped.y * 38.0 + t * 8.0);
  float glitch = step(0.92 - uRupture * 0.11 - uFinale * 0.18, hash12(vec2(band, floor(t * 7.0))));
  warped.x += (hash12(vec2(band, 17.0)) - 0.5) * glitch * (0.012 + uFinale * 0.045) * (1.0 - uPurgatory * 0.85);
  float fineBand = floor(warped.y * 28.0 + t * 35.0);
  if (hash12(vec2(fineBand, 91.0)) < damage * 0.25)
    warped.x += (hash12(vec2(fineBand, 15.0)) - 0.5) * damage * 0.07;

  float caScale = 0.012 + uRupture * 0.05 + uFinale * 0.08;
  if (uFinale > 0.5) {
    float tG = t * 65.0;
    warped += vec2(sin(tG * 1.5) * 0.012 * step(0.72, sin(tG)), cos(tG * 0.9) * 0.008 * step(0.82, cos(tG * 1.1)));
    caScale *= 2.2;
  }
  vec2 ca = center * (r2 + 0.02) * caScale;
  vec3 color;
  color.r = fetch(warped - ca, 0.0).r;
  color.g = fetch(warped, 0.0).g;
  color.b = fetch(warped + ca, 0.0).b;

  // Bloom from the scene's own mip chain: the wider levels, thresholded.
  vec3 bloom = vec3(0.0);
  for (int i = 2; i <= 6; i++) {
    if (uHeavy < 0.5 && i > 4) break;
    vec3 b = fetch(warped, float(i));
    bloom += max(b - 1.0, 0.0) * (0.6 / float(i));
  }
  color += bloom * 0.6;

  if (hash12(vec2(floor(t * 18.0), 3.0)) < damage * 0.18)
    color += vec3(0.18, 0.01, 0.02) * damage * sin(warped.y * 30.0);

  color *= uExposure;
  color = aces(color);
  // A gentle print curve: a little more saturation and a little more bite in
  // the mids, the way film handles a grey industrial morning.
  float luma0 = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma0), color, 1.12);
  color = mix(color, color * color * (3.0 - 2.0 * color), 0.25);
  color *= mix(0.55, 1.0, smoothstep(0.80, 0.22, length(center)));
  if (uPurgatory > 0.001) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma * 1.04), uPurgatory * 0.7);
  }
  color *= 1.0 - smoothstep(0.82, 1.0, uFinale) * 0.22;
  color = pow(color, vec3(1.0 / 2.2));
  color += (hash12(gl_FragCoord.xy + fract(t) * 71.0) - 0.5) * 0.03;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`

// perf: one sdf march (120/80 steps by quality), a 40/20-step soft shadow and a
// 4-tap AO at the hit, triplanar Δ sampling once per pixel; clouds only in act II.

// The index preview: a lightweight stand-in for the scene, GLSL ES 1.00 and
// self-driving from iTime. Act II seen down its own flight — nosed treads and a
// balustrade descending onto the weather bridge, pylons and catenary over a
// cloud sea, cooling towers breathing on the far haze under a low sun, and the
// rupture as lit faults through the picture. Everything is in closed form per
// pixel: one perspective divide per family of members, a six-pylon loop and a
// few octaves of value noise, cheap enough for the shared index context.
export const stairwellPreviewFrag = /* glsl */`
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH12}

  float vnoise (vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm (vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += vnoise(p) * a;
      p = p * 2.03 + vec2(1.7, -0.6);
      a *= 0.5;
    }
    return s;
  }

  // A line of half-width w around v = 0, antialiased by the pixel size px.
  float line (float v, float w, float px) { return 1.0 - smoothstep(w, w + px, abs(v)); }

  // Camera: eye 1.7 above the flight, focal length 1. The flight's vanishing
  // point sits under the horizon, which is what makes it read as going down.
  const float HOR = 0.06;
  const float VP = -0.09;
  const float EYE = 1.7;
  const float W = 1.6;
  const float SPEED = 0.9;

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.06;
    float px = 1.5 / iResolution.y;
    float t = mod(iTime, 600.0);
    float walk = t * SPEED;
    vec2 sunP = vec2(0.46, 0.17);

    // Sky: a cold zenith over a warm, low dawn band, streaked with cloud.
    float h = uv.y - HOR;
    vec3 zenith = vec3(0.16, 0.22, 0.32);
    vec3 band = vec3(0.98, 0.70, 0.48);
    vec3 col = mix(band, zenith, smoothstep(-0.02, 0.42, h));
    float sd = length((uv - sunP) * vec2(1.0, 1.25));
    col += vec3(1.0, 0.78, 0.5) * exp(-sd * 7.0) * 0.55;
    float streak = fbm(vec2(uv.x * 2.2 - t * 0.012, uv.y * 9.0));
    float cloudy = smoothstep(0.45, 0.8, streak) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.25, 0.5, h));
    vec3 cloudCol = mix(vec3(0.42, 0.36, 0.40), vec3(1.0, 0.74, 0.55), exp(-sd * 3.5));
    col = mix(col, cloudCol, cloudy * 0.65);
    col += vec3(1.0, 0.92, 0.8) * smoothstep(0.03, 0.024, length(uv - sunP)) * 1.5;
    vec3 haze = mix(band, vec3(0.78, 0.66, 0.62), 0.4) + vec3(1.0, 0.75, 0.5) * exp(-sd * 4.0) * 0.25;

    // The far bank: cooling towers in the haze, each with its plume leaning
    // downwind.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float cx = -0.78 + fi * 0.16 + (fi > 1.5 ? 0.9 : 0.0);
      float th = 0.11 - fi * 0.015;
      float y = (uv.y - HOR + 0.005) / th;
      float r = 0.035 * (0.72 + 0.9 * (y - 0.68) * (y - 0.68)) * th / 0.11;
      float body = step(abs(uv.x - cx), r) * step(0.0, y) * step(y, 1.0);
      float lit = smoothstep(-r, r, uv.x - cx);
      col = mix(col, mix(haze * 0.55, haze * 0.82, lit), body * 0.85);
      float py = y - 1.0;
      float pr = r * (1.0 + py * 0.9);
      float px0 = (uv.x - cx - py * py * th * 0.35) / pr;
      float puff = fbm(vec2(px0 * 1.5 + fi * 3.0, py * 2.2 - t * 0.3));
      float plume = exp(-px0 * px0 * 1.6) * smoothstep(0.0, 0.25, py) * exp(-py * 0.45) * smoothstep(0.2, 0.65, puff);
      col = mix(col, haze * 1.06 + 0.05, plume * 0.85);
    }

    // The cloud sea under the bridge: a plane of fbm, lit on its tops.
    if (uv.y < HOR) {
      float dc = 9.0 / max(HOR - uv.y, 1e-3);
      vec2 cp = vec2(uv.x * dc, dc + walk) * 0.07;
      float c = fbm(cp + vec2(t * 0.02, 0.0));
      float tops = smoothstep(0.35, 0.75, c);
      vec3 sea = mix(vec3(0.34, 0.33, 0.42), vec3(1.0, 0.86, 0.72), tops);
      sea += vec3(1.0, 0.7, 0.45) * exp(-abs(uv.x - sunP.x) * 3.0) * tops * 0.25;
      col = mix(sea, haze, 1.0 - exp(-dc * 0.012));
    }

    // Pylons, far to near: legs, a crosshead, and the beacon on each.
    vec3 steel = vec3(0.10, 0.11, 0.13);
    for (int k = 5; k >= 0; k--) {
      float dk = 22.0 * float(k) + 22.0 - mod(walk, 22.0);
      float fog = exp(-dk * 0.018);
      float xl = 4.2 / dk;
      float top = VP + 6.9 / dk;
      float foot = VP - 6.0 / dk;
      float legs = line(abs(uv.x) - xl, 0.12 / dk, px) * step(foot, uv.y) * step(uv.y, top);
      float head = line(uv.y - VP - 6.2 / dk, 0.12 / dk, px) * step(abs(uv.x), xl);
      float m = max(legs, head);
      col = mix(col, mix(haze, steel, fog), m);
      float beacon = exp(-length(vec2(abs(uv.x) - xl, uv.y - top)) * dk * 6.0);
      col += vec3(1.0, 0.25, 0.1) * beacon * (0.6 + 0.4 * sin(t * 2.1 + float(k))) * fog;
    }

    // Catenary and hangers either side, closed form along the side's own depth.
    float ax = max(abs(uv.x), 1e-3);
    float dp = 4.2 / ax;
    if (dp > 1.0) {
      float fog = exp(-dp * 0.018);
      float span = fract((dp + mod(walk, 22.0)) / 22.0);
      float sag = 4.0 * span * (1.0 - span) * 3.2;
      float cable = line(uv.y - VP - (6.9 - sag) / dp, 0.002 + 0.05 / dp, px);
      float hg = fract((dp + mod(walk, 2.75)) / 2.75);
      float hanger = line((hg - 0.5) * 2.75, 0.006 * dp, dp * dp / 4.2 * px) *
                     step(VP - 1.7 / dp, uv.y) * step(uv.y, VP + (6.9 - sag) / dp);
      col = mix(col, mix(haze, steel, fog), max(cable, hanger * 0.85));
    }

    // The deck: a truss chord either side, wind fencing, then the flight.
    float dd = EYE / max(VP - uv.y, 1e-3);
    float onDeck = step(uv.y, VP) * step(ax * dd, 3.5);
    if (onDeck > 0.5) {
      float fog = 1.0 - exp(-dd * 0.03);
      float s = (dd + walk) / 0.48;
      float f = fract(s);
      float aa = clamp(dd * dd / EYE / 0.48 * px * 2.0, 0.0, 1.0);
      vec3 deck = vec3(0.16, 0.16, 0.17);
      if (ax * dd < W) {
        // Treads: a pale nosing stripe, grime against the riser behind, and a
        // worn path down the middle.
        float xn = ax * dd / W;
        vec3 tread = vec3(0.30, 0.29, 0.28) * (0.85 + 0.3 * vnoise(vec2(xn * 6.0, s * 2.0)));
        tread *= 1.0 + (1.0 - smoothstep(0.1, 0.55, xn)) * 0.25;
        float nose = smoothstep(0.9, 0.95, f);
        tread = mix(tread, vec3(0.70, 0.54, 0.16), nose * (0.75 - 0.4 * vnoise(vec2(xn * 9.0, s))));
        tread *= mix(1.0, 0.45, smoothstep(0.35, 0.0, f));
        // Sun along the treads, from the low sun ahead.
        tread += vec3(0.45, 0.3, 0.18) * nose * 0.5;
        float avg = 0.6;
        deck = mix(tread, vec3(0.30, 0.27, 0.24) * avg + vec3(0.07, 0.05, 0.02), aa);
      } else {
        float slot = step(0.5, fract(ax * dd * 6.0));
        deck = mix(vec3(0.12, 0.13, 0.15), vec3(0.05), slot * (1.0 - aa));
      }
      col = mix(deck, haze, fog);
    }

    // The balustrade: top rail, knee rail, posts, and a toe board.
    float dr = (W + 0.12) / ax;
    if (dr > 0.9 && uv.y < VP + 1.0) {
      float fog = 1.0 - exp(-dr * 0.03);
      float railY = VP - (EYE - 1.04) / dr;
      float kneeY = VP - (EYE - 0.52) / dr;
      float deckY = VP - EYE / dr;
      float rail = line(uv.y - railY, 0.035 / dr + 0.001, px);
      float knee = line(uv.y - kneeY, 0.02 / dr + 0.0008, px);
      float toe = step(deckY, uv.y) * step(uv.y, deckY + 0.12 / dr);
      float g = fract((dr + walk) / 1.6);
      float post = line((g - 0.5) * 1.6, 0.03 * dr, dr * dr / (W + 0.12) * px) * step(deckY, uv.y) * step(uv.y, railY);
      vec3 yellow = vec3(0.72, 0.52, 0.10) * (0.7 + 0.5 * smoothstep(railY - 0.02 / dr, railY + 0.03 / dr, uv.y));
      col = mix(col, mix(vec3(0.14, 0.15, 0.16), haze, fog), max(post, max(knee, toe)));
      col = mix(col, mix(yellow, haze, fog), rail);
    }

    // The rupture: faults broken through the picture, not a bolt through
    // the sky. Each is a polyline (hashes joined straight, so it turns at
    // angles), broken into runs with gaps, lit white at the core and cold
    // blue around it, with short spurs off every run. The one across the
    // flight burns hot, the way the cracks do on the fourth traversal.
    vec3 cold = vec3(0.25, 0.72, 1.0);
    vec3 hot = vec3(1.6, 0.42, 0.08);
    float pulse = 0.7 + 0.3 * sin(t * 1.7) * sin(t * 0.63 + 1.0);
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float fx = uv.x * (1.2 - fi * 0.3) + fi * 3.1;
      float base = fi < 0.5 ? 0.3 - uv.x * 0.48 : VP - 0.2 + uv.x * 0.16;
      float c1 = floor(fx * 7.0);
      float jag = mix(hash12(vec2(c1, fi)), hash12(vec2(c1 + 1.0, fi)), fract(fx * 7.0)) - 0.5;
      float c2 = floor(fx * 26.0);
      jag = jag * 0.07 + (mix(hash12(vec2(c2, fi + 9.0)), hash12(vec2(c2 + 1.0, fi + 9.0)), fract(fx * 26.0)) - 0.5) * 0.018;
      float df = abs(uv.y - base - jag);
      float run = step(0.22, hash12(vec2(floor(fx * 3.0), fi + 4.0)));
      // A spur from the fault, one per run of the coarse polyline.
      float sc = floor(fx * 5.0);
      float sx = (sc + 0.5) / 5.0;
      float sl = (hash12(vec2(sc, fi + 2.0)) - 0.5) * 2.4;
      float sy = uv.y - base - jag;
      float along = fract(fx * 5.0) - 0.5;
      float spur = abs(sy - along * sl * 0.2) * step(0.0, along * sign(sl + 1e-3) * sign(sy + 1e-3) + 0.5) *
                   1.0 + step(0.12, abs(sy)) * 1.0;
      float lit = run * (0.65 + 0.35 * hash12(vec2(c2, floor(t * 3.0) + fi)));
      lit *= fi < 0.5 ? 1.0 : onDeck;
      float core = 1.0 - smoothstep(0.0008, 0.0008 + px, df);
      float halo = exp(-df * 140.0) * 0.6 + exp(-df * 30.0) * 0.12;
      float spurCore = (1.0 - smoothstep(0.0006, 0.0006 + px, spur)) * 0.7;
      vec3 c = fi < 0.5 ? cold : mix(hot, cold, 0.25);
      col = mix(col, col * 0.25, exp(-df * (fi < 0.5 ? 300.0 : 110.0)) * lit * 0.8);
      col += c * exp(-df * 18.0) * 0.06 * lit * fi;
      col += (vec3(1.0, 0.95, 0.9) * core + c * (halo + spurCore)) * lit * pulse;
    }

    // Print and lens: a soft S, a warm-cool split, and a vignette.
    col = col / (1.0 + col * 0.35);
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.3);
    col *= smoothstep(1.15, 0.3, length(uv * vec2(0.9, 1.1)));
    col += (hash12(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.02;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`
