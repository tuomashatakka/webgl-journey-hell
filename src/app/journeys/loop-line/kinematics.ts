// THE LOOP LINE — the ride.
//
// A driverless people-mover on a closed circuit. It is never driven and never
// braked to a stand: it eases toward whatever speed the bay it is in asks for —
// nine metres a second along the platform, twenty-one down the daylight — so
// position is an integral with no closed form, and ?t= has to *seek* it.
//
// ---------------------------------------------------------------------------
// One scalar
// ---------------------------------------------------------------------------
//
// Everything that goes wrong is a function of `lapF`: the lap count plus a
// fractional part ramped across THE TURNBACK, where there is nothing on screen
// for a sliding parameter to slide. Shard displacement, dead lamps, rot,
// chatter, speed, the flood, the city's windows, whether the points have
// thrown — one number. Six subsystems on six clocks drift apart, and the
// moment they drift the ride stops reading as one place falling apart.
//
// ---------------------------------------------------------------------------
// The handover
// ---------------------------------------------------------------------------
//
// Two real circuits (stations.ts); the train rides exactly one. When the point
// machine throws, integration moves from MAIN to ALT at the points, where arc
// length is the same on both by construction — no rebase can be wrong by a
// metre because there is no rebase. It never switches back.
//
// ---------------------------------------------------------------------------
// Where the rider looks
// ---------------------------------------------------------------------------
//
// The car banks by the physics (lean until gravity and the centripetal term
// resolve square to the floor) and a fraction of that reaches the head. The
// head also leads into a curve, looking a little toward where the track will
// be rather than straight along where it is — which is what anybody sitting at
// the front of a driverless train actually does, and what makes a bend read as
// a bend instead of the world sliding sideways.

import type { JourneyMarks, JourneySimulation } from '✦/lib/journey'
import { lapLabel } from '✦/lib/journey'
import type { CustomUniforms } from '✦/lib/gl'
import type { Frame } from '✦/lib/curve'
import type { BaySpan, Circuits } from './stations'
import { DECAY_BAY, SWITCH_LAP, getCircuits, spanIndexAt } from './stations'
import { clamp01, hash1, smootherstep } from '✦/lib/math'


const G = 9.81

/** Eye height above rail, metres: seated, at the front, in a low-floor car. */
const CAM_H = 2.05

/** Time constant for easing toward a bay's target speed, seconds. */
const SPEED_TAU = 2.6

/** Hard clamp on the integration step. A backgrounded tab must not teleport. */
const MAX_STEP = 0.05

/** Bank is capped well short of vertical; this is a people-mover, not a coaster. */
const MAX_BANK = 0.42

/** How much of the car's bank reaches the camera. */
const HEAD_ROLL = 0.55

/** How far ahead the head looks into a curve, metres, and how much it leans to it. */
const LEAD     = 26
const LEAD_MIX = 0.38

/** The rupture channels, from lapF alone. Shared with the scene and the audio. */
export function decayOf (lapF: number): [ number, number, number, number ] {
  // The rates matter more than the effects. At three times these the line was
  // rubble by lap four, and a room that has stopped being a room cannot decay
  // any further. As set, lap two is a place with something wrong with it, lap
  // four is coming apart, and the next lap is always worse than this one.
  return [
    clamp01((lapF - 0.8) * 0.135), // fracture
    Math.min(0.85, lapF * 0.135), // lightFail
    Math.min(1, lapF * 0.105), // rot
    clamp01(lapF * 0.16), // wear
  ]
}

class LoopLineRide implements JourneySimulation {
  private readonly circuits: Circuits

  /** Arc length along whichever circuit is under the wheels. */
  private s = 0

  /** Total distance ever travelled — joints and audio ride on this. */
  private travelled = 0

  private speed = 4
  private lap = 0
  private onAlt = false
  private sway = 0
  private swayV = 0
  private roll = 0
  private lapF = 0
  private shake = 0

  /** Counted inside the ride so a ?t= seek rebuilds it. See lib/signalLoss. */
  private signalAge = 0

  private frame:        Frame | null = null
  private ahead:        Frame | null = null
  private readonly out: CustomUniforms = {}

  private readonly cam = new Float32Array(9)
  private readonly train = new Float32Array(6)

  constructor () {
    this.circuits = getCircuits()
  }

  private get curve () {
    return this.onAlt ? this.circuits.alt : this.circuits.main
  }

  private get spans (): BaySpan[] {
    return this.onAlt ? this.circuits.altBays : this.circuits.mainBays
  }

  private spanIndex (): number {
    return spanIndexAt(this.spans, this.s, this.curve.length)
  }

  step (dt: number): void {
    const h    = Math.min(dt, MAX_STEP)
    const span = this.spans[this.spanIndex()]

    // Drag falls away as the line ages: darker and faster together.
    const target = span.bay.speed * (1 + this.lapF * 0.065)
    this.speed  += (target - this.speed) * (1 - Math.exp(-h / SPEED_TAU))

    const before = this.s
    this.s         += this.speed * h
    this.travelled += this.speed * h

    if (this.s >= this.curve.length) {
      this.s -= this.curve.length
      this.lap++
    }

    if (this.lap >= SIGNAL_LOSS_LAP)
      this.signalAge += h

    this.throwPointsIfDue(before)

    const decay = this.spans.find(sp => sp.bay.id === DECAY_BAY)!
    this.lapF   = this.lap + smootherstep(decay.s0, decay.s1, this.s)
    this.updatePose(h)
  }

  // The point machine: once, on the first pass through the points at or after
  // SWITCH_LAP. Arc length is shared up to the points, so `s` carries over.
  private throwPointsIfDue (before: number): void {
    if (this.onAlt || this.lap < SWITCH_LAP)
      return

    const j = this.circuits.junctionS
    if (before <= j && this.s > j)
      this.onAlt = true
  }

  private updatePose (h: number): void {
    const curve = this.curve
    const f     = curve.frameAtDistance(this.s, this.frame ?? undefined)
    this.frame  = f

    const a    = curve.frameAtDistance(this.s + LEAD, this.ahead ?? undefined)
    this.ahead = a

    const curv = curve.curvatureAtDistance(this.s)
    const bank = Math.max(-MAX_BANK, Math.min(MAX_BANK, Math.atan2(this.speed * this.speed * curv, G)))

    // Body sway: a damped spring driven by the lateral acceleration the car is
    // not banking away.
    const lateral = this.speed * this.speed * curv - G * Math.sin(bank)
    this.swayV   += (lateral * 0.010 - this.sway * 7.0 - this.swayV * 2.6) * h
    this.sway    += this.swayV * h

    const wear  = clamp01(this.lapF * 0.16)
    const joint = this.travelled / 12.5
    // Rail joints at fixed places: hashed on distance, so the same joint is
    // in the same metre forever.
    const jitter = (hash1(Math.floor(joint)) - 0.5) * 2
    this.shake   = jitter * (0.010 + wear * 0.07) * (0.4 + Math.abs(Math.sin(joint * Math.PI)) * 0.6)

    this.roll += (bank * HEAD_ROLL - this.roll) * (1 - Math.exp(-h / 0.28))

    // Head roll about the direction of travel (Rodrigues; the axis is unit and
    // already square to up, so two terms drop out).
    const c  = Math.cos(this.roll + this.shake * 0.6)
    const sn = Math.sin(this.roll + this.shake * 0.6)
    const rx = f.right.x,
      ry     = f.right.y,
      rz     = f.right.z
    const ux = f.up.x * c + rx * sn
    const uy = f.up.y * c + ry * sn
    const uz = f.up.z * c + rz * sn

    // Look a little into the curve.
    const ex = f.pos.x + ux * CAM_H,
      ey     = f.pos.y + uy * CAM_H,
      ez     = f.pos.z + uz * CAM_H
    let lx = a.pos.x + a.up.x * (CAM_H - 0.3) - ex
    let ly = a.pos.y + a.up.y * (CAM_H - 0.3) - ey
    let lz = a.pos.z + a.up.z * (CAM_H - 0.3) - ez
    const ll = Math.hypot(lx, ly, lz) || 1
    lx /= ll
    ly /= ll
    lz /= ll

    let fx = f.forward.x + (lx - f.forward.x) * LEAD_MIX
    let fy = f.forward.y + (ly - f.forward.y) * LEAD_MIX + this.shake * 0.3
    let fz = f.forward.z + (lz - f.forward.z) * LEAD_MIX
    const fl = Math.hypot(fx, fy, fz) || 1
    fx /= fl
    fy /= fl
    fz /= fl

    const cam = this.cam
    cam[0]    = ex + rx * this.sway
    cam[1]    = ey + ry * this.sway
    cam[2]    = ez + rz * this.sway
    cam[3]    = fx
    cam[4]    = fy
    cam[5]    = fz
    cam[6]    = ux
    cam[7]    = uy
    cam[8]    = uz

    // The car itself — for the cab and the headlight, which do not turn their
    // heads.
    const t = this.train
    t[0]    = f.forward.x
    t[1]    = f.forward.y
    t[2]    = f.forward.z
    t[3]    = ux
    t[4]    = uy
    t[5]    = uz
  }

  uniforms (): CustomUniforms {
    const span = this.spans[this.spanIndex()]
    const cam  = this.cam

    this.out.uCamPos   = [ cam[0], cam[1], cam[2] ]
    this.out.uCamFwd   = [ cam[3], cam[4], cam[5] ]
    this.out.uCamUp    = [ cam[6], cam[7], cam[8] ]
    this.out.uTrainFwd = [ this.train[0], this.train[1], this.train[2] ]
    this.out.uTrainUp  = [ this.train[3], this.train[4], this.train[5] ]
    this.out.uRide     = [ this.speed, this.lapF, this.shake, this.onAlt ? 1 : 0 ]
    this.out.uDecay    = decayOf(this.lapF)
    // uLoop[3] is the audio engine's room, which is a sound, not a bay id: two
    // tunnels may sound alike without being the same place.
    this.out.uLoop = [ this.s, this.travelled, this.lap, span.bay.sound ]
    this.out.uBay  = [ span.bay.id, this.spanIndex(), 0, 0 ]
    return this.out
  }

  label (): string {
    return lapLabel(this.lap, this.spans[this.spanIndex()].bay.name)
  }

  detail (): string {
    return `${Math.round(this.speed * 3.6)} KM/H`
  }

  marks (): JourneyMarks {
    const i = this.spanIndex()
    return {
      loop:         this.lap,
      section:      i,
      sectionCount: this.spans.length,
      progress:     this.s / this.curve.length,
      signalAge:    this.signalAge,
    }
  }
}

export function createLoopLineSimulation (): JourneySimulation {
  return new LoopLineRide()
}

/**
 * The lap at which the route has stopped going anywhere and the signal starts to
 * go with it. This journey has no ending to reach, so the count stands in for
 * one. See lib/signalLoss.
 */
export const SIGNAL_LOSS_LAP = 5
