// The room the index lives in: a beige CRT on a low cabinet, in the dark, in
// front of a wall of dead machines whose screens still glow green with the
// ends of words. The tube shows whichever journey it is tuned to (uScreen, a
// preview rendered into a texture each frame), lights the room with it, and
// the wet floor gives it all back.
//
// One raymarch, GLSL ES 1.00 (the previews share the context and are 1.00).
// The camera constants live in ./crtRoom.ts too: the HTML over the tube face is
// placed by projecting the same rectangle with the same camera.

import { HASH12 } from '@wjh/glsl/hash'


export const ROOM_FRAG = /* glsl */`
precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform sampler2D uScreen;   // the channel
uniform sampler2D uGlyphs;   // 4×4 atlas of word ends for the dead monitors
uniform float uStatic;       // 0..1 snow, on a channel change
uniform float uMenu;         // 0..1 the picture dims under the menu
uniform float uZoom;         // 0..1 the dolly into the tube
uniform float uGlitch;       // 0..1 the picture failing on the way in
uniform float uCamDist;      // set back far enough that the set fits the frame
uniform vec3  uGlow;         // the picture's average colour: the light it casts

#define SCREEN_C vec3(0.0, 0.70, -0.335)
#define SCREEN_H vec2(0.30, 0.225)
#define CAM_TARGET vec3(0.0, 0.86, 0.0)
#define CAM_HEIGHT 0.95
#define FOCAL 1.65

#define M_FLOOR  1.0
#define M_WALL   2.0
#define M_TV     3.0
#define M_TUBE   4.0
#define M_CASE   5.0
#define M_MON    6.0
#define M_DESK   7.0
#define M_KNOB   8.0

${HASH12}

float sdBox (vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox (vec3 p, vec3 b, float r) {
  return sdBox(p, b - r) - r;
}

vec2 opU (vec2 a, vec2 b) {
  return a.x < b.x ? a : b;
}

// The set: a cabinet, the TV on it, the tube's face slightly proud of a
// recessed bezel, two knobs under the picture.
vec2 tvSet (vec3 p) {
  vec2 r = vec2(sdRoundBox(p - vec3(0.0, 0.17, 0.05), vec3(0.62, 0.17, 0.42), 0.015), M_DESK);

  vec3 q      = p - vec3(0.0, 0.66, 0.0);
  float body  = sdRoundBox(q, vec3(0.44, 0.32, 0.34), 0.045);
  float rear  = sdRoundBox(q - vec3(0.0, 0.02, 0.36), vec3(0.30, 0.22, 0.16), 0.07);
  vec3 s      = p - SCREEN_C;
  float bezel = sdBox(s - vec3(0.0, 0.0, -0.01), vec3(SCREEN_H + 0.025, 0.04));
  r = opU(r, vec2(max(min(body, rear), -bezel), M_TV));

  vec2 a      = s.xy / SCREEN_H;
  float bulge = 0.028 * (1.0 - 0.5 * dot(a, a));
  r = opU(r, vec2(sdBox(s + vec3(0.0, 0.0, bulge), vec3(SCREEN_H, 0.012)), M_TUBE));

  vec3 k = p - vec3(0.30, 0.405, -0.345);
  k.x    = abs(k.x - 0.06) - 0.04;
  r = opU(r, vec2(length(vec2(length(k.xy) - 0.012, k.z)) - 0.012, M_KNOB));
  return r;
}

// One cell of the wall of machines behind the set: a monitor or a case, its
// depth and size jittered, a few cells left empty.
vec3 cellBox (vec2 id) {
  float h = hash12(id);
  return hash12(id + 7.3) < 0.55
    ? vec3(0.38 + 0.04 * h, 0.29 + 0.03 * h, 0.36)
    : vec3(0.40, 0.28 + 0.05 * h, 0.40 + 0.1 * h);
}

vec3 cellCentre (vec2 id) {
  vec2 c = (id + 0.5) * vec2(0.92, 0.72);
  return vec3(c.x, c.y, 1.7 + 1.1 * hash12(id + 1.9) + 0.18 * abs(id.x));
}

vec2 stackCell (vec3 p, vec2 id) {
  if (id.y < 0.0 || id.y > 4.0 || abs(id.x + 0.5) > 6.0 || hash12(id + 3.1) > 0.86)
    return vec2(1e3, M_CASE);
  return vec2(sdRoundBox(p - cellCentre(id), cellBox(id), 0.02), hash12(id + 7.3) < 0.55 ? M_MON : M_CASE);
}

vec2 stack (vec3 p) {
  vec2 id = floor(p.xy / vec2(0.92, 0.72));
  vec2 r  = stackCell(p, id);
  r = opU(r, stackCell(p, id + vec2(1.0, 0.0)));
  r = opU(r, stackCell(p, id - vec2(1.0, 0.0)));
  return opU(r, stackCell(p, id - vec2(0.0, 1.0)));
}

// A tower and a monitor flanking the set, on the floor.
vec2 flanks (vec3 p) {
  vec2 r = vec2(sdRoundBox(p - vec3(-1.02, 0.46, 0.25), vec3(0.21, 0.46, 0.44), 0.02), M_CASE);
  r = opU(r, vec2(sdRoundBox(p - vec3(1.12, 0.22, 0.3), vec3(0.36, 0.22, 0.38), 0.02), M_CASE));
  return opU(r, vec2(sdRoundBox(p - vec3(1.1, 0.72, 0.36), vec3(0.34, 0.27, 0.32), 0.03), M_MON));
}

vec2 map (vec3 p) {
  vec2 r = vec2(p.y, M_FLOOR);
  r = opU(r, vec2(4.6 - p.z, M_WALL));
  r = opU(r, tvSet(p));
  r = opU(r, flanks(p));
  return opU(r, stack(p));
}

vec2 march (vec3 ro, vec3 rd, float far) {
  float t = 0.0;
  float m = 0.0;
  for (int i = 0; i < 80; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0015 * t || t > far) {
      m = h.y;
      break;
    }
    t += h.x * 0.85;
  }
  return vec2(t, t > far ? 0.0 : m);
}

vec3 normalAt (vec3 p) {
  vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                   e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float occlusion (vec3 p, vec3 n) {
  float o = 0.0;
  for (int i = 1; i <= 3; i++) {
    float h = 0.06 * float(i);
    o += (h - map(p + n * h).x) / float(i);
  }
  return clamp(1.0 - 3.0 * o, 0.0, 1.0);
}

// --- the picture ----------------------------------------------------------------

vec3 picture (vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  c     *= 1.0 + 0.07 * dot(c, c);
  uv     = c * 0.5 + 0.5;
  if (abs(c.x) > 1.0 || abs(c.y) > 1.0)
    return vec3(0.0);

  // On the way in the signal fails the way the title cards do: bands slide,
  // channels part, 8×8 blocks lose their residuals, whole rows drop out.
  float g     = uGlitch;
  float frame = floor(iTime * 24.0);
  float band  = floor(uv.y * 30.0);
  if (hash12(vec2(band, frame + 1.7)) < g * 0.8)
    uv.x += (hash12(vec2(band, frame)) - 0.5) * 0.3 * g;
  vec2 blk    = floor(uv * vec2(48.0, 36.0));
  float bad   = step(1.0 - g * 0.55, hash12(blk + frame));
  uv          = mix(uv, (blk + 0.5) / vec2(48.0, 36.0) + (hash12(blk * 1.7) - 0.5) * 0.08, bad);
  float split = 0.002 + 0.03 * g;
  vec3 col    = vec3(texture2D(uScreen, uv + vec2(split, 0.0)).r,
                     texture2D(uScreen, uv).g,
                     texture2D(uScreen, uv - vec2(split, 0.0)).b);
  col = mix(col, col.gbr * 1.5, bad);
  col *= 1.0 - step(1.0 - g * 0.4, hash12(vec2(band * 3.1, frame)));

  float snow = hash12(floor(uv * vec2(320.0, 240.0)) + frame * 17.0);
  col = mix(col, vec3(snow) * vec3(0.9, 0.95, 1.0), clamp(uStatic, 0.0, 1.0));

  col *= 0.78 + 0.22 * sin(uv.y * 240.0 * 3.14159);
  col *= 0.92 + 0.08 * sin(gl_FragCoord.x * 2.094);
  col *= 1.0 - 0.72 * uMenu;
  return col * smoothstep(1.35, 0.4, length(c)) * 1.35;
}

// --- light ------------------------------------------------------------------------

// The dead monitors' faces: the ends of words, green, flickering a little.
vec3 glyphScreen (vec3 p, vec3 centre, vec3 box, vec2 id) {
  vec2 a = (p.xy - centre.xy) / (box.xy - vec2(0.07, 0.07));
  if (abs(a.x) > 1.0 || abs(a.y - 0.08) > 1.0 || p.z > centre.z - box.z + 0.01)
    return vec3(0.0);
  float cell  = floor(hash12(id + 11.0) * 16.0);
  vec2 uv     = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + a * 0.5 + 0.5) / 4.0;
  float ink   = texture2D(uGlyphs, vec2(uv.x, 1.0 - uv.y)).r;
  float alive = step(0.25, hash12(id + 5.5)) * (0.85 + 0.15 * sin(iTime * (2.0 + 3.0 * hash12(id)) + id.x));
  return vec3(0.25, 1.0, 0.72) * (0.05 + ink * 1.6) * alive;
}

vec3 emission (vec3 p, float m) {
  if (m == M_TUBE)
    return picture((p.xy - SCREEN_C.xy) / (2.0 * SCREEN_H) + 0.5);
  if (m != M_MON)
    return vec3(0.0);
  if (p.x > 0.7 && p.z < 0.8)
    return glyphScreen(p, vec3(1.1, 0.72, 0.36), vec3(0.34, 0.27, 0.32), vec2(9.0, 9.0));
  vec2 id = floor(p.xy / vec2(0.92, 0.72));
  return glyphScreen(p, cellCentre(id), cellBox(id), id);
}

vec3 albedo (vec3 p, float m) {
  if (m == M_FLOOR) return vec3(0.025);
  if (m == M_WALL)  return vec3(0.03, 0.032, 0.035);
  if (m == M_DESK)  return vec3(0.09, 0.055, 0.035);
  if (m == M_KNOB)  return vec3(0.05);
  float grime = 0.85 + 0.15 * hash12(floor(p.xy * 40.0));
  return vec3(0.42, 0.40, 0.36) * grime;
}

vec3 lightAt (vec3 p, vec3 n) {
  // The picture, as a soft light from the tube's face.
  vec3 l     = SCREEN_C - vec3(0.0, 0.0, 0.08) - p;
  float d2   = dot(l, l);
  l         *= inversesqrt(d2);
  float face = smoothstep(-0.1, 0.4, -l.z);
  vec3 c     = uGlow * max(dot(n, l), 0.0) * face * 2.4 / (1.0 + 2.2 * d2);

  // The wall of screens behind: a broad green spill.
  vec3 w = normalize(vec3(0.0, 1.2, 2.3) - p);
  c += vec3(0.06, 0.32, 0.22) * max(dot(n, w), 0.0) / (1.0 + 0.25 * dot(p.xz, p.xz));

  // And a cold nothing from above.
  return c + vec3(0.012, 0.014, 0.02) * (0.6 + 0.4 * n.y);
}

vec3 shade (vec3 p, vec3 rd, vec2 h) {
  vec3 n   = normalAt(p);
  vec3 col = albedo(p, h.y) * lightAt(p, n) * occlusion(p, n) + emission(p, h.y);
  if (h.y == M_TUBE)
    col += pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * 0.08;
  return col;
}

vec3 camera (out vec3 ro) {
  vec3 near = SCREEN_C - vec3(0.0, 0.0, 0.42);
  float z   = smoothstep(0.0, 1.0, uZoom);
  ro        = mix(vec3(0.0, CAM_HEIGHT, -uCamDist), near, z);
  vec3 ta   = mix(CAM_TARGET, SCREEN_C, z);
  vec3 cw   = normalize(ta - ro);
  vec3 cu   = normalize(cross(vec3(0.0, 1.0, 0.0), cw));
  vec3 cv   = cross(cw, cu);
  vec2 uv   = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
  return normalize(uv.x * cu + uv.y * cv + FOCAL * cw);
}

void main () {
  vec3 ro;
  vec3 rd  = camera(ro);
  vec2 h   = march(ro, rd, 14.0);
  vec3 col = vec3(0.0);
  if (h.y > 0.0) {
    vec3 p = ro + rd * h.x;
    col    = shade(p, rd, h);

    // The floor is wet: it gives the screens back, smeared by its puddles.
    if (h.y == M_FLOOR) {
      vec3 rr  = normalize(reflect(rd, vec3(0.0, 1.0, 0.0)) + vec3(hash12(p.xz * 30.0) - 0.5, 0.0, 0.0) * 0.02);
      vec2 r   = march(p + vec3(0.0, 0.002, 0.0), rr, 8.0);
      float fr = 0.25 + 0.6 * pow(1.0 - max(rr.y, 0.0), 4.0);
      if (r.y > 0.0) {
        vec3 q = p + rr * r.x;
        col += (emission(q, r.y) + albedo(q, r.y) * lightAt(q, normalAt(q))) * fr * exp(-0.35 * r.x);
      }
    }
    col = mix(col, vec3(0.004, 0.006, 0.008), 1.0 - exp(-0.04 * h.x * h.x));
  }

  vec2 v = gl_FragCoord.xy / iResolution - 0.5;
  col *= 1.0 - 0.9 * dot(v, v) * (1.0 - uZoom);
  col += (hash12(gl_FragCoord.xy + fract(iTime) * 97.0) - 0.5) * 0.02;
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`
