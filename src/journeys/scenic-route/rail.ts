// THE SCENIC ROUTE — the coast road's guardrail.
//
// The rail used to be a three-point band 0.36 m tall on the inland side of
// the coast road, against the hill, with nothing at all between the asphalt
// and the drop to the sea. The spec has a guardrail on the cliff-top, the sea
// below it, bent open at the end. This is that, built once, on the CPU:
//
//   * a W-beam on the sea side: two ridges and a valley 0.31 m tall, its top
//     0.73 m over the road, swept along the road like the road itself, in
//     3.81 m panels lapped at a splice;
//   * a steel post every half panel, 1.8 m long with 1.1 m of it in the
//     ground, standing off the beam behind a blockout;
//   * a buried end where it starts: the beam flares off the road and turns
//     down into the ground over its first twelve metres;
//   * the wrap at the end: past the last of the asphalt the beam turns round
//     the end of the road and across it, and back up the inland side to a
//     buried end of its own. Across the road it is torn open: something has
//     gone through it, the two torn ends pushed out over the edge, laid over
//     and drooping, the posts dragged with them. The car goes through the gap.
//
// Every vertex is an offset in the road's *level* frame (geometry/sweep), so
// the bank LUT rolls the rail with the surface it guards. Along the coast the
// beam is a plain sweep with the profile's smooth normals. The wrap and the
// posts cross the road's direction, which a sweep's normal cannot point
// along, so they are written in the same layout with the edge parameter
// marking them FLAT (4 plus the distance along the W for the wrap's beam, POST
// or BLOCK for the boxes), and railFrag shades them from their own facets.

import { SWEEP_FLOATS, finishSweep, levelFrame, sweepProfile } from '@wjh/geometry/sweep'
import type { ProfilePoint, SweepArrays } from '@wjh/geometry/sweep'
import { newFrame } from '@wjh/geometry/curve'
import type { Frame } from '@wjh/geometry/curve'
import { smoothstep } from '@wjh/math/scalar'
import type { Route } from './course'

/** Road half width on the coast road; the rail is measured out from it. */
const HALF = 3.6

/** The beam's back plane, metres right of the spine: 1.1 m past the edge line. */
const BACK = HALF + 0.95

/** The post line, behind the blockout. */
const LINE = BACK + 0.2

/** A W-beam panel's laid length; posts stand every half panel. */
export const PANEL = 3.81

/** The W, (depth toward the road, height over the road): flanges, two ridges, the valley. */
const W: [ number, number ][] = [
  [ 0, 0.42 ], [ 0.055, 0.445 ], [ 0.085, 0.49 ], [ 0.06, 0.535 ], [ 0.022, 0.575 ],
  [ 0.06, 0.615 ], [ 0.085, 0.66 ], [ 0.055, 0.705 ], [ 0, 0.73 ],
]

/** Edge parameters railFrag reads as parts: a post, a blockout, the wrap's beam from FLAT. */
const POST  = 2
const BLOCK = 3
const FLAT  = 4

/** Ground at the post line, metres under the road (the verge falls to −0.22). */
const GROUND = -0.11

/** Metres of buried end. */
const LEAD = 12

/** The rail starts this far into the coast road and runs to this short of its end. */
const FROM  = 8
const SHORT = 3

/** The wrap: the radius it turns round the road's end on, and the half width of the hole torn through it. */
const TURN = 4.2
const GAP  = 2.7

/** How far back up the inland side the wrap runs before it is buried. */
const BACKRUN = 9

/** Metres either side of the hole over which the torn beam is bent. */
const TORN = 5

const frame = newFrame()

interface Pose {
  push: number;
  du:   number;
  lean: number;
}

interface Station {
  a:    number;
  r:    number;
  ta:   number;
  tr:   number;
  t:    number;
  pose: Pose;
}

/**
 * Writes vertices in the sweep layout, all in one frame: the level frame at
 * `s` (whose bank rolls them), a metres ahead along it, r right, u up.
 */
class Writer {
  verts: number[] = []
  idx:   number[] = []
  f:     Frame = frame

  constructor (private readonly route: Route) {}

  at (s: number): this {
    this.f = levelFrame(this.route.curve, s, frame)
    return this
  }

  get count (): number {
    return this.verts.length / SWEEP_FLOATS
  }

  vertex (s: number, a: number, r: number, u: number, part: number): void {
    const f = this.f
    this.verts.push(
      f.pos.x + f.forward.x * a, f.pos.y + f.forward.y * a, f.pos.z + f.forward.z * a, s,
      f.right.x, f.right.y, f.right.z, r,
      f.up.x, f.up.y, f.up.z, u,
      0, 1, part, 3,
    )
  }

  /**
   * A post or a blockout: a box standing on plan point (a, r) of the post
   * line, its long side along (ta, tr), from x0 to x1 out from the line and
   * y0 to y1 up, posed. Six faces, two-sided by the draw.
   */
  box (s: number, a: number, r: number, ta: number, tr: number, half: number, x0: number, x1: number, y0: number, y1: number, part: number, p: Pose): void {
    const base = this.count
    // Out is right of the run: (−tr, ta) is (0, 1) on the coast, the sea.
    for (let i = 0; i < 8; i++) {
      const along    = i & 1 ? half : -half
      const [ o, u ] = place(i & 2 ? x1 : x0, i & 4 ? y1 : y0, p)
      this.vertex(s, a + ta * along - tr * o, r + tr * along + ta * o, u, part)
    }
    for (const [ q0, q1, q2, q3 ] of [
      [ 0, 1, 3, 2 ], [ 4, 6, 7, 5 ], [ 0, 4, 5, 1 ], [ 2, 3, 7, 6 ], [ 0, 2, 6, 4 ], [ 1, 5, 7, 3 ],
    ])
      this.idx.push(base + q0, base + q1, base + q2, base + q0, base + q2, base + q3)
  }

  /** The post and its blockout at plan point (a, r), running along (ta, tr). */
  post (s: number, a: number, r: number, ta: number, tr: number, p: Pose): void {
    this.box(s, a, r, ta, tr, 0.04, -0.075, 0.075, GROUND - 1.1, 0.7, POST, p)
    this.box(s, a, r, ta, tr, 0.08, -0.2, -0.075, 0.47, 0.68, BLOCK, p)
  }
}

/**
 * One point of the rail relative to its post line: x metres out from it
 * (negative toward the road), y over the road. The pose lays it over outward
 * about the post's foot, pushes it out and drops it. Returns (out, up).
 */
function place (x: number, y: number, p: Pose): ProfilePoint {
  const c  = Math.cos(p.lean)
  const sn = Math.sin(p.lean)
  const h  = y - GROUND
  return [ x * c + h * sn + p.push, GROUND - x * sn + h * c + p.du ]
}

/** The buried end over the first LEAD metres from t = 0: flared out and sunk. */
function buried (t: number): Pose {
  const k = 1 - smoothstep(0, LEAD, t)
  return { push: 1.1 * k * k, du: -0.8 * k * k, lean: 0 }
}

/** Bent open toward the hole: g metres from its edge. */
function torn (g: number): Pose {
  const k = 1 - smoothstep(0, TORN, g)
  return { push: 2.4 * k * k, du: -0.3 * k - 0.35 * k * k * k, lean: 0.95 * k * k }
}

/** The wrap's beam along a run of post-line stations, shaded flat. */
function flatBeam (w: Writer, s: number, run: Station[]): void {
  const n    = W.length
  const base = w.count
  for (const st of run) {
    let wp = 0
    for (let k = 0; k < n; k++) {
      if (k > 0)
        wp += Math.hypot(W[k][0] - W[k - 1][0], W[k][1] - W[k - 1][1])

      const [ o, u ] = place(-0.2 - W[k][0], W[k][1], st.pose)
      w.vertex(s - st.t, st.a - st.tr * o, st.r + st.ta * o, u, FLAT + wp)
    }
  }
  for (let i = 0; i + 1 < run.length; i++)
    for (let k = 0; k + 1 < n; k++) {
      const a = base + i * n + k
      const b = a + n
      w.idx.push(a, a + 1, b + 1, a, b + 1, b)
    }
}

/**
 * The wrap in the frame at the rail's end, as two runs either side of the
 * hole: round the end of the road from the sea side, and from the hole round
 * to the inland side and back up it. Stations every 0.25 m; `t` counts along
 * the whole wrap from the sea side.
 */
function wrapRuns (): [ Station[], Station[] ] {
  const arc               = TURN * Math.PI / 2
  const cross             = 2 * (LINE - TURN)
  const total             = arc * 2 + cross + BACKRUN
  const hole0             = arc + (cross / 2 - GAP)
  const hole1             = arc + (cross / 2 + GAP)
  const sea: Station[]    = []
  const inland: Station[] = []
  for (let t = 0; t <= total + 1e-6; t += 0.25) {
    let a: number,
      r: number,
      ta: number,
      tr: number
    if (t < arc) {
      const th = t / TURN
      a = TURN * Math.sin(th)
      r = LINE - TURN + TURN * Math.cos(th)
      ta = Math.cos(th)
      tr = -Math.sin(th)
    }
    else if (t < arc + cross) {
      a = TURN
      r = LINE - TURN - (t - arc)
      ta = 0
      tr = -1
    }
    else if (t < arc * 2 + cross) {
      const th = (t - arc - cross) / TURN
      a = TURN * Math.cos(th)
      r = -(LINE - TURN) - TURN * Math.sin(th)
      ta = -Math.sin(th)
      tr = -Math.cos(th)
    }
    else {
      a = -(t - arc * 2 - cross)
      r = -LINE
      ta = -1
      tr = 0
    }

    const g  = t < hole0 ? hole0 - t : t - hole1
    const p  = g < TORN ? torn(Math.max(g, 0)) : buried(total - t)
    const st = { a, r, ta, tr, t, pose: p }
    if (t <= hole0)
      sea.push(st)
    else if (t >= hole1)
      inland.push(st)
  }
  return [ sea, inland ]
}

/** The coast road's guardrail: the beam swept, the wrap and the posts written. */
export function buildRail (route: Route): SweepArrays {
  const coast = route.spans[3]
  const s0    = coast.s0 + FROM
  const s1    = coast.s1 - SHORT

  const beam = sweepProfile(route.curve, {
    s0,
    s1,
    step:      0.5,
    sectionAt: () => 3,
    // Walked bottom to top, so the face toward the road is the front.
    profile:   (s: number): ProfilePoint[] => {
      const p = buried(s - s0)
      return W.map(([ d, u ]) => {
        const [ o, uu ] = place(-0.2 - d, u, p)
        return [ LINE + o, uu ]
      })
    },
  })

  const w = new Writer(route)
  // A post every half panel, a blockout between it and the beam; every other
  // post carries a splice (railFrag counts panels from s = 0 too).
  for (let s = Math.ceil(s0 / (PANEL / 2)) * PANEL / 2; s < s1 - 0.4; s += PANEL / 2)
    w.at(s).post(s, 0, LINE, 1, 0, buried(s - s0))

  // The wrap, in the frame at the rail's end. Its arc lengths run back up the
  // road from there, where the bank is the road end's.
  w.at(s1)

  const runs = wrapRuns()
  for (const run of runs) {
    flatBeam(w, s1, run)
    for (let i = 1; i < run.length; i++) {
      const st = run[i]
      if (Math.floor(st.t / (PANEL / 2)) !== Math.floor(run[i - 1].t / (PANEL / 2)))
        w.post(s1 - st.t, st.a, st.r, st.ta, st.tr, st.pose)
    }
  }

  const sweepFloats = beam.vertexCount * SWEEP_FLOATS
  const vertices    = new Float32Array(sweepFloats + w.verts.length)
  vertices.set(beam.vertices.subarray(0, sweepFloats))
  vertices.set(w.verts, sweepFloats)

  const indices = new Uint32Array(beam.indexCount + w.idx.length)
  indices.set(beam.indices.subarray(0, beam.indexCount))
  for (let i = 0; i < w.idx.length; i++)
    indices[beam.indexCount + i] = w.idx[i] + beam.vertexCount

  return finishSweep({ vertices, indices, vertexCount: beam.vertexCount + w.count, indexCount: indices.length })
}
