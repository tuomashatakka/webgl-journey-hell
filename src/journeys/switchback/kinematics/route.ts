import { clamp01, mix, smootherstep } from '@wjh/math/scalar'
import { D, DECAY_SECTION, FALL_ENTRY, TYPE_FALL } from './constants'

// ---- room types, read by the shader's material branch ---------------------

const TYPE_PLATFORM  = 0

// fluorescent boarding station, wet tile
const TYPE_DRIFT     = 1

// hand-cut chalk adit, timber sets, dust
const TYPE_SCAFFOLD  = 2

// steel lattice suspended in nothing
const TYPE_CONCOURSE = 3

// carpeted mall interior at sunset
const TYPE_CHAPEL    = 4

// folded stone, god-rays, no floor plan
const TYPE_OVERLOOK  = 5

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
    lift:   [ 5.5, 3, 3.4 ], // brake · crawl · chain
    bore:   6,
    ceilH:  4.6,
    floorD: 0.45,
    lamp:   8,
    lampY:  4.36,
    grime:  0.45,
    sky:    0,
  },
  {
    id:     2,
    name:   'THE CHALK DRIFT',
    len:    78,
    type:   TYPE_DRIFT,
    turn:   [ 0.28, -0.3, 0.2 ],
    grade:  [ 16 * D, -1 * D, -9 * D, -14 * D ],
    lift:   [ 3.6, 0, 0 ], // the platform's chain runs on over the crest
    bore:   3.4,
    ceilH:  3.3,
    floorD: 0.38,
    lamp:   8,
    lampY:  2.25,
    grime:  0.6,
    sky:    0.1, // the vents let just enough daylight in to be worse than none
  },
  {
    id:     3,
    name:   'THE SCAFFOLD VOID',
    len:    96,
    type:   TYPE_SCAFFOLD,
    turn:   [ -0.1, 0.27, 0.27, -0.18 ],
    grade:  [ -14 * D, -28 * D, -18 * D, -6 * D, -3 * D ],
    lift:   [ 0, 0, 0, 0 ],
    bore:   OPEN,
    ceilH:  OPEN,
    floorD: OPEN,
    lamp:   16,
    lampY:  3.4,
    grime:  0.75,
    sky:    0, // open, but to nothing — there is no sun out there
  },
  {
    id:     4,
    name:   'THE CARPET CONCOURSE',
    len:    84,
    type:   TYPE_CONCOURSE,
    turn:   [ 0.3, 0.3, 0.14 ],
    grade:  [ -3 * D, 3 * D, -1 * D, -7 * D ],
    lift:   [ 0, 0, 0 ],
    bore:   11,
    ceilH:  10.5,
    floorD: 0.55,
    lamp:   10,
    lampY:  10.1,
    grime:  0.35,
    sky:    0.3, // clerestory: enough sunset gets in to light the carpet
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
    ceilH:  16,
    floorD: 0.6,
    lamp:   20,
    lampY:  5.2,
    grime:  0.5,
    sky:    0.12,
  },
  {
    id:     6,
    name:   'THE OVERLOOK',
    len:    90,
    type:   TYPE_OVERLOOK,
    turn:   [ 0.22, -0.24, 0.22, -0.12 ],
    grade:  [ 11 * D, -1 * D, -8 * D, -16 * D, -20 * D ],
    lift:   [ 6, 0, 0, 0 ], // the chapel's chain runs on over the crest
    bore:   OPEN,
    ceilH:  OPEN,
    floorD: OPEN,
    lamp:   16,
    lampY:  2.6,
    grime:  0.25,
    sky:    1,
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

/** Laps of railway before the rails run out. */
export const FALL_LAPS = 4

/** Where they run out. */
export const FALL_START = LAP_LEN * FALL_LAPS

/** The scenery block the shaft is tiled from. It repeats; the fall does not end. */
export const FALL_BLOCK = 720

/** How steep the shaft gets. Not 90: cos(grade) is load-bearing in the up vector. */
const FALL_GRADE = -89.2 * D

/** The shaft's corkscrew: peak curvature, and the wavelength it snakes on. */
const FALL_CURV = 1 / 96

const FALL_WAVE = 0.019

// ---- precomputed route tables ---------------------------------------------

export const STARTS: number[]      = []

const SEC_YAW0: number[]    = []

const BEAT_YAW0: number[][] = []

let LAP_TURN = 0

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
  lampY:  9,
  grime:  1,
  sky:    0,
}

// open sky over a cloud sea, drifting ash

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

export interface Beat {
  sec:     Section;
  index:   number;
  beat:    number;
  t:       number;
  beatLen: number;
}

/** d/dt of smootherstep on the unit interval. Peaks at 15/8 in the middle. */
function dSmootherstep (t: number): number {
  const u = clamp01(t)
  return 30 * u * u * (u - 1) * (u - 1)
}

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

/** Which section, which beat, and how far through it, for an arc length. */
export function beatAt (s: number): Beat {
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
export function curvAt (s: number): number {
  if (s >= FALL_START)
    return FALL_CURV * Math.sin(fallDepthAt(s) * FALL_WAVE)

  const b = beatAt(s)
  return b.sec.turn[b.beat] * dSmootherstep(b.t) / b.beatLen
}

/** Chain speed in force at an arc length, 0 where the cart runs free. */
export function liftAt (s: number): number {
  const b = beatAt(s)
  return b.sec.lift[b.beat]
}
