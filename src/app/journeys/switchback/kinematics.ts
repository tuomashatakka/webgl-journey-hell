// THE SWITCHBACK — the ride.
//
// A mine cart on a gravity railway through six dreamcore rooms. The cart is
// never driven: it is braked, chained up two lift hills, and otherwise falls.
// Speed is therefore an *integral* and has no closed form, which is exactly the
// case withShaderJourney's createSimulation exists for.
//
// ---------------------------------------------------------------------------
// The third way of turning
// ---------------------------------------------------------------------------
//
// This repo already has two answers to "how do you turn forever without cost or
// float precision growing":
//
//   stairwell   re-anchors in GLSL — three sections resident, each rotated into
//               the camera's frame, turn table in the shader.
//   natatorium  moves that table to the CPU and uploads the affine transform per
//               resident section, so turns are data and can be any angle.
//
// Both model a route as a *chain of straight rooms*. A rail is not that. A
// coaster's defining quantity is curvature — it is continuous, it is what banks
// the car, and chopping it into straight segments with joins is precisely what
// you must not do. So this journey rectifies instead:
//
//   **The camera never moves and never rotates. The world bends around it.**
//
// The shader marches in a space where the track is the +Z axis, dead straight,
// with the cart at the origin. The real curve is carried by one quadratic:
//
//     bend(z) = (ax*z + bx*z*z,  ay*z + by*z*z)
//
// uploaded every frame, and a point p is looked up at `p.xy - bend(p.z)`. Four
// floats hold the entire visible shape of the track — the sweep of a banked
// turn, the pitch of a drop — and rails, sleepers and trestles become domain
// repetition along a straight axis, which is as cheap as geometry gets.
//
// Three things fall out of that:
//
//   * **There is no world position at all.** Not a small one, like natatorium's
//     section-local coordinates: none. The camera is the origin by construction,
//     so no coordinate can drift, ever, and `?t=100000` is as exact as `?t=1`.
//     What the CPU integrates is a heading *field* over arc length, and it only
//     ever evaluates it relative to where the cart already is.
//   * **A bend is a shear, so it stretches distance,** and a sphere trace that
//     ignores that will punch through walls. The Lipschitz correction is exact
//     and lives in the shader: for T(p) = (p.xy - bend(p.z), p.z), the Jacobian
//     is the identity plus bend'(z) in one column, so |grad| <= 1 + |bend'(z)|
//     and dividing by that is provably conservative. It costs one length() per
//     map call and it is z-dependent — near geometry marches at full speed, and
//     only the far end of a hard turn pays.
//   * **Rectification has a range limit.** A track that turns 90 degrees inside
//     the view distance leaves the +Z half-space and no quadratic can follow it
//     out. That is what MAX_CURV is: a floor on the turn radius, asserted over
//     the whole table. It is not much of a constraint in practice, because a
//     coaster's turns are wide *because* it is fast — 62 metres of radius at 20
//     m/s is still 0.9g in your ribs.
//
// ---------------------------------------------------------------------------
// Banking, and why you can only see it out of doors
// ---------------------------------------------------------------------------
//
// The car is bolted to the rail, so when the track banks, the rider does not
// rotate relative to it — the *world* does. So bent space is the track's frame
// (rails always level in it) and the bank is carried entirely by where world-up
// and the sun point, which is `uUp` and `uSun`. The honest consequence is that
// inside a tunnel a banked turn is invisible, exactly as it is in a real POV
// video, and the moment the walls fall away over the void the whole sky rolls.
//
// A small fraction of the bank is fed back into the ray basis as `headRoll`,
// because a rider's head does lag the car, and because it is the shot.

import type { JourneySimulation } from '@/components/withShaderJourney'
import type { CustomUniforms } from '@/lib/shaderQuad'
import type { JourneyMarks } from '@/lib/journeyTransport'


const D = Math.PI / 180

export function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function mix (a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

export function smoothstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Quintic smoothstep — zero first *and* second derivative at both ends.
 *
 * Every turn and every grade change in the table is eased with this and nothing
 * else, which is what makes the whole railway C2 by construction. Curvature is
 * a first derivative of the eased quantity, so it vanishes at every beat
 * boundary; the bank angle is a function of curvature, so the car cannot snap
 * into or out of a roll at a join. The route table has no way to express a
 * kink, so nobody can author one.
 */
export function smootherstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** d/dt of smootherstep on the unit interval. Peaks at 15/8 in the middle. */
function dSmootherstep (t: number): number {
  const u = clamp01(t)
  return 30 * u * u * (u - 1) * (u - 1)
}

/** The peak-to-mean ratio of the above. Curvature caps are stated against it. */
const EASE_PEAK = 1.875

// ---- room types, read by the shader's material branch ---------------------

export const TYPE_PLATFORM  = 0 // fluorescent boarding station, wet tile
export const TYPE_DRIFT     = 1 // hand-cut chalk adit, timber sets, dust
export const TYPE_SCAFFOLD  = 2 // steel lattice suspended in nothing
export const TYPE_CONCOURSE = 3 // carpeted mall interior at sunset
export const TYPE_CHAPEL    = 4 // folded stone, god-rays, no floor plan
export const TYPE_OVERLOOK  = 5 // open sky over a cloud sea, drifting ash

export interface Section {
  id:   number;
  name: string;

  /** Arc length of the section, metres. */
  len: number;

  /** Surface treatment; one of the TYPE_* constants. */
  type: number;

  /**
   * Yaw delta per beat, radians. The section is divided into `turn.length` equal
   * beats and each one's turn is eased across it with smootherstep. Positive is
   * a right-hand turn (toward the camera's +x).
   */
  turn: number[];

  /**
   * Track grade in radians at each beat *boundary*, so this is one longer than
   * `turn`. Positive climbs. grade[0] of a section must equal grade[last] of the
   * one before it — that single rule is the whole of tangent continuity, and
   * assertRouteSane checks it cyclically.
   */
  grade: number[];

  /**
   * Per-beat chain speed in m/s, or 0 to run free. A value below the cart's
   * current speed is a brake run and a value above it is a lift hill; the
   * integrator does not distinguish, and neither does a real railway.
   */
  lift: number[];

  /** Clear half-width of the bore around the track. OPEN for sections with no walls. */
  bore: number;

  /** Clearance above the rail head. */
  ceilH: number;

  /**
   * How far the floor sits below the rail head, OPEN where there is no floor.
   * Small everywhere it is finite: the ballast berm has to reach it, and a mine
   * railway is laid *on* the floor. A raised boarding platform is a prop.
   */
  floorD: number;

  /** Lamp pitch along the track. Must divide PHASE_WRAP — see assertRouteSane. */
  lamp: number;

  /**
   * Height the lamps are mounted at, above the rail head. Authored rather than
   * derived from `ceilH`, because a room with no ceiling still has lamps: the
   * void's work-lights hang off the trestle and the overlook's sit on the
   * handrail stanchions, and deriving them from a four-hundred-metre stand-in
   * ceiling puts both of them in the stratosphere.
   *
   * It is also the one number the geometry and the lighting must agree on. They
   * did not, once, and the drift's bulbs lit the room from inside the roof.
   */
  lampY: number;

  /** How far gone this room is, 0..1 — drives staining, rust and dead lamps. */
  grime: number;

  /** 0 = enclosed, 1 = open to the sky. Blended, so it can fade a roof away. */
  sky: number;
}

/**
 * Stand-in half-width for a section with no walls. Large enough that the bore
 * never intersects anything the eye can reach, small enough that it is still a
 * finite number a sphere trace can step against instead of an infinity that
 * poisons a `min`.
 */
const OPEN = 400

// ---------------------------------------------------------------------------
// The lap
// ---------------------------------------------------------------------------
//
// Read the grade column down the page and it is the ride: you arrive at -20 on
// the brakes, crawl the platform flat, get chained to +16, crest into the chalk,
// fall through the void at -26, cross the concourse near level, get chained up
// again into the chapel at +11, and roll off the overlook back to -20.
//
// The lap does not close in space and does not need to — you cannot see far
// enough to tell, and the whole point of rectifying is that there is no space to
// close in. It closes in *grade*, because that is a tangent and a discontinuous
// tangent is a derailment.
export const SECTIONS: Section[] = [
  {
    id:     1,
    name:   'THE BOARDING PLATFORM',
    len:    72,
    type:   TYPE_PLATFORM,
    turn:   [ 0.16, 0.02, -0.12 ],
    grade:  [ -20 * D, -4 * D, 0, 16 * D ],
    lift:   [ 5.5, 3.0, 3.4 ], // brake · crawl · chain
    bore:   6.0,
    ceilH:  4.6,
    floorD: 0.45,
    lamp:   8,
    lampY:  4.36,
    grime:  0.45,
    sky:    0.0,
  },
  {
    id:     2,
    name:   'THE CHALK DRIFT',
    len:    78,
    type:   TYPE_DRIFT,
    turn:   [ 0.28, -0.30, 0.20 ],
    grade:  [ 16 * D, -1 * D, -9 * D, -14 * D ],
    lift:   [ 3.6, 0, 0 ], // the platform's chain runs on over the crest
    bore:   3.4,
    ceilH:  3.3,
    floorD: 0.38,
    lamp:   8,
    lampY:  2.25,
    grime:  0.60,
    sky:    0.10, // the vents let just enough daylight in to be worse than none
  },
  {
    id:     3,
    name:   'THE SCAFFOLD VOID',
    len:    96,
    type:   TYPE_SCAFFOLD,
    turn:   [ -0.10, 0.27, 0.27, -0.18 ],
    grade:  [ -14 * D, -28 * D, -18 * D, -6 * D, -3 * D ],
    lift:   [ 0, 0, 0, 0 ],
    bore:   OPEN,
    ceilH:  OPEN,
    floorD: OPEN,
    lamp:   16,
    lampY:  3.4,
    grime:  0.75,
    sky:    0.0, // open, but to nothing — there is no sun out there
  },
  {
    id:     4,
    name:   'THE CARPET CONCOURSE',
    len:    84,
    type:   TYPE_CONCOURSE,
    turn:   [ 0.30, 0.30, 0.14 ],
    grade:  [ -3 * D, 3 * D, -1 * D, -7 * D ],
    lift:   [ 0, 0, 0 ],
    bore:   11.0,
    ceilH:  10.5,
    floorD: 0.55,
    lamp:   10,
    lampY:  10.1,
    grime:  0.35,
    sky:    0.30, // clerestory: enough sunset gets in to light the carpet
  },
  {
    id:     5,
    name:   'THE CHAPEL OF FOLDS',
    len:    72,
    type:   TYPE_CHAPEL,
    turn:   [ -0.26, 0.26, -0.14 ],
    grade:  [ -7 * D, 1 * D, 7 * D, 11 * D ],
    lift:   [ 0, 4.2, 4.2 ], // the second chain, and the slowest the ride gets
    bore:   7.5,
    ceilH:  16.0,
    floorD: 0.60,
    lamp:   20,
    lampY:  5.2,
    grime:  0.50,
    sky:    0.12,
  },
  {
    id:     6,
    name:   'THE OVERLOOK',
    len:    90,
    type:   TYPE_OVERLOOK,
    turn:   [ 0.22, -0.24, 0.22, -0.12 ],
    grade:  [ 11 * D, -1 * D, -8 * D, -16 * D, -20 * D ],
    lift:   [ 6.0, 0, 0, 0 ], // the chapel's chain runs on over the crest
    bore:   OPEN,
    ceilH:  OPEN,
    floorD: OPEN,
    lamp:   16,
    lampY:  2.6,
    grime:  0.25,
    sky:    1.0,
  },
]

export const SECTION_COUNT = SECTIONS.length

/** Arc length of one lap. */
export const LAP_LEN = SECTIONS.reduce((acc, s) => acc + s.len, 0)

/**
 * Everything the shader repeats along the track is a lattice, and the phase it
 * repeats against is uploaded folded into [0, PHASE_WRAP). Folding is what stops
 * the phase from growing to five figures and taking the sleepers' float
 * precision with it, and it is invisible *only* because every pitch in the table
 * divides this number exactly — fold by a whole number of cells and no cell
 * moves. assertRouteSane checks that, because the failure mode is the entire
 * railway jumping half a sleeper once every three minutes.
 */
export const PHASE_WRAP = 2560

/** Sleeper pitch, and the bay spacing of the trestle bents. Both divide PHASE_WRAP. */
export const TIE_PITCH  = 2.5
export const BENT_PITCH = 10

/** Eye height above the rail head, sitting in the cart. */
export const EYE = 1.15

/**
 * Smallest turn radius the rectification can carry, as a curvature. A quadratic
 * in z cannot follow a track out of the +Z half-space, so this is a hard
 * property of the technique rather than a taste call: at 1/44 per metre a
 * sustained turn has swung 73 degrees by the far end of the fit, which is about
 * as much as a quadratic can be asked to swallow before the far half of the
 * picture stops being the track and starts being an extrapolation.
 *
 * It is not a limit on how a turn *feels*. Lateral acceleration is v^2/r, so
 * this radius at the speed the void section runs at is 0.9g in your ribs.
 */
const MAX_CURV = 1 / 44

/**
 * ...and how much of a turn the fit may be asked to swallow whole. MAX_CURV
 * bounds the shear at a point, which is a cost. This bounds the *integral* over
 * the range the quadratic is pinned across, which is correctness: a track that
 * swings much past a radian inside the visible range has left the +Z half-space,
 * and no quadratic in z can follow it out of there.
 */
const MAX_WINDOW_TURN = 1.0

const G = 9.81

/** Quadratic drag, per metre. Sets terminal speed on the big drop at ~26 m/s. */
const DRAG = 0.0075

/** Rolling resistance. Small, and the only reason the ride would ever valley. */
const ROLL_RES = 0.010

/**
 * The cart is not allowed to stop, however the physics feels about it. A gravity
 * railway that valleys is a real thing and it is also the end of the journey, so
 * the floor is a cheat and is documented as one.
 */
const V_MIN = 2.4
const V_MAX = 26

// ---------------------------------------------------------------------------
// The pitch-over
// ---------------------------------------------------------------------------
//
// The railway does not decay only in its lamps and its paint. Every lap it also
// tips further over, until the last one is barely a railway at all. The first
// lap is the authored table untouched — that is the reference the rest is heard
// against, and steepening it would just make the ride steep rather than make it
// *get* steep.
//
// The map is a gain and a bias on the authored grade, in angle space. That is
// three separate requirements met by one affine function:
//
//   continuity  — it cannot jump, anywhere, for any g;
//   ordering    — a positive gain cannot reorder two grades, so the beat
//                 authored as the gentlest descent is still the gentlest one on
//                 the fourth lap, it is merely gentle at fifty degrees;
//   tangents    — two sections that agreed on a grade still agree after it, so
//                 the cyclic continuity assertRouteSane checks survives for free.
//
// Slope space is the obvious alternative and it fails the second: tan() runs
// away so fast that the shallow beats stay shallow while the steep ones go
// vertical, and the lap stops being the same lap.

/** Laps over which the railway tips from its authored grades toward vertical. */
export const PITCH_LAPS = 3

/** The steepest descent in the authored table. The scale the ramp is written against. */
const AUTHORED_DROP = 28 * D

/** What a level stretch becomes on the final lap. Nothing stays level. */
const PITCH_BIAS = 50 * D

/** ...and what the steepest authored descent becomes, which fixes the gain. */
const DROP_CEIL = 86 * D

const PITCH_GAIN = (DROP_CEIL - PITCH_BIAS) / AUTHORED_DROP - 1

/**
 * How far the pitch-over has gone at an arc length, 0..1. Reads lapF rather than
 * the integer lap so it arrives as a ramp across THE OVERLOOK — the same seam
 * everything else in this journey degrades across, and the only stretch with no
 * near geometry to pop against.
 */
export function pitchAt (s: number): number {
  return clamp01(lapFAt(s) / PITCH_LAPS)
}

/**
 * One authored grade, tipped over by t of the pitch-over.
 *
 * The first version of this ran descents and climbs through different formulas
 * and gave every descent a floor of fifty-eight degrees, so a grade crossing
 * zero — which the authored table does five times a lap — jumped instantly from
 * level to well past a third of the way to vertical. Measured at over a thousand
 * degrees per metre on the second lap. From inside the cart that is not a steep
 * railway, it is a stutter, and it is on every section boundary in the journey.
 *
 * A gain and a bias cannot do that. Climbs still give up, but as a consequence
 * rather than as a special case: by the last lap the bias has taken the whole
 * profile below level and there is nothing left to lift the cart with, which is
 * why the lap stops closing.
 */
function steepen (g: number, t: number): number {
  if (t <= 0)
    return g

  return Math.max(-DROP_CEIL, g * (1 + t * PITCH_GAIN) - t * PITCH_BIAS)
}

// ---------------------------------------------------------------------------
// The fall
// ---------------------------------------------------------------------------
//
// Four laps in, the track stops. Not at a buffer stop and not at a portal — the
// rails simply are not there any more, and the cart carries on into a shaft that
// has no bottom in it. Everything past this point is outside the lap: the
// section is not in SECTIONS, so assertRouteSane still validates a six-room
// cyclic railway and this cannot break it.

export const TYPE_FALL = 6

/** Laps of railway before the rails run out. */
export const FALL_LAPS = 4

/** Where they run out. */
export const FALL_START = LAP_LEN * FALL_LAPS

/** The scenery block the shaft is tiled from. It repeats; the fall does not end. */
export const FALL_BLOCK = 720

/** How steep the shaft gets. Not 90: cos(grade) is load-bearing in the up vector. */
const FALL_GRADE = -89.2 * D

/** Metres of fall over which the last of the track's grade gives way to the shaft's. */
const FALL_ENTRY = 150

/** The shaft's corkscrew: peak curvature, and the wavelength it snakes on. */
const FALL_CURV = 1 / 96
const FALL_WAVE = 0.019

/** Grade the shaft inherits from the railway, once the pitch-over has finished. */
const FALL_ENTRY_GRADE = steepen(-20 * D, 1)

export const FALL_SECTION: Section = {
  id:     7,
  name:   'THE FALL',
  len:    FALL_BLOCK,
  type:   TYPE_FALL,
  turn:   [ 0 ],
  grade:  [ FALL_ENTRY_GRADE, FALL_GRADE ],
  lift:   [ 0 ],
  bore:   26,
  ceilH:  OPEN,
  floorD: OPEN,
  lamp:   64,
  lampY:  9.0,
  grime:  1.0,
  sky:    0.0,
}

// ---- precomputed route tables ---------------------------------------------

const STARTS: number[]      = []
const SEC_YAW0: number[]    = []
const BEAT_YAW0: number[][] = []

let LAP_TURN = 0
{
  let accLen = 0
  let accYaw = 0
  for (const s of SECTIONS) {
    STARTS.push(accLen)
    SEC_YAW0.push(accYaw)

    const beats: number[] = []
    let inner            = 0
    for (const t of s.turn) {
      beats.push(inner)
      inner += t
    }
    BEAT_YAW0.push(beats)

    accLen += s.len
    accYaw += inner
  }
  LAP_TURN = accYaw
}

/**
 * Heading at the instant the rails stop, which is where the shaft's corkscrew is
 * measured from. Four whole laps of turning, since the lap does not close in yaw
 * and never needed to.
 */
const FALL_YAW0 = FALL_LAPS * LAP_TURN

/**
 * Where along a lap the flood of the next lap's decay arrives. Placed over THE
 * OVERLOOK for the same reason natatorium puts its water rise underwater: it is
 * the one stretch with no near geometry, so lamps going out and the ash thickening
 * happen against open sky where there is nothing to pop.
 */
const DECAY_SECTION = 5

/**
 * Laps run, with the fractional part ramping across THE OVERLOOK rather than
 * stepping at the seam. Hoisted out of getSwitchbackState because the grade now
 * reads it too — the railway's shape is a function of how many times you have
 * been round it.
 */
export function lapFAt (s: number): number {
  if (s >= FALL_START)
    return FALL_LAPS

  const lap  = Math.floor(s / LAP_LEN)
  const lapU = s - lap * LAP_LEN
  return lap + smootherstep(
    STARTS[DECAY_SECTION],
    STARTS[DECAY_SECTION] + SECTIONS[DECAY_SECTION].len,
    lapU,
  )
}

/** Metres fallen past the end of the track. Zero while there is still track. */
export function fallDepthAt (s: number): number {
  return Math.max(0, s - FALL_START)
}

interface Beat {
  sec:     Section;
  index:   number;
  beat:    number;
  t:       number;
  beatLen: number;
}

/** Which section, which beat, and how far through it, for an arc length. */
function beatAt (s: number): Beat {
  if (s >= FALL_START) {
    const d = fallDepthAt(s)
    return {
      sec:     FALL_SECTION,
      index:   SECTION_COUNT,
      beat:    0,
      t:       (d - Math.floor(d / FALL_BLOCK) * FALL_BLOCK) / FALL_BLOCK,
      beatLen: FALL_BLOCK,
    }
  }

  const lap  = Math.floor(s / LAP_LEN)
  const lapU = s - lap * LAP_LEN

  let index = SECTION_COUNT - 1
  for (let i = SECTION_COUNT - 1; i >= 0; i--)
    if (lapU >= STARTS[i]) {
      index = i
      break
    }

  const sec     = SECTIONS[index]
  const nBeats  = sec.turn.length
  const beatLen = sec.len / nBeats
  const local   = lapU - STARTS[index]
  const beat    = Math.max(0, Math.min(nBeats - 1, Math.floor(local / beatLen)))

  return { sec, index, beat, t: clamp01((local - beat * beatLen) / beatLen), beatLen }
}

/** Absolute heading at an arc length. Grows without bound; only ever used as a direction. */
export function yawAt (s: number): number {
  if (s >= FALL_START) {
    // The shaft snakes rather than turns: the integral of the corkscrew below,
    // so heading and curvature cannot disagree and put the rider off the fit.
    const d = fallDepthAt(s)
    return FALL_YAW0 + FALL_CURV / FALL_WAVE * (1 - Math.cos(d * FALL_WAVE))
  }

  const lap = Math.floor(s / LAP_LEN)
  const b   = beatAt(s)
  return lap * LAP_TURN + SEC_YAW0[b.index] + BEAT_YAW0[b.index][b.beat] +
         b.sec.turn[b.beat] * smootherstep(0, 1, b.t)
}

/** Track grade at an arc length, radians, positive climbing. */
export function gradeAt (s: number): number {
  if (s >= FALL_START)
    return mix(FALL_ENTRY_GRADE, FALL_GRADE,
               smootherstep(0, FALL_ENTRY, fallDepthAt(s)))

  const b = beatAt(s)
  const g = mix(b.sec.grade[b.beat], b.sec.grade[b.beat + 1], smootherstep(0, 1, b.t))
  return steepen(g, clamp01(lapFAt(s) / PITCH_LAPS))
}

/** Horizontal curvature, rad/m. Positive is a right-hand turn. */
function curvAt (s: number): number {
  if (s >= FALL_START)
    return FALL_CURV * Math.sin(fallDepthAt(s) * FALL_WAVE)

  const b = beatAt(s)
  return b.sec.turn[b.beat] * dSmootherstep(b.t) / b.beatLen
}

/** Chain speed in force at an arc length, 0 where the cart runs free. */
function liftAt (s: number): number {
  const b = beatAt(s)
  return b.sec.lift[b.beat]
}

// ---------------------------------------------------------------------------
// Rectification
// ---------------------------------------------------------------------------
//
// The forward shape of the track, in the cart's own frame, fitted to a quadratic.
//
// Integrated from where the cart already is, never from the origin of anything,
// which is why nothing here accumulates: `s` indexes a heading field, and the
// only thing that comes back is a shape 80 metres long.

/** Arc length integrated forward each frame, and the step it is walked in. */
const REACH_S   = 88
const FIT_STEPS = 44

/**
 * The two camera-space depths the quadratic is pinned to. Two points determine
 * the two free coefficients exactly, and pinning beats least-squares here: the
 * near sample keeps the rail under the cart honest (an error there is a rail
 * that visibly misses the wheels) and the far one puts the error where the fog
 * is. Z2 sits just inside the fog rather than at the edge of the march.
 */
const FIT_Z1 = 20
const FIT_Z2 = 56

interface Bend {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

/** Solve q(z) = a*z + b*z^2 through (z1,v1) and (z2,v2). */
function fitQuadratic (z1: number, v1: number, z2: number, v2: number): [ number, number ] {
  const det = z1 * z2 * (z2 - z1)
  if (Math.abs(det) < 1e-6)
    return [ 0, 0 ]
  return [
    (v1 * z2 * z2 - v2 * z1 * z1) / det,
    (v2 * z1 - v1 * z2) / det,
  ]
}

/**
 * Walk the heading field forward from `s0` and fit the bend.
 *
 * The samples are taken at fixed *camera-space depth*, not at fixed arc length,
 * and that distinction is the whole robustness of the fit. In a hard turn the
 * track's depth grows far slower than its length — 88 metres of rail through a
 * 60-degree sweep only reaches 56 metres ahead — so pinning by arc length would
 * put the far knot outside the range the shader actually marches and let the
 * quadratic extrapolate wildly across the part of the picture you can see.
 */
function fitBend (s0: number, yaw0: number, grade0: number): Bend {
  // Camera basis at s0, in world coordinates. right = up x forward keeps it
  // right-handed with +x on screen-right, which is the sign every turn in the
  // table is written against.
  const cg = Math.cos(grade0)
  const sg = Math.sin(grade0)
  const cy = Math.cos(yaw0)
  const sy = Math.sin(yaw0)

  const fx = sy * cg,
    fy     = sg,
    fz     = cy * cg
  const rx = cy,
    ry     = 0,
    rz     = -sy // normalize(cross((0,1,0), f)) with the cg factored out
  const ux = -sy * sg,
    uy     = cg,
    uz     = -cy * sg // cross(f, r)

  const ds = REACH_S / FIT_STEPS

  let wx = 0,
    wy   = 0,
    wz   = 0 // world offset from the cart
  let pz = 0 // previous sample's depth
  let px = 0,
    py   = 0

  let z1 = 0,
    x1   = 0,
    y1   = 0,
    got1 = false
  let z2 = 0,
    x2   = 0,
    y2   = 0,
    got2 = false

  for (let k = 0; k < FIT_STEPS; k++) {
    // Midpoint of the step: a plain forward Euler on a curving path biases the
    // whole fit inward by half a step's worth of turn, and over 44 steps that is
    // a rail the cart visibly rides beside instead of on.
    const sm = s0 + (k + 0.5) * ds
    const g  = gradeAt(sm)
    const y  = yawAt(sm)
    const cG = Math.cos(g)

    wx += Math.sin(y) * cG * ds
    wy += Math.sin(g) * ds
    wz += Math.cos(y) * cG * ds

    const z  = wx * fx + wy * fy + wz * fz
    const x  = wx * rx + wy * ry + wz * rz
    const yy = wx * ux + wy * uy + wz * uz

    if (!got1 && z >= FIT_Z1) {
      const t = (FIT_Z1 - pz) / Math.max(1e-6, z - pz)
      z1 = FIT_Z1
      x1 = mix(px, x, t)
      y1 = mix(py, yy, t)
      got1 = true
    }
    if (!got2 && z >= FIT_Z2) {
      const t = (FIT_Z2 - pz) / Math.max(1e-6, z - pz)
      z2 = FIT_Z2
      x2 = mix(px, x, t)
      y2 = mix(py, yy, t)
      got2 = true
      break
    }

    pz = z
    px = x
    py = yy
  }

  // A turn tight enough that 88 metres of rail never reaches 56 metres ahead.
  // Pin the far knot to wherever the walk actually ended instead of dropping the
  // term, so the near half of the picture still gets its curve.
  if (!got1) {
    z1 = Math.max(1, pz)
    x1 = px
    y1 = py
  }
  if (!got2) {
    z2 = Math.max(z1 + 1, pz)
    x2 = px
    y2 = py
  }

  const [ ax, bx ] = fitQuadratic(z1, x1, z2, x2)
  const [ ay, by ] = fitQuadratic(z1, y1, z2, y2)
  return { ax, bx, ay, by }
}

// ---------------------------------------------------------------------------

export interface SwitchbackState {

  /** Arc length travelled. CPU-only; nothing this large reaches the shader. */
  s: number;

  /** `s` folded into [0, PHASE_WRAP) for the lattices. See PHASE_WRAP. */
  phase: number;

  lap: number;

  /**
   * Laps run, with the fractional part ramping across THE OVERLOOK rather than
   * stepping at the seam. Everything that gets worse per lap reads this.
   */
  lapF: number;

  speed: number;
  grade: number;
  yaw:   number;
  curv:  number;

  /** Track bank, radians, from lateral acceleration. Right turn banks positive. */
  bank: number;

  /** The fraction of the bank the rider's head actually takes. */
  headRoll: number;

  /** Rail-joint chatter, scaled by speed. Two axes, both tiny and both essential. */
  joltX: number;
  joltY: number;

  /** Where the rider is looking, relative to the track. Leads into the turn. */
  lookYaw:   number;
  lookPitch: number;

  /**
   * The chain speed in force here, 0 where the cart runs free. Nothing in the
   * shader reads it — it is for the soundtrack, which cannot tell a lift hill
   * from a brake run from the speed alone (both hold it steady) and has to make
   * a very different noise about each.
   */
  chain: number;

  bend: Bend;

  /** World up, expressed in the *track's* frame — this is where the bank lives. */
  up: [ number, number, number ];

  /** Sun direction in the track's frame. */
  sun: [ number, number, number ];

  /** Three resident sections: the one behind, the current one, the next. */
  slots: Slot[];

  section: Section;
  name:    string;

  /** 0..1 how far the lamps have failed, and how far everything else has. */
  lightFail: number;
  decay:     number;

  /** 0..1 how far the railway has tipped over. 0 on the first lap by construction. */
  pitch: number;

  /** True once the rails have run out. */
  inFall: boolean;

  /** 0..1 how far into the shaft, eased over FALL_ENTRY metres. */
  fall: number;

  /** Metres fallen past the end of the track. Unbounded, like the speed. */
  fallDepth: number;

  /** The shaft's accumulated corkscrew, radians, wrapped. */
  twist: number;

  /** 0..1 fissure density in the walls, and how hard they are lit from behind. */
  crack: number;
}

export interface Slot {

  /** Section bounds relative to the cart, in metres of camera-space depth. */
  z0: number;
  z1: number;

  type:   number;
  bore:   number;
  ceilH:  number;
  floorD: number;
  lamp:   number;
  lampY:  number;
  grime:  number;
  sky:    number;
  id:     number;
}

function makeSlot (sec: Section, z0: number, z1: number): Slot {
  return {
    z0,
    z1,
    type:   sec.type,
    bore:   sec.bore,
    ceilH:  sec.ceilH,
    floorD: sec.floorD,
    lamp:   sec.lamp,
    lampY:  sec.lampY,
    grime:  sec.grime,
    sky:    sec.sky,
    id:     sec.id,
  }
}

/**
 * The whole ride as a pure function of arc length and speed. Nothing in here
 * reads a clock; the integrator owns time and this owns shape, which is what
 * makes `?t=` replayable to the byte.
 */
export function getSwitchbackState (s: number, speed: number, headRollPrev: number): SwitchbackState {
  const lap  = Math.floor(s / LAP_LEN)
  const lapU = s - lap * LAP_LEN
  const lapF = lap + smootherstep(
    STARTS[DECAY_SECTION],
    STARTS[DECAY_SECTION] + SECTIONS[DECAY_SECTION].len,
    lapU,
  )

  const b       = beatAt(s)
  const yaw     = yawAt(s)
  const grade   = gradeAt(s)
  const curv    = curvAt(s)
  const section = b.sec

  // Bank the car until the resultant of gravity and the turn is square to the
  // floor — which is what a track designer does, and it means the number is a
  // property of the *track*, not of the ride, everywhere except that it depends
  // on the speed the track was designed for. Ours banks live, which is a small
  // lie that reads as a very good one.
  //
  // ...up to about the speed the track was designed for, and no further. v^2
  // drives the arctangent hard into its own saturation, so at four times that
  // speed the bank sits pinned at its limit through every turn and then snaps
  // across the whole range in the centimetre where the curvature changes sign.
  // That is a roll stutter at every beat boundary, and it is not the track.
  const vBank  = Math.min(speed, V_MAX)
  const bank   = Math.atan2(vBank * vBank * curv, G)
  const capped = Math.max(-0.85, Math.min(0.85, bank))

  // The rider's head lags the car. Tracked as state rather than derived so the
  // lag is real lag and not a scaled copy of the input.
  const headRoll = mix(headRollPrev, capped * 0.30, 0.06)

  // Rail joints. Amplitude grows with speed and with how bad the road has got.
  const wear  = clamp01(lapF * 0.3) * 0.5 + 0.5
  const rough = Math.min(1, speed / 14) * wear
  const joltY = (Math.sin(s * 4.7) * 0.6 + Math.sin(s * 11.3) * 0.4) * 0.008 * rough
  const joltX = Math.sin(s * 7.9 + 1.7) * 0.006 * rough

  const bend = fitBend(s, yaw, grade)

  // --- world up and the sun, in the track's frame ---
  //
  // right is horizontal by construction, so world-up has no component along it
  // before the bank; after it, that component is the entire visible tilt.
  const cg = Math.cos(grade)
  const sg = Math.sin(grade)
  const cb = Math.cos(capped)
  const sb = Math.sin(capped)

  // (0, cos g, sin g) is world-up in the unbanked track frame; roll it by the bank.
  const up: [ number, number, number ] = [ -sb * cg, cb * cg, sg ]

  // The sun sits at a fixed world azimuth, so as the railway turns it swings
  // around the ride — and because the lap does not close in yaw, it is in a
  // slightly different place every lap. That drift is free and it is the single
  // cheapest source of lap-to-lap variation in the whole journey.
  const sunAz = 0.6
  const sunEl = 0.13
  const swx   = Math.sin(sunAz) * Math.cos(sunEl)
  const swy   = Math.sin(sunEl)
  const swz   = Math.cos(sunAz) * Math.cos(sunEl)

  const cy  = Math.cos(yaw)
  const sy  = Math.sin(yaw)
  const fx  = sy * cg,
    fy      = sg,
    fz      = cy * cg
  const r0x = cy,
    r0y     = 0,
    r0z     = -sy
  const u0x = -sy * sg,
    u0y     = cg,
    u0z     = -cy * sg

  const rx = r0x * cb - u0x * sb,
    ry     = r0y * cb - u0y * sb,
    rz     = r0z * cb - u0z * sb
  const ux = r0x * sb + u0x * cb,
    uy     = r0y * sb + u0y * cb,
    uz     = r0z * sb + u0z * cb

  const sun: [ number, number, number ] = [
    swx * rx + swy * ry + swz * rz,
    swx * ux + swy * uy + swz * uz,
    swx * fx + swy * fy + swz * fz,
  ]

  // --- resident sections, as depth ranges ahead of the cart ---
  //
  // Arc length and camera depth are the same quantity to first order (that is
  // what the fit is *for*), so a section boundary is just a z. In a hard turn
  // depth runs a little short of length and the far boundary lands slightly
  // beyond where it should — always in the fog, and always in the direction of
  // the room you are about to be in anyway.
  const inFall    = s >= FALL_START
  const fallDepth = fallDepthAt(s)

  let prev: Section
  let next: Section
  let into: number

  if (inFall) {
    // The shaft is one block, tiled. The room behind you is the overlook only
    // for the first block — after that there is nothing back there either.
    const block = Math.floor(fallDepth / FALL_BLOCK)
    into = fallDepth - block * FALL_BLOCK
    prev = block === 0 ? SECTIONS[SECTION_COUNT - 1] : FALL_SECTION
    next = FALL_SECTION
  }
  else {
    prev = SECTIONS[(b.index - 1 + SECTION_COUNT) % SECTION_COUNT]
    into = lapU - STARTS[b.index] // how far into the current section

    // The one place the lap does not come back round. On the last lap the room
    // after the overlook is the shaft, so the rails visibly run out at a portal
    // you can see before you reach it rather than at the edge of the frame.
    next = lap === FALL_LAPS - 1 && b.index === SECTION_COUNT - 1
      ? FALL_SECTION
      : SECTIONS[(b.index + 1) % SECTION_COUNT]
  }

  const curZ0 = -into
  const curZ1 = curZ0 + section.len
  const slots = [
    makeSlot(prev, curZ0 - prev.len, curZ0),
    makeSlot(section, curZ0, curZ1),
    makeSlot(next, curZ1, curZ1 + next.len),
  ]

  const fall  = inFall ? smootherstep(0, FALL_ENTRY, fallDepth) : 0
  const crack = inFall
    ? mix(clamp01(FALL_LAPS * 0.24), 1, fall)
    : clamp01(lapF * 0.24)

  return {
    s,
    phase:     s - Math.floor(s / PHASE_WRAP) * PHASE_WRAP,
    lap,
    lapF,
    speed,
    grade,
    yaw,
    curv,
    bank:      capped,
    headRoll,
    joltX,
    joltY,
    // Lead the turn: a rider looks where the track is going, and at 20 m/s the
    // track is going somewhere well before the car is.
    lookYaw:   Math.max(-0.30, Math.min(0.30, curv * 26)),
    lookPitch: Math.max(-0.16, Math.min(0.16, -grade * 0.22)),
    chain:     b.sec.lift[b.beat],
    bend,
    up,
    sun,
    slots,
    section,
    name:      section.name,
    lightFail: Math.min(0.92, lapF * 0.34),
    decay:     Math.min(1, lapF * 0.30),
    pitch:     clamp01(lapF / PITCH_LAPS),
    inFall,
    fall,
    fallDepth,
    // Wrapped: the shader only ever takes its sine, and an angle that grows to
    // six figures over a long fall loses its mantissa on the way to the GPU.
    twist:     fallDepth * 0.0055 % (Math.PI * 2),
    crack,
  }
}

/** HUD label. Laps count from 1, the way the rest of the repo counts them. */
export function labelFor (state: SwitchbackState): string {
  const kph = Math.round(state.speed * 3.6)

  if (state.inFall)
    return state.fallDepth < 45
      ? 'THE TRACK ENDS'
      : `THE FALL · ${Math.round(state.fallDepth)}M · ${kph} KM/H`

  const head = state.lap > 0 ? `LAP ${state.lap + 1} · ${state.name}` : state.name
  return `${head} · ${kph} KM/H`
}

/**
 * Dev-only guard for the properties the route table cannot be allowed to break.
 * Every one of these produces a *geometry* bug rather than a type error, which
 * is exactly the class worth asserting instead of discovering in a screenshot.
 */
export function assertRouteSane (): string[] {
  const problems: string[] = []

  for (let i = 0; i < SECTION_COUNT; i++) {
    const s    = SECTIONS[i]
    const next = SECTIONS[(i + 1) % SECTION_COUNT]

    if (s.grade.length !== s.turn.length + 1)
      problems.push(`${s.name}: ${s.turn.length} beats needs ${s.turn.length + 1} grades, has ${s.grade.length}`)

    if (s.lift.length !== s.turn.length)
      problems.push(`${s.name}: ${s.turn.length} beats needs ${s.turn.length} lift entries, has ${s.lift.length}`)

    if (Math.abs(s.grade[s.grade.length - 1] - next.grade[0]) > 1e-9)
      problems.push(`${s.name} -> ${next.name}: grade steps by ` +
        `${((next.grade[0] - s.grade[s.grade.length - 1]) / D).toFixed(2)} deg — the tangent is discontinuous`)

    const beatLen = s.len / s.turn.length
    for (let j = 0; j < s.turn.length; j++) {
      const k = Math.abs(s.turn[j]) * EASE_PEAK / beatLen
      if (k > MAX_CURV + 1e-9)
        problems.push(`${s.name} beat ${j}: peak curvature 1/${(1 / k).toFixed(0)}m is tighter ` +
          `than 1/${(1 / MAX_CURV).toFixed(0)}m — the bend fit cannot follow it`)

      const dg = Math.abs(s.grade[j + 1] - s.grade[j]) * EASE_PEAK / beatLen
      if (dg > MAX_CURV + 1e-9)
        problems.push(`${s.name} beat ${j}: vertical curvature 1/${(1 / dg).toFixed(0)}m is too tight`)
    }

    for (const g of s.grade)
      if (Math.abs(g) > 30 * D)
        problems.push(`${s.name}: ${(g / D).toFixed(0)} deg grade is past the 30 deg the fit is honest over`)

    // Two consecutive sections have to cover everything the march can reach, or
    // there is a stretch of track ahead with no room around it — a hole.
    if (s.len + next.len < 90)
      problems.push(`${s.name} + ${next.name} span ${s.len + next.len}m, less than the march reaches`)

    if (s.lampY >= s.ceilH || s.lampY <= 0)
      problems.push(`${s.name}: lamps at ${s.lampY}m are not inside a room ${s.ceilH}m tall`)

    if (s.lamp > 0 && Math.abs(PHASE_WRAP / s.lamp - Math.round(PHASE_WRAP / s.lamp)) > 1e-9)
      problems.push(`${s.name}: lamp pitch ${s.lamp} does not divide PHASE_WRAP — the lamps will jump on the fold`)
  }

  // The windowed bound. Walked numerically rather than derived, because it is a
  // property of the table as a whole — a turn can be inside the pointwise cap in
  // every beat and still add up to a fold-back across a join.
  for (let start = 0; start < LAP_LEN; start += 2) {
    const dYaw   = Math.abs(yawAt(start + FIT_Z2) - yawAt(start))
    const dGrade = Math.abs(gradeAt(start + FIT_Z2) - gradeAt(start))
    if (dYaw > MAX_WINDOW_TURN)
      problems.push(`s=${start}: the track turns ${dYaw.toFixed(2)} rad inside the fit window — ` +
        'a quadratic cannot follow that out of the +Z half-space')
    if (dGrade > MAX_WINDOW_TURN)
      problems.push(`s=${start}: the grade turns ${dGrade.toFixed(2)} rad inside the fit window`)
  }

  // A chain that lets go *before* the crest strands the cart on the hill, and
  // the cart cannot be stranded, so V_MIN quietly carries it over instead and
  // the ride silently stops being a gravity railway. Walk the profile and say so
  // instead: anywhere the cart runs free and uphill, it must arrive with enough
  // speed to reach the next place the grade turns down.
  {
    let v         = 12
    let stalledAt = ''
    for (let k = 0; k < 4000; k++) {
      const s     = k * (LAP_LEN / 4000)
      const g     = gradeAt(s)
      const chain = liftAt(s)
      const h     = LAP_LEN / 4000 / Math.max(v, 0.05)
      if (chain > 0)
        v += (chain - v) * (1 - Math.exp(-h / 0.55))
      else
        v += (-G * Math.sin(g) - DRAG * v * v - ROLL_RES * G * Math.cos(g)) * h
      if (v < V_MIN + 0.05 && !stalledAt)
        stalledAt = `${s.toFixed(0)}m (${beatAt(s).sec.name})`
      v = Math.max(V_MIN, Math.min(V_MAX, v))
    }
    if (stalledAt)
      problems.push(`the cart valleys at ${stalledAt} and only V_MIN carries it over — ` +
        'the chain has to run past the crest, not stop at it')
  }

  // The pitch-over is a pure function of one grade, so two sections that agreed
  // before it still agree after it — but the seam into the shaft is a different
  // formula meeting the tipped-over one, and that is worth asserting rather than
  // discovering as a derailment on the fourth lap.
  {
    const before = gradeAt(FALL_START - 1e-4)
    const after  = gradeAt(FALL_START + 1e-4)
    if (Math.abs(before - after) > 1e-3)
      problems.push(`the rails end with a ${((after - before) / D).toFixed(2)} deg step ` +
        'into the shaft — the tangent is discontinuous')
  }

  for (const [ label, pitch ] of [[ 'TIE_PITCH', TIE_PITCH ], [ 'BENT_PITCH', BENT_PITCH ]] as const)
    if (Math.abs(PHASE_WRAP / pitch - Math.round(PHASE_WRAP / pitch)) > 1e-9)
      problems.push(`${label} ${pitch} does not divide PHASE_WRAP`)

  return problems
}

/**
 * One simulation instance per mount. Stepped on the shared frame-capped loop,
 * read immediately after, so the frame renders the state this step produced.
 */
export function createSwitchbackSimulation (): JourneySimulation {
  let s     = 0
  let v     = 9.0
  let roll  = 0

  // Counted inside the simulation, not by the shell: seekSimulation replays
  // step() from zero without anyone watching. See lib/signalLoss.
  let signalAge = 0
  let state = getSwitchbackState(0, v, 0)

  if (process.env.NODE_ENV !== 'production') {
    const problems = assertRouteSane()
    for (const p of problems)
      console.warn('[switchback route]', p)
  }

  const uSecA = new Array<number>(12).fill(0) // z0, z1, type, bore
  const uSecB = new Array<number>(12).fill(0) // ceilH, floorD, lamp, grime
  const uSecC = new Array<number>(12).fill(0) // sky, id, lit, lampY
  const uBend = [ 0, 0, 0, 0 ]
  const uCart = [ 0, 0, 0, 0 ]
  const uRide = [ 0, 0, 0, 0 ]
  const uAtm  = [ 0, 0, 0, 0 ]
  const uSun  = [ 0, 0, 0, 0 ]
  const uUp   = [ 0, 0, 0, 0 ]
  const uFall = [ 0, 0, 0, 0 ] // fall, over-speed, twist, crack

  return {
    step (dt: number) {
      const h = Math.min(dt, 0.05)

      if (s >= FALL_START) {
        // Nothing is holding it any more. No drag term and no ceiling: the shaft
        // has no bottom in it and the speed has no limit, which is the whole of
        // what this section is for. Everything downstream is a pure function of
        // s, so a seek still reproduces it exactly.
        v += G * Math.sin(-state.grade) * h
        s += v * h
        signalAge += h
        roll  = state.headRoll
        state = getSwitchbackState(s, v, roll)
        return
      }

      const chain = liftAt(s)
      if (chain > 0) {
        // A chain (or a brake fin) does not accelerate you, it *takes* you: the
        // dog is either engaged or it is not. An exponential approach with a
        // half-second constant is what that sounds and looks like from inside.
        //
        // But it takes you less every lap. This — not the drag and not the
        // grades — is what actually held the ride down: the brake at the
        // platform pinned the cart back to walking pace once a lap however fast
        // it arrived, so no amount of tipping the descents over made the ride
        // faster than one section's worth of runway. By the last lap the dog is
        // not catching and the fins are not gripping, and the cart carries what
        // it has straight through the station.
        const grip   = Math.max(0, 1 - state.lapF * 0.3)
        const target = chain * (1 + state.lapF * 0.5)
        v += (target - v) * (1 - Math.exp(-h / 0.55)) * grip
      }
      else {
        const g = state.grade
        // Drag falls off per lap: the ride is not getting faster because anything
        // pushes it, but because less and less is slowing it down.
        //
        // It has to fall off *hard*, or the pitch-over is cosmetic. Quadratic
        // drag sets a terminal velocity of sqrt(g sin θ / k), and at the old
        // rate that number barely moved — the fourth lap descended at seventy-
        // eight degrees and still ran at a hundred and fifty, which looks like a
        // steep track being ridden slowly rather than like a railway coming
        // apart. At this rate it stops binding altogether by the last lap, and
        // what limits the speed there is the honest one — how much height a lap
        // has in it. The fourth is descending at seventy-eight degrees for four
        // hundred and ninety metres of arc, and arrives at about eighty-five
        // percent of what falling that far would give you.
        const drag = DRAG / (1 + state.lapF * 2.4)
        v += (-G * Math.sin(g) - drag * v * v - ROLL_RES * G * Math.cos(g)) * h
      }

      // The ceiling lifts every lap, and lifts out of the way: a railway this
      // far over is no longer one a 26 m/s cap describes, and past the second
      // lap the cap should not be the thing deciding the speed — the height of
      // the drop should be. It stays only as a guard against a bad table.
      v = Math.max(V_MIN, Math.min(V_MAX * (1 + state.lapF * 1.1), v))
      s += v * h
      roll  = state.headRoll
      state = getSwitchbackState(s, v, roll)
    },

    uniforms (): CustomUniforms {
      for (let i = 0; i < 3; i++) {
        const slot = state.slots[i]
        const o    = i * 4

        uSecA[o]     = slot.z0
        uSecA[o + 1] = slot.z1
        uSecA[o + 2] = slot.type
        uSecA[o + 3] = slot.bore

        uSecB[o]     = slot.ceilH
        uSecB[o + 1] = slot.floorD
        uSecB[o + 2] = slot.lamp
        uSecB[o + 3] = mix(slot.grime, 1.0, state.decay * 0.6)

        uSecC[o]     = slot.sky
        uSecC[o + 1] = slot.id
        // Folded here rather than in GLSL so the failure curve exists once. A
        // room's lamps go out as the laps pile up and as its own grime rises,
        // and a neighbour seen through a portal has to be lit by *its* answer,
        // not by the one the cart happens to be standing in.
        uSecC[o + 2] = Math.max(0, 1 - state.lightFail * (0.6 + slot.grime * 0.8))
        uSecC[o + 3] = slot.lampY
      }

      uBend[0] = state.bend.ax
      uBend[1] = state.bend.bx
      uBend[2] = state.bend.ay
      uBend[3] = state.bend.by

      uCart[0] = state.phase
      uCart[1] = state.speed
      uCart[2] = state.lapF
      uCart[3] = EYE

      uRide[0] = state.lookYaw
      uRide[1] = state.lookPitch + state.joltY
      uRide[2] = state.headRoll + state.joltX
      uRide[3] = state.chain

      uFall[0] = state.fall
      // Speed *past* what the ride was ever capable of. uCart.y already pins the
      // shader's lens widening at 20 m/s, so this is the term that keeps saying
      // something after the fall has left every previous number behind.
      //
      // Logarithmic, because the fall is unbounded and a linear map saturates
      // fifteen seconds in — after which the picture stops acknowledging speed
      // at exactly the point the speed becomes the only thing happening.
      uFall[1] = clamp01(Math.log2(1 + Math.max(0, state.speed - V_MAX) / 20) / 8)
      uFall[2] = state.twist
      uFall[3] = state.crack

      uAtm[0] = state.lightFail
      uAtm[1] = state.decay
      uAtm[2] = state.grade
      uAtm[3] = state.bank

      uSun[0] = state.sun[0]
      uSun[1] = state.sun[1]
      uSun[2] = state.sun[2]
      uSun[3] = 1

      uUp[0] = state.up[0]
      uUp[1] = state.up[1]
      uUp[2] = state.up[2]
      uUp[3] = state.slots[1].sky

      return { uSecA, uSecB, uSecC, uBend, uCart, uRide, uAtm, uSun, uUp, uFall }
    },

    label () {
      return labelFor(state)
    },

    /**
     * `s`, not `lapF`: lapF deliberately ramps across THE OVERLOOK rather than
     * stepping at the seam, which makes it the wrong thing to draw a bar from.
     */
    marks (): JourneyMarks {
      if (state.inFall) {
        // Each block of shaft counts as another lap, so the transport can still
        // fast-forward through a section that has no structure left in it.
        const block = Math.floor(state.fallDepth / FALL_BLOCK)
        return {
          loop:         FALL_LAPS + block,
          section:      TYPE_FALL,
          sectionCount: 1,
          progress:     (state.fallDepth - block * FALL_BLOCK) / FALL_BLOCK,
          signalAge,
        }
      }

      return {
        loop:         state.lap,
        section:      SECTIONS.indexOf(state.section),
        sectionCount: SECTION_COUNT,
        progress:     state.s % LAP_LEN / LAP_LEN,
      }
    },
  }
}
