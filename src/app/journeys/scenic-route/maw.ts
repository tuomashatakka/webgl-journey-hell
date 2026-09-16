// THE SCENIC ROUTE — the maw.
//
// The fish is built around the road, not the other way round: its head is a
// closed circular profile swept along the gullet's own spine, so wherever the
// throat bends the body bends with it and the car is always inside. Two jaw
// shells sit at the mouth, each hinged on the mouth frame's right axis; the
// vertex shader rotates them by the lap's jaw angle. Teeth are cones baked
// into the jaw meshes so they open with the lip they grow from.
//
// Materials are decided by facing: a front face is skin, a back face is the
// inside of the mouth. The one mesh is the outside and the inside both.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { finishSweep, levelFrame, newFrame, sweepProfile } from '@/lib/sweep'
import type { ProfilePoint, SweepArrays } from '@/lib/sweep'
import type { Route } from './course'


/** Jaw opening in radians at lap 0, and its growth per lap. */
export const JAW_BASE   = 0.42
export const JAW_PER_LAP = 0.13

export function jawAngleAt (lapF: number): number {
  return JAW_BASE + Math.min(lapF, 3) * JAW_PER_LAP
}

export interface V3 { x: number; y: number; z: number }

export interface Jaw {
  builder: MeshBuilder;
  hinge:   V3;
  axis:    V3;

  /** Sign and share of the jaw angle this shell takes: the lower jaw does most of the opening. */
  share: number;
}

export interface Maw {
  head:  SweepArrays;
  upper: Jaw;
  lower: Jaw;
  mouth: V3;

  /** Arc length where the mouth is, for the tube's flesh weight. */
  s0: number;
}

/** Outer radius of the head by distance past the mouth. */
const HEAD_KNOTS: [ number, number ][] = [
  [ -6, 42 ], [ 18, 46 ], [ 55, 41 ], [ 95, 28 ], [ 125, 15 ], [ 140, 11 ],
]

export function headRadius (t: number): number {
  if (t <= HEAD_KNOTS[0][0])
    return HEAD_KNOTS[0][1]
  for (let i = 0; i < HEAD_KNOTS.length - 1; i++) {
    const [ t0, r0 ] = HEAD_KNOTS[i]
    const [ t1, r1 ] = HEAD_KNOTS[i + 1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      const e = f * f * (3 - 2 * f)
      return r0 + (r1 - r0) * e
    }
  }
  return HEAD_KNOTS[HEAD_KNOTS.length - 1][1]
}

const HEAD_SEGS = 28

/** A fish head is wider than tall; the mouth is a squashed ring. */
const WIDE = 1.1
const TALL = 0.86

/**
 * Clockwise in the (r, u) plane so the sweep's front faces point outward:
 * skin outside, mouth inside.
 */
function ring (R: number): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i < HEAD_SEGS; i++) {
    const a = -i / HEAD_SEGS * Math.PI * 2
    pts.push([ Math.cos(a) * R * WIDE, Math.sin(a) * R * TALL ])
  }
  return pts
}

// ---------------------------------------------------------------------------
// jaws
// ---------------------------------------------------------------------------

interface Basis { m: V3; r: V3; u: V3; f: V3 }

function toWorld (b: Basis, r: number, u: number, f: number): [ number, number, number ] {
  return [
    b.m.x + b.r.x * r + b.u.x * u + b.f.x * f,
    b.m.y + b.r.y * r + b.u.y * u + b.f.y * f,
    b.m.z + b.r.z * r + b.u.z * u + b.f.z * f,
  ]
}

function dirWorld (b: Basis, r: number, u: number, f: number): [ number, number, number ] {
  const x = b.r.x * r + b.u.x * u + b.f.x * f
  const y = b.r.y * r + b.u.y * u + b.f.y * f
  const z = b.r.z * r + b.u.z * u + b.f.z * f
  const l = Math.hypot(x, y, z) || 1
  return [ x / l, y / l, z / l ]
}

/** A cone from `base` along `dir`, tagged as a tooth in uv.x. */
function tooth (
  mb: MeshBuilder, base: [ number, number, number ], dir: [ number, number, number ],
  len: number, rad: number,
): void {
  // Any perpendicular pair.
  const ax = Math.abs(dir[0]) < 0.9 ? [ 1, 0, 0 ] : [ 0, 1, 0 ]
  let px = ax[1] * dir[2] - ax[2] * dir[1]
  let py = ax[2] * dir[0] - ax[0] * dir[2]
  let pz = ax[0] * dir[1] - ax[1] * dir[0]
  const pl = Math.hypot(px, py, pz) || 1
  px /= pl
  py /= pl
  pz /= pl

  const qx  = dir[1] * pz - dir[2] * py
  const qy  = dir[2] * px - dir[0] * pz
  const qz  = dir[0] * py - dir[1] * px
  const tip = mb.vertex(
    base[0] + dir[0] * len, base[1] + dir[1] * len, base[2] + dir[2] * len,
    dir[0], dir[1], dir[2], 2, 1,
  )
  const segs              = 7
  const ringIds: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a  = i / segs * Math.PI * 2
    const nx = px * Math.cos(a) + qx * Math.sin(a)
    const ny = py * Math.cos(a) + qy * Math.sin(a)
    const nz = pz * Math.cos(a) + qz * Math.sin(a)
    ringIds.push(mb.vertex(
      base[0] + nx * rad, base[1] + ny * rad, base[2] + nz * rad,
      nx * 0.85 + dir[0] * 0.5, ny * 0.85 + dir[1] * 0.5, nz * 0.85 + dir[2] * 0.5, 2, 0,
    ))
  }
  for (let i = 0; i < segs; i++)
    mb.face(ringIds[i], ringIds[i + 1], tip)
}

/**
 * One lip: a half ring at the mouth extruded forward toward the incoming car,
 * with an outer and an inner sheet, a rounded tip, and a row of teeth along the
 * inner rim. `a0..a1` picks the top or the bottom half.
 */
function jawShell (b: Basis, a0: number, a1: number, teethCount: number, seed: number): MeshBuilder {
  const mb                = createMeshBuilder()
  const Ri                = 40
  const Ro                = 47
  const segs              = 18
  const rows              = 5
  const len               = 30
  const inner: number[][] = []
  const outer: number[][] = []
  for (let j = 0; j <= rows; j++) {
    const t     = j / rows
    const f     = -len * t
    const flare = 1 + 0.1 * Math.sin(t * Math.PI * 0.5)
    const curl  = 1 - 0.06 * t * t
    const ri    = Ri * curl
    const ro    = Ro * flare
    inner.push([])
    outer.push([])
    for (let i = 0; i <= segs; i++) {
      const a  = a0 + (a1 - a0) * (i / segs)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const pi = toWorld(b, ca * ri * WIDE, sa * ri * TALL, f)
      const po = toWorld(b, ca * ro * WIDE, sa * ro * TALL, f)
      const n  = dirWorld(b, ca, sa, 0)
      inner[j].push(mb.vertex(pi[0], pi[1], pi[2], -n[0], -n[1], -n[2], 1, t))
      outer[j].push(mb.vertex(po[0], po[1], po[2], n[0], n[1], n[2], 0, t))
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      // Outer sheet faces out, inner sheet faces in (toward the mouth axis).
      mb.face(outer[j][i], outer[j][i + 1], outer[j + 1][i + 1])
      mb.face(outer[j][i], outer[j + 1][i + 1], outer[j + 1][i])
      mb.face(inner[j][i], inner[j + 1][i + 1], inner[j][i + 1])
      mb.face(inner[j][i], inner[j + 1][i], inner[j + 1][i + 1])
    }
  // The tip: close outer to inner at the last row.
  for (let i = 0; i < segs; i++) {
    mb.face(outer[rows][i], inner[rows][i], inner[rows][i + 1])
    mb.face(outer[rows][i], inner[rows][i + 1], outer[rows][i + 1])
  }
  // The two ends of the half ring.
  for (let j = 0; j < rows; j++) {
    mb.face(outer[j][0], inner[j][0], inner[j + 1][0])
    mb.face(outer[j][0], inner[j + 1][0], outer[j + 1][0])
    mb.face(outer[j][segs], inner[j + 1][segs], inner[j][segs])
    mb.face(outer[j][segs], outer[j + 1][segs], inner[j + 1][segs])
  }

  // Teeth along the inner rim, two staggered rows, pointing in and back.
  for (let k = 0; k < teethCount; k++) {
    const t    = (k + 0.5) / teethCount
    const a    = a0 + (a1 - a0) * t
    const row  = k % 2
    const f    = -len * (0.55 + row * 0.25)
    const h    = Math.sin((seed + k) * 12.9898) * 0.5 + 0.5
    const ca   = Math.cos(a)
    const sa   = Math.sin(a)
    const base = toWorld(b, ca * (Ri - 0.5) * WIDE, sa * (Ri - 0.5) * TALL, f)
    const dir  = dirWorld(b, -ca * 0.85, -sa * 0.85, 0.5 + h * 0.2)
    tooth(mb, base, dir, 4.5 + h * 4, 0.9 + h * 0.5)
  }
  return mb
}

// ---------------------------------------------------------------------------
// the tube: gullet into cave
// ---------------------------------------------------------------------------

/** Where the flesh gives way to rock, in metres past the mouth. */
export const FLESH_END  = 95
export const ROCK_START = 210

/** Inner radius of the throat and cave by arc length. */
export function tubeRadius (t: number, s: number): number {
  const throat = 30 + (11 - 30) * smooth01(t / 120)
  const cave   = 10.5 + 3.5 * Math.sin(s * 0.031) + 2.2 * Math.sin(s * 0.077 + 1.0) + 1.5 * Math.sin(s * 0.19 + 2.0)
  const w      = smooth01((t - 90) / 110)
  return Math.max(6.5, throat * (1 - w) + cave * w)
}

function smooth01 (x: number): number {
  const f = Math.min(1, Math.max(0, x))
  return f * f * (3 - 2 * f)
}

export interface Tube {

  /** The throat from the mouth to where it is under the sea: rises and sinks with the head. */
  front: SweepArrays;

  /** The rest, fixed: the seam between the two is under water while the head moves. */
  back:  SweepArrays;
  water: SweepArrays;
  s0:    number;
  s1:    number;
}

/** Metres past the mouth where the front part of the tube hands over to the fixed part. */
export const TUBE_SPLIT = 74

/**
 * The tube's ring sits high on the spine: the car rides the water near the
 * floor, the vault is overhead. Clockwise like the head, so the sweep's front
 * faces point inward at the rider.
 */
function tubeRing (R: number): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  const u0                  = R * 0.42
  for (let i = 0; i < HEAD_SEGS; i++) {
    const a = -i / HEAD_SEGS * Math.PI * 2
    pts.push([ Math.cos(a) * R * 1.15, Math.sin(a) * R + u0 ])
  }
  return pts
}

export function buildTube (route: Route): Tube {
  const g       = route.spans[5]
  const u       = route.spans[6]
  const s0      = g.s0
  const s1      = u.s1 - 18
  const profile = (s: number) => tubeRing(tubeRadius(s - s0, s))
  const front   = finishSweep(sweepProfile(route.curve, {
    s0:     s0 - 2,
    s1:     s0 + TUBE_SPLIT + 2.5,
    step:   2.5,
    closed: true,
    profile,
  }))
  const back = finishSweep(sweepProfile(route.curve, {
    s0:     s0 + TUBE_SPLIT,
    s1,
    step:   2.5,
    closed: true,
    profile,
  }))
  const water = finishSweep(sweepProfile(route.curve, {
    s0:      s0 + 60,
    s1,
    step:    2.5,
    profile: s => {
      const r = tubeRadius(s - s0, s) * 1.2
      return [[ -r, 0 ], [ r, 0 ]]
    },
  }))
  return { front, back, water, s0, s1 }
}

export function buildMaw (route: Route): Maw {
  const g     = route.spans[5]
  const frame = newFrame()
  const s0    = g.s0

  const head = finishSweep(sweepProfile(route.curve, {
    s0:      s0 - 6,
    s1:      s0 + 140,
    step:    3,
    closed:  true,
    profile: s => ring(headRadius(s - s0)),
  }))

  const f0           = levelFrame(route.curve, s0, frame)
  const basis: Basis = {
    m: { x: f0.pos.x, y: f0.pos.y, z: f0.pos.z },
    r: { x: f0.right.x, y: f0.right.y, z: f0.right.z },
    u: { x: f0.up.x, y: f0.up.y, z: f0.up.z },
    f: { x: f0.forward.x, y: f0.forward.y, z: f0.forward.z },
  }

  const hingeAt = (u: number): V3 => {
    const p = toWorld(basis, 0, u, 6)
    return { x: p[0], y: p[1], z: p[2] }
  }
  const axis: V3 = { x: basis.r.x, y: basis.r.y, z: basis.r.z }

  return {
    head,
    upper: {
      builder: jawShell(basis, Math.PI * 0.06, Math.PI * 0.94, 44, 1),
      hinge:   hingeAt(36),
      axis,
      share:   -0.35,
    },
    lower: {
      builder: jawShell(basis, Math.PI * 1.06, Math.PI * 1.94, 46, 2),
      hinge:   hingeAt(-36),
      axis,
      share:   1.0,
    },
    mouth: basis.m,
    s0,
  }
}
