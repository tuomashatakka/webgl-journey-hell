// THE NATATORIUM — the route.
//
// An authored chain of SECTIONS through a flooded pool building. A section is a
// room *or* a corridor — the same thing with different proportions, so there is
// exactly one geometry function in the shader.
//
// The important idea lives here rather than in GLSL. `stairwell` solved "how do
// you turn forever without cost or float precision growing": only the camera's
// current section and its immediate neighbours are ever evaluated, each rotated
// into the camera's local frame. Turn #500 costs what turn #1 did, and no
// coordinate drifts far from the origin. But stairwell keeps its turn table in
// GLSL, which is the `liminal` mistake — a layout duplicated in two languages.
//
// So: the CPU owns the route and uploads, every frame, the affine transform that
// carries a point in the *current* section's frame into each neighbour's frame.
// The shader loops over three slots, applies each transform, evaluates one
// generic sectionAir(), unions with `min` and negates. It holds no route table.
//
// Because the neighbours are placed relative to the current section and only
// three are ever resident, the route never has to close in X/Z or be globally
// consistent — it can be geometrically impossible and you cannot see far enough
// to tell. Turns are data, not a GLSL if-chain, so they can be any angle.
//
// It *does* close in Y, though, and deliberately: THE RISER carries the floor
// back up to the entry level, so the lap seam has no vertical pop. Escalation
// comes from the water instead — the building floods further every lap, so lap 1
// you drown and resurface, lap 2 you barely surface, lap 3 you never do.

import type { JourneySimulation } from '@/components/withShaderJourney'
import type { CustomUniforms } from '@/lib/shaderQuad'


export function smoothstep (edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Quintic smoothstep. Its first *and* second derivatives vanish at both edges,
 * where the cubic's second derivative jumps. The corner blend weights the two
 * frames' path predictions with this, so the blended path is C2 — which makes
 * the heading (a first derivative) C1 and stops the camera from snapping into
 * and out of every turn at the window edges.
 */
export function smootherstep (edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function mix (start: number, end: number, t: number): number {
  return start * (1.0 - t) + end * t
}

function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** Shortest signed representation of an angle difference, in (-pi, pi]. */
function wrapPi (a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

// ---- surface types, read by the shader's material branch ----

export const TYPE_TILE   = 0 // white tile, the default pool finish
export const TYPE_GUTTER = 1 // narrow service corridor, darker tile
export const TYPE_VAULT  = 2 // big vaulted hall, columns, clerestory
export const TYPE_LOCKER = 3 // lockers and benches along the walls
export const TYPE_PLANT  = 4 // pumps and pipework, the only warm light
export const TYPE_RAW    = 5 // bare concrete, below the tile line

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
    halfW: 9.0,
    ceilH: 4.2,
    drop:  0.05,
    turn:  -18 * D,
    type:  TYPE_TILE,
    grime: 0.35,
    lamp:  6.0,
    speed: 5.2,
  },
  {
    id:    2,
    name:  'TILE CORRIDOR',
    len:   16,
    halfW: 1.6,
    ceilH: 3.0,
    drop:  0.10,
    turn:  90 * D,
    type:  TYPE_GUTTER,
    grime: 0.55,
    lamp:  4.0,
    speed: 6.0,
  },
  {
    id:    3,
    name:  'THE LANE POOL',
    len:   34,
    halfW: 11.0,
    ceilH: 6.5,
    drop:  0.15,
    turn:  -35 * D,
    type:  TYPE_TILE,
    grime: 0.30,
    lamp:  7.0,
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
    grime: 0.70,
    lamp:  3.5,
    speed: 5.4,
  },
  {
    id:    5,
    name:  'THE GRAND HALL',
    len:   40,
    halfW: 16.0,
    ceilH: 13.0,
    drop:  0.15,
    turn:  -70 * D,
    type:  TYPE_VAULT,
    grime: 0.25,
    lamp:  9.0,
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
    grime: 0.60,
    lamp:  4.5,
    speed: 5.0,
  },
  {
    id:    7,
    name:  'THE PLANT ROOM',
    len:   24,
    halfW: 6.5,
    ceilH: 5.0,
    drop:  0.20,
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
    halfW: 2.0,
    ceilH: 3.4,
    drop:  0.30,
    turn:  40 * D,
    type:  TYPE_RAW,
    grime: 0.80,
    lamp:  4.0,
    speed: 3.6,
  },
  {
    id:    9,
    name:  'THE DIVING WELL',
    len:   26,
    halfW: 10.0,
    ceilH: 9.0,
    drop:  2.50,
    turn:  -120 * D,
    type:  TYPE_TILE,
    grime: 0.45,
    lamp:  8.0,
    speed: 3.4,
  },
  {
    id:    10,
    name:  'THE DRAIN',
    len:   18,
    halfW: 1.8,
    ceilH: 2.8,
    drop:  1.50,
    turn:  85 * D,
    type:  TYPE_RAW,
    grime: 0.90,
    lamp:  5.0,
    speed: 4.0,
  },
  {
    id:    11,
    name:  'THE CISTERN',
    len:   30,
    halfW: 13.0,
    ceilH: 7.5,
    drop:  0.80,
    turn:  -60 * D,
    type:  TYPE_RAW,
    grime: 0.85,
    lamp:  11.0,
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
    grime: 0.70,
    lamp:  4.5,
    speed: 3.8,
  },
]

export const SECTION_COUNT = SECTIONS.length

/** Total route length of one lap. */
export const LAP_LEN = SECTIONS.reduce((acc, s) => acc + s.len, 0)

/** Eye height above the floor. You walk on the bottom, even once that is a bad idea. */
export const EYE = 1.62

/**
 * How far ahead the heading is sampled. Doubles as the corner lead: the chord
 * to a point this far along the blended path already points into the turn
 * before the camera reaches it.
 */
export const LOOKAHEAD = 1.8

/**
 * Water level on lap 0, in the same units as the accumulated floor fall (the
 * entry floor is 0). Ankle-deep at the door.
 */
export const WATER_Y0 = 0.12

/** Each lap the building floods further. This is the whole escalation. */
export const WATER_RISE = 1.15

// NOTE: sections are extended past both ends by a small overlap so that
// neighbouring air boxes genuinely interpenetrate rather than merely touching on
// a plane — a plane contact reads as distance 0 and the march sees a sealed
// doorway. That constant lives in shader.ts (OVERLAP), because the shader is
// the only thing that needs it; nothing here depends on the value.

// Cumulative section starts, and the floor height at each section's start.
const STARTS: number[] = []
const FLOOR0: number[] = []
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

/**
 * The window over which a lap's flood arrives, as indices into SECTIONS. It has
 * to sit entirely *after* the crossing in THE STAIR DOWN: within a lap the water
 * is flat at WATER_Y0 + lap * WATER_RISE right up to the start of this window,
 * which is what keeps invariant 3 true on every lap and not just on lap 0. By
 * THE DIVING WELL the floor has already dropped 1.55 and your head is under, so
 * a metre of rise arriving there changes nothing you can see — and by the time
 * THE RISER carries you back up, the new level is fully in.
 */
const RISE_FROM = 8 // THE DIVING WELL
const RISE_TO   = 10 // THE CISTERN

/**
 * How far a section's entry has been built, 0..1, from how far ahead of the
 * camera that entry still lies.
 *
 * Monotone, and exactly 0 and exactly 1 at its ends. Both exactnesses are load
 * bearing. At 1 every block offset is exactly 0, every block is exactly flush
 * with the shell, and the shader rejects the whole set with one compare on a
 * uniform — so the room you stand in is provably the room sectionAir() carved
 * and nothing else, and the reconfiguration is always something happening
 * further down the hall.
 *
 * A damped hinge was the obvious thing here, and it is what foundry swings its
 * span panels on, but it is wrong for this: it rings ABOVE 1 and then settles
 * back through it, so with a `>= 1` cull the dressing would deploy, vanish, and
 * come back. Quintic instead — the same curve the corner blend already rides.
 *
 * SIGHT is 12 rather than foundry's 20 because the fog here is far denser:
 * exp(-t*0.030) above the water, exp(-t*0.115) below it. At 20 metres submerged
 * you are at a tenth of contrast, and the whole performance would be happening
 * where nobody can see it.
 */
const SIGHT  = 12.0
const SETTLE = 3.0

export function deployAt (ahead: number): number {
  return smootherstep(SIGHT, SETTLE, ahead)
}

function sectionAt (index: number): Section {
  const n = SECTION_COUNT
  return SECTIONS[(index % n + n) % n]
}

/** Floor height inside a section at local z, relative to that section's start. */
function localFloor (s: Section, z: number): number {
  return -s.drop * clamp01(z / s.len)
}

// ---- cornering ------------------------------------------------------------
//
// Re-anchoring alone gives a *discontinuous* walk. The camera advances along the
// current section's +Z, so at a boundary the direction of travel snaps by the
// whole turn angle in a single frame — orientation stays continuous but velocity
// does not, and it reads as a teleport.
//
// The fix is to blend the camera pose between the two frames' predictions across
// a window straddling each boundary. Both sections can predict a pose for any
// distance (their floors and axes extrapolate past their own ends), so near a
// join we take a weighted mix of the two, expressed in whichever frame is
// current. At the boundary itself both sides evaluate to a 50/50 mix of the
// same two world points, so the path — and its tangent — are continuous through
// the corner. The camera then follows an arc instead of a dogleg.

type Vec3 = [ number, number, number ]

function rotY (x: number, z: number, c: number, s: number): [ number, number ] {
  return [ c * x - s * z, s * x + c * z ]
}

function lerp3 (a: Vec3, b: Vec3, t: number): Vec3 {
  return [ mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t) ]
}

/**
 * Half-width of the corner blend, in world units. Symmetric in its arguments so
 * both sides of a join agree on the window — that agreement is what makes the
 * two one-sided formulas meet exactly at the boundary.
 */
function cornerHalf (a: Section, b: Section): number {
  return Math.min(6.0, Math.min(a.len, b.len) * 0.3)
}

/** A point in the NEXT section's frame, expressed in the current one. */
function nextToCur (q: Vec3, cur: Section, next: Section): Vec3 {
  const c          = Math.cos(next.turn)
  const s          = Math.sin(next.turn)
  const [ rx, rz ] = rotY(q[0], q[2], c, s)
  return [ rx, q[1] - cur.drop, rz + cur.len ]
}

/** A point in the PREVIOUS section's frame, expressed in the current one. */
function prevToCur (q: Vec3, cur: Section, prev: Section): Vec3 {
  const c          = Math.cos(-cur.turn)
  const s          = Math.sin(-cur.turn)
  const [ rx, rz ] = rotY(q[0], q[2] - prev.len, c, s)
  return [ rx, q[1] + prev.drop, rz ]
}

/**
 * Corner blend weight at a local z: 0.5 exactly on a boundary, 0 or 1 outside
 * the window. Returns which neighbour is being mixed with, so scalars can ride
 * the same curve as the position and stay continuous with it.
 *
 *   side = +1  mixing forward into `next`, weight is the next section's share
 *   side = -1  mixing backward into `prev`, weight is the *current* share
 *   side =  0  clear of any corner
 */
type CornerBlendReturnType = { side: number; w: number }

function cornerBlend (idx: number, localZ: number): CornerBlendReturnType {
  const cur   = sectionAt(idx)
  const hwEnd = cornerHalf(cur, sectionAt(idx + 1))
  if (localZ > cur.len - hwEnd)
    return { side: 1, w: smootherstep(cur.len - hwEnd, cur.len + hwEnd, localZ) }

  const hwBeg = cornerHalf(sectionAt(idx - 1), cur)
  if (localZ < hwBeg)
    return { side: -1, w: smootherstep(-hwBeg, hwBeg, localZ) }

  return { side: 0, w: 1 }
}

/**
 * Lateral sway amplitude. Scales with the room, which means it is a *per
 * section* quantity and therefore has to go through the corner blend like
 * everything else — a 1.4m corridor opening into a 16m hall would otherwise
 * snap the camera sideways by nearly half a unit at the join.
 */
function swayFor (s: Section, dist: number): number {
  return Math.sin(dist * 0.09) * Math.min(0.5, s.halfW * 0.06)
}

/**
 * Camera position in section `idx`'s frame at a given local z, blended through
 * whichever corner is near. `localZ` may sit outside [0, len] — that is exactly
 * how the look-ahead sample reaches into the next section.
 */
function poseInFrame (idx: number, localZ: number, dist: number): Vec3 {
  const cur  = sectionAt(idx)
  const next = sectionAt(idx + 1)
  const prev = sectionAt(idx - 1)

  const own: Vec3 = [ swayFor(cur, dist), localFloor(cur, localZ), localZ ]
  const b         = cornerBlend(idx, localZ)

  if (b.side > 0) {
    const zn       = localZ - cur.len
    const qn: Vec3 = [ swayFor(next, dist), localFloor(next, zn), zn ]
    return lerp3(own, nextToCur(qn, cur, next), b.w)
  }

  if (b.side < 0) {
    const zp       = prev.len + localZ
    const qp: Vec3 = [ swayFor(prev, dist), localFloor(prev, zp), zp ]
    return lerp3(prevToCur(qp, cur, prev), own, b.w)
  }

  return own
}

/** A per-section scalar carried across corners on the same curve as the path. */
function blendScalar (idx: number, localZ: number, pick: (s: Section) => number): number {
  const b = cornerBlend(idx, localZ)
  if (b.side > 0)
    return mix(pick(sectionAt(idx)), pick(sectionAt(idx + 1)), b.w)
  if (b.side < 0)
    return mix(pick(sectionAt(idx - 1)), pick(sectionAt(idx)), b.w)
  return pick(sectionAt(idx))
}

/**
 * One neighbourhood slot: the affine map carrying a point from the *current*
 * section's frame into this slot's frame, as `q.xz = rot(cos,sin) * (p.xz - t.xz)`
 * with `q.y = p.y - ty`, plus the shape the shader needs to build it.
 */
export interface Slot {
  cos:   number;
  sin:   number;
  tx:    number;
  ty:    number;
  tz:    number;

  /**
   * The camera's z in *this slot's own frame*. Negated, it is how far ahead of
   * the camera this section's entry still lies, which is what deployAt() turns
   * into the blocks moving at that join.
   */
  camZ: number;

  /** Section id, 1..12. Salts per-section hashing so rooms of a type differ. */
  id: number;
  halfW: number;
  ceilH: number;
  len:   number;
  slope: number;
  type:  number;
  grime: number;
  lamp:  number;
}

export interface NatatoriumState {
  dist: number; // total distance walked, CPU-only
  lap:  number;

  /**
   * Laps completed, with the fractional part ramping across RISE_FROM..RISE_TO
   * rather than snapping at the seam. Anything that escalates per lap reads this
   * instead of `lap`, so it arrives while you are under and not in a doorway.
   */
  lapF:    number;
  localZ:  number;
  section: Section;

  /** Accumulated floor fall at the camera, negative going down. */
  floorY: number;

  /**
   * World height of the *current section frame's* origin floor — i.e. local
   * y = 0 for the space the shader marches in. Constant within a section, so
   * anything the shader needs in local coordinates converts through this and
   * not through the camera's own (corner-blended) floor height.
   */
  frameY: number;

  /** World water level for this lap. */
  waterY: number;

  /** Water depth at the camera's feet. */
  depth: number;

  /** 0 = head under water, 1 = fully above. */
  above: number;

  speed: number;
  camX:  number;
  camY:  number;
  camZ:  number;
  yaw:   number;
  pitch: number;
  roll:  number;

  slots: Slot[]; // always 3: prev, current, next
  name:  string;
}

function makeSlot (
  cos: number, sin: number, tx: number, ty: number, tz: number, s: Section,
): Slot {
  return {
    cos,
    sin,
    tx,
    ty,
    tz,
    camZ:  0, // filled in below, once the camera pose is known
    id:    s.id,
    halfW: s.halfW,
    ceilH: s.ceilH,
    len:   s.len,
    slope: s.drop / s.len,
    type:  s.type,
    grime: s.grime,
    lamp:  s.lamp,
  }
}

/**
 * The whole route as a pure function of distance walked.
 *
 * The slot transforms are derived, not tabulated. Section i+1's frame sits at
 * the far end of section i, rotated by that section's turn:
 *
 *   p_i = rot(turn_{i+1}) * q_{i+1} + (0, -drop_i, len_i)
 *
 * so the forward map is `q = rot(-turn) * (p - offset)`, and the backward map is
 * its inverse rearranged into the same shape. Both reduce to `rot * (p - t)`,
 * which is why the shader needs exactly one transform routine.
 */
export function getNatatoriumState (dist: number): NatatoriumState {
  const lap  = Math.floor(dist / LAP_LEN)
  const lapZ = dist - lap * LAP_LEN
  const lapF = lap + smootherstep(STARTS[RISE_FROM], STARTS[RISE_TO], lapZ)

  let idx = 0
  for (let i = SECTION_COUNT - 1; i >= 0; i--)
    if (lapZ >= STARTS[i]) {
      idx = i
      break
    }

  const cur    = SECTIONS[idx]
  const prev   = sectionAt(idx - 1)
  const next   = sectionAt(idx + 1)
  const localZ = lapZ - STARTS[idx]

  // --- slot transforms, all expressed in the current section's frame ---

  const slotCur = makeSlot(1, 0, 0, 0, 0, cur)

  // Next: q = rot(-turnNext) * (p - (0, -cur.drop, cur.len)).
  const an      = -next.turn
  const slotNxt = makeSlot(Math.cos(an), Math.sin(an), 0, -cur.drop, cur.len, next)

  // Previous: q = rot(turnCur) * p + (0, -prev.drop, prev.len), rewritten as
  // rot(turnCur) * (p - t) with t = -rot(-turnCur) * offset so the shader has
  // one code path. rot(-a) applied to (x=0, z=prev.len) is (sin a, cos a) * len.
  const ap      = cur.turn
  const cp      = Math.cos(ap)
  const sp      = Math.sin(ap)
  const slotPrv = makeSlot(cp, sp, -sp * prev.len, prev.drop, -cp * prev.len, prev)

  // --- camera ---

  // The blended path, plus a sample ahead of it. Heading comes from the chord
  // between them rather than from a turn table, so the camera always looks
  // exactly where it is going and the lead into a corner is automatic.
  const here   = poseInFrame(idx, localZ, dist)
  const ahead  = poseInFrame(idx, localZ + LOOKAHEAD, dist)
  const ahead2 = poseInFrame(idx, localZ + LOOKAHEAD * 2, dist)

  const dx  = ahead[0] - here[0]
  const dy  = ahead[1] - here[1]
  const dz  = ahead[2] - here[2]
  const hyp = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz))

  const yaw = Math.atan2(dx, dz)

  // Bank into the turn. This has to come from the *rate* of heading change, not
  // from `yaw` itself: yaw is measured in the current section's frame, and that
  // frame rotates by the whole turn angle the instant `idx` advances, so a roll
  // proportional to yaw snapped by up to 12 degrees at every join. The chord
  // between two look-ahead samples is a difference of two headings in the same
  // frame, so the frame rotation cancels and the bank is continuous through the
  // seam — and it leads the turn instead of trailing it.
  const bank = wrapPi(Math.atan2(ahead2[0] - ahead[0], ahead2[2] - ahead[2]) - yaw)

  // The blended local floor, recovered from the pose so ramps and corners share
  // one source of truth.
  const floorLocal = here[1]
  const floorY     = FLOOR0[idx] + floorLocal
  // Continuous, not stepped per lap. Stepping put the whole 1.15u rise into the
  // single frame that crosses the seam: the surface teleported to chest height
  // in a doorway and the wading penalty snapped with it. The rise now arrives
  // across RISE_FROM..RISE_TO, deep in the flooded half of the lap where the
  // camera is already under, and reaches the next lap's level before the seam —
  // so the seam is smooth and the level at any point of a lap is unchanged.
  const waterY = WATER_Y0 + lapF * WATER_RISE
  const depth  = Math.max(0, waterY - floorY)
  const above  = smoothstep(waterY - 0.12, waterY + 0.12, floorY + EYE)

  // Wading is slow, and slower the deeper it gets. Base speed rides the corner
  // blend too, so the pace eases between rooms instead of stepping.
  const wade  = 1.0 - 0.55 * clamp01(depth / (EYE * 1.1))
  const speed = blendScalar(idx, localZ, s => s.speed) * Math.max(0.28, wade)

  // The walk cycle stops once you are swimming rather than wading.
  const stride = 1.0 - 0.75 * clamp01(depth / EYE)
  const bob    = Math.abs(Math.sin(dist * 1.7)) * 0.045 * stride

  // The camera's z down each resident section's own axis — the same affine the
  // shader applies to any other point, evaluated once here rather than ninety-six
  // times a pixel: q.z = sin * (p.x - tx) + cos * (p.z - tz).
  const slots = [ slotPrv, slotCur, slotNxt ]
  for (const sl of slots)
    sl.camZ = sl.sin * (here[0] - sl.tx) + sl.cos * (here[2] - sl.tz)

  return {
    dist,
    lap,
    lapF,
    localZ,
    section: cur,
    floorY,
    frameY:  FLOOR0[idx],
    waterY,
    depth,
    above,
    speed,
    camX:    here[0],
    camY:    floorLocal + EYE + bob,
    camZ:    here[2],
    yaw,
    // Follow the ramp partially — enough to feel the grade, not so much that
    // the horizon pumps on every gentle pool-deck fall.
    pitch:   Math.atan2(dy, hyp) * 0.65 +
             Math.sin(dist * 0.85) * 0.012 * stride -
             (1.0 - above) * 0.10,
    roll: Math.sin(dist * 0.31) * 0.012 +
           Math.max(-0.14, Math.min(0.14, bank * 0.55)),
    slots,
    name:  cur.name,
  }
}

/** HUD label. Laps count from 1 the way the other journeys count them. */
export function labelFor (state: NatatoriumState): string {
  const under = state.above < 0.5 ? ' ↓' : ''
  return state.lap > 0
    ? `LAP ${state.lap + 1} · ${state.name}${under}`
    : `${state.name}${under}`
}

/**
 * Dev-only guard for the four table invariants. These are exactly the mistakes
 * that produce *geometry* bugs rather than type errors — a sealed doorway or a
 * hole where an unresident section should be — so they are worth asserting
 * rather than discovering in a screenshot.
 */
export function assertRouteSane (): string[] {
  const problems: string[] = []

  for (let i = 0; i < SECTION_COUNT; i++) {
    const s = SECTIONS[i]
    if (Math.abs(s.turn) < 1e-4)
      problems.push(`${s.name}: zero turn — two aligned doorways would show a hole`)
    if (s.halfW <= 0.6)
      problems.push(`${s.name}: halfW ${s.halfW} leaves no room for the camera sway`)

    const triple = s.len + sectionAt(i + 1).len + sectionAt(i + 2).len
    if (triple < 60)
      problems.push(`${s.name}: resident window spans only ${triple}u, fog reaches further`)
  }

  const dropSum = SECTIONS.reduce((a, s) => a + s.drop, 0)
  if (Math.abs(dropSum) > 1e-6)
    problems.push(`drops sum to ${dropSum.toFixed(3)}, not 0 — the lap seam will pop vertically`)

  // The crossing must happen exactly once, and in THE STAIR DOWN.
  let acc       = 0
  let crossedIn = ''
  for (const s of SECTIONS) {
    const before = acc
    acc -= s.drop
    if (before + EYE >= WATER_Y0 && acc + EYE < WATER_Y0)
      crossedIn = crossedIn ? `${crossedIn}+${s.name}` : s.name
  }
  if (crossedIn !== 'THE STAIR DOWN')
    problems.push(`water closes overhead in "${crossedIn}", expected THE STAIR DOWN`)

  // The flood window must open after that crossing, or the rise from the
  // previous lap moves the moment earlier and the beat above stops being true.
  const crossIdx = SECTIONS.findIndex(s => s.name === 'THE STAIR DOWN')
  if (RISE_FROM <= crossIdx)
    problems.push(`flood window opens in "${SECTIONS[RISE_FROM].name}", at or before the crossing`)

  return problems
}

/**
 * One simulation instance per mount. The HOC steps it on the shared frame-capped
 * loop and reads uniforms() immediately after, so the shader always renders the
 * state this frame's integration produced.
 */
export function createNatatoriumSimulation (): JourneySimulation {
  let dist  = 0
  let state = getNatatoriumState(0)

  if (process.env.NODE_ENV !== 'production') {
    const problems = assertRouteSane()
    for (const p of problems)
      console.warn('[natatorium route]', p)
  }

  // Packed in place every frame, never reallocated. Three slots x three vec4.
  // Separate arrays indexed by a bare loop variable rather than one array with
  // computed indices: both are legal GLSL ES 1.00, only one is well-trodden.
  const uSecA = new Array<number>(12).fill(0) // cos, sin, tx, tz
  const uSecB = new Array<number>(12).fill(0) // ty, halfW, ceilH, len
  const uSecC = new Array<number>(12).fill(0) // slope, type, grime, lampPitch
  const uSecD = new Array<number>(12).fill(0) // deploy, aisleY, sectionId, -
  const uCam  = [ 0, 0, 0, 0 ]
  const uLook = [ 0, 0, 0, 0 ]
  const uWave = [ 0, 0, 0, 0 ]

  return {
    step (dt: number) {
      dist += state.speed * Math.min(dt, 0.1)
      state = getNatatoriumState(dist)
    },

    uniforms (): CustomUniforms {
      for (let i = 0; i < 3; i++) {
        const s = state.slots[i]
        const o = i * 4

        uSecA[o]     = s.cos
        uSecA[o + 1] = s.sin
        uSecA[o + 2] = s.tx
        uSecA[o + 3] = s.tz

        uSecB[o]     = s.ty
        uSecB[o + 1] = s.halfW
        uSecB[o + 2] = s.ceilH
        uSecB[o + 3] = s.len

        uSecC[o]     = s.slope
        uSecC[o + 1] = s.type
        uSecC[o + 2] = s.grime
        uSecC[o + 3] = s.lamp

        uSecD[o]     = deployAt(-s.camZ)
        // The aisle's height, uploaded rather than mirrored as a GLSL constant:
        // it is derived from EYE, and a hand-kept copy of EYE in the shader is
        // exactly the kind of contract that rots (see stairwell's SEG_LEN).
        uSecD[o + 1] = EYE - 0.35
        uSecD[o + 2] = s.id
        uSecD[o + 3] = 0
      }

      uCam[0] = state.camX
      uCam[1] = state.camY
      uCam[2] = state.camZ
      uCam[3] = state.yaw

      uLook[0] = state.pitch
      uLook[1] = state.roll
      uLook[2] = state.above
      uLook[3] = state.depth

      // Water height in the *current section's local frame* — the space the
      // shader marches in, where local y = 0 is the section's start floor.
      // Derived from the frame origin, not from the camera's floor height: the
      // latter is corner-blended, so through every join it drifts away from the
      // section's own ramp and the water surface visibly bobbed with it.
      uWave[0] = state.waterY - state.frameY
      uWave[1] = state.lapF
      uWave[2] = state.dist
      uWave[3] = state.section.type

      return { uSecA, uSecB, uSecC, uSecD, uCam, uLook, uWave }
    },

    label () {
      return labelFor(state)
    },
  }
}
