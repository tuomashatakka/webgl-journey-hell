// What the rooms and props are made of, and the builder that batches them.
//
// One draw per material (and per lap gate), so a room of a few hundred boxes is
// a dozen draws. Surfaces from the Δ library carry their layer; the rest are
// procedural kinds the world shader knows by number.

import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { createMesh } from '@wjh/gl/mesh'
import type { Mesh } from '@wjh/gl/mesh'
import { MAT } from '@wjh/delta/manifest'


/** Procedural kinds, mirrored as constants in the world shader. */
export const KIND = { library: 0, lamp: 1, carpet: 2, glass: 3, ceiling: 4, paint: 5, rubber: 6, water: 7 } as const

interface Material {
  kind:   number;
  layer?: number;
  tint:   [number, number, number];
  rough?: number;
}

function library (id: string, tint: [number, number, number] = [ 1, 1, 1 ], rough?: number): Material {
  return { kind: KIND.library, layer: MAT[id], tint, rough }
}

export const MATERIALS = {
  wallTile:   library('TILE', [ 0.92, 0.97, 0.95 ]),
  poolTile:   library('TILE', [ 0.42, 0.78, 0.8 ]),
  deck:       library('FLOOR', [ 0.86, 0.86, 0.82 ]),
  terrazzo:   library('TERRAZZO', [ 0.9, 0.92, 0.9 ]),
  shuttered:  library('PANEL'),
  concrete:   library('CONCRETE', [ 0.86, 0.88, 0.88 ]),
  steel:      library('STEEL', [ 0.9, 0.9, 0.88 ]),
  galvanised: library('STEEL', [ 0.62, 0.66, 0.68 ], 0.45),
  corrugated: library('CORRUGATED', [ 0.86, 0.9, 0.9 ]),
  timber:     library('WOOD', [ 0.9, 0.8, 0.7 ]),
  plaster:    library('PLASTER', [ 0.92, 0.88, 0.8 ]),
  hazard:     library('HAZARD'),
  sand:       library('DIRT', [ 0.78, 0.74, 0.62 ]),
  rock:       library('ROCK', [ 0.6, 0.62, 0.62 ]),
  lamp:       { kind: KIND.lamp, tint: [ 1, 0.96, 0.88 ]},
  coldLamp:   { kind: KIND.lamp, tint: [ 0.86, 0.97, 1 ]},
  redLamp:    { kind: KIND.lamp, tint: [ 1, 0.16, 0.08 ]},
  carpet:     { kind: KIND.carpet, tint: [ 0.42, 0.33, 0.2 ]},
  glass:      { kind: KIND.glass, tint: [ 0.62, 0.72, 0.72 ]},
  ceiling:    { kind: KIND.ceiling, tint: [ 0.86, 0.84, 0.78 ]},
  partition:  { kind: KIND.paint, tint: [ 0.36, 0.38, 0.4 ], rough: 0.9 },
  laneLine:   { kind: KIND.paint, tint: [ 0.03, 0.08, 0.16 ], rough: 0.35 },
  laneRed:    { kind: KIND.paint, tint: [ 0.62, 0.06, 0.05 ], rough: 0.5 },
  laneBlue:   { kind: KIND.paint, tint: [ 0.05, 0.2, 0.55 ], rough: 0.5 },
  white:      { kind: KIND.paint, tint: [ 0.8, 0.8, 0.78 ], rough: 0.45 },
  yellow:     { kind: KIND.paint, tint: [ 0.75, 0.55, 0.08 ], rough: 0.5 },
  navy:       { kind: KIND.paint, tint: [ 0.04, 0.07, 0.14 ], rough: 0.55 },
  rubber:     { kind: KIND.rubber, tint: [ 0.07, 0.075, 0.08 ]},
  poolWater:  { kind: KIND.water, tint: [ 0.2, 0.55, 0.55 ]},
  floodWater: { kind: KIND.water, tint: [ 0.25, 0.22, 0.14 ]},
} satisfies Record<string, Material>

export type MaterialKey = keyof typeof MATERIALS

export interface Style {
  mat:       MaterialKey;

  /** Rides the carousel instead of standing still. */
  carried?:  boolean;
  firstLap?: number;
  lastLap?:  number;
}

export interface Batch {
  mesh:     Mesh;
  style:    Style;
  material: Material;
}

type V3 = [number, number, number]

export function createStage () {
  const groups = new Map<string, { geometry: MeshBuilder; style: Style }>()

  function geometry (style: Style | MaterialKey): MeshBuilder {
    const s   = typeof style === 'string' ? { mat: style } : style
    const key = [ s.mat, s.carried, s.firstLap, s.lastLap ].join('/')
    let group = groups.get(key)
    if (!group) {
      group = { style: s, geometry: createMeshBuilder() }
      groups.set(key, group)
    }
    return group.geometry
  }

  /** An axis-aligned box by centre and full size. */
  function box (style: Style | MaterialKey, center: V3, size: V3): void {
    geometry(style).box(center[0], center[1], center[2], size[0] / 2, size[1] / 2, size[2] / 2)
  }

  /** A box from its minimum corner to its maximum one. */
  function span (style: Style | MaterialKey, min: V3, max: V3): void {
    box(style, [ (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2 ],
        [ max[0] - min[0], max[1] - min[1], max[2] - min[2] ])
  }

  /** A round bar between two points. */
  function bar (style: Style | MaterialKey, a: V3, b: V3, radius: number, sides = 8): void {
    const vertical = Math.abs(b[1] - a[1]) > 0.9 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const up       = vertical ? [ 1, 0, 0 ] : [ 0, 1, 0 ]
    geometry(style).tube([[ ...a, ...up ], [ ...b, ...up ]], radius, sides)
  }

  return {
    geometry,
    box,
    span,
    bar,
    upload (gl: WebGL2RenderingContext): Batch[] {
      return Array.from(groups.values(), ({ style, geometry: mesh }) => ({
        style,
        material: MATERIALS[style.mat],
        mesh:     createMesh(gl, mesh),
      }))
    },
  }
}

export type Stage = ReturnType<typeof createStage>
