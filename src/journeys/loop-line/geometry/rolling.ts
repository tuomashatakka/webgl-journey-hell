// THE LOOP LINE — rolling stock for THE DEPOT: a car body's shell and the
// wheels under it, built in metres in the car's own frame (x left, y up from
// the rail's foot, z along the car).

import type { MeshBuilder } from '@wjh/geometry/meshBuilder'

/** Half a parked car's body length, metres; the cars of a set stand 18.4 m apart. */
export const CAR_HALF = 8.6

/** A car body's section, one side, from the bottom edge up to the roof's crown: tumblehome sides, a curved roof. */
const CAR_SECTION: [ number, number ][] = [
  [ 1.3, 1.05 ], [ 1.4, 1.22 ], [ 1.43, 1.5 ], [ 1.42, 2 ], [ 1.39, 2.5 ], [ 1.34, 2.9 ],
  [ 1.24, 3.18 ], [ 1.06, 3.4 ], [ 0.78, 3.56 ], [ 0.4, 3.65 ],
]

/** A capped cylinder along local x, for wheels. */
export function cylX (b: MeshBuilder, x0: number, x1: number, y: number, z: number, r: number, seg = 12): void {
  const base = b.vertexCount
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2
    const c = Math.cos(a),
      s     = Math.sin(a)
    b.vertex(x0, y + c * r, z + s * r, 0, c, s, 0, 0)
    b.vertex(x1, y + c * r, z + s * r, 0, c, s, 0, 0)
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2
    b.face(a, a + 3, a + 1)
    b.face(a, a + 2, a + 3)
  }
  for (const [ x, n ] of [[ x0, -1 ], [ x1, 1 ]]) {
    const c0             = b.vertex(x, y, z, n, 0, 0, 0, 0)
    const ring: number[] = []
    for (let i = 0; i < seg; i++) {
      const a = i / seg * Math.PI * 2
      ring.push(b.vertex(x, y + Math.cos(a) * r, z + Math.sin(a) * r, n, 0, 0, 0, 0))
    }
    for (let i = 0; i < seg; i++) {
      const p = ring[i],
        q     = ring[(i + 1) % seg]
      if (n > 0)
        b.face(c0, p, q)
      else
        b.face(c0, q, p)
    }
  }
}

/**
 * A car body: the section mirrored and swept along local z in metre-long
 * rings, so it shatters into panels rather than whole sides; smooth-shaded
 * round the cantrail, flat underneath and capped at both ends.
 */
export function carBody (b: MeshBuilder): void {
  // The loop anticlockwise in (x, y): up one side, over the roof, down the other.
  const loop: [ number, number ][] = [
    ...CAR_SECTION,
    [ 0, 3.68 ],
    ...CAR_SECTION.map(([ x, y ]): [ number, number ] => [ -x, y ]).reverse(),
  ]

  const n    = loop.length
  const norm = loop.map((_, i) => {
    const [ ax, ay ] = loop[Math.max(i - 1, 0)]
    const [ bx, by ] = loop[Math.min(i + 1, n - 1)]
    const l          = Math.hypot(bx - ax, by - ay)
    return [ (by - ay) / l, -(bx - ax) / l ]
  })
  const rings = 16
  const ring  = (k: number) => -CAR_HALF + 2 * CAR_HALF * k / rings
  for (let k = 0; k < rings; k++) {
    const z0   = ring(k),
      z1       = ring(k + 1)
    const base = b.vertexCount
    for (let i = 0; i < n; i++) {
      b.vertex(loop[i][0], loop[i][1], z0, norm[i][0], norm[i][1], 0, 0, 0)
      b.vertex(loop[i][0], loop[i][1], z1, norm[i][0], norm[i][1], 0, 0, 0)
    }
    for (let i = 0; i < n - 1; i++) {
      const p = base + i * 2
      b.face(p, p + 2, p + 3)
      b.face(p, p + 3, p + 1)
    }

    const [ lx, ly ] = loop[n - 1]
    const [ rx, ry ] = loop[0]
    b.quad([ lx, ly, z0 ], [ rx, ry, z0 ], [ rx, ry, z1 ], [ lx, ly, z1 ])
  }
  for (const [ z, side ] of [[ -CAR_HALF, -1 ], [ CAR_HALF, 1 ]]) {
    const c0 = b.vertex(0, 2.3, z, 0, 0, side, 0, 0)
    const at = loop.map(([ x, y ]) => b.vertex(x, y, z, 0, 0, side, 0, 0))
    for (let i = 0; i < n; i++) {
      const p = at[i],
        q     = at[(i + 1) % n]
      if (side > 0)
        b.face(c0, p, q)
      else
        b.face(c0, q, p)
    }
  }
}
