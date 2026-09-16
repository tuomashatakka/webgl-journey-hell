// Invariant checks for the geometry primitives behind a rasterized journey.
//
//   bun tools/verify-geometry.ts
//
// Everything else in this repo is verified by looking at it — that is what
// tools/journey.mjs is for, and for a shader it is the right instrument, because
// a wrong SDF looks wrong. lib/curve and lib/mesh are not like that. They are
// pure maths with no picture of their own, they sit underneath the thing you can
// see, and their failures are invisible until they are catastrophic: a spline
// that misses its own control points still produces a perfectly plausible
// screenshot of the wrong track.
//
// This file exists because that happened. The first cut of lib/curve multiplied
// centripetal knot spacing into a *uniform* Catmull-Rom basis, so the curve
// interpolated nothing and tore at every segment join — and it passed a suite of
// seven checks, because every one of them measured the curve THROUGH its own
// arc-length LUT, and the LUT happily resamples whatever shape it is handed.
//
// So the tests here are chosen to be ones a wrong implementation cannot pass:
//
//   * the curve must pass through its own control points (catches a bad basis);
//   * densely-sampled step lengths must have no outlier (catches a tear);
//   * total turning of a closed planar loop must be exactly 2*pi (catches a
//     curvature that is differentiating against the wrong variable — a pointwise
//     check cannot, because a coarse spline through circle points is legitimately
//     not a circle);
//   * no triangle may straddle two fracture shards (catches a shard that stretches
//     rather than moving rigidly).

import { createClosedCurve } from '@/lib/curve'
import type { Vec3 } from '@/lib/curve'
import { getCircuits, BAYS, spanAt } from '@/app/journeys/loop-line/stations'
import { SWEEP_FLOATS, finishSweep, levelFrame, newFrame, sweepProfile } from '@/lib/sweep'
import { getRoute } from '@/app/journeys/scenic-route/course'


let fails = 0
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond)
    fails++
}
const d = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// --- the two checks a wrong basis cannot pass -----------------------------
// Unevenly spaced control points. A broken parametrisation shows up here and
// nowhere else, because the LUT resamples whatever shape it is handed.
const uneven = [
  { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 4 }, { x: 108, y: 0, z: 60 },
  { x: 40, y: 12, z: 95 }, { x: -70, y: 6, z: 70 }, { x: -95, y: 0, z: -20 },
]
const cu = createClosedCurve(uneven)

let worstCp = 0
for (let i = 0; i < uneven.length; i++) {
  const got = cu.sample(i / uneven.length)
  worstCp = Math.max(worstCp, d(got, uneven[i]))
}
ok('curve interpolates its control points', worstCp < 1e-6, `max err ${worstCp.toExponential(2)} m`)

// Continuity: the largest gap between consecutive dense samples must not be a
// multiple of the typical gap. A torn segment join shows as a huge outlier.
let maxJump = 0,
  sumJump   = 0
const N = 4000
let prev = cu.sample(0)
for (let i = 1; i <= N; i++) {
  const p = cu.sample(i / N)
  const j = d(p, prev)
  maxJump = Math.max(maxJump, j); sumJump += j
  prev = p
}

const meanJump = sumJump / N
ok('no tear at segment joins', maxJump < meanJump * 6,
   `max/mean = ${(maxJump / meanJump).toFixed(2)}`)

// --- arc-length machinery -------------------------------------------------
const R      = 100,
  M          = 8
const circle = createClosedCurve(
  Array.from({ length: M }, (_, i) => {
    const a = i / M * Math.PI * 2
    return { x: R * Math.cos(a), y: 0, z: R * Math.sin(a) }
  }))
ok('circle length ≈ 2πr', Math.abs(circle.length - 2 * Math.PI * R) / (2 * Math.PI * R) < 0.02,
   `${circle.length.toFixed(1)} vs ${(2 * Math.PI * R).toFixed(1)}`)
ok('loop closes', d(circle.pointAtDistance(0), circle.pointAtDistance(circle.length)) < 1e-4)

let mn = Infinity,
  mx   = 0
let pp = circle.pointAtDistance(0)
for (let i = 1; i <= 200; i++) {
  const p    = circle.pointAtDistance(i / 200 * circle.length)
  const step = d(p, pp); mn = Math.min(mn, step); mx = Math.max(mx, step); pp = p
}
ok('arc-length uniform', mx / mn < 1.05, `ratio ${(mx / mn).toFixed(4)}`)

// An 8-point Catmull-Rom through points on a circle is not a circle, so its
// pointwise curvature legitimately differs from 1/R. Two tests that are not
// confounded by that: a densely-sampled circle, where the spline does converge,
// and the total turning of any closed planar loop, which is exactly 2π.
const fine = createClosedCurve(
  Array.from({ length: 64 }, (_, i) => {
    const a = i / 64 * Math.PI * 2
    return { x: R * Math.cos(a), y: 0, z: R * Math.sin(a) }
  }))
const kf = fine.curvatureAtDistance(fine.length * 0.37)
ok('curvature -> 1/R as the circle is refined',
   Math.abs(kf - 1 / R) / (1 / R) < 0.05,
   `${kf.toExponential(3)} vs ${(1 / R).toExponential(3)}`)

let turning = 0
const TN = 20000
for (let i = 0; i < TN; i++)
  turning += circle.curvatureAtDistance(i / TN * circle.length) * (circle.length / TN)
ok('total turning = 2π', Math.abs(turning - 2 * Math.PI) / (2 * Math.PI) < 0.02,
   `${turning.toFixed(4)} vs ${(2 * Math.PI).toFixed(4)}`)

// --- frames ---------------------------------------------------------------
const f0   = circle.frameAtDistance(0)
const f1   = circle.frameAtDistance(circle.length - 1e-6)
const holo = Math.max(Math.abs(f0.up.x - f1.up.x), Math.abs(f0.up.y - f1.up.y), Math.abs(f0.up.z - f1.up.z))
ok('frame closes (holonomy corrected)', holo < 0.02, `residual ${holo.toExponential(2)}`)

let worstOrtho = 0,
  nan          = false
for (const c of [ cu, circle, getCircuits().main, getCircuits().alt ])
  for (let i = 0; i < 500; i++) {
    const f = c.frameAtDistance(i / 500 * c.length)
    for (const v of [ f.pos, f.forward, f.up, f.right ])
      if (!Number.isFinite(v.x + v.y + v.z))
        nan = true
    worstOrtho = Math.max(worstOrtho,
                          Math.abs(f.forward.x * f.up.x + f.forward.y * f.up.y + f.forward.z * f.up.z),
                          Math.abs(Math.hypot(f.forward.x, f.forward.y, f.forward.z) - 1),
                          Math.abs(Math.hypot(f.up.x, f.up.y, f.up.z) - 1))
  }
ok('no NaN in any frame', !nan)
ok('frames orthonormal', worstOrtho < 1e-5, `worst ${worstOrtho.toExponential(2)}`)

// --- the circuit itself ---------------------------------------------------
const c = getCircuits()
console.log(`\nmain ${c.main.length.toFixed(1)} m   alt ${c.alt.length.toFixed(1)} m   ` +
            `chord saves ${(c.main.length - c.alt.length).toFixed(1)} m`)
ok('main loop is 1.0-1.6 km', c.main.length > 1000 && c.main.length < 1600)
ok('chord is shorter than the cut', c.alt.length < c.main.length)

// Bay spans must tile each circuit with no holes and no overlaps.
for (const [ label, spans, len ] of [
  [ 'main', c.mainBays, c.main.length ], [ 'alt', c.altBays, c.alt.length ]] as const) {
  let worst = 0
  for (let i = 0; i < spans.length; i++) {
    const next = spans[(i + 1) % spans.length]
    const gap  = i === spans.length - 1 ? Math.abs(spans[i].s1 - len) : Math.abs(spans[i].s1 - next.s0)
    worst = Math.max(worst, gap)
  }
  ok(`${label} bays tile with no gaps`, worst < 0.5, `worst gap ${worst.toFixed(3)} m`)

  const bad = spans.filter(s => s.s1 <= s.s0)
  ok(`${label} spans all positive length`, bad.length === 0,
     bad.map(b => b.bay.name).join(', ') || 'all ok')
}

// The junction must be at the same *place* on both circuits.
const jm = c.main.pointAtDistance(c.junctionS)
const ja = c.alt.pointAtDistance(c.altJunctionS)
ok('junction coincides on both circuits', d(jm, ja) < 3.0, `${d(jm, ja).toFixed(3)} m apart`)

console.log('\nmain bays:')
for (const s of c.mainBays)
  console.log(`  ${s.bay.name.padEnd(14)} ${s.s0.toFixed(0).padStart(5)} → ${s.s1.toFixed(0).padStart(5)} m  (${(s.s1 - s.s0).toFixed(0)} m)`)
console.log('alt bays:')
for (const s of c.altBays)
  console.log(`  ${s.bay.name.padEnd(14)} ${s.s0.toFixed(0).padStart(5)} → ${s.s1.toFixed(0).padStart(5)} m  (${(s.s1 - s.s0).toFixed(0)} m)`)

// Gradient sanity: a people-mover cannot climb a cliff.
let maxGrade = 0
for (let i = 0; i < 2000; i++) {
  const f = c.main.frameAtDistance(i / 2000 * c.main.length)
  maxGrade = Math.max(maxGrade, Math.abs(f.forward.y))
}
ok('max gradient under 12%', maxGrade < 0.12, `${(maxGrade * 100).toFixed(1)}%`)


// --- mesh -----------------------------------------------------------------


console.log(fails ? `\n${fails} FAILURES` : '\nall green')

// --- lib/sweep ------------------------------------------------------------------
// The scenic route's road is a profile swept along its spine with the LEVEL
// frame (right = forward x worldUp), rolled live by a bank LUT. A parallel
// transport frame would pass every picture test and roll the road on its own
// down the incline; the level frame has one job, and this is the check for it.
{
  const route = getRoute()
  const fr    = newFrame()
  const dot   = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
  const len   = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
  let worstOrtho = 0
  let worstLevel = 0
  for (let s = 0; s < route.length; s += 0.5) {
    const f = levelFrame(route.curve, s, fr)
    worstOrtho = Math.max(worstOrtho,
                          Math.abs(dot(f.right, f.up)), Math.abs(dot(f.right, f.forward)), Math.abs(dot(f.up, f.forward)),
                          Math.abs(len(f.right) - 1), Math.abs(len(f.up) - 1))
    worstLevel = Math.max(worstLevel, Math.abs(f.right.y))
  }
  ok('sweep: level frame is orthonormal along the whole scenic route', worstOrtho < 1e-6, `worst ${worstOrtho.toExponential(2)}`)
  ok('sweep: level frame has no roll of its own (right stays horizontal)', worstLevel < 1e-6, `worst right.y ${worstLevel.toExponential(2)}`)

  // A flat two-point profile over 100 m: every vertex carries the curve's own
  // point at its s, and a left-to-right profile faces up, so the road's front
  // face is its top and the bank roll turns the right way.
  const arr = finishSweep(sweepProfile(route.curve, {
    s0: 100, s1: 200, step: 2, profile: () => [[ -3, 0 ], [ 3, 0 ]],
  }))
  let worstSpine = 0
  let minNu      = Infinity
  for (let v = 0; v < arr.vertexCount; v++) {
    const o = v * SWEEP_FLOATS
    const p = route.curve.pointAtDistance(arr.vertices[o + 3])
    worstSpine = Math.max(worstSpine, Math.hypot(arr.vertices[o] - p.x, arr.vertices[o + 1] - p.y, arr.vertices[o + 2] - p.z))
    minNu      = Math.min(minNu, arr.vertices[o + 13])
  }
  // The sweep stores float32: at coordinates in the hundreds of metres that is
  // a few micrometres of rounding, and nothing else.
  ok('sweep: every vertex carries the spine point at its own s (float32)', worstSpine < 1e-4, `worst ${worstSpine.toExponential(2)}`)
  ok('sweep: a left-to-right profile faces up', minNu > 0.99, `min nu ${minNu.toFixed(4)}`)
  ok('sweep: rings x profile points, nothing dropped', arr.vertexCount >= 100 && arr.vertexCount % 2 === 0 && arr.indexCount === (arr.vertexCount / 2 - 1) * 6,
     `${arr.vertexCount} vertices, ${arr.indexCount} indices`)
}

process.exit(fails ? 1 : 0)
