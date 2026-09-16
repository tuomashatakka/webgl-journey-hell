// THE SCENIC ROUTE — the cockpit.
//
// Everything the rider sees of the car, built in the car's own frame: x to the
// right, y up, z forward, origin on the road under the driver. The camera lives
// in this frame too (lib: kinematics puts it at CAM_H over the spine with its
// sway and heave), so the cabin is fixed and the head moves inside it, which is
// what a cabin looks like from a seat.
//
// The dash is one moulded surface swept across the car; consoles are
// chamfered boxes, vents are louvred, the wheel has a padded hub. Parts are
// tagged in uv.x so one fragment shader can dress them: 0 soft black
// plastic, 1 leather, 2 the dial face (textured), 3 chrome, 4 paint, 5 mirror
// glass, 6 needles, 7 warning lamps (uv.y picks which), 8 glass tint.
//
// The dial faces are drawn once on a Canvas2D and uploaded; the needles are
// meshes rotated by uniform, so the only per-frame work is two angles.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'


export const TAG = {
  PLASTIC: 0,
  LEATHER: 1,
  DIAL:    2,
  CHROME:  3,
  PAINT:   4,
  MIRROR:  5,
  NEEDLE:  6,
  LAMP:    7,
  GLASS:   8,
} as const

/** The dial binnacle: where it is, how it faces, how big. */
export const DIAL = {
  cx:   0,
  cy:   0.95,
  cz:   0.9,
  w:    0.46,
  h:    0.2,
  tilt: 14 * Math.PI / 180, // face leaning back toward the driver
}

/** Needle pivots in dial-face uv (0..1), then in car space via `dialPoint`. */
export const SPEEDO = { u: 0.27, v: 0.5, r: 0.075, min: 0, max: 240, sweep: 250 }
export const TACHO  = { u: 0.73, v: 0.5, r: 0.075, min: 0, max: 8000, sweep: 250 }

export interface V3 { x: number; y: number; z: number }

/** Car-space point on the dial face for a face uv. */
export function dialPoint (u: number, v: number, out = 0): V3 {
  const x  = DIAL.cx + (u - 0.5) * DIAL.w
  const dy = (v - 0.5) * DIAL.h
  const c  = Math.cos(DIAL.tilt)
  const s  = Math.sin(DIAL.tilt)
  return {
    x,
    y: DIAL.cy + dy * c - out * s,
    z: DIAL.cz + dy * s + out * c,
  }
}

/** The dial face's normal, toward the driver. */
export function dialNormal (): V3 {
  return { x: 0, y: Math.sin(DIAL.tilt), z: -Math.cos(DIAL.tilt) }
}

type P = [ number, number, number ]

function quad (b: MeshBuilder, p0: P, p1: P, p2: P, p3: P, tag: number, v0 = 0, v1 = 1): void {
  const ux = p1[0] - p0[0]
  const uy = p1[1] - p0[1]
  const uz = p1[2] - p0[2]
  const vx = p3[0] - p0[0]
  const vy = p3[1] - p0[1]
  const vz = p3[2] - p0[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l
  ny /= l
  nz /= l

  const a = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, tag, v0)
  const c = b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, tag, v0)
  const d = b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, tag, v1)
  const e = b.vertex(p3[0], p3[1], p3[2], nx, ny, nz, tag, v1)
  b.face(a, c, d)
  b.face(a, d, e)
}

/** An axis-aligned box tagged as one material. */
function box (b: MeshBuilder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, tag: number): void {
  const x0 = cx - hx
  const x1 = cx + hx
  const y0 = cy - hy
  const y1 = cy + hy
  const z0 = cz - hz
  const z1 = cz + hz
  quad(b, [ x0, y0, z1 ], [ x1, y0, z1 ], [ x1, y1, z1 ], [ x0, y1, z1 ], tag)
  quad(b, [ x1, y0, z0 ], [ x0, y0, z0 ], [ x0, y1, z0 ], [ x1, y1, z0 ], tag)
  quad(b, [ x1, y0, z1 ], [ x1, y0, z0 ], [ x1, y1, z0 ], [ x1, y1, z1 ], tag)
  quad(b, [ x0, y0, z0 ], [ x0, y0, z1 ], [ x0, y1, z1 ], [ x0, y1, z0 ], tag)
  quad(b, [ x0, y1, z1 ], [ x1, y1, z1 ], [ x1, y1, z0 ], [ x0, y1, z0 ], tag)
  quad(b, [ x0, y0, z0 ], [ x1, y0, z0 ], [ x1, y0, z1 ], [ x0, y0, z1 ], tag)
}

/** A slanted bar between two points with a square section. */
function bar (b: MeshBuilder, p: P, q: P, half: number, tag: number): void {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const l  = Math.hypot(dx, dy, dz) || 1
  const ax = dx / l
  const ay = dy / l
  const az = dz / l
  // Perpendiculars.
  const rx = Math.abs(ay) < 0.9 ? 1 : 0
  const ry = Math.abs(ay) < 0.9 ? 0 : 1
  let sx = ay * 0 - az * ry
  let sy = az * rx - ax * 0
  let sz = ax * ry - ay * rx
  const sl = Math.hypot(sx, sy, sz) || 1
  sx /= sl
  sy /= sl
  sz /= sl

  const tx     = ay * sz - az * sy
  const ty     = az * sx - ax * sz
  const tz     = ax * sy - ay * sx
  const corner = (o: P, s: number, t: number): P =>
    [ o[0] + (sx * s + tx * t) * half, o[1] + (sy * s + ty * t) * half, o[2] + (sz * s + tz * t) * half ]
  const c = [[ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ]]
  for (let i = 0; i < 4; i++) {
    const [ s0, t0 ] = c[i]
    const [ s1, t1 ] = c[(i + 1) % 4]
    quad(b, corner(p, s0, t0), corner(p, s1, t1), corner(q, s1, t1), corner(q, s0, t0), tag)
  }
}

/** A torus about the z axis at (cx, cy, cz), then tilted back by `tilt` about x. */
function torus (
  b: MeshBuilder, cx: number, cy: number, cz: number, R: number, r: number,
  tilt: number, segs: number, sides: number, tag: number,
): void {
  const ct    = Math.cos(tilt)
  const st    = Math.sin(tilt)
  const place = (x: number, y: number, z: number): P =>
    [ cx + x, cy + y * ct - z * st, cz + y * st + z * ct ]
  const ids: number[][] = []
  for (let i = 0; i <= segs; i++) {
    const a  = i / segs * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    ids.push([])
    for (let j = 0; j <= sides; j++) {
      const t  = j / sides * Math.PI * 2
      const nx = ca * Math.cos(t)
      const ny = sa * Math.cos(t)
      const nz = Math.sin(t)
      const p  = place(ca * R + nx * r, sa * R + ny * r, nz * r)
      const n  = place(nx, ny, nz)
      ids[i].push(b.vertex(p[0], p[1], p[2], n[0] - cx, n[1] - cy, n[2] - cz, tag, j / sides))
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < sides; j++) {
      b.face(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1])
      b.face(ids[i][j], ids[i + 1][j + 1], ids[i][j + 1])
    }
}

/**
 * A surface swept across x from a (z, y) profile, `segs` strips wide, bowed by
 * `wrap(u)` (u in -1..1 across the width) so a dashboard can curve toward the
 * doors instead of being a plank.
 */
function strip (
  b: MeshBuilder, prof: [ number, number ][], x0: number, x1: number, segs: number, tag: number,
  wrap: (u: number) => [ number, number ] = () => [ 0, 0 ],
): void {
  const at = (i: number, j: number): P => {
    const u          = i / segs
    const x          = x0 + (x1 - x0) * u
    const [ dy, dz ] = wrap(u * 2 - 1)
    return [ x, prof[j][1] + dy, prof[j][0] + dz ]
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < prof.length - 1; j++)
      quad(b, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), tag)
}

/** A box whose top edges are chamfered by `c`: the moulded look of a console. */
function bevelBox (
  b: MeshBuilder, cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number, c: number, tag: number,
): void {
  const x0 = cx - hx
  const x1 = cx + hx
  const y0 = cy - hy
  const y1 = cy + hy
  const z0 = cz - hz
  const z1 = cz + hz
  const yb = y1 - c
  quad(b, [ x0, y0, z1 ], [ x1, y0, z1 ], [ x1, yb, z1 ], [ x0, yb, z1 ], tag)
  quad(b, [ x1, y0, z0 ], [ x0, y0, z0 ], [ x0, yb, z0 ], [ x1, yb, z0 ], tag)
  quad(b, [ x1, y0, z1 ], [ x1, y0, z0 ], [ x1, yb, z0 ], [ x1, yb, z1 ], tag)
  quad(b, [ x0, y0, z0 ], [ x0, y0, z1 ], [ x0, yb, z1 ], [ x0, yb, z0 ], tag)
  quad(b, [ x0, y0, z0 ], [ x1, y0, z0 ], [ x1, y0, z1 ], [ x0, y0, z1 ], tag)
  // Bevels, then the shrunk top.
  quad(b, [ x0, yb, z1 ], [ x1, yb, z1 ], [ x1 - c, y1, z1 - c ], [ x0 + c, y1, z1 - c ], tag)
  quad(b, [ x1, yb, z0 ], [ x0, yb, z0 ], [ x0 + c, y1, z0 + c ], [ x1 - c, y1, z0 + c ], tag)
  quad(b, [ x1, yb, z1 ], [ x1, yb, z0 ], [ x1 - c, y1, z0 + c ], [ x1 - c, y1, z1 - c ], tag)
  quad(b, [ x0, yb, z0 ], [ x0, yb, z1 ], [ x0 + c, y1, z1 - c ], [ x0 + c, y1, z0 + c ], tag)
  quad(b, [ x0 + c, y1, z1 - c ], [ x1 - c, y1, z1 - c ], [ x1 - c, y1, z0 + c ], [ x0 + c, y1, z0 + c ], tag)
}

/** A short cylinder along z (knobs, dials, the emblem) with an end cap. */
function knob (b: MeshBuilder, cx: number, cy: number, cz: number, r: number, len: number, segs: number, tag: number): void {
  const ring: P[] = []
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2
    ring.push([ Math.cos(a) * r, Math.sin(a) * r, 0 ])
  }
  for (let i = 0; i < segs; i++) {
    const a = ring[i]
    const c = ring[i + 1]
    quad(b, [ cx + a[0], cy + a[1], cz ], [ cx + c[0], cy + c[1], cz ], [ cx + c[0], cy + c[1], cz - len ], [ cx + a[0], cy + a[1], cz - len ], tag)
    quad(b, [ cx, cy, cz - len ], [ cx + c[0], cy + c[1], cz - len ], [ cx + a[0], cy + a[1], cz - len ], [ cx, cy, cz - len ], tag)
  }
}

/** A louvred air vent: a recessed frame with slats. */
function vent (b: MeshBuilder, cx: number, cy: number, cz: number, hw: number, hh: number): void {
  box(b, cx, cy, cz + 0.01, hw + 0.012, hh + 0.012, 0.012, TAG.PLASTIC)
  quad(b, [ cx - hw, cy - hh, cz - 0.03 ], [ cx + hw, cy - hh, cz - 0.03 ], [ cx + hw, cy + hh, cz - 0.03 ], [ cx - hw, cy + hh, cz - 0.03 ], TAG.PLASTIC)

  const n = 4
  for (let i = 0; i < n; i++) {
    const y = cy - hh + (i + 0.5) / n * 2 * hh
    box(b, cx, y, cz - 0.012, hw - 0.004, 0.003, 0.012, TAG.CHROME)
  }
  box(b, cx, cy, cz - 0.008, 0.004, hh - 0.004, 0.012, TAG.PLASTIC)
}

export interface Cockpit {
  cabin:       MeshBuilder;
  wheel:       MeshBuilder;
  speedo:      MeshBuilder;
  tacho:       MeshBuilder;
  wheelCentre: V3;
  wheelAxis:   V3;
}

const WHEEL = { x: 0, y: 0.93, z: 0.66, R: 0.17, tilt: 30 * Math.PI / 180 }

/** The dashboard's (z, y) profile, windscreen base to the knee roll. */
const DASH: [ number, number ][] = [
  [ 1.30, 0.855 ], [ 1.12, 0.905 ], [ 0.98, 0.945 ], [ 0.86, 0.962 ], [ 0.76, 0.955 ],
  [ 0.70, 0.93 ], [ 0.655, 0.885 ], [ 0.635, 0.82 ], [ 0.63, 0.74 ], [ 0.645, 0.66 ],
  [ 0.68, 0.59 ], [ 0.72, 0.53 ],
]

export function buildCockpit (): Cockpit {
  const cabin = createMeshBuilder()
  const wrap  = (u: number): [ number, number ] => [ 0.028 * u * u, 0.05 * u * u ]

  // The dash: one moulded surface across the car, bowed toward the doors, a
  // chrome strip along the crease and a leather knee roll under it.
  strip(cabin, DASH, -0.98, 0.98, 16, TAG.PLASTIC, wrap)
  strip(cabin, [[ 0.655, 0.887 ], [ 0.652, 0.878 ]], -0.98, 0.98, 16, TAG.CHROME, wrap)
  strip(cabin, [[ 0.635, 0.82 ], [ 0.63, 0.74 ], [ 0.645, 0.66 ]], -0.98, 0.98, 16, TAG.LEATHER,
        u => [ wrap(u)[0], wrap(u)[1] - 0.004 ])

  // The binnacle: face, moulded body behind it, and a hood curving over it.
  const f00 = dialPoint(0, 0)
  const f10 = dialPoint(1, 0)
  const f11 = dialPoint(1, 1)
  const f01 = dialPoint(0, 1)
  quad(cabin, [ f00.x, f00.y, f00.z ], [ f10.x, f10.y, f10.z ], [ f11.x, f11.y, f11.z ], [ f01.x, f01.y, f01.z ], TAG.DIAL)

  const back = (u: number, v: number, out = 0.1): P => {
    const p = dialPoint(u, v, out)
    return [ p.x, p.y, p.z ]
  }
  // A bezel ring around the face, then the body.
  for (const [ u0, v0, u1, v1 ] of [[ -0.03, -0.12, 1.03, -0.02 ], [ -0.03, 1.02, 1.03, 1.12 ], [ -0.03, -0.12, 0.0, 1.12 ], [ 1.0, -0.12, 1.03, 1.12 ]]) {
    const a = dialPoint(u0, v0, -0.008)
    const c = dialPoint(u1, v0, -0.008)
    const d = dialPoint(u1, v1, -0.008)
    const e = dialPoint(u0, v1, -0.008)
    quad(cabin, [ a.x, a.y, a.z ], [ c.x, c.y, c.z ], [ d.x, d.y, d.z ], [ e.x, e.y, e.z ], TAG.PLASTIC)
  }
  quad(cabin, back(-0.03, -0.12, -0.008), back(1.03, -0.12, -0.008), back(1.03, -0.12), back(-0.03, -0.12), TAG.PLASTIC)
  quad(cabin, back(-0.03, -0.12, -0.008), back(-0.03, 1.12, -0.008), back(-0.03, 1.12), back(-0.03, -0.12), TAG.PLASTIC)
  quad(cabin, back(1.03, 1.12, -0.008), back(1.03, -0.12, -0.008), back(1.03, -0.12), back(1.03, 1.12), TAG.PLASTIC)

  // The hood: an arc from the top of the bezel forward and down onto the dash.
  const hoodTop                    = dialPoint(0.5, 1.12, -0.008)
  const hood: [ number, number ][] = []
  for (let i = 0; i <= 6; i++) {
    const a = i / 6 * Math.PI * 0.5
    hood.push([ hoodTop.z - 0.02 + Math.sin(a) * 0.17, hoodTop.y + 0.055 * Math.sin(a * 2) * (1 - i / 6) + 0.02 * (1 - Math.cos(a)) ])
  }
  hood.push([ hoodTop.z + 0.17, DASH[3][1] - 0.01 ])
  strip(cabin, hood, -0.29, 0.29, 6, TAG.PLASTIC, u => [ -0.012 * u * u, 0 ])
  strip(cabin, hood.map(([ z, y ]) => [ z, y - 0.012 ] as [ number, number ]), -0.29, 0.29, 6, TAG.PLASTIC, u => [ -0.012 * u * u, 0 ])

  // Warning lamps, in a row under the dials.
  for (let i = 0; i < 4; i++) {
    const u0 = 0.36 + i * 0.075
    const a  = dialPoint(u0, 0.1, -0.003)
    const c  = dialPoint(u0 + 0.05, 0.1, -0.003)
    const d  = dialPoint(u0 + 0.05, 0.2, -0.003)
    const e  = dialPoint(u0, 0.2, -0.003)
    quad(cabin, [ a.x, a.y, a.z ], [ c.x, c.y, c.z ], [ d.x, d.y, d.z ], [ e.x, e.y, e.z ], TAG.LAMP, i, i)
  }

  // The column shroud and its stalks.
  bar(cabin, [ 0, 0.85, 0.80 ], [ 0, 0.92, 0.68 ], 0.048, TAG.PLASTIC)
  bar(cabin, [ -0.04, 0.905, 0.73 ], [ -0.16, 0.935, 0.75 ], 0.007, TAG.PLASTIC)
  bar(cabin, [ 0.04, 0.905, 0.73 ], [ 0.16, 0.925, 0.75 ], 0.007, TAG.PLASTIC)
  bevelBox(cabin, -0.165, 0.936, 0.75, 0.012, 0.008, 0.012, 0.003, TAG.PLASTIC)
  bevelBox(cabin, 0.165, 0.926, 0.75, 0.012, 0.008, 0.012, 0.003, TAG.PLASTIC)

  // Vents: two on the dash face beside the binnacle, two by the doors.
  vent(cabin, -0.40, 0.905, 0.66, 0.055, 0.026)
  vent(cabin, 0.40, 0.905, 0.66, 0.055, 0.026)
  vent(cabin, -0.86, 0.90, 0.665, 0.05, 0.026)
  vent(cabin, 0.86, 0.90, 0.665, 0.05, 0.026)

  // The centre stack: a moulded face with the radio, its knobs and a heater
  // slider row, going down into the console with the gear lever.
  bevelBox(cabin, 0, 0.78, 0.66, 0.15, 0.13, 0.035, 0.012, TAG.PLASTIC)
  quad(cabin, [ -0.12, 0.83, 0.622 ], [ 0.12, 0.83, 0.622 ], [ 0.12, 0.875, 0.622 ], [ -0.12, 0.875, 0.622 ], TAG.LAMP, 3, 3)
  box(cabin, 0, 0.8525, 0.626, 0.125, 0.027, 0.004, TAG.PLASTIC)
  knob(cabin, -0.10, 0.76, 0.622, 0.016, 0.018, 12, TAG.CHROME)
  knob(cabin, 0.10, 0.76, 0.622, 0.016, 0.018, 12, TAG.CHROME)
  for (let i = 0; i < 5; i++)
    box(cabin, -0.05 + i * 0.025, 0.76, 0.618, 0.008, 0.007, 0.008, TAG.PLASTIC)
  for (let i = 0; i < 3; i++) {
    box(cabin, -0.08 + i * 0.08, 0.705, 0.624, 0.03, 0.003, 0.004, TAG.CHROME)
    box(cabin, -0.08 + i * 0.08 + (i - 1) * 0.012, 0.705, 0.618, 0.007, 0.009, 0.008, TAG.PLASTIC)
  }
  bevelBox(cabin, 0, 0.55, 0.28, 0.15, 0.09, 0.38, 0.02, TAG.PLASTIC)
  bar(cabin, [ 0, 0.63, 0.42 ], [ 0.015, 0.83, 0.44 ], 0.009, TAG.CHROME)
  bevelBox(cabin, 0.015, 0.845, 0.44, 0.022, 0.02, 0.022, 0.008, TAG.LEATHER)
  quad(cabin, [ -0.05, 0.641, 0.36 ], [ 0.05, 0.641, 0.36 ], [ 0.05, 0.641, 0.48 ], [ -0.05, 0.641, 0.48 ], TAG.LEATHER)

  // Doors: the card, an armrest, the window sill, a chrome handle, a speaker.
  for (const sgn of [ -1, 1 ]) {
    const x = sgn * 0.98
    box(cabin, x, 0.78, 0.05, 0.03, 0.34, 0.75, TAG.PLASTIC)
    box(cabin, sgn * 0.93, 0.79, 0.02, 0.06, 0.03, 0.2, TAG.LEATHER)
    box(cabin, sgn * 0.955, 1.115, 0.0, 0.035, 0.012, 0.72, TAG.PLASTIC)
    bar(cabin, [ sgn * 0.945, 0.9, 0.24 ], [ sgn * 0.945, 0.9, 0.36 ], 0.008, TAG.CHROME)
    box(cabin, sgn * 0.947, 0.9, 0.30, 0.004, 0.012, 0.014, TAG.PLASTIC)
    knob(cabin, sgn * 0.945, 0.62, 0.62, 0.05, 0.004, 16, TAG.PLASTIC)
    // Door pull.
    bar(cabin, [ sgn * 0.93, 0.83, -0.18 ], [ sgn * 0.93, 0.83, -0.02 ], 0.012, TAG.PLASTIC)
  }

  // The pillars, the header, the visors, the headliner.
  bar(cabin, [ -0.92, 0.9, 1.05 ], [ -0.7, 1.52, 0.2 ], 0.05, TAG.PLASTIC)
  bar(cabin, [ 0.92, 0.9, 1.05 ], [ 0.7, 1.52, 0.2 ], 0.05, TAG.PLASTIC)
  box(cabin, 0, 1.53, 0.3, 0.75, 0.03, 0.12, TAG.PLASTIC)
  box(cabin, -0.42, 1.49, 0.36, 0.22, 0.006, 0.07, TAG.PLASTIC)
  box(cabin, 0.42, 1.49, 0.36, 0.22, 0.006, 0.07, TAG.PLASTIC)
  quad(cabin, [ -0.8, 1.5, 0.42 ], [ 0.8, 1.5, 0.42 ], [ 0.8, 1.5, -0.6 ], [ -0.8, 1.5, -0.6 ], TAG.PLASTIC)

  // The mirror on its stalk, glass forward-facing toward the driver's eye.
  bar(cabin, [ 0, 1.5, 0.5 ], [ 0, 1.44, 0.56 ], 0.01, TAG.PLASTIC)
  bevelBox(cabin, 0, 1.41, 0.56, 0.115, 0.036, 0.01, 0.006, TAG.PLASTIC)
  quad(cabin, [ -0.105, 1.378, 0.548 ], [ 0.105, 1.378, 0.548 ], [ 0.105, 1.442, 0.548 ], [ -0.105, 1.442, 0.548 ], TAG.MIRROR)

  // The bonnet, seen over the dash: paint with a centre crease, and wipers.
  quad(cabin, [ -0.98, 0.87, 1.25 ], [ -0.15, 0.91, 1.25 ], [ -0.15, 0.8, 3.0 ], [ -0.9, 0.74, 3.0 ], TAG.PAINT)
  quad(cabin, [ -0.15, 0.91, 1.25 ], [ 0.15, 0.91, 1.25 ], [ 0.15, 0.8, 3.0 ], [ -0.15, 0.8, 3.0 ], TAG.PAINT)
  quad(cabin, [ 0.15, 0.91, 1.25 ], [ 0.98, 0.87, 1.25 ], [ 0.9, 0.74, 3.0 ], [ 0.15, 0.8, 3.0 ], TAG.PAINT)
  bar(cabin, [ -0.75, 0.88, 1.23 ], [ -0.1, 0.89, 1.21 ], 0.012, TAG.PLASTIC)
  bar(cabin, [ 0.05, 0.89, 1.21 ], [ 0.7, 0.88, 1.23 ], 0.012, TAG.PLASTIC)
  bar(cabin, [ -0.42, 0.885, 1.22 ], [ -0.42, 0.87, 1.30 ], 0.008, TAG.PLASTIC)
  bar(cabin, [ 0.38, 0.885, 1.22 ], [ 0.38, 0.87, 1.30 ], 0.008, TAG.PLASTIC)

  // The wheel: leather rim, three flat spokes, a padded hub with an emblem.
  const wheel = createMeshBuilder()
  torus(wheel, WHEEL.x, WHEEL.y, WHEEL.z, WHEEL.R, 0.018, WHEEL.tilt, 40, 12, TAG.LEATHER)

  const ct      = Math.cos(WHEEL.tilt)
  const st      = Math.sin(WHEEL.tilt)
  const onWheel = (x: number, y: number, z: number): P =>
    [ WHEEL.x + x, WHEEL.y + y * ct - z * st, WHEEL.z + y * st + z * ct ]
  for (const a of [ -Math.PI / 2, Math.PI * 0.08, Math.PI * 0.92 ]) {
    const ex = Math.cos(a) * (WHEEL.R - 0.012)
    const ey = Math.sin(a) * (WHEEL.R - 0.012)
    bar(wheel, onWheel(0, 0, 0), onWheel(ex, ey, 0), 0.011, TAG.PLASTIC)
    bar(wheel, onWheel(0, 0, -0.006), onWheel(ex * 0.9, ey * 0.9, -0.006), 0.016, TAG.PLASTIC)
  }

  const hub = onWheel(0, 0, 0)
  bevelBox(wheel, hub[0], hub[1], hub[2], 0.05, 0.028, 0.035, 0.012, TAG.LEATHER)
  torus(wheel, WHEEL.x, WHEEL.y, WHEEL.z - 0.03, 0.02, 0.004, WHEEL.tilt, 20, 6, TAG.CHROME)

  // The needles: a tapered blade and a chrome cap, pivoted by uniform.
  const needle = (d: typeof SPEEDO): MeshBuilder => {
    const b  = createMeshBuilder()
    const p0 = dialPoint(d.u - 0.004, d.v - 0.15, -0.004)
    const p1 = dialPoint(d.u + 0.004, d.v - 0.15, -0.004)
    const p2 = dialPoint(d.u + 0.0015, d.v + 0.42, -0.004)
    const p3 = dialPoint(d.u - 0.0015, d.v + 0.42, -0.004)
    quad(b, [ p0.x, p0.y, p0.z ], [ p1.x, p1.y, p1.z ], [ p2.x, p2.y, p2.z ], [ p3.x, p3.y, p3.z ], TAG.NEEDLE)

    const c = dialPoint(d.u, d.v, -0.006)
    knob(b, c.x, c.y, c.z + 0.006, 0.013, 0.008, 12, TAG.CHROME)
    return b
  }

  const wc = onWheel(0, 0, 0)
  const wa = onWheel(0, 0, 1)
  return {
    cabin,
    wheel,
    speedo:      needle(SPEEDO),
    tacho:       needle(TACHO),
    wheelCentre: { x: wc[0], y: wc[1], z: wc[2] },
    wheelAxis:   { x: wa[0] - wc[0], y: wa[1] - wc[1], z: wa[2] - wc[2] },
  }
}

/** Needle angle for a reading: straight up at the middle of the sweep. */
export function needleAngle (d: typeof SPEEDO, value: number): number {
  const f = Math.min(1, Math.max(0, (value - d.min) / (d.max - d.min)))
  return (0.5 - f) * d.sweep * Math.PI / 180
}

/**
 * The dial faces, drawn once. 1024×448, the speedometer on the left and the
 * tachometer on the right, white on near-black with a red band past 6500.
 */
export function drawDialFaces (): HTMLCanvasElement {
  const W   = 1024
  const H   = 448
  const cv  = document.createElement('canvas')
  cv.width  = W
  cv.height = H

  const ctx     = cv.getContext('2d')!
  ctx.fillStyle = '#0a0a0c'
  ctx.fillRect(0, 0, W, H)

  const dial = (d: typeof SPEEDO, major: number, minor: number, labelEvery: number, scale: number, red?: number) => {
    const cx        = d.u * W
    const cy        = (1 - d.v) * H
    const R         = 190
    ctx.strokeStyle = '#2a2a30'
    ctx.lineWidth   = 3
    ctx.beginPath()
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2)
    ctx.stroke()

    const a0   = Math.PI / 2 + d.sweep / 2 * Math.PI / 180
    const step = d.max - d.min
    const ang  = (v: number) => a0 - (v - d.min) / step * d.sweep * Math.PI / 180
    if (red !== undefined) {
      ctx.strokeStyle = '#c8261e'
      ctx.lineWidth   = 14
      ctx.beginPath()
      ctx.arc(cx, cy, R - 12, -ang(red), -ang(d.max), false)
      ctx.stroke()
    }
    ctx.strokeStyle  = '#e8e6e0'
    ctx.fillStyle    = '#e8e6e0'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.font         = 'bold 30px "Helvetica Neue", Arial, sans-serif'
    for (let v = d.min; v <= d.max; v += minor) {
      const a       = ang(v)
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
      const len     = isMajor ? 26 : 12
      ctx.lineWidth = isMajor ? 4 : 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R)
      ctx.lineTo(cx + Math.cos(a) * (R - len), cy - Math.sin(a) * (R - len))
      ctx.stroke()
      if (isMajor && Math.abs(v / labelEvery - Math.round(v / labelEvery)) < 1e-6)
        ctx.fillText(String(v / scale), cx + Math.cos(a) * (R - 58), cy - Math.sin(a) * (R - 58))
    }
  }
  dial(SPEEDO, 20, 10, 20, 1)
  dial(TACHO, 1000, 500, 1000, 1000, 6500)
  ctx.fillStyle = '#8a8a90'
  ctx.font      = '22px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('km/h', SPEEDO.u * W, (1 - SPEEDO.v) * H + 70)
  ctx.fillText('rpm x1000', TACHO.u * W, (1 - TACHO.v) * H + 70)
  return cv
}
