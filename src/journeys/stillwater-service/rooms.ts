// The six places the flume runs through, and the sea round them.
//
// Every room is built in world metres against the route it serves, and each
// enclosed one declares a light rig: its bounds, how open it is to the sky,
// and a grid of lamps. The shader lights from the same table the fittings are
// placed from, so a lamp that fails is dark in both.

import { hash1 } from '@wjh/math/scalar'
import { getRoute } from './route'
import type { Stage, Style } from './stage'


const SEABED = -8.4

export const RIGS: Rig[] = [
  { min: [ -15.2, 13.6, -4.2 ], max: [ 3.2, 21.2, 42 ], open: 0.55, lampY: 20, grid: [ -15, -4, 6, 6.5 ], color: [ 1, 0.86, 0.68 ], power: 34 },
  { min: [ 20, 10.6, 32 ], max: [ 56, 13.75, 60 ], open: 0.2, lampY: 13.62, grid: [ 20, 32, 3, 3.5 ], color: [ 0.9, 0.97, 1 ], power: 3.6 },
  { min: [ 14, SEABED, -66 ], max: [ 46, -1.2, -49 ], open: 0.75, lampY: -1.8, grid: [ 14, -66, 8, 8.5 ], color: [ 0.35, 0.9, 0.85 ], power: 6 },
  { min: [ -18, 0.4, -64 ], max: [ 8, 7.2, -34 ], open: 0.32, lampY: 6.6, grid: [ -18, -64, 5.2, 6 ], color: [ 0.86, 0.95, 1 ], power: 24 },
]

export const ROOM_COUNT = RIGS.length

type V3 = [number, number, number]

interface Rig {
  min:   V3;
  max:   V3;
  open:  number;
  lampY: number;
  grid:  [number, number, number, number];
  color: V3;
  power: number;
}

/** The rigs as the four vec4 arrays the shaders take. */
export function rigUniforms () {
  const pack = (fn: (rig: Rig) => number[]) => new Float32Array(RIGS.flatMap(fn))
  return {
    min:  pack(r => [ ...r.min, r.open ]),
    max:  pack(r => [ ...r.max, r.lampY ]),
    grid: pack(r => r.grid),
    lamp: pack(r => [ ...r.color, r.power ]),
  }
}

/** How enclosed the eye is, 0 in the open to 1 deep inside a room, eased at the walls. */
export function insideness (p: V3): number {
  let best = 0
  for (const rig of RIGS) {
    let m = Infinity
    for (let k = 0; k < 3; k++)
      m = Math.min(m, p[k] - rig.min[k], rig.max[k] - p[k])
    best = Math.max(best, Math.min(1, Math.max(0, (m + 0.5) / 3)) * (1 - rig.open * 0.6))
  }
  return best
}

function lamps (stage: Stage, rig: Rig, size: V3, mat: Style['mat'] = 'lamp'): void {
  const [ x0, z0, dx, dz ] = rig.grid
  const nx                 = Math.floor((rig.max[0] - x0) / dx)
  const nz                 = Math.floor((rig.max[2] - z0) / dz)
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      stage.box(mat, [ x0 + (i + 0.5) * dx, rig.lampY, z0 + (j + 0.5) * dz ], size)
}

/** Concrete piles from the sea bed up to a slab. */
function piles (stage: Stage, x0: number, x1: number, z0: number, z1: number, top: number, pitch: number): void {
  for (let x = x0; x <= x1 + 0.01; x += pitch)
    for (let z = z0; z <= z1 + 0.01; z += pitch) {
      if (flumeDistance(x, z) < 1.6)
        continue
      stage.span('concrete', [ x - 0.35, SEABED, z - 0.35 ], [ x + 0.35, top, z + 0.35 ])
      stage.span('concrete', [ x - 0.6, -0.6, z - 0.6 ], [ x + 0.6, 0.4, z + 0.6 ])
    }
}

/** Nearest distance in plan from (x, z) to the flume, sampled. */
function flumeDistance (x: number, z: number): number {
  const route = getRoute()
  const q     = { x: 0, y: 0, z: 0 }
  let best    = Infinity
  for (let s = 0; s < route.length; s += 1) {
    route.curve.pointAtDistance(s, q)
    best = Math.min(best, Math.hypot(q.x - x, q.z - z))
  }
  return best
}

/** A float rope across the pool, alternating red and white. */
function laneRope (stage: Stage, x: number, z0: number, z1: number, y: number): void {
  for (let z = z0, i = 0; z < z1; z += 0.42, i++)
    stage.bar(i % 3 === 0 ? 'white' : 'laneRed', [ x, y, z ], [ x, y, z + 0.4 ], 0.055, 6)
}

function bench (stage: Stage, x: number, y: number, z: number, along: 'x' | 'z', length: number): void {
  const half = length / 2
  for (let k = 0; k < 4; k++) {
    const off = -0.18 + k * 0.12
    if (along === 'x')
      stage.span('timber', [ x - half, y + 0.42, z + off - 0.045 ], [ x + half, y + 0.45, z + off + 0.045 ])
    else
      stage.span('timber', [ x + off - 0.045, y + 0.42, z - half ], [ x + off + 0.045, y + 0.45, z + half ])
  }
  for (const end of [ -half + 0.2, half - 0.2 ])
    if (along === 'x')
      stage.span('steel', [ x + end - 0.03, y, z - 0.22 ], [ x + end + 0.03, y + 0.42, z + 0.22 ])
    else
      stage.span('steel', [ x - 0.22, y, z + end - 0.03 ], [ x + 0.22, y + 0.42, z + end + 0.03 ])
}

export function buildPool (stage: Stage): void {
  const { span, box, bar } = stage
  const deck               = 13.95
  const water              = deck - 0.12
  // The deck round a 11 x 38 teaching pool; the pool's north end is open.
  span('deck', [ -15.2, deck - 0.35, -4.2 ], [ -13, deck, 40 ])
  span('deck', [ -13, deck - 0.35, -4.2 ], [ -2, deck, 2 ])
  span('deck', [ -2, deck - 0.35, -4.2 ], [ 3.2, deck, 42 ])
  span('poolTile', [ -13, deck - 1.45, 2 ], [ -2, deck - 1.15, 40 ])
  span('poolTile', [ -13.3, deck - 1.45, 2 ], [ -13, deck, 40.3 ])
  span('poolTile', [ -2, deck - 1.45, 2 ], [ -1.7, deck, 40.3 ])
  // The infinity edge: a weir a hand below the deck, then nothing but the sea.
  span('poolTile', [ -13.3, deck - 1.45, 40 ], [ -1.7, water - 0.02, 40.3 ])
  span('poolTile', [ -13.3, deck - 2.4, 40.3 ], [ -1.7, deck - 1.9, 41.2 ])
  span('navy', [ -13, water - 0.03, 40.02 ], [ -1.7, water - 0.01, 40.32 ])
  span({ mat: 'poolWater' }, [ -13.3, deck - 2, 40.32 ], [ -1.7, water - 0.02, 40.36 ])
  span({ mat: 'poolWater', lastLap: 0 }, [ -13, water - 0.02, 2 ], [ -2, water, 40.3 ])
  span({ mat: 'poolWater', firstLap: 1, lastLap: 1 }, [ -13, deck - 0.04, 2 ], [ -2, deck - 0.02, 40.3 ])
  span({ mat: 'poolWater', firstLap: 2 }, [ -15.2, deck + 0.08, -4.2 ], [ 3.2, deck + 0.1, 42 ])
  for (const x of [ -11.6, -8.85, -6.15, -3.4 ]) {
    span('laneLine', [ x - 0.13, deck - 1.149, 4 ], [ x + 0.13, deck - 1.14, 38 ])
    for (const z of [ 4, 38 ])
      span('laneLine', [ x - 0.5, deck - 1.149, z - 0.13 ], [ x + 0.5, deck - 1.14, z + 0.13 ])
    span('laneLine', [ x - 0.13, deck - 0.9, 2.001 ], [ x + 0.13, deck - 0.25, 2.01 ])
  }
  for (const x of [ -10.25, -7.5, -4.75 ])
    laneRope(stage, x, 2.1, 40, water + 0.02)
  span('navy', [ -13, deck - 0.01, 1.7 ], [ -2, deck + 0.002, 2 ])
  for (const z of [ 6, 22, 34 ]) {
    // Pool steps: two rails over the coping into the water.
    for (const x of [ -2.6, -3.3 ])
      bar('galvanised', [ x, deck + 0.85, z ], [ x, water - 0.9, z - 0.2 ], 0.024)
    for (const y of [ -0.3, -0.6 ])
      span('galvanised', [ -3.35, water + y, z - 0.25 ], [ -2.55, water + y + 0.03, z - 0.1 ])
  }

  // Walls: tile to the west and south, a colonnade on the east, open north.
  span('wallTile', [ -15.6, deck, -4.2 ], [ -15.2, 21.2, 42 ])
  span('glass', [ -15.25, 17, -4.2 ], [ -15.15, 20.6, 42 ])
  span('wallTile', [ -15.6, deck, -4.6 ], [ -0.9, 21.2, -4.2 ])
  span('wallTile', [ 0.9, deck, -4.6 ], [ 3.2, 21.2, -4.2 ])
  span('wallTile', [ -0.9, 15.4, -4.6 ], [ 0.9, 21.2, -4.2 ])
  for (let z = -4; z <= 42; z += 6.5) {
    span('concrete', [ 2.7, deck, z - 0.25 ], [ 3.2, 21.2, z + 0.25 ])
    span('concrete', [ -15.2, deck, z - 0.25 ], [ -14.8, 21.2, z + 0.25 ])
    // Roof truss across the hall.
    span('galvanised', [ -15.2, 20.7, z - 0.08 ], [ 3.2, 21.2, z + 0.08 ])
    span('galvanised', [ -15.2, 21.9, z - 0.06 ], [ 3.2, 22, z + 0.06 ])
    for (let x = -14; x < 3; x += 2.4)
      bar('galvanised', [ x, 21, z ], [ x + 1.2, 21.95, z ], 0.03, 6)
  }
  span('concrete', [ -15.6, 21.2, -4.6 ], [ 3.2, 21.5, -4.2 ])
  span('concrete', [ 2.7, 21.2, -4.2 ], [ 3.2, 21.6, 42 ])
  span('glass', [ -15.2, 21.96, -4.2 ], [ 3.2, 22.02, 42 ])
  for (let x = -15.2; x <= 3.2; x += 1.8)
    span('galvanised', [ x - 0.03, 21.92, -4.2 ], [ x + 0.03, 22.06, 42 ])
  lamps(stage, RIGS[0], [ 0.5, 0.18, 0.5 ])
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 7; j++)
      bar('steel', [ -12 + i * 6, 20.1, -0.75 + j * 6.5 ], [ -12 + i * 6, 20.9, -0.75 + j * 6.5 ], 0.012, 4)

  for (let z = 4; z < 38; z += 7)
    bench(stage, -14.6, deck, z, 'z', 2.8)
  // A lifeguard chair on the east deck.
  for (const [ dx, dz ] of [[ -0.35, -0.3 ], [ 0.35, -0.3 ], [ -0.35, 0.3 ], [ 0.35, 0.3 ]])
    bar('white', [ 1.6 + dx, deck, 18 + dz ], [ 1.6 + dx * 0.6, deck + 1.9, 18 + dz * 0.6 ], 0.03, 6)
  span('white', [ 1.2, deck + 1.85, 17.7 ], [ 2, deck + 1.92, 18.3 ])
  span('white', [ 1.2, deck + 1.9, 18.25 ], [ 2, deck + 2.5, 18.3 ])
  span('concrete', [ -15.6, deck - 1.75, -4.6 ], [ 3.2, deck - 1.45, 42 ])
  piles(stage, -14, 2, -3, 40, deck - 1.75, 8.5)
}

export function buildAnnex (stage: Stage): void {
  const { span, box }     = stage
  const [ x0, floor, z0 ] = RIGS[1].min
  const [ x1, , z1 ]      = RIGS[1].max
  const top               = floor + 0.35
  span('carpet', [ x0, floor, z0 ], [ x1, top, z1 ])
  span('ceiling', [ x0, 13.65, z0 ], [ x1, 13.78, z1 ])
  span('concrete', [ x0 - 0.3, 13.78, z0 - 0.3 ], [ x1 + 0.3, 14.3, z1 + 0.3 ])
  span('concrete', [ x0 - 0.3, floor - 0.3, z0 - 0.3 ], [ x1 + 0.3, floor, z1 + 0.3 ])
  span({ mat: 'floodWater', firstLap: 1, lastLap: 1 }, [ x0, top + 0.05, z0 ], [ x1, top + 0.06, z1 ])
  span({ mat: 'floodWater', firstLap: 2 }, [ x0, top + 0.6, z0 ], [ x1, top + 0.61, z1 ])

  // A curtain wall all round: mullions every 1.5 m, a spandrel below.
  const wall = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const n   = Math.round(len / 1.5)
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n
      const z = az + (bz - az) * i / n
      span('galvanised', [ x - 0.05, top, z - 0.05 ], [ x + 0.05, 13.65, z + 0.05 ])
      if (i === n)
        continue

      const mx = ax + (bx - ax) * (i + 0.5) / n
      const mz = az + (bz - az) * (i + 0.5) / n
      const hx = ax === bx ? 0.03 : 0.75
      const hz = az === bz ? 0.03 : 0.75
      if (flumeDistance(mx, mz) < 1.4)
        continue
      span('partition', [ mx - hx, top, mz - hz ], [ mx + hx, top + 0.75, mz + hz ])
      span('glass', [ mx - hx, top + 0.75, mz - hz ], [ mx + hx, 13.65, mz + hz ])
    }
  }
  wall(x0, z0, x1, z0)
  wall(x0, z1, x1, z1)
  wall(x0, z0, x0, z1)
  wall(x1, z0, x1, z1)

  for (const x of [ 26, 38, 50 ])
    for (const z of [ 36.5, 47, 57 ])
      if (flumeDistance(x, z) > 1.6)
        span('plaster', [ x - 0.35, top, z - 0.35 ], [ x + 0.35, 13.65, z + 0.35 ])

  // Workstations in clusters of four wherever the flume is not.
  for (let x = 22.5; x < x1 - 2; x += 3.4)
    for (let z = 34; z < z1 - 2; z += 3.2) {
      if (flumeDistance(x + 1.5, z + 1.4) < 3.2)
        continue
      span('partition', [ x, top, z + 1.37 ], [ x + 3, top + 1.45, z + 1.43 ])
      span('partition', [ x + 1.47, top, z ], [ x + 1.53, top + 1.45, z + 2.8 ])
      for (const [ dx, dz ] of [[ 0, 0 ], [ 1.55, 0 ], [ 0, 1.45 ], [ 1.55, 1.45 ]]) {
        const cx = x + dx + 0.7
        const cz = z + dz + 0.6
        span('timber', [ cx - 0.65, top + 0.72, cz - 0.38 ], [ cx + 0.65, top + 0.75, cz + 0.38 ])
        span('steel', [ cx - 0.6, top, cz - 0.3 ], [ cx - 0.56, top + 0.72, cz + 0.3 ])
        span('steel', [ cx + 0.56, top, cz - 0.3 ], [ cx + 0.6, top + 0.72, cz + 0.3 ])
        if (hash1(cx * 3.1 + cz) > 0.35)
          span('navy', [ cx - 0.25, top + 0.75, cz - 0.05 ], [ cx + 0.25, top + 1.05, cz - 0.03 ])

        const chair = hash1(cx + cz * 7.3) * 0.5
        span('rubber', [ cx - 0.24 + chair * 0.3, top + 0.42, cz + 0.5 ], [ cx + 0.24 + chair * 0.3, top + 0.48, cz + 0.95 ])
        span('rubber', [ cx - 0.22 + chair * 0.3, top + 0.48, cz + 0.92 ], [ cx + 0.22 + chair * 0.3, top + 0.95, cz + 0.97 ])
        span('steel', [ cx - 0.02 + chair * 0.3, top, cz + 0.7 ], [ cx + 0.02 + chair * 0.3, top + 0.42, cz + 0.74 ])
      }
    }
  lamps(stage, RIGS[1], [ 1.18, 0.04, 0.58 ], 'coldLamp')
  box('lamp', [ x0 + 0.4, 13.2, 40 ], [ 0.05, 0.18, 0.4 ])
  piles(stage, x0 + 2, x1 - 2, z0 + 2, z1 - 2, floor - 0.3, 8)
}

export function buildSpiral (stage: Stage): void {
  const route = getRoute()
  const helix = route.legs.find(leg => leg.act === 'spiral')!
  const cx    = helix.centerX
  const cz    = helix.centerZ
  const core  = 4.1
  const sides = 28
  const mesh  = stage.geometry('shuttered')
  for (let i = 0; i < sides; i++) {
    const a      = i / sides * Math.PI * 2
    const b      = (i + 1) / sides * Math.PI * 2
    const pa: V3 = [ cx + Math.sin(a) * core, 0, cz + Math.cos(a) * core ]
    const pb: V3 = [ cx + Math.sin(b) * core, 0, cz + Math.cos(b) * core ]
    mesh.quad([ pb[0], SEABED, pb[2] ], [ pb[0], 17.5, pb[2] ], [ pa[0], 17.5, pa[2] ], [ pa[0], SEABED, pa[2] ])
    for (let level = 0; level < 5; level++) {
      const y = 1 + level * 3.4
      if ((i + level * 3) % 4 !== 0)
        continue

      const m = (a + b) / 2
      stage.box({ mat: 'lamp', lastLap: level % 2 === 0 ? 2 : 0 },
                [ cx + Math.sin(m) * (core + 0.01), y, cz + Math.cos(m) * (core + 0.01) ], [ 0.22, 1.3, 0.22 ])
    }
  }
  stage.span('concrete', [ cx - core - 0.3, 17.5, cz - core - 0.3 ], [ cx + core + 0.3, 18.1, cz + core + 0.3 ])
  stage.span('concrete', [ cx - core - 1, -1, cz - core - 1 ], [ cx + core + 1, 0.5, cz + core + 1 ])

  // Outer columns where neither the approach nor the exit runs.
  for (const deg of [ 30, 150, 210, 270 ]) {
    const a = deg * Math.PI / 180
    const x = cx + Math.sin(a) * 7.95
    const z = cz + Math.cos(a) * 7.95
    stage.bar('galvanised', [ x, SEABED, z ], [ x, 12.4, z ], 0.16, 10)
  }
}

function tetrapod (stage: Stage, x: number, y: number, z: number, seed: number): void {
  const legs: V3[] = [[ 0, 1, 0 ], [ 0.94, -0.33, 0 ], [ -0.47, -0.33, 0.82 ], [ -0.47, -0.33, -0.82 ]]
  const spin       = seed * 6.28
  const tilt       = (hash1(seed * 7.7) - 0.5) * 1.2
  for (const [ lx, ly, lz ] of legs) {
    const rx = lx * Math.cos(spin) - lz * Math.sin(spin)
    const rz = lx * Math.sin(spin) + lz * Math.cos(spin)
    const ry = ly * Math.cos(tilt) - rx * Math.sin(tilt)
    const qx = rx * Math.cos(tilt) + ly * Math.sin(tilt)
    stage.geometry('concrete').tube([[ x, y, z, 0, 1, 0.2 ], [ x + qx * 1.3, y + ry * 1.3, z + rz * 1.3, 0, 1, 0.2 ]], 0.38, 7)
  }
}

export function buildBreakwater (stage: Stage): void {
  const { span, bar } = stage
  // The mole: a crest with a wave wall, running out and breaking up.
  for (let z = 52; z > -24; z -= 6) {
    const drop = z < -6 ? (hash1(z) - 0.2) * 1.6 : 0
    span('concrete', [ 63.5, SEABED, z - 6 ], [ 68.5, 2.2 - Math.max(0, drop), z ])
    span('concrete', [ 62.8, 2.2 - Math.max(0, drop), z - 5.9 ], [ 63.6, 3.5 - drop, z - 0.1 ])
    for (let k = 0; k < 3; k++) {
      const seed = hash1(z * 1.37 + k * 9.1)
      tetrapod(stage, 60.5 - seed * 2.5, -0.4 + hash1(seed * 3) * 1.6, z - 1 - k * 2 + seed, seed)
    }
    if (z % 12 === 4) {
      bar('steel', [ 64.2, 2.2, z - 3 ], [ 64.2, 7.2, z - 3 ], 0.07, 8)
      bar('steel', [ 64.2, 7.2, z - 3 ], [ 65.2, 7.2, z - 3 ], 0.05, 6)
      stage.box({ mat: 'lamp', firstLap: 2 }, [ 65.2, 7.05, z - 3 ], [ 0.3, 0.12, 0.2 ])
      bar('steel', [ 64.9, 2.2, z - 4.5 ], [ 64.9, 2.75, z - 4.5 ], 0.18, 10)
    }
  }
  for (let k = 0; k < 9; k++)
    tetrapod(stage, 61 + hash1(k * 5.3) * 7, -0.6 + hash1(k) * 1.4, -26 - hash1(k * 2.1) * 7, hash1(k * 3.3))

  // Out at sea, past resolving: a split fork, a ring on legs, a stepped blade.
  span('concrete', [ 290, -20, -1540 ], [ 450, 110, -1430 ])
  span('concrete', [ 300, 110, -1520 ], [ 350, 380, -1450 ])
  span('concrete', [ 395, 110, -1520 ], [ 440, 350, -1450 ])

  const ring: number[][] = []
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2
    ring.push([ -520 + Math.sin(a) * 170, 300 + Math.cos(a) * 170, -2260, 0, 0, 1 ])
  }
  stage.geometry('concrete').tube(ring, 22, 10)
  for (const x of [ -650, -390 ])
    span('concrete', [ x - 25, -20, -2290 ], [ x + 25, 190, -2230 ])
  for (const [ w, h, y ] of [[ 320, 150, -20 ], [ 230, 140, 130 ], [ 150, 130, 270 ], [ 70, 110, 400 ]])
    span('concrete', [ 820 - w / 2, y, -3060 ], [ 820 + w / 2, y + h, -2940 ])
}

export function buildLounge (stage: Stage): void {
  const { span, box }     = stage
  const [ x0, floor, z0 ] = RIGS[2].min
  const [ x1, roof, z1 ]  = RIGS[2].max
  span('terrazzo', [ x0, floor - 0.3, z0 ], [ x1, floor, z1 ])
  span('concrete', [ x0 - 0.4, roof, z0 - 0.4 ], [ 27, roof + 0.5, z1 + 0.4 ])
  span('concrete', [ 33, roof, z0 - 0.4 ], [ x1 + 0.4, roof + 0.5, z1 + 0.4 ])
  span('concrete', [ 27, roof, z0 - 0.4 ], [ 33, roof + 0.5, -61 ])
  span('concrete', [ 27, roof, -54 ], [ 33, roof + 0.5, z1 + 0.4 ])
  span('wallTile', [ x0, floor, z0 - 0.4 ], [ x1, roof, z0 ])
  span('wallTile', [ x0, floor, z1 ], [ x1, roof, z1 + 0.4 ])
  for (const x of [ x0 - 0.4, x1 ]) {
    span('wallTile', [ x, floor, z0 ], [ x + 0.4, roof, -59.5 ])
    span('wallTile', [ x, floor, -55.5 ], [ x + 0.4, roof, z1 ])
    span('wallTile', [ x, -2.6, -59.5 ], [ x + 0.4, roof, -55.5 ])
  }
  for (let x = x0 + 4; x < x1; x += 6)
    for (const z of [ -62.5, -52.5 ])
      span('wallTile', [ x - 0.35, floor, z - 0.35 ], [ x + 0.35, roof, z + 0.35 ])

  // Bleachers to the south, benches facing a wall of lane targets to the north.
  for (let step = 0; step < 5; step++) {
    const y = floor + step * 0.42
    span('concrete', [ x0 + 1, floor, z0 + step * 0.75 ], [ x1 - 1, y + 0.42, z0 + step * 0.75 + 0.75 ])
    span('timber', [ x0 + 1, y + 0.42, z0 + step * 0.75 + 0.1 ], [ x1 - 1, y + 0.47, z0 + step * 0.75 + 0.42 ])
  }
  for (let x = x0 + 3; x < x1 - 2; x += 3.6)
    for (const z of [ -57.5 - 3, -57.5 + 3.2 ])
      bench(stage, x, floor, z, 'x', 2.6)
  for (let x = x0 + 3; x < x1; x += 4) {
    span('laneLine', [ x - 0.12, floor + 0.6, z1 - 0.02 ], [ x + 0.12, roof - 0.6, z1 ])
    span('laneLine', [ x - 0.6, roof - 1.2, z1 - 0.02 ], [ x + 0.6, roof - 0.96, z1 ])
  }
  lamps(stage, RIGS[2], [ 0.9, 0.08, 0.3 ], 'coldLamp')
  span('sand', [ -200, SEABED - 0.4, -200 ], [ 200, SEABED - 0.05, 200 ])
  for (let i = 0; i < 40; i++) {
    const x = hash1(i * 3.1) * 80 - 20
    const z = -40 - hash1(i * 7.7) * 40
    if (x > x0 - 1 && x < x1 + 1 && z > z0 - 1 && z < z1 + 1)
      continue

    const r = 0.3 + hash1(i) * 0.9
    box('rock', [ x, SEABED + r * 0.4, z ], [ r * 1.6, r, r * 1.3 ])
  }
}

export function buildSorting (stage: Stage): void {
  const { span, box, bar } = stage
  const route              = getRoute()
  const loop               = route.legs.find(leg => leg.act === 'carousel')!
  const cx                 = loop.centerX
  const cz                 = loop.centerZ
  const [ x0, floor, z0 ]  = RIGS[3].min
  const [ x1, roof, z1 ]   = RIGS[3].max
  const top                = floor + 0.15
  // The floor, with the sump the tube surfaces through.
  span('deck', [ x0, floor - 0.4, z0 ], [ x1, top, -59.5 ])
  span('deck', [ x0, floor - 0.4, -55.5 ], [ x1, top, z1 ])
  span('deck', [ x0, floor - 0.4, -59.5 ], [ -8, top, -55.5 ])
  span('poolTile', [ -8, -3, -59.6 ], [ x1, top, -59.5 ])
  span('poolTile', [ -8, -3, -55.5 ], [ x1, top, -55.4 ])
  span({ mat: 'poolWater' }, [ -8, -0.02, -59.5 ], [ x1, 0, -55.5 ])
  for (const z of [ -59.5, -55.5 ])
    span('hazard', [ -8, top, z - 0.12 ], [ x1, top + 0.01, z + 0.12 ])

  // Corrugated walls on portal frames; the east roller door stands open.
  span('corrugated', [ x0 - 0.2, top, z0 ], [ x0, roof, z1 ])
  span('corrugated', [ x0, top, z0 - 0.2 ], [ x1, roof, z0 ])
  span('corrugated', [ x0, top, z1 ], [ -1.2, roof, z1 + 0.2 ])
  span('corrugated', [ 1.2, top, z1 ], [ x1, roof, z1 + 0.2 ])
  span('corrugated', [ -1.2, 3.4, z1 ], [ 1.2, roof, z1 + 0.2 ])
  span('corrugated', [ x1, top, z0 ], [ x1 + 0.2, roof, -50 ])
  span('corrugated', [ x1, top, -42 ], [ x1 + 0.2, roof, z1 ])
  span('corrugated', [ x1, 5.2, -50 ], [ x1 + 0.2, roof, -42 ])
  span('hazard', [ x1 - 0.05, top, -50.3 ], [ x1 + 0.25, 5.2, -50 ])
  span('hazard', [ x1 - 0.05, top, -42 ], [ x1 + 0.25, 5.2, -41.7 ])
  span('steel', [ x1 - 0.4, 5.2, -50.3 ], [ x1 + 0.3, 5.8, -41.7 ])
  span('corrugated', [ x0, roof, z0 ], [ x1, roof + 0.2, z1 ])
  for (let z = z0 + 0.1; z < z1; z += 6) {
    span('steel', [ x0, top, z ], [ x0 + 0.3, roof, z + 0.2 ])
    span('steel', [ x1 - 0.3, top, z ], [ x1, roof, z + 0.2 ])
    span('steel', [ x0, roof - 0.5, z ], [ x1, roof, z + 0.2 ])
  }
  lamps(stage, RIGS[3], [ 0.45, 0.2, 0.45 ], 'coldLamp')

  // The carousel: a steel plinth and sloping plates round a centre island.
  const plates = stage.geometry('rubber')
  const plinth = stage.geometry('steel')
  for (let i = 0; i < 48; i++) {
    const a  = i / 48 * Math.PI * 2
    const b  = (i + 1) / 48 * Math.PI * 2
    const at = (r: number, y: number, t: number): number[] => [ cx + Math.sin(t) * r, y, cz + Math.cos(t) * r ]
    plates.quad(at(3.6, top + 0.62, a), at(3.6, top + 0.62, b), at(2.5, top + 0.95, b), at(2.5, top + 0.95, a))
    plinth.quad(at(3.62, top, a), at(3.62, top + 0.62, a), at(3.62, top + 0.62, b), at(3.62, top, b))
    plinth.quad(at(2.48, top + 0.95, a), at(2.48, top + 1.05, a), at(1.8, top + 1.05, b), at(1.8, top + 0.95, b))
  }
  span('galvanised', [ cx - 1.8, top, cz - 1.8 ], [ cx + 1.8, top + 1.05, cz + 1.8 ])
  box({ mat: 'poolTile', carried: true }, [ 0, 0, 0 ], [ 0.3, 0.05, 0.3 ])
  box({ mat: 'poolWater', carried: true }, [ 0, -0.03, 0 ], [ 0.6, 0.01, 0.5 ])

  // Wire cages along the west wall; numbered shelving on the south.
  for (let z = z0 + 1; z < z1 - 2; z += 2.2) {
    for (let k = 0; k <= 8; k++) {
      bar('galvanised', [ x0 + 0.3, top, z + k * 0.25 ], [ x0 + 0.3, top + 2.4, z + k * 0.25 ], 0.008, 4)
      bar('galvanised', [ x0 + 1.5, top, z + k * 0.25 ], [ x0 + 1.5, top + 2.4, z + k * 0.25 ], 0.008, 4)
    }
    for (let y = 0.3; y < 2.5; y += 0.3)
      bar('galvanised', [ x0 + 1.5, top + y, z ], [ x0 + 1.5, top + y, z + 2 ], 0.008, 4)
    if (hash1(z) > 0.3)
      span('timber', [ x0 + 0.5, top + 0.02, z + 0.3 ], [ x0 + 1.3, top + 0.6, z + 1.2 ])
  }
  for (let x = x0 + 4; x < -2; x += 2.6) {
    for (const y of [ 0.1, 0.8, 1.5, 2.2 ])
      span('steel', [ x, top + y, z0 + 0.2 ], [ x + 2.4, top + y + 0.04, z0 + 0.9 ])
    for (const dx of [ 0, 2.36 ])
      span('steel', [ x + dx, top, z0 + 0.2 ], [ x + dx + 0.04, top + 2.4, z0 + 0.9 ])
    span('yellow', [ x + 0.9, top + 2.25, z0 + 0.88 ], [ x + 1.5, top + 2.42, z0 + 0.92 ])
    for (const y of [ 0.14, 0.84, 1.54 ])
      if (hash1(x * 3 + y) > 0.4)
        span('timber', [ x + 0.2 + hash1(x + y) * 0.8, top + y, z0 + 0.3 ], [ x + 1.1 + hash1(x + y) * 0.8, top + y + 0.45, z0 + 0.8 ])
  }
  bench(stage, x0 + 6, top, z1 - 1.5, 'x', 3)
  piles(stage, x0 + 1, x1 - 1, z0 + 1, z1 - 1, floor - 0.4, 6.5)
}
