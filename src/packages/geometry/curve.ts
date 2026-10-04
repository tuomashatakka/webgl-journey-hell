// A closed Catmull-Rom spline with arc-length reparameterisation and parallel-
// transport frames — the spine of a looping railway journey.
//
// A train that follows a hand-authored track needs three things from its path:
// a position at any distance along the rail, a stable camera frame there, and
// the local curvature for banking. This module provides all three on a *closed*
// loop: the control-point array wraps, the frame wraps, and a rider can go
// around forever without accumulating floating-point drift or seeing a visible
// seam.
//
// ---------------------------------------------------------------------------
// Centripetal, not uniform
// ---------------------------------------------------------------------------
//
// Catmull-Rom comes in three flavours distinguished by the exponent on the
// chord-length between knots: uniform (alpha=0), chordal (alpha=1), and
// centripetal (alpha=0.5). Uniform splines are the cheapest to evaluate but
// form cusps and self-intersections whenever control points are unevenly
// spaced — which for a hand-authored track layout is guaranteed. Chordal
// splines are better but can produce loops at tight corners. Centripetal is
// the safe middle ground: it is provably cusp-free for arbitrary knot spacing,
// and it is the one used by virtually every offline CAD tool for the same
// reason. The extra sqrt per knot is negligible next to the arc-length table
// we build afterwards.
//
// ---------------------------------------------------------------------------
// Arc-length LUT and reparameterisation
// ---------------------------------------------------------------------------
//
// Catmull-Rom parameterises by chord fraction, not by distance along the
// curve, so evaluating at uniform t gives non-uniform spacing — the train
// would speed up and slow down on every segment. To fix this we densely
// sample the spline (default 64 sub-steps per control-point segment), build a
// table of cumulative arc lengths, and binary-search it at query time. The
// search returns a LUT index and a fractional remainder; linear interpolation
// between the two neighbouring entries is accurate to well below 1 mm for the
// default sampling density.
//
// ---------------------------------------------------------------------------
// Parallel-transport frames, and why Frenet fails
// ---------------------------------------------------------------------------
//
// A Frenet frame (tangent, normal, binormal) is the textbook choice, but its
// "normal" is the direction the curve is turning — it flips 180 degrees at
// every inflection point and is undefined on straight sections. For a camera
// mounted on a roller-coaster car this means the picture rolls upside down in
// the middle of a straight, which is not what any rider experiences.
//
// Parallel transport avoids this entirely. Starting from a chosen "up" vector,
// at each step we rotate the previous up by the *minimal* rotation that takes
// the previous tangent to the current tangent (Rodrigues' formula about the
// cross product of the two tangents). Because the rotation is always the
// smallest possible, the up vector never flips, never becomes undefined, and
// varies smoothly even when the curvature passes through zero.
//
// ---------------------------------------------------------------------------
// Closing the loop: holonomy correction
// ---------------------------------------------------------------------------
//
// A parallel-transported frame that walks all the way around a closed curve
// does not generally return to its starting orientation. The residual twist is
// the *holonomy* of the loop — it equals the integral of the geodesic
// curvature of the curve on the sphere of directions, and for a spatial curve
// it can be anything. If you ignore it, the camera visibly snaps by that
// angle every lap.
//
// The fix is to measure the twist after the first full walk, then counter-
// rotate every frame by an amount linearly interpolated from zero (at s=0) to
// the full correction angle (at s=length). The rotation axis at each frame is
// that frame's own tangent, so the correction is frame-relative and preserves
// orthonormality exactly. Because the angle is distributed linearly over arc
// length, neighbouring frames are rotated by nearly the same amount and
// relative orientations are barely disturbed — the maximum angular error from
// linear distribution is O(h²) where h is the LUT spacing, far below visual
// threshold.
//
// ---------------------------------------------------------------------------
// Zero-allocation accessors
// ---------------------------------------------------------------------------
//
// Every position, tangent and frame accessor accepts an optional `out` object.
// When provided, the result is written into `out` and returned, avoiding a
// heap allocation. These functions are called every frame (once for the
// camera, potentially once per visible rail segment), so allocation-free
// access keeps the GC quiet on long sessions.

// Central-difference tangent at any global parameter, computed by evaluating
// the spline at two nearby parameters and differencing. This avoids the
// parameter-mapping problem that arises when the centripetal knot spacing
// makes the global-to-local mapping non-linear.

const TAN_EPS = 1e-5

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Frame {

  /** Position on the curve. */
  pos: Vec3;

  /** Unit tangent (direction of travel). */
  forward: Vec3;

  /** Unit up, parallel-transported (does NOT flip at inflections). */
  up: Vec3;

  /** forward x up, completing a right-handed basis. */
  right: Vec3;
}

export interface ClosedCurve {

  /** Total arc length of the closed loop, in metres. */
  readonly length: number;

  /** Position at normalised parameter t in [0,1), wrapping. NOT arc-length uniform. */
  sample(t: number, out?: Vec3): Vec3;

  /** Unit tangent at normalised t. */
  tangent(t: number, out?: Vec3): Vec3;

  /** Position at arc length s metres, wrapping at `length`. Arc-length uniform. */
  pointAtDistance(s: number, out?: Vec3): Vec3;

  /** Full parallel-transported frame at arc length s metres, wrapping. */
  frameAtDistance(s: number, out?: Frame): Frame;

  /** Signed curvature magnitude (1/radius) at arc length s — for banking. */
  curvatureAtDistance(s: number): number;
}

// ---- arc-length LUT -----------------------------------------------------

interface LutEntry {
  cumLen: number;
  t:      number;
  seg:    number;
}

// ---- parallel-transport frames ------------------------------------------

interface PtFrame {
  pos:     Vec3;
  forward: Vec3;
  up:      Vec3;
  right:   Vec3;
}

/** The world frame: at the origin, looking down +z with +y up. */
export function newFrame (): Frame {
  return {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }
}

/** A deep copy of `f`. */
export function cloneFrame (f: Frame): Frame {
  return { pos: { ...f.pos }, forward: { ...f.forward }, up: { ...f.up }, right: { ...f.right }}
}

// ---- inline vector helpers (tiny, self-contained — no imports) -----------

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

const v3Copy = (a: Vec3): Vec3 => v3(a.x, a.y, a.z)

const v3Sub = (a: Vec3, b: Vec3, out: Vec3): Vec3 => {
  out.x = a.x - b.x
  out.y = a.y - b.y
  out.z = a.z - b.z
  return out
}

const v3Scale = (a: Vec3, s: number, out: Vec3): Vec3 => {
  out.x = a.x * s
  out.y = a.y * s
  out.z = a.z * s
  return out
}

const v3Dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z

const v3Cross = (a: Vec3, b: Vec3, out: Vec3): Vec3 => {
  out.x = a.y * b.z - a.z * b.y
  out.y = a.z * b.x - a.x * b.z
  out.z = a.x * b.y - a.y * b.x
  return out
}

const v3Len = (a: Vec3): number =>
  Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)

const v3Norm = (a: Vec3, out: Vec3): Vec3 => {
  const len = v3Len(a)
  if (len > 1e-10) {
    out.x = a.x / len
    out.y = a.y / len
    out.z = a.z / len
  }
  else {
    out.x = 0
    out.y = 1
    out.z = 0
  }
  return out
}

// ---- centripetal Catmull-Rom helpers -------------------------------------

/**
 * Knot spacing for centripetal Catmull-Rom: |p1 - p0| raised to alpha = 0.5.
 *
 * Note what this is NOT. It is not a scale factor you can multiply a local
 * [0,1] parameter by and feed to the uniform basis — do that and the basis is
 * evaluated far outside the interval it interpolates, so the curve stops
 * passing through its own control points and tears at every segment boundary.
 * A non-uniform spline needs the non-uniform basis, which is what
 * `catmullRomKnots` and `catmullRomAt` below implement.
 */
function knotDelta (a: Vec3, b: Vec3): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  // Guard coincident control points: a zero knot interval divides by zero in
  // the Barry-Goldman recurrence below.
  return Math.max(1e-4, Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)))
}

/**
 * Barry-Goldman evaluation of a non-uniform Catmull-Rom segment: three rounds
 * of linear interpolation over the four control points, weighted by the knot
 * intervals. Reduces exactly to the familiar uniform basis when all four knots
 * are evenly spaced, and — unlike the uniform basis fed a rescaled parameter —
 * is guaranteed to pass through p1 at u = 0 and p2 at u = 1 whatever the
 * spacing. That guarantee is the whole reason for doing it the long way: it is
 * what makes the curve C0 across a segment join, and a track with a
 * discontinuity in it is a track the train falls out of.
 *
 * `u` is the local parameter in [0,1] across the p1..p2 segment.
 */
function catmullRomAt (
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number, out: Vec3,
): Vec3 {
  const d1 = knotDelta(p0, p1)
  const d2 = knotDelta(p1, p2)
  const d3 = knotDelta(p2, p3)

  const t0 = 0
  const t1 = d1
  const t2 = t1 + d2
  const t3 = t2 + d3
  const t  = t1 + u * d2

  // A1..A3: interpolate each adjacent pair over its own knot interval.
  const a1w = (t1 - t) / (t1 - t0)
  const a2w = (t2 - t) / (t2 - t1)
  const a3w = (t3 - t) / (t3 - t2)

  const a1x = a1w * p0.x + (1 - a1w) * p1.x
  const a1y = a1w * p0.y + (1 - a1w) * p1.y
  const a1z = a1w * p0.z + (1 - a1w) * p1.z

  const a2x = a2w * p1.x + (1 - a2w) * p2.x
  const a2y = a2w * p1.y + (1 - a2w) * p2.y
  const a2z = a2w * p1.z + (1 - a2w) * p2.z

  const a3x = a3w * p2.x + (1 - a3w) * p3.x
  const a3y = a3w * p2.y + (1 - a3w) * p3.y
  const a3z = a3w * p2.z + (1 - a3w) * p3.z

  // B1, B2: interpolate the As over the wider spans.
  const b1w = (t2 - t) / (t2 - t0)
  const b2w = (t3 - t) / (t3 - t1)

  const b1x = b1w * a1x + (1 - b1w) * a2x
  const b1y = b1w * a1y + (1 - b1w) * a2y
  const b1z = b1w * a1z + (1 - b1w) * a2z

  const b2x = b2w * a2x + (1 - b2w) * a3x
  const b2y = b2w * a2y + (1 - b2w) * a3y
  const b2z = b2w * a2z + (1 - b2w) * a3z

  // C: the point itself.
  const cw = (t2 - t) / (t2 - t1)
  out.x    = cw * b1x + (1 - cw) * b2x
  out.y    = cw * b1y + (1 - cw) * b2y
  out.z    = cw * b1z + (1 - cw) * b2z
  return out
}

function buildLut (points: Vec3[], samplesPerSeg: number): LutEntry[] {
  const N               = points.length
  const lut: LutEntry[] = [{ cumLen: 0, t: 0, seg: 0 }]
  let cum  = 0
  const tmp = v3()

  for (let i = 0; i < N; i++) {
    const p0 = points[(i - 1 + N) % N]
    const p1 = points[i]
    const p2 = points[(i + 1) % N]
    const p3 = points[(i + 2) % N]
    let prev = p1
    for (let j = 1; j <= samplesPerSeg; j++) {
      const lt = j / samplesPerSeg
      const pt = catmullRomAt(p0, p1, p2, p3, lt, v3())
      v3Sub(pt, prev, tmp)
      cum += v3Len(tmp)
      lut.push({ cumLen: cum, t: lt, seg: i })
      prev = pt
    }
  }

  return lut
}

// ---- binary search on the LUT -------------------------------------------

function findSeg (lut: LutEntry[], s: number): [number, number] {
  let lo = 0
  let hi = lut.length - 1
  while (lo < hi - 1) {
    const mid = lo + hi >> 1
    if (lut[mid].cumLen <= s)
      lo = mid
    else
      hi = mid
  }
  return [ lo, hi ]
}

function lerpLut (lut: LutEntry[], s: number): [number, number] {
  const total = lut[lut.length - 1].cumLen
  let wrapped = s % total
  if (wrapped < 0)
    wrapped += total

  const [ i0, i1 ] = findSeg(lut, wrapped)
  const segLen     = lut[i1].cumLen - lut[i0].cumLen
  const frac       = segLen > 0 ? (wrapped - lut[i0].cumLen) / segLen : 0
  return [ i0, frac ]
}

// ---- public curve evaluation (non-arc-length) ---------------------------

function sampleAt (pts: Vec3[], t: number, out?: Vec3): Vec3 {
  const N  = pts.length
  const tn = (t % 1 + 1) % 1
  const f  = tn * N
  const i  = Math.floor(f) % N
  const u  = f - Math.floor(f)
  return catmullRomAt(
    pts[(i - 1 + N) % N], pts[i], pts[(i + 1) % N], pts[(i + 2) % N],
    u, out ?? v3(),
  )
}

const tanA = v3()
const tanB = v3()

function tangentAt (pts: Vec3[], t: number, out?: Vec3): Vec3 {
  sampleAt(pts, t - TAN_EPS, tanA)
  sampleAt(pts, t + TAN_EPS, tanB)

  const o = out ?? v3()
  o.x     = tanB.x - tanA.x
  o.y     = tanB.y - tanA.y
  o.z     = tanB.z - tanA.z
  return v3Norm(o, o)
}

// ---- Rodrigues rotation -------------------------------------------------

function rodrigues (axis: Vec3, angle: number, v: Vec3, out: Vec3): void {
  const sinA  = Math.sin(angle)
  const cosA  = Math.cos(angle)
  const dot   = v3Dot(axis, v)
  const cross = v3()
  v3Cross(axis, v, cross)
  out.x = v.x * cosA + cross.x * sinA + axis.x * dot * (1 - cosA)
  out.y = v.y * cosA + cross.y * sinA + axis.y * dot * (1 - cosA)
  out.z = v.z * cosA + cross.z * sinA + axis.z * dot * (1 - cosA)
}

/** `up` made orthogonal to the unit vector `fwd`, in place. */
function orthogonalise (up: Vec3, fwd: Vec3, scratch: Vec3): void {
  v3Scale(fwd, v3Dot(fwd, up), scratch)
  v3Sub(up, scratch, up)
  v3Norm(up, up)
}

/**
 * An up orthogonal to the starting tangent: the first candidate axis that is
 * not parallel to it — a track heading due north would defeat a lone (0,1,0).
 */
function initialUp (tangent: Vec3): Vec3 {
  const up = [ v3(0, 1, 0), v3(1, 0, 0), v3(0, 0, 1) ].find(c => Math.abs(v3Dot(tangent, c)) < 0.9) ?? v3(0, 1, 0)
  orthogonalise(up, tangent, v3())
  return up
}

/** Rotate `up` by the minimal rotation taking `from` to `to`, in place. */
function parallelTransport (up: Vec3, from: Vec3, to: Vec3, axis: Vec3, scratch: Vec3): void {
  v3Cross(from, to, axis)

  const sinA = v3Len(axis)
  if (sinA <= 1e-10)
    return
  v3Norm(axis, axis)
  rodrigues(axis, Math.atan2(sinA, v3Dot(from, to)), up, scratch)
  up.x = scratch.x
  up.y = scratch.y
  up.z = scratch.z
}

/** The frame at `pos` facing `fwd`; `up` is re-orthonormalised against it, in place. */
function frameAt (pos: Vec3, fwd: Vec3, up: Vec3, scratch: Vec3): PtFrame {
  orthogonalise(up, fwd, scratch)

  const right = v3()
  v3Cross(fwd, up, right)
  v3Norm(right, right)

  // Re-orthonormalise up against the fresh right (guards against drift).
  v3Cross(right, fwd, up)
  v3Norm(up, up)
  return { pos: v3Copy(pos), forward: v3Copy(fwd), up: v3Copy(up), right: v3Copy(right) }
}

function buildFrames (pts: Vec3[], lut: LutEntry[]): PtFrame[] {
  const N       = pts.length
  const scratch = v3()
  const axis    = v3()
  const tan     = v3()
  const fwd0    = tangentAt(pts, 0, v3())
  const up      = initialUp(fwd0)
  const frames  = [ frameAt(pts[0], fwd0, up, scratch) ]
  let prevFwd   = v3Copy(fwd0)

  for (let i = 1; i < lut.length; i++) {
    const { seg, t } = lut[i]
    const pos        = catmullRomAt(pts[(seg - 1 + N) % N], pts[seg], pts[(seg + 1) % N], pts[(seg + 2) % N], t, v3())

    // Tangent by central difference at the global parameter (segment + local t) / N.
    const fwd = tangentAt(pts, (seg + t) / N, tan)
    parallelTransport(up, prevFwd, fwd, axis, scratch)
    frames.push(frameAt(pos, fwd, up, scratch))
    prevFwd = v3Copy(fwd)
  }

  return frames
}

// ---- holonomy correction ------------------------------------------------

function correctHolonomy (frames: PtFrame[]): void {
  const n = frames.length
  if (n < 2)
    return

  // Reference frame: the initial parallel-transported up, right, and forward.
  const refUp  = v3Copy(frames[0].up)
  const refFwd = v3Copy(frames[0].forward)

  // Measure the residual twist as the signed angle between the last transported
  // up and the reference up, projected onto the plane perpendicular to the
  // reference forward. This is the holonomy of the loop.
  const lastUp = frames[n - 1].up
  const dotL   = v3Dot(refFwd, lastUp)
  const dotR   = v3Dot(refFwd, refUp)
  let compL = v3()
  let compR = v3()
  v3Scale(refFwd, dotL, compL)
  v3Scale(refFwd, dotR, compR)
  compL = v3Sub(lastUp, compL, v3())
  compR = v3Sub(refUp, compR, v3())

  const sinH     = v3Dot(refFwd, v3Cross(compR, compL, v3()))
  const cosH     = v3Dot(compR, compL)
  const holonomy = Math.atan2(sinH, cosH)

  // Distribute the correction linearly: frame i gets rotated about its own
  // tangent by -holonomy * i/(n-1). This is exact for constant-tangent curves
  // and O(h²) accurate otherwise — far below visual threshold at our LUT
  // density.
  const tmpUp = v3()
  const tmpRt = v3()

  for (let i = 0; i < n; i++) {
    const angle = -holonomy * i / (n - 1)
    if (Math.abs(angle) < 1e-12)
      continue
    rodrigues(frames[i].forward, angle, frames[i].up, tmpUp)
    rodrigues(frames[i].forward, angle, frames[i].right, tmpRt)
    frames[i].up.x    = tmpUp.x
    frames[i].up.y    = tmpUp.y
    frames[i].up.z    = tmpUp.z
    frames[i].right.x = tmpRt.x
    frames[i].right.y = tmpRt.y
    frames[i].right.z = tmpRt.z
  }
}

// ---- public factory -----------------------------------------------------

export function createClosedCurve (
  points: Vec3[], samplesPerSegment = 64,
): ClosedCurve {
  if (points.length < 3)
    throw new Error('ClosedCurve needs at least 3 control points')

  const lut    = buildLut(points, samplesPerSegment)
  const total  = lut[lut.length - 1].cumLen
  const frames = buildFrames(points, lut)
  correctHolonomy(frames)

  const tmpA = v3()

  // Scratch frames for curvatureAtDistance, so banking costs no allocation.
  const curvA: Frame = { pos: v3(), forward: v3(), up: v3(), right: v3() }
  const curvB: Frame = { pos: v3(), forward: v3(), up: v3(), right: v3() }

  function pointAt (s: number, out?: Vec3): Vec3 {
    const [ i0, frac ] = lerpLut(lut, s)
    const f0           = frames[i0]
    const f1           = frames[i0 + 1] ?? frames[0]
    const o            = out ?? v3()
    o.x                = f0.pos.x + (f1.pos.x - f0.pos.x) * frac
    o.y                = f0.pos.y + (f1.pos.y - f0.pos.y) * frac
    o.z                = f0.pos.z + (f1.pos.z - f0.pos.z) * frac
    return o
  }

  function frameAt (s: number, out?: Frame): Frame {
    const [ i0, frac ] = lerpLut(lut, s)
    const f0           = frames[i0]
    const f1           = frames[i0 + 1] ?? frames[0]
    const o            = out ?? { pos: v3(), forward: v3(), up: v3(), right: v3() }

    o.pos.x = f0.pos.x + (f1.pos.x - f0.pos.x) * frac
    o.pos.y = f0.pos.y + (f1.pos.y - f0.pos.y) * frac
    o.pos.z = f0.pos.z + (f1.pos.z - f0.pos.z) * frac

    o.forward.x = f0.forward.x + (f1.forward.x - f0.forward.x) * frac
    o.forward.y = f0.forward.y + (f1.forward.y - f0.forward.y) * frac
    o.forward.z = f0.forward.z + (f1.forward.z - f0.forward.z) * frac

    // Slerp-ish: lerp up then re-orthonormalise via Gram-Schmidt against
    // forward. This is visually indistinguishable from true slerp for the
    // small angles between adjacent LUT frames, and avoids the acos/asin.
    o.up.x = f0.up.x + (f1.up.x - f0.up.x) * frac
    o.up.y = f0.up.y + (f1.up.y - f0.up.y) * frac
    o.up.z = f0.up.z + (f1.up.z - f0.up.z) * frac
    v3Norm(o.forward, o.forward)
    v3Norm(o.up, o.up)

    const d = v3Dot(o.forward, o.up)
    o.up.x -= o.forward.x * d
    o.up.y -= o.forward.y * d
    o.up.z -= o.forward.z * d
    v3Norm(o.up, o.up)

    o.right.x = f0.right.x + (f1.right.x - f0.right.x) * frac
    o.right.y = f0.right.y + (f1.right.y - f0.right.y) * frac
    o.right.z = f0.right.z + (f1.right.z - f0.right.z) * frac
    v3Cross(o.forward, o.up, o.right)
    v3Norm(o.right, o.right)

    return o
  }

  return {
    get length () {
      return total
    },

    sample (t: number, out?: Vec3): Vec3 {
      return sampleAt(points, t, out)
    },

    tangent (t: number, out?: Vec3): Vec3 {
      return tangentAt(points, t, out)
    },

    pointAtDistance: pointAt,

    frameAtDistance: frameAt,

    // Curvature is |dT/ds| — a derivative with respect to ARC LENGTH, and that
    // is the whole subtlety. Differencing `tangent(t)` at t = s/total instead
    // silently substitutes the curve parameter for arc length, and the two agree
    // only where the control points happen to be evenly spaced; everywhere else
    // the answer is wrong by the local ratio between them, which on this
    // circuit is up to 30%. Banking is computed from this number, so a 30%
    // error is a visibly over-banked turn.
    //
    // So difference the arc-length-indexed frames instead, over a step of a
    // couple of LUT cells: small enough to be local, wide enough that the
    // linear interpolation between stored frames does not dominate the result.
    curvatureAtDistance (s: number): number {
      const eps = Math.max(1, total / (frames.length - 1) * 2)
      const a   = frameAt(s - eps, curvA)
      const b   = frameAt(s + eps, curvB)
      tmpA.x    = b.forward.x - a.forward.x
      tmpA.y    = b.forward.y - a.forward.y
      tmpA.z    = b.forward.z - a.forward.z
      return v3Len(tmpA) / (2 * eps)
    },
  }
}
