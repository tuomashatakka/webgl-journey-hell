// THE LOOP LINE — the world, as triangles.
//
// Everything here runs once, at construction. The world does not rebuild when
// it breaks: it is displaced in the vertex shader from buffers uploaded on the
// first frame and never re-sent, which is why the last lap costs what the first
// did.
//
// ---------------------------------------------------------------------------
// Sweeping a profile
// ---------------------------------------------------------------------------
//
// Almost every surface on the circuit is one operation: a 2D cross-section in
// (right, up) metres, dragged along an arc-length span of the curve. Three
// things about it are easy to get wrong:
//
//   * **Front faces are on the left of the walking direction.** Walk a room's
//     section anticlockwise (floor left to right, up the right wall, back along
//     the ceiling) and every face looks inward; walk a solid clockwise and every
//     face looks out. One rule, no facing flag, and the winding of each quad is
//     checked against the normal it is supposed to have rather than trusted.
//   * **Texture axes follow the world, not the section.** u runs along the track
//     in metres. v runs *up* a wall and *across* a floor, so a brick course is
//     horizontal on both walls of a bore whichever way round the section was
//     drawn. Only a smooth run — a tube, a vault — takes v from the perimeter,
//     because there "up" stops meaning anything halfway round.
//   * **Ambient occlusion is baked into the section.** A rasterizer with no
//     shadows has nothing darkening the line where floor meets wall, and that
//     line is most of what makes a room read as solid. Concave corners are
//     found from the turn direction, extra points are inserted beside them, and
//     the occlusion rides in the *length* of the vertex normal — the shader
//     reads length(vNormal) before normalising. No new attribute, and a shard
//     rotating the normal leaves its length alone.
//
// Props are unit meshes built once at the origin and placed by instance: x is
// left, y up, z forward (a proper rotation of the curve's frame — the curve's
// own `right` is −x, and a basis built on it would be a reflection that turns
// every prop inside out).

import { createMeshBuilder, fracture } from '✦/lib/meshBuilder'
import type { MeshBuilder } from '✦/lib/meshBuilder'
import { mulberry32 } from '✦/lib/rng'
import type { ClosedCurve, Frame } from '✦/lib/curve'
import { MAT } from 'Δ'
import { Theme } from './stations'


// --- surfaces ----------------------------------------------------------------

/** How the fragment shader treats a draw. Mirrored as `MODE_*` in shader.ts. */
export const enum Mode {
  TEXTURED = 0,
  PAINT = 1,
  EMISSIVE = 2,
  WINDOWS = 3,
  RACK = 4,
  CARRIAGE = 5,
  SIGNAL = 6,
  POSTER = 7,
  RAIL = 8,
}

export interface Surface {

  /** Δ material layer, or -1 for flat paint. */
  layer: number;

  /** Albedo multiplier (linear), or the paint colour. */
  tint: [ number, number, number ];

  /** Roughness multiplier for a layer, absolute roughness for paint. */
  rough: number;
  metal: number;
  mode:  Mode;

  /** Self-illumination, linear HDR. */
  glow: [ number, number, number ];

  /** Parallax occlusion on this surface. Off for anything thin or far. */
  pom: boolean;
}

const tex = (layer: number, tint: [ number, number, number ] = [ 1, 1, 1 ], o: Partial<Surface> = {}): Surface =>
  ({ layer, tint, rough: 1, metal: 0, mode: Mode.TEXTURED, glow: [ 0, 0, 0 ], pom: true, ...o })

const paint = (tint: [ number, number, number ], rough = 0.6, o: Partial<Surface> = {}): Surface =>
  ({ layer: -1, tint, rough, metal: 0, mode: Mode.PAINT, glow: [ 0, 0, 0 ], pom: false, ...o })

const glow = (c: [ number, number, number ], mode = Mode.EMISSIVE): Surface =>
  ({ layer: -1, tint: [ 0.9, 0.9, 0.9 ], rough: 0.3, metal: 0, mode, glow: c, pom: false })

/** Every surface on the line, by name. Profiles and props refer to these keys. */
export const SURF = {
  tile:        tex(MAT.TILE, [ 0.96, 0.92, 0.82 ]),
  tileGreen:   tex(MAT.TILE, [ 0.55, 0.72, 0.62 ]),
  floor:       tex(MAT.FLOOR, [ 0.78, 0.76, 0.72 ]),
  terrazzo:    tex(MAT.TERRAZZO, [ 0.86, 0.84, 0.8 ]),
  panel:       tex(MAT.PANEL, [ 0.9, 0.9, 0.88 ]),
  panelDark:   tex(MAT.PANEL, [ 0.42, 0.42, 0.42 ]),
  concrete:    tex(MAT.CONCRETE, [ 0.85, 0.84, 0.82 ]),
  concreteDim: tex(MAT.CONCRETE, [ 0.48, 0.47, 0.45 ]),
  concreteWet: tex(MAT.CONCRETE, [ 0.3, 0.31, 0.3 ], { rough: 0.35 }),
  brick:       tex(MAT.BRICK, [ 0.92, 0.84, 0.8 ]),
  brickSoot:   tex(MAT.BRICK, [ 0.36, 0.32, 0.3 ], { rough: 0.8 }),
  ballast:     tex(MAT.BALLAST, [ 0.72, 0.7, 0.68 ]),
  ballastDark: tex(MAT.BALLAST, [ 0.34, 0.33, 0.32 ]),
  ballastWet:  tex(MAT.BALLAST, [ 0.22, 0.22, 0.22 ], { rough: 0.45 }),
  steel:       tex(MAT.STEEL, [ 0.62, 0.62, 0.64 ], { pom: false }),
  lining:      tex(MAT.STEEL, [ 0.3, 0.29, 0.28 ], { rough: 1.1 }),
  corrugated:  tex(MAT.CORRUGATED, [ 0.75, 0.78, 0.8 ]),
  corrugRust:  tex(MAT.CORRUGATED, [ 0.62, 0.48, 0.4 ]),
  wood:        tex(MAT.WOOD, [ 0.55, 0.48, 0.42 ], { pom: false }),
  rock:        tex(MAT.ROCK, [ 0.62, 0.6, 0.58 ]),
  plaster:     tex(MAT.PLASTER, [ 0.88, 0.86, 0.82 ]),
  plasterDamp: tex(MAT.PLASTER, [ 0.55, 0.62, 0.58 ]),
  hazard:      tex(MAT.HAZARD, [ 1, 1, 1 ], { pom: false }),
  dirt:        tex(MAT.DIRT, [ 0.8, 0.78, 0.74 ]),
  coping:      tex(MAT.CONCRETE, [ 1.1, 1.08, 1.04 ], { pom: false }),

  void:      paint([ 0, 0, 0 ], 1),
  yellow:    paint([ 0.8, 0.56, 0.04 ], 0.55),
  white:     paint([ 0.86, 0.86, 0.84 ], 0.45),
  black:     paint([ 0.018, 0.018, 0.02 ], 0.55),
  darkGrey:  paint([ 0.06, 0.06, 0.065 ], 0.5),
  green:     paint([ 0.04, 0.16, 0.08 ], 0.5),
  red:       paint([ 0.62, 0.04, 0.03 ], 0.45),
  blue:      paint([ 0.02, 0.06, 0.32 ], 0.45),
  greyPaint: paint([ 0.3, 0.31, 0.32 ], 0.5, { metal: 0.3 }),
  cream:     paint([ 0.72, 0.68, 0.58 ], 0.7),

  rail:   { ...tex(MAT.STEEL, [ 0.55, 0.5, 0.46 ], { pom: false }), mode: Mode.RAIL },
  poster: { ...paint([ 1, 1, 1 ], 0.35), mode: Mode.POSTER },

  fluoro:       glow([ 5.5, 5.3, 4.8 ]),
  sodium:       glow([ 9, 4.6, 1.4 ]),
  bulb:         glow([ 7, 4.6, 2.2 ]),
  cold:         glow([ 2.4, 3.6, 6 ]),
  greenTube:    glow([ 3, 5.2, 4.2 ]),
  redLamp:      glow([ 8, 0.7, 0.4 ], Mode.SIGNAL),
  signal:       glow([ 1, 1, 1 ], Mode.SIGNAL),
  sign:         glow([ 2, 2, 2 ]),
  windows:      { ...tex(MAT.PANEL, [ 0.42, 0.4, 0.38 ], { pom: false }), mode: Mode.WINDOWS },
  windowsBrick: { ...tex(MAT.BRICK, [ 0.4, 0.33, 0.3 ], { pom: false }), mode: Mode.WINDOWS },
  rack:         { ...tex(MAT.STEEL, [ 0.1, 0.1, 0.11 ], { pom: false }), mode: Mode.RACK },
  carriage:     { ...paint([ 0.55, 0.56, 0.58 ], 0.4, { metal: 0.4 }), mode: Mode.CARRIAGE },
} satisfies Record<string, Surface>

export type SurfaceKey = keyof typeof SURF

// --- profiles ----------------------------------------------------------------

/** One section point: right, up (metres), the surface of the edge leaving it, and options. */
export interface PP {
  r:       number;
  u:       number;
  s:       SurfaceKey;
  ao?:     number;
  smooth?: boolean;
}

export const pp = (r: number, u: number, s: SurfaceKey, ao = 1, smooth = false): PP =>
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

function newFrame (): Frame {
  return {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }
}

/**
 * Insert points beside concave corners and darken the corners themselves.
 * Concave, seen from the front, is a left turn: the front is on the left of
 * the walk, so turning toward it folds the surface in on the viewer.
 */
function refine (profile: Profile): PP[] {
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

// --- unit props -----------------------------------------------------------------

/** A flat disc or ring in the local xy plane, facing +z, both sides. */
function disc (b: MeshBuilder, r0: number, r1: number, z: number, seg: number): void {
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
function cylY (b: MeshBuilder, x: number, y0: number, y1: number, z: number, r: number, seg = 10): void {
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
function sphere (b: MeshBuilder, x: number, y: number, z: number, r: number, seg = 8): void {
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
function ribRing (b: MeshBuilder, cu: number, r: number, depth: number, width: number, seg: number, a0: number, a1: number): void {
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
