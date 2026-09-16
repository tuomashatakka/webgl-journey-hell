// Sweep a cross-section along a closed curve into a mesh the vertex shader can
// still roll.
//
// loop-line's `sweepProfile` bakes the transported frame into world positions,
// which is right for a bore that never changes shape. A road that has to bank
// harder every lap cannot be baked: the corkscrew through downtown is 40° on
// the first lap and a full turn on the third, and rebuilding fifteen thousand
// vertices every frame across the section where that ramps is exactly the kind
// of per-frame upload this repo does not do.
//
// So the sweep emits *ingredients*, not positions. Every vertex carries the
// spine point, the level frame there (right and up derived from world up, not
// parallel transport — see levelFrame), its profile offsets (r, u), and its arc
// length s. The vertex shader looks the bank up in a 1D table by s, rotates
// right/up about the tangent, and only then adds r·right + u·up. The mesh never
// changes; the road rolls for the price of a uniform.
//
// Sixteen floats a vertex, four vec4 attributes (lib/mesh's `SWEEP_LAYOUT`):
//
//   a0  spine.xyz, s        a1  right.xyz, r
//   a2  up.xyz,    u        a3  normal2d.ru, edge param, section id
//
// The 2D normal is the profile polyline's normal in (r, u) space, averaged at
// each point; rotated by the same bank it is the world normal, so shading stays
// smooth without a second pass.

import type { ClosedCurve, Frame } from '@/lib/curve'
import type { AttribSpec } from '@/lib/mesh'


export const SWEEP_FLOATS = 16

export const SWEEP_LAYOUT: AttribSpec[] = [
  { location: 0, size: 4, offset: 0 },
  { location: 1, size: 4, offset: 4 },
  { location: 2, size: 4, offset: 8 },
  { location: 3, size: 4, offset: 12 },
]

/** One point of a cross-section: right offset, up offset, metres. */
export type ProfilePoint = [ number, number ]

export interface SweepOptions {
  s0:   number;
  s1:   number;
  step: number;

  /**
   * The cross-section at arc length s. Must return the same number of points
   * every call; blend between sections *inside* it. The profile's winding sets
   * which side is the front: walk it so the surface you want to see is on the
   * left of the walking direction (a floor left-to-right faces up, a circle
   * walked counter-clockwise faces in).
   */
  profile: (s: number) => ProfilePoint[];

  /** Join the last point back to the first, for a tube. */
  closed?: boolean;

  /** Which section owns this arc length, written to a3.w for the fragment shader. */
  sectionAt?: (s: number) => number;

  /** Reuse an existing arrays object to append onto it. */
  into?: SweepArrays;
}

export interface SweepArrays {
  vertices:    Float32Array;
  indices:     Uint32Array;
  vertexCount: number;
  indexCount:  number;
}

const WORLD_UP = { x: 0, y: 1, z: 0 }

/**
 * The frame a road is laid on: the curve's tangent, with right and up taken
 * from world up rather than parallel-transported. Transport minimises twist,
 * which is what a camera on a rail wants and precisely what a road does not —
 * its accumulated holonomy would leave a slight arbitrary camber wherever the
 * authored bank is zero. Level fails only when the tangent is vertical, and
 * nothing on this route pitches past about fifty-five degrees.
 */
export function levelFrame (curve: ClosedCurve, s: number, out: Frame): Frame {
  curve.frameAtDistance(s, out)

  const f  = out.forward
  let rx = f.y * WORLD_UP.z - f.z * WORLD_UP.y
  let ry = f.z * WORLD_UP.x - f.x * WORLD_UP.z
  let rz = f.x * WORLD_UP.y - f.y * WORLD_UP.x
  const rl = Math.hypot(rx, ry, rz) || 1
  rx /= rl
  ry /= rl
  rz /= rl

  out.right.x = rx
  out.right.y = ry
  out.right.z = rz

  out.up.x = ry * f.z - rz * f.y
  out.up.y = rz * f.x - rx * f.z
  out.up.z = rx * f.y - ry * f.x
  return out
}

export function newFrame (): Frame {
  return {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }
}

function grow (arr: SweepArrays, verts: number, idx: number): void {
  if (arr.vertexCount * SWEEP_FLOATS + verts > arr.vertices.length) {
    let cap = Math.max(arr.vertices.length, SWEEP_FLOATS * 64)
    while (cap < arr.vertexCount * SWEEP_FLOATS + verts)
      cap *= 2

    const next = new Float32Array(cap)
    next.set(arr.vertices.subarray(0, arr.vertexCount * SWEEP_FLOATS))
    arr.vertices = next
  }
  if (arr.indexCount + idx > arr.indices.length) {
    let cap = Math.max(arr.indices.length, 192)
    while (cap < arr.indexCount + idx)
      cap *= 2

    const next = new Uint32Array(cap)
    next.set(arr.indices.subarray(0, arr.indexCount))
    arr.indices = next
  }
}

export function createSweepArrays (): SweepArrays {
  return {
    vertices:    new Float32Array(0),
    indices:     new Uint32Array(0),
    vertexCount: 0,
    indexCount:  0,
  }
}

/** Trim to what was actually written; call once before upload. */
export function finishSweep (arr: SweepArrays): SweepArrays {
  arr.vertices = arr.vertices.subarray(0, arr.vertexCount * SWEEP_FLOATS)
  arr.indices  = arr.indices.subarray(0, arr.indexCount)
  return arr
}

/**
 * Per-point 2D normals of a profile polyline, averaged across the two edges
 * that meet at each point. Open profiles use the single edge at their ends.
 */
function profileNormals (pts: ProfilePoint[], closed: boolean): number[] {
  const n     = pts.length
  const out   = new Array<number>(n * 2).fill(0)
  const edges = closed ? n : n - 1
  for (let e = 0; e < edges; e++) {
    const a  = pts[e]
    const b  = pts[(e + 1) % n]
    const dr = b[0] - a[0]
    const du = b[1] - a[1]
    const l  = Math.hypot(dr, du) || 1
    // Left of the walking direction.
    const nr = -du / l
    const nu = dr / l
    out[e * 2]                 += nr
    out[e * 2 + 1]             += nu
    out[(e + 1) % n * 2]       += nr
    out[(e + 1) % n * 2 + 1]   += nu
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(out[i * 2], out[i * 2 + 1]) || 1
    out[i * 2]     /= l
    out[i * 2 + 1] /= l
  }
  return out
}

/**
 * Sweep `profile` from s0 to s1. Returns the arrays (the same object as
 * `into` when given). Triangle winding is chosen per quad so the geometric
 * front face agrees with the profile normal — the profile's winding decides
 * which side is seen, and the caller never has to think about it twice.
 */
export function sweepProfile (curve: ClosedCurve, opts: SweepOptions): SweepArrays {
  const arr    = opts.into ?? createSweepArrays()
  const closed = opts.closed ?? false
  const rings  = Math.max(2, Math.ceil((opts.s1 - opts.s0) / opts.step))
  const frame  = newFrame()
  const first  = opts.profile(opts.s0)
  const n      = first.length
  const edges  = closed ? n : n - 1
  const secAt  = opts.sectionAt ?? (() => 0)

  grow(arr, (rings + 1) * n * SWEEP_FLOATS, rings * edges * 6)

  const base = arr.vertexCount
  let v = arr.vertices
  let o = base * SWEEP_FLOATS

  for (let i = 0; i <= rings; i++) {
    const s   = opts.s0 + (opts.s1 - opts.s0) * (i / rings)
    const pts = opts.profile(s)
    const nrm = profileNormals(pts, closed)
    const sec = secAt(s)
    levelFrame(curve, s, frame)

    let edgeParam = 0
    for (let k = 0; k < n; k++) {
      if (k > 0)
        edgeParam += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])

      v[o]      = frame.pos.x
      v[o + 1]  = frame.pos.y
      v[o + 2]  = frame.pos.z
      v[o + 3]  = s
      v[o + 4]  = frame.right.x
      v[o + 5]  = frame.right.y
      v[o + 6]  = frame.right.z
      v[o + 7]  = pts[k][0]
      v[o + 8]  = frame.up.x
      v[o + 9]  = frame.up.y
      v[o + 10] = frame.up.z
      v[o + 11] = pts[k][1]
      v[o + 12] = nrm[k * 2]
      v[o + 13] = nrm[k * 2 + 1]
      v[o + 14] = edgeParam
      v[o + 15] = sec
      o += SWEEP_FLOATS
    }
  }
  arr.vertexCount += (rings + 1) * n
  v = arr.vertices

  // Winding: compute the geometric normal of the quad in (r, u, s) space and
  // compare it against the profile normal at its first corner. Positions along
  // s are all "forward", so the quad's geometric normal in that space is the
  // edge's (r,u) normal crossed with forward — which is exactly ±the profile
  // normal, and the sign is what we need.
  const idx = arr.indices
  let q     = arr.indexCount
  for (let i = 0; i < rings; i++) {
    const ringA = base + i * n
    const ringB = base + (i + 1) * n
    for (let e = 0; e < edges; e++) {
      const j  = e
      const k  = (e + 1) % n
      const a0 = ringA + j
      const a1 = ringA + k
      const b1 = ringB + k
      const b0 = ringB + j

      // Edge direction in the profile plane and its left normal.
      const va = a0 * SWEEP_FLOATS
      const vb = a1 * SWEEP_FLOATS
      const dr = v[vb + 7] - v[va + 7]
      const du = v[vb + 11] - v[va + 11]
      const nr = v[va + 12]
      const nu = v[va + 13]
      // (-du, dr) is the left normal of the edge; if it agrees with the stored
      // normal the front face is a0 -> b0 -> b1 -> a1 (counter-clockwise seen
      // from the normal side), else the mirror.
      const agree = -du * nr + dr * nu >= 0
      if (agree) {
        idx[q++] = a0
        idx[q++] = a1
        idx[q++] = b1
        idx[q++] = a0
        idx[q++] = b1
        idx[q++] = b0
      }
      else {
        idx[q++] = a0
        idx[q++] = b1
        idx[q++] = a1
        idx[q++] = a0
        idx[q++] = b0
        idx[q++] = b1
      }
    }
  }
  arr.indexCount = q
  return arr
}
