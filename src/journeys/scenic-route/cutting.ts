// THE SCENIC ROUTE — the incline's earthworks.
//
// The lift hill used to climb a grass embankment the corridor pull laid under
// it: a smooth lime bank on either side and a white verge, all the way up. The
// spec has it climb through a rock cutting, then between retaining walls, then
// into the first facades. This is that, built once, on the CPU:
//
//   * a cross-section per side, swept along the road (geometry/sweep), from
//     under the verge, down into a ditch, up a face and out over its top onto
//     the land behind it;
//   * the face is blasted rock first, battered back and benched halfway up
//     where it is tall, and from WALL_FROM on a near vertical concrete wall;
//   * the land beside the road is raised to the face's top (`cutAt`, read by
//     the corridor pull in geometry.ts), so the face meets ground and not air.
//
// The cross-section's every point is an offset in the road's *level* frame, as
// the road is; the vertex shader rolls the foot with the road's bank and leaves
// the top where the land is (shader/cutting.ts), so a banked lap 3 does not
// tilt a wall out of the ground.

import { finishSweep, sweepProfile } from '@wjh/geometry/sweep'
import type { ProfilePoint, SweepArrays } from '@wjh/geometry/sweep'
import { smoothstep } from '@wjh/math/scalar'
import type { Route } from './course'

/** (metres past the incline's start, face height) knots, eased knot to knot. */
const HEIGHT: [ number, number ][] = [
  [ 10, 0 ], [ 48, 11 ], [ 105, 13.5 ], [ 165, 10 ], [ 196, 6.5 ],
  [ 270, 5.8 ], [ 350, 4.6 ], [ 400, 3.2 ], [ 432, 0 ],
]

/** Where the rock gives way to the walls, metres past the incline's start. */
const WALL_FROM = 188

/** Road half width on the incline. The face is measured out from it. */
const HALF = 3.6

/** The face's foot: past the verge (to 2.2) and a ditch. */
const FOOT = HALF + 3.4

/** How far the top lip runs out over the land behind the face. */
const TAIL = 7

/** Points up the face below the bench and above it. */
const LOWER = 6
const UPPER = 4

/** Points in a cross-section; every call must return the same number. */
const POINTS = 3 + LOWER + 1 + UPPER + 2

/** The face at one arc length; `cutAt` fills and returns this one object. */
const cut: CutAt = { h: 0, top: FOOT, ditch: 0.5 }

export interface CutAt {

  /** Face height above the road, metres; 0 where there is no face. */
  h: number;

  /** Horizontal distance from the spine to the face's top edge. */
  top: number;

  /** Horizontal distance from the spine past which the land sinks under the road and the ditch. */
  ditch: number;
}

function heightAt (t: number): number {
  if (t <= HEIGHT[0][0] || t >= HEIGHT[HEIGHT.length - 1][0])
    return 0

  let i = 0
  while (t > HEIGHT[i + 1][0])
    i++

  const [ t0, h0 ] = HEIGHT[i]
  const [ t1, h1 ] = HEIGHT[i + 1]
  return h0 + (h1 - h0) * smoothstep(t0, t1, t)
}

/** 0 for rock, 1 for the concrete walls. */
function wallWeight (t: number): number {
  return smoothstep(WALL_FROM - 0.6, WALL_FROM + 0.6, t)
}

/** The face: how steep it is and where it is benched, from its height and kind. */
function shape (h: number, wall: number) {
  // Rock is battered back about 1 in 4.5; a retaining wall about 1 in 25.
  const batter = 0.22 + (0.04 - 0.22) * wall
  // A bench halfway up a tall rock face catches what falls off the top half.
  const bench = 1.8 * smoothstep(7, 9.5, h) * (1 - wall)
  const mid   = h * 0.55
  const top   = FOOT + batter * h + bench
  return { batter, bench, mid, top }
}

/** The face at s: its height and top edge, for the land and the props beside it. */
export function cutAt (route: Route, s: number): CutAt {
  const t = s - route.spans[1].s0
  const h = heightAt(t)
  cut.h   = h
  cut.top = shape(h, wallWeight(t)).top
  return cut
}

/** The arc length the walls start at; the fragment shader switches material there. */
export function wallStart (route: Route): number {
  return route.spans[1].s0 + WALL_FROM
}

/**
 * The right-hand cross-section at s, walked foot to tail so the face looks at
 * the road. The left side is its mirror walked the other way.
 */
function section (route: Route, s: number): ProfilePoint[] {
  const t                           = s - route.spans[1].s0
  const h                           = heightAt(t)
  const { batter, bench, mid, top } = shape(h, wallWeight(t))
  // Where the face has no height the lip and tail sink under the land, so the
  // sweep's ends do not leave a sheet lying on the grass.
  const g                   = smoothstep(0, 1.5, h)
  const sink                = -0.35 * (1 - g)
  const pts: ProfilePoint[] = [
    [ HALF + 1.9, -0.36 ], [ HALF + 2.7, -0.72 ], [ FOOT, -0.25 ],
  ]
  for (let k = 1; k <= LOWER; k++) {
    const u = -0.25 + (mid + 0.25) * k / LOWER
    pts.push([ FOOT + batter * (u + 0.25), u ])
  }

  const back = FOOT + batter * (mid + 0.25) + bench
  pts.push([ back, mid + 0.05 * g ])
  for (let k = 1; k <= UPPER; k++) {
    const u = mid + (h - mid) * k / UPPER
    pts.push([ back + batter * (u - mid), u ])
  }
  pts.push([ top + 0.6, h + 0.2 * g + sink ], [ top + TAIL, h + 0.05 * g + sink ])
  return pts
}

/** Distance along a profile polyline to its point k, as the sweep measures its edge param. */
function edgeTo (pts: ProfilePoint[], k: number): number {
  let e = 0
  for (let i = 1; i <= k; i++)
    e += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return e
}

/**
 * Both faces, one mesh. The section attribute carries where the face's top
 * edge is along the profile (signed by side, since the left one is walked from
 * its tail), so the fragment shader can tell face, coping and the turf behind.
 */
export function buildCutting (route: Route): SweepArrays {
  const s0    = route.spans[1].s0 + HEIGHT[0][0]
  const s1    = route.spans[1].s0 + HEIGHT[HEIGHT.length - 1][0]
  const TOP   = POINTS - 3
  const right = (s: number) => section(route, s)
  const left  = (s: number) => right(s)
    .map(([ r, u ]): ProfilePoint => [ -r, u ])
    .reverse()

  const arrays = sweepProfile(route.curve, {
    s0,
    s1,
    step:      1,
    profile:   right,
    sectionAt: s => edgeTo(right(s), TOP),
  })
  sweepProfile(route.curve, {
    s0,
    s1,
    step:      1,
    profile:   left,
    into:      arrays,
    sectionAt: s => {
      const pts = right(s)
      return -(edgeTo(pts, POINTS - 1) - edgeTo(pts, TOP))
    },
  })
  return finishSweep(arrays)
}
