// THE LOOP LINE — the ride.
//
// A driverless people-mover on a closed circuit. It is never driven and never
// braked to a stand: it eases toward whatever speed the bay it is in asks for,
// and the bays ask for different things — nine metres a second through the
// platform, twenty-two down the daylight. Speed is therefore an integral with no
// closed form, which is the case withJourneyShell's createSimulation exists for,
// and it is why ?t= has to *seek* this journey rather than jump it.
//
// ---------------------------------------------------------------------------
// One scalar
// ---------------------------------------------------------------------------
//
// Everything that goes wrong on this line is a function of `lapF` — the lap
// count, plus a fractional part that ramps smoothly across THE TURNBACK rather
// than stepping at the lap seam. THE TURNBACK is the right place for it because
// it has no walls, no ceiling and nothing in it but signal lamps, so a bay whose
// parameters are sliding is a bay with almost nothing on screen to slide.
//
// From that one number: how far the shards have come apart, how many lamps have
// failed, how far the colour has rotted, how badly the bogies chatter, how fast
// the train runs, and whether the point machine has thrown. Nothing keeps its
// own clock. That is deliberate — six subsystems each ageing on their own timer
// drift apart, and the moment they drift the ride stops reading as one place
// falling apart and starts reading as six effects.
//
// ---------------------------------------------------------------------------
// The handover
// ---------------------------------------------------------------------------
//
// The switch is not an effect. There are two real circuits (see stations.ts) and
// the train is riding exactly one of them at any instant. When the point machine
// throws, the simulation stops integrating along `main` and starts integrating
// along `alt`, and the only thing that has to be got right is that arc length is
// continuous across the change: the junction sits at a different distance-from-
// origin on each circuit, so the handover rebases `s` by the difference. Get it
// wrong by a metre and the train teleports a metre, which at twenty metres a
// second is a frame you will absolutely see.
//
// After the handover it never switches back. There is no mechanism to; the point
// machine has one throw in it.
//
// ---------------------------------------------------------------------------
// Banking, and why it is the camera this time
// ---------------------------------------------------------------------------
//
// switchback banks by rolling the *world*, because its camera is nailed to the
// origin and cannot rotate. This one has an ordinary camera in an ordinary world,
// so it banks the way a camera banks: the up vector rotates about the direction
// of travel. The bank angle itself is the same physics either way — lean until
// the resultant of gravity and the centripetal term is square to the floor — but
// only a fraction of it reaches the view, because a rider's head does not follow
// the car exactly and a shot in which it does looks like a flight simulator.

import type { JourneySimulation } from '@/components/withJourneyShell'
import type { CustomUniforms } from '@/lib/shaderQuad'
import type { BaySpan, Circuits } from './stations'
import { DECAY_BAY, SWITCH_LAP, getCircuits, spanAt } from './stations'
import type { Frame } from '@/lib/curve'
import type { JourneyMarks } from '@/lib/journeyTransport'


const G = 9.81

/** Eye height above rail, metres. A seated rider in a low-floor car. */
const CAM_H = 2.05

/** Time constant for easing toward a bay's target speed, seconds. */
const SPEED_TAU = 2.6

/** Hard clamp on the integration step. A backgrounded tab must not teleport. */
const MAX_STEP = 0.05

/** Bank is capped well short of vertical; this is a people-mover, not a coaster. */
const MAX_BANK = 0.42

/** How much of the car's bank reaches the camera. */
const HEAD_ROLL = 0.55

export function clamp01 (x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function smootherstep (edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// A cheap deterministic hash, used for the bogie chatter. Driven by distance
// travelled rather than by time, so the track feels like it has fixed joints in
// fixed places instead of a rattle that follows you.
function hash1 (n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

interface Pose {
  px: number;
  py: number;
  pz: number;
  fx: number;
  fy: number;
  fz: number;
  ux: number;
  uy: number;
  uz: number;
}

class LoopLineRide implements JourneySimulation {
  private readonly circuits: Circuits

  /** Arc length along whichever circuit is currently under the wheels. */
  private s = 0

  /** Total distance ever travelled — rail joints and audio ride on this. */
  private travelled = 0

  private speed = 4
  private lap = 0
  private onAlt = false

  /** Lagged lateral body sway, and its velocity. */
  private sway = 0
  private swayV = 0

  private roll = 0

  private lapF = 0

  /** Inside the ride, so a ?t= seek rebuilds it. See lib/signalLoss. */
  private signalAge = 0
  private shake = 0
  private frame: Frame | null = null
  private pose: Pose = {
    px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
  }

  private out: CustomUniforms = {}

  constructor () {
    this.circuits = getCircuits()
  }

  private get curve () {
    return this.onAlt ? this.circuits.alt : this.circuits.main
  }

  private get spans (): BaySpan[] {
    return this.onAlt ? this.circuits.altBays : this.circuits.mainBays
  }

  private span (): BaySpan {
    return spanAt(this.spans, this.s, this.curve.length)
  }

  step (dt: number): void {
    const h    = Math.min(dt, MAX_STEP)
    const span = this.span()

    // Drag falls away as the line ages, so the ride speeds up without anything
    // pushing it. Darker and faster together, which is switchback's trick and
    // is worth reusing because it is the honest way to make decay feel unsafe.
    const target = span.bay.speed * (1 + this.lapF * 0.065)
    this.speed  += (target - this.speed) * (1 - Math.exp(-h / SPEED_TAU))

    const before = this.s
    this.s        += this.speed * h
    this.travelled += this.speed * h

    if (this.s >= this.curve.length) {
      this.s -= this.curve.length
      this.lap++
    }

    if (this.lap >= SIGNAL_LOSS_LAP)
      this.signalAge += h

    this.throwSwitchIfDue(before)
    this.updateDecay()
    this.updatePose(h)
  }

  // The point machine. Fires at most once, on the first pass through the
  // junction at or after SWITCH_LAP, and rebases arc length onto the chord.
  private throwSwitchIfDue (before: number): void {
    if (this.onAlt || this.lap < SWITCH_LAP)
      return

    const j       = this.circuits.junctionS
    const crossed = before <= j && this.s > j
    // The lap wrap case: `before` was near the end of the loop and `s` restarted
    // before the junction, so the crossing has not happened yet this lap.
    if (!crossed)
      return

    this.onAlt = true
    this.s     = this.circuits.altJunctionS + (this.s - j)
  }

  private updateDecay (): void {
    const decay = this.spans[DECAY_BAY]
    this.lapF   = this.lap + smootherstep(decay.s0, decay.s1, this.s)
  }

  private updatePose (h: number): void {
    const curve = this.curve
    const f     = curve.frameAtDistance(this.s, this.frame ?? undefined)
    this.frame  = f

    const curv = curve.curvatureAtDistance(this.s)
    const bank = Math.max(-MAX_BANK, Math.min(MAX_BANK,
                                              Math.atan2(this.speed * this.speed * curv, G)))

    // Body sway: a damped spring driven by the lateral acceleration the car is
    // *not* banking away. Understeer you can feel rather than see.
    const lateral = this.speed * this.speed * curv - G * Math.sin(bank)
    this.swayV   += (lateral * 0.010 - this.sway * 7.0 - this.swayV * 2.6) * h
    this.sway    += this.swayV * h

    // Rail joints, at fixed places on the track, getting rougher as the line
    // wears. Hashed on distance so the same joint is in the same metre forever.
    const wear   = clamp01(this.lapF * 0.16)
    const joint  = this.travelled / 12.5
    const jitter = (hash1(Math.floor(joint)) - 0.5) * 2
    this.shake   = jitter * (0.012 + wear * 0.075) *
      (0.4 + Math.abs(Math.sin(joint * Math.PI)) * 0.6)

    this.roll += (bank * HEAD_ROLL - this.roll) * (1 - Math.exp(-h / 0.28))

    // Rotate the transported up vector about the direction of travel by the
    // head roll. Rodrigues, but the axis is already unit and already
    // perpendicular to `up`, so two of its three terms drop out.
    const c  = Math.cos(this.roll + this.shake * 0.6)
    const sn = Math.sin(this.roll + this.shake * 0.6)
    const rx = f.forward.y * f.up.z - f.forward.z * f.up.y
    const ry = f.forward.z * f.up.x - f.forward.x * f.up.z
    const rz = f.forward.x * f.up.y - f.forward.y * f.up.x

    const ux = f.up.x * c + rx * sn
    const uy = f.up.y * c + ry * sn
    const uz = f.up.z * c + rz * sn

    const p = this.pose
    p.px    = f.pos.x + ux * CAM_H + (rx * c - f.up.x * sn) * this.sway
    p.py    = f.pos.y + uy * CAM_H + (ry * c - f.up.y * sn) * this.sway
    p.pz    = f.pos.z + uz * CAM_H + (rz * c - f.up.z * sn) * this.sway
    p.fx    = f.forward.x
    p.fy    = f.forward.y + this.shake * 0.35
    p.fz    = f.forward.z
    p.ux    = ux
    p.uy    = uy
    p.uz    = uz
  }

  uniforms (): CustomUniforms {
    const p    = this.pose
    const bay  = this.span().bay
    const lapF = this.lapF

    this.out.uCamPos = [ p.px, p.py, p.pz ]
    this.out.uCamFwd = [ p.fx, p.fy, p.fz ]
    this.out.uCamUp  = [ p.ux, p.uy, p.uz ]
    this.out.uRide   = [ this.speed, lapF, this.shake, this.onAlt ? 1 : 0 ]

    // The four rupture channels. Every one of them is a pure function of lapF,
    // so a seek to any t reproduces them exactly.
    //
    // The rates matter more than the effects do. At three times these numbers
    // the line was unrecognisable rubble by the fourth lap — technically "more
    // ruptured", actually just over, because a room that has stopped being a
    // room cannot decay any further and there is nowhere for the fifth lap to
    // go. Slowed to this, lap two is a place with something wrong with it, lap
    // four is a place coming apart, and total collapse sits somewhere around lap
    // eight, which nobody will reach — and that is fine. What has to be true is
    // only that the next lap is always worse than this one.
    this.out.uDecay = [
      clamp01((lapF - 0.8) * 0.135), // fracture — shard displacement
      Math.min(0.85, lapF * 0.135), // lightFail — how many lamps are out
      Math.min(1, lapF * 0.105), // rot — desaturate and flatten
      clamp01(lapF * 0.16), // wear — chatter, overshoot, gaps
    ]
    this.out.uLoop = [ this.s, this.travelled, this.lap, bay.id ]

    return this.out
  }

  label (): string {
    const bay = this.span().bay
    const kmh = Math.round(this.speed * 3.6)
    return `LAP ${this.lap + 1} · ${bay.name} · ${kmh} KM/H`
  }

  /** One lap of the circuit; the bays are its sections. */
  marks (): JourneyMarks {
    return {
      loop:         this.lap,
      section:      this.span().bay.id,
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
 * one: by here its own decay has saturated and another lap says nothing new.
 * See lib/signalLoss.
 */
export const SIGNAL_LOSS_LAP = 5
