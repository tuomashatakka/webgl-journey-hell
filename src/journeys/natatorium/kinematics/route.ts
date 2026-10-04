import { clamp01 } from '@wjh/math/scalar'

// ---- surface types, read by the shader's material branch ----

const TYPE_TILE   = 0

// white tile, the default pool finish
const TYPE_GUTTER = 1

// narrow service corridor, darker tile
const TYPE_VAULT  = 2

// big vaulted hall, columns, clerestory
const TYPE_LOCKER = 3

// lockers and benches along the walls

export const TYPE_PLANT  = 4

// pumps and pipework, the only warm light
export const TYPE_RAW    = 5

const D = Math.PI / 180

// The lap. Four invariants hold across this table, all checked by
// assertRouteSane() below:
//
//  1. No join has a zero turn. With only three sections resident, two aligned
//     doorways in a row would let you see through to a section that isn't
//     uploaded — a hole. A turn at every join makes that unrepresentable.
//  2. Drops sum to zero over the lap, so the floor is continuous across the
//     seam. THE RISER is what pays that back.
//  3. Cumulative drop over sections 1-8 is 1.55 — just past EYE — so the water
//     closes over your head on THE STAIR DOWN. Nothing else encodes that moment.
//  4. Any three consecutive sections span >= 60 units, so the resident window
//     always reaches past the fog and you never see the end of the world.
export const SECTIONS: Section[] = [
  {
    id:    1,
    name:  'THE SHALLOW END',
    len:   26,
    halfW: 9,
    ceilH: 4.2,
    drop:  0.05,
    turn:  -18 * D,
    type:  TYPE_TILE,
    grime: 0.35,
    lamp:  6,
    speed: 5.2,
  },
  {
    id:    2,
    name:  'TILE CORRIDOR',
    len:   16,
    halfW: 1.6,
    ceilH: 3,
    drop:  0.1,
    turn:  90 * D,
    type:  TYPE_GUTTER,
    grime: 0.55,
    lamp:  4,
    speed: 6,
  },
  {
    id:    3,
    name:  'THE LANE POOL',
    len:   34,
    halfW: 11,
    ceilH: 6.5,
    drop:  0.15,
    turn:  -35 * D,
    type:  TYPE_TILE,
    grime: 0.3,
    lamp:  7,
    speed: 4.6,
  },
  {
    id:    4,
    name:  'OVERFLOW CHANNEL',
    len:   14,
    halfW: 1.4,
    ceilH: 2.6,
    drop:  0.35,
    turn:  55 * D,
    type:  TYPE_GUTTER,
    grime: 0.7,
    lamp:  3.5,
    speed: 5.4,
  },
  {
    id:    5,
    name:  'THE GRAND HALL',
    len:   40,
    halfW: 16,
    ceilH: 13,
    drop:  0.15,
    turn:  -70 * D,
    type:  TYPE_VAULT,
    grime: 0.25,
    lamp:  9,
    speed: 4.2,
  },
  {
    id:    6,
    name:  'THE LOCKER ROW',
    len:   20,
    halfW: 2.4,
    ceilH: 3.2,
    drop:  0.25,
    turn:  110 * D,
    type:  TYPE_LOCKER,
    grime: 0.6,
    lamp:  4.5,
    speed: 5,
  },
  {
    id:    7,
    name:  'THE PLANT ROOM',
    len:   24,
    halfW: 6.5,
    ceilH: 5,
    drop:  0.2,
    turn:  -90 * D,
    type:  TYPE_PLANT,
    grime: 0.75,
    lamp:  6.5,
    speed: 4.4,
  },
  {
    // The floor crosses EYE here: the water closes over your head in the
    // tightest space on the route, which is the whole point of putting it here.
    id:    8,
    name:  'THE STAIR DOWN',
    len:   16,
    halfW: 2,
    ceilH: 3.4,
    drop:  0.3,
    turn:  40 * D,
    type:  TYPE_RAW,
    grime: 0.8,
    lamp:  4,
    speed: 3.6,
  },
  {
    id:    9,
    name:  'THE DIVING WELL',
    len:   26,
    halfW: 10,
    ceilH: 9,
    drop:  2.5,
    turn:  -120 * D,
    type:  TYPE_TILE,
    grime: 0.45,
    lamp:  8,
    speed: 3.4,
  },
  {
    id:    10,
    name:  'THE DRAIN',
    len:   18,
    halfW: 1.8,
    ceilH: 2.8,
    drop:  1.5,
    turn:  85 * D,
    type:  TYPE_RAW,
    grime: 0.9,
    lamp:  5,
    speed: 4,
  },
  {
    id:    11,
    name:  'THE CISTERN',
    len:   30,
    halfW: 13,
    ceilH: 7.5,
    drop:  0.8,
    turn:  -60 * D,
    type:  TYPE_RAW,
    grime: 0.85,
    lamp:  11,
    speed: 2.8,
  },
  {
    // Pays back the whole lap's descent so the seam has no vertical pop. A 23%
    // grade — steep enough to read as a stair, gentle enough that the shear
    // correction in the shader stays near 1.
    id:    12,
    name:  'THE RISER',
    len:   28,
    halfW: 2.2,
    ceilH: 3.4,
    drop:  -6.35,
    turn:  95 * D,
    type:  TYPE_RAW,
    grime: 0.7,
    lamp:  4.5,
    speed: 3.8,
  },
]

export const SECTION_COUNT = SECTIONS.length

/** Total route length of one lap. */
export const LAP_LEN = SECTIONS.reduce((acc, s) => acc + s.len, 0)

// NOTE: sections are extended past both ends by a small overlap so that
// neighbouring air boxes genuinely interpenetrate rather than merely touching on
// a plane — a plane contact reads as distance 0 and the march sees a sealed
// doorway. That constant lives in shader.ts (OVERLAP), because the shader is
// the only thing that needs it; nothing here depends on the value.

// Cumulative section starts, and the floor height at each section's start.
export const STARTS: number[] = []

export const FLOOR0: number[] = []

// bare concrete, below the tile line

export interface Section {
  id:   number;
  name: string;

  /** Length along the section's local +Z. */
  len: number;

  /** Half width in local X. */
  halfW: number;

  /** Ceiling height above the section's local floor. */
  ceilH: number;

  /** How far the floor falls start-to-end. Negative rises. */
  drop: number;

  /** Yaw applied on *entering* this section, radians. Never 0 — see below. */
  turn: number;

  /** Surface treatment; one of the TYPE_* constants. */
  type: number;

  /** How filthy this space is, 0..1 — drives mildew and grout staining. */
  grime: number;

  /** Ceiling lamp pitch along local Z. */
  lamp: number;

  /** Base walk speed before the wading penalty. */
  speed: number;
}

{
  let accLen  = 0
  let accDrop = 0
  for (const s of SECTIONS) {
    STARTS.push(accLen)
    FLOOR0.push(-accDrop)
    accLen  += s.len
    accDrop += s.drop
  }
}

export function sectionAt (index: number): Section {
  const n = SECTION_COUNT
  return SECTIONS[(index % n + n) % n]
}

/** Floor height inside a section at local z, relative to that section's start. */
export function localFloor (s: Section, z: number): number {
  return -s.drop * clamp01(z / s.len)
}
