import { Theme } from '../stations'
import { SurfaceKey } from './surfaces'

// --- profiles ----------------------------------------------------------------

/** One section point: right, up (metres), the surface of the edge leaving it, and options. */
export interface PP {
  r:       number;
  u:       number;
  s:       SurfaceKey;
  ao?:     number;
  smooth?: boolean;
}

const pp = (r: number, u: number, s: SurfaceKey, ao = 1, smooth = false): PP =>
  ({ r, u, s, ao, smooth })

export interface Profile {
  points: PP[];
  closed: boolean;
}

/** An arc of points, anticlockwise from a0 to a1 (radians), all smooth. */
function arc (cr: number, cu: number, rr: number, ru: number, a0: number, a1: number,
  n: number, s: SurfaceKey, ao = 1): PP[] {
  const out: PP[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n)
    out.push(pp(cr + Math.cos(a) * rr, cu + Math.sin(a) * ru, s, ao, true))
  }
  return out
}

/**
 * The cross-sections. +r is the curve's `right`, which on this circuit is the
 * inside of the loop: the chord leaves to the right, so the two halls it
 * passes through are wide on the right.
 */
export function profilesFor (theme: Theme): Profile[] {
  switch (theme) {
    case Theme.STATION:
      // Walk it the way a wheel would: trackbed, up the platform riser, out
      // across the platform, up the back wall, back along the ceiling, down the
      // trackside wall. Trace the riser outward first and you build a wall in
      // front of the platform, hiding the thing the bay is named for.
      return [{
        closed: true,
        points: [
          pp(-3.7, -0.38, 'ballast', 0.55),
          pp(1.3, -0.38, 'concreteDim', 0.5),
          pp(1.3, 0.92, 'coping'),
          pp(1.62, 0.92, 'yellow'),
          pp(2.15, 0.92, 'floor'),
          pp(9.6, 0.92, 'tile', 0.6),
          pp(9.6, 3.6, 'plaster'),
          pp(9.6, 5.5, 'panel', 0.8),
          pp(8.8, 6.3, 'panel', 0.85),
          pp(-3, 6.3, 'panel', 0.85),
          pp(-3.7, 5.6, 'tile', 0.8),
        ],
      }]
    case Theme.TUBE: {
      // A bored tube: a circle with its invert filled to a flat trackbed.
      const R    = 2.9,
        cu       = 1.55
      const a0   = Math.atan2(-0.38 - cu, Math.sqrt(R * R - (cu + 0.38) ** 2))
      const half = Math.sqrt(R * R - (cu + 0.38) ** 2)
      const ring = arc(0, cu, R, R, a0, Math.PI - a0, 30, 'lining')
      // The invert meets the lining at a corner, not a curve: leave it sharp
      // or the trackbed's normal bends up into the wall.
      ring[0].smooth = false
      return [
        { closed: true, points: [ pp(-half, -0.38, 'concreteDim', 0.55), ...ring.slice(0, -1) ]},
        // Cable runs on hangers along the left wall: four thin closed circles,
        // walked clockwise so they face out.
        ...[ 0, 1, 2, 3 ].map(k => ({
          closed: true,
          points: arc(-2.35 + k * 0.03, 0.95 + k * 0.16, 0.045, 0.045, 0, -Math.PI * 2 + 0.6, 6, 'black'),
        })),
      ]
    }

    case Theme.CONCOURSE: {
      // A tall vaulted hall, wide to the right where the chord diverges. The
      // track runs on the hall floor; walkways stand along both walls with a
      // mezzanine gallery over them.
      const L     = -12,
        R         = 24,
        spring    = 8.6
      const vault = arc((L + R) / 2, spring, (R - L) / 2, 7.4, 0, Math.PI, 16, 'panel', 0.9)
      return [{
        closed: true,
        points: [
          pp(-9, -0.38, 'concreteDim', 0.7),
          pp(21, -0.38, 'concrete', 0.55),
          pp(21, 1, 'terrazzo'),
          pp(R, 1, 'plaster', 0.6),
          pp(R, 5, 'panelDark', 0.7),
          pp(R - 3.2, 5, 'darkGrey'),
          pp(R - 3.2, 5.6, 'terrazzo'),
          pp(R, 5.6, 'plaster', 0.6),
          ...vault.slice(0, -1),
          pp(L, spring, 'plaster'),
          pp(L, 5.6, 'terrazzo', 0.6),
          pp(L + 3.2, 5.6, 'darkGrey'),
          pp(L + 3.2, 5, 'panelDark'),
          pp(L, 5, 'plaster', 0.7),
          pp(L, 1, 'terrazzo', 0.6),
          pp(-9, 1, 'concrete'),
        ],
      }]
    }
    case Theme.CUT:
      // An open trench under the day. Ten metres of retaining wall is what
      // makes it a cutting rather than a ditch: from a seat at two metres the
      // world above is only ever a strip of sky.
      return [{
        closed: false,
        points: [
          pp(-60, 10.4, 'dirt'),
          pp(-8.6, 10.4, 'coping'),
          pp(-8, 10.1, 'panel', 0.9),
          pp(-5, -0.38, 'ballast', 0.55),
          pp(5, -0.38, 'panel', 0.55),
          pp(8, 10.1, 'coping', 0.9),
          pp(8.6, 10.4, 'dirt'),
          pp(60, 10.4, 'dirt'),
        ],
      }]
    case Theme.ANNEX:
      // A low, wide hall, the floor a single slab the water can lie on.
      return [{
        closed: true,
        points: [
          pp(-10, -0.38, 'concreteWet', 0.65),
          pp(22, -0.38, 'plasterDamp', 0.55),
          pp(22, 4.9, 'panelDark', 0.7),
          pp(-10, 4.9, 'plasterDamp', 0.7),
        ],
      }]
    case Theme.VIADUCT:
      // The deck between two brick parapets, traced as an open section so the
      // parapets' outer faces look outward and their inner faces at the track.
      return [{
        closed: false,
        points: [
          pp(-4.1, -2.8, 'brick'),
          pp(-4.1, 1.15, 'coping'),
          pp(-3.5, 1.15, 'brick', 0.9),
          pp(-3.5, -0.38, 'ballast', 0.55),
          pp(3.5, -0.38, 'brick', 0.55),
          pp(3.5, 1.15, 'coping', 0.9),
          pp(4.1, 1.15, 'brick'),
          pp(4.1, -2.8, 'brick'),
        ],
      }, {
        // The soffit, for the arches seen from afar.
        closed: false,
        points: [ pp(4.1, -2.8, 'brickSoot'), pp(-4.1, -2.8, 'brickSoot') ],
      }]
    case Theme.STACKS:
      return [{
        closed: true,
        points: [
          pp(-7.2, -0.38, 'floor', 0.6),
          pp(7.2, -0.38, 'panelDark', 0.6),
          pp(7.2, 4.6, 'panelDark', 0.75),
          pp(-7.2, 4.6, 'panelDark', 0.75),
        ],
      }, {
        // The building's outside, for THE VIADUCT to look at: walked clockwise.
        closed: true,
        points: [
          pp(-26, -18, 'corrugated'),
          pp(-26, 13, 'concreteDim'),
          pp(26, 13, 'corrugated'),
          pp(26, -18, 'corrugated'),
        ],
      }, {
        // Overhead cable trays, seen from below: a U walked clockwise so its
        // underside and outer flanks face the aisle.
        closed: false,
        points: [ pp(-3.6, 3.9, 'steel'), pp(-3.6, 3.6, 'steel'), pp(-5.4, 3.6, 'steel'), pp(-5.4, 3.9, 'steel') ],
      }, {
        closed: false,
        points: [ pp(5.4, 3.9, 'steel'), pp(5.4, 3.6, 'steel'), pp(3.6, 3.6, 'steel'), pp(3.6, 3.9, 'steel') ],
      }]
    case Theme.DEPOT:
      return [{
        closed: false,
        points: [
          pp(-90, -0.42, 'dirt'),
          pp(-21, -0.42, 'ballastDark'),
          pp(21, -0.42, 'dirt'),
          pp(90, -0.42, 'dirt'),
        ],
      }]
    case Theme.TRESTLE:
      // A plate deck seen from above and below: a closed thin slab, walked
      // clockwise so every face looks out.
      return [{
        closed: true,
        points: [
          pp(-2.4, -0.3, 'steel'),
          pp(2.4, -0.3, 'steel'),
          pp(2.4, -0.95, 'steel'),
          pp(-2.4, -0.95, 'steel'),
        ],
      }]
    case Theme.CHORD:
    default: {
      // A horseshoe bore in old brick, wet underfoot.
      const crown = arc(0, 1.7, 3.3, 3.1, 0, Math.PI, 14, 'brickSoot', 0.9)
      return [{
        closed: true,
        points: [
          pp(-3.1, -0.38, 'ballastWet', 0.5),
          pp(3.1, -0.38, 'brickSoot', 0.5),
          pp(3.3, 1.7, 'brickSoot'),
          ...crown.slice(1, -1),
          pp(-3.3, 1.7, 'brickSoot'),
        ],
      }]
    }
  }
}

/**
 * The earth behind a wall: the bay's main section pushed outward and left
 * whole. A fractured wall opens gaps, and what a gap in a tunnel shows is not
 * the sky — it is the ground the tunnel was dug through. Without this layer
 * the sky map behind everything showed through every crack as white glass.
 * Bays built in the air (the viaduct, the trestle) have nothing behind them,
 * and their gaps rightly show what is out there.
 */
export function rockLayer (theme: Theme, depth = 1.6): Profile | null {
  if (theme === Theme.VIADUCT || theme === Theme.TRESTLE)
    return null

  const main     = profilesFor(theme)[0]
  const pts      = main.points
  const n        = pts.length
  const normalOf = (a: PP, b: PP): [ number, number ] => {
    const dr = b.r - a.r,
      du     = b.u - a.u
    const l  = Math.hypot(dr, du) || 1
    return [ -du / l, dr / l ]
  }
  const points = pts.map((p, i) => {
    const hasPrev = main.closed || i > 0
    const hasNext = main.closed || i < n - 1
    const a       = hasPrev ? normalOf(pts[(i - 1 + n) % n], p) : null
    const b       = hasNext ? normalOf(p, pts[(i + 1) % n]) : null
    let nr = (a?.[0] ?? 0) + (b?.[0] ?? 0)
    let nu = (a?.[1] ?? 0) + (b?.[1] ?? 0)
    const l = Math.hypot(nr, nu) || 1
    nr /= l
    nu /= l
    return pp(p.r - nr * depth, p.u - nu * depth, 'void' as SurfaceKey, 1, false)
  })
  return { closed: main.closed, points }
}

/**
 * The opening a bay presents to the bay before it, as a polygon in the wall
 * plane (right, up). Used to cut the portal in a headwall; null where a bay
 * has no mouth to speak of.
 */
export function portalFor (theme: Theme): [ number, number ][] | null {
  const rectArch = (hw: number, h: number, rise: number): [ number, number ][] => {
    const pts: [ number, number ][] = [[ -hw, -0.6 ], [ hw, -0.6 ], [ hw, h ]]
    for (let i = 1; i < 10; i++) {
      const a = i / 10 * Math.PI
      pts.push([ Math.cos(a) * hw, h + Math.sin(a) * rise ])
    }
    pts.push([ -hw, h ])
    return pts
  }
  switch (theme) {
    case Theme.STATION: return rectArch(3.9, 4.6, 1.5)
    case Theme.TUBE: {
      const pts: [ number, number ][] = []
      for (let i = 0; i < 24; i++) {
        const a = -Math.PI / 2 + i / 24 * Math.PI * 2
        pts.push([ Math.cos(a) * 2.95, Math.max(-0.6, 1.55 + Math.sin(a) * 2.95) ])
      }
      return pts
    }
    case Theme.CUT: return [[ -4.9, -0.6 ], [ 4.9, -0.6 ], [ 4.9, 6.4 ], [ -4.9, 6.4 ]]
    case Theme.ANNEX: return [[ -4.6, -0.6 ], [ 4.6, -0.6 ], [ 4.6, 4.6 ], [ -4.6, 4.6 ]]
    case Theme.VIADUCT: return rectArch(4.4, 3.8, 1.8)
    case Theme.STACKS: return [[ -4.4, -0.6 ], [ 4.4, -0.6 ], [ 4.4, 4.5 ], [ -4.4, 4.5 ]]
    case Theme.CHORD: return rectArch(3.3, 1.7, 3.1)
    default: return null
  }
}

// --- the sweep -----------------------------------------------------------------

/**
 * Insert points beside concave corners and darken the corners themselves.
 * Concave, seen from the front, is a left turn: the front is on the left of
 * the walk, so turning toward it folds the surface in on the viewer.
 */
export function refine (profile: Profile): PP[] {
  const src     = profile.points
  const n       = src.length
  const concave = src.map((p, i) => {
    if (!profile.closed && (i === 0 || i === n - 1))
      return false

    const a     = src[(i - 1 + n) % n]
    const b     = src[(i + 1) % n]
    const e1r   = p.r - a.r,
      e1u       = p.u - a.u
    const e2r   = b.r - p.r,
      e2u       = b.u - p.u
    const cross = e1r * e2u - e1u * e2r
    const l1    = Math.hypot(e1r, e1u),
      l2        = Math.hypot(e2r, e2u)
    return !p.smooth && l1 > 1e-6 && l2 > 1e-6 && cross / (l1 * l2) > 0.35
  })

  const out: PP[] = []
  const edges     = profile.closed ? n : n - 1
  for (let i = 0; i < n; i++) {
    const p = src[i]
    out.push({ ...p, ao: (p.ao ?? 1) * (concave[i] ? 0.42 : 1) })
    if (i >= edges)
      continue

    const q    = src[(i + 1) % n]
    const len  = Math.hypot(q.r - p.r, q.u - p.u)
    const lerp = (t: number, ao: number): PP => ({
      r:      p.r + (q.r - p.r) * t,
      u:      p.u + (q.u - p.u) * t,
      s:      p.s,
      ao:     ((p.ao ?? 1) + ((q.ao ?? 1) - (p.ao ?? 1)) * t) * ao,
      smooth: false,
    })
    // Beside a darkened corner, two extra points carry the gradient out into
    // the face; without them the interpolation smears a corner's occlusion
    // across a whole wall.
    if (len > 1.4) {
      if (concave[i]) {
        out.push(lerp(0.22 / len, 0.66))
        out.push(lerp(0.7 / len, 0.88))
      }
      if (concave[(i + 1) % n]) {
        out.push(lerp(1 - 0.7 / len, 0.88))
        out.push(lerp(1 - 0.22 / len, 0.66))
      }
    }
  }
  return out
}
