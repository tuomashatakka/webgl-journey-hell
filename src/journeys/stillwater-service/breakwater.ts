import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import { createMesh } from '@wjh/gl/mesh'
import { ring } from './geometry'
import type { Stage } from './geometry'
import { DECK_HEIGHT, DECK_LENGTH, deckCenter, deckHalfWidth } from './route'


const concrete = { surface: 'concrete', color: 0x778181 } as const
const dark     = { surface: 'concrete', color: 0x495559 } as const
const steel    = { surface: 'steel', color: 0x697879 } as const
const stripe   = { surface: 'marking', color: 0xb19d5d } as const
const light    = { surface: 'light', color: 0xffdc99 } as const
const seaLock  = { surface: 'steel', color: 0x2a3a40 } as const
const floorY   = DECK_HEIGHT

function deckEdge (z: number, side: number): number {
  return deckCenter(z) + side * deckHalfWidth(z)
}

export function buildBreakwater (stage: Stage): void {
  const { box, geometry } = stage
  const deck              = geometry(concrete)
  const joint             = geometry(dark)
  for (let z = -2; z < DECK_LENGTH; z += 0.25) {
    const next = z + 0.25
    const xa   = deckEdge(z, -1)
    const xb   = deckEdge(z, 1)
    const xc   = deckEdge(next, 1)
    const xd   = deckEdge(next, -1)
    deck.quad([ xa, floorY, z ], [ xd, floorY, next ], [ xc, floorY, next ], [ xb, floorY, z ])
    deck.quad([ xa, floorY - 0.39, z ], [ xd, floorY - 0.39, next ], [ xd, floorY, next ], [ xa, floorY, z ])
    deck.quad([ xb, floorY, z ], [ xc, floorY, next ], [ xc, floorY - 0.39, next ], [ xb, floorY - 0.39, z ])
    if (z % 2 === 0)
      joint.quad([ xa, floorY + 0.005, z ], [ xa, floorY + 0.005, z + 0.031 ],
                 [ xb, floorY + 0.005, z + 0.031 ], [ xb, floorY + 0.005, z ])
  }

  for (let z = 0; z < DECK_LENGTH; z += 2)
    for (const side of [ -1, 1 ]) {
      const missing = side < 0 && z >= 10 && z <= 18 || side > 0 && z >= 24 && z <= 30
      const lastLap = side < 0 && z >= 6 && z <= 20 ? 0 : side > 0 && z >= 20 && z <= 36 ? 1 : 2
      const x       = deckEdge(z, side) - side * 0.045
      if (missing) {
        box(dark, [ x, floorY + 0.052, z ], [ 0.115, 0.1, 0.13 ])
        continue
      }

      const rail = { ...steel, lastLap }
      box(rail, [ x, floorY + 0.52, z ], [ 0.077, 1.04, 0.09 ])
      box({ ...stripe, lastLap }, [ x, floorY + 0.95, z ], [ 0.081, 0.15, 0.094 ])
      // Leave a readable open lip even before the outer sections disappear.
      if (z >= DECK_LENGTH - 2 || side < 0 && z >= 8 && z <= 18 || side > 0 && z >= 22 && z <= 30)
        continue

      const nextX = deckEdge(z + 2, side) - side * 0.045
      for (const y of [ floorY + 0.93, floorY + 0.5 ])
        geometry(rail).tube([[ x, y, z, 0, 1, 0 ], [ nextX, y, z + 2, 0, 1, 0 ]], 0.029, 6)
    }

  for (const z of [ 2, 20, 40 ]) {
    const x = deckCenter(z)
    box(dark, [ x, 36, z ], [ 0.92, 83.2, 1.7 ])
    box(steel, [ x, 75.6, z ], [ 2.58, 1.3, 2.7 ])
  }

  const lockX = deckCenter(42.3)
  box(dark, [ lockX, 79.6, 43.2 ], [ 3.6, 3.4, 2.6 ])
  box(seaLock, [ lockX, 79.14, 41.82 ], [ 1.49, 2.31, 0.21 ])
  box(stripe, [ lockX, 78.75, 41.7 ], [ 1.41, 0.11, 0.04 ])
  box(light, [ lockX, 80.49, 41.69 ], [ 0.41, 0.09, 0.055 ])

  const fork      = { surface: 'plain', color: 0x26373f } as const
  const ringStone = { surface: 'plain', color: 0x2a3a44 } as const
  const blade     = { surface: 'plain', color: 0x303e47 } as const
  box(fork, [ -725, 38, 1460 ], [ 172, 154, 131 ])
  box(fork, [ -772, 131, 1462 ], [ 55, 269, 103 ])
  box(fork, [ -682, 119, 1462 ], [ 47, 247, 89 ])
  box(fork, [ -772, 258, 1462 ], [ 82, 24, 112 ])
  box(fork, [ -682, 236, 1462 ], [ 66, 20, 96 ])
  for (const x of [ -798, -533 ])
    box(ringStone, [ x, 80, 2170 ], [ 61, 224, 91 ])
  ring(geometry(ringStone), [ -665, 249, 2185 ], 169, 38, 42, 'forward', 80)
  box(blade, [ -500, 96, 3110 ], [ 315, 235, 134 ])
  box(blade, [ -450, 234, 3140 ], [ 227, 249, 103 ])
  box(blade, [ -409, 338, 3140 ], [ 159, 250, 83 ])
  box(blade, [ -367, 454, 3140 ], [ 76, 112, 83 ])
  box(blade, [ -499, 325, 3082 ], [ 31, 244, 27 ])
}

export function makeOcean (gl: WebGL2RenderingContext, segments: number) {
  const mesh   = createMeshBuilder()
  const length = 6400
  // The cubic spacing samples the swell finely under the deck and widens
  // continuously to the horizon. Both quality tiers cover the same surface.
  const coordinate = (i: number) => {
    const t = i / segments * 2 - 1
    return t * 136 + t * t * t * (length - 136)
  }
  for (let iz = 0; iz <= segments; iz++)
    for (let ix = 0; ix <= segments; ix++)
      mesh.vertex(coordinate(ix), 0, coordinate(iz), 0, 1, 0, 0, 0)

  for (let iz = 0; iz < segments; iz++)
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix
      const b = a + segments + 1
      mesh.face(a, b, b + 1)
      mesh.face(a, b + 1, a + 1)
    }
  return createMesh(gl, mesh)
}
