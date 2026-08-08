// THE FOUNDRY — rigid-body simulation of a walking loop.
//
// Unlike the other journeys (whose motion is authored as easing curves baked
// into GLSL), the Foundry's walker, cage, debris and machinery are *simulated on
// the CPU* with a deterministic fixed-step integrator, and the resulting state
// is pushed to the fragment shader as uniforms each frame. Nothing here is a
// sin() approximation of physics — it is the physics.
//
// The journey is a loop: one continuous first-person walk through seven machine
// halls that closes back onto the first, forever. Distance walked is the only
// clock — the shader's geometry is periodic in it (CYCLE_LEN), so the seam
// between the last hall and the first is the same cross-fade as every other
// section boundary and nothing is ever teleported.
//
// What is actually integrated:
//   • Walker     — an inverted-pendulum gait. Head height rides a damped leg
//                  spring that each heel strike kicks downward, weight transfer
//                  kicks an alternating lateral sway spring, and the folding
//                  span's panels ring under the feet that land on them. The
//                  camera pose is the *output* of that, never a sine wave.
//   • Cage       — a hoist cage in the vertical shaft that crosses the corridor:
//                  semi-implicit Euler under gravity, quadratic aerodynamic
//                  drag, a tension-only cable spring-damper, brake-shoe Coulomb
//                  friction, and a nonlinear hydraulic buffer. It is armed by
//                  the walker's *position*, so the cable parts a fixed distance
//                  short of the crossing and it streaks past as you arrive.
//   • Debris     — 6 free rigid bodies (linear + angular) riding in the cage,
//                  colliding with its *moving* interior via relative-velocity
//                  impulses with restitution and Coulomb friction. During free
//                  fall they and the cage share an acceleration, so they float —
//                  and when the brakes bite, the cage stops and they do not.
//   • Flywheel   — angular momentum with motor torque and a load torque that
//                  varies with crank angle; drives the wall pistons through the
//                  exact closed-form slider-crank displacement.
//   • Chain/hook — damped pendulums with *base excitation*, i.e. swung by the
//                  cage's own acceleration and by the walker's footfalls rather
//                  than by a driving sine.
//
// Units are SI: metres, seconds, kilograms. +Y is up, the walk runs along +Z,
// and the hoist shaft descends into negative Y.

const DT           = 1 / 120 // fixed integration step
const MAX_SUBSTEPS = 6 // clamp so a stalled tab can't spiral

const G            = 9.81 // gravity
const DEBRIS_COUNT = 6

// --- the loop (mirrored by the shader) --------------------------------------

/** Section length, metres. Seven halls of this length make up one loop. */
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
const TREMOR_K   = 130 // floor-tremor spring (the buffer slam travels up it)
const TREMOR_C   = 5.5

/** Eye height above the walking surface, metres. */
export const EYE_HEIGHT = 1.62

// --- the hoist shaft crossing (mirrored by the shader) ----------------------

/**
 * Cyclic position at which the vertical hoist shaft crosses the corridor —
 * mid-way down the brake run, deliberately clear of a section boundary so the
 * bulkhead portal there does not stand in the cage's path.
 */
export const CROSS_Z = SECTION_LEN * 5 + 18

/** Half-width of the square hoist shaft. */
export const SHAFT_R = 2.4

/** Shaft head (ceiling) and the height the cage waits at between loops. */
export const SHAFT_HEAD_Y = 34
export const CAGE_PARK_Y = 26

/** Emergency shoes bite here, on the way down past the corridor. */
export const SHAFT_BRAKE_Y = -10

/** Hydraulic buffers at the bottom of the well. */
export const SHAFT_FLOOR_Y = -46

export const CAGE_HALF = 1.5 // cage interior half-width
export const CAGE_HEIGHT = 2.6

/** Metres short of the crossing at which the winch starts lowering the cage. */
const ARM_DIST = 40

/** Metres short of the crossing at which the cable parts. */
const SNAP_DIST = 5.5

// Metres past the crossing — out of sight behind you — before it is hoisted
// back to the shaft head for the next loop.
const RESET_DIST = 45

export const CAGE_PARKED = 0
export const CAGE_DESCENT = 1
export const CAGE_FREEFALL = 2
export const CAGE_BRAKING = 3
export const CAGE_BUFFER = 4

const CAGE_MASS       = 900 // kg, cage + load
const CAGE_DRAG       = 1.15 // ½ρCdA, quadratic drag coefficient
const CABLE_K         = 42000 // N/m
const CABLE_C         = 5200 // N·s/m
const CABLE_SAG       = CAGE_MASS * G / CABLE_K // static stretch under load
const PAYOUT_SPEED    = 0.4 // winch pay-out rate during the controlled descent
const CREEP_SPEED     = 6 // m/s, governed lowering rate once the shoes hold
const CREEP_MAX_FORCE = 60000 // N ceiling on the lowering servo
const BUFFER_K        = 260000 // N/m, hydraulic buffer stiffness
const BUFFER_C        = 34000 // N·s/m
const BUFFER_POWER    = 1.6 // >1 = progressively stiffer as it compresses

// --- the folding span (mirrored by the shader) ------------------------------

/** Cubes in the span that bridges the gap over the melt. */
export const SPAN_CUBES = 8
export const CUBE_SPACING = 4.0 // metres between cube centres
export const CUBE_HALF = 1.2 // cube half-size; faces are 2 x CUBE_HALF square

/** Cyclic position of the first cube's centre, in the furnace-floor hall. */
export const SPAN_Z0 = SECTION_LEN * 6 + 4

/** Molten surface far below the span. */
export const MELT_Y = -30

const UNFOLD_LEAD = 14 // metres of warning before you reach a cube
const REFOLD_LAG  = 5 // metres behind you before it closes again
const HINGE_K     = 46 // hinge stiffness — higher snaps the panels open
const HINGE_C     = 7.5 // hinge damping — lower leaves them ringing
const HINGE_KICK  = 0.42 // hinge rate injected by a footfall landing on a panel

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

  // --- the walker ---------------------------------------------------------

  /** Total distance walked, metres. The journey's only clock. */
  dist: number

  /** Position within the current loop, 0..CYCLE_LEN. */
  z: number

  /** Completed loops, and the version that ramps smoothly across the wrap. */
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

  /** Floor tremor travelling up from the buffer slam, and its rate. */
  tremor:  number
  tremorV: number

  /** Camera pose, all of it derived from the gait above. */
  eyeY:   number
  yaw:    number
  pitch:  number
  roll:   number
  shakeX: number
  shakeY: number

  // --- the cage in the crossing shaft -------------------------------------
  phase: number

  /** Cage floor height, metres. */
  y: number

  /** Cage vertical velocity, m/s (negative = falling). */
  cageV: number

  /** Cage vertical acceleration, m/s² — drives the hook and the tremor. */
  cageA: number

  /** Unspooled cable length; the cable only pulls once y drops below it. */
  cableRest:   number
  cableIntact: boolean

  /** Instantaneous brake friction power, normalised 0..1 — spark intensity. */
  spark: number

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

/** Wrap a distance into one loop, 0..CYCLE_LEN. */
export function cyclic (z: number): number {
  return z - CYCLE_LEN * Math.floor(z / CYCLE_LEN)
}

/** Signed distance from `from` to `to` the short way round the loop. */
export function cycDelta (to: number, from: number): number {
  const d = cyclic(to - from)
  return d > CYCLE_LEN * 0.5 ? d - CYCLE_LEN : d
}

function smoothstep (a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How hard the world is coming apart on this loop, 0..0.85. A little more each
 * circuit — enough that the second lap is visibly wrong and the fifth is barely
 * holding together, but never so much that you cannot see where you are walking.
 */
export function decayFor (smoothLoop: number): number {
  return Math.min(0.85, smoothLoop * 0.11)
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
    dist:        0,
    z:           0,
    loop:        0,
    smoothLoop:  0,
    v:           0,
    stride:      0,
    foot:        1,
    bob:         0,
    bobV:        0,
    sway:        0,
    swayV:       0,
    tremor:      0,
    tremorV:     0,
    eyeY:        EYE_HEIGHT,
    yaw:         0,
    pitch:       0,
    roll:        0,
    shakeX:      0,
    shakeY:      0,
    phase:       CAGE_PARKED,
    y:           CAGE_PARK_Y,
    cageV:       0,
    cageA:       0,
    cableRest:   CAGE_PARK_Y + CABLE_SAG,
    cableIntact: true,
    spark:       0,
    settleTime:  0,
    creeping:    false,
    debris:      spawnDebris(rand, CAGE_PARK_Y),
    crank:       0,
    crankOmega:  5.4,
    hook:        0.18,
    hookOmega:   0,
    chain:       0.12,
    chainOmega:  0,
    fold:        new Array<number>(SPAN_CUBES).fill(0),
    foldOmega:   new Array<number>(SPAN_CUBES).fill(0),
  }
}

/**
 * Emergency brake force, in newtons, opposing the cage's motion.
 *
 * ── This function defines how the plunge past you *feels*. ──
 * The shoes clamp the guide rails, so this is Coulomb friction: μ·N, where the
 * normal force N is what the wedge mechanism applies. The realistic subtlety is
 * that N does not appear instantly — the shoes take time to seat, and once
 * seated, sliding friction is lower than the initial static grab.
 *
 * Trade-offs worth playing with:
 *   • A large constant force  → a violent, near-instant slam. High jerk, huge
 *     shower of sparks, debris hammers the floor. Reads as catastrophic.
 *   • A ramp on `engaged`     → a progressive squeal, several seconds of
 *     shrieking deceleration. More dread, less impact.
 *   • Velocity-dependent μ    → grabby at low speed, glassy at high speed; the
 *     cage judders (stick-slip) as it slows. Most physically honest, and the
 *     most expensive in spark budget.
 *
 * @param speed    absolute cage speed, m/s
 * @param engaged  seconds since the shoes made contact
 */
export function brakeForce (speed: number, engaged: number): number {
  // Wedge seating: normal force climbs over ~0.35 s to full clamp.
  const seat   = Math.min(1, engaged / 0.35)
  const normal = 34000 * seat
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

// Time the brake shoes have been in contact, kept outside the state object
// because it is pure integrator bookkeeping rather than renderable state.
let brakeEngaged = 0

/** Hoist the cage back to the shaft head with a fresh scatter of debris. */
function resetCage (s: FoundryState): void {
  s.phase       = CAGE_PARKED
  s.y           = CAGE_PARK_Y
  s.cageV       = 0
  s.cageA       = 0
  s.cableRest   = CAGE_PARK_Y + CABLE_SAG
  s.cableIntact = true
  s.settleTime  = 0
  s.creeping    = false
  brakeEngaged  = 0

  const rand = mulberry32((Math.floor(s.dist * 977) ^ 0x9e3779b9) >>> 0)
  s.debris   = spawnDebris(rand, CAGE_PARK_Y)
}

/**
 * Sum the vertical forces on the cage for this step and advance its phase.
 * Returns the net force in newtons; the caller integrates it.
 *
 * The phase machine is driven by *where the walker is*, not by a timer: the
 * winch starts lowering ARM_DIST short of the crossing and the cable parts
 * SNAP_DIST short of it, which is exactly enough head start for the cage to be
 * doing ~20 m/s through the corridor as you reach the well.
 */
function cageForce (s: FoundryState, dt: number): number {
  const toCross = cycDelta(CROSS_Z, s.z)

  if (s.phase === CAGE_PARKED) {
    // Held at the shaft head on a taut cable, out of sight above the ceiling.
    s.y     = CAGE_PARK_Y
    s.cageV = 0
    s.spark *= Math.exp(-dt * 3.5)
    if (toCross > 0 && toCross < ARM_DIST)
      s.phase = CAGE_DESCENT
    return 0
  }

  // Everything past here is out of the cable's control or on its way there.
  let force = -CAGE_MASS * G
  const speed = Math.abs(s.cageV)
  force -= Math.sign(s.cageV) * CAGE_DRAG * speed * speed // quadratic aero drag

  if (s.phase === CAGE_DESCENT) {
    s.cableRest -= PAYOUT_SPEED * dt

    // Tension-only: a cable can pull, never push.
    const stretch = s.cableRest - s.y
    if (stretch > 0)
      force += CABLE_K * stretch - CABLE_C * s.cageV
    if (toCross > 0 && toCross < SNAP_DIST) {
      s.cableIntact = false
      s.phase       = CAGE_FREEFALL
      brakeEngaged  = 0
    }
  }
  else if (s.phase === CAGE_FREEFALL) {
    if (s.y <= SHAFT_BRAKE_Y)
      s.phase = CAGE_BRAKING
  }

  if (s.phase === CAGE_BRAKING) {
    brakeEngaged += dt

    // The impulse the shoes would have to supply to zero the velocity this
    // step, after every other force is accounted for. Friction can deliver up
    // to `f` of this and no more — and because it is signed by `needed` rather
    // than by velocity, it also holds the cage statically once stopped instead
    // of leaving a residual crawl.
    const needed = -CAGE_MASS * s.cageV / dt - force

    if (s.creeping) {
      // Held on the shoes and lowered under control: a velocity servo running
      // the cage down the last of the well at a fixed rate.
      const servo = CAGE_MASS * (-CREEP_SPEED - s.cageV) / dt - force
      force += Math.max(0, Math.min(servo, CREEP_MAX_FORCE))
      s.spark = Math.min(1, 0.22 + speed / CREEP_SPEED * 0.25)
    }
    else {
      const f = brakeForce(speed, brakeEngaged)
      force += Math.sign(needed) * Math.min(f, Math.abs(needed))
      s.spark = Math.min(1, f * speed / 620000) // friction power -> sparks

      // If the shoes bring it to a stand short of the floor, they slip to the
      // governed lowering above. Without this exit the cage sits stopped with
      // no force able to move it — a dead state the phase machine never leaves.
      if (speed < 0.08) {
        s.settleTime += dt
        if (s.settleTime > 1.5) {
          s.creeping   = true
          s.settleTime = 0
        }
      }
      else
        s.settleTime = 0
    }

    if (s.y <= SHAFT_FLOOR_Y) {
      s.phase      = CAGE_BUFFER
      s.settleTime = 0
    }
  }
  else
    s.spark *= Math.exp(-dt * 3.5)

  if (s.phase === CAGE_BUFFER) {
    // Seconds since the slam, so the HUD can stop reporting it once the
    // shock has rung out of the floor.
    s.settleTime += dt

    const compress = SHAFT_FLOOR_Y - s.y
    if (compress > 0) {
      // Nonlinear hydraulic buffer: stiffens as it compresses, damps velocity.
      force += BUFFER_K * Math.pow(compress, BUFFER_POWER)
      if (s.cageV < 0)
        force -= BUFFER_C * s.cageV
    }
  }

  // Once the well is well behind you the winch takes it back up for the next
  // circuit. Nothing on screen moves — it happens out of sight.
  if (toCross < -RESET_DIST)
    resetCage(s)

  return force
}

/**
 * Advance the cage and the six free bodies riding in it, and resolve their
 * contacts. Returns the summed impact speed, which feeds the floor tremor.
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

/** Index of the span cube nearest the walker, or -1 if the span is elsewhere. */
function cubeUnderfoot (s: FoundryState): number {
  let best  = -1
  let bestD = CUBE_SPACING * 0.5 + 0.4
  for (let i = 0; i < SPAN_CUBES; i++) {
    const d = Math.abs(cycDelta(SPAN_Z0 + i * CUBE_SPACING, s.z))
    if (d < bestD) {
      bestD = d
      best  = i
    }
  }
  return best
}

/**
 * The folding span: the furnace floor is cut away over the melt, and the only
 * walkway is a line of cubes that unfold their six faces about hinge edges.
 *
 * Each cube is a hinged mechanism, not an animation. Its faces share one fold
 * coordinate integrated as a damped second-order hinge driven toward an open or
 * closed target — so the panels *overshoot and settle* when they slam open, the
 * path visibly springs into place a moment before it is needed, and a boot
 * landing on a panel sets it ringing under you.
 */
function stepSpan (s: FoundryState, dt: number): void {
  for (let i = 0; i < SPAN_CUBES; i++) {
    const ahead = cycDelta(SPAN_Z0 + i * CUBE_SPACING, s.z)
    // Unfold well before you arrive, refold once you are safely past.
    const target = ahead < UNFOLD_LEAD && ahead > -REFOLD_LAG ? 1 : 0
    const acc    = HINGE_K * (target - s.fold[i]) - HINGE_C * s.foldOmega[i]
    s.foldOmega[i] += acc * dt
    s.fold[i] += s.foldOmega[i] * dt
  }
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
function stepWalker (s: FoundryState, dt: number): void {
  s.v += (WALK_SPEED - s.v) * Math.min(1, dt * 1.4)
  s.dist += s.v * dt
  s.z    = cyclic(s.dist)
  s.loop = Math.floor(s.dist / CYCLE_LEN)
  // Ramp the loop across the wrap so the decay never steps in a single frame.
  s.smoothLoop = s.loop + smoothstep(CYCLE_LEN - TRANSITION, CYCLE_LEN, s.z)

  const decay = decayFor(s.smoothLoop)

  // ---- footfalls ----
  const prevStride = s.stride
  s.stride += s.v / STEP_LEN * dt
  if (Math.floor(s.stride) > Math.floor(prevStride)) {
    const n = Math.floor(s.stride)
    s.foot  = -s.foot
    // No two steps are identical, and the further the loop has decayed the more
    // the gait staggers.
    s.bobV -= HEEL_KICK * (0.85 + 0.30 * hash11(n) + decay * 0.55 * hash11(n * 3.7))
    s.swayV += SWAY_KICK * s.foot * (0.9 + 0.2 * hash11(n * 1.7))

    const cube = cubeUnderfoot(s)
    if (cube >= 0)
      s.foldOmega[cube] -= HINGE_KICK
  }

  // ---- leg spring, sway spring, floor tremor ----
  const cube   = cubeUnderfoot(s)
  // Standing on the span you ride the panel: its hinge ring is your ground.
  const ground = cube >= 0 ? (s.fold[cube] - 1) * 0.10 : 0

  s.bobV += (LEG_K * (ground - s.bob) - LEG_C * s.bobV) * dt
  s.bob += s.bobV * dt
  s.swayV += (-SWAY_K * s.sway - SWAY_C * s.swayV) * dt
  s.sway += s.swayV * dt
  s.tremorV += (-TREMOR_K * s.tremor - TREMOR_C * s.tremorV) * dt
  s.tremor += s.tremorV * dt

  // ---- camera pose, all of it read off the gait ----
  s.eyeY  = EYE_HEIGHT + s.bob + s.tremor * 0.6 + Math.sin(s.dist * 0.65) * 0.006
  s.yaw   = s.sway * 0.85 + Math.sin(s.dist * 0.013) * 0.045
  s.pitch = -0.05 + s.bobV * 0.022 - s.tremorV * 0.010
  s.roll  = -s.sway * 0.50 + s.tremor * 0.40

  const jolt = Math.min(1, Math.abs(s.tremorV) * 0.45 + s.spark * 0.30)
  s.shakeX   = jolt * Math.sin(s.dist * 41.3 + s.crank * 5.1)
  s.shakeY   = jolt * Math.sin(s.dist * 57.7 - s.crank * 3.3)
}

function step (s: FoundryState, dt: number): void {
  stepWalker(s, dt)
  stepSpan(s, dt)

  const impactSum = stepCage(s, dt)
  stepMechanisms(s, dt)

  // The buffer slam and every debris impact travel up through the floor plate.
  // Distance is what makes it land as a thump rather than a constant rumble.
  const reach = Math.max(1, Math.abs(cycDelta(CROSS_Z, s.z)))
  if (impactSum > 0.05 || Math.abs(s.cageA) > 25) {
    const strength = (impactSum * 0.02 + Math.max(0, Math.abs(s.cageA) - 25) * 0.004) /
      (1 + reach * reach * 0.004)
    s.tremorV -= strength
  }
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
// construction (the only allocation is the debris respawn once per loop).
