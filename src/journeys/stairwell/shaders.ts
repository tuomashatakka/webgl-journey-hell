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
import { skyAndMaterialsGlsl } from './glsl/skyAndMaterials'


export const fsScene = foundationGlsl + shapeGlsl + actsGlsl + skyAndMaterialsGlsl

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
