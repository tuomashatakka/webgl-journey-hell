// THE FOUNDRY — rigid-body simulation.
//
// Unlike the other journeys (whose motion is authored as easing curves baked
// into GLSL), the Foundry's cage, debris and machinery are *simulated on the
// CPU* with a deterministic fixed-step integrator, and the resulting state is
// pushed to the fragment shader as uniforms each frame. Nothing here is a
// sin() approximation of physics — it is the physics.
//
// What is actually integrated:
//   • Cage       — semi-implicit Euler under gravity, quadratic aerodynamic
//                  drag, a tension-only cable spring-damper, brake-shoe
//                  Coulomb friction, and a nonlinear hydraulic buffer.
//   • Debris     — 6 free rigid bodies (linear + angular), colliding with the
//                  *moving* cage interior via relative-velocity impulses with
//                  restitution and Coulomb friction. During free fall they and
//                  the cage share an acceleration, so they float — and when the
//                  brakes bite, the cage stops and they do not.
//   • Flywheel   — angular momentum with motor torque and a load torque that
//                  varies with crank angle; drives the wall pistons through the
//                  exact closed-form slider-crank displacement.
//   • Hook       — damped pendulum with *base excitation*, i.e. it is swung by
//                  the cage's own acceleration rather than by a driving sine.
//
// Units are SI: metres, seconds, kilograms. +Y is up; the shaft descends into
// negative Y.

const DT           = 1 / 120 // fixed integration step
const MAX_SUBSTEPS = 6 // clamp so a stalled tab can't spiral

const G            = 9.81 // gravity
const DEBRIS_COUNT = 6

// --- shaft geometry (mirrored by the shader) -------------------------------
export const SHAFT_TOP = 0

/** Section length, metres. Seven bands of this length make up the shaft. */
export const SECTION_LEN = 200
export const SECTION_COUNT = 7

/** Cable parts entering the gearworks (start of section 5). */
export const SHAFT_SNAP_Y = -SECTION_LEN * 4

/** Emergency shoes bite entering the brake run (start of section 6). */
export const SHAFT_BRAKE_Y = -SECTION_LEN * 5

/** Hydraulic buffers at the bottom of the furnace floor. */
export const SHAFT_FLOOR_Y = -SECTION_LEN * SECTION_COUNT
export const CAGE_HALF = 1.5 // cage interior half-width
export const CAGE_HEIGHT = 2.6

export const PHASE_DESCENT = 0
export const PHASE_FREEFALL = 1
export const PHASE_BRAKING = 2
export const PHASE_BUFFER = 3

/** On foot, forward, over the infinite fall. */
export const PHASE_WALK = 4

const CAGE_MASS       = 900 // kg, cage + occupant
const CAGE_DRAG       = 1.15 // ½ρCdA, quadratic drag coefficient
const CABLE_K         = 42000 // N/m
const CABLE_C         = 5200 // N·s/m
const PAYOUT_SPEED    = 23 // winch pay-out rate during the controlled descent
const CREEP_SPEED     = 15 // m/s, governed lowering rate once the shoes hold
const CREEP_MAX_FORCE = 60000 // N ceiling on the lowering servo
const BUFFER_K        = 260000 // N/m, hydraulic buffer stiffness
const BUFFER_C        = 34000 // N·s/m
const BUFFER_POWER    = 1.6 // >1 = progressively stiffer as it compresses

// --- the walk (mirrored by the shader) -------------------------------------
export const PATH_CUBES = 8 // live cubes in the sliding window
export const CUBE_SPACING = 4.0 // metres between cube centres
export const CUBE_HALF = 1.2 // cube half-size; faces are 2 x CUBE_HALF square
export const WALK_LENGTH = 150 // metres of path before the cycle restarts

const WALK_SPEED  = 3.1 // m/s, walking pace
const UNFOLD_LEAD = 15 // metres of warning before you reach a cube
const REFOLD_LAG  = 5 // metres behind you before it closes again
const HINGE_K     = 46 // hinge stiffness — higher snaps the panels open
const HINGE_C     = 7.5 // hinge damping — lower leaves them ringing

export interface DebrisBody {

  /** World position of the body centre. */
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
  phase: number

  /** Cage floor height, metres. */
  y: number

  /** Cage vertical velocity, m/s (negative = falling). */
  v: number

  /** Cage vertical acceleration, m/s² — drives camera shake and the hook. */
  a: number

  /** Unspooled cable length; the cable only pulls once y drops below it. */
  cableRest:   number
  cableIntact: boolean

  /** Instantaneous brake friction power, normalised 0..1 — spark intensity. */
  spark: number

  /** Seconds spent settled at the bottom, gating the hoist. */
  settleTime: number

  /** Flywheel angle and rate driving the wall pistons. */
  crank:      number
  crankOmega: number

  /** Damped pendulum hook hanging from the cage roof. */
  hook:      number
  hookOmega: number
  shakeX:    number
  shakeY:    number
  debris:    DebrisBody[]

  /** True once the brake shoes have stalled the cage and slipped to a creep. */
  creeping: boolean

  /** Forward position and speed during PHASE_WALK, metres and m/s. */
  walkZ: number
  walkV: number

  /** World index of the first cube in the live window. */
  cubeBase: number

  /** Per-cube fold coordinate (0 = closed cube, 1 = fully unfolded). */
  fold:      number[]
  foldOmega: number[]
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
    phase:       PHASE_DESCENT,
    y:           SHAFT_TOP,
    v:           0,
    a:           0,
    cableRest:   0,
    cableIntact: true,
    spark:       0,
    settleTime:  0,
    crank:       0,
    crankOmega:  5.4,
    hook:        0.18,
    hookOmega:   0,
    shakeX:      0,
    shakeY:      0,
    debris:      spawnDebris(rand, SHAFT_TOP),
    creeping:    false,
    walkZ:       0,
    walkV:       0,
    cubeBase:    0,
    fold:        new Array<number>(PATH_CUBES).fill(0),
    foldOmega:   new Array<number>(PATH_CUBES).fill(0),
  }
}

/**
 * Emergency brake force, in newtons, opposing the cage's motion.
 *
 * ── This function defines how the whole journey *feels*. ──
 * The shoes clamp the guide rails, so this is Coulomb friction: μ·N, where the
 * normal force N is what the wedge mechanism applies. The realistic subtlety is
 * that N does not appear instantly — the shoes take time to seat, and once
 * seated, sliding friction is lower than the initial static grab.
 *
 * Trade-offs worth playing with:
 *   • A large constant force  → a violent, near-instant slam. High jerk, huge
 *     camera shake, debris hammers the floor. Reads as catastrophic.
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

/**
 * Sum the vertical forces on the cage for this step and advance its phase.
 * Returns the net force in newtons; the caller integrates it.
 */
function cageForce (s: FoundryState, dt: number): number {
  // ---- cage: sum forces, then semi-implicit Euler ----
  let force = -CAGE_MASS * G
  const speed = Math.abs(s.v)
  force -= Math.sign(s.v) * CAGE_DRAG * speed * speed // quadratic aero drag

  if (s.phase === PHASE_DESCENT) {
    s.cableRest -= PAYOUT_SPEED * dt

    // Tension-only: a cable can pull, never push.
    const stretch = s.cableRest - s.y
    if (stretch > 0)
      force += CABLE_K * stretch - CABLE_C * s.v
    if (s.y <= SHAFT_SNAP_Y) {
      s.cableIntact = false
      s.phase       = PHASE_FREEFALL
      brakeEngaged = 0
    }
  }
  else if (s.phase === PHASE_FREEFALL) {
    if (s.y <= SHAFT_BRAKE_Y)
      s.phase = PHASE_BRAKING
  }

  if (s.phase === PHASE_BRAKING) {
    brakeEngaged += dt

    // The impulse the shoes would have to supply to zero the velocity this
    // step, after every other force is accounted for. Friction can deliver up
    // to `f` of this and no more — and because it is signed by `needed` rather
    // than by velocity, it also holds the cage statically once stopped instead
    // of leaving a residual crawl.
    const needed = -CAGE_MASS * s.v / dt - force

    if (s.creeping) {
      // Held on the shoes and lowered under control: a velocity servo running
      // the cage down the last of the shaft at a fixed rate.
      const servo = CAGE_MASS * (-CREEP_SPEED - s.v) / dt - force
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
      s.phase      = PHASE_BUFFER
      s.settleTime = 0
    }
  }
  else
    s.spark *= Math.exp(-dt * 3.5)

  if (s.phase === PHASE_BUFFER) {
    const compress = SHAFT_FLOOR_Y - s.y
    if (compress > 0) {
      // Nonlinear hydraulic buffer: stiffens as it compresses, damps velocity.
      force += BUFFER_K * Math.pow(compress, BUFFER_POWER)
      if (s.v < 0)
        force -= BUFFER_C * s.v
    }
    if (Math.abs(s.v) < 0.12 && compress > -0.02)
      s.settleTime += dt
    if (s.settleTime > 2.4) {
      // The gate opens and you step out of the cage onto the folding path.
      s.phase      = PHASE_WALK
      s.settleTime = 0
    }
  }

  if (s.phase === PHASE_WALK) {
    // The cage is parked; the walker is on foot from here, so the vertical
    // solver is done and stepWalk() takes over.
    force = 0
    s.v   = 0
  }

  return force
}

/** Restart the cycle at the top of the shaft with a fresh scatter of debris. */
function resetCycle (s: FoundryState): void {
  s.y           = SHAFT_TOP
  s.v           = 0
  s.a           = 0
  s.phase       = PHASE_DESCENT
  s.cableIntact = true
  s.cableRest   = SHAFT_TOP
  s.settleTime  = 0
  s.creeping    = false
  s.walkZ       = 0
  s.walkV       = 0
  s.cubeBase    = 0
  brakeEngaged = 0
  for (let i = 0; i < PATH_CUBES; i++) {
    s.fold[i]      = 0
    s.foldOmega[i] = 0
  }

  const rand = mulberry32((Math.floor(performance.now()) ^ 0x9e3779b9) >>> 0)
  s.debris   = spawnDebris(rand, SHAFT_TOP)
}

/**
 * The walk: forward motion over an infinite fall, on a path that only exists
 * because the cubes ahead are unfolding into it.
 *
 * Each cube is a hinged mechanism, not an animation. Its six faces share one
 * fold coordinate integrated as a damped second-order hinge driven toward an
 * open or closed target — so the panels *overshoot and settle* when they slam
 * open, and the path visibly springs into place a moment before it is needed.
 */
function stepWalk (s: FoundryState, dt: number): void {
  if (s.phase !== PHASE_WALK)
    return

  // Gait: accelerate to walking pace and hold it.
  s.walkV += (WALK_SPEED - s.walkV) * Math.min(1, dt * 1.6)
  s.walkZ += s.walkV * dt

  // Slide the window of live cubes forward, recycling the one left behind.
  const wanted = Math.max(0, Math.floor(s.walkZ / CUBE_SPACING) - 2)
  while (s.cubeBase < wanted) {
    s.fold.shift()
    s.foldOmega.shift()
    s.fold.push(0)
    s.foldOmega.push(0)
    s.cubeBase++
  }

  for (let i = 0; i < PATH_CUBES; i++) {
    const cubeZ = (s.cubeBase + i) * CUBE_SPACING
    const ahead = cubeZ - s.walkZ
    // Unfold well before you arrive, refold once you are safely past.
    const target = ahead < UNFOLD_LEAD && ahead > -REFOLD_LAG ? 1 : 0
    const acc    = HINGE_K * (target - s.fold[i]) - HINGE_C * s.foldOmega[i]
    s.foldOmega[i] += acc * dt
    s.fold[i] += s.foldOmega[i] * dt
  }

  // The path runs out; the shaft claims you again and the cycle restarts.
  if (s.walkZ > WALK_LENGTH)
    resetCycle(s)
}

/**
 * Advance the six free bodies and resolve their contacts with the moving cage.
 * Returns the summed impact speed, which feeds the camera shake.
 */
function stepDebris (s: FoundryState, dt: number): number {
  // ---- debris: free bodies in world space, colliding with the moving cage ----
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
    impactSum += collideWithCage(b, s.y, s.v)

    // Angular drag so the tumble settles once bodies come to rest.
    const angDamp = Math.exp(-dt * 0.55)
    b.wx *= angDamp
    b.wy *= angDamp
    b.wz *= angDamp
    integrateQuat(b, dt)
  }

  return impactSum
}

/**
 * Bounding-sphere contacts between debris bodies. Returns the summed closing
 * speed so these impacts shake the camera too.
 */
function stepBodyContacts (s: FoundryState): number {
  let impactSum = 0
  // ---- body-body contacts ----
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

/** Flywheel and hook — two scalar ODEs, integrated alongside the bodies. */
function stepMechanisms (s: FoundryState, dt: number): void {
  // ---- flywheel driving the wall pistons ----
  // I·dω/dt = motor torque − load torque(θ) − viscous damping.
  const inertia = 46
  const load    = 120 + 90 * Math.sin(s.crank * 2)
  const motor   = 340
  s.crankOmega += (motor - load - 12 * s.crankOmega) / inertia * dt
  s.crank = (s.crank + s.crankOmega * dt) % (Math.PI * 2)

  // ---- hook: damped pendulum excited by the cage's own acceleration ----
  const hookLen = 1.35
  const hookAcc =
    -(G + s.a) / hookLen * Math.sin(s.hook) - 0.9 * s.hookOmega
  s.hookOmega += hookAcc * dt
  s.hook += s.hookOmega * dt
}

function step (s: FoundryState, dt: number): void {
  const prevV = s.v

  // Semi-implicit Euler: integrate velocity from the summed forces, then
  // position from the *new* velocity — stable under the stiff buffer spring in
  // a way that explicit Euler is not.
  const accel = cageForce(s, dt) / CAGE_MASS
  s.v += accel * dt
  s.y += s.v * dt
  s.a = (s.v - prevV) / dt

  // Bodies move after the cage, so their contacts see this step's cage state.
  const impactSum = stepDebris(s, dt) + stepBodyContacts(s)
  stepMechanisms(s, dt)
  stepWalk(s, dt)

  // ---- camera shake, derived from real jerk and real impacts ----
  const shakeMag = Math.min(1, Math.abs(s.a) / 55 + impactSum * 0.05 + s.spark * 0.25)
  s.shakeX       = shakeMag * Math.sin(s.y * 37.4 + s.crank * 5.1)
  s.shakeY       = shakeMag * Math.sin(s.y * 51.7 - s.crank * 3.3)
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

// perf: cheap. 6 rigid bodies + 1 cage + 2 scalar ODEs at 120 Hz is ~0.05 ms
// per frame on the main thread; allocation-free after construction (the only
// allocation is the debris respawn once per ~40 s cycle).
