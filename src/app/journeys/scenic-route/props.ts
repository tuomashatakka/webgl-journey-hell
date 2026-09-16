// THE SCENIC ROUTE — the props.
//
// Everything that stands beside the road and is not the land itself: the
// fence, telegraph poles and their wires, hay bales, one farmhouse, trees, wind
// turbines, the piers under the downtown deck. Each kind is one unit mesh drawn
// instanced (position, yaw, scale, seed, sway) — except the things that must
// follow the ground continuously: the fence and the wires are single strip
// meshes in world space, so a rail meets its posts at both ends whatever the
// slope, and the house is built in place on the terrain it stands on.
//
// Two sets may share one instance list (trunk + canopy, tower + rotor) so the
// pairs stay together. Every placement is filtered against the whole route in
// three dimensions: nothing stands where any road passes through it.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { levelFrame, newFrame } from '@/lib/sweep'
import { lookAt, SECTION_COUNT } from './course'
import type { LookParams, Route } from './course'
import { buildSpineIndex, spineHits, terrainHeight } from './geometry'
import type { SpineIndex } from './geometry'
import { ROCK_START, tubeRadius } from './maw'


export const PROP_FLOATS = 8

/** Material ids, mirrored by the `uMaterial` branch in propFrag. */
export const MAT = {
  WOOD:      0,
  CREOSOTE:  1,
  HAY:       2,
  BARN_WALL: 3,
  BARN_ROOF: 4,
  CANOPY:    5,
  TRUNK:     6,
  TURBINE:   7,
  STEEL:     8,
  CONCRETE:  9,
  GLASS:     10,
  ROCK:      11,
  PAINT:     12,
} as const

export interface PropSet {
  name:      string;
  builder:   MeshBuilder;
  material:  number;
  instances: Float32Array;
  count:     number;

  /** Drawn without face culling (canopy lobes, thin bars). */
  twoSided: boolean;

  /** Angular speed about the unit's local z, rad/s; 0 for a still thing. */
  spin: number;
}

/** Road half width plus the verge: how close to a spine anything may stand. */
const ROAD_CLEAR = 3.2 + 1.0

function hash (n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

class Instances {
  data: number[] = []

  /** `ys` > 0 stretches the unit's height to that many metres (piers). */
  add (x: number, y: number, z: number, yaw: number, scale = 1, seed = 0, sway = 0, ys = 0): void {
    this.data.push(x, y, z, yaw, scale, seed, sway, ys)
  }

  get count (): number {
    return this.data.length / PROP_FLOATS
  }

  pack (): Float32Array {
    return new Float32Array(this.data)
  }

  /** One identity instance: for a mesh already built in world space. */
  static world (): Instances {
    const i = new Instances()
    i.add(0, 0, 0, 0, 1, 0, 0)
    return i
  }

  /** Drop every instance whose footprint any road passes through. */
  clear (all: SpineIndex, radius: number, height: number): Instances {
    const out = new Instances()
    for (let o = 0; o < this.data.length; o += PROP_FLOATS) {
      const sc = this.data[o + 4]
      const y  = this.data[o + 1]
      if (!spineHits(all, this.data[o], this.data[o + 2], radius * sc + ROAD_CLEAR, y - 2, y + height * sc))
        out.data.push(...this.data.slice(o, o + PROP_FLOATS))
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// mesh helpers
// ---------------------------------------------------------------------------

type V3 = [ number, number, number ]

/** A quad with a flat normal from its winding, uv 0..1. */
function quadN (b: MeshBuilder, p0: V3, p1: V3, p2: V3, p3: V3): void {
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
function boxOf (b: MeshBuilder, P: (x: number, y: number, z: number) => V3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  quadN(b, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)) // +z
  quadN(b, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)) // -z
  quadN(b, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)) // +x
  quadN(b, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)) // -x
  quadN(b, P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)) // +y
  quadN(b, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)) // -y
}

/** A box, optionally rotated about z by `rz` around the origin, then translated. */
function boxT (
  b: MeshBuilder, cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number, rz = 0,
): void {
  const c = Math.cos(rz)
  const s = Math.sin(rz)
  boxOf(b, (x, y, z) => [ cx + x * c - y * s, cy + x * s + y * c, cz + z ], -hx, hx, -hy, hy, -hz, hz)
}

/** A square-section bar between two points in world space. */
function bar (b: MeshBuilder, p: V3, q: V3, half: number): void {
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
function cylinderX (
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
function taperY (b: MeshBuilder, r0: number, r1: number, h: number, segs: number): void {
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
function lobe (
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

// ---------------------------------------------------------------------------
// the units
// ---------------------------------------------------------------------------

/** A unit stalactite: a ring at the origin, a waist, the tip a metre down. */
function stalactite (): MeshBuilder {
  const b               = createMeshBuilder()
  const segs            = 8
  const rim: number[]   = []
  const waist: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a  = i / segs * Math.PI * 2
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    const j  = 0.85 + 0.3 * hash(i * 7.3)
    rim.push(b.vertex(nx * 0.26 * j, 0, nz * 0.26 * j, nx, 0.3, nz, i / segs, 0))
    waist.push(b.vertex(nx * 0.15 * j, -0.45, nz * 0.15 * j, nx, 0.2, nz, i / segs, 0.5))
  }

  const tip = b.vertex(0, -1, 0, 0, -1, 0, 0.5, 1)
  for (let i = 0; i < segs; i++) {
    b.face(rim[i], waist[i], waist[i + 1])
    b.face(rim[i], waist[i + 1], rim[i + 1])
    b.face(waist[i], tip, waist[i + 1])
  }
  return b
}

function telegraphPole (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 4.2, 0, 0.11, 4.2, 0.11)
  boxT(b, 0, 7.9, 0, 0.9, 0.05, 0.05)
  boxT(b, 0, 7.3, 0, 0.9, 0.05, 0.05)
  // Insulators on the arms.
  for (const x of [ -0.8, -0.4, 0.4, 0.8 ]) {
    boxT(b, x, 8.05, 0, 0.04, 0.1, 0.04)
    boxT(b, x, 7.45, 0, 0.04, 0.1, 0.04)
  }
  return b
}

function hayBale (): MeshBuilder {
  const b = createMeshBuilder()
  cylinderX(b, 0, 0.8, 0, 0.8, 0.65, 14)
  return b
}

/** Trunk, then three boughs up into the lobes. */
function trunk (): MeshBuilder {
  const b = createMeshBuilder()
  taperY(b, 0.28, 0.15, 4.8, 9)
  bar(b, [ 0, 3.6, 0 ], [ 1.5, 5.8, 0.9 ], 0.07)
  bar(b, [ 0, 3.9, 0 ], [ -1.4, 6.1, -1.0 ], 0.07)
  bar(b, [ 0, 4.4, 0 ], [ 0.3, 8.0, -0.4 ], 0.06)
  return b
}

/** Four lobes: a broad middle, two shoulders, a crown. */
function canopy (): MeshBuilder {
  const b = createMeshBuilder()
  lobe(b, 0, 6.6, 0, 3.0, 2.5, 3.0, 1)
  lobe(b, 1.6, 5.7, 0.9, 2.1, 1.8, 2.1, 2)
  lobe(b, -1.5, 6.0, -1.1, 2.2, 1.9, 2.2, 3)
  lobe(b, 0.3, 8.3, -0.4, 1.8, 1.5, 1.8, 4)
  return b
}

const HUB_Y = 62
const HUB_Z = 2.4

function turbineTower (): MeshBuilder {
  const b = createMeshBuilder()
  taperY(b, 2.1, 1.15, HUB_Y, 14)
  boxT(b, 0, HUB_Y, -1.2, 1.5, 1.5, 3.4)
  return b
}

/** A unit-height column; the instance stretches it to the deck. */
function pier (): MeshBuilder {
  const b = createMeshBuilder()
  taperY(b, 1.35, 1.05, 1, 12)
  boxT(b, 0, 1, 0, 3.0, 0.02, 1.4)
  return b
}

/**
 * Three blades radiating from the hub at the origin: a tapered prism from the
 * root ring out to the tip, rotated about the origin, so the spin in the
 * vertex shader (about local z) turns them about their centre.
 */
function turbineRotor (): MeshBuilder {
  const b     = createMeshBuilder()
  const blade = (a: number) => {
    const c = Math.cos(a)
    const s = Math.sin(a)
    const P = (x: number, y: number, z: number): V3 => [ x * c - y * s, x * s + y * c, z ]
    // Root at r 1.0, chord 1.2, thick 0.32; tip at r 14.5, chord 0.35, thick 0.08.
    const root  = 1.0
    const tip   = 14.5
    const w     = (y: number) => 0.6 + (0.175 - 0.6) * (y - root) / (tip - root)
    const t     = (y: number) => 0.16 + (0.04 - 0.16) * (y - root) / (tip - root)
    const cornr = (sx: number, y: number, sz: number): V3 => P(sx * w(y), y, sz * t(y))
    quadN(b, cornr(-1, root, 1), cornr(1, root, 1), cornr(1, tip, 1), cornr(-1, tip, 1))
    quadN(b, cornr(1, root, -1), cornr(-1, root, -1), cornr(-1, tip, -1), cornr(1, tip, -1))
    quadN(b, cornr(1, root, 1), cornr(1, root, -1), cornr(1, tip, -1), cornr(1, tip, 1))
    quadN(b, cornr(-1, root, -1), cornr(-1, root, 1), cornr(-1, tip, 1), cornr(-1, tip, -1))
    quadN(b, cornr(-1, tip, 1), cornr(1, tip, 1), cornr(1, tip, -1), cornr(-1, tip, -1))
  }
  // The hub: a short drum on the spin axis with a nose.
  const segs = 14
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2
    const a1 = (i + 1) / segs * Math.PI * 2
    const r  = 1.15
    quadN(b, [ Math.cos(a0) * r, Math.sin(a0) * r, -0.9 ], [ Math.cos(a1) * r, Math.sin(a1) * r, -0.9 ],
          [ Math.cos(a1) * r, Math.sin(a1) * r, 0.7 ], [ Math.cos(a0) * r, Math.sin(a0) * r, 0.7 ])
    quadN(b, [ Math.cos(a0) * r, Math.sin(a0) * r, 0.7 ], [ Math.cos(a1) * r, Math.sin(a1) * r, 0.7 ],
          [ Math.cos(a1) * 0.2, Math.sin(a1) * 0.2, 1.6 ], [ Math.cos(a0) * 0.2, Math.sin(a0) * 0.2, 1.6 ])
  }
  for (let i = 0; i < 3; i++)
    blade(i * Math.PI * 2 / 3)
  return b
}

// ---------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------

/** Yaw that turns a unit's local +z onto the world heading (fx, fz). */
function yawOf (fx: number, fz: number): number {
  return Math.atan2(-fx, fz)
}

interface Placer {
  route: Route;
  idx:   SpineIndex;
  frame: ReturnType<typeof newFrame>;
  w:     Float32Array;
  look:  LookParams;
}

/** World position `r` metres to the right of the spine at `s`, on the ground. */
function beside (pl: Placer, s: number, r: number, out: V3): V3 {
  const f = levelFrame(pl.route.curve, s, pl.frame)
  out[0]  = f.pos.x + f.right.x * r
  out[2]  = f.pos.z + f.right.z * r
  out[1]  = terrainHeight(pl.idx, out[0], out[2])
  return out
}

function halfAt (pl: Placer, s: number): number {
  lookAt(pl.route, s, pl.w, pl.look)
  return pl.look.roadHalf
}

function gentle (pl: Placer, x: number, y: number, z: number, tol: number): boolean {
  return Math.abs(terrainHeight(pl.idx, x + 2.5, z) - y) < tol &&
    Math.abs(terrainHeight(pl.idx, x, z + 2.5) - y) < tol
}

/**
 * The fence as one strip: a post in the ground every 2.5 m and two rails from
 * each post to the next, so the rails meet at every post whatever the slope.
 * Posts that would stand in a crossing road are skipped, and the rails with them.
 */
function fenceStrip (pl: Placer, all: SpineIndex, s0: number, s1: number, side: number): MeshBuilder {
  const b     = createMeshBuilder()
  const p: V3 = [ 0, 0, 0 ]
  let prev: V3 | null = null
  for (let s = s0; s < s1; s += 2.5) {
    const hw = halfAt(pl, s)
    beside(pl, s, side * (hw + 3.8), p)
    if (spineHits(all, p[0], p[2], ROAD_CLEAR, p[1] - 2, p[1] + 2)) {
      prev = null
      continue
    }

    const post: V3 = [ p[0], p[1] - 0.1, p[2] ]
    boxT(b, post[0], post[1] + 0.6, post[2], 0.06, 0.65, 0.06)
    if (prev) {
      const lean = 0.02 * (hash(s) - 0.5)
      bar(b, [ prev[0], prev[1] + 1.02 + lean, prev[2] ], [ post[0], post[1] + 1.02 - lean, post[2] ], 0.035)
      bar(b, [ prev[0], prev[1] + 0.58, prev[2] ], [ post[0], post[1] + 0.58, post[2] ], 0.035)
    }
    prev = post
  }
  return b
}

/**
 * Wires between consecutive poles: two per arm, sagging 0.7 m in the middle
 * in six straight pieces each. The arm ends are where the vertex shader puts
 * the pole's local x after its yaw.
 */
function wireStrip (poles: Instances): MeshBuilder {
  const b = createMeshBuilder()
  const d = poles.data
  for (let i = PROP_FLOATS; i < d.length; i += PROP_FLOATS) {
    const a  = i - PROP_FLOATS
    const ya = d[a + 3]
    const yb = d[i + 3]
    for (const [ arm, y ] of [[ 0.8, 8.05 ], [ -0.8, 8.05 ], [ 0.4, 7.45 ], [ -0.4, 7.45 ]]) {
      const p0: V3 = [ d[a] + arm * Math.cos(ya), d[a + 1] + y, d[a + 2] - arm * Math.sin(ya) ]
      const p1: V3 = [ d[i] + arm * Math.cos(yb), d[i + 1] + y, d[i + 2] - arm * Math.sin(yb) ]
      let prev: V3 = p0
      for (let k = 1; k <= 6; k++) {
        const t     = k / 6
        const sag   = 0.7 * 4 * t * (1 - t)
        const q: V3 = [ p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag, p0[2] + (p1[2] - p0[2]) * t ]
        bar(b, prev, q, 0.018)
        prev = q
      }
    }
  }
  return b
}

interface House {
  wall:   MeshBuilder;
  roof:   MeshBuilder;
  trim:   MeshBuilder;
  dark:   MeshBuilder;
  glass:  MeshBuilder;
  plinth: MeshBuilder;
}

/**
 * The farmhouse, built in place: the floor sits at the highest of its four
 * corners and a stone plinth reaches down to the lowest, so no wall floats
 * and none is buried. Timber walls, a metal roof with an overhang, white
 * trim, a barn door in the road-facing gable, windows along the sides.
 */
function house (pl: Placer, X: number, Z: number, yaw: number): House {
  const c   = Math.cos(yaw)
  const s   = Math.sin(yaw)
  const HX  = 4.2
  const HZ  = 6.5
  const T   = (x: number, y: number, z: number): V3 => [ X + x * c + z * s, y, Z - x * s + z * c ]
  const gnd = (x: number, z: number) => {
    const p = T(x, 0, z)
    return terrainHeight(pl.idx, p[0], p[2])
  }
  const corners = [ gnd(-HX, -HZ), gnd(HX, -HZ), gnd(HX, HZ), gnd(-HX, HZ), gnd(0, 0) ]
  const floor   = Math.max(...corners) + 0.12
  const low     = Math.min(...corners) - 0.9

  const wall   = createMeshBuilder()
  const roof   = createMeshBuilder()
  const trim   = createMeshBuilder()
  const dark   = createMeshBuilder()
  const glass  = createMeshBuilder()
  const plinth = createMeshBuilder()
  const box    = (b: MeshBuilder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    boxOf(b, T, x0, x1, y0, y1, z0, z1)

  // Plinth and floor slab.
  box(plinth, -HX - 0.18, HX + 0.18, low, floor + 0.05, -HZ - 0.18, HZ + 0.18)

  // Walls to the eaves, then the gables as flat triangles.
  const EAVE  = floor + 4.4
  const RIDGE = floor + 7.1
  box(wall, -HX, HX, floor, EAVE, -HZ, HZ)
  for (const [ z, flip ] of [[ HZ, false ], [ -HZ, true ]] as const) {
    const p0  = T(-HX, EAVE, z)
    const p1  = T(HX, EAVE, z)
    const p2  = T(0, RIDGE, z)
    const nz  = flip ? -1 : 1
    const n   = T(0, 0, nz)
    const nx  = n[0] - X
    const nzz = n[2] - Z
    const a   = wall.vertex(p0[0], p0[1], p0[2], nx, 0, nzz, 0, 0)
    const bb  = wall.vertex(p1[0], p1[1], p1[2], nx, 0, nzz, 1, 0)
    const d   = wall.vertex(p2[0], p2[1], p2[2], nx, 0, nzz, 0.5, 1)
    if (flip)
      wall.face(a, d, bb)
    else
      wall.face(a, bb, d)
  }

  // Roof: two slopes with a half-metre overhang, both faces, and a ridge cap.
  const OV = 0.55
  quadN(roof, T(-HX - OV, EAVE - 0.3, HZ + OV), T(0, RIDGE + 0.05, HZ + OV), T(0, RIDGE + 0.05, -HZ - OV), T(-HX - OV, EAVE - 0.3, -HZ - OV))
  quadN(roof, T(0, RIDGE + 0.05, HZ + OV), T(HX + OV, EAVE - 0.3, HZ + OV), T(HX + OV, EAVE - 0.3, -HZ - OV), T(0, RIDGE + 0.05, -HZ - OV))
  quadN(roof, T(-HX - OV, EAVE - 0.34, -HZ - OV), T(0, RIDGE + 0.01, -HZ - OV), T(0, RIDGE + 0.01, HZ + OV), T(-HX - OV, EAVE - 0.34, HZ + OV))
  quadN(roof, T(0, RIDGE + 0.01, -HZ - OV), T(HX + OV, EAVE - 0.34, -HZ - OV), T(HX + OV, EAVE - 0.34, HZ + OV), T(0, RIDGE + 0.01, HZ + OV))
  bar(roof, T(0, RIDGE + 0.1, HZ + OV), T(0, RIDGE + 0.1, -HZ - OV), 0.09)
  // Trim: corner boards, eave boards, gable boards.
  for (const [ x, z ] of [[ -HX, -HZ ], [ HX, -HZ ], [ HX, HZ ], [ -HX, HZ ]])
    bar(trim, T(x, floor, z), T(x, EAVE, z), 0.09)
  for (const x of [ -HX, HX ])
    bar(trim, T(x, EAVE, -HZ - OV + 0.1), T(x, EAVE, HZ + OV - 0.1), 0.08)
  for (const z of [ -HZ, HZ ]) {
    bar(trim, T(-HX - OV, EAVE - 0.3, z), T(0, RIDGE, z), 0.07)
    bar(trim, T(0, RIDGE, z), T(HX + OV, EAVE - 0.3, z), 0.07)
  }
  // The barn door on the +z gable: a dark recess in a white frame with a
  // cross brace; a man door on the other gable.
  const door = (z: number, hw: number, h: number, dx: number) => {
    const out = z > 0 ? 0.03 : -0.03
    quadN(dark, T(dx - hw, floor, z + out), T(dx + hw, floor, z + out), T(dx + hw, floor + h, z + out), T(dx - hw, floor + h, z + out))
    if (z < 0)
      quadN(dark, T(dx + hw, floor, z + out), T(dx - hw, floor, z + out), T(dx - hw, floor + h, z + out), T(dx + hw, floor + h, z + out))
    bar(trim, T(dx - hw - 0.08, floor, z + out * 2), T(dx - hw - 0.08, floor + h + 0.1, z + out * 2), 0.07)
    bar(trim, T(dx + hw + 0.08, floor, z + out * 2), T(dx + hw + 0.08, floor + h + 0.1, z + out * 2), 0.07)
    bar(trim, T(dx - hw - 0.12, floor + h + 0.1, z + out * 2), T(dx + hw + 0.12, floor + h + 0.1, z + out * 2), 0.07)
    if (hw > 1) {
      bar(dark, T(dx - hw, floor + 0.2, z + out * 2), T(dx + hw, floor + h - 0.2, z + out * 2), 0.05)
      bar(dark, T(dx - hw, floor + h - 0.2, z + out * 2), T(dx + hw, floor + 0.2, z + out * 2), 0.05)
    }
  }
  door(HZ, 1.3, 3.2, 0.4)
  door(-HZ, 0.5, 2.1, -1.6)

  // Windows: two a side, one in each gable, glass in a white frame with a sill.
  const window = (x: number, y: number, z: number, hw: number, hh: number, axis: 'x' | 'z', sign: number) => {
    const o  = 0.03 * sign
    const P  = (a: number, bb: number): V3 => axis === 'x' ? T(x + o, y + bb, z + a) : T(x + a, y + bb, z + o)
    const q0 = P(-hw, -hh)
    const q1 = P(hw, -hh)
    const q2 = P(hw, hh)
    const q3 = P(-hw, hh)
    if (axis === 'x' === sign > 0)
      quadN(glass, q0, q1, q2, q3)
    else
      quadN(glass, q1, q0, q3, q2)

    const F = (a: number, bb: number): V3 => axis === 'x' ? T(x + o * 2, y + bb, z + a) : T(x + a, y + bb, z + o * 2)
    bar(trim, F(-hw - 0.06, -hh - 0.06), F(hw + 0.06, -hh - 0.06), 0.06)
    bar(trim, F(-hw - 0.06, hh + 0.06), F(hw + 0.06, hh + 0.06), 0.06)
    bar(trim, F(-hw - 0.06, -hh), F(-hw - 0.06, hh), 0.05)
    bar(trim, F(hw + 0.06, -hh), F(hw + 0.06, hh), 0.05)
    bar(trim, F(0, -hh), F(0, hh), 0.03)
    bar(trim, F(-hw, 0), F(hw, 0), 0.03)
  }
  for (const z of [ -3.2, 0.2, 3.6 ]) {
    window(HX, floor + 2.3, z, 0.55, 0.65, 'x', 1)
    window(-HX, floor + 2.3, z, 0.55, 0.65, 'x', -1)
  }
  window(-1.9, floor + 5.6, HZ, 0.45, 0.55, 'z', 1)
  window(1.6, floor + 5.6, -HZ, 0.45, 0.55, 'z', -1)
  return { wall, roof, trim, dark, glass, plinth }
}

export function buildProps (route: Route, idx: SpineIndex): PropSet[] {
  const pl: Placer = {
    route,
    idx,
    frame: newFrame(),
    w:     new Float32Array(SECTION_COUNT),
    look:  { exposure: 0, sky: 1, fog: [ 0, 0, 0 ], fogDensity: 0, roadHalf: 3, surface: 0 },
  }
  const county  = route.spans[0]
  const incline = route.spans[1]
  const coast   = route.spans[3]
  const p: V3   = [ 0, 0, 0 ]
  // Every road that could pass through something: the ground and the deck.
  const all   = buildSpineIndex(route, [ 0, 1, 2, 3, 4 ], 32)
  const roads = buildSpineIndex(route, [ 1, 2, 3 ], 32)

  // The fence on the plain side, one strip following the road.
  const fence = fenceStrip(pl, all, county.s0 + 20, county.s1 - 30, 1)

  // Poles on the hill side, into the incline, and the wires between them.
  let poles = new Instances()
  for (let s = county.s0 + 8; s < incline.s1 - 40; s += 42) {
    const hw = halfAt(pl, s)
    beside(pl, s, -(hw + 4.6), p)

    const f = pl.frame
    poles.add(p[0], p[1] - 0.1, p[2], yawOf(f.forward.x, f.forward.z) + Math.PI / 2, 1, hash(s * 3), 0)
  }
  poles = poles.clear(all, 0.9, 8.4)

  const wires = wireStrip(poles)

  // Bales, scattered on flat ground off the plain side.
  let bales = new Instances()
  for (let i = 0; i < 44; i++) {
    const s  = county.s0 + hash(i * 7 + 1) * (county.s1 - county.s0)
    const hw = halfAt(pl, s)
    const r  = (hw + 12 + hash(i * 7 + 2) * 70) * (hash(i * 7 + 5) < 0.7 ? 1 : -1)
    beside(pl, s, r, p)
    if (gentle(pl, p[0], p[1], p[2], 0.7))
      bales.add(p[0], p[1], p[2], hash(i * 7 + 3) * Math.PI, 0.9 + hash(i * 7 + 4) * 0.25, hash(i), 0)
  }
  bales = bales.clear(all, 0.9, 1.7)

  // Trees: clusters on both sides of the county road, a stand on the incline,
  // a wind-bent few on the coast.
  let trees     = new Instances()
  const cluster = (s: number, r: number, n: number, seed: number, radius: number, minOff: number) => {
    for (let k = 0; k < n; k++) {
      const a  = hash(seed + k * 3) * Math.PI * 2
      const d  = Math.sqrt(hash(seed + k * 3 + 1)) * radius
      const ss = s + Math.cos(a) * d
      const rr = r + Math.sin(a) * d
      const hw = halfAt(pl, ss)
      if (Math.abs(rr) < hw + minOff)
        continue
      beside(pl, ss, rr, p)

      const scale = 0.75 + hash(seed + k * 3 + 2) * 0.6
      trees.add(p[0], p[1] - 0.2, p[2], hash(seed + k) * Math.PI * 2, scale, hash(seed + k * 11), 1)
    }
  }
  for (let c = 0; c < 6; c++) {
    const s = county.s0 + 40 + hash(c * 13 + 100) * (county.s1 - county.s0 - 80)
    const r = (20 + hash(c * 13 + 101) * 110) * (c % 2 === 0 ? 1 : -1)
    cluster(s, r, 10 + Math.floor(hash(c * 13 + 102) * 14), c * 977, 28, 9)
  }
  cluster(incline.s0 + 120, 34, 26, 5000, 55, 12)
  cluster(incline.s0 + 300, -30, 18, 6000, 40, 12)
  cluster(coast.s0 + 90, 26, 9, 7000, 30, 8)
  cluster(coast.s0 + 230, 22, 7, 8000, 24, 8)
  trees = trees.clear(all, 3.2, 10)

  // The farmhouse, on the hill side, turned a little off the road.
  const farm = (() => {
    const s  = county.s0 + (county.s1 - county.s0) * 0.58
    const hw = halfAt(pl, s)
    beside(pl, s, -(hw + 40), p)

    const f = pl.frame
    return house(pl, p[0], p[2], yawOf(f.forward.x, f.forward.z) + 0.35)
  })()

  // Turbines along the ridge. Tower and rotor share positions; the rotor's
  // instance sits at the hub, its spin phase in the seed.
  const towers = new Instances()
  const rotors = new Instances()
  for (let i = 0; i < 7; i++) {
    const x   = 296 + hash(i * 31 + 7) * 40
    const z   = 40 + i * 74 + hash(i * 31 + 8) * 20
    const y   = terrainHeight(idx, x, z)
    const yaw = -0.55 + hash(i * 31 + 9) * 0.2
    if (spineHits(all, x, z, 16, y - 2, y + HUB_Y + 16))
      continue
    towers.add(x, y - 0.5, z, yaw, 1, hash(i), 0)
    rotors.add(x - Math.sin(yaw) * HUB_Z, y - 0.5 + HUB_Y, z + Math.cos(yaw) * HUB_Z, yaw, 1, hash(i * 5), 0)
  }

  // Piers under the elevated downtown road, wherever it is off the ground and
  // no lower turn of the helix passes beneath: a column through a road deck
  // is not a pier.
  const piers = new Instances()
  {
    const span = route.spans[2]
    for (let s = span.s0 + 10; s < span.s1 - 6; s += 21) {
      const f      = levelFrame(route.curve, s, pl.frame)
      const ground = terrainHeight(idx, f.pos.x, f.pos.z)
      const height = f.pos.y - 0.7 - ground
      if (height > 2.5 && !spineHits(roads, f.pos.x, f.pos.z, 6, ground - 2, f.pos.y - 2, s))
        piers.add(f.pos.x, ground - 0.4, f.pos.z, yawOf(f.forward.x, f.forward.z), 1, hash(s), 0, height + 0.4)
    }
  }

  // Stalactites from the cave vault: on the rock part of the tube, hung from
  // the upper third of the ring, embedded a little so the root is in the rock.
  const drips = new Instances()
  {
    const g  = route.spans[5]
    const u  = route.spans[6]
    const s0 = g.s0 + ROCK_START * 0.9
    for (let s = s0; s < u.s1 - 70; s += 4) {
      const n = 1 + Math.floor(hash(s * 1.7) * 2.6)
      for (let k = 0; k < n; k++) {
        const a  = Math.PI * (0.3 + 0.4 * hash(s * 3.1 + k * 17)) // top of the ring
        const R  = tubeRadius(s - g.s0, s)
        const r  = Math.cos(a) * R * 1.15
        const uu = Math.sin(a) * R + 0.42 * R - 0.4
        const f  = levelFrame(route.curve, s, pl.frame)
        const sc = 1.2 + hash(s * 5.3 + k) * 4.5
        drips.add(
          f.pos.x + f.right.x * r + f.up.x * uu, f.pos.y + f.right.y * r + f.up.y * uu,
          f.pos.z + f.right.z * r + f.up.z * uu, hash(s + k) * Math.PI * 2, sc, hash(s * 0.7 + k), 0,
        )
      }
    }
  }

  const set = (
    name: string, builder: MeshBuilder, material: number, inst: Instances,
    twoSided = false, spin = 0,
  ): PropSet => ({
    name,
    builder,
    material,
    instances: inst.pack(),
    count:     inst.count,
    twoSided,
    spin,
  })

  return [
    set('fence', fence, MAT.WOOD, Instances.world(), true),
    set('poles', telegraphPole(), MAT.CREOSOTE, poles),
    set('wires', wires, MAT.CREOSOTE, Instances.world(), true),
    set('bales', hayBale(), MAT.HAY, bales),
    set('house-plinth', farm.plinth, MAT.CONCRETE, Instances.world()),
    set('house-wall', farm.wall, MAT.BARN_WALL, Instances.world()),
    set('house-roof', farm.roof, MAT.BARN_ROOF, Instances.world()),
    set('house-trim', farm.trim, MAT.PAINT, Instances.world(), true),
    set('house-dark', farm.dark, MAT.CREOSOTE, Instances.world(), true),
    set('house-glass', farm.glass, MAT.GLASS, Instances.world(), true),
    set('trunks', trunk(), MAT.TRUNK, trees, true),
    set('canopies', canopy(), MAT.CANOPY, trees, true),
    set('towers', turbineTower(), MAT.TURBINE, towers),
    set('rotors', turbineRotor(), MAT.TURBINE, rotors, true, 1.35),
    set('piers', pier(), MAT.CONCRETE, piers),
    set('stalactites', stalactite(), MAT.ROCK, drips),
  ]
}
