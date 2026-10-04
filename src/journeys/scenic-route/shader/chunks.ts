import { HASH11, HASH12 } from '@wjh/glsl/hash'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'


export const noiseChunk = /* glsl */`
${HASH11}
${HASH12}
float hash13 (vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
${valueNoise2('hash12')}
float vnoise3 (vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
${fbm2({ octaves: 5, next: 'p = p * 2.03 + 17.1;' })}
float fbm3 (vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise3(p);
    p = p * 2.07 + 11.3;
    a *= 0.5;
  }
  return s;
}
`

/**
 * Cook-Torrance with GGX / Smith / Schlick, per learnopengl.com/PBR. Inputs are
 * clamped so no pow() ever sees a negative base.
 */
export const brdfChunk = /* glsl */`
const float PI = 3.14159265;
float D_GGX (float NoH, float a) {
  float a2 = a * a;
  float d = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * d * d + 1e-6);
}
float V_Smith (float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-4);
}
vec3 F_Schlick (float VoH, vec3 f0) {
  float x = clamp(1.0 - VoH, 0.0, 1.0);
  float x2 = x * x;
  return f0 + (1.0 - f0) * (x2 * x2 * x);
}
// Radiance leaving the surface toward v from one directional light of colour lc.
vec3 shade (vec3 n, vec3 v, vec3 l, vec3 albedo, float rough, float metal, vec3 lc) {
  float NoL = max(dot(n, l), 0.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(v + l);
  float NoV = max(dot(n, v), 1e-3);
  float NoH = max(dot(n, h), 0.0);
  float VoH = max(dot(v, h), 0.0);
  float a = max(rough * rough, 0.002);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F_Schlick(VoH, f0);
  vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F;
  // Grass and gravel are not microfacet surfaces at this scale: the GGX sheen
  // at grazing angles toward a low sun paints whole fields white. Fade the
  // specular out with roughness; the sea (0.09) and paint keep all of theirs.
  spec *= mix(1.0, 0.08, smoothstep(0.55, 0.95, rough));
  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo / PI + spec) * lc * NoL;
}
`

/**
 * Reading the sky LUT. Rows 0..63 are elevation −90°..+90°; row 64 is the sun's
 * transmitted radiance. Azimuth wraps through REPEAT on S.
 */
export const skyLookupChunk = /* glsl */`
uniform sampler2D uSky;
const float SKY_ROWS = 65.0;
vec3 skyLookup (vec3 d) {
  float az = atan(d.x, d.z) / (2.0 * PI) + 0.5;
  float el = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  float v = (el * 63.0 + 0.5) / SKY_ROWS;
  return texture(uSky, vec2(az, v)).rgb;
}
vec3 sunRadiance () {
  return texelFetch(uSky, ivec2(0, 64), 0).rgb;
}
`

/**
 * The sun shadow, received. One 2048² depth map fitted ahead of the camera,
 * hardware-compared through sampler2DShadow with a 3×3 tap, and a normal offset
 * that grows as the light grazes — the two biases learnopengl and MJP agree on.
 * Off entirely in the cave, where uShadowOn is zero.
 */
export const shadowChunk = /* glsl */`
uniform highp sampler2DShadow uShadowMap;
uniform mat4  uShadowMat;    // world -> [0,1]^3 in light space
uniform float uShadowOn;
uniform vec2  uShadowTexel;
float shadowAt (vec3 p, vec3 n, vec3 l) {
  if (uShadowOn < 0.5) return 1.0;
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  vec3 pp = p + n * (0.25 + 1.4 * (1.0 - NoL));
  vec4 sc = uShadowMat * vec4(pp, 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x <= 0.0 || uvz.x >= 1.0 || uvz.y <= 0.0 || uvz.y >= 1.0 || uvz.z >= 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += texture(uShadowMap, vec3(uvz.xy + vec2(float(i), float(j)) * uShadowTexel, uvz.z - 0.0006));
  return sum / 9.0;
}
`

/**
 * Per-fragment lighting shared by every world material: sun through the BRDF
 * and the shadow map, sky ambient at the normal, then fog toward the sky in
 * the view direction.
 */
export const lightingChunk = /* glsl */`
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec4  uEnv;        // (exposure EV, sky weight, fog density, water level)
uniform vec3  uFogCol;
uniform float uTime;
uniform vec3  uCarPos;
uniform vec3  uCarFwd;
uniform vec3  uCarRight;
uniform float uLights;     // headlights, 0..1

/** Two headlamps: warm, a 24-degree cone with a soft edge, inverse-square. */
vec3 headlights (vec3 p, vec3 n, vec3 v, vec3 albedo, float rough, float metal) {
  if (uLights <= 0.001) return vec3(0.0);
  vec3 sum = vec3(0.0);
  vec3 lampCol = vec3(1.0, 0.86, 0.66) * 1600.0 * uLights;
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -0.78 : 0.78;
    vec3 lp = uCarPos + uCarFwd * 1.9 + uCarRight * side + vec3(0.0, -0.45, 0.0);
    vec3 toP = p - lp;
    float d2 = dot(toP, toP) + 30.0;
    vec3 l = -toP * inversesqrt(d2);
    float cone = smoothstep(0.6, 0.86, dot(-l, normalize(uCarFwd + vec3(0.0, -0.08, 0.0))));
    if (cone <= 0.0) continue;
    sum += shade(n, v, l, albedo, rough, metal, lampCol) * cone / d2;
  }
  // A soft knee: a wall a few metres off in the gullet or the cave would
  // otherwise take thirty times the light of the road and burn to white.
  // The knee sits under the exposure: the lamps light what they light at
  // the same brightness on the film whether the room is a dusk road or a
  // red throat that the exposure has opened up for.
  // On film the cap is 0.2 linear, a lit wall that reads as lit and not as a
  // sheet of paper: the ACES fit puts 0.5 at 0.8 sRGB, which is where the
  // gullet went cream with the old 0.55.
  float lum = dot(sum, vec3(0.2126, 0.7152, 0.0722));
  float cap = 0.2 * exp2(-uEnv.x);
  return sum / (1.0 + lum / cap);
}

vec3 lightSurface (vec3 p, vec3 n, vec3 albedo, float rough, float metal, float ao, float shadow) {
  vec3 v = normalize(uCamPos - p);
  vec3 sunCol = sunRadiance();
  // Underground the sky is a memory: sun and ambient scale with the section's
  // sky weight, and the headlamps take over.
  float sky = uEnv.y;
  vec3 col = shade(n, v, uSunDir, albedo, rough, metal, sunCol) * shadow * sky;
  // Sky ambient: radiance at the normal stands in for hemisphere irradiance.
  vec3 amb = skyLookup(n) * (0.6 + 0.4 * n.y) * ao * sky;
  col += albedo * (1.0 - metal) * amb;
  // Specular ambient, cheap: the sky in the reflected direction, Fresnel-weighted.
  vec3 rdir = reflect(-v, n);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F_Schlick(max(dot(n, v), 0.0), f0);
  col += skyLookup(rdir) * F * (1.0 - rough) * ao * sky;
  // A floor of fog-coloured ambient so the cave is never fully black.
  col += albedo * uFogCol * (1.0 - sky) * 0.35 * ao;
  col += headlights(p, n, v, albedo, rough, metal);
  return col;
}

vec3 applyFog (vec3 col, vec3 p) {
  vec3 d = p - uCamPos;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  vec3 sky = skyLookup(vec3(rd.x, max(rd.y, 0.015), rd.z));
  // The sky LUT carries the Mie peak; fog in-scatter toward the sun must not.
  // Cap the in-scatter at a few times the zenith luminance, keeping the hue,
  // or every surface in the sun's quarter washes to white.
  vec3 zen = skyLookup(vec3(0.0, 1.0, 0.0));
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float cap = 3.0 * dot(zen, LUMA);
  sky *= min(1.0, cap / max(dot(sky, LUMA), 1e-4));
  vec3 fogCol = mix(uFogCol, sky, uEnv.y);
  float f = 1.0 - exp(-dist * uEnv.z);
  return mix(col, fogCol, f);
}
`
