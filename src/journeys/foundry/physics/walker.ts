import { smoothstep } from '@wjh/math/scalar'
import { FoundryState } from './types'
import { EYE_HEIGHT, G, LANDING_Y, MODE_WALK } from './constants'
import { LAP_ARC, RoutePoint, SPAN_TILES, TILE_HALF, cycDelta, cyclic, decayFor, routeAt, tileArc, tileX, tileZ } from './route'

// Metres of travel per footstep. CYCLE_LEN is a whole number of these, so the
// stride phase is continuous across the wrap.
const STEP_LEN = 0.875

const WALK_SPEED = 2.4

// m/s, a brisk walk
const LEG_K      = 210

// leg-spring stiffness (per unit mass)
const LEG_C      = 9

// leg-spring damping — low enough that the head rings
const SWAY_K     = 74

// lateral sway stiffness, tuned to one stride period
const SWAY_C     = 4

const HEEL_KICK  = 0.55

// m/s of head drop injected by each heel strike
const SWAY_KICK  = 0.3

const UNFOLD_LEAD = 14

// metres of warning before you reach a tile
const REFOLD_LAG  = 5

// metres behind you before it folds away again
const HINGE_K     = 46

// hinge stiffness — higher snaps the plate over
const HINGE_C     = 7.5

// hinge damping — lower leaves it ringing
const HINGE_KICK  = 0.42

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

// --- deterministic RNG ------------------------------------------------------
/** Cheap scalar hash, used to vary one footfall from the next. */
function hash11 (x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453123
  return s - Math.floor(s)
}

/** Flywheel and the two pendulums — three scalar ODEs. */
export function stepMechanisms (s: FoundryState, dt: number): void {
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
    -(G + s.tremorV * 12) / chainLen * Math.sin(s.chain) - 0.42 * s.chainOmega
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
export function stepSpan (s: FoundryState, dt: number): void {
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
export function stepRide (s: FoundryState, impactSum: number): void {
  const shakeMag = Math.min(
    1,
    Math.abs(s.cageA) / 26 + impactSum * 0.05 + s.spark * 0.3,
  )
  s.shakeX = shakeMag * Math.sin(s.y * 37.4 + s.crank * 5.1)
  s.shakeY = shakeMag * Math.sin(s.y * 51.7 - s.crank * 3.3)

  s.eyeY = s.y + EYE_HEIGHT + s.tremor * 0.5 + s.shakeY * 0.045
  s.sway = s.shakeX * 0.035
  s.yaw  = s.shakeX * 0.012
  s.roll = s.shakeX * 0.03

  // A hoist shaft is a closed box, so the speed is legible in one place only:
  // the wall streaming up past the gate. The gaze is pinned to it — dropping as
  // the fall builds, lifting back to level as the shoes take the speed out,
  // which leaves you looking into the hall exactly as the gate starts to move.
  const fast = smoothstep(2, 26, Math.abs(s.cageV))

  s.pitch = -0.2 - 0.42 * fast + s.cageA * 0.0035
}

export function stepWalker (s: FoundryState, dt: number): void {
  // Stepping out of the cage accelerates you to a pace; stepping back into it
  // at the end of the lap brings you to a stand inside it.
  const target = s.mode === MODE_WALK ? WALK_SPEED : 0
  s.v += (target - s.v) * Math.min(1, dt * (target > 0 ? 1.4 : 4))
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
    s.bobV -= HEEL_KICK * (0.85 + 0.3 * hash11(n) + decay * 0.55 * hash11(n * 3.7))
    s.swayV += SWAY_KICK * s.foot * (0.9 + 0.2 * hash11(n * 1.7))

    const tile = tileUnderfoot(s)
    if (tile >= 0)
      s.foldOmega[tile] -= HINGE_KICK
  }

  // ---- leg spring and sway spring ----
  const tile   = tileUnderfoot(s)
  // Standing on the span you ride the plate: its hinge ring is your ground.
  const ground = tile >= 0 ? (s.fold[tile] - 1) * 0.1 : 0

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
  s.pitch = -0.05 + s.bobV * 0.022 - s.tremorV * 0.01 - Math.abs(s.head) * 0.3
  // ...and lean into them, a little, the way anyone does.
  s.roll  = -s.sway * 0.5 + s.tremor * 0.4 - s.head * 0.1

  const jolt = Math.min(1, Math.abs(s.tremorV) * 0.45)
  s.shakeX   = jolt * Math.sin(s.dist * 41.3 + s.crank * 5.1)
  s.shakeY   = jolt * Math.sin(s.dist * 57.7 - s.crank * 3.3)
}
