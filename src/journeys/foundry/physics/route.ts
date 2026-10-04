import { WALK_START } from './constants'

// --- the loop (mirrored by the shader) --------------------------------------

/** Section length, metres. Seven halls of this length make up one lap. */
export const SECTION_LEN = 36

export const SECTION_COUNT = 7

/** One full circuit of the foundry, metres. Geometry is periodic in this. */
export const CYCLE_LEN = SECTION_LEN * SECTION_COUNT

// >1 = progressively stiffer as it compresses

// --- the stepping stones (mirrored by the shader) ---------------------------
//
// The furnace floor is cut away over the melt and the only way across is a
// single steel plate that lays itself out ahead of you, one tile at a time.
//
// It is one plate, not a line of them. Each tile arrives by rotating a half
// turn about the edge it shares with the tile before it — the thing tumbles end
// over end across the gap, and the tile you are standing on is the hinge for
// the next one. That is the whole reason the route is on a grid and every step
// is exactly one tile: edge-adjacency is what makes the flip possible, and a
// flip about a *side* edge instead of the leading one is how the path turns.

/** Tiles in the span. */
export const SPAN_TILES = 16

/** Plate half-size. The step between tiles is 2× this — they share an edge. */
export const TILE_HALF = 1.2

export const TILE = TILE_HALF * 2

/** Cyclic position of tile 0's centre, in the furnace-floor hall. */
const SPAN_Z0 = 219

/**
 * The route, in grid steps of TILE. Lateral first, then forward.
 *
 * Read it as moves and it is: forward, forward, hard left twice out to the wall,
 * forward twice, then four tiles straight across the hall, and five more up the
 * far side to the lip. It starts on the centreline and finishes against the
 * opposite wall, which is the shape the crossing is meant to have — you are not
 * bridging the gap, you are being walked around it.
 *
 * Invariant, asserted by the tests: consecutive entries differ by exactly one
 * step in exactly one axis, and `iz` never decreases.
 */
const SPAN_IX = [ 0, 0, 0, -1, -2, -2, -2, -1, 0, 1, 2, 2, 2, 2, 2, 2 ]

const SPAN_IZ = [ 0, 1, 2, 2, 2, 3, 4, 4, 4, 4, 4, 5, 6, 7, 8, 9 ]

/** Metres of walking across the span, and how much of that is forward travel. */
export const SPAN_ARC = (SPAN_TILES - 1) * TILE

const SPAN_Z_RUN = SPAN_IZ[SPAN_TILES - 1] * TILE

/**
 * The lateral legs buy no forward progress, so a lap is this much longer to walk
 * than it is round. Everything that measures the lap in *distance walked* has to
 * use LAP_ARC; everything that measures it in *where you are* still uses
 * CYCLE_LEN. Conflating the two is what would make the walk drift off the tiles.
 */
export const SPAN_EXTRA = SPAN_ARC - SPAN_Z_RUN

export const LAP_ARC = CYCLE_LEN + SPAN_EXTRA

/**
 * Half-width of the furnace-floor hall, and how far the decay closes it in.
 *
 * These live here rather than only in the shader's secProfile because the span
 * has to *fit* in the hall it crosses, on every lap — the tiles reach
 * |ix|·TILE + TILE_HALF from the centreline and the walls come in as the world
 * decays. Getting that wrong walks the route through the wall, so the
 * relationship is asserted by the tests instead of being eyeballed.
 */
export const FURNACE_HALF_W = 7.8

export const MAX_SQUEEZE = 0.18

/** Widest the route ever gets from the centreline, plate edge included. */
export const SPAN_HALF_W =
  Math.max(...SPAN_IX.map(Math.abs)) * TILE + TILE_HALF

// --- the route --------------------------------------------------------------
//
// Until the span the route *is* the hall centreline and distance walked is the
// same number as distance travelled. Across the span it is not, and the walker
// has to actually follow the tiles or it walks off them into the melt.
//
// The route is a uniform cubic B-spline through the tile centres. Three
// properties earn it:
//
//   • It rounds the ninety-degree corners. A polyline would put a step change
//     in the lateral velocity at every turn — the camera would snap sideways —
//     and this repo has already been bitten once by a discontinuity in an
//     authored curve that no screenshot could see. A cubic B-spline is C², so
//     the heading is C¹ and there is nothing to jitter.
//   • The corner it cuts is one sixth of a step, 0.4 m, and the tiles are 1.2 m
//     to the edge. The rounding stays on the plate.
//   • Its derivative is a *quadratic* B-spline over the forward differences,
//     and every forward difference in `iz` is 0 or +TILE. Non-negative basis
//     over non-negative differences: `z` cannot go backwards. That is a
//     structural guarantee rather than a tuning result.
//
// The control sequence is extended straight at both ends, which is what makes
// it join the centreline with matching value *and* tangent instead of stepping
// 0.4 m sideways at the lip.

/** Arc position at which tile 0's centre is reached. */
const SPAN_A0 = SPAN_Z0 - WALK_START

/** Metres over which the route eases back to the centreline after the span. */
const RETURN_RUN = 22

/** Lateral offset the span leaves you at. */
const SPAN_X_END = SPAN_IX[SPAN_TILES - 1] * TILE

export interface RoutePoint {

  /** Lateral offset from the hall centreline, and cyclic-lap forward position. */
  x: number
  z: number

  /** d/d(arc) of both — the heading, unnormalised. */
  dx: number
  dz: number
}

// --- cyclic helpers ---------------------------------------------------------

/** Wrap a distance into one lap, 0..CYCLE_LEN. */
export function cyclic (z: number): number {
  return z - CYCLE_LEN * Math.floor(z / CYCLE_LEN)
}

/** Signed distance from `from` to `to` the short way round the lap. */
export function cycDelta (to: number, from: number): number {
  const d = cyclic(to - from)
  return d > CYCLE_LEN * 0.5 ? d - CYCLE_LEN : d
}

/** Lateral offset of tile `i`'s centre. */
export function tileX (i: number): number {
  return SPAN_IX[Math.min(SPAN_TILES - 1, Math.max(0, i))] * TILE
}

/** Cyclic z of tile `i`'s centre. */
export function tileZ (i: number): number {
  return SPAN_Z0 + SPAN_IZ[Math.min(SPAN_TILES - 1, Math.max(0, i))] * TILE
}

/** Arc position at which tile `i` is stood on. */
export function tileArc (i: number): number {
  return SPAN_A0 + i * TILE
}

/** Control point `k`, with the sequence continued straight past both ends. */
function ctlX (k: number): number {
  if (k < 0)
    return 0
  return tileX(k)
}

function ctlZ (k: number): number {
  if (k < 0)
    return SPAN_Z0 + k * TILE
  if (k >= SPAN_TILES)
    return tileZ(SPAN_TILES - 1) + (k - (SPAN_TILES - 1)) * TILE
  return tileZ(k)
}

/**
 * Where `a` metres of walking into the lap puts you, and which way you are
 * facing. `a` is measured from the boarding point; `z` is returned unwrapped so
 * callers can wrap it themselves.
 */
export function routeAt (a: number, out: RoutePoint): RoutePoint {
  if (a <= SPAN_A0) {
    out.x  = 0
    out.z  = WALK_START + a
    out.dx = 0
    out.dz = 1
    return out
  }

  if (a >= SPAN_A0 + SPAN_ARC) {
    // Off the far end and drifting back to the centreline. smootherstep has zero
    // derivative at both ends, so this leaves the span with the lateral velocity
    // the span left off with — nought — and arrives at the centreline the same
    // way. Nothing to feel at either join.
    const b = a - (SPAN_A0 + SPAN_ARC)
    const t = Math.min(1, Math.max(0, b / RETURN_RUN))
    out.x   = SPAN_X_END * (1 - t * t * t * (t * (t * 6 - 15) + 10))
    out.z   = WALK_START + a - SPAN_EXTRA
    out.dx  = -SPAN_X_END * 30 * t * t * (t - 1) * (t - 1) / RETURN_RUN
    out.dz  = 1
    return out
  }

  const u  = (a - SPAN_A0) / TILE
  const k  = Math.floor(u)
  const f  = u - k
  const f2 = f * f
  const f3 = f2 * f

  const b0 = (1 - 3 * f + 3 * f2 - f3) / 6
  const b1 = (4 - 6 * f2 + 3 * f3) / 6
  const b2 = (1 + 3 * f + 3 * f2 - 3 * f3) / 6
  const b3 = f3 / 6

  const g0 = (-3 + 6 * f - 3 * f2) / 6
  const g1 = (-12 * f + 9 * f2) / 6
  const g2 = (3 + 6 * f - 9 * f2) / 6
  const g3 = 3 * f2 / 6

  const x0 = ctlX(k - 1),
    x1     = ctlX(k),
    x2     = ctlX(k + 1),
    x3     = ctlX(k + 2)
  const z0 = ctlZ(k - 1),
    z1     = ctlZ(k),
    z2     = ctlZ(k + 1),
    z3     = ctlZ(k + 2)

  out.x  = b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3
  out.z  = b0 * z0 + b1 * z1 + b2 * z2 + b3 * z3
  out.dx = (g0 * x0 + g1 * x1 + g2 * x2 + g3 * x3) / TILE
  out.dz = (g0 * z0 + g1 * z1 + g2 * z2 + g3 * z3) / TILE
  return out
}

/**
 * How hard the world is coming apart on this lap, 0..0.85. A little more each
 * circuit — enough that the second lap is visibly wrong and the fifth is barely
 * holding together, but never so much that you cannot see where you are walking.
 */
export function decayFor (smoothLoop: number): number {
  return Math.min(0.85, smoothLoop * 0.11)
}
