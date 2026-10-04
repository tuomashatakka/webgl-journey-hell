import { createMeshBuilder, fracture } from '@wjh/geometry/meshBuilder'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { mulberry32 } from '@wjh/math/rng'
import { SurfaceKey } from './surfaces'

// --- unit props -----------------------------------------------------------------

/** A flat disc or ring in the local xy plane, facing +z, both sides. */
export function disc (b: MeshBuilder, r0: number, r1: number, z: number, seg: number): void {
  for (const side of [ 1, -1 ]) {
    const base = b.vertexCount
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2
      const c = Math.cos(a),
        s     = Math.sin(a)
      b.vertex(c * r0, s * r0, z + side * 0.004, 0, 0, side, 0, 0)
      b.vertex(c * r1, s * r1, z + side * 0.004, 0, 0, side, 0, 0)
    }
    for (let i = 0; i < seg; i++) {
      const a0 = base + i * 2,
        a1     = a0 + 2
      if (side > 0) {
        b.face(a0, a0 + 1, a1 + 1)
        b.face(a0, a1 + 1, a1)
      }
      else {
        b.face(a0, a1 + 1, a0 + 1)
        b.face(a0, a1, a1 + 1)
      }
    }
  }
}

/** A cylinder along local y, capped, for posts, masts and pendants. */
export function cylY (b: MeshBuilder, x: number, y0: number, y1: number, z: number, r: number, seg = 10): void {
  const base = b.vertexCount
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2
    const c = Math.cos(a),
      s     = Math.sin(a)
    b.vertex(x + c * r, y0, z + s * r, c, 0, s, 0, 0)
    b.vertex(x + c * r, y1, z + s * r, c, 0, s, 0, 0)
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2
    b.face(a, a + 1, a + 3)
    b.face(a, a + 3, a + 2)
  }
}

/** A low-poly sphere, for globes and lamp bulbs. */
export function sphere (b: MeshBuilder, x: number, y: number, z: number, r: number, seg = 8): void {
  const base = b.vertexCount
  const rows = seg,
    cols     = seg * 2
  for (let j = 0; j <= rows; j++) {
    const v = j / rows * Math.PI
    for (let i = 0; i <= cols; i++) {
      const u  = i / cols * Math.PI * 2
      const nx = Math.sin(v) * Math.cos(u),
        ny     = Math.cos(v),
        nz     = Math.sin(v) * Math.sin(u)
      b.vertex(x + nx * r, y + ny * r, z + nz * r, nx, ny, nz, 0, 0)
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = base + j * (cols + 1) + i
      const c = a + cols + 1
      b.face(a, a + 1, c + 1)
      b.face(a, c + 1, c)
    }
}

/** A ring around the local z axis (a tunnel rib), as a swept box section. */
export function ribRing (b: MeshBuilder, cu: number, r: number, depth: number, width: number, seg: number, a0: number, a1: number): void {
  const pts: [ number, number ][] = [[ r - depth, -width ], [ r, -width ], [ r, width ], [ r - depth, width ]]
  for (let k = 0; k < 4; k++) {
    const [ ra, za ] = pts[k]
    const [ rb, zb ] = pts[(k + 1) % 4]
    const base       = b.vertexCount
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg)
      const c = Math.cos(a),
        s     = Math.sin(a)
      // Face normal of this side of the section, rotated with the ring.
      const nr = zb - za,
        nz     = -(rb - ra)
      const l  = Math.hypot(nr, nz) || 1
      b.vertex(c * ra, cu + s * ra, za, c * nr / l, s * nr / l, nz / l, 0, 0)
      b.vertex(c * rb, cu + s * rb, zb, c * nr / l, s * nr / l, nz / l, 0, 0)
    }
    for (let i = 0; i < seg; i++) {
      const p = base + i * 2
      b.face(p, p + 2, p + 3)
      b.face(p, p + 3, p + 1)
    }
  }
}

/**
 * One prop family: a unit mesh, the surface it is drawn with, and how coarsely
 * it shatters (0 = never). Multi-material props are several families placed
 * with the same instance data.
 */
export interface UnitSpec {
  surface: SurfaceKey;
  cell:    number;
  build:   (b: MeshBuilder) => void;
}

export const UNITS: Record<string, UnitSpec> = {
  sleeperConcrete: { surface: 'concreteDim', cell: 0.9, build: b => b.box(0, -0.1, 0, 1.3, 0.09, 0.13) },
  sleeperWood:     { surface: 'wood', cell: 0.9, build: b => b.box(0, -0.1, 0, 1.32, 0.08, 0.13) },
  rail:            {
    surface: 'rail',
    cell:    0,
    build:   b => {
      for (const side of [ -1, 1 ]) {
        b.box(side * 0.7175, 0.076, 0, 0.034, 0.068, 0.372) // head and web
        b.box(side * 0.7175, 0.004, 0, 0.072, 0.012, 0.372) // foot
        b.box(side * 0.7175, -0.018, 0, 0.11, 0.012, 0.09) // baseplate
      }
    },
  },
  conductor: {
    // The third rail, on its insulators: what a people-mover actually runs on.
    surface: 'steel',
    cell:    0,
    build:   b => {
      b.box(1.36, 0.14, 0, 0.045, 0.04, 0.372)
      b.box(1.36, 0.05, 0, 0.05, 0.06, 0.06)
    },
  },

  column:     { surface: 'tile', cell: 1.2, build: b => b.box(0, 2.7, 0, 0.42, 2.7, 0.42) },
  columnCap:  { surface: 'darkGrey', cell: 0, build: b => b.box(0, 5.25, 0, 0.5, 0.12, 0.5) },
  // Benches face +x (local left), so one on the right of the track faces it.
  benchSlats: {
    surface: 'wood',
    cell:    0.5,
    build:   b => {
      for (let i = 0; i < 3; i++)
        b.box(0.16 - i * 0.16, 0.46, 0, 0.06, 0.025, 0.95)
      b.box(-0.24, 0.78, 0, 0.025, 0.12, 0.95)
    },
  },
  benchLegs: {
    surface: 'darkGrey',
    cell:    0,
    build:   b => {
      for (const z of [ -0.8, 0.8 ]) {
        b.box(0, 0.23, z, 0.22, 0.23, 0.03)
        b.box(-0.24, 0.62, z, 0.02, 0.2, 0.03)
      }
    },
  },
  roundelRing: { surface: 'red', cell: 0, build: b => disc(b, 0.62, 0.92, 0, 28) },
  roundelDisc: { surface: 'white', cell: 0, build: b => disc(b, 0, 0.62, 0, 28) },
  roundelBar:  { surface: 'blue', cell: 0, build: b => b.box(0, 0, 0.012, 1.15, 0.16, 0.012) },
  poster:      { surface: 'poster', cell: 0, build: b => b.box(0, 0, 0, 0.012, 0.75, 1.05) },
  posterFrame: { surface: 'darkGrey', cell: 0, build: b => b.box(0, 0, 0, 0.008, 0.82, 1.12) },

  fluoroBody:   { surface: 'greyPaint', cell: 0.6, build: b => b.box(0, 0.05, 0, 0.12, 0.05, 1.3) },
  fluoroTube:   { surface: 'fluoro', cell: 0, build: b => b.box(0, -0.02, 0, 0.06, 0.025, 1.22) },
  bulkBody:     { surface: 'darkGrey', cell: 0.3, build: b => b.box(0, 0, 0, 0.06, 0.16, 0.24) },
  bulkGlass:    { surface: 'bulb', cell: 0, build: b => b.box(-0.07, 0, 0, 0.025, 0.11, 0.17) },
  pendantRod:   { surface: 'black', cell: 0, build: b => cylY(b, 0, 0.3, 4.2, 0, 0.02, 6) },
  pendantShade: { surface: 'greyPaint', cell: 0, build: b => cylY(b, 0, 0.18, 0.42, 0, 0.55, 14) },
  pendantGlobe: { surface: 'bulb', cell: 0, build: b => sphere(b, 0, 0.05, 0, 0.36, 7) },
  lampPost:     { surface: 'darkGrey',
    cell:    0.8,
    build:   b => {
      cylY(b, 0, 0, 5.2, 0, 0.07, 8)
      b.box(0.55, 5.2, 0, 0.6, 0.04, 0.04)
    } },
  lampHead: { surface: 'sodium', cell: 0, build: b => b.box(1.05, 5.1, 0, 0.2, 0.05, 0.12) },

  rib: { surface: 'lining', cell: 0.9, build: b => ribRing(b, 1.55, 2.9, 0.14, 0.09, 36, -0.72, Math.PI + 0.72) },

  shutter:      { surface: 'corrugRust', cell: 1, build: b => b.box(0, 1.85, 0, 0.06, 1.85, 2.6) },
  shopSign:     { surface: 'poster', cell: 0, build: b => b.box(0, 4.35, 0, 0.18, 0.35, 2.6) },
  railPost:     { surface: 'greyPaint', cell: 0, build: b => b.box(0, 0.55, 0, 0.03, 0.55, 0.03) },
  railTop:      { surface: 'greyPaint', cell: 0, build: b => b.box(0, 1.1, 0, 0.04, 0.03, 1.05) },
  pointMachine: { surface: 'green', cell: 0.5, build: b => b.box(0, 0.25, 0, 0.35, 0.28, 0.7) },

  overbridge: {
    surface: 'concreteDim',
    cell:    3.5,
    build:   b => {
      b.box(0, 10, 0, 15.5, 0.55, 4.6) // deck
      b.box(-14.6, 11.2, 0, 0.3, 0.7, 4.6)
      b.box(14.6, 11.2, 0, 0.3, 0.7, 4.6)
      b.box(0, 8.95, -3.6, 15.5, 0.5, 0.45) // edge beams
      b.box(0, 8.95, 3.6, 15.5, 0.5, 0.45)
    },
  },
  fencePost: { surface: 'darkGrey',
    cell:    0,
    build:   b => {
      b.box(0, 11.3, 0, 0.04, 0.95, 0.04)
      b.box(0, 12.15, 0.75, 0.025, 0.025, 0.78)
      b.box(0, 10.9, 0.75, 0.025, 0.025, 0.78)
    } },
  signalPost: { surface: 'darkGrey',
    cell:    0.6,
    build:   b => {
      cylY(b, 0, 0, 3.4, 0, 0.07, 8)
      b.box(0, 3.75, 0, 0.22, 0.42, 0.14)
    } },
  signalLens: { surface: 'signal',
    cell:    0,
    build:   b => {
      b.box(0, 3.95, -0.15, 0.08, 0.08, 0.012)
      b.box(0, 3.62, -0.15, 0.08, 0.08, 0.012)
    } },

  annexColumn: { surface: 'concreteDim', cell: 1.4, build: b => b.box(0, 2.3, 0, 0.36, 2.7, 0.36) },
  beam:        { surface: 'panelDark', cell: 2.5, build: b => b.box(0, 4.55, 0, 16, 0.35, 0.3) },
  tubeLight:   { surface: 'greenTube', cell: 0, build: b => b.box(0, 4.1, 0, 0.05, 0.03, 0.75) },

  pier: { surface: 'brick', cell: 3, build: b => b.box(0, -9.5, 0, 4.1, 6.7, 1.1) },
  arch: {
    surface: 'brickSoot',
    cell:    3,
    build:   b => {
      // A barrel vault spanning between two piers 12 m apart (local z), its
      // crown under the deck soffit. Seen from below it is the viaduct.
      const span = 4.9,
        rise     = 3.6,
        crownY   = -3.2
      const seg  = 12
      for (let i = 0; i < seg; i++) {
        const a0 = Math.PI * i / seg,
          a1     = Math.PI * (i + 1) / seg
        const z0 = Math.cos(a0) * span,
          z1     = Math.cos(a1) * span
        const y0 = crownY - rise + Math.sin(a0) * rise,
          y1     = crownY - rise + Math.sin(a1) * rise
        b.quad([ 4.05, y0, z0 ], [ 4.05, y1, z1 ], [ -4.05, y1, z1 ], [ -4.05, y0, z0 ])
      }
    },
  },
  building:      { surface: 'windows', cell: 0, build: b => b.box(0, 0.5, 0, 0.5, 0.5, 0.5) },
  buildingBrick: { surface: 'windowsBrick', cell: 0, build: b => b.box(0, 0.5, 0, 0.5, 0.5, 0.5) },
  streetLamp:    { surface: 'sodium', cell: 0, build: b => sphere(b, 0, 0, 0, 0.35, 4) },

  rack:      { surface: 'rack', cell: 0.6, build: b => b.box(0, 1.05, 0, 0.5, 1.05, 0.3) },
  coldStrip: { surface: 'cold', cell: 0, build: b => b.box(0, 4.52, 0, 0.18, 0.03, 1.6) },

  carriage: {
    surface: 'carriage',
    cell:    1.8,
    build:   b => {
      b.box(0, 2, 0, 1.4, 1.45, 8.6)
      b.box(0, 3.5, 0, 1.25, 0.08, 8.4)
    },
  },
  bogie: { surface: 'black',
    cell:    0,
    build:   b => {
      b.box(0, 0.42, -5.8, 1.1, 0.32, 1.2)
      b.box(0, 0.42, 5.8, 1.1, 0.32, 1.2)
    } },
  mast: { surface: 'steel',
    cell:    2,
    build:   b => {
      cylY(b, 0, 0, 22, 0, 0.22, 8)
      b.box(0, 22.2, 0, 1.6, 0.12, 0.35)
    } },
  floodHead: { surface: 'sodium',
    cell:    0,
    build:   b => {
      for (const x of [ -1.1, -0.37, 0.37, 1.1 ])
        b.box(x, 21.8, 0, 0.3, 0.22, 0.2)
    } },
  shed:     { surface: 'corrugRust', cell: 0, build: b => b.box(0, 7, 0, 0.5, 7, 0.5) },
  shedRoof: { surface: 'corrugated', cell: 0, build: b => b.box(0, 14.2, 0, 0.55, 0.2, 0.52) },

  bent: {
    surface: 'steel',
    cell:    2.5,
    build:   b => {
      for (const x of [ -2.2, 2.2 ]) {
        b.box(x, -20.8, 0, 0.16, 20, 0.16)
        b.box(x * 1.55, -38, 0, 0.14, 4, 0.14)
      }
      for (const y of [ -4, -11, -18, -25, -32 ]) {
        b.box(0, y, 0, 2.3, 0.08, 0.08)
        // Diagonal: approximated as a stepped pair, which reads as bracing
        // from a moving train and costs nothing.
        b.box(-1.1, y - 1.8, 0, 1.1, 0.06, 0.06)
        b.box(1.1, y - 3.6, 0, 1.1, 0.06, 0.06)
      }
    },
  },
  trestleRailPost: { surface: 'steel', cell: 0, build: b => b.box(0, 0.5, 0, 0.035, 0.5, 0.035) },
  trestleRail:     { surface: 'steel', cell: 0, build: b => b.box(0, 1, 0, 0.03, 0.03, 1.5) },
  redLamp:         { surface: 'redLamp', cell: 0, build: b => sphere(b, 0, 2.6, 0, 0.13, 6) },
  redPost:         { surface: 'darkGrey', cell: 0, build: b => cylY(b, 0, -0.3, 2.5, 0, 0.05, 6) },
}

/** Build one unit, fractured if its spec asks. */
export function buildUnit (spec: UnitSpec, seed: number): MeshBuilder {
  const b = createMeshBuilder()
  spec.build(b)
  if (spec.cell > 0)
    fracture(b, spec.cell, mulberry32(seed))
  return b
}
/** Sleeper pitch, metres. */
export const TIE_PITCH = 0.744
