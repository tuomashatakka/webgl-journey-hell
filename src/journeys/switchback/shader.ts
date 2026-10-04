// THE SWITCHBACK — six rooms seen from a mine cart that never stops.
//
// Single pass via lib/gl/shaderQuad.ts, driven by createSwitchbackSimulation in
// kinematics.ts. WebGL 1.0 / GLSL ES 1.00: constant loop bounds only, no switch,
// no `tanh` (that is ES 3.00 — there is a two-line one below), and uniform arrays
// may only be indexed by a *constant-index-expression*. That last one is why no
// function here takes a slot index: they take the three vec4s, and the indexing
// happens at the call site under the loop counter. A function parameter is not a
// constant-index-expression, however reliably the compiler inlines it.
//
// ---------------------------------------------------------------------------
// Everything here is straight
// ---------------------------------------------------------------------------
//
// The camera sits at the origin looking down +Z and never moves. The track is
// the +Z axis. The real railway's curve arrives as four floats — see the long
// note at the top of kinematics.ts — and a point is looked up at
// `p.xy - bend(p.z)`. So rails, sleepers, trestle bents and lamps are lattices
// along a straight axis, which is the cheapest geometry there is, and the
// hardest question the other journeys in this repo had to answer (how does a
// point in one room get expressed in another's frame?) does not exist: there is
// one frame and every room is a range of z in it.
//
// Two consequences worth stating, because both were bugs elsewhere:
//
//   * natatorium's `resolveSlot` rule — shading must work out *whose* room it
//     hit, not assume the camera's — still holds, and every lighting term below
//     resolves the room from the point's own depth. But the frame-rotation half
//     of that bug is structurally impossible here, since a point's coordinates
//     never depend on which room owns it.
//   * "nothing added to the SDF may enter the walked tube" is trivial when the
//     walked tube is the +Z axis. CLEAR_* below is a cross-section, subtracted
//     from every prop, and it cannot fail to clear the cart.
//
// SDF discipline is natatorium's, unchanged: rooms are carved by unioning air
// volumes and negating, with `min` and `max` only. `smin` returns up to k/4
// *below* its inputs, so negating a smoothed union over-estimates and a grazing
// ray at a portal punches through the rock.
//
// ---------------------------------------------------------------------------
// Two spaces, and which one everything lives in
// ---------------------------------------------------------------------------
//
// *Track space* is where the world is: rail head at y = 0, track along +Z, the
// cart's eye at (0, eye, 0). `mapTrack` is the scene, it is built from exact
// primitives, and it is genuinely 1-Lipschitz. Shadows, occlusion, normals and
// every lighting term run here, natively, with no correction of any kind.
//
// *Camera space* exists only for the primary march, because that is the one
// place a ray has to be straight. `mapScene(p) = mapTrack(toTrack(p)) / k(z)`,
// where the divisor is the shear's Lipschitz bound: for T(p) = (p.xy - bend(z), z)
// the Jacobian is the identity plus bend'(z) in one column, so |grad(f o T)| is
// at most 1 + |bend'(z)| and dividing by that is provably conservative. It is a
// function of z, so near geometry marches at full speed and only the far end of
// a hard turn pays.
//
// The hit point crosses over once, exactly, via toTrack — which is exact, not an
// approximation — and after that nothing downstream knows the bend exists. Doing
// it the other way round (shading in camera space) means every normal is the
// gradient of the *sheared* field and every light direction is wrong by an angle
// that grows down the hall.
//
// Uniforms (see kinematics.ts `uniforms()`), three slots each:
//   uSecA[i] (z0, z1, type, bore)      section bounds as depth ahead of the cart
//   uSecB[i] (ceilH, floorD, lampPitch, grime)
//   uSecC[i] (sky, id, lit, -)
//   uBend    (ax, bx, ay, by)          bend(z) = (ax*z+bx*z*z, ay*z+by*z*z)
//   uCart    (phase, speed, lapF, eye)
//   uRide    (lookYaw, lookPitch, headRoll, sky)
//   uAtm     (lightFail, decay, grade, bank)
//   uSun     (sun direction in the track's frame, intensity)
//   uUp      (world up in the track's frame, sky of the current room)

import { HASH21 } from '@wjh/glsl/hash'
import { foundationGlsl } from './glsl/foundation'
import { roomsGlsl } from './glsl/rooms'
import { sceneGlsl } from './glsl/scene'
import { skyAndRoomsGlsl } from './glsl/skyAndRooms'
import { surfacesGlsl } from './glsl/surfaces'
import { lightingGlsl } from './glsl/lighting'
import { mainGlsl } from './glsl/main'


const COMMON = foundationGlsl + roomsGlsl + sceneGlsl


const SCENE = skyAndRoomsGlsl + surfacesGlsl + lightingGlsl + mainGlsl

export const switchbackFrag = COMMON + SCENE

// Hover preview. Self-driving from iTime alone: the index's CRT attaches no
// simulation, so uBend/uCart/uSec would all read zero and the real shader would
// render one flat frame forever. No raymarch either — every card in the grid
// shares a single GL context. The job is to read as "you are in a mine cart" at
// 300px, which is what two rails converging into a headlamp pool, sleepers
// whipping under the nose, and the nose itself do, in that order.
export const switchbackPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  ${HASH21}

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.07;

    // The track sweeps as it would under a bend and dives as it would on a drop.
    float sweep = sin(iTime * 0.42) * 0.30;
    float horizon = 0.16 + cos(iTime * 0.31) * 0.10 - 0.02;

    float fy = max(horizon - uv.y, 1e-3);

    // Perspective floor out of one divide: depth runs to infinity at the horizon,
    // exactly as the real thing does.
    float depth = 0.55 / fy;
    float run = depth + iTime * 5.2;
    float lateral = (uv.x + sweep * depth * 0.10) * depth;

    vec3 col;

    if (uv.y > horizon) {
      float arch = length(vec2(uv.x * 1.25, (uv.y - horizon) * 0.9));
      col = mix(vec3(0.10, 0.09, 0.085), vec3(0.020, 0.018, 0.026), smoothstep(0.12, 0.62, arch));
      col += vec3(1.00, 0.72, 0.40) * smoothstep(0.55, 0.30, arch) * 0.10;
    }
    else {
      float grit = hash21(floor(vec2(lateral * 3.0, run * 3.0)));
      col = mix(vec3(0.20, 0.18, 0.16), vec3(0.10, 0.09, 0.08), grit);

      float tie = smoothstep(0.30, 0.16, abs(fract(run * 0.42) - 0.5) * 2.0 - 0.42);
      tie *= smoothstep(2.6, 2.2, abs(lateral));
      col = mix(col, vec3(0.26, 0.19, 0.12), tie);

      float rail = smoothstep(0.14, 0.03, abs(abs(lateral) - 1.05));
      col = mix(col, vec3(0.62, 0.63, 0.66), rail * 0.9);
      col += vec3(1.0, 0.86, 0.62) * rail * smoothstep(6.0, 1.2, depth) * 0.55;

      col *= smoothstep(15.0, 1.0, depth) * 1.5 + 0.06;
    }

    // The nose of the cart, always in frame.
    float edge = -0.30 - abs(uv.x) * 0.045;
    col = mix(col, vec3(0.15, 0.19, 0.17), smoothstep(0.0, 0.02, edge - uv.y));
    col = mix(col, vec3(0.34, 0.38, 0.35), smoothstep(0.02, 0.0, abs(uv.y - edge) - 0.012));

    // Dust in the beam.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 m = uv * (2.4 + fi) + vec2(sin(iTime * 0.3 + fi) * 0.4, -iTime * (0.15 + fi * 0.08));
      vec2 id = floor(m);
      float h = hash21(id + fi * 17.0);
      if (h > 0.28) continue;
      float r = length(fract(m) - 0.5 - (vec2(hash21(id + 3.0), hash21(id + 7.0)) - 0.5) * 0.6);
      col += vec3(0.9, 0.82, 0.7) * smoothstep(0.14, 0.03, r) * 0.16;
    }

    col *= 1.0 - smoothstep(0.4, 1.15, length(uv)) * 0.55;
    col = col * (1.0 + col / 4.0) / (1.0 + col);
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 51.7) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`
