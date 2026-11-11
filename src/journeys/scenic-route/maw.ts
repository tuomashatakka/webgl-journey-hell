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
//
// What makes it a monster rather than a pipe with a lip: fangs in three rows
// on each jaw, long and curved and irregular, some missing, some broken; three
// rings of teeth down the throat that grind round in opposite directions; an
// anglerfish lure arched over the mouth on a stalk, its bulb swaying; and
// strands of slime strung between the jaws that stretch as the mouth gapes.
// Everything that moves is rigid about a hinge (jawVert) or strung between two
// hinges (strandVert), so the CPU builds it once and a uniform animates it.

import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { finishSweep, levelFrame, sweepProfile } from '@wjh/geometry/sweep'
import { newFrame } from '@wjh/geometry/curve'
import type { ProfilePoint, SweepArrays } from '@wjh/geometry/sweep'
import type { Route } from './course'
import { hash } from './props/hash'

/** Jaw opening in radians at lap 0, and its growth per lap. */
const JAW_BASE    = 0.42
const JAW_PER_LAP = 0.13

/** Outer radius of the head by distance past the mouth. */
const HEAD_KNOTS: [ number, number ][] = [
  [ -6, 42 ], [ 18, 46 ], [ 55, 41 ], [ 95, 28 ], [ 125, 15 ], [ 140, 11 ],
]

const HEAD_SEGS = 28

/** A fish head is wider than tall; the mouth is a squashed ring. */
const WIDE = 1.1
const TALL = 0.86

/** The three rows of fangs on a lip: how many, where along it, how long. */
const FANG_ROWS = [
  { count: 13, at: 0.86, len: [ 9, 17 ], rad: [ 1.5, 2.3 ]},
  { count: 22, at: 0.62, len: [ 5, 9.5 ], rad: [ 0.9, 1.4 ]},
  { count: 32, at: 0.34, len: [ 2.5, 4.5 ], rad: [ 0.5, 0.8 ]},
]

/** Metres past the mouth of each ring of throat teeth. */
const RING_AT = [ 12, 27, 44 ]

/** How many strands of slime, and how many pieces each hangs in. */
const STRANDS     = 16
const STRAND_SEGS = 12

// ---------------------------------------------------------------------------
// the tube: gullet into cave
// ---------------------------------------------------------------------------

/** Where the flesh gives way to rock, in metres past the mouth. */
export const FLESH_END  = 95
export const ROCK_START = 210

/** Metres past the mouth where the front part of the tube hands over to the fixed part. */
const TUBE_SPLIT = 74

/**
 * The glow-worm cathedral: where the river runs under the sea, the tunnel
 * opens sideways into a chamber three times its width, its vault a starfield
 * of glow-worms over a black lake. Wide rather than tall, because the cave is
 * only a few metres under the seabed; the opaque sea hides whatever of the
 * vault comes up through it. t is metres past the mouth.
 */
export const CHAMBER = { t: 470, half: 75, widen: 2.1, swell: 0.3 }

/**
 * The waterfall: a curtain of water poured from the vault across the tunnel,
 * which the car goes straight through. t is metres past the mouth.
 */
const FALLS_T = 800

type P3 = [ number, number, number ]

/** The waterfall's curtain, where it stands, and its arc length. */
interface Falls { builder: MeshBuilder; centre: V3; s: number }

interface V3 { x: number; y: number; z: number }

export interface Jaw {
  builder: MeshBuilder;
  hinge:   V3;
  axis:    V3;

  /** Sign and share of the jaw angle this shell takes: the lower jaw does most of the opening. */
  share: number;
}

/** A rigid part that turns about a hinge: a ring of throat teeth, the lure. */
export interface Hinged {
  builder: MeshBuilder;
  hinge:   V3;
  axis:    V3;
}

export interface Maw {
  head:  SweepArrays;
  upper: Jaw;
  lower: Jaw;
  mouth: V3;

  /** The throat's tooth rings, mouth first. Each turns about the throat's axis. */
  rings: Hinged[];

  /** The lure on its stalk, swaying about the stalk's root. */
  lure: Hinged;

  /**
   * Slime strung between the lips: position is the anchor on the upper jaw,
   * normal the anchor on the lower, uv (along, side · width). strandVert
   * moves both anchors with their jaws and hangs the strand between them.
   */
  strands: MeshBuilder;

  /** Arc length where the mouth is, for the tube's flesh weight. */
  s0: number;
}

// ---------------------------------------------------------------------------
// jaws
// ---------------------------------------------------------------------------

interface Basis { m: V3; r: V3; u: V3; f: V3 }

export interface Tube {

  /** The throat from the mouth to where it is under the sea: rises and sinks with the head. */
  front: SweepArrays;

  /** The rest, fixed: the seam between the two is under water while the head moves. */
  back:  SweepArrays;
  water: SweepArrays;
  s0:    number;
  s1:    number;
}

export function jawAngleAt (lapF: number): number {
  return JAW_BASE + Math.min(lapF, 3) * JAW_PER_LAP
}

function headRadius (t: number): number {
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

function norm3 (v: P3): P3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [ v[0] / l, v[1] / l, v[2] / l ]
}

function cross3 (a: P3, b: P3): P3 {
  return [ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] ]
}

/**
 * A fang: a cone that curls as it goes, from `base` along `dir` bending toward
 * `curl`, tagged as a tooth in uv.x with the distance along it in uv.y (root
 * to tip, for the colour). Six rings along it, seven sides round.
 */
function fang (mb: MeshBuilder, base: P3, dir: P3, curl: P3, len: number, rad: number): void {
  const RINGS = 5
  const SIDES = 7
  const at    = (t: number): P3 => [
    base[0] + dir[0] * len * t + curl[0] * len * 0.32 * t * t,
    base[1] + dir[1] * len * t + curl[1] * len * 0.32 * t * t,
    base[2] + dir[2] * len * t + curl[2] * len * 0.32 * t * t,
  ]
  const rings: number[][] = []
  for (let j = 0; j < RINGS; j++) {
    const t             = j / RINGS
    const c             = at(t)
    const tan           = norm3([ dir[0] + curl[0] * 0.64 * t, dir[1] + curl[1] * 0.64 * t, dir[2] + curl[2] * 0.64 * t ])
    const ref: P3       = Math.abs(tan[1]) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ]
    const p             = norm3(cross3(tan, ref))
    const q             = cross3(tan, p)
    const r             = rad * Math.pow(1 - t, 0.85)
    const ids: number[] = []
    for (let i = 0; i <= SIDES; i++) {
      const a  = i / SIDES * Math.PI * 2
      const nx = p[0] * Math.cos(a) + q[0] * Math.sin(a)
      const ny = p[1] * Math.cos(a) + q[1] * Math.sin(a)
      const nz = p[2] * Math.cos(a) + q[2] * Math.sin(a)
      ids.push(mb.vertex(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, nx, ny, nz, 2, t))
    }
    rings.push(ids)
  }

  const tip   = at(1)
  const tTan  = norm3([ dir[0] + curl[0] * 0.64, dir[1] + curl[1] * 0.64, dir[2] + curl[2] * 0.64 ])
  const tipId = mb.vertex(tip[0], tip[1], tip[2], tTan[0], tTan[1], tTan[2], 2, 1)
  for (let j = 0; j < RINGS - 1; j++)
    for (let i = 0; i < SIDES; i++) {
      mb.face(rings[j][i], rings[j][i + 1], rings[j + 1][i + 1])
      mb.face(rings[j][i], rings[j + 1][i + 1], rings[j + 1][i])
    }
  for (let i = 0; i < SIDES; i++)
    mb.face(rings[RINGS - 1][i], rings[RINGS - 1][i + 1], tipId)
}

/**
 * One lip: a half ring at the mouth extruded forward toward the incoming car,
 * with an outer and an inner sheet, a rounded tip, and three rows of fangs on
 * the inner rim. The outer sheet is lumped and ridged; the inner one is gum.
 * `a0..a1` picks the top or the bottom half.
 */
function jawShell (b: Basis, a0: number, a1: number, seed: number): MeshBuilder {
  const mb                = createMeshBuilder()
  const Ri                = 40
  const Ro                = 47
  const segs              = 40
  const rows              = 10
  const len               = 30
  const inner: number[][] = []
  const outer: number[][] = []
  for (let j = 0; j <= rows; j++) {
    const t     = j / rows
    const f     = -len * t
    const flare = 1 + 0.1 * Math.sin(t * Math.PI * 0.5)
    const curl  = 1 - 0.06 * t * t
    inner.push([])
    outer.push([])
    for (let i = 0; i <= segs; i++) {
      const a  = a0 + (a1 - a0) * (i / segs)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // Ridges along the lip and lumps across it: the outside of a skull
      // under skin, not a turned pipe.
      const lump = 1 + 0.045 * Math.sin(a * 11 + seed) * Math.sin(t * 5 + seed * 2) + 0.03 * (hash(seed * 97 + i * 13 + j * 7) - 0.5)
      const gum  = 1 + 0.02 * Math.sin(a * 23 + seed)
      const ri   = Ri * curl * gum
      const ro   = Ro * flare * lump
      const pi   = toWorld(b, ca * ri * WIDE, sa * ri * TALL, f)
      const po   = toWorld(b, ca * ro * WIDE, sa * ro * TALL, f)
      const n    = dirWorld(b, ca, sa, 0)
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

  // Fangs: three rows, pointing in toward the axis and curling back down the
  // throat. A few are missing and a few are snapped off short.
  const back = dirWorld(b, 0, 0, 1)
  FANG_ROWS.forEach((row, ri) => {
    for (let k = 0; k < row.count; k++) {
      const h = hash(seed * 131 + ri * 977 + k * 7.3)
      if (h < 0.1)
        continue

      const t    = (k + 0.5 + (hash(seed + ri * 31 + k * 3.1) - 0.5) * 0.6) / row.count
      const a    = a0 + (a1 - a0) * t
      const ca   = Math.cos(a)
      const sa   = Math.sin(a)
      const f    = -len * (row.at + (hash(k * 5.7 + seed + ri) - 0.5) * 0.08)
      const base = toWorld(b, ca * (Ri - 0.3) * WIDE, sa * (Ri - 0.3) * TALL, f)
      // Longest in the middle of the lip, shorter toward the corners.
      const mid   = Math.sin(t * Math.PI)
      const broke = hash(k * 2.9 + seed * 17 + ri) < 0.1 ? 0.45 : 1
      const L     = (row.len[0] + (row.len[1] - row.len[0]) * h) * (0.55 + 0.45 * mid) * broke
      const R     = row.rad[0] + (row.rad[1] - row.rad[0]) * h
      const dir   = dirWorld(b, -ca * 0.85 + (h - 0.5) * 0.2, -sa * 0.85, 0.18 + (h - 0.5) * 0.25)
      fang(mb, base as P3, dir as P3, back as P3, L, R)
    }
  })
  return mb
}

/** 0..1, how far into the chamber t is: a smooth bell over its length. */
function chamberAt (t: number): number {
  const b = Math.max(0, 1 - Math.abs(t - CHAMBER.t) / CHAMBER.half)
  return b * b * (3 - 2 * b)
}

/** The ring's half width as a multiple of its radius: 1.15, and more in the chamber. */
export function tubeWidth (t: number): number {
  return 1.15 + CHAMBER.widen * chamberAt(t)
}

/** Inner radius of the throat and cave by arc length. */
export function tubeRadius (t: number, s: number): number {
  const throat = 30 + (11 - 30) * smooth01(t / 120)
  const cave   = 10.5 + 3.5 * Math.sin(s * 0.031) + 2.2 * Math.sin(s * 0.077 + 1) + 1.5 * Math.sin(s * 0.19 + 2)
  const w      = smooth01((t - 90) / 110)
  return Math.max(6.5, throat * (1 - w) + cave * w) * (1 + CHAMBER.swell * chamberAt(t))
}

function smooth01 (x: number): number {
  const f = Math.min(1, Math.max(0, x))
  return f * f * (3 - 2 * f)
}

/**
 * The tube's ring sits high on the spine: the car rides the water near the
 * floor, the vault is overhead. Clockwise like the head, so the sweep's front
 * faces point inward at the rider.
 */
function tubeRing (R: number, W: number): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  const u0                  = R * 0.42
  for (let i = 0; i < HEAD_SEGS; i++) {
    const a = -i / HEAD_SEGS * Math.PI * 2
    pts.push([ Math.cos(a) * R * W, Math.sin(a) * R + u0 ])
  }
  return pts
}

export function buildTube (route: Route): Tube {
  const g       = route.spans[5]
  const u       = route.spans[6]
  const s0      = g.s0
  const s1      = u.s1 - 18
  const profile = (s: number) => tubeRing(tubeRadius(s - s0, s), tubeWidth(s - s0))
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
  // Water lies level. Where the throat is still diving, a strip swept along
  // its spine was a ramp of water down the gullet (a slide, a carpet); the
  // river starts where the spine has pulled out of the dive and runs level.
  const fr = newFrame()
  let wet  = s0 + 60
  while (wet < s1 - 10 && Math.abs(levelFrame(route.curve, wet, fr).forward.y) > 0.05)
    wet += 2.5

  const water = finishSweep(sweepProfile(route.curve, {
    s0:      wet,
    s1,
    step:    2.5,
    profile: s => {
      const r = tubeRadius(s - s0, s) * (tubeWidth(s - s0) + 0.05)
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
      builder: jawShell(basis, Math.PI * 0.06, Math.PI * 0.94, 1),
      hinge:   hingeAt(36),
      axis,
      share:   -0.35,
    },
    lower: {
      builder: jawShell(basis, Math.PI * 1.06, Math.PI * 1.94, 2),
      hinge:   hingeAt(-36),
      axis,
      share:   1,
    },
    mouth:   basis.m,
    s0,
    rings:   throatTeeth(route, s0),
    lure:    lure(basis),
    strands: strands(basis),
  }
}

/**
 * Rings of teeth down the throat, lamprey fashion: on the tube's wall,
 * pointing in at its centre and down toward the gut, so the way in is the
 * only way. Lengths stay under the wall's clearance to the car's line, the
 * floor's especially. Each ring turns about the throat's own axis there.
 */
function throatTeeth (route: Route, s0: number): Hinged[] {
  return RING_AT.map((t, ri) => {
    const s       = s0 + t
    const fr      = levelFrame(route.curve, s, newFrame())
    const R       = tubeRadius(t, s)
    const u0      = R * 0.42
    const mb      = createMeshBuilder()
    const n       = 26 + ri * 4
    const fwd: P3 = [ fr.forward.x, fr.forward.y, fr.forward.z ]
    const cen: P3 = [ fr.pos.x + fr.up.x * u0, fr.pos.y + fr.up.y * u0, fr.pos.z + fr.up.z * u0 ]
    for (let k = 0; k < n; k++) {
      const a        = (k + hash(ri * 53 + k) * 0.5) / n * Math.PI * 2
      const cx       = Math.cos(a) * R * 1.15 * 1.02
      const cy       = Math.sin(a) * R * 1.02
      const base: P3 = [
        cen[0] + fr.right.x * cx + fr.up.x * cy,
        cen[1] + fr.right.y * cx + fr.up.y * cy,
        cen[2] + fr.right.z * cx + fr.up.z * cy,
      ]
      const inward = norm3([ cen[0] - base[0], cen[1] - base[1], cen[2] - base[2] ])
      const dir    = norm3([ inward[0] + fwd[0] * 0.55, inward[1] + fwd[1] * 0.55, inward[2] + fwd[2] * 0.55 ])
      const floor  = Math.sin(a) < -0.5 ? 0.5 : 1
      const L      = R * (0.17 + 0.13 * hash(ri * 71 + k * 1.7)) * floor
      fang(mb, base, dir, fwd, L, L * 0.13)
    }
    return {
      builder: mb,
      hinge:   { x: cen[0], y: cen[1], z: cen[2] },
      axis:    { x: fwd[0], y: fwd[1], z: fwd[2] },
    }
  })
}

/**
 * The lure: a stalk from the crown of the head arched out over the mouth, off
 * the line the car falls along, ending in a bulb that glows (uv.x 4). The
 * stalk is skin (uv.x 0). It sways about its root.
 */
function lure (b: Basis): Hinged {
  const mb    = createMeshBuilder()
  const B: P3 = [ 0, 38, 20 ]
  const C: P3 = [ 8, 82, -14 ]
  const E: P3 = [ 17, 31, -36 ]
  const SEG   = 28
  const SIDES = 9
  const at    = (t: number): P3 => {
    const u = 1 - t
    return [
      u * u * B[0] + 2 * u * t * C[0] + t * t * E[0],
      u * u * B[1] + 2 * u * t * C[1] + t * t * E[1],
      u * u * B[2] + 2 * u * t * C[2] + t * t * E[2],
    ]
  }
  let prev: number[] | null = null
  for (let j = 0; j <= SEG; j++) {
    const t   = j / SEG
    const c   = at(t)
    const d   = at(Math.min(1, t + 0.01))
    const e   = at(Math.max(0, t - 0.01))
    const tan = norm3([ d[0] - e[0], d[1] - e[1], d[2] - e[2] ])
    const p   = norm3(cross3(tan, [ 1, 0, 0 ]))
    const q   = cross3(tan, p)
    // Thick at the root, a whip at the end, knuckled along the way.
    const r             = (2.2 - 1.6 * t) * (1 + 0.12 * Math.sin(t * 40))
    const ids: number[] = []
    for (let i = 0; i <= SIDES; i++) {
      const a  = i / SIDES * Math.PI * 2
      const nr = p.map((pv, k) => pv * Math.cos(a) + q[k] * Math.sin(a)) as P3
      const w  = toWorld(b, c[0] + nr[0] * r, c[1] + nr[1] * r, c[2] + nr[2] * r)
      const nw = dirWorld(b, nr[0], nr[1], nr[2])
      ids.push(mb.vertex(w[0], w[1], w[2], nw[0], nw[1], nw[2], 0, t))
    }
    if (prev)
      for (let i = 0; i < SIDES; i++) {
        mb.face(prev[i], ids[i], ids[i + 1])
        mb.face(prev[i], ids[i + 1], prev[i + 1])
      }
    prev = ids
  }

  // The bulb: a lumpy sphere at the end.
  const RING             = 12
  const SEGS             = 18
  const grid: number[][] = []
  for (let j = 0; j <= RING; j++) {
    const th = j / RING * Math.PI
    grid.push([])
    for (let i = 0; i <= SEGS; i++) {
      const ph     = i / SEGS * Math.PI * 2
      const nl: P3 = [ Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph) ]
      const r      = 4.2 * (1 + 0.08 * Math.sin(th * 5 + ph * 3))
      const w      = toWorld(b, E[0] + nl[0] * r, E[1] - 3.5 + nl[1] * r, E[2] + nl[2] * r)
      const nw     = dirWorld(b, nl[0], nl[1], nl[2])
      grid[j].push(mb.vertex(w[0], w[1], w[2], nw[0], nw[1], nw[2], 4, j / RING))
    }
  }
  for (let j = 0; j < RING; j++)
    for (let i = 0; i < SEGS; i++) {
      mb.face(grid[j][i], grid[j + 1][i + 1], grid[j][i + 1])
      mb.face(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1])
    }

  const h = toWorld(b, B[0], B[1], B[2])
  return { builder: mb, hinge: { x: h[0], y: h[1], z: h[2] }, axis: b.u }
}

/** The strands: anchors on the two inner lips, a ribbon of segments between. */
function strands (b: Basis): MeshBuilder {
  const mb = createMeshBuilder()
  for (let k = 0; k < STRANDS; k++) {
    const h  = hash(k * 13.7 + 5)
    const a  = Math.PI * (0.18 + 0.64 * ((k + h * 0.8) / STRANDS))
    const a2 = -a + (hash(k * 3.3) - 0.5) * 0.5
    const f  = -30 * (0.25 + 0.6 * hash(k * 7.1 + 2))
    const up = toWorld(b, Math.cos(a) * 38.5 * WIDE, Math.sin(a) * 38.5 * TALL, f)
    const dn = toWorld(b, Math.cos(a2) * 38.5 * WIDE, Math.sin(a2) * 38.5 * TALL, f + (h - 0.5) * 6)
    const w  = 0.35 + 0.9 * hash(k * 1.9 + 11)
    let prev: number[] | null = null
    for (let j = 0; j <= STRAND_SEGS; j++) {
      const t   = j / STRAND_SEGS
      const ids = [ -1, 1 ].map(side => mb.vertex(up[0], up[1], up[2], dn[0], dn[1], dn[2], t, side * w))
      if (prev) {
        mb.face(prev[0], ids[0], ids[1])
        mb.face(prev[0], ids[1], prev[1])
      }
      prev = ids
    }
  }
  return mb
}

/**
 * The waterfall's curtain: a grid across the tunnel's cross-section at
 * FALLS_T, from the waterline up into the vault, trimmed to the ring. uv is
 * (metres across, metres up from the water); the shader pours it.
 */
export function buildFalls (route: Route): Falls {
  const s0              = route.spans[5].s0
  const s               = s0 + FALLS_T
  const fr              = levelFrame(route.curve, s, newFrame())
  const R               = tubeRadius(FALLS_T, s)
  const W               = tubeWidth(FALLS_T)
  const u0              = R * 0.42
  const mb              = createMeshBuilder()
  const NX              = 40
  const NY              = 24
  const ids: number[][] = []
  for (let j = 0; j <= NY; j++) {
    ids.push([])
    for (let i = 0; i <= NX; i++) {
      const x = (i / NX * 2 - 1) * R * W
      const u = -0.3 + (u0 + R) * (j / NY)
      ids[j].push(mb.vertex(
        fr.pos.x + fr.right.x * x + fr.up.x * u, fr.pos.y + fr.right.y * x + fr.up.y * u, fr.pos.z + fr.right.z * x + fr.up.z * u,
        -fr.forward.x, -fr.forward.y, -fr.forward.z, x, u,
      ))
    }
  }
  const inside = (i: number, j: number) => {
    const x = (i / NX * 2 - 1) * R * W
    const u = -0.3 + (u0 + R) * (j / NY)
    return (x / (R * W)) ** 2 + ((u - u0) / R) ** 2 < 1.08
  }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++)
      if (inside(i, j) || inside(i + 1, j) || inside(i, j + 1) || inside(i + 1, j + 1)) {
        mb.face(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1])
        mb.face(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i])
      }
  return { builder: mb, centre: { x: fr.pos.x + fr.up.x * u0, y: fr.pos.y + fr.up.y * u0, z: fr.pos.z + fr.up.z * u0 }, s }
}
