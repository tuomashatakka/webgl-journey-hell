// THE FOUNDRY — a simulated descent down a machine shaft.
//
// Companion piece to THE LIMINAL JOURNEY: the same first-person plunge into the
// dark, but the abyss is replaced by machinery, and the motion is not authored.
// Every moving thing in this shader is positioned by uniforms produced by the
// rigid-body integrator in physics.ts — cage height, velocity and acceleration,
// six tumbling debris bodies (position + orientation quaternion), the exact
// slider-crank piston extension, and a pendulum hook swung by the cage's own
// acceleration. The shader draws state; it does not invent motion.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00 — no
// bitwise ops, constant loop bounds only. Uniforms beyond the shared set:
//   uCage    = (floorY, velocity, acceleration, phase)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, hookAngle, flywheelOmega)
//   uDebris  = 6 x (worldX, worldY, worldZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion (x, y, z, w)

const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (steam volumetrics, extra sparks)

  uniform vec4 uCage;          // floorY, velocity, acceleration, phase
  uniform vec4 uSim;           // shakeX, shakeY, brakeSpark, cableIntact
  uniform vec4 uMech;          // crank, pistonExtension, hookAngle, flywheelOmega
  uniform vec4 uDebris[6];     // xyz = world position, w = half-extent scale
  uniform vec4 uDebrisQ[6];    // orientation quaternion

  const float PI = 3.14159265359;
  const float SHAFT_R = 4.6;     // shaft half-width (square section)
  const float CAGE_R = 1.5;      // cage interior half-width — mirrors physics.ts
  const float CAGE_H = 2.6;
  const float EYE = 1.62;        // eye height above the cage floor
  const float RIB_SP = 3.0;      // structural rib spacing
  const float LAMP_SP = 6.0;     // caged wall lamp spacing
  const float PIST_SP = 24.0;    // piston station spacing
  const float FLOOR_Y = -232.0;  // hydraulic buffer floor — mirrors physics.ts

  // Material/look state written by the SDF at the nearest hit.
  float gMat;      // 0 shaft steel, 1 cage frame, 2 debris, 3 chrome, 4 lamp, 5 rail
  float gWear;     // 0..1 rust/paint-chip weight
  float gGlow;     // emissive weight

  // --- hash / noise --------------------------------------------------------
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < FBM_OCTAVES; i++) { s += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
    return s;
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // Rotate v by quaternion q / by its inverse. Used to bring a world-space
  // sample point into each debris body's local frame.
  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  vec3 qinv(vec4 q, vec3 v) { return qrot(vec4(-q.xyz, q.w), v); }

  // --- SDF primitives ------------------------------------------------------
  float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
  float sdCylY(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdCylX(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.yz) - r, abs(p.x) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  float sdTorusX(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.yz) - R, p.x);
    return length(q) - r;
  }

  // --- convenience ---------------------------------------------------------
  float cageY() { return uCage.x; }
  float cageV() { return uCage.y; }
  float cageA() { return uCage.z; }
  float phase() { return uCage.w; }
  float spark() { return uSim.z; }
  // Free fall reads as weightlessness: the cage's acceleration approaches -g.
  float weightless() { return smoothstep(-6.0, -9.2, cageA()); }

  // ============================ GEOMETRY ===================================

  // Shaft: a square steel well, ribbed every RIB_SP, with two guide rails the
  // brake shoes clamp. Positive inside.
  float mapShaft(vec3 p, out float mat, out float wear) {
    mat = 0.0;
    float d = SHAFT_R - max(abs(p.x), abs(p.z));

    // Inward-protruding structural ribs.
    float ry = abs(mod(p.y + RIB_SP * 0.5, RIB_SP) - RIB_SP * 0.5);
    d -= smoothstep(0.30, 0.0, ry) * 0.26;

    // Rivet dimples along each rib — pure surface detail, so only bias the
    // distance slightly rather than building real geometry.
    float rv = hash21(floor(vec2(p.x * 3.0 + p.z * 7.0, p.y * 2.0)));
    d -= smoothstep(0.16, 0.0, ry) * rv * 0.02;

    wear = fbm(vec2(p.x * 1.3 + p.z * 2.1, p.y * 0.55));

    // Guide rails: T-section runners on the +x/-x walls at z = 0.
    vec3 rp = vec3(abs(p.x) - (SHAFT_R - 0.34), p.y, p.z);
    float rail = sdBox(vec3(rp.x, 0.0, rp.z), vec3(0.30, 1.0, 0.13));
    if (rail < d) { d = rail; mat = 5.0; wear = 0.15; }

    return d;
  }

  // Caged wall lamps every LAMP_SP, staggered left/right.
  float mapLamps(vec3 p, out float glow) {
    float band = floor(p.y / LAMP_SP);
    float ly = p.y - (band + 0.5) * LAMP_SP;
    float side = mod(band, 2.0) * 2.0 - 1.0;
    vec3 lp = vec3(p.x - side * (SHAFT_R - 0.25), ly, p.z - 0.0);
    float bulb = sdCylX(lp, 0.17, 0.14);
    // Cage bars over the bulb, so the light throws a striped shadow pattern.
    float bars = abs(mod(atan(lp.z, lp.y) * 3.0 / PI + 0.5, 1.0) - 0.5) - 0.16;
    glow = 1.0 - smoothstep(0.0, 0.02, max(bulb, -bars - 0.4));
    return bulb;
  }

  // Piston stations: a flywheel on the wall driving a horizontal ram whose
  // extension is the exact slider-crank displacement computed on the CPU.
  float mapPistons(vec3 p, out float mat) {
    mat = 3.0;
    float station = floor(p.y / PIST_SP);
    float py = p.y - (station + 0.5) * PIST_SP;
    float side = mod(station, 2.0) * 2.0 - 1.0;
    float wallX = side * SHAFT_R;

    // Phase-offset each station so the gallery pulses as a wave, not in unison.
    float ext = uMech.y + 0.18 * sin(uMech.x + station * 1.7);

    vec3 lp = vec3((p.x - wallX) * -side, py, p.z);
    float body = sdCylX(lp - vec3(0.55, 0.0, 0.0), 0.42, 0.55);
    float rod = sdCylX(lp - vec3(0.55 + ext * 0.5, 0.0, 0.0), 0.13, ext * 0.5 + 0.2);
    float head = sdCylX(lp - vec3(0.55 + ext + 0.1, 0.0, 0.0), 0.30, 0.09);

    // Flywheel + crank pin, spun by the integrated angular velocity.
    vec3 fp = lp - vec3(0.16, 0.0, 1.35);
    float wheel = sdTorusX(fp, 0.66, 0.10);
    vec3 cp = fp;
    cp.yz = rot(uMech.x) * cp.yz;
    float pin = sdCylX(cp - vec3(0.0, 0.52, 0.0), 0.07, 0.16);

    return min(min(body, min(rod, head)), min(wheel, pin));
  }

  // The cage: corner posts, floor slab, roof, and a woven grating skin.
  float mapCage(vec3 p, out float mat) {
    mat = 1.0;
    float base = cageY();
    vec3 c = vec3(p.x, p.y - base, p.z);

    float posts = sdBox(vec3(abs(c.x) - CAGE_R, c.y - CAGE_H * 0.5, abs(c.z) - CAGE_R),
                        vec3(0.075, CAGE_H * 0.5, 0.075));
    // Open mesh floor — you ride down looking through your own feet at the
    // shaft below, which is the whole point of the descent.
    float floorPlate = sdBox(c - vec3(0.0, -0.04, 0.0), vec3(CAGE_R, 0.035, CAGE_R));
    float fbarX = abs(mod(c.x + 0.11, 0.22) - 0.11) - 0.012;
    float fbarZ = abs(mod(c.z + 0.11, 0.22) - 0.11) - 0.012;
    float floorSlab = max(floorPlate, min(fbarX, fbarZ));
    float roof = sdBox(c - vec3(0.0, CAGE_H, 0.0), vec3(CAGE_R + 0.06, 0.06, CAGE_R + 0.06));

    // Woven grating, but only on the two side panels — the front and back faces
    // are open gates. A fully enclosed cage puts a mesh wall across the entire
    // frame and the shaft behind it becomes unreadable.
    float slab = max(c.y - CAGE_H, -c.y);            // clip to cage height
    float ring = abs(abs(c.x) - CAGE_R) - 0.016;
    float vbar = abs(mod(c.z + 0.08, 0.16) - 0.08) - 0.013;
    float hbar = abs(mod(c.y + 0.1, 0.2) - 0.1) - 0.013;
    float grate = max(max(ring, min(vbar, hbar)), max(slab, abs(c.z) - CAGE_R));

    // Waist-height safety rails across the open faces, so they still read as
    // "enclosed" without blocking the view.
    float rails = sdBox(vec3(c.x, abs(c.y - 1.05) - 0.42, abs(c.z) - CAGE_R),
                        vec3(CAGE_R, 0.035, 0.035));

    float d = min(min(posts, floorSlab), min(roof, min(grate, rails)));

    // Hanging hook on a chain, swinging by the integrated pendulum angle.
    float ha = uMech.z;
    vec2 hd = vec2(sin(ha), -cos(ha)) * 1.35;
    vec3 anchor = vec3(0.75, CAGE_H - 0.06, -0.55);
    vec3 tip = anchor + vec3(hd.x, hd.y, 0.0);
    vec3 ab = tip - anchor;
    vec3 ap = c - anchor;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    float chain = length(ap - ab * t) - 0.028;
    float hook = sdTorusX(c - tip - vec3(0.0, -0.12, 0.0), 0.11, 0.035);
    if (min(chain, hook) < d) { d = min(chain, hook); mat = 5.0; }

    return d;
  }

  // Six free rigid bodies, each transformed into its own frame by the
  // orientation quaternion the integrator produced.
  float mapDebris(vec3 p) {
    float d = 1e9;
    for (int i = 0; i < 6; i++) {
      vec3 ctr = uDebris[i].xyz;
      float s = uDebris[i].w;
      // Cheap bounding-sphere reject keeps the per-step cost near zero when the
      // body is far from the ray. The radius must be the box's *circumradius*
      // (|(0.55, 0.32, 0.42)| ≈ 0.766) — a tighter sphere would over-estimate
      // the distance and the march would step straight through corners.
      float bound = length(p - ctr) - s * 0.78;
      if (bound < 0.6) {
        vec3 q = qinv(uDebrisQ[i], p - ctr);
        d = min(d, sdBox(q, vec3(0.55, 0.32, 0.42) * s));
      } else {
        d = min(d, bound);
      }
    }
    return d;
  }

  // Hoist cables above the cage — present only while the cable is intact.
  float mapCables(vec3 p) {
    if (uSim.w < 0.5) return 1e9;
    if (p.y < cageY() + CAGE_H) return 1e9;
    vec2 off = abs(p.xz) - vec2(0.42, 0.42);
    return length(max(off, 0.0)) + min(max(off.x, off.y), 0.0) - 0.035;
  }

  float mapScene(vec3 p) {
    float mat, wear, glow;
    float d = mapShaft(p, mat, wear);
    gMat = mat; gWear = wear; gGlow = 0.0;

    float pm;
    float pist = mapPistons(p, pm);
    if (pist < d) { d = pist; gMat = pm; gWear = 0.1; }

    float cm;
    float cage = mapCage(p, cm);
    if (cage < d) { d = cage; gMat = cm; gWear = 0.55; }

    float deb = mapDebris(p);
    if (deb < d) { d = deb; gMat = 2.0; gWear = 0.75; }

    float cab = mapCables(p);
    if (cab < d) { d = cab; gMat = 5.0; gWear = 0.3; }

    float lg;
    float lamp = mapLamps(p, lg);
    if (lamp < d) { d = lamp; gMat = 4.0; gGlow = 1.0; }

    // Hydraulic buffer floor at the bottom of the shaft.
    float bed = p.y - FLOOR_Y + 0.4;
    if (bed < d) { d = bed; gMat = 0.0; gWear = 0.18; }

    return d;
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy) - mapScene(p - e.xyy),
      mapScene(p + e.yxy) - mapScene(p - e.yxy),
      mapScene(p + e.yyx) - mapScene(p - e.yyx)));
  }

  // ============================ SHADING ====================================

  // Nearest two lamps dominate; approximating the strip as a pair of point
  // lights is far cheaper than iterating the whole shaft and is visually
  // indistinguishable at this fog density.
  vec3 lampLight(vec3 p, vec3 n, vec3 albedo, float rough, vec3 rd) {
    vec3 acc = vec3(0.0);
    float band = floor(p.y / LAMP_SP);
    for (int k = 0; k < 2; k++) {
      float b = band + float(k);
      float side = mod(b, 2.0) * 2.0 - 1.0;
      vec3 lp = vec3(side * (SHAFT_R - 0.25), (b + 0.5) * LAMP_SP, 0.0);
      vec3 ld = lp - p;
      float dist = length(ld);
      ld /= max(dist, 0.001);
      float atten = 1.0 / (1.0 + dist * dist * 0.022);
      // Half-lambert: real shafts are full of bounce light off the plate, and a
      // hard terminator here just crushes everything to black.
      float diff = dot(n, ld) * 0.5 + 0.5;
      diff *= diff;
      float spec = pow(max(dot(reflect(-ld, n), -rd), 0.0), mix(90.0, 8.0, rough));
      acc += (albedo * diff + spec * (1.0 - rough) * 0.32) * atten * vec3(1.0, 0.82, 0.62) * 3.4;
    }
    return acc;
  }

  // The furnace under the shaft: a warm updraft that grows as the cage falls.
  vec3 furnaceLight(vec3 p, vec3 n, vec3 albedo) {
    float depth = clamp((FLOOR_Y + 22.0 - p.y) / 46.0, 0.0, 1.0);
    float up = max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0);
    float flick = 0.85 + 0.15 * fbm(vec2(p.y * 0.4, iTime * 1.7));
    return albedo * up * depth * flick * vec3(0.85, 0.28, 0.065);
  }

  vec3 shadeSurface(vec3 p, vec3 n, vec3 rd, float dist) {
    float mat = gMat, wear = gWear;
    vec3 albedo; float rough;

    if (mat < 0.5) {
      // Shaft steel — dark plate, rust blooming out of the noise field.
      vec3 steel = vec3(0.085, 0.088, 0.098);
      vec3 rust = vec3(0.30, 0.13, 0.055);
      albedo = mix(steel, rust, smoothstep(0.52, 0.85, wear));
      rough = 0.82;
    } else if (mat < 1.5) {
      // Cage frame — hazard yellow paint, chipped back to primer on the edges.
      float chip = smoothstep(0.38, 0.66, wear);
      albedo = mix(vec3(0.30, 0.21, 0.045), vec3(0.09, 0.085, 0.08), chip);
      rough = 0.80;
    } else if (mat < 2.5) {
      // Debris — raw steel offcuts, mill-scale blue.
      albedo = mix(vec3(0.13, 0.14, 0.17), vec3(0.26, 0.15, 0.09), wear * 0.5);
      rough = 0.68;
    } else if (mat < 3.5) {
      // Piston chrome — polished, so it carries the lamps as hard highlights.
      albedo = vec3(0.55, 0.57, 0.62);
      rough = 0.16;
    } else if (mat < 4.5) {
      // Lamp glass — emissive, unaffected by lighting.
      return vec3(1.0, 0.76, 0.42) * 2.6;
    } else {
      // Guide rails / chain — worn bright steel.
      albedo = vec3(0.34, 0.35, 0.38);
      rough = 0.30;
    }

    vec3 col = albedo * vec3(0.13, 0.145, 0.185);         // cool ambient bounce
    col += lampLight(p, n, albedo, rough, rd);
    col += furnaceLight(p, n, albedo);

    // Brake sparks throw a hard white-hot key from the rail contact patch.
    if (spark() > 0.01) {
      vec3 sp = vec3(sign(p.x) * (SHAFT_R - 0.34), cageY() + 0.1, 0.0);
      vec3 sd = sp - p;
      float sdist = length(sd);
      float att = 1.0 / (1.0 + sdist * sdist * 0.35);
      col += albedo * max(dot(n, sd / max(sdist, 0.001)), 0.0) * att * spark() * vec3(3.4, 2.6, 1.5);
    }

    // Fresnel rim keeps the metal from flattening out at grazing angles.
    col += vec3(0.10, 0.11, 0.14) * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * (1.0 - rough);
    return col;
  }

  // ============================ CAMERA =====================================

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // The camera rides the cage. Shake, pitch and roll are all read from the
    // integrator: pitch follows velocity (you look where you are going), shake
    // follows |acceleration| and impacts, roll follows lateral shake.
    // Stand toward the back of the cage, looking out through the open gate.
    vec3 ro = vec3(uSim.x * 0.035, cageY() + EYE + uSim.y * 0.045, -0.55 + uSim.y * 0.03);

    float fallPitch = -0.42 * smoothstep(0.0, -26.0, cageV());
    // Base gaze is down the shaft; free fall drops it further toward vertical.
    float pitch = -0.62 + fallPitch + uPointer.y * 0.55 + uSim.y * 0.012;
    float yaw = uPointer.x * 0.85 + uSim.x * 0.010;
    float roll = uSim.x * 0.035 + weightless() * 0.05;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 wup = normalize(vec3(sin(roll), cos(roll), 0.0));
    vec3 right = normalize(cross(wup, fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.25;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    float dist = 0.0, hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapScene(p);
      if (d < 0.0016 * dist + 0.0008) { hit = 1.0; break; }
      dist += d * STEP_K;
      if (dist > MAX_DIST) break;
    }

    // Background: the shaft has no sky, only the furnace glow far below.
    vec3 col = vec3(0.012, 0.010, 0.014)
      + vec3(0.30, 0.09, 0.02) * pow(max(-rd.y, 0.0), 3.0)
        * clamp((FLOOR_Y + 60.0 - ro.y) / 80.0, 0.0, 1.0);

    if (hit > 0.0) {
      vec3 n = calcNormal(p);
      col = shadeSurface(p, n, rd, dist);
      float fog = 1.0 - exp(-dist * 0.055);
      col = mix(col, vec3(0.030, 0.026, 0.030), fog);
    }

    // --- spark shower along the guide rails during braking ---
    if (spark() > 0.01) {
      float sy = ro.y - EYE;
      for (int s = 0; s < SPARK_LAYERS; s++) {
        float fi = float(s);
        float seed = hash11(fi * 13.7 + floor(iTime * 22.0));
        // Sparks are thrown off the rail and fall behind the still-moving cage.
        vec3 sp = vec3(sign(seed - 0.5) * (SHAFT_R - 0.40),
                       sy + 0.2 + fract(seed * 7.3) * 2.4,
                       (fract(seed * 3.1) - 0.5) * 0.9);
        vec3 to = sp - ro;
        float along = dot(to, rd);
        if (along > 0.0) {
          float perp = length(to - rd * along);
          float g = exp(-perp * perp * 900.0) * exp(-along * 0.22);
          col += vec3(1.6, 0.95, 0.42) * g * spark() * 2.2;
        }
      }
    }

    // --- steam drifting up from the machinery (heavy effects only) ---
    if (uHeavy > 0.5) {
      float steam = fbm(vec2(uv.x * 3.0 + iTime * 0.15, uv.y * 3.0 - iTime * 0.55 + ro.y * 0.2));
      steam *= smoothstep(0.6, 1.0, steam) * 0.5;
      col += vec3(0.16, 0.15, 0.17) * steam * (0.3 + 0.7 * weightless());
    }

    // --- grade ---
    // Free fall desaturates and cools; the brake flash blows the highlights out.
    float w = weightless();
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), w * 0.35);
    col *= mix(vec3(1.0), vec3(0.86, 0.92, 1.10), w);
    col += vec3(1.0, 0.8, 0.55) * spark() * 0.06;

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += col * smoothstep(0.75, 1.7, lum) * 0.5;                  // pseudo-bloom
    col = pow(clamp(col, 0.0, 1.8), vec3(0.90));
    col *= 1.0 - smoothstep(0.42, 1.05, length(uv)) * 0.65;         // vignette
    // Sensor grain, heavier as the cage accelerates.
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5)
           * (0.025 + 0.05 * clamp(abs(cageA()) / 40.0, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`

// Full-quality variant used by the route page.
export const foundryFrag = `
#define RM_STEPS 88
#define MAX_DIST 90.0
#define STEP_K 0.72
#define FBM_OCTAVES 3
#define SPARK_LAYERS 14
${COMMON}`

// The hover thumbnail runs without a simulation attached (uCage et al. are all
// zero), so it gets its own compact, self-driving shader rather than a cheaper
// build of the one above: an analytic descent past ribs, lamps and a piston,
// with the brake-spark flash on a slow cycle.
export const foundryPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.10;

    // Fake-perspective shaft: |uv| drives distance to the wall, so the frame
    // reads as looking down a square well.
    float q = max(abs(uv.x), abs(uv.y));
    float depth = 0.42 / max(q, 0.02);
    float fall = iTime * 6.5;

    // Ribs streaming past, plus a brake-flash cycle every ~9 s.
    float rib = fract(depth * 0.9 + fall * 0.28);
    float ribHi = smoothstep(0.0, 0.06, rib) * (1.0 - smoothstep(0.14, 0.22, rib));
    float brake = smoothstep(0.72, 0.92, fract(iTime * 0.11));

    float shade = clamp(1.6 / depth, 0.04, 1.0);
    vec3 col = vec3(0.085, 0.088, 0.098) * shade;
    col = mix(col, vec3(0.28, 0.12, 0.05) * shade, hash21(floor(vec2(uv * 14.0))) * 0.5);
    col += ribHi * shade * 0.14;

    // Caged wall lamps, staggered, streaming upward as the cage descends.
    float lampPhase = fract(depth * 0.30 + fall * 0.09);
    float lamp = smoothstep(0.03, 0.0, abs(lampPhase - 0.5)) * smoothstep(0.55, 0.25, abs(uv.x));
    col += vec3(1.0, 0.72, 0.38) * lamp * 1.6;

    // A piston ram on the right wall, extending on the exact slider-crank curve.
    float crank = iTime * 3.1;
    float ext = 0.62 * cos(crank) + sqrt(max(0.0, 3.61 - 0.3844 * sin(crank) * sin(crank)));
    float ram = smoothstep(0.035, 0.0, abs(uv.y + 0.06))
              * step(0.30, uv.x) * step(uv.x, 0.30 + ext * 0.11);
    col += vec3(0.55, 0.57, 0.62) * ram * 0.9;

    // Cage grating in the foreground — the bars you are looking through.
    float bars = min(abs(fract(uv.x * 9.0) - 0.5), abs(fract(uv.y * 9.0) - 0.5));
    col *= mix(1.0, 0.35, smoothstep(0.06, 0.0, bars));

    // Brake sparks + furnace glow from below.
    float sparkle = step(0.985, hash21(floor(uv * 90.0) + floor(iTime * 30.0)));
    col += vec3(1.6, 0.95, 0.42) * sparkle * brake * 1.4;
    col += vec3(0.30, 0.09, 0.02) * pow(max(-uv.y, 0.0), 2.0) * 1.2;

    col *= 1.0 - smoothstep(0.40, 1.05, length(uv)) * 0.6;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 88 raymarch steps x (shaft + 6 quaternion-rotated debris
// boxes + pistons + cage grating) is the heaviest journey in the set; the
// debris bounding-sphere reject keeps the common case near the cost of the
// shaft alone. ~1 draw call, no textures, no render targets.
