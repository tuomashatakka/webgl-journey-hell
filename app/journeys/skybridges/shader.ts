// SKYBRIDGES — a fight-or-flight panic POV: sprinting away from a collapsing
// glass bridge at the clouds' height. Clean, clinical, high-key palette — bright
// pale sky, cold whites/greys, thin cold air, vertigo. The signature visual is
// long arched glass bridges that thin-film-diffract into rainbow at grazing
// angles, receding at MULTIPLE heights. All camera choreography (forward sprint,
// head-bob, scripted glance-DOWN at the drop, glance-BACK at the collapse) lives
// inside the shader as a function of iTime — no extra uniforms.
//
// Single-pass raymarch via lib/shaderQuad.ts. WebGL 1.0 / GLSL ES 1.00.
// Uniforms (set by lib/shaderQuad.ts): iResolution, iTime, uPointer.

// Shared GLSL building blocks injected into both the full and preview frags.
// Kept as a template literal so the two variants stay byte-for-byte consistent
// in their look and only differ in raymarch budget / scene density.
const COMMON = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  // --- constants -----------------------------------------------------------
  const float PI = 3.14159265359;
  const float LANE = 7.0;     // X spacing between parallel bridges
  const float SEG = 9.0;      // Z spacing between deck segments / arch ribs
  const float SPEED = 7.5;    // forward sprint speed (units/sec)

  // --- hash / noise (procedural clouds, no textures) -----------------------
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      s += amp * vnoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return s;
  }

  // 2D rotation helper.
  mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
  }

  // --- SDF primitives ------------------------------------------------------
  float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
  }
  // Capped torus arch in the XY plane (arch ribs span across the deck width).
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xy) - t.x, p.z);
    return length(q) - t.y;
  }

  // --- camera choreography (scripted, purely a function of iTime) ----------
  // playerZ: forward sprint. headBob/sway: running urgency. glance pulses:
  // periodic eased episodes that pitch the view DOWN (the sickening drop) and
  // yaw it BACK (the structure cracking apart behind you).
  float playerZ() { return iTime * SPEED; }

  // Smooth single-hump pulse in [0,1] centered in a window of length 'len'
  // starting at 'start' within each 'period'.
  float pulse(float t, float period, float start, float len) {
    float ph = mod(t, period) - start;
    float x = clamp(ph / len, 0.0, 1.0);
    return sin(x * PI);                 // 0 -> 1 -> 0, smooth
  }

  // Returns camera pitch (x) and yaw (y) in radians, plus a 'lookBack' weight
  // (z) in 0..1 used to intensify the collapse during the backward glance.
  vec3 camAngles() {
    float t = iTime;
    // Glance DOWN: pitch toward the drop, mid-cycle.
    float down = pulse(t, 13.0, 4.0, 2.4);
    float pitch = -down * 0.9;          // negative = look downward
    // Glance BACK: yaw ~160deg to see the collapse, later in the cycle.
    float back = pulse(t, 13.0, 8.5, 2.8);
    float yaw = back * (PI * 0.9);
    // ...and tip the gaze down while looking back, so the plunging debris and
    // the chasm are actually in frame (look back AND down at the collapse).
    pitch += -back * 0.5;
    // subtle running head sway always present
    pitch += sin(t * 5.0) * 0.025;
    yaw   += sin(t * 3.1) * 0.03;
    return vec3(pitch, yaw, back);
  }

  // --- bridge collapse bookkeeping -----------------------------------------
  // A segment is identified by its integer Z index. Segments BEHIND the
  // advancing player detach and fall: vertical drop + tumble grows with how far
  // behind playerZ the segment is. Deterministic per-segment jitter via hash.
  // Returns vec3(yDrop, tumbleAngle, crackGap 0..1).
  vec3 segmentFall(float segZcenter, float lane) {
    float pz = playerZ();
    float behind = pz - segZcenter;     // >0 once we've passed it
    float seed = hash21(vec2(floor(segZcenter / SEG), lane * 1.7));
    // Collapse begins shortly after we pass, staggered per segment. Closer
    // onset + a gentler plunge keeps the cracking/tumbling in frame longer.
    float onset = 3.0 + seed * 8.0;     // distance behind before it lets go
    float fall = max(behind - onset, 0.0);
    float prog = clamp(fall / 36.0, 0.0, 1.0);
    float yDrop = prog * prog * (42.0 + seed * 30.0);   // accelerating plunge
    float tumble = prog * (2.2 + seed * 4.0);
    float gap = smoothstep(0.0, 5.0, fall);             // cracks open
    return vec3(yDrop, tumble, gap);
  }

  // --- bridge SDF ----------------------------------------------------------
  // 'tier' chooses a Y height band; lanes repeat in X; segments repeat in Z.
  // We model a flat glass deck + periodic arch ribs over it. Material id is
  // returned via the global gMatThick (thin-film thickness proxy) for shading.
  // SCENE_LANES / SCENE_TIERS are #defined per-variant below.

  float gThick;      // accumulated thin-film thickness proxy at the hit
  float gFell;       // collapse 'gap' weight at the hit (0..1)

  float bridgeTierY(float tier) {
    // discrete heights, spread above and below eye line for vertigo
    return (tier - 1.0) * 11.0 - 3.0;
  }

  float mapBridges(vec3 p) {
    float d = 1e5;
    gThick = 0.0;
    gFell = 0.0;

    for (int li = 0; li < SCENE_LANES; li++) {
      float lane = float(li) - float(SCENE_LANES - 1) * 0.5;
      float lx = lane * LANE;

      for (int ti = 0; ti < SCENE_TIERS; ti++) {
        float tier = float(ti);
        float ty = bridgeTierY(tier);

        // Local space for this lane/tier.
        vec3 q = p - vec3(lx, ty, 0.0);

        // Per-segment fold along Z so each rib/segment can fall independently.
        float segIndex = floor(q.z / SEG + 0.5);
        float segZcenter = segIndex * SEG;
        vec3 fall = segmentFall(segZcenter, lane + tier * 0.31);

        // Apply this segment's collapse to its local copy.
        vec3 s = q;
        s.z -= segZcenter;                 // center on this segment
        s.y += fall.x;                     // plunge downward (y up)
        s.xy = rot(fall.y) * s.xy;         // tumble
        s.yz = rot(fall.y * 0.6) * s.yz;

        // Deck: a long thin glass slab spanning the segment in Z.
        float deckHalfZ = SEG * 0.5 * (1.0 - fall.z * 0.55); // shrinks as it cracks
        float deck = sdBox(s, vec3(2.4, 0.18, deckHalfZ));

        // Side rails (two thin beams).
        float railL = sdBox(s - vec3(2.2, 0.5, 0.0), vec3(0.12, 0.5, deckHalfZ));
        float railR = sdBox(s + vec3(2.2, -0.5, 0.0), vec3(0.12, 0.5, deckHalfZ));
        float rails = min(railL, railR);

        // Arch rib: a half-torus standing across the deck width, one per segment.
        vec3 a = s;
        a.y -= 0.0;
        float arch = sdTorus(a, vec2(3.4, 0.16));
        // keep only the upper half-arch (above the deck)
        arch = max(arch, -s.y - 0.2);

        float piece = min(min(deck, rails), arch);

        if (piece < d) {
          d = piece;
          // thin-film thickness proxy: varies along the deck + by tier so
          // iridescence shimmers across the structure.
          gThick = 0.45 + 0.35 * sin(segZcenter * 0.21 + tier * 1.3 + lane * 0.7);
          gThick += 0.12 * sin(s.z * 0.8);
          gFell = fall.z;
        }
      }
    }
    return d;
  }

  // --- thin-film iridescence (cosine palette, modulated by view + thickness) -
  vec3 iridescence(float cosTheta, float thick) {
    // grazing angles (low cosTheta) push the spectral shift hardest
    float shift = thick * 5.0 + (1.0 - clamp(cosTheta, 0.0, 1.0)) * 3.5;
    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + shift);
    // desaturate toward white — clean clinical glass, not a vaporwave wash
    return mix(vec3(0.92), col, 0.55);
  }

  // --- sky: bright high-key gradient + pale procedural clouds far below ------
  vec3 sky(vec3 rd) {
    float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    // cold pale-blue zenith to near-white horizon
    vec3 top = vec3(0.62, 0.78, 0.95);
    vec3 hor = vec3(0.93, 0.96, 1.0);
    vec3 col = mix(hor, top, pow(up, 0.7));

    // High clouds drifting near eye level / above.
    vec2 cuv = rd.xz / (abs(rd.y) + 0.18);
    float hi = fbm(cuv * 1.1 + vec2(iTime * 0.05, 0.0));
    hi = smoothstep(0.45, 1.05, hi) * smoothstep(0.0, 0.25, rd.y + 0.05);
    col = mix(col, vec3(1.0), hi * 0.6);

    // The drop: dense cloud floor far BELOW (only when looking down).
    float belowMask = smoothstep(0.0, 0.35, -rd.y);
    vec2 fuv = rd.xz / max(-rd.y, 0.05);
    float floorN = fbm(fuv * 0.5 + vec2(iTime * 0.03, iTime * 0.02));
    vec3 floorCol = mix(vec3(0.78, 0.84, 0.92), vec3(0.55, 0.62, 0.74), floorN);
    col = mix(col, floorCol, belowMask * 0.85);

    return col;
  }

  // Cheap normal via tetrahedron sampling of the SDF.
  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0025, 0.0);
    return normalize(vec3(
      mapBridges(p + e.xyy) - mapBridges(p - e.xyy),
      mapBridges(p + e.yxy) - mapBridges(p - e.yxy),
      mapBridges(p + e.yyx) - mapBridges(p - e.yyx)
    ));
  }

  void mainScene(out vec3 outCol) {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // --- camera ---
    vec3 ang = camAngles();
    float pitch = ang.x;
    float yaw = ang.y;
    float lookBack = ang.z;

    // running head-bob + lateral sway
    float t = iTime;
    float bobY = sin(t * 9.0) * 0.12 + abs(sin(t * 4.5)) * 0.06;
    float swayX = sin(t * 3.0) * 0.25;

    vec3 ro = vec3(swayX, 1.2 + bobY, playerZ());

    // slight pointer parallax (flavor only)
    pitch += uPointer.y * 0.08;
    yaw   += uPointer.x * 0.12;

    // forward direction from yaw/pitch (yaw around Y, pitch around X)
    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, right);

    float fov = 1.25;
    vec3 rd = normalize(uv.x * right + uv.y * upv + fov * fwd);

    // --- raymarch ---
    float dist = 0.0;
    float hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < RM_STEPS; i++) {
      p = ro + rd * dist;
      float d = mapBridges(p);
      if (d < 0.002 * dist + 0.001) { hit = 1.0; break; }
      dist += d * 0.85;
      if (dist > MAX_DIST) break;
    }

    vec3 col = sky(rd);

    if (hit > 0.0) {
      float thick = gThick;
      float fell = gFell;
      vec3 n = calcNormal(p);

      float cosT = clamp(dot(n, -rd), 0.0, 1.0);
      float fres = pow(1.0 - cosT, 3.0);

      // Glass base: cold, near-white, very desaturated.
      vec3 glass = vec3(0.82, 0.88, 0.95);

      // Reflected sky (cheap) for that polished glass read.
      vec3 refl = sky(reflect(rd, n));

      // Thin-film rainbow, strongest at grazing angles.
      vec3 irid = iridescence(cosT, thick);

      // soft key light from high sky
      float diff = clamp(dot(n, normalize(vec3(0.4, 0.9, -0.2))), 0.0, 1.0);

      vec3 surf = glass * (0.35 + 0.65 * diff);
      surf = mix(surf, refl, 0.45 + 0.4 * fres);
      // thin-film accent: faint on flat faces, blooms at grazing edges only
      surf += irid * (0.12 + 0.55 * fres) * 0.6;

      // cracked/collapsing segments darken at the fracture and glint
      surf = mix(surf, surf * vec3(0.7, 0.74, 0.82), fell * 0.5);

      // translucency: let some sky bleed through (semi-glass)
      surf = mix(surf, refl, 0.15);

      // distance haze toward the bright sky (thin cold air, vertigo) — pulled
      // in tighter so the far field melts to clean sky instead of rainbow noise
      float haze = 1.0 - exp(-dist * 0.026);
      col = mix(surf, sky(rd), haze);
    }

    // Vignette-free high-key tone; gentle filmic-ish lift.
    col = pow(clamp(col, 0.0, 1.0), vec3(0.92));

    // faint cold grade
    col *= vec3(0.98, 1.0, 1.03);

    // emphasize the collapse during the backward glance with a subtle adrenaline
    // desat-to-cool wash at the edges
    float edge = smoothstep(0.4, 0.95, length(uv));
    col = mix(col, mix(col, vec3(dot(col, vec3(0.33))), 0.3), edge * lookBack * 0.4);

    outCol = col;
  }

  void main() {
    vec3 col;
    mainScene(col);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Full-quality scene used by the route page: denser lanes/tiers, more steps.
export const skybridgesFrag = `
#define SCENE_LANES 5
#define SCENE_TIERS 4
#define RM_STEPS 96
#define MAX_DIST 220.0
${COMMON}`;

// Cheaper hover-thumbnail variant: fewer raymarch steps, fewer lanes/tiers, but
// the same glass-arch-in-bright-sky read. Rendered at 0.6 scale in the shared
// grid context alongside the other previews, so it stays light on the GPU.
export const skybridgesPreviewFrag = `
#define SCENE_LANES 3
#define SCENE_TIERS 2
#define RM_STEPS 40
#define MAX_DIST 140.0
${COMMON}`;
