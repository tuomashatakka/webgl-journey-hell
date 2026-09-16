// THE SCENIC ROUTE — the cockpit.
//
// Everything the rider sees of the car, built in the car's own frame: x to the
// right, y up, z forward, origin on the road under the driver. The camera lives
// in this frame too (lib: kinematics puts it at CAM_H over the spine with its
// sway and heave), so the cabin is fixed and the head moves inside it, which is
// what a cabin looks like from a seat.
//
// Parts are tagged in uv.x so one fragment shader can dress them: 0 soft black
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

export interface Cockpit {
  cabin:       MeshBuilder;
  wheel:       MeshBuilder;
  speedo:      MeshBuilder;
  tacho:       MeshBuilder;
  wheelCentre: V3;
  wheelAxis:   V3;
}

const WHEEL = { x: 0, y: 0.93, z: 0.66, R: 0.17, tilt: 30 * Math.PI / 180 }

export function buildCockpit (): Cockpit {
  const cabin = createMeshBuilder()

  // Dashboard: a top slab sloping away, a fascia toward the driver.
  quad(cabin, [ -0.95, 0.9, 0.72 ], [ 0.95, 0.9, 0.72 ], [ 0.95, 0.86, 1.25 ], [ -0.95, 0.86, 1.25 ], TAG.PLASTIC)
  quad(cabin, [ -0.95, 0.6, 0.62 ], [ 0.95, 0.6, 0.62 ], [ 0.95, 0.9, 0.72 ], [ -0.95, 0.9, 0.72 ], TAG.PLASTIC)
  // Chrome strip along the dash edge.
  box(cabin, 0, 0.905, 0.72, 0.95, 0.007, 0.012, TAG.CHROME)

  // Binnacle: a hood over the dials and the dial face itself.
  const f00 = dialPoint(0, 0)
  const f10 = dialPoint(1, 0)
  const f11 = dialPoint(1, 1)
  const f01 = dialPoint(0, 1)
  quad(cabin, [ f00.x, f00.y, f00.z ], [ f10.x, f10.y, f10.z ], [ f11.x, f11.y, f11.z ], [ f01.x, f01.y, f01.z ], TAG.DIAL)

  const back = (u: number, v: number): P => {
    const p = dialPoint(u, v, 0.09)
    return [ p.x, p.y, p.z ]
  }
  // Hood: top, sides.
  quad(cabin, [ f01.x, f01.y, f01.z ], [ f11.x, f11.y, f11.z ], back(1, 1.15), back(0, 1.15), TAG.PLASTIC)
  quad(cabin, [ f00.x, f00.y, f00.z ], [ f01.x, f01.y, f01.z ], back(0, 1.15), back(0, -0.1), TAG.PLASTIC)
  quad(cabin, [ f11.x, f11.y, f11.z ], [ f10.x, f10.y, f10.z ], back(1, -0.1), back(1, 1.15), TAG.PLASTIC)
  // Warning lamps: four small squares under the dials, uv.y = lamp id.
  for (let i = 0; i < 4; i++) {
    const u0 = 0.36 + i * 0.075
    const a  = dialPoint(u0, 0.1, -0.002)
    const c  = dialPoint(u0 + 0.05, 0.1, -0.002)
    const d  = dialPoint(u0 + 0.05, 0.2, -0.002)
    const e  = dialPoint(u0, 0.2, -0.002)
    quad(cabin, [ a.x, a.y, a.z ], [ c.x, c.y, c.z ], [ d.x, d.y, d.z ], [ e.x, e.y, e.z ], TAG.LAMP, i, i)
  }

  // A-pillars and the roof header; door tops.
  bar(cabin, [ -0.92, 0.9, 1.05 ], [ -0.7, 1.52, 0.2 ], 0.05, TAG.PLASTIC)
  bar(cabin, [ 0.92, 0.9, 1.05 ], [ 0.7, 1.52, 0.2 ], 0.05, TAG.PLASTIC)
  box(cabin, 0, 1.53, 0.3, 0.75, 0.03, 0.12, TAG.PLASTIC)
  box(cabin, -0.9, 0.8, 0.0, 0.05, 0.12, 0.7, TAG.PLASTIC)
  box(cabin, 0.9, 0.8, 0.0, 0.05, 0.12, 0.7, TAG.PLASTIC)
  // Headliner.
  quad(cabin, [ -0.8, 1.5, 0.42 ], [ 0.8, 1.5, 0.42 ], [ 0.8, 1.5, -0.6 ], [ -0.8, 1.5, -0.6 ], TAG.PLASTIC)

  // Rear-view mirror: a stalk and the glass, facing the driver.
  bar(cabin, [ 0, 1.5, 0.5 ], [ 0, 1.44, 0.56 ], 0.01, TAG.PLASTIC)
  box(cabin, 0, 1.41, 0.56, 0.115, 0.036, 0.01, TAG.PLASTIC)
  quad(cabin, [ -0.105, 1.378, 0.548 ], [ 0.105, 1.378, 0.548 ], [ 0.105, 1.442, 0.548 ], [ -0.105, 1.442, 0.548 ], TAG.MIRROR)

  // Bonnet: painted, falling away, with a crease.
  quad(cabin, [ -0.98, 0.87, 1.25 ], [ -0.15, 0.91, 1.25 ], [ -0.15, 0.8, 3.0 ], [ -0.9, 0.74, 3.0 ], TAG.PAINT)
  quad(cabin, [ -0.15, 0.91, 1.25 ], [ 0.15, 0.91, 1.25 ], [ 0.15, 0.8, 3.0 ], [ -0.15, 0.8, 3.0 ], TAG.PAINT)
  quad(cabin, [ 0.15, 0.91, 1.25 ], [ 0.98, 0.87, 1.25 ], [ 0.9, 0.74, 3.0 ], [ 0.15, 0.8, 3.0 ], TAG.PAINT)
  // Wipers parked.
  bar(cabin, [ -0.75, 0.88, 1.23 ], [ -0.1, 0.89, 1.21 ], 0.012, TAG.PLASTIC)
  bar(cabin, [ 0.05, 0.89, 1.21 ], [ 0.7, 0.88, 1.23 ], 0.012, TAG.PLASTIC)

  // The wheel: rim, hub, three spokes, in its own mesh so it turns.
  const wheel = createMeshBuilder()
  torus(wheel, WHEEL.x, WHEEL.y, WHEEL.z, WHEEL.R, 0.017, WHEEL.tilt, 36, 10, TAG.LEATHER)

  const ct      = Math.cos(WHEEL.tilt)
  const st      = Math.sin(WHEEL.tilt)
  const onWheel = (x: number, y: number, z: number): P =>
    [ WHEEL.x + x, WHEEL.y + y * ct - z * st, WHEEL.z + y * st + z * ct ]
  for (const a of [ Math.PI, Math.PI * 0.12, -Math.PI * 0.12 ]) {
    const ex = Math.cos(a) * (WHEEL.R - 0.01)
    const ey = Math.sin(a) * (WHEEL.R - 0.01)
    bar(wheel, onWheel(0, 0, 0), onWheel(ex, ey, 0), 0.012, TAG.PLASTIC)
  }

  const hub = onWheel(0, 0, 0)
  box(wheel, hub[0], hub[1], hub[2], 0.045, 0.03, 0.02, TAG.PLASTIC)

  // Needles: thin quads from the pivot, lying just off the dial face.
  const needle = (d: typeof SPEEDO): MeshBuilder => {
    const b  = createMeshBuilder()
    const p0 = dialPoint(d.u - 0.004, d.v - 0.15, -0.004)
    const p1 = dialPoint(d.u + 0.004, d.v - 0.15, -0.004)
    const p2 = dialPoint(d.u + 0.0015, d.v + 0.42, -0.004)
    const p3 = dialPoint(d.u - 0.0015, d.v + 0.42, -0.004)
    quad(b, [ p0.x, p0.y, p0.z ], [ p1.x, p1.y, p1.z ], [ p2.x, p2.y, p2.z ], [ p3.x, p3.y, p3.z ], TAG.NEEDLE)

    const c = dialPoint(d.u, d.v, -0.006)
    box(b, c.x, c.y, c.z, 0.012, 0.012, 0.004, TAG.CHROME)
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
