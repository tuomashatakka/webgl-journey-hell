// GLSL ES 3.00 for the stillwater service: one shared chunk for the warp, the
// fog, the light and the rooms, and a program per kind of thing drawn.

import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from '@wjh/delta/glsl'
import { ACES } from '@wjh/glsl/color'
import { FLUME, SECTION } from './route'
import { ROOM_COUNT } from './rooms'
import { KIND } from './stage'


const kinds    = Object.entries(KIND).map(([ name, id ]) => `const int K_${name.toUpperCase()} = ${id};`)
  .join('\n')

const sections = Object.entries(SECTION).map(([ name, id ]) => `const float S_${name.toUpperCase()} = ${id}.0;`)
  .join('\n')

const RADIUS = FLUME.radius.toFixed(4)
const INNER  = (FLUME.radius + FLUME.shell * 0.5).toFixed(4)
const PITCH  = FLUME.flange.toFixed(4)

const HEAD = /* glsl */`#version 300 es
precision highp float;
precision highp int;
`

/** The warp: everything but the metre round the rider comes apart. */
const WARP = /* glsl */`
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform vec3 uForward;
uniform float uWarp;
uniform float uTime;

vec3 warpWorld (vec3 p) {
  vec3 d = p - uEye;
  float dist = length(d);
  float w = uWarp * smoothstep(2.5, 24.0, dist);
  if (w <= 0.0)
    return p;
  float along = dot(d, uForward);
  d += uForward * along * w * 0.38 * sin(uTime * 0.19);
  float reach = min(dist * 0.07, 3.0);
  d += vec3(sin(p.z * 0.21 + uTime * 0.9), 0.6 * sin(p.x * 0.17 - uTime * 0.7),
    sin(p.x * 0.23 + p.y * 0.19 + uTime * 0.8)) * w * reach;
  float a = w * dist * 0.011 * (1.0 + 0.6 * sin(uTime * 0.13));
  float c = cos(a);
  float s = sin(a);
  d = d * c + cross(uForward, d) * s + uForward * dot(uForward, d) * (1.0 - c);
  d.y += w * min(dist * dist, 4.0e6) * 0.0011;
  return uEye + d;
}
`

/** Sky, haze, fog, rooms and light: everything a lit fragment needs. */
const LIGHT = /* glsl */`
uniform vec3 uEye;
uniform float uTime;
uniform float uLap;
uniform float uWarp;
uniform float uDissolve;
uniform sampler2D uSky;
uniform float uSkyExposure;
uniform float uSkyYaw;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uRoomMin[${ROOM_COUNT}];
uniform vec4 uRoomMax[${ROOM_COUNT}];
uniform vec4 uRoomGrid[${ROOM_COUNT}];
uniform vec4 uRoomLamp[${ROOM_COUNT}];

${SKY_GLSL}

float hash12 (vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise2 (vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
    mix(hash12(i + vec2(0, 1)), hash12(i + 1.0), u.x), u.y);
}

vec3 skyAt (vec3 d, float lod) {
  return skyRadiance(textureLod(uSky, equirectUv(d, uSkyYaw), lod).rgb, uSkyExposure);
}

/** Each lap the morning is a little later and a little less kind. */
vec3 lapGrade () {
  return mix(vec3(1.0), mix(vec3(0.78, 0.76, 0.8), vec3(0.5, 0.47, 0.55), step(1.5, uLap)), step(0.5, uLap));
}

vec3 hazeAt (vec3 d) {
  return skyAt(normalize(vec3(d.x, clamp(d.y, -0.25, 0.1), d.z)), 5.5) * lapGrade();
}

const vec3 DEEP = vec3(0.006, 0.05, 0.058);

/** Height fog over the sea: the same colour as the sky where they meet. */
vec3 fogged (vec3 color, vec3 p, float dist) {
  vec3 d = (p - uEye) / max(dist, 1e-3);
  float dy = (p.y - uEye.y) / 60.0;
  float column = abs(dy) < 1e-3 ? 1.0 : (1.0 - exp(-dy)) / dy;
  float density = 0.0034 * exp(-max(uEye.y, -5.0) / 60.0) * (1.0 + 0.35 * uLap);
  float fog = 1.0 - exp(-density * dist * max(column, 0.0));
  color = mix(color, hazeAt(d), clamp(fog, 0.0, 1.0));
  // Murk only along the part of the sight line that is below the surface:
  // continuous as the eye crosses sea level, and nothing inside the tube.
  float lo = min(uEye.y, p.y);
  float hi = max(uEye.y, p.y);
  float wet = lo >= 0.0 ? 0.0 : hi <= 0.0 ? 1.0 : -lo / max(hi - lo, 1e-3);
  float murk = 1.0 - exp(-dist * wet * (0.075 + 0.05 * uLap));
  color = mix(color, DEEP * (0.6 + 0.4 * exp(min(p.y, 0.0) * 0.12)) * lapGrade(), murk);
  return color;
}

/** Which room holds p, -1 outside; the openness is in min.w. */
int roomAt (vec3 p) {
  for (int i = 0; i < ${ROOM_COUNT}; i++)
    if (all(greaterThanEqual(p, uRoomMin[i].xyz - 0.02)) && all(lessThanEqual(p, uRoomMax[i].xyz + 0.02)))
      return i;
  return -1;
}

/** Lamps fail lap by lap, the same ones in the light and in the fitting. */
float lampAlive (int room, vec2 cell) {
  float h = hash12(cell + float(room) * 17.13 + 3.7);
  float alive = uLap < 0.5 ? 1.0 : uLap < 1.5 ? step(0.32, h) : step(0.78, h);
  float flicker = step(0.18, fract(sin(dot(cell, vec2(12.9, 78.2)) + uTime * (3.0 + 7.0 * h)) * 43758.5));
  return alive * mix(1.0, flicker, step(0.5, uLap) * step(h, 0.9));
}

vec2 lampCell (int room, vec3 p) {
  vec4 g = uRoomGrid[room];
  return floor((p.xz - g.xy) / g.zw);
}

vec3 lampsAt (int room, Surface s, vec3 p, vec3 V) {
  vec4 g = uRoomGrid[room];
  vec4 lamp = uRoomLamp[room];
  vec2 lo = floor((uRoomMin[room].xz - g.xy) / g.zw);
  vec2 hi = floor((uRoomMax[room].xz - g.xy) / g.zw) - 1.0;
  // The four lamps round p, each weighted bilinearly, so nothing switches.
  vec2 f = (p.xz - g.xy) / g.zw - 0.5;
  vec2 base = floor(f);
  vec3 sum = vec3(0.0);
  float fill = 0.0;
  for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) {
      vec2 cell = base + vec2(i, j);
      vec2 o = abs(f - cell);
      float weight = (1.0 - o.x) * (1.0 - o.y) * 2.2;
      cell = clamp(cell, lo, hi);
      float alive = lampAlive(room, cell) * weight;
      vec3 at = vec3(g.x + (cell.x + 0.5) * g.z, uRoomMax[room].w, g.y + (cell.y + 0.5) * g.w);
      vec3 L = at - p;
      float d2 = dot(L, L);
      sum += shadeBrdf(s, V, L * inversesqrt(d2)) * lamp.rgb * lamp.w * alive / (d2 + 0.4);
      fill += alive;
    }
  return sum + s.albedo * s.ao * lamp.rgb * lamp.w * 0.012 * fill;
}

vec3 lit (Surface s, vec3 p, vec3 V, float occlusion) {
  vec3 N = s.normal;
  vec3 irradiance = skyIrradiance(uSky, N, uSkyYaw, uSkyExposure) * lapGrade();
  vec3 reflected = skyAt(reflect(-V, N), 2.5 + s.rough * 7.0) * lapGrade();
  vec3 sun = shadeBrdf(s, V, uSunDir) * uSunColor * lapGrade();
  vec3 outdoor = sun + shadeAmbient(s, V, irradiance, reflected, occlusion);
  if (p.y < 0.0) {
    float depth = exp(p.y * 0.22);
    vec2 q = p.xz * 0.9 + p.y * 0.3;
    float caustic = pow(abs(sin(q.x + sin(q.y * 1.3 + uTime) * 1.4) * sin(q.y * 1.1 + sin(q.x * 0.8 - uTime * 0.8))), 6.0);
    outdoor = outdoor * vec3(0.35, 0.75, 0.8) * depth + s.albedo * vec3(0.3, 0.8, 0.8) * caustic * depth * max(N.y, 0.0) * 1.6;
  }
  int room = roomAt(p);
  if (room < 0)
    return outdoor;
  float open = uRoomMin[room].w;
  vec3 inside = lampsAt(room, s, p, V) + outdoor * open;
  inside += s.albedo * vec3(1.0, 0.08, 0.03) * 0.16 * step(1.5, uLap) * (0.7 + 0.3 * sin(uTime * 3.1));
  return inside;
}

/** The ending takes the far things first. */
void dissolve (vec3 p, float dist) {
  if (uDissolve <= 0.0)
    return;
  float n = noise2(p.xz * 0.6 + p.y * 0.9) * 0.7 + noise2(p.xz * 3.1 - p.y) * 0.3;
  if (n < uDissolve * 1.55 - (1.0 - smoothstep(0.0, 70.0, dist)) * 0.55)
    discard;
}
`

export const worldVert = /* glsl */`${HEAD}
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform vec3 uOffset;
out vec3 vWorld;
out vec3 vNormal;
out float vDist;
${WARP}

void main () {
  vec3 p = aPosition + uOffset;
  vWorld = p;
  vNormal = aNormal;
  vDist = length(p - uEye);
  gl_Position = uViewProjection * vec4(warpWorld(p), 1.0);
}
`

export const worldFrag = /* glsl */`${HEAD}
${MATERIAL_GLSL}
${SURFACE_GLSL}
${LIGHT}
${kinds}
uniform int uKind;
uniform float uLayer;
uniform vec3 uTint;
uniform float uRough;
in vec3 vWorld;
in vec3 vNormal;
in float vDist;
out vec4 fragColor;

float grid (vec2 p, float width) {
  vec2 l = abs(fract(p + 0.5) - 0.5);
  float c = min(l.x, l.y);
  return 1.0 - smoothstep(width, width + fwidth(c) + 1e-4, c);
}

void main () {
  vec3 p = vWorld;
  dissolve(p, vDist);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - p);
  vec2 uv = abs(N.y) > 0.6 ? p.xz : abs(N.x) > 0.6 ? p.zy : p.xy;
  float alpha = 1.0;
  vec3 color;

  if (uKind == K_LAMP) {
    int room = roomAt(p - N * 0.05);
    float alive = room < 0 ? 1.0 : lampAlive(room, lampCell(room, p));
    color = uTint * mix(0.03, 5.0, alive) * lapGrade();
  }
  else if (uKind == K_GLASS) {
    float fresnel = 0.04 + 0.96 * pow(1.0 - abs(dot(N, V)), 5.0);
    vec3 R = reflect(-V, N * sign(dot(N, V)));
    color = skyAt(R, 1.5) * lapGrade() * (0.25 + 0.75 * fresnel) + uTint * 0.02;
    float grime = noise2(uv * vec2(1.3, 0.6)) * smoothstep(1.2, 0.0, fract(uv.y * 0.3));
    alpha = clamp(0.16 + fresnel * 0.7 + grime * 0.12, 0.0, 0.92);
  }
  else if (uKind == K_WATER) {
    vec2 q = p.xz;
    vec2 ripple = vec2(noise2(q * 1.7 + uTime * 0.35) - noise2(q * 1.7 + vec2(3.1, uTime * 0.3)),
      noise2(q * 2.3 - uTime * 0.28) - noise2(q * 2.3 + 5.0)) * 0.22;
    vec3 n = normalize(vec3(ripple.x, 1.0, ripple.y));
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    int room = roomAt(p + vec3(0.0, 0.3, 0.0));
    vec3 env = skyAt(R, 2.0) * lapGrade();
    if (room >= 0)
      env = mix(uRoomLamp[room].rgb * uRoomLamp[room].w * 0.05, env, uRoomMin[room].w);
    float glint = pow(max(dot(R, uSunDir), 0.0), 300.0) * 6.0;
    color = env * fresnel + uSunColor * glint + uTint * 0.04 * (1.0 - fresnel);
    alpha = clamp(0.38 + fresnel * 0.6, 0.0, 0.95);
  }
  else {
    Surface s;
    if (uKind == K_LIBRARY) {
      s = sampleMaterial(uLayer, uv, N, p, V, 0);
      s.albedo *= uTint;
      if (uRough > 0.0)
        s.rough = uRough;
    }
    else {
      s.normal = N;
      s.ao = 1.0;
      s.metal = 0.0;
      s.height = 0.0;
      s.rough = uRough > 0.0 ? uRough : 0.8;
      s.albedo = uTint;
      float grain = noise2(uv * 40.0);
      if (uKind == K_CARPET) {
        s.albedo *= 0.62 + 0.5 * grain + 0.12 * noise2(uv * 3.0);
        s.albedo *= 1.0 - 0.35 * step(0.5, uLap) * smoothstep(0.3, 0.8, noise2(uv * 0.4));
        s.rough = 1.0;
      }
      else if (uKind == K_CEILING) {
        float seams = grid(uv / vec2(0.6, 1.2), 0.012);
        s.albedo *= (0.9 + 0.1 * noise2(uv * 22.0)) * (1.0 - 0.45 * seams);
        s.albedo *= 1.0 - 0.4 * step(0.5, uLap) * smoothstep(0.55, 0.9, noise2(uv * 0.7));
      }
      else if (uKind == K_RUBBER) {
        s.albedo *= 0.8 + 0.3 * grain;
        s.rough = 0.75;
      }
      else
        s.albedo *= 0.9 + 0.1 * grain;
    }
    color = lit(s, p, V, 1.0);
  }
  color = fogged(color, p, vDist);
  fragColor = vec4(color, alpha);
}
`

export const flumeVert = /* glsl */`${HEAD}
layout(location = 0) in vec4 aSpine;
layout(location = 1) in vec4 aRight;
layout(location = 2) in vec4 aUp;
layout(location = 3) in vec4 aProfile;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vRidge;
out float vDist;
${WARP}

void main () {
  vec3 p = aSpine.xyz + aRight.xyz * aRight.w + aUp.xyz * aUp.w;
  vWorld = p;
  vNormal = aRight.xyz * aProfile.x + aUp.xyz * aProfile.y;
  vRidge = vec4(aSpine.w, aRight.w, aUp.w, aProfile.w);
  vDist = length(p - uEye);
  gl_Position = uViewProjection * vec4(warpWorld(p), 1.0);
}
`

export const flumeFrag = /* glsl */`${HEAD}
${MATERIAL_GLSL}
${SURFACE_GLSL}
${LIGHT}
${sections}

const float S_FLANGE = 4.0;
uniform int uPass;
uniform float uBelt;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vRidge;
in float vDist;
out vec4 fragColor;

void main () {
  vec3 p = vWorld;
  dissolve(p, vDist);
  float s = vRidge.x;
  float section = floor(vRidge.w + 0.5);
  vec2 rad = vec2(vRidge.y, vRidge.z - ${RADIUS});
  float angle = atan(rad.x, -rad.y);
  bool inner = length(rad) < ${INNER};
  bool acrylic = section == S_ACRYLIC;
  if (uPass < 2 && (uPass == 0) == acrylic)
    discard;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - p);
  if (!gl_FrontFacing)
    N = -N;

  if (uPass == 2) {
    // The water in the trough: flowing, a little ahead of the rider.
    float flow = s - uTime * (uBelt + 1.4);
    vec2 q = vec2(rad.x * 3.0, flow * 0.7);
    vec2 slope = vec2(noise2(q) - noise2(q + vec2(0.0, 0.3)), noise2(q * 1.7 + 4.0) - noise2(q * 1.7 + vec2(4.3, 4.0)));
    vec3 n = normalize(N + vec3(slope.x, 0.0, slope.y) * 0.35);
    float fresnel = 0.02 + 0.6 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 env = skyAt(reflect(-V, n), 3.5) * lapGrade() * 0.7;
    int room = roomAt(p + vec3(0.0, 0.4, 0.0));
    if (room >= 0)
      env = mix(uRoomLamp[room].rgb * uRoomLamp[room].w * 0.06, env, uRoomMin[room].w);
    float foam = smoothstep(0.75, 1.0, noise2(q * vec2(2.0, 0.6)) * 0.6 + abs(vRidge.y) * 1.1) * 0.7;
    vec3 body = vec3(0.05, 0.16, 0.17) * length(env);
    vec3 c = mix(body, env, fresnel) + vec3(0.5, 0.6, 0.6) * foam * 0.3 * length(env);
    fragColor = vec4(fogged(c, p, vDist), clamp(0.3 + fresnel * 0.6 + foam * 0.4, 0.0, 0.9));
    return;
  }

  Surface m;
  m.normal = N;
  m.ao = 1.0;
  m.metal = 0.0;
  m.height = 0.0;
  float alpha = 1.0;
  if (section == S_TILED) {
    m = sampleMaterial(MAT_TILE, vec2(angle * ${RADIUS}, s), N, p, V, 0);
    m.albedo *= inner ? vec3(0.45, 0.78, 0.8) : vec3(0.9, 0.95, 0.93);
  }
  else if (section == S_FLANGE) {
    m.albedo = vec3(0.78, 0.8, 0.8);
    m.rough = 0.4;
    float bolt = smoothstep(0.08, 0.04, abs(fract(angle * 3.0) - 0.5));
    m.albedo *= 1.0 - bolt * 0.6;
  }
  else if (section == S_BELT && inner && abs(angle) < 0.75) {
    float cleat = smoothstep(0.42, 0.46, abs(fract((s - uTime * uBelt) / 0.55) - 0.5));
    m.albedo = vec3(0.05, 0.052, 0.055) * (0.8 + 0.4 * noise2(vec2(angle * 30.0, s * 30.0))) + cleat * 0.04;
    m.rough = 0.8 - cleat * 0.3;
  }
  else if (acrylic) {
    float fresnel = 0.05 + 0.95 * pow(1.0 - abs(dot(N, V)), 4.0);
    vec3 env = mix(skyAt(reflect(-V, N), 2.0) * 0.5, DEEP * 1.5, smoothstep(0.4, -0.4, p.y)) * lapGrade();
    float scratch = noise2(vec2(angle * 80.0, s * 0.8)) * noise2(vec2(angle * 6.0, s * 9.0));
    float ring = smoothstep(0.47, 0.49, abs(fract(s / ${PITCH}) - 0.5));
    vec3 c = env * fresnel + vec3(0.6, 0.8, 0.85) * scratch * 0.08 + vec3(0.7) * ring * 0.2;
    float near = smoothstep(0.7, 3.0, vDist);
    fragColor = vec4(fogged(c, p, vDist), clamp(0.03 + (fresnel * 0.22 + scratch * 0.12) * near + ring * 0.5, 0.0, 0.7));
    return;
  }
  else {
    // Gelcoat: aqua inside, white out, with the panel joints, limescale where
    // the water runs and the scuffs of every rider before.
    m.albedo = inner ? vec3(0.32, 0.62, 0.68) : vec3(0.78, 0.8, 0.78);
    m.rough = inner ? 0.5 : 0.55;
    // Hand-laid gelcoat is never flat: a slow waviness breaks the highlight.
    vec2 wave = vec2(noise2(vec2(angle * 4.0, s * 0.9)), noise2(vec2(angle * 4.0 + 7.0, s * 0.9))) - 0.5;
    m.normal = normalize(N + vec3(wave.x, 0.0, wave.y) * 0.12);
    float joint = smoothstep(0.488, 0.497, abs(fract(s / ${PITCH}) - 0.5));
    float wet = inner ? smoothstep(0.75, 0.2, abs(angle)) : 0.0;
    float scale = noise2(vec2(angle * 9.0, s * 0.7)) * noise2(vec2(angle * 2.0, s * 3.0));
    float scuff = smoothstep(0.55, 0.8, noise2(vec2(angle * 14.0, s * 2.3)));
    m.albedo *= (1.0 - joint * 0.5) * (1.0 - 0.18 * scuff);
    m.albedo = mix(m.albedo, vec3(0.62, 0.6, 0.52), wet * scale * 0.55);
    m.albedo = mix(m.albedo, m.albedo * vec3(0.7, 0.66, 0.6), (1.0 - wet) * 0.25 * noise2(vec2(angle * 3.0, s * 0.2)));
    m.rough = mix(m.rough, 0.6, scuff * 0.5);
    if (section == S_BELT)
      m.albedo = mix(vec3(0.55, 0.56, 0.55), m.albedo, 0.3);
  }
  vec3 c = lit(m, p, V, inner ? 0.75 : 1.0);
  fragColor = vec4(fogged(c, p, vDist), alpha);
}
`

const GERSTNER = /* glsl */`
uniform float uSwell;

// Eight swells, long to short, from the south-west. Amplitude by steepness,
// speed by deep-water dispersion. Returns displacement; normal by out.
vec3 sea (vec2 p, float dist, out vec3 normal) {
  vec3 offset = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float t = uTime;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float lambda = 64.0 * pow(0.7, fi);
    float k = 6.2831853 / lambda;
    float a = 0.13 * fi * 1.7 + 0.4 + sin(fi * 2.3) * 0.5;
    vec2 dir = normalize(vec2(cos(a + 3.6), sin(a + 3.6)));
    float amp = lambda * 0.012 * uSwell * (1.0 - smoothstep(lambda * 6.0, lambda * 24.0, dist));
    float w = sqrt(9.81 * k);
    float phase = k * dot(dir, p) - w * t + fi * 1.7;
    float c = cos(phase);
    float s = sin(phase);
    float q = 0.55 / (k * max(amp, 1e-4) * 8.0);
    q = min(q, 1.0);
    offset += vec3(dir.x * q * amp * c, amp * s, dir.y * q * amp * c);
    n -= vec3(dir.x * k * amp * c, q * k * amp * s, dir.y * k * amp * c);
  }
  normal = normalize(n);
  return offset;
}
`

export const seaVert = /* glsl */`${HEAD}
layout(location = 0) in vec3 aPosition;
out vec3 vWorld;
out vec3 vNormal;
out float vDist;
out float vCrest;
${WARP}
${GERSTNER}

void main () {
  vec2 base = aPosition.xz;
  float dist = length(base - uEye.xz);
  vec3 n;
  vec3 offset = sea(base, dist, n);
  vec3 p = vec3(base.x + offset.x, offset.y, base.y + offset.z);
  vWorld = p;
  vNormal = n;
  vDist = length(p - uEye);
  vCrest = offset.y / max(uSwell, 0.2);
  gl_Position = uViewProjection * vec4(warpWorld(p), 1.0);
}
`

export const seaFrag = /* glsl */`${HEAD}
${MATERIAL_GLSL}
${SURFACE_GLSL}
${LIGHT}
in vec3 vWorld;
in vec3 vNormal;
in float vDist;
in float vCrest;
uniform highp sampler2D uClear;
uniform vec4 uClearMap;
out vec4 fragColor;

void main () {
  vec3 p = vWorld;
  // Never inside the flume: the trough and the tube are always clear of the sea.
  ivec2 cell = ivec2(floor((p.xz - uClearMap.xy) * uClearMap.z));
  ivec2 size = textureSize(uClear, 0);
  if (all(greaterThanEqual(cell, ivec2(0))) && all(lessThan(cell, size))) {
    vec2 clear = texelFetch(uClear, cell, 0).rg;
    if (p.y > clear.x && p.y < clear.y)
      discard;
  }
  vec3 V = normalize(uEye - p);
  float detail = 1.0 - smoothstep(30.0, 260.0, vDist);
  vec2 q = p.xz * 0.45;
  vec2 ripple = vec2(noise2(q + uTime * 0.5) - noise2(q + vec2(0.6, uTime * 0.5)),
    noise2(q * 1.7 - uTime * 0.4) - noise2(q * 1.7 + vec2(0.0, 0.6) - uTime * 0.4));
  vec3 N = normalize(vNormal + vec3(ripple.x, 0.0, ripple.y) * 0.45 * detail);
  vec3 color;
  if (!gl_FrontFacing && uEye.y < p.y) {
    // From below: the bright window overhead, mirror-dark outside it.
    float up = -V.y;
    float window = smoothstep(0.6, 0.72, up);
    vec3 bent = refract(-V, -N, 1.33);
    vec3 through = dot(bent, bent) > 1e-4 ? skyAt(normalize(bent), 2.0) * 0.55 : DEEP;
    color = mix(DEEP * 1.6, through, window) * lapGrade();
  }
  else {
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = skyAt(R, 0.5) * lapGrade();
    float glint = pow(max(dot(R, uSunDir), 0.0), 500.0) * 30.0 * detail;
    vec3 body = DEEP * skyIrradiance(uSky, vec3(0.0, 1.0, 0.0), uSkyYaw, uSkyExposure) * 2.2 * lapGrade();
    body += vec3(0.02, 0.09, 0.08) * smoothstep(0.2, 1.2, vCrest) * max(dot(uSunDir, -V) + 0.4, 0.0);
    float torn = noise2(p.xz * 0.12 + vec2(uTime * 0.3, -uTime * 0.2)) * 0.6 + noise2(p.xz * 0.9 - uTime * 0.3) * 0.4 * detail;
    float foam = smoothstep(0.85, 1.35, vCrest + torn * 0.7) * smoothstep(0.3, 0.6, torn);
    color = body * (1.0 - fresnel) + sky * fresnel + uSunColor * glint * lapGrade();
    color = mix(color, skyIrradiance(uSky, vec3(0.0, 1.0, 0.0), uSkyYaw, uSkyExposure) * 0.85 * lapGrade(), foam * 0.85);
  }
  fragColor = vec4(fogged(color, p, vDist), 1.0);
}
`

export const skyFrag = /* glsl */`${HEAD}
${MATERIAL_GLSL}
${SURFACE_GLSL}
${LIGHT}
uniform mat4 uInverse;
uniform vec2 uResolution;
out vec4 fragColor;

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 far = uInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(far.xyz / far.w - uEye);
  vec3 color = skyTexel(uSky, ray, uSkyYaw);
  color = skyRadiance(color, uSkyExposure) * lapGrade();
  color = mix(hazeAt(ray), color, smoothstep(-0.02, 0.22, ray.y));
  // Under the surface only the gap at the horizon reaches the sky pass; it is
  // water all the way out there.
  color = mix(color, DEEP * 0.7 * lapGrade(), smoothstep(0.0, -0.6, uEye.y));
  fragColor = vec4(color, 1.0);
}
`

/** Bloom: a soft-knee bright pass into the first level, then box halvings. */
export const downFrag = /* glsl */`${HEAD}
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform vec2 uOut;
uniform float uKnee;
out vec4 fragColor;

void main () {
  vec2 uv = gl_FragCoord.xy * uOut;
  vec2 o = uTexel * 0.5;
  vec3 c = (texture(uSource, uv + vec2(-o.x, -o.y)).rgb + texture(uSource, uv + vec2(o.x, -o.y)).rgb
    + texture(uSource, uv + vec2(-o.x, o.y)).rgb + texture(uSource, uv + vec2(o.x, o.y)).rgb) * 0.25;
  if (uKnee > 0.0) {
    // Nothing non-finite may enter the pyramid: one bad pixel blooms a disc.
    if (any(isnan(c)) || any(isinf(c)))
      c = vec3(0.0);
    c = clamp(c, vec3(0.0), vec3(64.0));
    float b = max(c.r, max(c.g, c.b));
    c *= smoothstep(uKnee, uKnee * 2.5, b);
  }
  fragColor = vec4(c, 1.0);
}
`

export const upFrag = /* glsl */`${HEAD}
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform vec2 uOut;
out vec4 fragColor;

void main () {
  vec2 uv = gl_FragCoord.xy * uOut;
  vec2 o = uTexel;
  vec3 c = texture(uSource, uv).rgb * 4.0;
  c += (texture(uSource, uv + vec2(o.x, 0.0)).rgb + texture(uSource, uv - vec2(o.x, 0.0)).rgb
    + texture(uSource, uv + vec2(0.0, o.y)).rgb + texture(uSource, uv - vec2(0.0, o.y)).rgb) * 2.0;
  c += texture(uSource, uv + o).rgb + texture(uSource, uv - o).rgb
    + texture(uSource, uv + vec2(o.x, -o.y)).rgb + texture(uSource, uv + vec2(-o.x, o.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}
`

/** The film: exposure, bloom, ACES, and what the warp does to the picture. */
export const compositeFrag = /* glsl */`${HEAD}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uWarp;
uniform float uTime;
out vec4 fragColor;
${ACES}

vec3 tap (vec2 uv) {
  vec3 c = texture(uScene, uv).rgb;
  if (any(isnan(c)) || any(isinf(c)))
    c = vec3(0.0);
  return clamp(c, vec3(0.0), vec3(64.0)) + texture(uBloom, uv).rgb * 0.22;
}

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float w = uWarp;
  vec2 bent = 0.5 + c * (1.0 + w * 0.22 * r2 * (1.0 + 0.5 * sin(uTime * 0.31)));
  vec2 split = c * w * 0.012 * (1.0 + r2 * 4.0);
  vec3 color = vec3(tap(bent + split).r, tap(bent).g, tap(bent - split).b);
  vec2 ghost = vec2(sin(uTime * 0.23), cos(uTime * 0.17)) * 0.035 * w;
  color = mix(color, tap(bent + ghost) * vec3(0.9, 1.0, 1.08), clamp(w * 0.32, 0.0, 0.45));
  color *= uExposure;
  color = aces(color);
  color *= 1.0 - smoothstep(0.18, 0.62, r2) * (0.32 + 0.25 * w);
  float grain = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * 0.018;
  fragColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`
