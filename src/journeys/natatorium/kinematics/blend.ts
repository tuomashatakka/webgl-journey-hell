import { mix, smootherstep } from '@wjh/math/scalar'
import { Section, localFloor, sectionAt } from './route'

// ---- cornering ------------------------------------------------------------
//
// Re-anchoring alone gives a *discontinuous* walk. The camera advances along the
// current section's +Z, so at a boundary the direction of travel snaps by the
// whole turn angle in a single frame — orientation stays continuous but velocity
// does not, and it reads as a teleport.
//
// The fix is to blend the camera pose between the two frames' predictions across
// a window straddling each boundary. Both sections can predict a pose for any
// distance (their floors and axes extrapolate past their own ends), so near a
// join we take a weighted mix of the two, expressed in whichever frame is
// current. At the boundary itself both sides evaluate to a 50/50 mix of the
// same two world points, so the path — and its tangent — are continuous through
// the corner. The camera then follows an arc instead of a dogleg.

export type Vec3 = [ number, number, number ]

function rotY (x: number, z: number, c: number, s: number): [ number, number ] {
  return [ c * x - s * z, s * x + c * z ]
}

function lerp3 (a: Vec3, b: Vec3, t: number): Vec3 {
  return [ mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t) ]
}

/**
 * Half-width of the corner blend, in world units. Symmetric in its arguments so
 * both sides of a join agree on the window — that agreement is what makes the
 * two one-sided formulas meet exactly at the boundary.
 */
function cornerHalf (a: Section, b: Section): number {
  return Math.min(6, Math.min(a.len, b.len) * 0.3)
}

/** A point in the NEXT section's frame, expressed in the current one. */
function nextToCur (q: Vec3, cur: Section, next: Section): Vec3 {
  const c          = Math.cos(next.turn)
  const s          = Math.sin(next.turn)
  const [ rx, rz ] = rotY(q[0], q[2], c, s)
  return [ rx, q[1] - cur.drop, rz + cur.len ]
}

/** A point in the PREVIOUS section's frame, expressed in the current one. */
function prevToCur (q: Vec3, cur: Section, prev: Section): Vec3 {
  const c          = Math.cos(-cur.turn)
  const s          = Math.sin(-cur.turn)
  const [ rx, rz ] = rotY(q[0], q[2] - prev.len, c, s)
  return [ rx, q[1] + prev.drop, rz ]
}

/**
 * Corner blend weight at a local z: 0.5 exactly on a boundary, 0 or 1 outside
 * the window. Returns which neighbour is being mixed with, so scalars can ride
 * the same curve as the position and stay continuous with it.
 *
 *   side = +1  mixing forward into `next`, weight is the next section's share
 *   side = -1  mixing backward into `prev`, weight is the *current* share
 *   side =  0  clear of any corner
 */
type CornerBlendReturnType = { side: number; w: number }

function cornerBlend (idx: number, localZ: number): CornerBlendReturnType {
  const cur   = sectionAt(idx)
  const hwEnd = cornerHalf(cur, sectionAt(idx + 1))
  if (localZ > cur.len - hwEnd)
    return { side: 1, w: smootherstep(cur.len - hwEnd, cur.len + hwEnd, localZ) }

  const hwBeg = cornerHalf(sectionAt(idx - 1), cur)
  if (localZ < hwBeg)
    return { side: -1, w: smootherstep(-hwBeg, hwBeg, localZ) }

  return { side: 0, w: 1 }
}

/**
 * Lateral sway amplitude. Scales with the room, which means it is a *per
 * section* quantity and therefore has to go through the corner blend like
 * everything else — a 1.4m corridor opening into a 16m hall would otherwise
 * snap the camera sideways by nearly half a unit at the join.
 */
function swayFor (s: Section, dist: number): number {
  return Math.sin(dist * 0.09) * Math.min(0.5, s.halfW * 0.06)
}

/**
 * Camera position in section `idx`'s frame at a given local z, blended through
 * whichever corner is near. `localZ` may sit outside [0, len] — that is exactly
 * how the look-ahead sample reaches into the next section.
 */
export function poseInFrame (idx: number, localZ: number, dist: number): Vec3 {
  const cur  = sectionAt(idx)
  const next = sectionAt(idx + 1)
  const prev = sectionAt(idx - 1)

  const own: Vec3 = [ swayFor(cur, dist), localFloor(cur, localZ), localZ ]
  const b         = cornerBlend(idx, localZ)

  if (b.side > 0) {
    const zn       = localZ - cur.len
    const qn: Vec3 = [ swayFor(next, dist), localFloor(next, zn), zn ]
    return lerp3(own, nextToCur(qn, cur, next), b.w)
  }

  if (b.side < 0) {
    const zp       = prev.len + localZ
    const qp: Vec3 = [ swayFor(prev, dist), localFloor(prev, zp), zp ]
    return lerp3(prevToCur(qp, cur, prev), own, b.w)
  }

  return own
}

/** A per-section scalar carried across corners on the same curve as the path. */
export function blendScalar (idx: number, localZ: number, pick: (s: Section) => number): number {
  const b = cornerBlend(idx, localZ)
  if (b.side > 0)
    return mix(pick(sectionAt(idx)), pick(sectionAt(idx + 1)), b.w)
  if (b.side < 0)
    return mix(pick(sectionAt(idx - 1)), pick(sectionAt(idx)), b.w)
  return pick(sectionAt(idx))
}
