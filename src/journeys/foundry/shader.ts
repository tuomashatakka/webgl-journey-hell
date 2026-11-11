// THE FOUNDRY — a lift drop into a machine hall that never ends.
//
// Companion piece to THE LIMINAL JOURNEY: the same endlessly repeating
// first-person traversal, but the corridors are machinery and the motion is not
// authored. Every moving thing in this shader is positioned by uniforms produced
// by the rigid-body integrator in physics.ts — the falling cage, six tumbling
// debris bodies loose in it, the walker's gait (head height on a leg spring,
// lateral sway, roll and yaw all read off footfalls), the exact slider-crank
// piston extension, and two pendulums swung by the cage's acceleration and by
// your own footsteps. The shader draws state; it does not invent motion.
//
// Single-pass raymarch on WebGL 2 / GLSL ES 3.00 (renderer.ts binds the Δ
// material arrays). Uniforms beyond the shared set:
//   uWalk    = (cyclicZ, smoothLoop, decay, headRoll)
//   uGait    = (eyeY, swayX, headYaw, headPitch)
//   uRide    = (riding, shutterClosed, gateOpen, phaseSeconds)
//   uCage    = (floorY, velocity, acceleration, mode)
//   uSim     = (shakeX, shakeY, brakeSpark, cableIntact)
//   uMech    = (crankAngle, pistonExtension, cageHookAngle, hallChainAngle)
//   uDebris  = 6 x (cageX, worldY, cageZ, halfExtentScale)
//   uDebrisQ = 6 x orientation quaternion
//   uFold0/1 = fold coordinate of the 8 folding-span cubes
//
// THE LAP. It opens inside the cage, part-way down a 128 m hoist shaft, with the
// cable already gone: free fall, then the emergency shoes on the guide rails,
// then a governed shudder onto the landing and the gate rattling up. From there
// it is a walk through seven 36 m halls (loading bay, piston gallery, long run,
// coolant tier, gearworks, brake run, furnace floor) laid end to end, and
// everything is keyed off mod(z, CYCLE) — so the seventh hall runs straight back
// into the first with no seam, no fade and no teleport. Every boundary, the wrap
// included, is handled by exactly one rule (see secBlend): the last TRANS metres
// funnel the corridor profile into the next hall's proportions, the last
// FEAT_FADE metres erode this hall's machinery away while the next hall's
// already stands beyond the doorway, and a bulkhead portal is bolted across the
// join. The lap ends where it began, back in the cage, and the shutter coming
// down over its open faces is the only thing that is ever cut away from.
//
// NOTHING IS SIMPLY THERE. Every mechanism drives itself into place as it comes
// into view — rams telescope out of the wall, gears rise in their recesses and
// spin up, valve wheels swing out, shoe housings clamp onto the rails, hoist
// beams lower on their hangers, bulkhead shutters roll up, lamps strike. They
// all run on one closed-form damped hinge (deployAt) evaluated against distance
// to the walker, so they overshoot and ring down instead of easing.
//
// TEXTURE AND LIGHT. Every surface is a Δ scan (delta/: brick, shuttered and
// spalled concrete, subway tile, corrugated sheet, weathered steel, hazard
// paint, timber), sampled triplanar and lit through a GGX BRDF by the nearest
// lamps, the way the loop line lights its bays — with each lamp's glow in the
// air in closed form, steam blowing off the pipe flanges, and the halls
// cluttered with crates, drums and hydraulic power packs between the machines.
// On top of the scans every surface is dressed analytically in the shading
// (riveted plate up the shaft, peeling dado paint, kick bands, grime, soot,
// oil, walkway lines, riveted ribs, a slag crust on the melt) and darkened by
// two taps of occlusion along the normal; see docs/journeys/foundry.md.
//
// THE DECAY. Each completed lap leaves the foundry a little less sure of itself:
// the corridor snakes and breathes, the walls close in, lamps fail, the lens
// barrels, whole scanlines tear sideways and the grade rots toward oxblood.
// Same road, one level deeper, worse every time round — and from the second
// lap the cracks bleed red light into the air.

import { HASH21 } from '@wjh/glsl/hash'
import { foundationGlsl } from './glsl/foundation'
import { decayGlsl } from './glsl/decay'
import { hallsGlsl } from './glsl/halls'
import { shaftGlsl } from './glsl/shaft'
import { oblivionGlsl } from './glsl/oblivion'
import { propsGlsl } from './glsl/props'
import { MATERIAL_GLSL, SURFACE_GLSL } from '@wjh/delta/glsl'
import { shadingGlsl } from './glsl/shading'
import { cameraGlsl } from './glsl/camera'


const COMMON = foundationGlsl + MATERIAL_GLSL + SURFACE_GLSL + decayGlsl + hallsGlsl + shaftGlsl + propsGlsl +
  oblivionGlsl + shadingGlsl + cameraGlsl

// The route page (WebGL 2).
export const foundryFrag = `#version 300 es
#define RM_STEPS 96
#define MAX_DIST 90.0
#define STEP_K 0.72
#define FBM_OCTAVES 4
#define SPARK_LAYERS 14
${COMMON}`

// The hover thumbnail runs without a simulation attached (uWalk et al. are all
// zero), so it gets its own compact, self-driving shader rather than a cheaper
// build of the one above: the journey's opening shot, standing at the cage gate
// looking out and down a riveted steel hoistway as it streams up past the bars.
// Everything is intersected analytically (four walls, two guide rails, two
// ropes, the cage's own faces) and shaded in closed form, so it costs one
// fixed loop of sparks and no march: I-beam rings with lit flanges, riveted
// plate with soot and rust runs, X bracing, caged lamps that streak with the
// speed, landings with hazard sills, the melt glowing at the bottom of the
// shaft and through the floor grating, and brake sparks raining down the gap.
export const foundryPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH21}

  // Everything in the shaft repeats every SP metres (plates 1.5, beams 3,
  // lamps 6, landings 24), and one cycle of the drop travels exactly SP, so
  // the clock wraps with no seam and the heights never grow.
  const float SP = 72.0;
  const float SR = 2.7;   // shaft half-width, to the plate
  const float CR = 1.4;   // cage half-width
  const vec3 LAMP = vec3(1.0, 0.62, 0.30);
  const vec3 MELT = vec3(1.0, 0.30, 0.06);

  // Value noise, periodic in y over 'per' cells so it wraps with the shaft.
  float vnoiseP(vec2 p, float per) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float y0 = mod(i.y, per);
    float y1 = mod(i.y + 1.0, per);
    return mix(mix(hash21(vec2(i.x, y0)), hash21(vec2(i.x + 1.0, y0)), f.x),
               mix(hash21(vec2(i.x, y1)), hash21(vec2(i.x + 1.0, y1)), f.x), f.y);
  }

  // Coverage of lines of width w every 'per', box-filtered over 'blur' and
  // faded to their average once the blur spans the period.
  float lineF(float x, float per, float w, float blur) {
    float d = abs(x - per * floor(x / per + 0.5));
    float sharp = 1.0 - smoothstep(w * 0.5 - blur * 0.5, w * 0.5 + blur * 0.5 + 1e-4, d);
    return mix(sharp, w / per, smoothstep(per * 0.12, per * 0.5, blur));
  }

  // Yellow and black, at 45 degrees.
  vec3 hazard(vec2 q) {
    return mix(vec3(0.62, 0.42, 0.04), vec3(0.025), step(0.5, fract((q.x + q.y) * 4.0)));
  }

  /** Light reaching a point 'below' metres under the eye: the melt, the shoes, the lamps. */
  vec3 shaftLight(float below, float y, float brake) {
    return MELT * (0.02 + 0.25 * smoothstep(3.0, 80.0, below))
      + vec3(1.0, 0.55, 0.18) * brake * 1.4 / (1.0 + (below - 1.6) * (below - 1.6) * 1.2)
      + LAMP * 0.10 * exp(-abs(mod(y, 6.0) - 3.0) * 0.5);
  }

  /** A shaft wall at (u along it, y up), seen from t away, facing n. Lit. */
  vec3 shaftWall(vec3 p, vec3 n, float u, float side, float t, vec3 ro, float speed, float brake) {
    float y = mod(p.y, SP);
    float fp = t * 0.004;
    float vb = fp + speed * 0.018;

    // --- the structure: I-beam rings, riveted plates, the bracing ------------
    float bv = y - 3.0 * floor(y / 3.0 + 0.5);
    float beam = 1.0 - smoothstep(0.15, 0.16 + vb, abs(bv));
    float edgeTop = 1.0 - smoothstep(0.0, 0.03 + vb, abs(bv - 0.14));
    float edgeBot = 1.0 - smoothstep(0.0, 0.03 + vb, abs(bv + 0.14));
    float pu = u + side * 0.37;
    float seams = lineF(pu, 1.05, 0.014, fp) + lineF(y + 1.5, 3.0, 0.014, vb);
    float rivH = lineF(u, 0.12, 0.035, fp) * max(lineF(bv, 3.0, 0.035, vb) * beam,
      lineF(y + 1.56, 3.0, 0.03, vb) + lineF(y + 1.44, 3.0, 0.03, vb));
    float rivV = lineF(y, 0.12, 0.035, vb) * (lineF(pu + 0.06, 1.05, 0.03, fp) + lineF(pu - 0.06, 1.05, 0.03, fp));
    float rivets = clamp(rivH + rivV * (1.0 - beam), 0.0, 1.0);

    // X bracing in every bay of the side walls: angle iron, lit on its top edge.
    float isSide = step(0.5, abs(n.x));
    float bay = fract(y / 3.0) * 2.0 - 1.0;
    float dd = min(abs(u / SR - bay), abs(u / SR + bay)) * 1.05;
    float brace = (1.0 - smoothstep(0.04, 0.045 + vb + fp, dd)) * isSide * (1.0 - beam);

    // --- the plate: a tint per sheet, soot, rust run off the rivet lines -----
    vec2 cell = vec2(floor(pu / 1.05), mod(floor(y / 1.5), 48.0));
    float tint = hash21(cell + side * 17.0);
    vec3 alb = mix(vec3(0.075, 0.074, 0.072), vec3(0.15, 0.12, 0.09), tint * tint);
    float soot = vnoiseP(vec2(u * 0.9 + side * 5.0, y * 0.25), 18.0);
    float streak = vnoiseP(vec2(u * 11.0 + side * 3.0, y * 0.5), 36.0);
    float rust = smoothstep(0.50, 0.85, streak * 0.55 + soot * 0.55 - fract(y / 3.0) * 0.25);
    alb = mix(alb, vec3(0.30, 0.105, 0.035), rust * 0.75);
    alb *= 1.0 - smoothstep(0.35, 0.8, soot) * 0.6;
    alb = mix(alb, vec3(0.11, 0.10, 0.09), beam * 0.7);
    alb = mix(alb, vec3(0.19, 0.16, 0.12), brace);
    alb *= 1.0 - seams * 0.7;

    // --- the front wall: a landing every 24 m (the drop stops at one), its
    // sill in hazard paint ----------------------------------------------------
    float front = step(0.5, -n.z);
    float ly = mod(y + 4.2, 24.0);
    float du = abs(u + 0.15);
    float door = front * step(du, 0.85) * step(0.30, ly) * step(ly, 2.6);
    float sill = front * step(du, 1.05) * step(0.12, ly) * step(ly, 0.30);
    float jamb = front * step(du, 1.05) * step(0.85, du) * step(ly, 2.75);
    alb = mix(alb, vec3(0.06, 0.075, 0.06) * (0.7 + 0.3 * lineF(u, 0.16, 0.05, fp)), door);
    alb = mix(alb, hazard(vec2(u, ly)), sill * (1.0 - smoothstep(0.1, 0.4, vb)));
    alb = mix(alb, vec3(0.20, 0.16, 0.06), jamb * 0.6);
    // Oil weeping down the plate under the rail brackets.
    float oil = front * (1.0 - smoothstep(0.10, 0.35, min(abs(p.x + 1.25), abs(p.x - 1.55))))
      * smoothstep(0.3, 0.7, vnoiseP(vec2(u * 7.0, y * 0.5 + 3.0), 36.0));
    alb *= 1.0 - oil * 0.7;

    // --- light ------------------------------------------------------------------
    // The nearest caged lamp on this wall, a point 0.2 m out: a tight hot pool.
    float lu = side > 0.5 ? 0.9 : -0.35;
    float lo = side > 0.5 ? 1.0 : 4.0;
    float lyN = 6.0 * floor((y - lo) / 6.0 + 0.5) + lo;
    float dl = length(vec2(u - lu, y - lyN));
    vec3 E = LAMP * (0.06 / pow(0.04 + dl * dl, 1.5) + 0.10 * exp(-abs(y - lyN) * 0.5));
    // The melt, far below, lights the undersides of the beams most of all.
    float below = ro.y - p.y;
    E += MELT * (0.02 + 0.25 * smoothstep(3.0, 80.0, below)) * (1.0 + edgeBot * beam * 3.0);
    // The cage's dome lamp, and the shoes.
    vec3 dome = vec3(0.0, ro.y + 0.9, 0.0) - p;
    E += vec3(1.0, 0.82, 0.6) * max(dot(n, normalize(dome)), 0.0) * 0.35 / (1.0 + dot(dome, dome) * 0.5);
    E += vec3(1.0, 0.55, 0.18) * brake * 1.4 / (1.0 + (below - 1.6) * (below - 1.6) * 1.2);

    // Rivet heads and flanges catch the light on their upper edge.
    float relief = 1.0 + rivets * 0.9 + edgeTop * beam * 1.4 + brace * 0.5 - edgeBot * beam * 0.4;
    vec3 col = alb * E * relief;

    // The lamp itself: a bulb in a wire-guarded housing, streaked by the fall.
    float sv = speed * 0.022;
    vec2 lq = vec2(u - lu, max(abs(y - lyN) - sv, 0.0));
    float housing = 1.0 - smoothstep(0.13, 0.15 + fp, max(abs(lq.x), lq.y * 0.75));
    float bulb = 1.0 - smoothstep(0.03, 0.09 + fp, length(lq * vec2(1.0, 0.85)));
    float guard = lineF(y, 0.07, 0.018, vb + fp) * housing;
    col = mix(col, vec3(0.015), housing * 0.8);
    col += LAMP * (bulb * 9.0 + exp(-dl * 6.0) * 0.8) * (1.0 - guard * 0.7) / (1.0 + sv * 3.0);
    // A red landing lamp over each door.
    col += vec3(1.6, 0.12, 0.04) * front * (1.0 - smoothstep(0.02, 0.05 + fp, length(vec2(du, ly - 2.95))));
    return col;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // --- the drop, on a 10 s cycle: free fall, the shoes, a shudder, rest -----
    // A cubic run-up then a quadratic brake, matched in speed where they meet.
    float c = fract(iTime * 0.1);
    float fallF = 1.0, vel = 0.0;
    if (c < 0.62) {
      float k = c / 0.62;
      fallF = 0.6966 * k * k * k;
      vel = 2.0898 * k * k / 0.62;
    } else if (c < 0.80) {
      float k = (c - 0.62) / 0.18;
      fallF = 0.6966 + 0.3034 * (1.0 - (1.0 - k) * (1.0 - k));
      vel = 0.6068 * (1.0 - k) / 0.18;
    }
    float speed = vel * SP * 0.1;
    float brake = smoothstep(0.615, 0.635, c) * (1.0 - smoothstep(0.78, 0.81, c));
    float settle = c > 0.80 ? exp(-(c - 0.80) * 30.0) * sin((c - 0.80) * 260.0) : 0.0;
    float judder = brake * (hash21(vec2(floor(iTime * 40.0), 1.0)) - 0.5);

    // --- the eye: at the gate, looking out and down, further down the faster --
    vec3 ro = vec3(0.25, -fallF * SP + settle * 0.05, 0.85);
    float yaw = 0.42 + uPointer.x * 0.35 + judder * 0.012;
    float pitch = -0.88 - 0.22 * clamp(speed / 24.0, 0.0, 1.0) + uPointer.y * 0.25 + settle * 0.04 + judder * 0.025;
    vec3 fwd = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
    vec3 right = normalize(vec3(fwd.z, 0.0, -fwd.x));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(uv.x * right + uv.y * up + 1.05 * fwd);
    vec3 rdc = rd;
    // Heat shimmer over the pit (the cage itself is too close to shimmer).
    float deep = smoothstep(-0.75, -0.97, rd.y);
    rd.xz += deep * 0.004 * vec2(sin(uv.y * 60.0 + iTime * 9.0), cos(uv.x * 50.0 - iTime * 7.0));

    // --- the shaft walls, intersected analytically ------------------------------
    vec2 sg = vec2(rd.x >= 0.0 ? 1.0 : -1.0, rd.z >= 0.0 ? 1.0 : -1.0);
    vec2 inv = sg / max(abs(rd.xz), vec2(1e-4));
    vec2 tw = (sg * SR - ro.xz) * inv;
    float t = min(min(tw.x, tw.y), 400.0);
    bool hx = tw.x < tw.y;
    vec3 n = hx ? vec3(-sg.x, 0.0, 0.0) : vec3(0.0, 0.0, -sg.y);
    vec3 p = ro + rd * t;
    vec3 col = shaftWall(p, n, hx ? p.z * sg.x : -p.x * sg.y, hx ? 1.0 : 0.0, t, ro, speed, brake);

    // Two guide rails down the front wall, either side of the landings: a blade
    // standing 0.26 m off the plate on bolted clamps.
    for (int k = 0; k < 2; k++) {
      float rx = k == 0 ? -1.25 : 1.55;
      float tx0 = (rx - 0.07 - ro.x) * inv.x * sg.x, tx1 = (rx + 0.07 - ro.x) * inv.x * sg.x;
      float tz0 = (SR - 0.26 - ro.z) * inv.y;
      float tn = max(min(tx0, tx1), tz0);
      float tf = min(max(tx0, tx1), tw.y);
      if (rd.z > 0.0 && tn < tf && tn > 0.0 && tn < t) {
        t = tn;
        vec3 q = ro + rd * t;
        float face = step(min(tx0, tx1), tz0);
        float y = mod(q.y, SP);
        float vb = t * 0.004 + speed * 0.018;
        // The running face polished bright by the shoes; the web black with grease.
        vec3 a = mix(vec3(0.04, 0.036, 0.032), vec3(0.50, 0.48, 0.45),
          face * (0.6 + 0.4 * vnoiseP(vec2(q.x * 40.0, y * 2.0), 144.0)));
        a = mix(a, vec3(0.09, 0.07, 0.045), lineF(y, 1.5, 0.16, vb));
        col = a * shaftLight(ro.y - q.y, q.y, brake) * (1.0 + face * 1.5);
      }
    }

    // Smoke near; the melt only where the ray has gone a long way down.
    float down = smoothstep(-0.55, -1.0, rd.y);
    float churn = vnoiseP(uv * 7.0 + vec2(0.0, iTime * 0.6), 1e4);
    vec3 pit = vec3(0.016, 0.010, 0.007) + MELT * 12.0 * down * smoothstep(6.0, 150.0, t) * (0.8 + 0.4 * churn);
    col = mix(col, pit, 1.0 - exp(-t * 0.028));

    // --- the counterweight ropes in the gap, running down out of sight --------
    for (int k = 0; k < 2; k++) {
      vec2 cp = k == 0 ? vec2(-0.75, 1.92) : vec2(1.0, 1.95);
      float tc = dot(cp - ro.xz, rd.xz) / dot(rd.xz, rd.xz);
      float dc = length(ro.xz + rd.xz * tc - cp);
      if (tc > 0.0 && tc < t) {
        float aa = tc * 0.004;
        float yc = ro.y + rd.y * tc;
        float strand = lineF(yc + dc * 3.0, 0.035, 0.012, speed * 0.018 + aa);
        vec3 rc = vec3(0.02, 0.018, 0.016) * (1.0 + strand * 2.0) * shaftLight(ro.y - yc, yc, brake) * 8.0;
        col = mix(col, mix(rc, pit, 1.0 - exp(-tc * 0.028)), 1.0 - smoothstep(0.014 - aa, 0.014 + aa, dc));
      }
    }

    // --- the cage: floor grating, side mesh, and the barred gate ---------------
    float yf = ro.y - 1.6;
    vec2 sc = vec2(rdc.x >= 0.0 ? 1.0 : -1.0, rdc.z >= 0.0 ? 1.0 : -1.0);
    vec2 tcx = (sc * CR - ro.xz) * sc / max(abs(rdc.xz), vec2(1e-4));
    float tyf = rdc.y < 0.0 ? (yf - ro.y) / rdc.y : 1e3;
    float tcg = min(min(tcx.x, tcx.y), tyf);
    vec3 q = ro + rdc * tcg;
    float gy = q.y - yf;
    float aa = tcg * 0.004 + 0.002;
    float cov = 0.0;
    vec3 a = vec3(0.07);
    vec3 dome = normalize(vec3(0.0, ro.y + 0.9, 0.0) - q);
    float sparkE = brake * (0.6 + 0.4 * hash21(vec2(floor(iTime * 30.0), 3.0)));
    vec3 E = vec3(1.0, 0.82, 0.6) * 0.32 + vec3(1.0, 0.5, 0.2) * sparkE * 0.7;
    vec3 spec = vec3(0.0);
    if (tyf <= min(tcx.x, tcx.y)) {
      // Floor: a bar grating over the drop, with a hazard-striped sill at the gate.
      float gx = 1.0 - smoothstep(0.016 - aa, 0.016 + aa, abs(fract(q.x / 0.11) - 0.5) * 0.11);
      float gz = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, abs(fract(q.z / 0.11) - 0.5) * 0.11);
      float sill = step(CR - 0.10, q.z);
      cov = max(max(gx, gz), sill);
      a = mix(vec3(0.06, 0.055, 0.05) * (0.7 + 0.3 * hash21(floor(q.xz * 9.0))), hazard(q.xz * 1.2), sill);
      a *= 1.0 - smoothstep(0.5, 0.9, vnoiseP(q.xz * 3.0, 1e4)) * 0.5;
    } else if (tcx.y <= tcx.x) {
      // The gate: flat bars on a bottom kick plate and a mid rail, riveted where
      // they cross, the corner posts in chipped hazard yellow.
      float cx = q.x - 0.17 * floor(q.x / 0.17 + 0.5);
      float bar = 1.0 - smoothstep(0.009 - aa, 0.009 + aa, abs(cx));
      float rails = 1.0 - smoothstep(0.028 - aa, 0.028 + aa, min(abs(gy - 1.05), abs(gy - 2.35)));
      float kick = 1.0 - smoothstep(0.24 - aa, 0.24 + aa, gy);
      float rivet = (1.0 - smoothstep(0.012 - aa, 0.012 + aa, length(vec2(cx, gy - 1.05)))) * 0.8;
      float post = step(CR - 0.07, abs(q.x));
      cov = clamp(max(max(bar, rails), max(kick, post)), 0.0, 1.0);
      float s = clamp(cx / 0.009, -1.0, 1.0) * bar * (1.0 - rails);
      vec3 nb = normalize(vec3(s * 0.9, rails * 0.25, -1.0));
      float chip = smoothstep(0.55, 0.8, vnoiseP(q.xy * vec2(9.0, 4.0), 1e4));
      a = mix(vec3(0.055, 0.065, 0.06), vec3(0.62, 0.43, 0.05), post);
      a = mix(a, vec3(0.16, 0.07, 0.03), chip * 0.6);
      a = mix(a, vec3(0.05, 0.045, 0.04) * (0.8 + 0.4 * vnoiseP(q.xy * 20.0, 1e4)), kick * (1.0 - post));
      E *= 0.45 + 0.5 * max(dot(nb, dome), 0.0) + rivet * 0.6;
      E += MELT * 0.35 * (1.0 - smoothstep(0.0, 0.8, gy));
      spec = vec3(1.0, 0.8, 0.55) * pow(max(dot(nb, dome), 0.0), 12.0) * 0.12 * (bar + rails) * (1.0 - chip);
    } else {
      // The side: woven mesh on a frame.
      float wz = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, abs(fract(q.z / 0.09) - 0.5) * 0.09);
      float wy = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, abs(fract(gy / 0.09) - 0.5) * 0.09);
      float post = step(CR - 0.07, abs(q.z));
      float frame = post + 1.0 - smoothstep(0.03 - aa, 0.03 + aa, abs(gy - 1.05));
      cov = clamp(max(max(wz, wy) * 0.9, frame), 0.0, 1.0);
      a = mix(vec3(0.06), vec3(0.62, 0.43, 0.05), post);
    }
    col = mix(col, a * E + spec, cov);

    // --- brake sparks, shed off the shoes and raining down the gap -----------
    // In the braking cage's frame they fall at g plus the deceleration.
    if (brake > 0.01) {
      for (int i = 0; i < 20; i++) {
        float fi = float(i);
        float h = hash21(vec2(fi, 7.0));
        float life = 0.45 + 0.3 * h;
        float age = fract(iTime / life + h) * life;
        float gen = floor(iTime / life + h);
        float r1 = hash21(vec2(fi, gen));
        float r2 = hash21(vec2(gen, fi + 3.0));
        vec3 e = vec3(fi < 10.0 ? -1.25 : 1.55, yf + 0.05, SR - 0.28);
        vec3 v0 = vec3((r1 - 0.5) * 3.0, 1.5 * r2, -0.4 - 1.2 * r1);
        float ab = max(age - 0.05, 0.0);
        vec3 r0 = e + v0 * age - vec3(0.0, 13.5 * age * age, 0.0) - ro;
        vec3 rb = e + v0 * ab - vec3(0.0, 13.5 * ab * ab, 0.0) - ro;
        float z0 = dot(r0, fwd), zb = dot(rb, fwd);
        if (z0 > 0.1 && zb > 0.1) {
          vec2 s0 = vec2(dot(r0, right), dot(r0, up)) / z0 * 1.05;
          vec2 ba = vec2(dot(rb, right), dot(rb, up)) / zb * 1.05 - s0;
          vec2 pa = uv - s0;
          float dsp = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0));
          col += vec3(3.0, 1.4, 0.35) * (exp(-dsp * dsp * 6e4) * 1.6 + exp(-dsp * 90.0) * 0.08)
            * (1.0 - age / life) * brake;
        }
      }
    }

    // --- grade: filmic, vignette, grain ---------------------------------------
    col *= 1.6;
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    col *= 1.0 - smoothstep(0.35, 0.95, length(uv)) * 0.55;
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`

// perf: expensive. 96 raymarch steps x (hall + deployed machinery + props +
// portal + shaft + cage + 6 quaternion-rotated debris boxes + 8 folding cubes),
// the steam and the leaks gathered along the way, then nine texture reads for
// the triplanar Δ material at the hit. The bounding-sphere rejects, the ceiling
// test that skips the whole corridor while you are up the shaft, and the
// shaft/span distance gates keep the common case near the cost of the corridor
// alone. One draw call, three texture arrays, no render targets.
