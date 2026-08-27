// THE FOUNDRY — rigid-body simulation of a walking loop.
//
// Unlike the other journeys (whose motion is authored as easing curves baked
// into GLSL), the Foundry's lift, walker, debris and machinery are *simulated on
// the CPU* with a deterministic fixed-step integrator, and the resulting state
// is pushed to the fragment shader as uniforms each frame. Nothing here is a
// sin() approximation of physics — it is the physics.
//
// One lap of the foundry:
//
//   1. THE DROP.   You are standing in a hoist cage whose cable has already
//                  parted, near the head of a 150 m shaft. Free fall, then the
//                  emergency shoes bite and take three g out of you, then the
//                  servo lowers the last few metres onto the landing.
//   2. THE WALK.   The gate rattles up and you step out into the loading bay,
//                  and walk seven machine halls laid end to end.
//   3. THE BOARD.  The seventh hall runs back into the first and delivers you to
//                  the same cage. You step in, the shutter comes down, and the
//                  next thing you know you are falling again — one level deeper
//                  into a foundry that repeats, and degrades, forever.
//
// Distance walked is the clock for step 2, and the shader's corridor geometry is
// periodic in it (CYCLE_LEN), so the seam between the last hall and the first is
// the same cross-fade as every other section boundary.
//
// What is actually integrated:
//   • Lift       — semi-implicit Euler under gravity, quadratic aerodynamic
//                  drag, brake-shoe Coulomb friction with wedge seating and a
//                  Stribeck speed curve, a governed lowering servo, and a
//                  nonlinear hydraulic buffer in the pit if it arrives hot.
//   • Debris     — 6 free rigid bodies (linear + angular) loose in the cage,
//                  colliding with its *moving* interior via relative-velocity
//                  impulses with restitution and Coulomb friction. During the
//                  fall they and the cage share an acceleration, so they float
//                  in front of you — and when the shoes bite, the cage stops and
//                  they do not.
//   • Walker     — an inverted-pendulum gait. Head height rides a damped leg
//                  spring that each heel strike kicks downward, weight transfer
//                  kicks an alternating lateral sway spring, and the folding
//                  span's panels ring under the feet that land on them. The
//                  camera pose is the *output* of that, never a sine wave.
//   • Flywheel   — angular momentum with motor torque and a load torque that
//                  varies with crank angle; drives the wall pistons through the
//                  exact closed-form slider-crank displacement.
//   • Chain/hook — damped pendulums with *base excitation*, i.e. swung by the
//                  cage's own acceleration and by the walker's footfalls rather
//                  than by a driving sine.
//
// Units are SI: metres, seconds, kilograms. +Y is up, the walk runs along +Z,
// and the hoist shaft rises above the landing at the head of the loading bay.

const DT           = 1 / 120 // fixed integration step
const MAX_SUBSTEPS = 6 // clamp so a stalled tab can't spiral

const G            = 9.81 // gravity
const DEBRIS_COUNT = 6

// --- the loop (mirrored by the shader) --------------------------------------

/** Section length, metres. Seven halls of this length make up one lap. */
export const SECTION_LEN = 36
export const SECTION_COUNT = 7

/** One full circuit of the foundry, metres. Geometry is periodic in this. */
export const CYCLE_LEN = SECTION_LEN * SECTION_COUNT

/**
 * Length of the cross-fade at *every* section boundary, metres — including the
 * wrap from the furnace floor back into the loading bay. One rule for all seven
 * seams is what makes the loop read as a single continuous walk.
 */
export const TRANSITION = 9

// Metres of travel per footstep. CYCLE_LEN is a whole number of these, so the
// stride phase is continuous across the wrap.
export const STEP_LEN = 0.875

const WALK_SPEED = 2.4 // m/s, a brisk walk
const LEG_K      = 210 // leg-spring stiffness (per unit mass)
const LEG_C      = 9 // leg-spring damping — low enough that the head rings
const SWAY_K     = 74 // lateral sway stiffness, tuned to one stride period
const SWAY_C     = 4.0
const HEEL_KICK  = 0.55 // m/s of head drop injected by each heel strike
const SWAY_KICK  = 0.30 // m/s of lateral drift injected by weight transfer
const TREMOR_K   = 130 // floor-tremor spring (impacts travel up it)
const TREMOR_C   = 5.5

/** Eye height above the walking surface, metres. */
export const EYE_HEIGHT = 1.62

// --- the lift shaft (mirrored by the shader) --------------------------------

/** Cyclic position of the shaft, part-way down the loading bay. */
export const LIFT_Z = 18

/** How far back from the cage's centre you stand, metres. */
export const LIFT_STAND = 0.55

/** Where the walk starts and ends: standing in the cage at the landing. */
export const WALK_START = LIFT_Z - LIFT_STAND

/** Half-width of the square hoist shaft. */
export const SHAFT_R = 3.0

/** Shaft head, and the height the cage is at when the cable lets go. */
export const SHAFT_HEAD_Y = 128
export const LIFT_TOP = 120

/** Metres further up the shaft the cable parts on each successive run. */
const LIFT_RISE = 26

/**
 * Where this run starts.
 *
 * The drop is meant to get longer every time, and moving the *brake* down alone
 * cannot do that: a lower trip point buys free-fall metres and gives them
 * straight back as braking seconds, so the drop as a whole comes out flat or
 * shorter. The shaft has to get taller as well.
 *
 * Which means the shaft is no longer a constant the shader can bake in — the
 * head goes up with the cage, and it travels as a uniform (uFall.z). Anything
 * that draws the shaft has to ask, not assume.
 */
export function liftTopFor (loop: number): number {
  return LIFT_TOP + Math.min(loop, OBLIVION_LOOP) * LIFT_RISE
}

/** Head of the shaft for that run — the ceiling the cage hangs just under. */
export function shaftHeadFor (loop: number): number {
  return liftTopFor(loop) + (SHAFT_HEAD_Y - LIFT_TOP)
}

/**
 * Height at which the emergency shoes bite. Sized against brakeForce() so the
 * cage comes to a stand a few metres short of the landing: the wedges take
 * ~0.35 s to seat, which at terminal speed is 13 m of shaft gone before there
 * is any real retardation at all, and the stop itself needs another 22 m.
 */
export const LIFT_BRAKE_Y = 44

/** Metres lower the trip gear fires on each successive run. */
const BRAKE_DROP = 5

/**
 * Where the shoes bite on this run.
 *
 * The guide rails are scored a little flatter by every arrival, so the trip gear
 * has less to catch on and fires later: the drop gets longer and the stop gets
 * harder, run on run. Lap 0 stops with two thirds of the shaft to spare; lap 2
 * has barely the stopping distance it needs. Lap OBLIVION_LOOP the gear fires at
 * the original height and the shoes cannot hold at all — see cageForce.
 */
export function brakeYFor (loop: number): number {
  if (loop >= OBLIVION_LOOP)
    return LIFT_BRAKE_Y
  return LIFT_BRAKE_Y - loop * BRAKE_DROP
}

/** Landing level — the cage floor comes to rest flush with the hall's. */
export const LANDING_Y = 0

/** Hydraulic buffers in the pit, for the arrivals the shoes do not catch. */
export const PIT_Y = -3

export const CAGE_HALF = 1.5 // cage interior half-width
export const CAGE_HEIGHT = 2.6

// Seconds for the gate to rattle up, for the shutter to come down, and for the
// shutter to clear again once the cable has gone.
const GATE_TIME    = 1.4
const SHUTTER_TIME = 1.2
const REOPEN_TIME  = 0.7

// --- lap phases -------------------------------------------------------------

/** Falling: the cable has parted and nothing is holding the cage. */
export const MODE_FALL = 0

/** The emergency shoes are on the rails. */
export const MODE_BRAKE = 1

/** Stopped at the landing; the gate is rattling up. */
export const MODE_SETTLE = 2

/** On foot, walking the seven halls. */
export const MODE_WALK = 3

/** Back in the cage at the end of the lap; the shutter is coming down. */
export const MODE_BOARD = 4

/** Past the pit, with nothing below it. There is no phase after this one. */
export const MODE_OBLIVION = 5

// --- the last run -----------------------------------------------------------

/**
 * The run on which the shoes stop being able to hold it — the fourth, which the
 * HUD labels LOOP 4 (the counter is zero-based).
 *
 * Three arrivals have polished the rails flat. On this one the trip gear still
 * fires at the height it always did, the wedges still seat, and they still throw
 * the same shower off the rails — they simply have nothing left to grip, and the
 * pit they were supposed to stop short of has no floor in it.
 */
export const OBLIVION_LOOP = 3

/** Seconds the shoes go on grabbing before there is nothing left of them. */
const OBLIVION_GRIP = 11

/**
 * Clamp force of one full grab, newtons — well above the nominal brakeForce().
 *
 * The shoes are not sliding on this run, they are *jamming*: the wedges drive
 * into a rail they can no longer seat against and momentarily weld to it, which
 * is a far harder bite than the designed friction stop and exactly why they tear
 * themselves off doing it. Without this the failure is over in a second — there
 * is only 47 m between the trip point and the pit, and nominal friction spends
 * all of it without ever getting the cage below terminal.
 */
const OBLIVION_BITE = 118000

/** Rate of the stick-slip grab, rad/s: bite, tear free, bite again. */
const OBLIVION_CHATTER = 6.1

/** What fraction of a full clamp one of those grabs is worth. */
const OBLIVION_HOLD = 1.0

/** ½ρCdA down there. Terminal velocity works out at about 46 m/s. */
const OBLIVION_DRAG = 4.2

/**
 * Vertical period of the oblivion shaft.
 *
 * The fall never ends, and a `y` that never stops falling is a float that runs
 * out of mantissa in about four minutes — the world would start quantising
 * around the camera while it is the only thing on screen. So the shaft is made
 * periodic instead and `y` wraps inside one period, exactly the way `z` already
 * wraps inside one lap of the halls. Nothing on screen changes when it does;
 * `fallen` keeps the real number for anything that needs to know how far down
 * this has gone.
 */
export const OBLIVION_PERIOD = 64

const CAGE_MASS       = 900 // kg, cage + occupant + offcuts
const CAGE_DRAG       = 1.15 // ½ρCdA, quadratic drag coefficient
const CREEP_SPEED     = 8 // m/s, governed lowering rate once the shoes hold
const CREEP_MAX_FORCE = 90000 // N ceiling on the lowering servo
const BUFFER_K        = 260000 // N/m, hydraulic buffer stiffness
const BUFFER_C        = 34000 // N·s/m
const BUFFER_POWER    = 1.6 // >1 = progressively stiffer as it compresses

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
export const SPAN_Z0 = 219

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
export const SPAN_Z_RUN = SPAN_IZ[SPAN_TILES - 1] * TILE

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

/** Molten surface far below the span. */
export const MELT_Y = -30

const UNFOLD_LEAD = 14 // metres of warning before you reach a tile
const REFOLD_LAG  = 5 // metres behind you before it folds away again
const HINGE_K     = 46 // hinge stiffness — higher snaps the plate over
const HINGE_C     = 7.5 // hinge damping — lower leaves it ringing
const HINGE_KICK  = 0.42 // hinge rate injected by a footfall landing on a tile

export interface DebrisBody {

  /** Position: x/z are in the cage's frame, y is world height. */
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number

  /** Orientation quaternion (x, y, z, w). */
  qx: number
  qy: number
  qz: number
  qw: number

  /** Body-frame angular velocity, rad/s. */
  wx: number
  wy: number
  wz: number

  /** Half-extent scale; the shader derives box dims from the same factor. */
  scale: number
  mass:  number
}

export interface FoundryState {

  /** Which phase of the lap we are in — see MODE_*. */
  mode: number

  /** Seconds spent in the current phase. */
  modeTime: number

  /** Gate open fraction (0 shut, 1 clear) and shutter closed fraction. */
  gate:    number
  shutter: number

  // --- the walker ---------------------------------------------------------

  /**
   * Total distance walked, metres. The clock for the corridor.
   *
   * Not the same number as `z` once the span turns: see routeAt.
   */
  dist: number

  /** Position within the current lap, 0..CYCLE_LEN. */
  z: number

  /** Lateral offset from the hall centreline — nought except on the span. */
  lateral: number

  /** Which way the route is facing, radians about +Z. */
  head: number

  /** Distance at which this lap's walk ends, back at the cage. */
  lapEnd: number

  /** Completed laps, and the version that ramps across the boarding. */
  loop:       number
  smoothLoop: number

  /** Walking speed, m/s. */
  v: number

  /** Footsteps taken; the fractional part is the stride phase. */
  stride: number

  /** Which foot is down: ±1. */
  foot: number

  /** Head height relative to the walking surface, and its rate — a leg spring. */
  bob:  number
  bobV: number

  /** Lateral weight-transfer sway, and its rate. */
  sway:  number
  swayV: number

  /** Floor tremor travelling up from impacts, and its rate. */
  tremor:  number
  tremorV: number

  /** Camera pose, all of it derived from the gait or from the ride. */
  eyeY:   number
  yaw:    number
  pitch:  number
  roll:   number
  shakeX: number
  shakeY: number

  // --- the cage -----------------------------------------------------------

  /**
   * Cage floor height, metres.
   *
   * In MODE_OBLIVION this wraps inside OBLIVION_PERIOD, because that shaft is
   * periodic and the fall is not going to stop.
   */
  y: number

  /** Metres fallen past the pit. Unwrapped, and only ever counts up. */
  fallen: number

  /** Cage vertical velocity, m/s (negative = falling). */
  cageV: number

  /** Cage vertical acceleration, m/s² — drives the shake and the hook. */
  cageA:       number
  cableIntact: boolean

  /** Instantaneous brake friction power, normalised 0..1 — spark intensity. */
  spark: number

  /** Seconds the shoes have been in contact. */
  brakeEngaged: number

  /** Seconds spent settled, gating the phase machine's exits. */
  settleTime: number

  /** True once the brake shoes have stalled the cage and slipped to a creep. */
  creeping: boolean
  debris:   DebrisBody[]

  // --- machinery ----------------------------------------------------------

  /** Flywheel angle and rate driving the wall pistons. */
  crank:      number
  crankOmega: number

  /** Damped pendulum hook hanging from the cage roof. */
  hook:      number
  hookOmega: number

  /** Damped pendulum chain hanging from the hall's hoist beams. */
  chain:      number
  chainOmega: number

  // --- the folding span ---------------------------------------------------

  /** Per-cube fold coordinate (0 = closed cube, 1 = fully unfolded). */
  fold:      number[]
  foldOmega: number[]
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

function smoothstep (a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

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

export interface RoutePoint {

  /** Lateral offset from the hall centreline, and cyclic-lap forward position. */
  x: number
  z: number

  /** d/d(arc) of both — the heading, unnormalised. */
  dx: number
  dz: number
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

/** True while the camera is riding the cage rather than walking. */
export function riding (state: FoundryState): boolean {
  return state.mode !== MODE_WALK
}

// --- deterministic RNG ------------------------------------------------------
function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 >>> 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** Cheap scalar hash, used to vary one footfall from the next. */
function hash11 (x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453123
  return s - Math.floor(s)
}

function spawnDebris (rand: () => number, cageY: number): DebrisBody[] {
  const bodies: DebrisBody[] = []
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const scale = 0.14 + rand() * 0.16
    // Axis-angle -> quaternion, so bodies start tumbled rather than axis-aligned.
    const ax  = rand() * 2 - 1
    const ay  = rand() * 2 - 1
    const az  = rand() * 2 - 1
    const len = Math.hypot(ax, ay, az) || 1
    const ang = rand() * Math.PI * 2
    const s   = Math.sin(ang / 2)
    bodies.push({
      px:   (rand() * 2 - 1) * (CAGE_HALF - 0.45),
      py:   cageY + 0.35 + rand() * 1.4,
      pz:   (rand() * 2 - 1) * (CAGE_HALF - 0.45),
      vx:   (rand() * 2 - 1) * 0.4,
      vy:   0,
      vz:   (rand() * 2 - 1) * 0.4,
      qx:   ax / len * s,
      qy:   ay / len * s,
      qz:   az / len * s,
      qw:   Math.cos(ang / 2),
      wx:   (rand() * 2 - 1) * 1.2,
      wy:   (rand() * 2 - 1) * 1.2,
      wz:   (rand() * 2 - 1) * 1.2,
      scale,
      // Solid-ish steel offcuts: mass scales with volume.
      mass: 240 * scale * scale * scale,
    })
  }
  return bodies
}

export function createFoundryState (seed = 0x5eed): FoundryState {
  const rand = mulberry32(seed)
  return {
    // The journey opens mid-drop: the cable is already gone.
    mode:         MODE_FALL,
    modeTime:     0,
    gate:         0,
    shutter:      0,
    dist:         WALK_START,
    z:            WALK_START,
    lateral:      0,
    head:         0,
    lapEnd:       WALK_START + LAP_ARC,
    loop:         0,
    smoothLoop:   0,
    v:            0,
    stride:       0,
    foot:         1,
    bob:          0,
    bobV:         0,
    sway:         0,
    swayV:        0,
    tremor:       0,
    tremorV:      0,
    eyeY:         LIFT_TOP + EYE_HEIGHT,
    yaw:          0,
    pitch:        -0.3,
    roll:         0,
    shakeX:       0,
    shakeY:       0,
    y:            LIFT_TOP,
    fallen:       0,
    cageV:        -2,
    cageA:        0,
    cableIntact:  false,
    spark:        0,
    brakeEngaged: 0,
    settleTime:   0,
    creeping:     false,
    debris:       spawnDebris(rand, LIFT_TOP),
    crank:        0,
    crankOmega:   5.4,
    hook:         0.18,
    hookOmega:    0,
    chain:        0.12,
    chainOmega:   0,
    fold:         new Array<number>(SPAN_TILES).fill(0),
    foldOmega:    new Array<number>(SPAN_TILES).fill(0),
  }
}

/**
 * Emergency brake force, in newtons, opposing the cage's motion.
 *
 * ── This function defines how the drop *feels*. ──
 * The shoes clamp the guide rails, so this is Coulomb friction: μ·N, where the
 * normal force N is what the wedge mechanism applies. The realistic subtlety is
 * that N does not appear instantly — the shoes take time to seat, and once
 * seated, sliding friction is lower than the initial static grab.
 *
 * The clamp is sized for the job: arresting a cage that has fallen 110 m takes
 * about three g of retardation, which is a violent, shrieking stop rather than
 * a governor easing you down.
 *
 * Trade-offs worth playing with:
 *   • A large constant force  → a violent, near-instant slam. High jerk, huge
 *     shower of sparks, offcuts hammer the floor. Reads as catastrophic.
 *   • A ramp on `engaged`     → a progressive squeal, several seconds of
 *     shrieking deceleration. More dread, less impact.
 *   • Velocity-dependent μ    → grabby at low speed, glassy at high speed; the
 *     cage judders (stick-slip) as it slows. Most physically honest, and the
 *     most expensive in shake budget.
 *
 * @param speed    absolute cage speed, m/s
 * @param engaged  seconds since the shoes made contact
 */
export function brakeForce (speed: number, engaged: number): number {
  // Wedge seating: normal force climbs over ~0.35 s to full clamp.
  const seat   = Math.min(1, engaged / 0.35)
  const normal = 68000 * seat
  // Sliding friction falls off with speed (Stribeck-ish), so the cage grabs
  // harder as it slows — this is what produces the final juddering stop.
  const mu = 0.52 + 0.30 / (1 + speed * 0.22)
  return normal * mu
}

// --- quaternion helpers -----------------------------------------------------
function integrateQuat (b: DebrisBody, dt: number): void {
  const { qx, qy, qz, qw, wx, wy, wz } = b
  const hx                             = 0.5 * dt
  let nx = qx + hx * (wx * qw + wy * qz - wz * qy)
  let ny = qy + hx * (wy * qw + wz * qx - wx * qz)
  let nz = qz + hx * (wz * qw + wx * qy - wy * qx)
  let nw = qw - hx * (wx * qx + wy * qy + wz * qz)
  const inv = 1 / (Math.hypot(nx, ny, nz, nw) || 1)
  nx *= inv
  ny *= inv
  nz *= inv
  nw *= inv
  b.qx = nx
  b.qy = ny
  b.qz = nz
  b.qw = nw
}

/**
 * Resolve one debris body against the cage interior — a box that is itself
 * accelerating. Contacts are solved in the cage's frame using *relative*
 * velocity, which is what makes the free-fall float and the brake-slam fall
 * out of the same code path for free.
 */
function collideWithCage (b: DebrisBody, cageY: number, cageV: number): number {
  const r           = b.scale * 0.55 // bounding radius of the offcut
  const restitution = 0.32
  const friction    = 0.38
  let impact = 0

  // Floor of the cage (moving at cageV).
  const floor = cageY + r
  if (b.py < floor) {
    b.py      = floor

    const rel = b.vy - cageV
    if (rel < 0) {
      impact += -rel
      b.vy = cageV - rel * restitution

      // Tangential friction converts skidding into tumbling.
      const jt = -rel * friction
      b.wx += b.vz * friction * 2.4
      b.wz -= b.vx * friction * 2.4
      b.vx *= 1 - friction
      b.vz *= 1 - friction
      b.wy += jt * 0.3
    }
  }

  // Roof — matters only when the cage decelerates hard enough to catch up.
  const roof = cageY + CAGE_HEIGHT - r
  if (b.py > roof) {
    b.py      = roof

    const rel = b.vy - cageV
    if (rel > 0) {
      impact += rel
      b.vy = cageV - rel * restitution
    }
  }

  // Side walls.
  const wall = CAGE_HALF - r
  if (b.px < -wall || b.px > wall) {
    const sign = b.px < 0 ? -1 : 1
    b.px       = sign * wall
    if (b.vx * sign > 0) {
      impact += Math.abs(b.vx)
      b.vx = -b.vx * restitution
      b.wz += b.vy * 0.6
    }
  }
  if (b.pz < -wall || b.pz > wall) {
    const sign = b.pz < 0 ? -1 : 1
    b.pz       = sign * wall
    if (b.vz * sign > 0) {
      impact += Math.abs(b.vz)
      b.vz = -b.vz * restitution
      b.wx -= b.vy * 0.6
    }
  }

  return impact
}

/**
 * Sum the vertical forces on the cage for this step, and advance the ride's own
 * phase transitions. Returns the net force in newtons; the caller integrates it.
 * Only the two falling phases move it — once it is stood on the landing it is
 * simply held there for the rest of the lap.
 */
function cageForce (s: FoundryState, dt: number): number {
  if (s.mode !== MODE_FALL && s.mode !== MODE_BRAKE && s.mode !== MODE_OBLIVION) {
    s.y     = LANDING_Y
    s.cageV = 0
    s.spark *= Math.exp(-dt * 3.5)
    return 0
  }

  let force = -CAGE_MASS * G
  const speed = Math.abs(s.cageV)
  force -= Math.sign(s.cageV) * CAGE_DRAG * speed * speed // quadratic aero drag

  if (s.mode === MODE_OBLIVION) {
    // Gravity and the air, and nothing else.
    //
    // The air is thicker than the shaft's was — this is not a clean rectangular
    // hoistway any more, it is a machine, and the cage is tumbling through it
    // broadside. That is a tuning decision as much as a physical one: at the
    // shaft's own drag the terminal velocity is 88 m/s and the gear rims strobe
    // past too fast to read as gear rims.
    // There is no rail left to clamp, no landing to arrive at and no buffer to
    // compress. The fall runs out at terminal velocity and then simply keeps
    // going at it — and that it *stops getting faster* is the worst part of it:
    // the last thing that was still changing stops changing.
    force += Math.sign(s.cageV) * CAGE_DRAG * speed * speed
    force -= Math.sign(s.cageV) * OBLIVION_DRAG * speed * speed
    s.spark *= Math.exp(-dt * 1.2)
    return force
  }

  if (s.mode === MODE_FALL) {
    s.spark *= Math.exp(-dt * 3.5)
    if (s.y <= brakeYFor(s.loop)) {
      s.mode         = MODE_BRAKE
      s.modeTime     = 0
      s.brakeEngaged = 0
    }
    return force
  }

  // ---- MODE_BRAKE ----
  s.brakeEngaged += dt

  if (s.loop >= OBLIVION_LOOP) {
    // The shoes fire, and go on firing, and it makes no difference.
    //
    // Three arrivals have polished the guide rails, so the wedges cannot seat
    // against anything: they bite, tear free, and bite again with less behind
    // them each time. `grab` is the chatter — a hard clamp for a fraction of a
    // second, then nothing — and `grip` is what is left of the shoes, which is
    // less every second. Early on the two together very nearly cancel gravity,
    // so the cage hangs there shrieking and throwing a wall of sparks and
    // *almost* holds. Then it does not.
    const seat = Math.min(1, s.brakeEngaged / 0.30)
    const grip = Math.max(0, 1 - s.brakeEngaged / OBLIVION_GRIP)
    // Never all the way to nothing between grabs: the shoes stay in contact and
    // shriek the whole way down, they just stop being able to hold.
    const grab = 0.30 + 0.70 * Math.max(0, Math.sin(s.brakeEngaged * OBLIVION_CHATTER)) ** 2
    const f    = OBLIVION_BITE * seat * grip * grab * OBLIVION_HOLD

    const needed = -CAGE_MASS * s.cageV / dt - force
    force += Math.sign(needed) * Math.min(f, Math.abs(needed))
    s.spark = Math.min(1, f * speed / 240000 + grip * grab * 0.35)

    // The pit floor is not there this time.
    if (s.y < PIT_Y) {
      s.mode     = MODE_OBLIVION
      s.modeTime = 0
    }
    return force
  }

  // The impulse the shoes would have to supply to zero the velocity this step,
  // after every other force is accounted for. Friction can deliver up to `f` of
  // this and no more — and because it is signed by `needed` rather than by
  // velocity, it also holds the cage statically once stopped instead of leaving
  // a residual crawl.
  const needed = -CAGE_MASS * s.cageV / dt - force

  if (s.creeping) {
    // Held on the shoes and lowered under control: a velocity servo running the
    // cage down the last few metres onto the landing. The demand tapers with
    // the remaining travel, so it arrives *at* the floor rather than through it
    // and into the buffers.
    const target = -Math.min(CREEP_SPEED, Math.max(0, s.y - LANDING_Y) * 4.0)
    const servo  = CAGE_MASS * (target - s.cageV) / dt - force
    force += Math.max(0, Math.min(servo, CREEP_MAX_FORCE))
    s.spark = Math.min(1, 0.18 + speed / CREEP_SPEED * 0.22)
  }
  else {
    const f = brakeForce(speed, s.brakeEngaged)
    force += Math.sign(needed) * Math.min(f, Math.abs(needed))
    s.spark = Math.min(1, f * speed / 900000) // friction power -> sparks

    // Once the shoes have taken the speed out they slip to the governed
    // lowering above. Without this exit the cage sits stopped short of the
    // landing with no force able to move it — a dead state.
    if (speed < 0.4) {
      s.settleTime += dt
      if (s.settleTime > 0.5) {
        s.creeping   = true
        s.settleTime = 0
      }
    }
    else
      s.settleTime = 0
  }

  // Hydraulic buffers in the pit, for an arrival the shoes did not catch.
  const compress = LANDING_Y - s.y
  if (compress > 0) {
    force += BUFFER_K * Math.pow(compress, BUFFER_POWER)
    if (s.cageV < 0)
      force -= BUFFER_C * s.cageV
  }

  // Down, stopped and level with the hall: the gate can open.
  if (s.creeping && s.y <= LANDING_Y + 0.05 && speed < 0.30) {
    s.y          = LANDING_Y
    s.cageV      = 0
    s.mode       = MODE_SETTLE
    s.modeTime   = 0
    s.settleTime = 0
    s.creeping   = false
    return 0
  }

  return force
}

/**
 * Advance the cage and the six free bodies riding in it, and resolve their
 * contacts. Returns the summed impact speed, which feeds the shake.
 */
function stepCage (s: FoundryState, dt: number): number {
  const prevV = s.cageV

  // Semi-implicit Euler: integrate velocity from the summed forces, then
  // position from the *new* velocity — stable under the stiff buffer spring in
  // a way that explicit Euler is not.
  const accel = cageForce(s, dt) / CAGE_MASS
  s.cageV += accel * dt
  s.y += s.cageV * dt
  s.cageA = (s.cageV - prevV) / dt

  // The oblivion shaft is periodic, so `y` is allowed to wrap inside it once
  // it has fallen a full period — see OBLIVION_PERIOD for why it has to. The
  // debris are carried in world height rather than in the cage's frame, so they
  // have to be lifted by exactly the same amount or the wrap would leave the
  // whole contents of the cage behind in a place that no longer exists.
  if (s.mode === MODE_OBLIVION) {
    s.fallen -= s.cageV * dt
    while (s.y < PIT_Y - OBLIVION_PERIOD) {
      s.y += OBLIVION_PERIOD
      for (let i = 0; i < s.debris.length; i++)
        s.debris[i].py += OBLIVION_PERIOD
    }
  }

  // ---- debris: free bodies colliding with the moving cage ----
  // Bodies move after the cage, so their contacts see this step's cage state.
  let impactSum = 0
  for (let i = 0; i < s.debris.length; i++) {
    const b = s.debris[i]
    // Per-body drag differs with size, so a free-falling cage and its contents
    // drift apart slowly instead of being perfectly locked — that slow relative
    // creep is what sells the weightlessness.
    const dragK = 0.34 * b.scale * b.scale
    const sp    = Math.hypot(b.vx, b.vy, b.vz)
    b.vx += -dragK * sp * b.vx / b.mass * dt
    b.vy += (-G - dragK * sp * b.vy / b.mass) * dt
    b.vz += -dragK * sp * b.vz / b.mass * dt
    b.px += b.vx * dt
    b.py += b.vy * dt
    b.pz += b.vz * dt
    impactSum += collideWithCage(b, s.y, s.cageV)

    // Angular drag so the tumble settles once bodies come to rest.
    const angDamp = Math.exp(-dt * 0.55)
    b.wx *= angDamp
    b.wy *= angDamp
    b.wz *= angDamp
    integrateQuat(b, dt)
  }

  return impactSum + stepBodyContacts(s)
}

/**
 * Bounding-sphere contacts between debris bodies. Returns the summed closing
 * speed so these impacts register too.
 */
function stepBodyContacts (s: FoundryState): number {
  let impactSum = 0
  // Bounding-sphere pairs only (15 for 6 bodies). Full box-box manifolds would
  // be far more code for a contact that is on screen for a second at a time;
  // spheres are enough to stop offcuts from visibly occupying the same space.
  for (let i = 0; i < s.debris.length; i++)
    for (let j = i + 1; j < s.debris.length; j++) {
      const a    = s.debris[i]
      const b    = s.debris[j]
      const dx   = b.px - a.px
      const dy   = b.py - a.py
      const dz   = b.pz - a.pz
      const rsum = (a.scale + b.scale) * 0.55
      const d2   = dx * dx + dy * dy + dz * dz
      if (d2 >= rsum * rsum || d2 < 1e-9)
        continue

      const dist    = Math.sqrt(d2)
      const nx      = dx / dist
      const ny      = dy / dist
      const nz      = dz / dist
      const overlap = rsum - dist

      // Split the positional correction by inverse mass so a heavy offcut
      // shoves a light one aside rather than both drifting equally.
      const invA   = 1 / a.mass
      const invB   = 1 / b.mass
      const invSum = invA + invB
      const corr   = overlap / invSum
      a.px -= nx * corr * invA
      a.py -= ny * corr * invA
      a.pz -= nz * corr * invA
      b.px += nx * corr * invB
      b.py += ny * corr * invB
      b.pz += nz * corr * invB

      // Normal impulse, only if they are closing.
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz
      if (rvn >= 0)
        continue

      const jImp = -(1 + 0.28) * rvn / invSum
      a.vx -= nx * jImp * invA
      a.vy -= ny * jImp * invA
      a.vz -= nz * jImp * invA
      b.vx += nx * jImp * invB
      b.vy += ny * jImp * invB
      b.vz += nz * jImp * invB

      // Off-centre contact spins them.
      const spin = jImp * 0.5
      a.wx -= ny * spin * invA
      a.wz += nx * spin * invA
      b.wx += ny * spin * invB
      b.wz -= nx * spin * invB
      impactSum += -rvn * 0.5
    }

  return impactSum
}

/** Flywheel and the two pendulums — three scalar ODEs. */
function stepMechanisms (s: FoundryState, dt: number): void {
  // ---- flywheel driving the wall pistons ----
  // I·dω/dt = motor torque − load torque(θ) − viscous damping.
  const inertia = 46
  const load    = 120 + 90 * Math.sin(s.crank * 2)
  const motor   = 340
  s.crankOmega += (motor - load - 12 * s.crankOmega) / inertia * dt
  s.crank = (s.crank + s.crankOmega * dt) % (Math.PI * 2)

  // ---- cage hook: damped pendulum excited by the cage's own acceleration ----
  const hookLen = 1.35
  const hookAcc =
    -(G + s.cageA) / hookLen * Math.sin(s.hook) - 0.9 * s.hookOmega
  s.hookOmega += hookAcc * dt
  s.hook += s.hookOmega * dt

  // ---- hall chain: the same pendulum, hung from the hoist beams and excited
  // by the floor tremor instead, so your own footfalls set it swinging ----
  const chainLen = 2.4
  const chainAcc =
    -(G + s.tremorV * 12.0) / chainLen * Math.sin(s.chain) - 0.42 * s.chainOmega
  s.chainOmega += chainAcc * dt
  s.chain += s.chainOmega * dt
}

/**
 * Index of the span tile under the walker, or -1 if they are on hall plate.
 *
 * Two dimensions, not one: the route turns, so several tiles share a `z` and
 * only the lateral coordinate tells them apart. A z-only test would have the
 * walker riding the ring of the wrong tile all the way across the hall.
 */
function tileUnderfoot (s: FoundryState): number {
  let best  = -1
  let bestD = TILE_HALF + 0.4
  for (let i = 0; i < SPAN_TILES; i++) {
    const dz = Math.abs(cycDelta(tileZ(i), s.z))
    const dx = Math.abs(tileX(i) - s.lateral)
    const d  = Math.max(dx, dz) // square plates, so Chebyshev is the honest metric
    if (d < bestD) {
      bestD = d
      best  = i
    }
  }
  return best
}

/**
 * The stepping stones: the furnace floor is cut away over the melt, and the only
 * walkway is a plate that tumbles across it ahead of you.
 *
 * Each tile is a hinged mechanism, not an animation. Its fold coordinate is a
 * damped second-order hinge driven toward 0 (stowed flat on its predecessor) or
 * 1 (landed in its own place), so it *overshoots and settles* when it slams
 * over, the path visibly springs into position a moment before it is needed, and
 * a boot landing on a tile sets it ringing under you.
 *
 * Measured in distance *along the route*, not in z: the lateral legs of the
 * crossing buy no forward progress at all, and keying the deployment off z would
 * throw the whole far side of the hall open the instant you reached that z.
 */
function stepSpan (s: FoundryState, dt: number): void {
  const walking = s.mode === MODE_WALK
  const arc     = s.dist - (s.lapEnd - LAP_ARC)
  for (let i = 0; i < SPAN_TILES; i++) {
    const ahead = tileArc(i) - arc
    // Flip it over well before you arrive, fold it away once you are safely
    // past. With nobody out on the walk the plate has no reason to be out at all.
    const target = walking && ahead < UNFOLD_LEAD && ahead > -REFOLD_LAG ? 1 : 0
    const acc    = HINGE_K * (target - s.fold[i]) - HINGE_C * s.foldOmega[i]
    s.foldOmega[i] += acc * dt
    s.fold[i] += s.foldOmega[i] * dt
  }
}

/**
 * The camera while riding the cage down. None of the gait applies: the head is
 * carried by the car, the shake is the car's own jerk plus whatever the offcuts
 * are doing to its floor, and the gaze drops toward vertical as the speed
 * builds — you look at what is coming up at you.
 */
function stepRide (s: FoundryState, impactSum: number): void {
  const shakeMag = Math.min(
    1,
    Math.abs(s.cageA) / 26 + impactSum * 0.05 + s.spark * 0.30,
  )
  s.shakeX = shakeMag * Math.sin(s.y * 37.4 + s.crank * 5.1)
  s.shakeY = shakeMag * Math.sin(s.y * 51.7 - s.crank * 3.3)

  s.eyeY = s.y + EYE_HEIGHT + s.tremor * 0.5 + s.shakeY * 0.045
  s.sway = s.shakeX * 0.035
  s.yaw  = s.shakeX * 0.012
  s.roll = s.shakeX * 0.030

  // A hoist shaft is a closed box, so the speed is legible in one place only:
  // the wall streaming up past the gate. The gaze is pinned to it — dropping as
  // the fall builds, lifting back to level as the shoes take the speed out,
  // which leaves you looking into the hall exactly as the gate starts to move.
  const fast = smoothstep(2, 26, Math.abs(s.cageV))

  s.pitch = -0.20 - 0.42 * fast + s.cageA * 0.0035
}

/**
 * The walk. Forward speed is trivially a relaxation to a walking pace; the
 * interesting part is that everything the camera does is a *consequence* of it.
 *
 * Head height rides a damped leg spring whose rest length is the walking
 * surface; every heel strike kicks that spring downward, so the head dips
 * sharply on contact and rebounds with a decaying ring rather than tracing a
 * sine. Weight transfer kicks an alternating lateral spring tuned to one stride
 * period, and the head's roll and yaw are read straight off that sway. Over the
 * folding span the spring's rest length is the panel you are standing on, so the
 * mechanism's ring shows up in your eyes.
 */
const scratchRoute: RoutePoint = { x: 0, z: 0, dx: 0, dz: 1 }

function stepWalker (s: FoundryState, dt: number): void {
  // Stepping out of the cage accelerates you to a pace; stepping back into it
  // at the end of the lap brings you to a stand inside it.
  const target = s.mode === MODE_WALK ? WALK_SPEED : 0
  s.v += (target - s.v) * Math.min(1, dt * (target > 0 ? 1.4 : 4.0))
  s.dist += s.v * dt

  // Where that distance has actually put you. Off the span this is the identity
  // and `z` is just `dist`; on it the route turns, and the two part company by
  // as much as SPAN_EXTRA over the crossing.
  const r   = routeAt(s.dist - (s.lapEnd - LAP_ARC), scratchRoute)
  s.z       = cyclic(r.z)
  s.lateral = r.x
  s.head    = Math.atan2(r.dx, r.dz)

  const decay = decayFor(s.smoothLoop)

  // ---- footfalls ----
  const prevStride = s.stride
  s.stride += s.v / STEP_LEN * dt
  if (Math.floor(s.stride) > Math.floor(prevStride)) {
    const n = Math.floor(s.stride)
    s.foot  = -s.foot
    // No two steps are identical, and the further the lap has decayed the more
    // the gait staggers.
    s.bobV -= HEEL_KICK * (0.85 + 0.30 * hash11(n) + decay * 0.55 * hash11(n * 3.7))
    s.swayV += SWAY_KICK * s.foot * (0.9 + 0.2 * hash11(n * 1.7))

    const tile = tileUnderfoot(s)
    if (tile >= 0)
      s.foldOmega[tile] -= HINGE_KICK
  }

  // ---- leg spring and sway spring ----
  const tile   = tileUnderfoot(s)
  // Standing on the span you ride the plate: its hinge ring is your ground.
  const ground = tile >= 0 ? (s.fold[tile] - 1) * 0.10 : 0

  s.bobV += (LEG_K * (ground - s.bob) - LEG_C * s.bobV) * dt
  s.bob += s.bobV * dt
  s.swayV += (-SWAY_K * s.sway - SWAY_C * s.swayV) * dt
  s.sway += s.swayV * dt

  // ---- camera pose, all of it read off the gait ----
  s.eyeY  = LANDING_Y + EYE_HEIGHT + s.bob + s.tremor * 0.6 + Math.sin(s.dist * 0.65) * 0.006
  // You face the way the route goes. `head` is C¹ in distance walked (the route
  // is a cubic B-spline and its speed never reaches zero), so the four turns out
  // on the span arrive as turns rather than as cuts.
  s.yaw   = s.head + s.sway * 0.85 + Math.sin(s.dist * 0.013) * 0.045
  // ...and look down when you are crossing sideways. Nobody walks a two-metre
  // plate over a melt staring straight ahead, and a level gaze on the lateral
  // legs of the span points at nothing but the far wall — the walkway you are
  // actually standing on falls below the bottom of the frame.
  s.pitch = -0.05 + s.bobV * 0.022 - s.tremorV * 0.010 - Math.abs(s.head) * 0.30
  // ...and lean into them, a little, the way anyone does.
  s.roll  = -s.sway * 0.50 + s.tremor * 0.40 - s.head * 0.10

  const jolt = Math.min(1, Math.abs(s.tremorV) * 0.45)
  s.shakeX   = jolt * Math.sin(s.dist * 41.3 + s.crank * 5.1)
  s.shakeY   = jolt * Math.sin(s.dist * 57.7 - s.crank * 3.3)
}

/** Take the lap counter up and let go of the cable again, behind the shutter. */
function beginNextDrop (s: FoundryState): void {
  s.mode         = MODE_FALL
  s.modeTime     = 0
  s.gate         = 0
  s.y            = liftTopFor(s.loop + 1)
  s.cageV        = -2
  s.cageA        = 0
  s.cableIntact  = false
  s.brakeEngaged = 0
  s.settleTime   = 0
  s.creeping     = false
  s.v            = 0
  s.loop        += 1

  // Snap to the exact boarding point before opening the next lap, so the metre
  // or so of overshoot walking into the cage does not accumulate lap on lap.
  //
  // `z` is *not* cyclic(dist) any more and has not been since the span learned
  // to turn: a lap is LAP_ARC of walking but only CYCLE_LEN of ground, so
  // wrapping the distance would land every lap SPAN_EXTRA further down the
  // loading bay than the last one. The boarding point is a fixed place in the
  // world, so it is written as one.
  s.dist    = s.lapEnd
  s.z       = WALK_START
  s.lateral = 0
  s.head    = 0
  s.lapEnd  = s.dist + LAP_ARC

  const rand = mulberry32((Math.floor(s.dist * 977) ^ 0x9e3779b9) >>> 0)
  s.debris   = spawnDebris(rand, s.y)
}

/**
 * The lap's phase machine. Every transition here is a state the *simulation*
 * arrives at — the cage stops because the shoes stopped it, the walk starts
 * because the gate finished opening — so the sequence is identical at any frame
 * rate or speed setting.
 *
 * The one thing that is not physical is the swap at the end of a lap, and it is
 * deliberately hidden: the shutter comes down over both open faces of the cage
 * first, so the cage is a sealed box at the moment it becomes a cage at the top
 * of the shaft again. Nothing on screen ever jumps.
 */
function stepPhase (s: FoundryState, dt: number): void {
  s.modeTime += dt

  if (s.mode === MODE_FALL || s.mode === MODE_OBLIVION)
    // The shutter rattles back up once the cable has gone, which is how you
    // find out you are already falling. In oblivion it is long since up, and
    // there is no transition out of that phase to write: it is the last one.
    s.shutter = Math.max(0, s.shutter - dt / REOPEN_TIME)
  else if (s.mode === MODE_SETTLE) {
    s.gate = Math.min(1, s.gate + dt / GATE_TIME)
    if (s.gate >= 1) {
      s.mode     = MODE_WALK
      s.modeTime = 0
    }
  }
  else if (s.mode === MODE_WALK && s.dist >= s.lapEnd) {
    s.mode     = MODE_BOARD
    s.modeTime = 0
  }
  else if (s.mode === MODE_BOARD) {
    s.shutter = Math.min(1, s.shutter + dt / SHUTTER_TIME)
    s.gate    = Math.max(0, 1 - s.shutter)
    // The world gets worse behind the shutter, so the ramp is never on screen.
    s.smoothLoop = s.loop + s.shutter
    if (s.shutter >= 1)
      beginNextDrop(s)
  }

  if (s.mode !== MODE_BOARD)
    s.smoothLoop = s.loop
}

function step (s: FoundryState, dt: number): void {
  stepPhase(s, dt)

  const impactSum = stepCage(s, dt)
  stepMechanisms(s, dt)
  stepSpan(s, dt)

  // Every impact travels up through whatever you are standing on — the cage's
  // floor while riding, the hall's plate while walking.
  s.tremorV += (-TREMOR_K * s.tremor - TREMOR_C * s.tremorV) * dt
  s.tremor += s.tremorV * dt
  if (impactSum > 0.05 || Math.abs(s.cageA) > 25)
    s.tremorV -= impactSum * 0.02 + Math.max(0, Math.abs(s.cageA) - 25) * 0.004

  if (s.mode === MODE_WALK || s.mode === MODE_BOARD)
    stepWalker(s, dt)
  else
    stepRide(s, impactSum)
}

/**
 * Advance the simulation by `elapsed` seconds using fixed sub-steps, so the
 * result is frame-rate independent and identical at 30, 60 or 144 Hz.
 * Returns the leftover accumulator, which the caller carries forward.
 */
export function advance (s: FoundryState, elapsed: number, carry: number): number {
  let acc   = carry + Math.min(elapsed, 0.25)
  let steps = 0
  while (acc >= DT && steps < MAX_SUBSTEPS) {
    step(s, DT)
    acc -= DT
    steps++
  }
  if (steps === MAX_SUBSTEPS)
    acc = 0 // drop the backlog rather than spiral
  return acc
}

/** Exact slider-crank displacement — the real mechanism, not a sine wave. */
export function pistonExtension (crank: number, radius = 0.62, rod = 1.9): number {
  const s = radius * Math.sin(crank)
  return radius * Math.cos(crank) + Math.sqrt(Math.max(0, rod * rod - s * s))
}

// perf: cheap. 1 walker + 6 rigid bodies + 1 cage + 3 scalar ODEs + 8 hinges at
// 120 Hz is ~0.06 ms per frame on the main thread; allocation-free after
// construction (the only allocation is the debris respawn once per lap).
