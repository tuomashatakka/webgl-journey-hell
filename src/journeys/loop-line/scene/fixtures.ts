import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import { createMesh } from '@wjh/gl/mesh'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import type { Mesh } from '@wjh/gl/mesh'
import { REJOIN_BAY } from '../stations'
import type { Circuits } from '../stations'
import { SURF } from '../geometry/surfaces'
import type { SurfaceKey } from '../geometry/surfaces'
import { INSTANCE_FLOATS, buildHeadwalls } from '../dressing'
import type { Headwall } from '../dressing'
import { MAX_HOLE } from '../shader/header'


import { IDENTITY } from './bays'
import type { BayRender, Draw } from './bays'


export interface WallRender {
  wall:  Headwall;
  mesh:  Mesh;
  bay:   BayRender;
  holeA: Float32Array;
  holeB: Float32Array;
  nA:    number;
  nB:    number;
}

/** One quad per headwall, with its portal polygons packed for the shader. */
export function buildWalls (gl: WebGL2RenderingContext, circuits: Circuits, bays: BayRender[]): WallRender[] {
  return buildHeadwalls(circuits).map((wall): WallRender => {
    const b                  = createMeshBuilder()
    const f                  = wall.frame
    const [ r0, u0, r1, u1 ] = wall.rect
    const P                  = (r: number, u: number) => [
      f.pos.x + f.right.x * r + f.up.x * u,
      f.pos.y + f.right.y * r + f.up.y * u,
      f.pos.z + f.right.z * r + f.up.z * u,
    ]
    const n   = [ -f.forward.x, -f.forward.y, -f.forward.z ]
    const ids = [[ r0, u0 ], [ r1, u0 ], [ r1, u1 ], [ r0, u1 ]].map(([ r, u ]) => {
      const p = P(r, u)
      return b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], r, u)
    })
    // Facing back along the track, toward the bay it closes.
    const a  = P(r0, u0),
      c      = P(r1, u0),
      d      = P(r0, u1)
    const cr = [
      (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]),
      (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]),
      (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]),
    ]
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) {
      b.face(ids[0], ids[1], ids[2])
      b.face(ids[0], ids[2], ids[3])
    }
    else {
      b.face(ids[0], ids[2], ids[1])
      b.face(ids[0], ids[3], ids[2])
    }

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, IDENTITY(wall.s, wall.bay))

    const pack = (poly: [ number, number ][] | undefined) => {
      const out = new Float32Array(MAX_HOLE * 2);
      (poly ?? []).slice(0, MAX_HOLE).forEach(([ x, y ], i) => {
        out[i * 2]     = x
        out[i * 2 + 1] = y
      })
      return out
    }
    return {
      wall,
      mesh,
      bay:   bays[wall.bay],
      holeA: pack(wall.holes[0]),
      holeB: pack(wall.holes[1]),
      nA:    Math.min(MAX_HOLE, wall.holes[0]?.length ?? 0),
      nB:    Math.min(MAX_HOLE, wall.holes[1]?.length ?? 0),
    }
  })
}

/**
 * The flood: level water, not track-following. The annex is the bottom of a dip,
 * so a level surface lies only where the floor is below it, and deepens by lap.
 */
type BuildFloodReturnType = { mesh: Mesh; base: number; annex: BayRender }

export function buildFlood (gl: WebGL2RenderingContext, circuits: Circuits, bays: BayRender[]): BuildFloodReturnType {
  const annex      = bays[REJOIN_BAY]
  let annexLow     = Infinity
  for (let s = annex.span.s0; s < annex.span.s1; s += 4)
    annexLow = Math.min(annexLow, circuits.main.pointAtDistance(s).y)

  const waterBase = annexLow - 0.38
  const waterMesh = (() => {
    const b               = createMeshBuilder()
    const f               = { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }}
    const rings: number[] = []
    for (let s = annex.span.s0; s <= annex.span.s1 + 0.01; s += 3) {
      circuits.main.frameAtDistance(s, f)
      for (const r of [ -10, 22 ])
        rings.push(b.vertex(f.pos.x + f.right.x * r, waterBase, f.pos.z + f.right.z * r, 0, 1, 0, s, r))
    }
    for (let i = 0; i + 3 < rings.length; i += 2) {
      // Facing up: wind by the geometric normal.
      const v  = b.vertices()
      const at = (q: number) => [ v[q * 12], v[q * 12 + 1], v[q * 12 + 2] ]
      const A  = at(rings[i]),
        B      = at(rings[i + 1]),
        C      = at(rings[i + 2])
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2])
      if (ny > 0) {
        b.face(rings[i], rings[i + 1], rings[i + 3])
        b.face(rings[i], rings[i + 3], rings[i + 2])
      }
      else {
        b.face(rings[i], rings[i + 3], rings[i + 1])
        b.face(rings[i], rings[i + 2], rings[i + 3])
      }
    }

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, IDENTITY(0, annex.bay.id))
    return mesh
  })()

  return { mesh: waterMesh, base: waterBase, annex }
}

/** The cab: the lip of the dashboard along the bottom of the view, one instance moved with the car. */
type BuildCabReturnType = { instance: Float32Array; draws: Draw[] }

export function buildCab (gl: WebGL2RenderingContext): BuildCabReturnType {
  // The front of a people-mover, seen from the front seat: nothing but the lip
  // of the dashboard along the bottom of the view. Pillars and a console were
  // tried and read as a slab and a lamp; a thin black edge is enough to put you
  // in a vehicle. Local x is left, y up, z forward, origin at the eye; one
  // instance, moved with the car every frame.
  const cabParts: { key: SurfaceKey; build: (b: MeshBuilder) => void }[] = [
    { key:   'black',
      build: b => {
        b.box(0, -0.79, 0.92, 2.2, 0.06, 0.3)
        b.box(0, -0.725, 1.21, 2.2, 0.012, 0.02)
      } },
  ]
  const cabInstance      = new Float32Array(INSTANCE_FLOATS)
  const cabDraws: Draw[] = cabParts.map(part => {
    const b = createMeshBuilder()
    part.build(b)

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, cabInstance)
    return { mesh, surface: SURF[part.key], count: 1, mapping: 1, shell: false }
  })

  return { instance: cabInstance, draws: cabDraws }
}
