// THE SCENIC ROUTE — the props.
//
// Everything that stands beside the road and is not the land itself: fence
// panels, telegraph poles, hay bales, one barn, trees, wind turbines. Each kind
// is a unit mesh built once here and instanced; placement is deterministic from
// hashed seeds so a ?t= shot is the same picture every time.
//
// Units are authored y-up with their origin at the ground and their "front"
// along +z; the instance carries position, yaw, scale, seed and a sway weight.
// Two sets may share one instance list (trunk + canopy, tower + rotor) so the
// parts of a thing never drift apart.

import { createMeshBuilder } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { levelFrame, newFrame } from '@/lib/sweep'
import { lookAt, SECTION_COUNT } from './course'
import type { LookParams, Route } from './course'
import { buildSpineIndex, spineHits, terrainHeight } from './geometry'
import type { SpineIndex } from './geometry'


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
} as const

export interface PropSet {
  name:      string;
  builder:   MeshBuilder;
  material:  number;
  instances: Float32Array;
  count:     number;

  /** Drawn without face culling (canopy quads). */
  twoSided: boolean;

  /** Angular speed about the unit's local z, rad/s; 0 for a still thing. */
  spin: number;
}

// ---------------------------------------------------------------------------
// deterministic randomness
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// unit mesh helpers — explicit normals and uvs through vertex()/face()
// ---------------------------------------------------------------------------

type V3 = [ number, number, number ]

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
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l
  ny /= l
  nz /= l

  const a = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0)
  const c = b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0)
  const d = b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1)
  const e = b.vertex(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1)
  b.face(a, c, d)
  b.face(a, d, e)
}

/** A box, optionally rotated about z by `rz`, then translated to its centre. */
function boxT (
  b: MeshBuilder, cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number, rz = 0,
): void {
  const c = Math.cos(rz)
  const s = Math.sin(rz)
  const P = (x: number, y: number, z: number): V3 =>
    [ cx + x * c - y * s, cy + x * s + y * c, cz + z ]
  const x0 = -hx
  const x1 = hx
  const y0 = -hy
  const y1 = hy
  const z0 = -hz
  const z1 = hz
  quadN(b, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)) // +z
  quadN(b, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)) // -z
  quadN(b, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)) // +x
  quadN(b, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)) // -x
  quadN(b, P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)) // +y
  quadN(b, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)) // -y
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

// ---------------------------------------------------------------------------
// the units
// ---------------------------------------------------------------------------

function fencePanel (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 0.55, 0, 0.05, 0.55, 0.05)
  boxT(b, 0, 0.92, 1.25, 0.02, 0.05, 1.25)
  boxT(b, 0, 0.52, 1.25, 0.02, 0.05, 1.25)
  return b
}

function telegraphPole (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 4.2, 0, 0.11, 4.2, 0.11)
  boxT(b, 0, 7.9, 0, 0.9, 0.05, 0.05)
  boxT(b, 0, 7.3, 0, 0.9, 0.05, 0.05)
  return b
}

function hayBale (): MeshBuilder {
  const b = createMeshBuilder()
  cylinderX(b, 0, 0.8, 0, 0.8, 0.65, 14)
  return b
}

function barnWall (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 2.3, 0, 4.2, 2.3, 6.5)

  // Gable triangles, as thin boxes would be wrong: two flat faces.
  const g = (z: number, flip: boolean) => {
    const p0: V3 = [ -4.2, 4.6, z ]
    const p1: V3 = [ 4.2, 4.6, z ]
    const p2: V3 = [ 0, 7.0, z ]
    const n      = flip ? -1 : 1
    const a      = b.vertex(p0[0], p0[1], p0[2], 0, 0, n, 0, 0)
    const c      = b.vertex(p1[0], p1[1], p1[2], 0, 0, n, 1, 0)
    const d      = b.vertex(p2[0], p2[1], p2[2], 0, 0, n, 0.5, 1)
    if (flip)
      b.face(a, d, c)
    else
      b.face(a, c, d)
  }
  g(6.5, false)
  g(-6.5, true)
  return b
}

function barnRoof (): MeshBuilder {
  const b = createMeshBuilder()
  quadN(b, [ -4.6, 4.5, 6.9 ], [ 0, 7.05, 6.9 ], [ 0, 7.05, -6.9 ], [ -4.6, 4.5, -6.9 ])
  quadN(b, [ 0, 7.05, 6.9 ], [ 4.6, 4.5, 6.9 ], [ 4.6, 4.5, -6.9 ], [ 0, 7.05, -6.9 ])
  return b
}

function canopy (): MeshBuilder {
  const b  = createMeshBuilder()
  const y0 = 2.2
  const y1 = 9.6
  const hw = 3.6
  const a  = b.vertex(-hw, y0, 0, 0, 0, 1, 0, 0)
  const c  = b.vertex(hw, y0, 0, 0, 0, 1, 1, 0)
  const d  = b.vertex(hw, y1, 0, 0, 0, 1, 1, 1)
  const e  = b.vertex(-hw, y1, 0, 0, 0, 1, 0, 1)
  b.face(a, c, d)
  b.face(a, d, e)

  const f = b.vertex(0, y0, -hw, 1, 0, 0, 0, 0)
  const g = b.vertex(0, y0, hw, 1, 0, 0, 1, 0)
  const h = b.vertex(0, y1, hw, 1, 0, 0, 1, 1)
  const i = b.vertex(0, y1, -hw, 1, 0, 0, 0, 1)
  b.face(f, g, h)
  b.face(f, h, i)
  return b
}

function trunk (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 1.7, 0, 0.2, 1.7, 0.2)
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
  return b
}

function turbineRotor (): MeshBuilder {
  const b = createMeshBuilder()
  boxT(b, 0, 0, 0, 1.1, 1.1, 0.9)
  for (let i = 0; i < 3; i++)
    boxT(b, 0, 15, 0, 0.75, 13.5, 0.22, i * Math.PI * 2 / 3)
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

  // Fence on the plain side, panel by panel, following the road.
  const fence = new Instances()
  for (let s = county.s0 + 20; s < county.s1 - 30; s += 2.5) {
    const hw = halfAt(pl, s)
    beside(pl, s, hw + 3.8, p)

    const f = pl.frame
    fence.add(p[0], p[1] - 0.05, p[2], yawOf(f.forward.x, f.forward.z), 1, hash(s), 0)
  }

  // Poles on the hill side, into the incline.
  const poles = new Instances()
  for (let s = county.s0 + 8; s < incline.s1 - 40; s += 42) {
    const hw = halfAt(pl, s)
    beside(pl, s, -(hw + 4.6), p)

    const f = pl.frame
    poles.add(p[0], p[1] - 0.1, p[2], yawOf(f.forward.x, f.forward.z) + Math.PI / 2, 1, hash(s * 3), 0)
  }

  // Bales, scattered on flat ground off the plain side.
  const bales = new Instances()
  for (let i = 0; i < 44; i++) {
    const s  = county.s0 + hash(i * 7 + 1) * (county.s1 - county.s0)
    const hw = halfAt(pl, s)
    const r  = (hw + 12 + hash(i * 7 + 2) * 70) * (hash(i * 7 + 5) < 0.7 ? 1 : -1)
    beside(pl, s, r, p)
    if (gentle(pl, p[0], p[1], p[2], 0.7))
      bales.add(p[0], p[1], p[2], hash(i * 7 + 3) * Math.PI, 0.9 + hash(i * 7 + 4) * 0.25, hash(i), 0)
  }

  // Trees: clusters on both sides of the county road, a stand on the incline,
  // a wind-bent few on the coast.
  const trees   = new Instances()
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

  // The barn, on the hill side, turned a little off the road.
  const barn = new Instances()
  {
    const s  = county.s0 + (county.s1 - county.s0) * 0.58
    const hw = halfAt(pl, s)
    beside(pl, s, -(hw + 40), p)

    const f = pl.frame
    barn.add(p[0], p[1] - 0.3, p[2], yawOf(f.forward.x, f.forward.z) + 0.35, 1, 0, 0)
  }

  // Turbines along the ridge. Tower and rotor share positions; the rotor's
  // instance sits at the hub, its spin phase in the seed.
  const towers = new Instances()
  const rotors = new Instances()
  for (let i = 0; i < 7; i++) {
    const x   = 296 + hash(i * 31 + 7) * 40
    const z   = 40 + i * 74 + hash(i * 31 + 8) * 20
    const y   = terrainHeight(idx, x, z)
    const yaw = -0.55 + hash(i * 31 + 9) * 0.2
    towers.add(x, y - 0.5, z, yaw, 1, hash(i), 0)
    rotors.add(x - Math.sin(yaw) * HUB_Z, y - 0.5 + HUB_Y, z + Math.cos(yaw) * HUB_Z, yaw, 1, hash(i * 5), 0)
  }

  // Piers under the elevated downtown road, wherever it is off the ground and
  // no lower turn of the helix passes beneath: a column through a road deck
  // is not a pier.
  const piers = new Instances()
  const roads = buildSpineIndex(route, [ 1, 2, 3 ], 32)
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

  const set = (
    name: string, builder: MeshBuilder, material: number, inst: Instances,
    twoSided = false, spin = 0,
  ): PropSet => ({
    name,
    builder,
    material,
    twoSided,
    spin,
    instances: inst.pack(),
    count:     inst.count,
  })

  return [
    set('fence', fencePanel(), MAT.WOOD, fence),
    set('poles', telegraphPole(), MAT.CREOSOTE, poles),
    set('bales', hayBale(), MAT.HAY, bales),
    set('barn-wall', barnWall(), MAT.BARN_WALL, barn),
    set('barn-roof', barnRoof(), MAT.BARN_ROOF, barn),
    set('trunks', trunk(), MAT.TRUNK, trees),
    set('canopies', canopy(), MAT.CANOPY, trees, true),
    set('towers', turbineTower(), MAT.TURBINE, towers),
    set('rotors', turbineRotor(), MAT.TURBINE, rotors, false, 1.35),
    set('piers', pier(), MAT.CONCRETE, piers),
  ]
}
