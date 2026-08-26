// THE LOOP LINE — the circuit.
//
// Six stations on a driverless people-mover with no terminus. This file is the
// route table: the shape of the track, what each bay is made of, and the
// schedule by which all of it comes apart.
//
// ---------------------------------------------------------------------------
// The fourth way of turning
// ---------------------------------------------------------------------------
//
// This repo already has three answers to "how do you turn forever without cost
// or float precision growing":
//
//   stairwell   re-anchors in GLSL — three sections resident, each rotated into
//               the camera's frame, turn table in the shader.
//   natatorium  moves that table to the CPU and uploads an affine transform per
//               resident section, so turns are data and can be any angle.
//   switchback  rectifies: the camera never moves, and the whole world is
//               sheared around it by a per-frame quadratic.
//
// This is the fourth, and it is the one that cheats. All three of the others
// exist because the route is *unbounded* — a descent, a corridor chain, a
// railway that runs forever — so no amount of geometry can cover it and the
// world must be generated around a moving observer. A closed circuit is not
// unbounded. It is 1.2 kilometres long and then it is the same 1.2 kilometres
// again. So: build the whole thing, once, out of actual triangles, and let the
// camera be an ordinary camera that moves through it.
//
// Everything the other three journeys work hardest at simply evaporates. There
// is no turn radius floor, because nothing is being fitted to a quadratic. There
// is no coordinate drift, because arc length wraps at the loop length and the
// world never translates. The track can cross over itself, which not one of the
// SDF journeys can express, because it is just vertices.
//
// ---------------------------------------------------------------------------
// Why the layout is polar and the elevation is not
// ---------------------------------------------------------------------------
//
// The plan shape is authored as a radius per bearing — a hand-tuned polar table
// — because that is the shape you can actually read as a diagram while tuning
// it. The elevation cannot be authored the same way, because bays are defined by
// *arc-length fraction* and a polar table is indexed by *angle*, and radius
// varies, so the two do not correspond. The height at a bearing would land in
// the wrong bay.
//
// So the curve is built twice (see `buildCircuits`): once flat, purely to
// measure where each control point falls in arc length, and once for real with
// each point's height sampled from PROFILE at the fraction the first pass
// reported. Adding ±20 m of height to a 1200 m loop changes its length by well
// under a percent, so the second pass's fractions differ from the first's by
// less than the tuning resolution. It is a fixed point reached in one step.
//
// ---------------------------------------------------------------------------
// The chord
// ---------------------------------------------------------------------------
//
// There are two circuits, not one, and both are built and drawn from the first
// frame. MAIN runs all six bays. ALT is identical except that it replaces the
// arc through THE CUT with a bowed chord straight across the middle of the loop,
// at tunnel depth, never surfacing.
//
// The point machine at the divergence is real, and on lap one you ride past it
// and see the chord's mouth curving away into the dark with the main line. When
// it throws, the line loses THE CUT — which is the only daylight on the circuit.
// That is the whole reason the chord skips that bay and not another one.
//
// Because ALT is shorter, throwing the switch also shortens the lap. The ride
// gets darker, faster and *smaller*, in that order.

import { createClosedCurve } from '@/lib/curve'
import type { ClosedCurve, Vec3 } from '@/lib/curve'


/** Sentinel half-width for a bay with no walls at all — the cut and the trestle. */
export const OPEN = 400

/** How each bay fails. One mode per bay: they do not come apart the same way. */
export const enum Rupture {

  /** The benches fill with people who were not there, then the edge crumbles. */
  CROWD = 0,

  /** The mezzanine detaches and rotates about its own axis. */
  INVERT = 1,

  /** The sky comes down until there is no outside left. */
  ERASE = 2,

  /** The water rises a step per lap until the camera goes under. */
  FLOOD = 3,

  /** The racks wake, and then they close in. */
  ADVANCE = 4,

  /** The structure leaves one member at a time. */
  VANISH = 5,
}

/** Which prop set and shell generator a bay uses. */
export const enum Theme {
  TILE = 0,
  VAULT = 1,
  CUT = 2,
  ANNEX = 3,
  MACHINE = 4,
  TRESTLE = 5,
  CHORD = 6,
}

export interface Bay {
  id:    number;
  name:  string;
  theme: Theme;

  /** Span as a fraction of the loop, [u0, u1). The table tiles [0,1) exactly. */
  u0: number;
  u1: number;

  /** Half-width of the enclosure in metres, or OPEN for no walls. */
  bore: number;

  /** Ceiling height above rail, and floor depth below it. Zero ceiling = no roof. */
  ceilH:  number;
  floorD: number;

  /** Metres between lamps, their height above rail, and their colour. */
  lampPitch: number;
  lampY:     number;
  lampTint:  [number, number, number];

  /** Fog colour and per-metre extinction. */
  fog:        [number, number, number];
  fogDensity: number;

  /** 0 fully enclosed, 1 open to sky — drives how much ambient the shell takes. */
  sky: number;

  /** Target speed through the bay, m/s, before any lap scaling. */
  speed: number;

  rupture: Rupture;
}

// The six, in running order. u1 of each is u0 of the next, and the last wraps.
export const BAYS: Bay[] = [
  {
    id:         0,
    name:       'PLATFORM SIX',
    theme:      Theme.TILE,
    u0:         0.00,
    u1:         0.14,
    bore:       9,
    ceilH:      6,
    floorD:     1.2,
    lampPitch:  8,
    lampY:      5.2,
    lampTint:   [ 1.00, 0.82, 0.55 ],
    fog:        [ 0.10, 0.08, 0.07 ],
    fogDensity: 0.012,
    sky:        0,
    speed:      9,
    rupture:    Rupture.CROWD,
  },
  {
    id:         1,
    name:       'THE CONCOURSE',
    theme:      Theme.VAULT,
    u0:         0.14,
    u1:         0.30,
    bore:       14,
    ceilH:      13,
    floorD:     1.2,
    lampPitch:  12,
    lampY:      11.0,
    lampTint:   [ 0.92, 0.94, 0.88 ],
    fog:        [ 0.09, 0.09, 0.10 ],
    fogDensity: 0.010,
    sky:        0,
    speed:      14,
    rupture:    Rupture.INVERT,
  },
  {
    id:         2,
    name:       'THE CUT',
    theme:      Theme.CUT,
    u0:         0.30,
    u1:         0.50,
    bore:       OPEN,
    ceilH:      0,
    floorD:     2.5,
    lampPitch:  34,
    lampY:      7.0,
    lampTint:   [ 0.80, 0.86, 1.00 ],
    fog:        [ 0.78, 0.80, 0.82 ],
    fogDensity: 0.004,
    sky:        1,
    speed:      22,
    rupture:    Rupture.ERASE,
  },
  {
    id:         3,
    name:       'THE ANNEX',
    theme:      Theme.ANNEX,
    u0:         0.50,
    u1:         0.65,
    bore:       11,
    ceilH:      5.5,
    floorD:     3.4,
    lampPitch:  10,
    lampY:      4.8,
    lampTint:   [ 0.62, 0.88, 0.78 ],
    fog:        [ 0.05, 0.09, 0.09 ],
    fogDensity: 0.020,
    sky:        0,
    speed:      16,
    rupture:    Rupture.FLOOD,
  },
  {
    id:         4,
    name:       'THE STACKS',
    theme:      Theme.MACHINE,
    u0:         0.65,
    u1:         0.82,
    bore:       7,
    ceilH:      4.5,
    floorD:     1.0,
    lampPitch:  3,
    lampY:      3.9,
    lampTint:   [ 0.40, 0.62, 1.00 ],
    fog:        [ 0.03, 0.05, 0.08 ],
    fogDensity: 0.016,
    sky:        0,
    speed:      12,
    rupture:    Rupture.ADVANCE,
  },
  {
    id:         5,
    name:       'THE TURNBACK',
    theme:      Theme.TRESTLE,
    u0:         0.82,
    u1:         1.00,
    bore:       OPEN,
    ceilH:      0,
    floorD:     28,
    lampPitch:  26,
    lampY:      3.2,
    lampTint:   [ 1.00, 0.30, 0.22 ],
    fog:        [ 0.01, 0.01, 0.02 ],
    fogDensity: 0.030,
    sky:        0,
    speed:      19,
    rupture:    Rupture.VANISH,
  },
]

/**
 * THE TURNBACK is where the lap counter advances. It has no walls, no ceiling
 * and nothing but signal lamps in it, so it is the one bay whose appearance a
 * lap boundary can change without anything visibly popping — the same trick
 * switchback plays with THE OVERLOOK.
 */
export const DECAY_BAY = 5

/** Loop fraction at which the chord leaves the main line, and where it rejoins. */
export const JUNCTION_U = 0.2833
export const REJOIN_U   = 0.5417

/**
 * The lap on which the point machine throws. Before this, the chord is scenery
 * you ride past. Zero-based, so 2 is the lap the HUD calls LAP 3 — the HUD adds
 * one because no passenger counts their first lap as the zeroth.
 */
export const SWITCH_LAP = 2

// --- the plan shape -------------------------------------------------------

// Radius in metres per 15 degrees of bearing, starting at +X and turning toward
// +Z. Deliberately not a circle: two long sweeps, a slack side, and a pinch at
// the turnback where the line doubles back on itself.
const RADII = [
  210, 215, 225, 235, 240, 235,
  220, 200, 185, 180, 190, 205,
  215, 210, 195, 175, 160, 150,
  145, 150, 165, 180, 195, 205,
]

// Height in metres above rail datum, keyed by loop fraction. Piecewise-linear
// between keys — the spline smooths it, so there is no need to smooth it twice.
// The circuit's low point is deliberately inside THE ANNEX: water pools at the
// bottom of a drain, so the flooded bay is the bay the loop dips into.
const PROFILE: [number, number][] = [
  [ 0.00, -16 ], [ 0.14, -16 ], [ 0.20, -15 ], [ 0.30, -10 ],
  [ 0.38, -4 ], [ 0.44, 0 ], [ 0.50, -1 ], [ 0.58, -9 ],
  [ 0.65, -17 ], [ 0.70, -20 ], [ 0.76, -18 ], [ 0.82, -16 ],
  [ 0.88, -15 ], [ 0.94, -15 ], [ 1.00, -16 ],
]

// The chord, in plan. Three points bowed in toward the middle of the loop,
// replacing the six ring points that carry the line up into THE CUT.
const CHORD_XZ: [number, number][] = [
  [ -56.3, 111.1 ],
  [ -80.4, 40.8 ],
  [ -131.9, -12.7 ],
]

/** Depth the chord runs at. It never surfaces; that is the entire point of it. */
const CHORD_Y = -15

/** Ring point indices the chord replaces (bearings 105 deg through 180 deg). */
const CHORD_REPLACES = [ 7, 8, 9, 10, 11, 12 ]

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

/**
 * THE CHORD exists only on the alt circuit, where it stands in for THE CUT.
 * It is not a station and it was never finished: an unlined brick bore from
 * whatever the line was before it was a line, with no lighting of its own. The
 * switch therefore trades the only daylight on the circuit for the only
 * darkness, which is the entire argument for putting the chord here and not
 * somewhere less expensive.
 */
export const CHORD_BAY: Bay = {
  id:         6,
  name:       'THE CHORD',
  theme:      Theme.CHORD,
  u0:         JUNCTION_U,
  u1:         REJOIN_U,
  bore:       5.5,
  ceilH:      3.6,
  floorD:     0.8,
  lampPitch:  0,
  lampY:      0,
  lampTint:   [ 0, 0, 0 ],
  fog:        [ 0.02, 0.015, 0.012 ],
  fogDensity: 0.045,
  sky:        0,
  speed:      20,
  rupture:    Rupture.VANISH,
}

/** A bay pinned to a concrete arc-length span on one particular circuit. */
export interface BaySpan {
  bay: Bay;
  s0:  number;
  s1:  number;
}

export interface Circuits {

  /** All six bays, including the daylight. */
  main: ClosedCurve;

  /** Identical except THE CUT is replaced by the chord. */
  alt: ClosedCurve;

  mainBays: BaySpan[];
  altBays:  BaySpan[];

  /** Where the point machine sits, measured on each circuit independently. */
  junctionS:    number;
  altJunctionS: number;
}

/**
 * Nearest arc length on `curve` to a world point, by brute-force scan. Only ever
 * called at build time — a few dozen times, once — so the linear sweep costs
 * nothing and saves having to invert a Catmull-Rom analytically.
 */
function nearestDistance (curve: ClosedCurve, p: Vec3, steps = 4096): number {
  let best  = 0
  let bestD = Infinity
  for (let i = 0; i < steps; i++) {
    const s = i / steps * curve.length
    const q = curve.pointAtDistance(s)
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      best  = s
    }
  }
  return best
}

/**
 * Build both circuits. The two-pass elevation trick described in the header
 * lives here: pass one is flat and exists only to learn each control point's
 * arc-length fraction, pass two uses those fractions to sample the profile.
 */
export function buildCircuits (): Circuits {
  const flatY = new Array(RADII.length).fill(0) as number[]
  const flat  = createClosedCurve(ringPoints(flatY))

  // createClosedCurve puts control point i at parameter i/N; what we want back
  // is where that lands in arc length, which is not the same fraction unless
  // the radius is constant — and it deliberately is not.
  const fracs = RADII.map((_, i) =>
    nearestDistance(flat, flat.sample(i / RADII.length)) / flat.length)

  const ring = ringPoints(fracs.map(heightAt))
  const main = createClosedCurve(ring)

  const altPts: Vec3[] = []
  ring.forEach((p, i) => {
    if (CHORD_REPLACES.includes(i)) {
      if (i === CHORD_REPLACES[0])
        for (const [ x, z ] of CHORD_XZ)
          altPts.push({ x, y: CHORD_Y, z })
      return
    }
    altPts.push(p)
  })

  const alt = createClosedCurve(altPts)

  // Bay spans on the main circuit are just the authored fractions scaled up.
  const mainBays: BaySpan[] = BAYS.map(bay => ({
    bay,
    s0: bay.u0 * main.length,
    s1: bay.u1 * main.length,
  }))

  // On the alt circuit they are not, because the loop is a different length and
  // one bay is gone. Every boundary that still exists on both circuits is
  // located by finding the world point on main and asking alt where that is —
  // so the stations stay put in space even though their arc lengths move.
  const junctionS    = JUNCTION_U * main.length
  const rejoinS      = REJOIN_U * main.length
  const altJunctionS = nearestDistance(alt, main.pointAtDistance(junctionS))
  const altRejoinS   = nearestDistance(alt, main.pointAtDistance(rejoinS))

  const altBoundary = (u: number): number =>
    nearestDistance(alt, main.pointAtDistance(u * main.length))

  const altBays: BaySpan[] = []
  for (const bay of BAYS) {
    if (bay.theme === Theme.CUT) {
      altBays.push({ bay: CHORD_BAY, s0: altJunctionS, s1: altRejoinS })
      continue
    }
    altBays.push({
      bay,
      s0: bay.u0 === 0 ? 0 : altBoundary(bay.u0),
      s1: bay.u1 === 1 ? alt.length : altBoundary(bay.u1),
    })
  }

  // The chord's own span is authored, not measured, so nudge its neighbours to
  // meet it exactly — a one-metre gap between bays is a one-metre hole in the
  // world, and the shell generator tiles from these numbers.
  for (let i = 0; i < altBays.length; i++) {
    const next = altBays[(i + 1) % altBays.length]
    if (i < altBays.length - 1)
      altBays[i].s1 = next.s0
  }

  return { main, alt, mainBays, altBays, junctionS, altJunctionS }
}

/** The span owning an arc length on a given circuit. Total: the spans tile it. */
export function spanAt (spans: BaySpan[], s: number, loopLength: number): BaySpan {
  const t = (s % loopLength + loopLength) % loopLength
  for (const span of spans)
    if (t < span.s1)
      return span
  return spans[spans.length - 1]
}

// Built once per page load and shared. The circuits are pure geometry — no GL
// handles, no mutable state — so the simulation and the scene can hold the same
// object, which they must: a train riding a different spline from the one the
// track was built along is a train riding through the ballast. The build costs a
// few hundred thousand LUT lookups, which is a few milliseconds once, and would
// otherwise be paid again on every StrictMode remount.
let circuits: Circuits | null = null

export function getCircuits (): Circuits {
  if (!circuits)
    circuits = buildCircuits()
  return circuits
}
