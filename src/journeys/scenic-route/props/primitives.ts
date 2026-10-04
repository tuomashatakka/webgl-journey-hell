import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { hash } from './hash'

// ---------------------------------------------------------------------------
// mesh helpers
// ---------------------------------------------------------------------------

export type V3 = [ number, number, number ]

/** A quad with a flat normal from its winding, uv 0..1. */
export function quadN (b: MeshBuilder, p0: V3, p1: V3, p2: V3, p3: V3): void {
  const ux = p1[0] - p0[0]
  const uy = p1[1] - p0[1]
  const uz = p1[2] - p0[2]
  const vx = p3[0] - p0[0]
  const vy = p3[1] - p0[1]
  const vz = p3[2] - p0[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const l  = Math.hypot(nx, ny, nz) || 1
  nx      /= l
  ny      /= l
  nz      /= l

  const a = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0)
  const c = b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0)
  const d = b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1)
  const e = b.vertex(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1)
  b.face(a, c, d)
  b.face(a, d, e)
}

/** The six faces of a box given its eight corners as a mapping function. */
export function boxOf (b: MeshBuilder, P: (x: number, y: number, z: number) => V3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  quadN(b, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)) // +z
  quadN(b, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)) // -z
  quadN(b, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)) // +x
  quadN(b, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)) // -x
  quadN(b, P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)) // +y
  quadN(b, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)) // -y
}

/** A box, optionally rotated about z by `rz` around the origin, then translated. */
export function boxT (
  b: MeshBuilder, cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number, rz = 0,
): void {
  const c = Math.cos(rz)
  const s = Math.sin(rz)
  boxOf(b, (x, y, z) => [ cx + x * c - y * s, cy + x * s + y * c, cz + z ], -hx, hx, -hy, hy, -hz, hz)
}

/** A square-section bar between two points in world space. */
export function bar (b: MeshBuilder, p: V3, q: V3, half: number): void {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const l  = Math.hypot(dx, dy, dz) || 1
  const ax = dx / l
  const ay = dy / l
  const az = dz / l
  // A side vector: perpendicular to the axis, preferring the horizontal.
  const upx = Math.abs(ay) < 0.9 ? 0 : 1
  const upy = Math.abs(ay) < 0.9 ? 1 : 0
  let sx = ay * 0 - az * upy
  let sy = az * upx - ax * 0
  let sz = ax * upy - ay * upx
  const sl  = Math.hypot(sx, sy, sz) || 1
  sx       /= sl
  sy       /= sl
  sz       /= sl

  const tx = ay * sz - az * sy
  const ty = az * sx - ax * sz
  const tz = ax * sy - ay * sx
  const at = (o: V3, s: number, t: number): V3 =>
    [ o[0] + (sx * s + tx * t) * half, o[1] + (sy * s + ty * t) * half, o[2] + (sz * s + tz * t) * half ]
  const c = [[ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ]]
  for (let i = 0; i < 4; i++) {
    const [ s0, t0 ] = c[i]
    const [ s1, t1 ] = c[(i + 1) % 4]
    quadN(b, at(p, s0, t0), at(p, s1, t1), at(q, s1, t1), at(q, s0, t0))
  }
}

/** A smooth cylinder along the x axis with disc caps. */
export function cylinderX (
  b: MeshBuilder, cx: number, cy: number, cz: number, r: number, half: number, segs: number,
): void {
  const ring0: number[] = []
  const ring1: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a  = i / segs * Math.PI * 2
    const ny = Math.cos(a)
    const nz = Math.sin(a)
    ring0.push(b.vertex(cx - half, cy + ny * r, cz + nz * r, 0, ny, nz, 0, i / segs))
    ring1.push(b.vertex(cx + half, cy + ny * r, cz + nz * r, 0, ny, nz, 1, i / segs))
  }
  for (let i = 0; i < segs; i++) {
    b.face(ring0[i], ring1[i], ring1[i + 1])
    b.face(ring0[i], ring1[i + 1], ring0[i + 1])
  }

  const c0 = b.vertex(cx - half, cy, cz, -1, 0, 0, 0.5, 0.5)
  const c1 = b.vertex(cx + half, cy, cz, 1, 0, 0, 0.5, 0.5)
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2
    const a1 = (i + 1) / segs * Math.PI * 2
    const p0 = b.vertex(cx - half, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r, -1, 0, 0, 0, 0)
    const p1 = b.vertex(cx - half, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r, -1, 0, 0, 1, 0)
    b.face(c0, p1, p0)

    const q0 = b.vertex(cx + half, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r, 1, 0, 0, 0, 0)
    const q1 = b.vertex(cx + half, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r, 1, 0, 0, 1, 0)
    b.face(c1, q0, q1)
  }
}

/** A tapered tube up the y axis from y=0 to y=h. */
export function taperY (b: MeshBuilder, r0: number, r1: number, h: number, segs: number): void {
  const slope           = (r0 - r1) / h
  const lower: number[] = []
  const upper: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a  = i / segs * Math.PI * 2
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    const l  = Math.hypot(1, slope)
    lower.push(b.vertex(nx * r0, 0, nz * r0, nx / l, slope / l, nz / l, i / segs, 0))
    upper.push(b.vertex(nx * r1, h, nz * r1, nx / l, slope / l, nz / l, i / segs, 1))
  }
  for (let i = 0; i < segs; i++) {
    b.face(lower[i], upper[i + 1], upper[i])
    b.face(lower[i], lower[i + 1], upper[i + 1])
  }
}

/**
 * A jittered ellipsoid: a lobe of a tree's crown. Spherical uv (u round, v
 * up) so the leaf mask can tear holes in it; the radius wobbles per vertex
 * so no two silhouettes are the same ball.
 */
export function lobe (
  b: MeshBuilder, cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number, seed: number,
): void {
  const SEG             = 12
  const RING            = 8
  const ids: number[][] = []
  for (let j = 0; j <= RING; j++) {
    const v  = j / RING
    const th = v * Math.PI
    ids.push([])
    for (let i = 0; i <= SEG; i++) {
      const u   = i / SEG
      const ph  = u * Math.PI * 2
      const nx  = Math.sin(th) * Math.cos(ph)
      const ny  = -Math.cos(th)
      const nz  = Math.sin(th) * Math.sin(ph)
      const i0  = i === SEG ? 0 : i
      const jit = 0.84 + 0.3 * hash(seed + j * 37 + i0 * 101)
      let mx = nx / rx
      let my = ny / ry
      let mz = nz / rz
      const l   = Math.hypot(mx, my, mz) || 1
      mx       /= l
      my       /= l
      mz       /= l
      ids[j].push(b.vertex(cx + nx * rx * jit, cy + ny * ry * jit, cz + nz * rz * jit, mx, my, mz, u, v))
    }
  }
  for (let j = 0; j < RING; j++)
    for (let i = 0; i < SEG; i++) {
      b.face(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i])
      b.face(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1])
    }
}
