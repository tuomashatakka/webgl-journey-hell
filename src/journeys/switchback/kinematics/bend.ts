import { mix } from '@wjh/math/scalar'
import { gradeAt, yawAt } from './route'
import { FIT_Z2 } from './common'

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
export const REACH_S   = 88

export const FIT_STEPS = 44

/**
 * The two camera-space depths the quadratic is pinned to. Two points determine
 * the two free coefficients exactly, and pinning beats least-squares here: the
 * near sample keeps the rail under the cart honest (an error there is a rail
 * that visibly misses the wheels) and the far one puts the error where the fog
 * is. Z2 sits just inside the fog rather than at the edge of the march.
 */
export const FIT_Z1 = 20

export interface Bend {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

/** Solve q(z) = a*z + b*z^2 through (z1,v1) and (z2,v2). */
export function fitQuadratic (z1: number, v1: number, z2: number, v2: number): [ number, number ] {
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
export function fitBend (s0: number, yaw0: number, grade0: number): Bend {
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
