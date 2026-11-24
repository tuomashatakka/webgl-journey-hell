import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { createMesh } from '@wjh/gl/mesh'
import type { Mesh } from '@wjh/gl/mesh'


export const SURFACE = {
  plain:     0,
  tile:      1,
  carpet:    2,
  acoustic:  3,
  light:     4,
  concrete:  5,
  poolWater: 6,
  ocean:     7,
  steel:     8,
  glass:     9,
  belt:      10,
  marking:   11,
} as const

type Surface = keyof typeof SURFACE
type Motion = 'fixed' | 'cage' | 'tile'
type Dimensions = [number, number, number]

interface Style {
  surface:   Surface;
  color:     number;
  motion?:   Motion;
  firstLap?: number;
  lastLap?:  number;
}

export interface Batch {
  mesh:  Mesh;
  style: Style;
}

export type Stage = ReturnType<typeof createStage>

export function createStage () {
  const groups = new Map<string, { geometry: MeshBuilder; style: Style }>()

  function geometry (style: Style): MeshBuilder {
    const key = [ style.surface, style.color, style.motion, style.firstLap, style.lastLap ].join('/')
    let group = groups.get(key)
    if (!group) {
      group = { style, geometry: createMeshBuilder() }
      groups.set(key, group)
    }
    return group.geometry
  }

  return {
    geometry,
    box (style: Style, center: Dimensions, size: Dimensions) {
      geometry(style).box(...center, size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    },
    upload (gl: WebGL2RenderingContext): Batch[] {
      return Array.from(groups.values(), ({ style, geometry: mesh }) => ({ style, mesh: createMesh(gl, mesh) }))
    },
  }
}

export function ring (
  mesh: MeshBuilder, center: Dimensions, radius: number, width: number, depth: number,
  axis: 'up' | 'forward', count: number,
): void {
  function point (i: number, r: number, side: number): Dimensions {
    const angle = i / count * Math.PI * 2
    const x     = center[0] + r * Math.sin(angle)
    const v     = r * Math.cos(angle)
    return axis === 'up'
      ? [ x, center[1] + side, center[2] + v ]
      : [ x, center[1] + v, center[2] + side ]
  }

  for (let i = 0; i < count; i++) {
    const a = point(i, radius, depth)
    const b = point(i + 1, radius, depth)
    const c = point(i + 1, radius - width, depth)
    const d = point(i, radius - width, depth)
    mesh.quad(a, b, c, d)
    mesh.quad(point(i, radius, -depth), point(i + 1, radius, -depth), b, a)
    mesh.quad(d, c, point(i + 1, radius - width, -depth), point(i, radius - width, -depth))
  }
}
