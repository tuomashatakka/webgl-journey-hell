import { G, LANDING_Y, LIFT_TOP, MODE_FALL, MODE_OBLIVION, MODE_SETTLE } from './common'
import { DebrisBody, FoundryState } from './types'

// gravity
const DEBRIS_COUNT = 6

/** Shaft head, and the height the cage is at when the cable lets go. */
const SHAFT_HEAD_Y = 128

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

/** Hydraulic buffers in the pit, for the arrivals the shoes do not catch. */
export const PIT_Y = -3

const CAGE_HALF   = 1.5

// cage interior half-width
const CAGE_HEIGHT = 2.6

/** The emergency shoes are on the rails. */
export const MODE_BRAKE = 1

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
const OBLIVION_HOLD = 1

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

const CAGE_MASS       = 900

// kg, cage + occupant + offcuts
const CAGE_DRAG       = 1.15

// ½ρCdA, quadratic drag coefficient
const CREEP_SPEED     = 8

// m/s, governed lowering rate once the shoes hold
const CREEP_MAX_FORCE = 90000

// N ceiling on the lowering servo
const BUFFER_K        = 260000

// N/m, hydraulic buffer stiffness
const BUFFER_C        = 34000

// N·s/m
const BUFFER_POWER    = 1.6

export function spawnDebris (rand: () => number, cageY: number): DebrisBody[] {
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
function brakeForce (speed: number, engaged: number): number {
  // Wedge seating: normal force climbs over ~0.35 s to full clamp.
  const seat   = Math.min(1, engaged / 0.35)
  const normal = 68000 * seat
  // Sliding friction falls off with speed (Stribeck-ish), so the cage grabs
  // harder as it slows — this is what produces the final juddering stop.
  const mu = 0.52 + 0.3 / (1 + speed * 0.22)
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
    const seat = Math.min(1, s.brakeEngaged / 0.3)
    const grip = Math.max(0, 1 - s.brakeEngaged / OBLIVION_GRIP)
    // Never all the way to nothing between grabs: the shoes stay in contact and
    // shriek the whole way down, they just stop being able to hold.
    const grab = 0.3 + 0.7 * Math.max(0, Math.sin(s.brakeEngaged * OBLIVION_CHATTER)) ** 2
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
    const target = -Math.min(CREEP_SPEED, Math.max(0, s.y - LANDING_Y) * 4)
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
  if (s.creeping && s.y <= LANDING_Y + 0.05 && speed < 0.3) {
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
export function stepCage (s: FoundryState, dt: number): number {
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
