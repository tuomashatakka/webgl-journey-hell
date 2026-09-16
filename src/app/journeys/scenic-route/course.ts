// THE SCENIC ROUTE — the authored table.
//
// One closed spline through seven sections, a bank table over it, and a speed
// model per section. Everything the simulation and the renderer agree on lives
// here, because the two must agree exactly: a camera riding a different curve
// from the one the asphalt was swept along is a camera in the ballast.
//
// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
//
// The control points are absolute world positions, authored by section with
// small generators (an arc, a helix, a parabola, a pull-out) so the numbers that
// matter — radii, turns, the drop — are written once as numbers rather than
// smeared across a hundred coordinates. Each section's first point is its
// boundary; the spline is built once and the boundary arc lengths are read back
// off it, so SPANS is exact rather than estimated.
//
// Elevation is a coaster's, not a map's: the only climb on the lap is THE
// INCLINE. The valley sits below the cave, the cave below the sea, and water is
// never seen flowing uphill.
//
// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------
//
// Parallel transport gives the camera a twist-free frame; a road has camber and
// a coaster has bank, so the roll about the tangent is authored as a table of
// knots and interpolated with a C¹ Catmull-Rom over arc length into a dense
// Float32Array at BANK_STEP. Both the CPU (the camera) and the GPU (a 1D texture
// the vertex shader reads) sample *that array*, so the asphalt and the eye roll
// by the same number to the bit.
//
// A knot marked `auto` takes its sign from the curve's own curvature at that
// arc length. Turn direction is a property of the geometry, and hand-typing it
// is a class of error this file does not need to have.
//
// The per-lap amplification is a gain and nothing else: `bank · (1 + lapF ·
// BANK_GAIN)`. Affine in angle space cannot jump, cannot reorder two authored
// values, and keeps every section agreeing with its neighbour — the switchback
// lesson, applied before the bug rather than after.

import { createClosedCurve } from '@/lib/curve'
import type { ClosedCurve, Vec3 } from '@/lib/curve'


const D = Math.PI / 180

export const enum Kind {
  COUNTY = 0,
  INCLINE = 1,
  DOWNTOWN = 2,
  COAST = 3,
  FALL = 4,
  GULLET = 5,
  UNDERTOW = 6,
}

export interface Section {
  id:   number;
  name: string;
  kind: Kind;

  // --- the speed model ---------------------------------------------------
  /** The driver's target, m/s. */
  vTarget: number;

  /** Time constant toward it, seconds. */
  tau: number;

  /** How much the driver is in control, 0..1. Zero in the fall. */
  throttle: number;

  /** How much gravity along the tangent reaches the speed, 0..1. */
  gW: number;

  /** Quadratic drag: air on the road, slime in the throat, water in the cave. */
  cD: number;

  // --- the look ------------------------------------------------------------
  /** Exposure offset in EV over the daylight baseline. */
  exposure: number;

  /** 0 enclosed, 1 open to the sky. Blended along s like everything else. */
  sky: number;

  /** Fog colour where the sky is not the fog (the throat, the cave). */
  fog: [ number, number, number ];

  /** Fog density, 1/m. */
  fogDensity: number;

  /** Half width of the running surface, metres. */
  roadHalf: number;

  /** 0 asphalt, 1 concrete, 2 none (the fall), 3 flesh, 4 rock. */
  surface: number;
}

export const SECTIONS: Section[] = [
  {
    id:         0,
    name:       'THE COUNTY ROAD',
    kind:       Kind.COUNTY,
    vTarget:    22,
    tau:        2.5,
    throttle:   1,
    gW:         0.15,
    cD:         0.0020,
    exposure:   0.0,
    sky:        1,
    fog:        [ 0.62, 0.66, 0.70 ],
    fogDensity: 0.0008,
    roadHalf:   3.4,
    surface:    0,
  },
  {
    id:         1,
    name:       'THE INCLINE',
    kind:       Kind.INCLINE,
    // Gravity along a 26° tangent is 0.2 · g · sin 26° ≈ 0.86 m/s²; the driver
    // pulls at (15 − v) / 3. They meet at about 12.4 m/s, which is a car
    // labouring up a hill in second, and that equilibrium — not the target —
    // is the number worth knowing.
    vTarget:    15,
    tau:        3.0,
    throttle:   1,
    gW:         0.20,
    cD:         0.0020,
    exposure:   0.0,
    sky:        1,
    fog:        [ 0.60, 0.64, 0.68 ],
    fogDensity: 0.0012,
    roadHalf:   3.6,
    surface:    0,
  },
  {
    id:         2,
    name:       'DOWNTOWN',
    kind:       Kind.DOWNTOWN,
    vTarget:    32,
    tau:        3.0,
    throttle:   0.3,
    gW:         1.0,
    cD:         0.0012,
    exposure:   -0.2,
    sky:        1,
    fog:        [ 0.66, 0.60, 0.56 ],
    fogDensity: 0.0014,
    roadHalf:   4.0,
    surface:    0,
  },
  {
    id:         3,
    name:       'THE COAST ROAD',
    kind:       Kind.COAST,
    vTarget:    28,
    tau:        2.5,
    throttle:   1,
    gW:         0.30,
    cD:         0.0016,
    exposure:   0.0,
    sky:        1,
    fog:        [ 0.66, 0.70, 0.74 ],
    fogDensity: 0.0010,
    roadHalf:   3.6,
    surface:    0,
  },
  {
    id:         4,
    name:       'THE FALL',
    kind:       Kind.FALL,
    // Same as the coast road's: the throttle blends to zero across the lip, and
    // a target that also blended down would brake the car before the edge.
    vTarget:    28,
    tau:        1.0,
    throttle:   0,
    gW:         1.0,
    cD:         0.0004,
    exposure:   0.2,
    sky:        1,
    fog:        [ 0.66, 0.70, 0.74 ],
    fogDensity: 0.0008,
    roadHalf:   3.6,
    surface:    2,
  },
  {
    id:         5,
    name:       'THE GULLET',
    kind:       Kind.GULLET,
    vTarget:    14,
    tau:        1.2,
    throttle:   1,
    gW:         0.30,
    cD:         0.0090,
    exposure:   0.9,
    sky:        0,
    fog:        [ 0.35, 0.05, 0.04 ],
    fogDensity: 0.012,
    roadHalf:   3.0,
    surface:    3,
  },
  {
    id:         6,
    name:       'THE UNDERTOW',
    kind:       Kind.UNDERTOW,
    vTarget:    13,
    tau:        3.0,
    throttle:   1,
    gW:         0.0,
    cD:         0.0060,
    exposure:   1.0,
    sky:        0,
    fog:        [ 0.02, 0.05, 0.06 ],
    fogDensity: 0.008,
    roadHalf:   3.0,
    surface:    4,
  },
]

export const SECTION_COUNT = SECTIONS.length

/** Where lapF ramps: the cave, where there is the least on screen to slide. */
export const DECAY_SECTION = 6

/** Helix bank 40° on the first lap and a full roll on the third: 40 · (1 + 2 · 4). */
export const BANK_GAIN = 4

/**
 * Where the gain stops growing. Past the third lap the picture is going anyway,
 * and 1 + 2.25 · 4 = 10 keeps the worst bank rate inside one order of magnitude
 * of the authored lap — the gate the tests hold it to.
 */
export const BANK_LAP_CAP = 2.25

/** The bank multiplier at lapF. One function, read by the camera and the shader. */
export function bankGainAt (lapF: number): number {
  return 1 + Math.min(lapF, BANK_LAP_CAP) * BANK_GAIN
}

/** Per-lap speed: targets up, drag down. */
export const SPEED_LAP = 0.08
export const DRAG_LAP  = 0.20

/** Metres between bank table samples. */
export const BANK_STEP = 0.5

/** Half the boundary blend window: every per-section quantity crosses in 2·W metres. */
export const BLEND_W = 15

// ---------------------------------------------------------------------------
// Control points
// ---------------------------------------------------------------------------

const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** Ease used for the incline's grade in and out. */
const smooth = (t: number): number => t * t * (3 - 2 * t)

/** Points on a circular arc in the ground plane with a linear height ramp. */
function arc (
  cx: number, cz: number, r: number, a0: number, a1: number, n: number,
  y0: number, y1: number, ease = false,
): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = a0 + (a1 - a0) * t
    const k = ease ? smooth(t) : t
    out.push(P(cx + r * Math.cos(a), y0 + (y1 - y0) * k, cz - r * Math.sin(a)))
  }
  return out
}

/**
 * A ballistic arc from `lip` along unit ground heading `h` at speed v0,
 * sampled every `dt` seconds for `tEnd` seconds. Gravity and nothing else.
 */
function parabola (lip: Vec3, hx: number, hz: number, v0: number, dt: number, tEnd: number): Vec3[] {
  const out: Vec3[] = []
  for (let t = dt; t <= tEnd + 1e-6; t += dt)
    out.push(P(lip.x + hx * v0 * t, lip.y - 4.905 * t * t, lip.z + hz * v0 * t))
  return out
}

/**
 * A pull-out from a dive: heading fixed in plan, pitch recovering from p0 to p1
 * on a circle of radius r, sampled every `step` metres of arc. Then a level
 * turn of `turnDeg` (positive = toward the frame's left) on radius rt.
 */
function throat (
  start: Vec3, hx: number, hz: number, p0: number, p1: number, r: number,
  step: number, turnDeg: number, rt: number, yEnd: number,
): Vec3[] {
  const out: Vec3[] = []
  let x = start.x
  let y = start.y
  let z = start.z
  const arcLen = Math.abs(p1 - p0) * r
  const n      = Math.ceil(arcLen / step)
  for (let i = 1; i <= n; i++) {
    const pitch = p0 + (p1 - p0) * (i / n)
    const ds    = arcLen / n
    x += hx * Math.cos(pitch) * ds
    z += hz * Math.cos(pitch) * ds
    y += Math.sin(pitch) * ds
    out.push(P(x, y, z))
  }

  // Level turn about a centre on the turning side. Left of heading (hx, hz) in
  // this handedness is (hz, -hx). Walking the circle: the position relative to
  // the centre starts at -side·left, and moving forward means the polar angle
  // DEcreases for a left turn and increases for a right one — get that
  // backwards and the spline doubles back on itself at the join.
  const left = turnDeg > 0
  const side = left ? 1 : -1
  const cx   = x + hz * rt * side
  const cz   = z - hx * rt * side
  const a0   = Math.atan2(z - cz, x - cx)
  const dir  = left ? -1 : 1
  const m    = Math.ceil(Math.abs(turnDeg) * D * rt / step)
  for (let i = 1; i <= m; i++) {
    const a = a0 + dir * Math.abs(turnDeg) * D * (i / m)
    const t = i / m
    out.push(P(cx + rt * Math.cos(a), y + (yEnd - y) * t, cz + rt * Math.sin(a)))
  }
  return out
}

/**
 * The seven sections' control points. Section i begins at pointsBySection[i][0].
 * Coordinates: y up, right-handed; `right = forward × up`, so heading +z puts
 * the driver's right on −x. Nothing below relies on a compass — turn direction
 * is read off the built curve where it matters (see resolveBankSigns).
 */
function pointsBySection (): Vec3[][] {
  // I — the valley floor. Two crests for airtime.
  const county = [
    P(0, -55, 0), P(-3, -53, 75), P(5, -58, 150), P(-6, -51, 225),
    P(3, -58, 300), P(-2, -52, 370), P(4, -56, 440),
  ]

  // II — the lift hill: a quarter circle (r 230) climbing 175 m at a steady
  // 26°, then 50 m level. Linear in y on purpose: the spline eases the foot
  // and the crest over one control-point spacing, which is a real crest.
  const inclineArc = arc(238, 500, 230, Math.PI, Math.PI * 1.5, 5, -55, 120)
  const incline    = [ P(8, -55, 500), ...inclineArc.slice(1), P(290, 120, 730) ]

  // III — the approach, a 1.25-turn helix (r 45) dropping 40 m, and the exit.
  // Twenty points a turn and a quarter: fewer, and the spline cuts the corners
  // and the lateral load at the control points passes four g.
  const helix: Vec3[] = []
  const hc            = { x: 360, z: 685 }
  const turns         = 1.25
  const hn            = 20
  for (let i = 0; i <= hn; i++) {
    const th = turns * 2 * Math.PI * (i / hn)
    helix.push(P(hc.x + 45 * Math.sin(th), 120 - 40 * (i / hn), hc.z + 45 * Math.cos(th)))
  }

  const downtown = [ P(318, 120, 730), P(340, 120, 730), ...helix, P(405, 80, 620), P(405, 80, 575) ]

  // IV — the cliff-top: a long right-hander onto the headland.
  const coast = [
    P(405, 80, 540), P(406, 82, 470), P(412, 85, 400), P(426, 89, 335),
    P(450, 93, 280), P(482, 97, 242), P(508, 100, 226),
  ]

  // V — the ballistic arc from the lip. 30 m/s off the edge, 3.9 s to the mouth.
  const lip     = P(530, 100, 220)
  const hl      = Math.hypot(22, -6)
  const hx      = 22 / hl
  const hz      = -6 / hl
  const fallPts = parabola(lip, hx, hz, 30, 0.78, 3.9)
  const mouth   = fallPts[fallPts.length - 1]
  const fall    = [ lip, ...fallPts.slice(0, -1) ]

  // VI — the throat, beginning at the mouth: pull out of the dive on r 130,
  // then a 180° turn on r 55 back toward the valley, settling at −40.
  const pitch0    = Math.atan2(-4.905 * 2 * 3.9, 30)
  const throatPts = throat(mouth, hx, hz, pitch0, -3 * D, 130, 30, 180, 55, -40)
  const gEnd      = throatPts[throatPts.length - 1]
  const gullet    = [ mouth, ...throatPts.slice(0, -1) ]

  // VII — the river, back to the portal, arriving on the county road's heading.
  const undertow = [
    gEnd,
    P(gEnd.x - 45, -41, gEnd.z + 8), P(gEnd.x - 195, -43, gEnd.z + 14),
    P(gEnd.x - 335, -46, gEnd.z + 4),
    P(170, -49, -50), P(75, -53, -62), P(18, -55, -38),
  ]

  return [ county, incline, downtown, coast, fall, gullet, undertow ]
}

// ---------------------------------------------------------------------------
// Bank knots
// ---------------------------------------------------------------------------

interface BankKnot {

  /** Section index and fraction of the section's arc length. */
  sec:  number;
  frac: number;

  /** Degrees. Magnitude when `auto`, signed when not. */
  deg: number;

  /** Take the sign from the curve's curvature there. */
  auto: boolean;
}

const K = (sec: number, frac: number, deg: number, auto = true): BankKnot => ({ sec, frac, deg, auto })

const BANK_KNOTS: BankKnot[] = [
  // I — camber into each wiggle.
  K(0, 0.02, 0), K(0, 0.16, 2.5), K(0, 0.32, 3), K(0, 0.47, 3), K(0, 0.62, 2.5), K(0, 0.78, 2), K(0, 0.94, 0),
  // II — a long constant-radius climb.
  K(1, 0.08, 0), K(1, 0.40, 6), K(1, 0.72, 5), K(1, 0.96, 0),
  // III — the helix. 40° here is the reference the laps are heard against.
  K(2, 0.04, 0), K(2, 0.13, 20), K(2, 0.28, 40), K(2, 0.46, 40), K(2, 0.64, 40), K(2, 0.78, 20), K(2, 0.94, 0),
  // IV — mild, then the headland right-hander.
  K(3, 0.06, 0), K(3, 0.30, 3), K(3, 0.55, 3), K(3, 0.80, 6), K(3, 0.97, 4),
  // V — the tumble. Not a turn, so signed by hand.
  K(4, 0.10, 6, false), K(4, 0.45, 14, false), K(4, 0.80, 22, false), K(4, 0.98, 25, false),
  // VI — settle, then the turn back.
  K(5, 0.06, 22, false), K(5, 0.30, 6, false), K(5, 0.55, 26), K(5, 0.80, 14), K(5, 0.97, 0),
  // VII — level. The float dynamics roll the car, not the table.
  K(6, 0.05, 0), K(6, 0.50, 0), K(6, 0.96, 0),
]

// ---------------------------------------------------------------------------
// The built route
// ---------------------------------------------------------------------------

export interface Span {
  section: Section;
  s0:      number;
  s1:      number;
}

export interface Route {
  curve:  ClosedCurve;
  spans:  Span[];
  length: number;

  /** Bank in radians at lap 0, every BANK_STEP metres from s = 0, cyclic. */
  bankTable: Float32Array;
}

/** Arc length of the nearest point on the curve to `p`: coarse walk, then refine. */
function arcLengthOfPoint (curve: ClosedCurve, p: Vec3): number {
  const L   = curve.length
  const tmp = { x: 0, y: 0, z: 0 }
  let bestS = 0
  let bestD = Infinity
  for (let s = 0; s < L; s += 1) {
    curve.pointAtDistance(s, tmp)

    const d = (tmp.x - p.x) ** 2 + (tmp.y - p.y) ** 2 + (tmp.z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      bestS = s
    }
  }
  for (let s = bestS - 1; s <= bestS + 1; s += 0.01) {
    curve.pointAtDistance(s, tmp)

    const d = (tmp.x - p.x) ** 2 + (tmp.y - p.y) ** 2 + (tmp.z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      bestS = s
    }
  }
  return (bestS % L + L) % L
}

/**
 * Signed curvature at s: the tangent's rate of turn toward `right`, positive
 * for a right-hand turn. Central difference over ±h, which also makes it the
 * quantity the steering wheel and the sway spring want.
 */
export function signedCurvature (curve: ClosedCurve, s: number, h = 1.0): number {
  const a = curve.frameAtDistance(s - h)
  const b = curve.frameAtDistance(s + h)
  // Level right at s: forward × worldUp, normalised.
  const f  = curve.frameAtDistance(s)
  let rx = -f.forward.z
  let rz = f.forward.x
  const rl = Math.hypot(rx, rz) || 1
  rx /= rl
  rz /= rl

  const dfx = b.forward.x - a.forward.x
  const dfz = b.forward.z - a.forward.z
  return (dfx * rx + dfz * rz) / (2 * h)
}

/** Cyclic Catmull-Rom through (s, value) knots, sampled every `step` metres. */
function tabulate (knots: { s: number; v: number }[], L: number, step: number): Float32Array {
  const n   = knots.length
  const N   = Math.ceil(L / step)
  const out = new Float32Array(N)
  const at  = (i: number) => knots[(i % n + n) % n]
  // Knot s wrapped so consecutive knots increase; the table is cyclic.
  const sOf = (i: number) => {
    const base = Math.floor(i / n) * L
    return at(i).s + base
  }
  let k = 0
  for (let j = 0; j < N; j++) {
    const s = j * step
    while (sOf(k + 1) <= s)
      k++
    while (sOf(k) > s)
      k--

    const s0 = sOf(k)
    const s1 = sOf(k + 1)
    const t  = (s - s0) / (s1 - s0)
    const p0 = at(k - 1).v
    const p1 = at(k).v
    const p2 = at(k + 1).v
    const p3 = at(k + 2).v
    // Uniform Catmull-Rom on the value; knots are spaced by hand so a uniform
    // basis is fine here, and it is C¹ which is the property that matters.
    const t2 = t * t
    const t3 = t2 * t
    out[j]   = 0.5 * (2 * p1 + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  }
  return out
}

export function buildRoute (): Route {
  const groups = pointsBySection()
  const pts    = groups.flat()
  const curve  = createClosedCurve(pts, 48)
  const L      = curve.length

  // Boundaries: the arc length of each section's first control point. The first
  // is s = 0 by construction (control point 0 sits at parameter 0).
  const starts        = groups.map((g, i) => i === 0 ? 0 : arcLengthOfPoint(curve, g[0]))
  const spans: Span[] = SECTIONS.map((section, i) => ({
    section,
    s0: starts[i],
    s1: i + 1 < SECTIONS.length ? starts[i + 1] : L,
  }))

  // Bank knots to absolute s, with auto signs resolved from the geometry —
  // curvature averaged over ±12 m so a knot near an inflection does not flip on
  // a hair.
  const knots = BANK_KNOTS.map(k => {
    const sp = spans[k.sec]
    const s  = sp.s0 + (sp.s1 - sp.s0) * k.frac
    let v    = k.deg * D
    if (k.auto && k.deg !== 0) {
      let c = 0
      for (let o = -12; o <= 12; o += 4)
        c += signedCurvature(curve, s + o)
      v = Math.abs(v) * (c >= 0 ? 1 : -1)
    }
    return { s, v }
  }).sort((a, b) => a.s - b.s)

  return { curve, spans, length: L, bankTable: tabulate(knots, L, BANK_STEP) }
}

let route: Route | null = null

/** Built once per page load and shared by the simulation and the scene. */
export function getRoute (): Route {
  if (!route)
    route = buildRoute()
  return route
}

/** The span owning arc length s. The spans tile the loop. */
export function spanAt (route: Route, s: number): Span {
  const L = route.length
  const t = (s % L + L) % L
  for (const span of route.spans)
    if (t < span.s1)
      return span
  return route.spans[route.spans.length - 1]
}

/** Bank at lap 0, radians, linear between table samples, cyclic. */
export function bankTableAt (route: Route, s: number): number {
  const tab = route.bankTable
  const N   = tab.length
  const f   = (s / BANK_STEP % N + N) % N
  const i   = Math.floor(f)
  const t   = f - i
  return tab[i] * (1 - t) + tab[(i + 1) % N] * t
}

/** The roll of the road and the car at s on lap lapF. */
export function bankAt (route: Route, s: number, lapF: number): number {
  return bankTableAt(route, s) * bankGainAt(lapF)
}

function smootherstep (e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Partition of unity over the sections at s: weight i is a smooth box that
 * rises across [s0 − W, s0 + W] and falls across [s1 − W, s1 + W]. Continuous,
 * C¹, sums to one, cyclic across the seam. Every per-section scalar is blended
 * through this and nothing else, so no boundary can ever pop.
 */
export function sectionWeights (route: Route, s: number, out: Float32Array): Float32Array {
  const L = route.length
  const t = (s % L + L) % L
  for (let i = 0; i < route.spans.length; i++) {
    const sp = route.spans[i]
    let w    = smootherstep(sp.s0 - BLEND_W, sp.s0 + BLEND_W, t) -
      smootherstep(sp.s1 - BLEND_W, sp.s1 + BLEND_W, t)
    // The seam: the first span also owns the tail of the loop, the last span
    // also owns the head of it.
    if (i === 0)
      w += smootherstep(L - BLEND_W, L + BLEND_W, t)
    if (i === route.spans.length - 1)
      w += 1 - smootherstep(-BLEND_W, BLEND_W, t)
    out[i] = Math.max(0, w)
  }
  return out
}

export interface SpeedParams {
  vTarget:  number;
  tau:      number;
  throttle: number;
  gW:       number;
  cD:       number;
}

/** Blended speed model at s on lap lapF. */
export function speedParamsAt (
  route: Route, s: number, lapF: number, w: Float32Array, out: SpeedParams,
): SpeedParams {
  sectionWeights(route, s, w)
  out.vTarget  = 0
  out.tau      = 0
  out.throttle = 0
  out.gW       = 0
  out.cD       = 0
  for (let i = 0; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i]
    out.vTarget  += w[i] * sec.vTarget
    out.tau      += w[i] * sec.tau
    out.throttle += w[i] * sec.throttle
    out.gW       += w[i] * sec.gW
    out.cD       += w[i] * sec.cD
  }
  out.vTarget *= 1 + lapF * SPEED_LAP
  out.cD      *= Math.max(0.3, 1 - lapF * DRAG_LAP)
  return out
}

export interface LookParams {
  exposure:   number;
  sky:        number;
  fog:        [ number, number, number ];
  fogDensity: number;
  roadHalf:   number;
  surface:    number;
}

/** Blended look at s. `surface` is blended too: the shader treats it as a mix weight. */
export function lookAt (route: Route, s: number, w: Float32Array, out: LookParams): LookParams {
  sectionWeights(route, s, w)
  out.exposure   = 0
  out.sky        = 0
  out.fog[0]     = 0
  out.fog[1]     = 0
  out.fog[2]     = 0
  out.fogDensity = 0
  out.roadHalf   = 0
  out.surface    = 0
  for (let i = 0; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i]
    out.exposure   += w[i] * sec.exposure
    out.sky        += w[i] * sec.sky
    out.fog[0]     += w[i] * sec.fog[0]
    out.fog[1]     += w[i] * sec.fog[1]
    out.fog[2]     += w[i] * sec.fog[2]
    out.fogDensity += w[i] * sec.fogDensity
    out.roadHalf   += w[i] * sec.roadHalf
    out.surface    += w[i] * sec.surface
  }
  return out
}

/**
 * Sun elevation by lap: golden hour, sunset, civil dusk. Slid continuously
 * with lapF, which ramps inside the cave where the sky cannot be seen moving.
 */
export function sunElevationAt (lapF: number): number {
  return (12 - 6 * Math.min(lapF, 3)) * D
}

/** Sun azimuth, fixed: ahead-left on the county road. */
export const SUN_AZIMUTH = -38 * D

export function sunDirection (lapF: number, out: [ number, number, number ]): [ number, number, number ] {
  const e = sunElevationAt(lapF)
  out[0]  = Math.cos(e) * Math.sin(SUN_AZIMUTH)
  out[1]  = Math.sin(e)
  out[2]  = Math.cos(e) * Math.cos(SUN_AZIMUTH)
  return out
}
