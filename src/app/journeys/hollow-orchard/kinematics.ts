// THE HOLLOW ORCHARD — the descent timeline.
//
// Twelve stages on one 660-unit loop: six scapes you walk (THE NURSERY through
// TRANSITION), then six setpieces you fall through (THE BLOOM through COMPOST).
// Unlike app/journeys/liminal, none of this table is mirrored in GLSL — the
// simulation uploads the answer as uniforms every frame, so the shader owns
// geometry and nothing else. That is the whole reason this journey is built on
// `JourneySimulation` rather than a `getSectionName(time)` lookup: walk speed
// varies per stage, so z is an *integral*, not `time * SPEED`.
//
// Three things carry the horror arc, all continuous, none table-driven:
//   • descent — 0..1 through the abyss band
//   • rot     — 0..1 escalation across loops; drives displacement, wetness,
//               palette sickness and (falling) walk speed
//   • fall    — per-stage pitch amount; the camera never flips, it leans

import type { JourneySimulation } from '@/components/withShaderJourney'
import type { CustomUniforms } from '@/lib/shaderQuad'
import type { JourneyMarks } from '@/lib/journeyTransport'


export function smoothstep (edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function mix (start: number, end: number, t: number): number {
  return start * (1.0 - t) + end * t
}

function mix3 (a: RGB, b: RGB, t: number): RGB {
  return [ mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t) ]
}

export type RGB = [ number, number, number ]

// ---- Stage ids (mirrored as plain float comparisons in the shader) ----

export const STAGE_NURSERY   = 1
export const STAGE_CATHEDRAL = 2
export const STAGE_MARROW    = 3
export const STAGE_ROOTS     = 4
export const STAGE_FRUITING  = 5
export const STAGE_TRANSIT   = 6
export const STAGE_BLOOM     = 7
export const STAGE_HOST      = 8
export const STAGE_HARVEST   = 9
export const STAGE_MYCELIAL  = 10
export const STAGE_SEEDVAULT = 11
export const STAGE_COMPOST   = 12

export const ORCHARD_LOOP_Z = 660.0
export const ABYSS_START_Z  = 530.0
export const ABYSS_LEN      = ORCHARD_LOOP_Z - ABYSS_START_Z // 130
export const ABYSS_SLOTS    = 6
export const SCAPE_W        = 12.0 // scape -> scape crossfade, world units
export const PIECE_W        = 0.30 // setpiece crossfade, fraction of a slot
export const STALL_LOOP     = 3 // loop at which COMPOST stops letting you leave

// ---- the route ------------------------------------------------------------
//
// The twelve stages are all authored around a straight +Z axis, and for a long
// time that is exactly what you walked: a 660-unit corridor with a sine wobble
// on top, which reads as a treadmill. The route bends instead, and it bends by
// warping the *domain* rather than by re-authoring any geometry — the shader
// offsets x by `pathX(z)` before it evaluates a stage, so walls, trunks, shafts
// and floors all snake together and the camera simply rides the centreline.
//
// Two constraints fix the numbers:
//
//  1. Both harmonics must complete a whole number of cycles per loop, or the
//     world fails to close at the seam and z = 660 lands somewhere z = 0 isn't.
//     Hence the frequencies are integer multiples of 2*pi / ORCHARD_LOOP_Z.
//  2. The shear inflates the shader's distance estimate by up to
//     `(sqrt(s^2 + 4) + s) / 2` for a slope s, and the march has to stay under
//     the reciprocal of that or it steps through walls. s peaks at 0.95 here
//     (a 43 degree heading swing), so the march runs at 0.48 rather than 0.55.
export const PATH_K1 = Math.PI * 2 / ORCHARD_LOOP_Z * 2 // two long sweeps a loop
export const PATH_A1 = 32.0
export const PATH_K2 = Math.PI * 2 / ORCHARD_LOOP_Z * 5 // five tighter kinks
export const PATH_A2 = 7.0

/** Lateral offset of the route centreline at a distance along it. */
export function pathX (z: number): number {
  return Math.sin(z * PATH_K1) * PATH_A1 + Math.sin(z * PATH_K2) * PATH_A2
}

/** Its slope — the tangent of the heading, so the camera can face down it. */
export function pathDX (z: number): number {
  return Math.cos(z * PATH_K1) * PATH_A1 * PATH_K1 +
         Math.cos(z * PATH_K2) * PATH_A2 * PATH_K2
}

/** Its curvature, up to a factor — what the camera banks into. */
export function pathDDX (z: number): number {
  return -Math.sin(z * PATH_K1) * PATH_A1 * PATH_K1 * PATH_K1 -
       Math.sin(z * PATH_K2) * PATH_A2 * PATH_K2 * PATH_K2
}

// ---- the aisle ------------------------------------------------------------
//
// Turning is only half of it. Every stage that repeats a cell puts something at
// the centre of that cell — a sapling in THE NURSERY, a stem in the CATHEDRAL,
// a pod in the SEED VAULT — and the route walks straight down x = 0, which is
// exactly where those centres are. So the camera has always been passing through
// solid geometry several times a second.
//
// Rather than dodging twelve different layouts by hand, the route bores its own
// aisle: the scene is intersected with the complement of a capsule swept along
// the walked line. It cannot fail to clear the camera, because it is defined by
// where the camera goes, and an orchard with a row eaten through it is the
// reading this journey wants anyway.
export const AISLE_R  = 0.95 // radius around the walked line
export const AISLE_DY = 0.35 // how far below the eye the capsule is centred
export const AISLE_HY = 0.45 // half-height of its straight part

export interface OrchardStage {

  /** 1..12; matches the STAGE_* constants and the shader's if-chain. */
  id:   number;
  name: string;

  /** Band length in world units. Abyss slots ignore this (they split ABYSS_LEN evenly). */
  len: number;

  /** Camera height above the local floor. The shader anchors its floor at y = 0. */
  eye: number;

  /** Base walk/fall speed in units per second. */
  speed: number;

  /** 0..1 pitch-down amount — how much this stage reads as falling rather than walking. */
  fall: number;

  /** Lateral sway amplitude. */
  sway: number;

  /** Fog / horizon colour. */
  bg: RGB;

  /** Key light colour. */
  key: RGB;

  /** Subsurface tint — what light looks like coming *through* the flesh. */
  tint: RGB;
}

// Index = id - 1. The six scape lengths sum to ABYSS_START_Z (530).
export const ORCHARD_STAGES: OrchardStage[] = [
  {
    id:    STAGE_NURSERY,
    name:  'SECTOR 1: THE NURSERY',
    len:   90.0,
    eye:   1.70,
    speed: 7.5,
    fall:  0.0,
    sway:  0.5,
    bg:    [ 0.09, 0.075, 0.045 ],
    key:   [ 1.00, 0.86, 0.58 ],
    tint:  [ 0.92, 0.78, 0.50 ],
  },
  {
    id:    STAGE_CATHEDRAL,
    name:  'SECTOR 2: SPORE CATHEDRAL',
    len:   100.0,
    eye:   1.80,
    speed: 5.5,
    fall:  0.0,
    sway:  0.8,
    bg:    [ 0.075, 0.055, 0.070 ],
    key:   [ 1.00, 0.78, 0.42 ],
    tint:  [ 0.95, 0.62, 0.38 ],
  },
  {
    id:    STAGE_MARROW,
    name:  'SECTOR 3: MARROW GROVE',
    len:   90.0,
    eye:   1.65,
    speed: 7.0,
    fall:  0.0,
    sway:  0.6,
    bg:    [ 0.060, 0.058, 0.075 ],
    key:   [ 0.92, 0.92, 0.86 ],
    tint:  [ 0.88, 0.80, 0.72 ],
  },
  {
    id:    STAGE_ROOTS,
    name:  'SECTOR 4: THE ROOT LABYRINTH',
    len:   100.0,
    eye:   1.15,
    speed: 4.0,
    fall:  0.0,
    sway:  1.1,
    bg:    [ 0.030, 0.022, 0.030 ],
    key:   [ 0.72, 0.52, 0.30 ],
    tint:  [ 0.60, 0.34, 0.22 ],
  },
  {
    id:    STAGE_FRUITING,
    name:  'SECTOR 5: FRUITING BODY',
    len:   90.0,
    eye:   1.40,
    speed: 3.2,
    fall:  0.0,
    sway:  0.7,
    bg:    [ 0.075, 0.028, 0.038 ],
    key:   [ 1.00, 0.55, 0.48 ],
    tint:  [ 1.00, 0.38, 0.34 ],
  },
  {
    id:    STAGE_TRANSIT,
    name:  'SECTOR 6: TRANSITION',
    len:   60.0,
    eye:   1.60,
    speed: 6.0,
    fall:  0.15,
    sway:  1.4,
    bg:    [ 0.040, 0.028, 0.050 ],
    key:   [ 0.85, 0.62, 0.55 ],
    tint:  [ 0.72, 0.42, 0.60 ],
  },

  // ---- The abyss. Six evenly-split slots across ABYSS_LEN. ----
  {
    id:    STAGE_BLOOM,
    name:  'THE ABYSS — THE BLOOM',
    len:   0.0,
    eye:   1.20,
    speed: 5.0,
    fall:  0.90,
    sway:  1.8,
    bg:    [ 0.090, 0.040, 0.020 ],
    key:   [ 1.00, 0.66, 0.30 ],
    tint:  [ 1.00, 0.46, 0.22 ],
  },
  {
    id:    STAGE_HOST,
    name:  'THE ABYSS — HOST',
    len:   0.0,
    eye:   1.75,
    speed: 4.0,
    fall:  0.30,
    sway:  0.9,
    bg:    [ 0.045, 0.030, 0.055 ],
    key:   [ 0.88, 0.70, 0.62 ],
    tint:  [ 0.95, 0.40, 0.42 ],
  },
  {
    id:    STAGE_HARVEST,
    name:  'THE ABYSS — THE HARVEST',
    len:   0.0,
    eye:   1.60,
    speed: 4.5,
    fall:  0.10,
    sway:  1.2,
    bg:    [ 0.055, 0.038, 0.022 ],
    key:   [ 0.96, 0.74, 0.40 ],
    tint:  [ 0.90, 0.50, 0.28 ],
  },
  {
    id:    STAGE_MYCELIAL,
    name:  'THE ABYSS — MYCELIAL FALL',
    len:   0.0,
    eye:   0.90,
    speed: 12.0,
    fall:  1.00,
    sway:  2.4,
    bg:    [ 0.020, 0.016, 0.032 ],
    key:   [ 0.80, 0.84, 1.00 ],
    tint:  [ 0.66, 0.72, 1.00 ],
  },
  {
    id:    STAGE_SEEDVAULT,
    name:  'THE ABYSS — SEED VAULT',
    len:   0.0,
    eye:   1.50,
    speed: 5.0,
    fall:  0.20,
    sway:  0.6,
    bg:    [ 0.038, 0.026, 0.048 ],
    key:   [ 0.86, 0.72, 0.52 ],
    tint:  [ 0.78, 0.48, 0.66 ],
  },
  {
    id:    STAGE_COMPOST,
    name:  'THE ABYSS — COMPOST',
    len:   0.0,
    eye:   1.30,
    speed: 2.5,
    fall:  0.60,
    sway:  1.0,
    bg:    [ 0.014, 0.011, 0.016 ],
    key:   [ 0.44, 0.36, 0.30 ],
    tint:  [ 0.40, 0.24, 0.28 ],
  },
]

function stage (id: number): OrchardStage {
  return ORCHARD_STAGES[Math.max(0, Math.min(ORCHARD_STAGES.length - 1, id - 1))]
}

// Cumulative start of each scape band, so getOrchardState stays a lookup.
const SCAPE_STARTS: number[] = (() => {
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < 6; i++) {
    starts.push(acc)
    acc += ORCHARD_STAGES[i].len
  }
  return starts
})()

export interface OrchardState {

  /** Total distance walked. CPU-only — never uploaded (highp loses it after ~10 min). */
  z: number;

  /** z wrapped into one loop. This is what the shader sees. */
  loopZ:    number;
  loop:     number;
  stageA:   number;
  stageB:   number;
  blend:    number;
  localZ:   number;
  stageLen: number;

  /** 0..1 through the abyss band, 0 while still walking a scape. */
  descent: number;

  /** 0..1 decay escalation; grows with loop count and abyss progress. */
  rot: number;

  /** Integrated walk speed for this frame. */
  speed: number;

  camX: number;
  eyeY: number;

  /** Blended lateral sway amplitude — the aisle has to follow the same track. */
  sway:  number;
  fall:  number;
  yaw:   number;
  pitch: number;
  roll:  number;
  bob:   number;

  /** Lung phase 0..1 — the walls inhale on this, and so does the audio. */
  breath: number;
  spore:  number;
  wet:    number;
  glow:   number;

  bg:   RGB;
  key:  RGB;
  tint: RGB;

  name: string;
}

/**
 * The whole timeline as a pure function of distance walked.
 *
 * Both branches emit the same `(stageA, stageB, blend)` triple, so the shader
 * has exactly one dispatch path: evaluate A, and evaluate B only when the
 * crossfade is actually open.
 */
export function getOrchardState (z: number): OrchardState {
  const loop  = Math.floor(z / ORCHARD_LOOP_Z)
  const loopZ = z - loop * ORCHARD_LOOP_Z

  let stageA   = STAGE_NURSERY
  let stageB   = STAGE_NURSERY
  let blend    = 0.0
  let localZ   = loopZ
  let stageLen = ORCHARD_STAGES[0].len
  let descent  = 0.0

  if (loopZ < ABYSS_START_Z) {
    // --- Walking a scape. Crossfade over the last SCAPE_W units of the band. ---
    let idx = 0
    for (let i = 5; i >= 0; i--)
      if (loopZ >= SCAPE_STARTS[i]) {
        idx = i
        break
      }
    stageA   = idx + 1
    stageB   = idx + 2 // TRANSITION (6) hands over to THE BLOOM (7) — ids are contiguous
    stageLen = ORCHARD_STAGES[idx].len
    localZ   = loopZ - SCAPE_STARTS[idx]
    blend    = smoothstep(stageLen - SCAPE_W, stageLen, localZ)
  }
  else {
    // --- Falling through the abyss. Six evenly-split slots. ---
    const abyssZ = loopZ - ABYSS_START_Z
    descent      = abyssZ / ABYSS_LEN

    const slotLen = ABYSS_LEN / ABYSS_SLOTS
    const slotF   = descent * ABYSS_SLOTS
    const slot    = Math.min(ABYSS_SLOTS - 1, Math.floor(slotF))
    const frac    = slotF - slot

    stageA   = STAGE_BLOOM + slot
    stageB   = STAGE_BLOOM + Math.min(slot + 1, ABYSS_SLOTS - 1)
    blend    = smoothstep(1.0 - PIECE_W, 1.0, frac)
    localZ   = frac * slotLen
    stageLen = slotLen
  }

  const a = stage(stageA)
  const b = stage(stageB)

  // Decay escalation. Loops stack it; the abyss adds the rest within a loop.
  const rot = Math.min(1.0, loop * 0.33 + descent * 0.22)

  const eyeY = mix(a.eye, b.eye, blend)
  const fall = mix(a.fall, b.fall, blend)
  const sway = mix(a.sway, b.sway, blend)

  // The stall: once COMPOST has come around STALL_LOOP times it stops handing
  // you back to THE NURSERY. Speed reaches exactly zero before the band ends, so
  // z freezes and `loop` never increments again — liminal's endless finale with
  // no special case in the state machine, just an integrand that hits 0.
  // Everything else (breath, spores, iTime) keeps running: you stop, it doesn't.
  const stalled = loop >= STALL_LOOP && stageA === STAGE_COMPOST
  let speed     = mix(a.speed, b.speed, blend) * mix(1.0, 0.78, rot)
  if (stalled)
    speed = mix(speed, 0.0, smoothstep(0.86, 0.955, descent))

  // Breathing quickens in FRUITING BODY and HOST, and with rot.
  const fleshy    = stageA === STAGE_FRUITING || stageA === STAGE_HOST ? 1.0 : 0.0
  const breathHz  = mix(0.22, 0.52, Math.max(fleshy, rot * 0.6))
  const breath    = 0.5 + 0.5 * Math.sin(z * breathHz * 0.14)
  const breathAmp = 0.35 + 0.65 * Math.max(fleshy, rot)

  return {
    z,
    loopZ,
    loop,
    stageA,
    stageB,
    blend,
    localZ,
    stageLen,
    descent,
    rot,
    speed,
    // Lateral position *within* the bent frame — the shader adds pathX(z) to it
    // to get world x, and centres the aisle on the same track.
    camX:  Math.sin(loopZ * 0.055) * sway + Math.sin(loopZ * 0.017) * sway * 0.6,
    eyeY,
    sway,
    fall,
    // Face down the route. The wobble that used to be the entire heading is
    // still here, now riding on top of a real turn.
    yaw:   Math.atan(pathDX(loopZ)) + Math.sin(loopZ * 0.021) * 0.10 * sway,
    pitch: -fall * 0.85,
    // Bank into the corner. Curvature, not heading: heading is periodic and
    // would roll the camera to one side for a third of the loop at a time.
    roll:  Math.sin(loopZ * 0.013) * 0.06 +
          fall * 0.10 * Math.sin(loopZ * 0.09) +
          Math.max(-0.11, Math.min(0.11, pathDDX(loopZ) * 7.0)),
    bob:    Math.abs(Math.sin(loopZ * 0.55)) * 0.09 * (1.0 - fall) - 0.04,
    breath: breath * breathAmp,
    spore:  clamp01(0.15 + fleshy * 0.25 + rot * 0.55 + (stageA === STAGE_CATHEDRAL ? 0.5 : 0)),
    wet:    clamp01(fleshy * 0.8 + rot * 0.5 + (stageA === STAGE_ROOTS ? 0.25 : 0)),
    glow:   clamp01(descent * 0.6 + rot * 0.4),
    // Palette lerps on the CPU so the shader carries no colour table at all,
    // then slides toward bruised violet as the rot escalates.
    bg:     mix3(mix3(a.bg, b.bg, blend), [ 0.055, 0.020, 0.075 ], rot * 0.55),
    key:    mix3(a.key, b.key, blend),
    tint:   mix3(mix3(a.tint, b.tint, blend), [ 0.72, 0.28, 0.85 ], rot * 0.4),
    name:   stalled && speed < 0.05 ? 'THE ABYSS — COMPOST (STOPPED)' : blend < 0.5 ? a.name : b.name,
  }
}

function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** HUD label. Loops are counted from 1 the way the other journeys count them. */
export function labelFor (state: OrchardState): string {
  return state.loop > 0 ? `LOOP ${state.loop + 1} · ${state.name}` : state.name
}

/**
 * One simulation instance per mount. The HOC steps it on the shared frame-capped
 * loop and reads uniforms() immediately after, so the shader always renders the
 * state this frame's integration produced.
 */
export function createHollowOrchardSimulation (): JourneySimulation {
  let z     = 0
  let state = getOrchardState(0)

  // Packed in place every frame, never reallocated.
  const uStage = [ 0, 0, 0, 0 ]
  const uWalk  = [ 0, 0, 0, 0 ]
  const uCam   = [ 0, 0, 0, 0 ]
  const uLook  = [ 0, 0, 0, 0 ]
  const uPulse = [ 0, 0, 0, 0 ]
  const uAisle = [ 0, 0, 0, 0 ]

  // The route's shape, uploaded rather than duplicated in GLSL. The shader needs
  // pathX at every *marched* z, not just the camera's, so it cannot be a scalar
  // — but it can be the four coefficients the CPU authored it from.
  const uPath = [ PATH_A1, PATH_K1, PATH_A2, PATH_K2 ]

  return {
    step (dt: number) {
      // Integrate before sampling: speed is a property of where you already are.
      z    += state.speed * Math.min(dt, 0.1)
      state = getOrchardState(z)
    },

    uniforms (): CustomUniforms {
      uStage[0] = state.stageA
      uStage[1] = state.stageB
      uStage[2] = state.blend
      uStage[3] = state.localZ

      // loopZ, not z: the world is periodic, so staying inside one lap costs no
      // mantissa precision after an hour of walking.
      uWalk[0] = state.loopZ
      uWalk[1] = state.loop
      uWalk[2] = state.descent
      uWalk[3] = state.rot

      uCam[0] = state.camX
      uCam[1] = state.eyeY
      uCam[2] = state.fall
      uCam[3] = state.stageLen

      uLook[0] = state.yaw
      uLook[1] = state.pitch
      uLook[2] = state.roll
      uLook[3] = state.bob

      uPulse[0] = state.breath
      uPulse[1] = state.spore
      uPulse[2] = state.wet
      uPulse[3] = state.glow

      uAisle[0] = state.sway
      uAisle[1] = AISLE_R
      uAisle[2] = state.eyeY - AISLE_DY
      uAisle[3] = AISLE_HY

      return {
        uStage,
        uWalk,
        uCam,
        uLook,
        uPulse,
        uPath,
        uAisle,
        uBg:   state.bg,
        uKey:  state.key,
        uTint: state.tint,
      }
    },

    label () {
      return labelFor(state)
    },

    /** Twelve stages on one 660-unit loop; STAGE_COMPOST is the last, so it is also the count. */
    marks (): JourneyMarks {
      return {
        loop:         state.loop,
        section:      state.stageA,
        sectionCount: STAGE_COMPOST,
        progress:     state.loopZ / ORCHARD_LOOP_Z,
      }
    },
  }
}
