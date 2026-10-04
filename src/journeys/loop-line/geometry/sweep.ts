import { newFrame } from '@wjh/geometry/curve'
import { createMeshBuilder, fracture } from '@wjh/geometry/meshBuilder'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import { mulberry32 } from '@wjh/math/rng'
import type { ClosedCurve, Frame } from '@wjh/geometry/curve'
import { SurfaceKey } from './surfaces'
import { Profile, refine } from './profiles'


interface Corner {
  r:  number;
  u:  number;
  nr: number;
  nu: number;
  ao: number;
  v:  number;
}

/**
 * Sweep one profile along [s0, s1] of `curve` into per-surface builders.
 * Returns the builders keyed by surface, so a bay is one draw per material.
 */
export function sweepProfile (
  out: Map<SurfaceKey, MeshBuilder>,
  curve: ClosedCurve,
  s0: number,
  s1: number,
  step: number,
  profile: Profile,
): void {
  const pts   = refine(profile)
  const n     = pts.length
  const edges = profile.closed ? n : n - 1

  // Per edge: its two corners with normals (averaged across smooth joins),
  // occlusion, and the texture v of each end.
  const edgeCorners: [ Corner, Corner ][] = []
  const edgeNormal                        = (i: number): [ number, number ] => {
    const a  = pts[i],
      b      = pts[(i + 1) % n]
    const dr = b.r - a.r,
      du     = b.u - a.u
    const l  = Math.hypot(dr, du) || 1
    return [ -du / l, dr / l ]
  }
  let perimeter = 0
  for (let e = 0; e < edges; e++) {
    const a   = pts[e]
    const b   = pts[(e + 1) % n]
    const nn  = edgeNormal(e)
    const len = Math.hypot(b.r - a.r, b.u - a.u)

    const blend = (idx: number, other: number): [ number, number ] => {
      if (other < 0 || other >= edges)
        return nn

      const p  = pts[idx]
      if (!p.smooth)
        return nn

      const on = edgeNormal(other)
      const r  = nn[0] + on[0],
        u      = nn[1] + on[1]
      const l  = Math.hypot(r, u) || 1
      return [ r / l, u / l ]
    }
    const prev = profile.closed ? (e - 1 + edges) % edges : e - 1
    const next = profile.closed ? (e + 1) % edges : e + 1 < edges ? e + 1 : -1
    const na   = blend(e, prev)
    const nb   = blend((e + 1) % n, next)

    // v: height on a wall, lateral on a floor, perimeter round a smooth run.
    const smoothRun = a.smooth && b.smooth
    const wall      = Math.abs(b.u - a.u) > Math.abs(b.r - a.r)
    const va        = smoothRun ? perimeter : wall ? a.u : a.r
    const vb        = smoothRun ? perimeter + len : wall ? b.u : b.r
    perimeter += len

    edgeCorners.push([
      { r: a.r, u: a.u, nr: na[0], nu: na[1], ao: a.ao ?? 1, v: va },
      { r: b.r, u: b.u, nr: nb[0], nu: nb[1], ao: b.ao ?? 1, v: vb },
    ])
  }

  const rings           = Math.max(2, Math.ceil((s1 - s0) / step))
  const f               = newFrame()
  const frames: Frame[] = []
  for (let i = 0; i <= rings; i++) {
    const s = s0 + (s1 - s0) * (i / rings)
    curve.frameAtDistance(s, f)
    frames.push({
      pos:     { ...f.pos },
      forward: { ...f.forward },
      up:      { ...f.up },
      right:   { ...f.right },
    })
  }

  for (let e = 0; e < edges; e++) {
    const key = pts[e].s
    let b = out.get(key)
    if (!b) {
      b = createMeshBuilder()
      out.set(key, b)
    }

    const [ ca, cb ] = edgeCorners[e]
    const base       = b.vertexCount
    for (let i = 0; i <= rings; i++) {
      const fr = frames[i]
      const s  = s0 + (s1 - s0) * (i / rings)
      for (const c of [ ca, cb ]) {
        const px = fr.pos.x + fr.right.x * c.r + fr.up.x * c.u
        const py = fr.pos.y + fr.right.y * c.r + fr.up.y * c.u
        const pz = fr.pos.z + fr.right.z * c.r + fr.up.z * c.u
        // Occlusion rides in the normal's length.
        const nx = (fr.right.x * c.nr + fr.up.x * c.nu) * c.ao
        const ny = (fr.right.y * c.nr + fr.up.y * c.nu) * c.ao
        const nz = (fr.right.z * c.nr + fr.up.z * c.nu) * c.ao
        b.vertex(px, py, pz, nx, ny, nz, s, c.v)
      }
    }

    // Wind each quad so its geometric normal agrees with the one it carries.
    const fr0 = frames[0]
    const en  = edgeNormal(e)
    const wn  = {
      x: fr0.right.x * en[0] + fr0.up.x * en[1],
      y: fr0.right.y * en[0] + fr0.up.y * en[1],
      z: fr0.right.z * en[0] + fr0.up.z * en[1],
    }
    const v    = b.vertices()
    const at   = (k: number) => [ v[k * 12], v[k * 12 + 1], v[k * 12 + 2] ]
    const A    = at(base),
      B        = at(base + 1),
      C        = at(base + 3)
    const e1   = [ B[0] - A[0], B[1] - A[1], B[2] - A[2] ]
    const e2   = [ C[0] - A[0], C[1] - A[1], C[2] - A[2] ]
    const gx   = e1[1] * e2[2] - e1[2] * e2[1]
    const gy   = e1[2] * e2[0] - e1[0] * e2[2]
    const gz   = e1[0] * e2[1] - e1[1] * e2[0]
    const flip = gx * wn.x + gy * wn.y + gz * wn.z < 0

    for (let i = 0; i < rings; i++) {
      const a0 = base + i * 2,
        b0     = a0 + 1,
        a1     = a0 + 2,
        b1     = a0 + 3
      if (flip) {
        b.face(a0, a1, b1)
        b.face(a0, b1, b0)
      }
      else {
        b.face(a0, b0, b1)
        b.face(a0, b1, a1)
      }
    }
  }
}

/**
 * Fracture every builder in a bay's shell into slabs. A wall comes apart in
 * pieces the size of a room's panels, not in gravel.
 */
export function fractureAll (builders: Map<SurfaceKey, MeshBuilder>, cell: number, seed: number): void {
  let k = 0
  for (const b of builders.values())
    fracture(b, cell, mulberry32(seed + k++ * 7919))
}
