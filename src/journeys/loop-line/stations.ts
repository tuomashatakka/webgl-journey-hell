// THE LOOP LINE — the circuit.
//
// A driverless people-mover on a closed circuit of nine bays, with no terminus.
// This file is the route table: the shape of the track, what each bay is, how
// its air and light behave, and the schedule by which all of it comes apart.
//
// ---------------------------------------------------------------------------
// The fourth way of turning
// ---------------------------------------------------------------------------
//
// stairwell re-anchors in GLSL, natatorium uploads an affine transform per
// section, switchback shears the world around a camera that never moves. All
// three exist because their routes are unbounded. A closed circuit is not: it
// is two kilometres long and then it is the same two kilometres again. So this
// journey builds the whole thing, once, out of real triangles, and lets an
// ordinary camera move through it. No turn-radius floor, no coordinate drift,
// and a track that could cross itself if it wanted to.
//
// ---------------------------------------------------------------------------
// Nine rooms, and why they come in this order
// ---------------------------------------------------------------------------
//
// Every open bay is fenced off from every other open bay by an enclosed one.
// The open bays have skies, and the skies do not agree — noon in THE CUT, dusk
// over THE VIADUCT, night in THE DEPOT — and the only way a sky can change
// without anyone seeing it change is while nobody can see the sky. So the sky
// is swapped inside a tunnel, every time, and arriving in the open is always
// a reveal rather than a crossfade. DEPOT and TURNBACK are the one adjacent
// pair, and they share a night.
//
// ---------------------------------------------------------------------------
// The chord
// ---------------------------------------------------------------------------
//
// There are two circuits. MAIN runs all nine bays; ALT leaves it inside THE
// CONCOURSE, bows inward under the middle of the loop at tunnel depth, and
// rejoins inside THE ANNEX — THE CHORD, an unlined brick bore with no light of
// its own. It skips THE CUT, which is the only daylight on the circuit. On
// lap one you ride past the point machine and see the chord's mouth beside
// the daylight portal in the concourse end wall; on lap three it throws.
//
// Both circuits are splines through one dense resampling of the design curve,
// and ALT differs from MAIN only in the points inside the detour. Catmull-Rom
// is local — a segment depends on four points — so outside the detour the two
// are not merely close, they are the same segments, and
//
//   before the junction   altS = mainS
//   after the rejoin      altS = altLength - (mainLength - mainS)
//
// holds exactly. The handover rebases arc length by that identity, and a bay
// boundary is carried across by it, with no nearest-point search to snap a
// boundary onto the wrong branch.

import { zeros } from '@wjh/math/arrays'
import { createClosedCurve } from '@wjh/geometry/curve'
import type { ClosedCurve, Frame, Vec3 } from '@wjh/geometry/curve'
import { smootherstep } from '@wjh/math/scalar'


/** What a bay is built as. */
export const enum Theme {
  STATION = 0,
  TUBE = 1,
  CONCOURSE = 2,
  CUT = 3,
  ANNEX = 4,
  VIADUCT = 5,
  STACKS = 6,
  DEPOT = 7,
  TRESTLE = 8,
  CHORD = 9,
}

/** How each bay fails. One mode per bay: they do not come apart the same way. */
export const enum Rupture {

  /** The platform edge crumbles into the trackbed. */
  CRUMBLE = 0,

  /** The tube's rings crack and slip, segment by segment. */
  SHATTER = 1,

  /** The vault detaches and turns about its own axis. */
  INVERT = 2,

  /** The sky comes down until there is no outside left. */
  ERASE = 3,

  /** The water rises a step per lap until the camera goes under. */
  FLOOD = 4,

  /** The city goes dark, one window at a time. */
  BLACKOUT = 5,

  /** The racks wake, and then they close in. */
  ADVANCE = 6,

  /** The floodlights fail and the yard empties into the dark. */
  EMPTY = 7,

  /** The structure leaves one member at a time. */
  VANISH = 8,
}

export interface Bay {
  id:    number;
  name:  string;
  theme: Theme;

  /** Span as a fraction of the main loop, [u0, u1). The table tiles [0, 1). */
  u0: number;
  u1: number;

  /** Target speed through the bay, m/s, before lap scaling. */
  speed: number;

  /** Fog colour (linear, scene-referred) and per-metre extinction. */
  fog:        [ number, number, number ];
  fogDensity: number;

  /** Hemisphere fill from above, linear. What an enclosed room bounces around. */
  ambient: [ number, number, number ];

  /**
   * 0 enclosed, 1 open to the sky: scales the sky-map irradiance and the sun.
   * Not a boolean, because a deep cut sees less sky than a viaduct does.
   */
  open: number;

  /** Which Δ sky hangs over this bay, if it is open. */
  sky: string | null;

  /** Camera exposure, EV-style multiplier. Authored, not metered: ?t= must reproduce. */
  exposure: number;

  rupture: Rupture;

  /** How hard this bay's shards move per unit of the global fracture channel. */
  shatter: number;

  /** Room tone in the audio engine (its ROOMS table), not the bay id. */
  sound: number;
}

// The nine, in running order. u1 of each is u0 of the next and the last wraps.
// Fractions of a ~2.1 km loop: the shortest bay is ~180 m, eleven seconds or
// so, which is about the least a room needs to be read as a room.
export const BAYS: Bay[] = [
  {
    id:         0,
    name:       'PLATFORM SIX',
    theme:      Theme.STATION,
    u0:         0,
    u1:         0.085,
    speed:      9,
    fog:        [ 0.05, 0.042, 0.034 ],
    fogDensity: 0.01,
    ambient:    [ 0.06, 0.052, 0.042 ],
    open:       0,
    sky:        null,
    exposure:   1.15,
    rupture:    Rupture.CRUMBLE,
    shatter:    0.7,
    sound:      0,
  },
  {
    id:         1,
    name:       'THE RUNNING TUNNEL',
    theme:      Theme.TUBE,
    u0:         0.085,
    u1:         0.185,
    speed:      17,
    fog:        [ 0.01, 0.009, 0.008 ],
    fogDensity: 0.02,
    ambient:    [ 0.01, 0.009, 0.008 ],
    open:       0,
    sky:        null,
    exposure:   1.9,
    rupture:    Rupture.SHATTER,
    shatter:    1,
    sound:      6,
  },
  {
    id:         2,
    name:       'THE CONCOURSE',
    theme:      Theme.CONCOURSE,
    u0:         0.185,
    u1:         0.305,
    speed:      13,
    fog:        [ 0.055, 0.05, 0.046 ],
    fogDensity: 0.007,
    ambient:    [ 0.05, 0.046, 0.04 ],
    open:       0,
    sky:        null,
    exposure:   1.05,
    rupture:    Rupture.INVERT,
    shatter:    1.25,
    sound:      1,
  },
  {
    id:         3,
    name:       'THE CUT',
    theme:      Theme.CUT,
    u0:         0.305,
    u1:         0.435,
    speed:      21,
    fog:        [ 0.62, 0.68, 0.76 ],
    fogDensity: 0.0032,
    ambient:    [ 0.42, 0.46, 0.52 ],
    open:       0.85,
    sky:        'DAY',
    exposure:   0.42,
    rupture:    Rupture.ERASE,
    shatter:    0.35,
    sound:      2,
  },
  {
    id:         4,
    name:       'THE ANNEX',
    theme:      Theme.ANNEX,
    u0:         0.435,
    u1:         0.535,
    speed:      14,
    fog:        [ 0.02, 0.034, 0.032 ],
    fogDensity: 0.02,
    ambient:    [ 0.016, 0.026, 0.024 ],
    open:       0,
    sky:        null,
    exposure:   1.7,
    rupture:    Rupture.FLOOD,
    shatter:    0.55,
    sound:      3,
  },
  {
    id:         5,
    name:       'THE VIADUCT',
    theme:      Theme.VIADUCT,
    u0:         0.535,
    u1:         0.665,
    speed:      19,
    fog:        [ 0.16, 0.11, 0.12 ],
    fogDensity: 0.0042,
    ambient:    [ 0.1, 0.085, 0.11 ],
    open:       1,
    sky:        'DUSK',
    exposure:   0.95,
    rupture:    Rupture.BLACKOUT,
    shatter:    0.45,
    sound:      2,
  },
  {
    id:         6,
    name:       'THE STACKS',
    theme:      Theme.STACKS,
    u0:         0.665,
    u1:         0.765,
    speed:      12,
    fog:        [ 0.01, 0.016, 0.026 ],
    fogDensity: 0.016,
    ambient:    [ 0.012, 0.018, 0.03 ],
    open:       0,
    sky:        null,
    exposure:   1.6,
    rupture:    Rupture.ADVANCE,
    shatter:    0.85,
    sound:      4,
  },
  {
    id:         7,
    name:       'THE DEPOT',
    theme:      Theme.DEPOT,
    u0:         0.765,
    u1:         0.865,
    speed:      15,
    fog:        [ 0.04, 0.028, 0.02 ],
    fogDensity: 0.0055,
    ambient:    [ 0.012, 0.013, 0.02 ],
    open:       1,
    sky:        'NIGHT',
    exposure:   1.5,
    rupture:    Rupture.EMPTY,
    shatter:    0.6,
    sound:      5,
  },
  {
    id:         8,
    name:       'THE TURNBACK',
    theme:      Theme.TRESTLE,
    u0:         0.865,
    u1:         1,
    speed:      18,
    fog:        [ 0.004, 0.0035, 0.005 ],
    fogDensity: 0.011,
    ambient:    [ 0.004, 0.004, 0.006 ],
    open:       1,
    sky:        'DEEP',
    exposure:   2.2,
    rupture:    Rupture.VANISH,
    shatter:    1.5,
    sound:      5,
  },
]

/**
 * THE CHORD exists only on the alt circuit. It is not a station and it was
 * never finished: an unlined brick bore from whatever the line was before it
 * was a line, with no lighting of its own, so the headlight is all there is.
 */
export const CHORD_BAY: Bay = {
  id:         9,
  name:       'THE CHORD',
  theme:      Theme.CHORD,
  u0:         0,
  u1:         0,
  speed:      20,
  fog:        [ 0.006, 0.005, 0.004 ],
  fogDensity: 0.035,
  ambient:    [ 0.0015, 0.0013, 0.0012 ],
  open:       0,
  sky:        null,
  exposure:   2.6,
  rupture:    Rupture.VANISH,
  shatter:    0.9,
  sound:      6,
}


/**
 * THE TURNBACK is where the lap counter advances: no walls, no ceiling, signal
 * lamps over nothing, so a bay whose parameters are sliding is a bay with
 * almost nothing on screen to slide.
 */
export const DECAY_BAY = 8

/** Zero-based lap on which the point machine throws: the HUD's LAP 3. */
export const SWITCH_LAP = 2

/** The bay the chord leaves from and the bay it rejoins in. */
const JUNCTION_BAY = 2
export const REJOIN_BAY = 4

/** How far inside the concourse the points are, before the end wall. */
const JUNCTION_LEAD = 70

/** How far into the annex the chord merges. */
const REJOIN_TAIL = 70

/** The chord's divergence ramp, metres: long enough to be a turnout, not a kink. */
const CHORD_RAMP = 180

/**
 * How far past the straight line the chord bows inward, and how deep it runs
 * below the line it replaces. The bow is what parts the two portals: on this
 * stretch the ring is so gently curved that the straight line alone would
 * leave the chord's mouth half inside the daylight portal.
 */
const CHORD_BOW   = 30
const CHORD_DEPTH = -4.5

/** Dense resample pitch for both splines. */
const RESAMPLE = 9

// --- the plan shape -------------------------------------------------------

// Radius in metres per 15 degrees of bearing, starting at +X, turning toward
// +Z. Deliberately not a circle: two long sweeps, a slack side, and a pinch
// where THE TURNBACK doubles back on itself.
const RADII = [
  346, 355, 371, 388, 396, 388,
  363, 330, 305, 297, 313, 338,
  355, 346, 322, 289, 264, 248,
  239, 248, 272, 297, 322, 338,
]

// Height above rail datum by loop fraction. Piecewise-linear; the spline
// smooths it. The low point is inside THE ANNEX, because water pools at the
// bottom of a drain and the flooded bay is the one the loop dips into.
const PROFILE: [ number, number ][] = [
  [ 0, -14 ], [ 0.085, -14 ], [ 0.13, -17 ], [ 0.185, -14 ],
  [ 0.24, -12 ], [ 0.305, -8 ], [ 0.34, -4 ], [ 0.4, -2 ],
  [ 0.435, -5 ], [ 0.48, -11 ], [ 0.535, -9 ], [ 0.57, -4 ],
  [ 0.61, 1 ], [ 0.665, -3 ], [ 0.7, -7 ], [ 0.765, -7 ],
  [ 0.8, -6 ], [ 0.865, -6 ], [ 0.9, -9 ], [ 0.96, -13 ],
  [ 1, -14 ],
]

function heightAt (u: number): number {
  const t = u - Math.floor(u)
  for (let i = 1; i < PROFILE.length; i++) {
    const [ ua, ha ] = PROFILE[i - 1]
    const [ ub, hb ] = PROFILE[i]
    if (t <= ub)
      return ha + (hb - ha) * ((t - ua) / (ub - ua))
  }
  return PROFILE[PROFILE.length - 1][1]
}

function ringPoints (y: number[]): Vec3[] {
  return RADII.map((r, i) => {
    const a = i / RADII.length * Math.PI * 2
    return { x: r * Math.cos(a), y: y[i], z: r * Math.sin(a) }
  })
}

/** A bay pinned to a concrete arc-length span on one particular circuit. */
export interface BaySpan {
  bay: Bay;
  s0:  number;
  s1:  number;
}

export interface Circuits {
  main:     ClosedCurve;
  alt:      ClosedCurve;
  mainBays: BaySpan[];
  altBays:  BaySpan[];

  /** The points: same arc length on both circuits, by construction. */
  junctionS: number;

  /** Where the chord is fully merged again, on each circuit. */
  rejoinMainS: number;
  rejoinAltS:  number;

  /** The two portal planes the chord crosses, as arc lengths on ALT. */
  chordStartAltS: number;
  chordEndAltS:   number;

  /** Inward unit vector (toward the loop's middle) — the chord bows this way. */
  inward(p: Vec3, out?: Vec3): Vec3;
}

/** Arc-length fraction of a curve parameter, by scan. Build time only. */
function arcFractionAtParam (curve: ClosedCurve, t: number): number {
  const p     = curve.sample(t)
  const steps = 4096
  let best  = 0
  let bestD = Infinity
  for (let i = 0; i < steps; i++) {
    const q = curve.pointAtDistance(i / steps * curve.length)
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      best  = i / steps
    }
  }
  return best
}

/**
 * Arc length on `curve`, near `guess`, where it crosses the plane through
 * `plane.pos` square to `plane.forward`. Bisection on the signed distance; the
 * bracket is small because the crossing is always within a few metres of the
 * guess.
 */
function crossPlane (curve: ClosedCurve, plane: Frame, guess: number): number {
  const side = (s: number): number => {
    const p = curve.pointAtDistance(s)
    return (p.x - plane.pos.x) * plane.forward.x +
      (p.y - plane.pos.y) * plane.forward.y +
      (p.z - plane.pos.z) * plane.forward.z
  }
  let a = guess - 40
  let b = guess + 40
  if (side(a) > 0 || side(b) < 0)
    return guess
  for (let i = 0; i < 48; i++) {
    const m = (a + b) * 0.5
    if (side(m) < 0)
      a = m
    else
      b = m
  }
  return (a + b) * 0.5
}

/**
 * Build both circuits. Two passes for elevation (flat to learn each control
 * point's arc fraction, then real), one dense resample shared by both splines,
 * and the chord as a smooth inward-and-down displacement of the resampled
 * points between the junction and the rejoin.
 */
function buildCircuits (): Circuits {
  const flat   = createClosedCurve(ringPoints(zeros(RADII.length)))
  const fracs  = RADII.map((_, i) => arcFractionAtParam(flat, i / RADII.length))
  const design = createClosedCurve(ringPoints(fracs.map(heightAt)))

  // One dense resampling, shared. Both splines go through these points, so
  // outside the chord they are made of identical segments.
  const n     = Math.round(design.length / RESAMPLE)
  const dense = Array.from({ length: n }, (_, i) => design.pointAtDistance(i / n * design.length))
  const main  = createClosedCurve(dense, 24)

  const L          = main.length
  const cutStart   = BAYS[JUNCTION_BAY + 1].u0 * L
  const annexStart = BAYS[REJOIN_BAY].u0 * L
  const junctionS  = cutStart - JUNCTION_LEAD
  const rejoinS    = annexStart + REJOIN_TAIL

  // The centroid of the plan, for "inward".
  const cx     = dense.reduce((a, p) => a + p.x, 0) / n
  const cz     = dense.reduce((a, p) => a + p.z, 0) / n
  const inward = (p: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 => {
    const dx = cx - p.x
    const dz = cz - p.z
    const l  = Math.hypot(dx, dz) || 1
    out.x    = dx / l
    out.y    = 0
    out.z    = dz / l
    return out
  }

  // The chord is pulled toward the straight line between the points and the
  // rejoin — a chord in the geometric sense — so it really is the short way
  // across. The pull ramps in from the points: ~12 m off the main line by the
  // concourse end wall, so the two portals stand apart. The dip waits until
  // both portal planes are behind it, so the chord crosses each wall level
  // with the main line and only then goes down into the dark.
  const P0             = main.pointAtDistance(junctionS)
  const P1             = main.pointAtDistance(rejoinS)
  const yA             = main.pointAtDistance(cutStart).y
  const yB             = main.pointAtDistance(annexStart).y
  const altPts: Vec3[] = dense.map((p, i) => {
    const s = i / n * L
    if (s <= junctionS || s >= rejoinS)
      return p

    const x    = (s - junctionS) / (rejoinS - junctionS)
    const pull = smootherstep(junctionS, junctionS + CHORD_RAMP, s) *
      smootherstep(rejoinS, rejoinS - CHORD_RAMP, s)
    // Vertically the chord ignores the main line's climb up to daylight and
    // runs nearly level between the two portals, sagging into a shallow dip:
    // the most a people-mover can be asked to take is under a tenth.
    let dip = 0
    if (s > cutStart && s < annexStart) {
      const xc     = (s - cutStart) / (annexStart - cutStart)
      const target = yA + (yB - yA) * xc + CHORD_DEPTH * Math.sin(Math.PI * xc) ** 2
      const blend  = smootherstep(cutStart, cutStart + 40, s) * smootherstep(annexStart, annexStart - 40, s)
      dip = (target - p.y) * blend
    }

    const v = inward(p)
    return {
      x: p.x + (P0.x + (P1.x - P0.x) * x - p.x + v.x * CHORD_BOW) * pull,
      y: p.y + dip,
      z: p.z + (P0.z + (P1.z - P0.z) * x - p.z + v.z * CHORD_BOW) * pull,
    }
  })
  const alt = createClosedCurve(altPts, 24)

  // Exact, by the shared-segment identity in the header.
  const rejoinAltS = alt.length - (L - rejoinS)
  const toAlt      = (mainS: number): number =>
    mainS <= junctionS ? mainS : rejoinAltS + (mainS - rejoinS)

  // The chord's own span is bounded by the two portal planes it passes
  // through, not by the points: up to the concourse end wall the alt track is
  // still inside the concourse, and after the annex's start wall it is inside
  // the annex. The HUD should say where you are, not where the rails split.
  const wallA          = main.frameAtDistance(cutStart)
  const wallB          = main.frameAtDistance(annexStart)
  const chordStartAltS = crossPlane(alt, wallA, cutStart)
  const chordEndAltS   = crossPlane(alt, wallB, rejoinAltS - REJOIN_TAIL)

  const mainBays: BaySpan[] = BAYS.map(bay => ({ bay, s0: bay.u0 * L, s1: bay.u1 * L }))

  const altBays: BaySpan[] = []
  for (const span of mainBays) {
    const id = span.bay.id
    if (id === JUNCTION_BAY) {
      altBays.push({ bay: span.bay, s0: toAlt(span.s0), s1: chordStartAltS })
      altBays.push({ bay: CHORD_BAY, s0: chordStartAltS, s1: chordEndAltS })
    }
    else if (id === REJOIN_BAY)
      altBays.push({ bay: span.bay, s0: chordEndAltS, s1: toAlt(span.s1) })
    else if (id !== JUNCTION_BAY + 1)
      altBays.push({ bay: span.bay, s0: toAlt(span.s0), s1: toAlt(span.s1) })
  }

  return {
    main,
    alt,
    mainBays,
    altBays,
    junctionS,
    rejoinMainS: rejoinS,
    rejoinAltS,
    chordStartAltS,
    chordEndAltS,
    inward,
  }
}


/** Index of the span owning `s`, for neighbour lookups. */
export function spanIndexAt (spans: BaySpan[], s: number, loopLength: number): number {
  const t = (s % loopLength + loopLength) % loopLength
  for (let i = 0; i < spans.length; i++)
    if (t < spans[i].s1)
      return i
  return spans.length - 1
}

// Built once per page load and shared: the simulation and the scene must ride
// the same spline, or the train rides through the ballast. A few milliseconds
// once, rather than again on every StrictMode remount.
let circuits: Circuits | null = null

export function getCircuits (): Circuits {
  if (!circuits)
    circuits = buildCircuits()
  return circuits
}
