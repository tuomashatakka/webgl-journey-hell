// THE SCENIC ROUTE — the ride.
//
// A car bolted to a spline like a coaster car to its rail. The world makes it a
// road; this file makes it a *drive*: an integrator for the speed, a gearbox
// for the needle, and a pose that leans, heaves and looks into the turn the way
// a person does rather than the way a camera on a stick does.
//
// ---------------------------------------------------------------------------
// One scalar
// ---------------------------------------------------------------------------
//
// Everything that gets worse is a function of `lapF` — the lap count plus a
// smooth ramp across THE UNDERTOW, the section with no sky and the least on
// screen to slide. Bank gain, speed, drag, the sun, the dashboard warnings and
// (in the scene) how far the city bends all read that one number. Six things
// on six clocks drift apart; one thing on one clock reads as one place going
// wrong. This is loop-line's rule and it is not negotiable.
//
// ---------------------------------------------------------------------------
// Why the speed is an integral
// ---------------------------------------------------------------------------
//
// The driver eases toward a target, gravity acts along the tangent by a
// section-authored weight, drag is quadratic — and every one of those
// parameters is a smooth function of arc length (route.ts's partition of
// unity), so there is no s at which the acceleration jumps. There is therefore
// also no closed form for "where am I at t = 90", which is what makes this a
// simulation the shell has to *seek* with a fixed timestep rather than a curve
// it can evaluate. See lib/debugParams.
//
// ---------------------------------------------------------------------------
// The pose
// ---------------------------------------------------------------------------
//
// The car's frame is the level frame at s rolled by the authored bank; that is
// also exactly how the asphalt was swept (lib/sweep + the bank LUT in the vertex
// shader), so the car sits on the road by construction. The camera is then a
// person in that car: their head rolls a fraction *against* the lateral load the
// bank is not cancelling, their body sways with it on a damped spring, they
// lift off the seat over a crest, and they look through the corner rather than
// down the bonnet. In the cave the car floats, and the same pose picks up the
// water's heave, roll and a slow yaw drift on the eddies.

import type { JourneySimulation } from '@/components/withJourneyShell'
import type { CustomUniforms } from '@/lib/shaderQuad'
import type { JourneyMarks } from '@/lib/journeyTransport'
import type { Frame } from '@/lib/curve'
import { levelFrame, newFrame } from '@/lib/sweep'
import {
  DECAY_SECTION,
  SECTION_COUNT,
  bankAt,
  getRoute,
  lookAt,
  sectionWeights,
  signedCurvature,
  spanAt,
  speedParamsAt,
  sunDirection,
  sunElevationAt

} from './course'
import type { LookParams, Route, SpeedParams } from './course'


/**
 * Three laps, then the signal. Once the lap counter reads this the fourth lap
 * begins on the county road at night and the picture starts to go eight
 * seconds in — counted here, inside step(), never by the shell, because a
 * ?t= seek replays this simulation from zero without anyone watching.
 */
export const SIGNAL_LOSS_LAP = 3

const G = 9.81

/** Eye height above the road surface. A low seat in a low car. */
export const CAM_H = 1.3

/** Hard clamp on the integration step. A backgrounded tab must not teleport. */
const MAX_STEP = 0.05

const V_MIN = 0.4

/** How much of the physics lean reaches the head. */
const HEAD_ROLL = 0.35

/** Look-through: radians of yaw per (curvature × speed). */
const LOOK_AHEAD = 1.1
const LOOK_MAX   = 0.42

// --- the gearbox ------------------------------------------------------------
const GEAR_RATIOS = [ 3.6, 2.1, 1.4, 1.0, 0.8, 0.65 ]
const FINAL_DRIVE = 3.9
const WHEEL_R     = 0.32
const RPM_IDLE    = 850
const RPM_UP      = 6200
const RPM_DOWN    = 2300
const RPM_MAX     = 7800
const CLUTCH_TAU  = 0.18

export function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function smootherstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Deterministic hash, for fixed bumps in fixed places. */
function hash1 (n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

/** Rotate v about unit axis k by angle a (Rodrigues), into out. */
function rotate (
  vx: number, vy: number, vz: number,
  kx: number, ky: number, kz: number, a: number,
  out: [ number, number, number ],
): void {
  const c  = Math.cos(a)
  const sn = Math.sin(a)
  const d  = kx * vx + ky * vy + kz * vz
  const cx = ky * vz - kz * vy
  const cy = kz * vx - kx * vz
  const cz = kx * vy - ky * vx
  out[0]   = vx * c + cx * sn + kx * d * (1 - c)
  out[1]   = vy * c + cy * sn + ky * d * (1 - c)
  out[2]   = vz * c + cz * sn + kz * d * (1 - c)
}

export class ScenicRide implements JourneySimulation {
  private readonly route: Route

  /** Arc length along the loop, metres. */
  private s = 0

  /** Total distance ever travelled — bumps and audio ride on this. */
  private travelled = 0

  private v = 6
  private lap = 0
  private lapF = 0
  private time = 0

  /** Inside the ride, so a ?t= seek rebuilds it. See lib/signalLoss. */
  private signalAge = 0

  // Springs.
  private sway = 0
  private swayV = 0
  private heave = 0
  private heaveV = 0
  private headRoll = 0
  private lookYaw = 0
  private steer = 0

  // Gearbox.
  private gear = 0
  private rpm = RPM_IDLE
  private rpmDisp = RPM_IDLE

  private readonly frame: Frame = newFrame()
  private readonly w = new Float32Array(SECTION_COUNT)
  private readonly speed: SpeedParams = { vTarget: 0, tau: 1, throttle: 0, gW: 0, cD: 0 }
  private readonly look: LookParams = {
    exposure: 0, sky: 1, fog: [ 0, 0, 0 ], fogDensity: 0, roadHalf: 3, surface: 0,
  }

  // The car frame and the camera, as flat arrays the uniforms can hand over.
  private readonly carPos = [ 0, 0, 0 ]
  private readonly carFwd = [ 0, 0, 1 ]
  private readonly carUp = [ 0, 1, 0 ]
  private readonly carRight = [ 1, 0, 0 ]
  private readonly camPos = [ 0, 0, 0 ]
  private readonly camFwd = [ 0, 0, 1 ]
  private readonly camUp = [ 0, 1, 0 ]
  private readonly tmp: [ number, number, number ] = [ 0, 0, 0 ]
  private readonly sun: [ number, number, number ] = [ 0, 1, 0 ]

  private bank = 0
  private curv = 0
  private grade = 0
  private floatW = 0
  private floatH = 0
  private floatYaw = 0

  private readonly out: CustomUniforms = {}

  constructor () {
    this.route = getRoute()
    this.updatePose(0)
  }

  step (dt: number, time: number): void {
    const h   = Math.min(dt, MAX_STEP)
    this.time = time

    const route = this.route
    const p     = speedParamsAt(route, this.s, this.lapF, this.w, this.speed)

    // Grade from the tangent — the curve is C¹, so this is continuous.
    levelFrame(route.curve, this.s, this.frame)
    this.grade = Math.asin(Math.max(-1, Math.min(1, this.frame.forward.y)))

    // The driver, gravity, drag. In the cave the current is the driver: a
    // buoyant car eases to the water's speed and gravity along the tangent is
    // weighted out, because the water is doing the falling for it.
    const surge = 1 + 0.12 * Math.sin(this.s * 0.021 + 1.3) * this.floatW
    let a       = p.throttle * (p.vTarget * surge - this.v) / p.tau
    a          -= p.gW * G * Math.sin(this.grade)
    a          -= p.cD * this.v * this.v
    this.v      = Math.max(V_MIN, this.v + a * h)

    this.s         += this.v * h
    this.travelled += this.v * h
    if (this.s >= route.length) {
      this.s -= route.length
      this.lap++
    }

    if (this.lap >= SIGNAL_LOSS_LAP)
      this.signalAge += h

    // lapF ramps across the decay section rather than stepping at the seam.
    const decay = route.spans[DECAY_SECTION]
    this.lapF   = this.lap + smootherstep(decay.s0, decay.s1, this.s)

    this.updateGearbox(h)
    this.updatePose(h)
  }

  private updateGearbox (h: number): void {
    const look   = this.look
    const flying = look.surface > 1.5 && look.surface < 2.5 && this.floatW < 0.5
    const wet    = this.floatW > 0.55

    let target: number
    if (wet)
      // Stalled. It restarts on the culvert ramp as floatW falls away.
      target = 0
    else if (flying)
      // Wheels off the ground, foot still down: the engine runs away.
      target = RPM_MAX
    else {
      const wheelRpm = this.v / (2 * Math.PI * WHEEL_R) * 60
      let rpm        = wheelRpm * FINAL_DRIVE * GEAR_RATIOS[this.gear]
      if (rpm > RPM_UP && this.gear < GEAR_RATIOS.length - 1) {
        this.gear++
        rpm = wheelRpm * FINAL_DRIVE * GEAR_RATIOS[this.gear]
      }
      else if (rpm < RPM_DOWN && this.gear > 0) {
        this.gear--
        rpm = wheelRpm * FINAL_DRIVE * GEAR_RATIOS[this.gear]
      }
      target = Math.max(RPM_IDLE, Math.min(RPM_MAX, rpm))
    }
    this.rpm      = target
    // The needle lags the engine through the clutch.
    this.rpmDisp += (target - this.rpmDisp) * (1 - Math.exp(-h / CLUTCH_TAU))
  }

  private updatePose (h: number): void {
    const route = this.route
    const curve = route.curve
    const f     = this.frame
    const s     = this.s

    lookAt(route, s, this.w, this.look)
    // The undertow's weight is the float weight: it rises over the last 30 m of
    // the throat and falls away over the culvert, like everything else here.
    sectionWeights(route, s, this.w)
    this.floatW = this.w[DECAY_SECTION]

    // Signed curvature and its vertical twin, from the tangent's rate of turn.
    this.curv = signedCurvature(curve, s, 1.0)

    const fa = curve.frameAtDistance(s - 1)
    const fb = curve.frameAtDistance(s + 1)
    const kv = ((fb.forward.x - fa.forward.x) * f.up.x +
      (fb.forward.y - fa.forward.y) * f.up.y +
      (fb.forward.z - fa.forward.z) * f.up.z) / 2

    // The water: heave and roll from a small wave field on (s, t), and a slow
    // yaw drift on the eddies. Weighted in by floatW so the car settles into
    // the current rather than snapping onto it.
    const t     = this.time
    const fw    = this.floatW
    this.floatH = fw * (0.16 * Math.sin(s * 0.35 - t * 1.6) + 0.08 * Math.sin(s * 0.83 + t * 2.3 + 1.7))

    const floatRoll = fw * 0.11 * Math.sin(s * 0.27 + t * 1.1)
    this.floatYaw   = fw * 0.34 * Math.sin(s * 0.011 + 2.1)

    // The car frame: level frame rolled by the authored bank (+ the water).
    this.bank = bankAt(route, s, this.lapF) + floatRoll

    const c  = Math.cos(this.bank)
    const sn = Math.sin(this.bank)
    const fx = f.forward.x
    const fy = f.forward.y
    const fz = f.forward.z
    // Positive bank rolls the right side down: up leans toward right.
    const rx = f.right.x * c - f.up.x * sn
    const ry = f.right.y * c - f.up.y * sn
    const rz = f.right.z * c - f.up.z * sn
    const ux = f.up.x * c + f.right.x * sn
    const uy = f.up.y * c + f.right.y * sn
    const uz = f.up.z * c + f.right.z * sn

    // What the rider feels: gravity along the car's right minus the centripetal
    // term, and along the car's up plus the vertical curvature term.
    const v2   = this.v * this.v
    const aLat = G * -ry - v2 * this.curv
    const nUp  = G * uy + v2 * kv

    if (h > 0) {
      // Body sway: a damped spring toward the felt lateral load.
      this.swayV += (aLat * 0.012 - this.sway * 9.0 - this.swayV * 3.2) * h
      this.sway  += this.swayV * h

      // Heave: airtime lifts the head off the seat; a compression pushes it down.
      const heaveT = -(nUp / G - 1) * 0.055
      this.heaveV += ((heaveT - this.heave) * 60.0 - this.heaveV * 9.0) * h
      this.heave  += this.heaveV * h

      // Head roll against the load, eased.
      const rollT   = -HEAD_ROLL * Math.atan2(aLat, G)
      this.headRoll += (rollT - this.headRoll) * (1 - Math.exp(-h / 0.28))

      // Looking through the corner, eased.
      const lookT   = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, LOOK_AHEAD * this.curv * this.v))
      this.lookYaw += (lookT - this.lookYaw) * (1 - Math.exp(-h / 0.35))

      // The wheel.
      const steerT = Math.max(-1, Math.min(1, this.curv * 14))
      this.steer  += (steerT - this.steer) * (1 - Math.exp(-h / 0.15))
    }

    // Suspension: fixed bumps in fixed places, by surface and by lap.
    const surf   = this.look.surface
    const onRoad = 1 - smootherstep(1.5, 2.2, surf) + smootherstep(3.2, 3.8, surf) * 0.6
    const bumpA  = (0.006 + (surf > 0.5 && surf < 1.5 ? 0.008 : 0)) * onRoad * (1 - fw) * (1 + this.lapF * 0.6)
    const joint  = this.travelled / 2.7
    const bump   = (hash1(Math.floor(joint)) - 0.5) * 2 * bumpA * (0.4 + Math.abs(Math.sin(joint * Math.PI)) * 0.6)

    const car        = this.carPos
    car[0]           = f.pos.x
    car[1]           = f.pos.y
    car[2]           = f.pos.z
    this.carFwd[0]   = fx
    this.carFwd[1]   = fy
    this.carFwd[2]   = fz
    this.carUp[0]    = ux
    this.carUp[1]    = uy
    this.carUp[2]    = uz
    this.carRight[0] = rx
    this.carRight[1] = ry
    this.carRight[2] = rz

    // The camera: head roll about the tangent, then the eye offset, then yaw.
    const tmp = this.tmp
    rotate(ux, uy, uz, fx, fy, fz, this.headRoll, tmp)

    const cux = tmp[0]
    const cuy = tmp[1]
    const cuz = tmp[2]

    const lift     = CAM_H + this.heave + this.floatH + bump
    const side     = this.sway * 0.06
    this.camPos[0] = car[0] + ux * lift + rx * side
    this.camPos[1] = car[1] + uy * lift + ry * side
    this.camPos[2] = car[2] + uz * lift + rz * side

    rotate(fx, fy + bump * 2.5, fz, cux, cuy, cuz, this.lookYaw + this.floatYaw, tmp)

    const fl       = Math.hypot(tmp[0], tmp[1], tmp[2]) || 1
    this.camFwd[0] = tmp[0] / fl
    this.camFwd[1] = tmp[1] / fl
    this.camFwd[2] = tmp[2] / fl
    this.camUp[0]  = cux
    this.camUp[1]  = cuy
    this.camUp[2]  = cuz
  }

  uniforms (): CustomUniforms {
    const o    = this.out
    const look = this.look
    const span = spanAt(this.route, this.s)

    o.uCamPos   = this.camPos
    o.uCamFwd   = this.camFwd
    o.uCamUp    = this.camUp
    o.uCarPos   = this.carPos
    o.uCarFwd   = this.carFwd
    o.uCarUp    = this.carUp
    o.uCarRight = this.carRight
    o.uRide     = [ this.v, this.lapF, this.bank, span.section.id ]
    o.uLoop     = [ this.s, this.travelled, this.lap, (this.s - span.s0) / (span.s1 - span.s0) ]

    // Headlights come on with the dusk and in the dark.
    const sunEl  = sunElevationAt(this.lapF)
    const lights = Math.max(1 - look.sky, smootherstep(7 * Math.PI / 180, 2 * Math.PI / 180, sunEl))
    o.uCar       = [ this.rpmDisp / RPM_MAX, this.gear + 1, this.steer, lights ]
    o.uSignal    = [ this.signalAge, this.lap ]

    sunDirection(this.lapF, this.sun)
    o.uSun = [ this.sun[0], this.sun[1], this.sun[2], sunEl ]

    // Exposure adapts to the dusk as well as to the room.
    const water = -40 - 15 * (this.s - this.route.spans[DECAY_SECTION].s0) /
      (this.route.spans[DECAY_SECTION].s1 - this.route.spans[DECAY_SECTION].s0) + 0.45 * this.lapF
    o.uEnv    = [ look.exposure + this.lapF * 0.55, look.sky, look.fogDensity, water ]
    o.uFogCol = [ look.fog[0], look.fog[1], look.fog[2], look.surface ]
    o.uFloat  = [ this.floatW, this.floatH, this.floatYaw, look.roadHalf ]

    return o
  }

  label (): string {
    const span = spanAt(this.route, this.s)
    const kmh  = Math.round(this.v * 3.6)
    return `LAP ${this.lap + 1} · ${span.section.name} · ${kmh} KM/H`
  }

  /** One lap of the loop; the seven sections are its sections. */
  marks (): JourneyMarks {
    const span = spanAt(this.route, this.s)
    return {
      loop:         this.lap,
      section:      span.section.id,
      sectionCount: SECTION_COUNT,
      progress:     this.s / this.route.length,
      signalAge:    this.signalAge,
    }
  }

  // --- read-only state for the tests ----------------------------------------
  get state () {
    return {
      s:         this.s,
      v:         this.v,
      lap:       this.lap,
      lapF:      this.lapF,
      bank:      this.bank,
      grade:     this.grade,
      gear:      this.gear,
      rpm:       this.rpmDisp,
      floatW:    this.floatW,
      signalAge: this.signalAge,
    }
  }
}

export function createScenicRouteSimulation (): JourneySimulation {
  return new ScenicRide()
}
