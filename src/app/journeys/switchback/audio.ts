'use client'

// THE SWITCHBACK — soundtrack.
//
// Built lazily on the first unmute by withShaderJourney, which then calls
// `update` once per rendered frame with the very uniforms the shader is being
// drawn with — so the mix and the picture are on one clock and cannot drift.
//
// Three things carry this piece:
//
// 1. THE JOINTS. A railway does not make a continuous noise, it makes a
//    *rhythm*, and the rhythm is the speedometer. Every rail joint under the
//    wheels is two impacts a fraction of a second apart (front axle, then rear),
//    and the rate of them is speed divided by rail length. Nothing else in the
//    mix tells you how fast you are going, and nothing else needs to.
//
//    They are fired off distance, never off a timer. `uCart.x` is how far the
//    cart has come, so the number of joints between one frame and the next is
//    exactly how far it moved divided by the rail length — which means the
//    rhythm is right through every acceleration, every brake and every stall,
//    and stays right if the frame rate does not.
//
// 2. THE CHAIN. The one sound a coaster has that nothing else does. It is not a
//    speed, it is a *ratchet*: a dog dropping into a link at a fixed rate that
//    has nothing to do with how fast the hill is going by. The journey uploads
//    whether the chain is engaged (uRide.w) rather than letting the mix infer it
//    from the speed, because a brake run holds the speed steady too and it has
//    to sound like the opposite thing.
//
// 3. THE ROOM. Six rooms with six tails, crossfaded on one delay pair: eleven
//    milliseconds of tile flutter on the platform, a dead damped thud in the
//    chalk, a long bright metallic ring across the void's lattice, a shopping
//    centre, a nave, and — over the overlook — almost nothing at all, which
//    after the nave is the loudest thing in the journey.

import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'
import { PHASE_WRAP } from './kinematics'


type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

/** Glide for slow-moving parameters. */
const GLIDE = 0.45

/** Glide for the room change, which happens at a portal and should be quick. */
const ROOM_GLIDE = 0.30

const EPS = 0.004

/**
 * Rail length. Longer than the sleeper pitch, because sleepers are not what you
 * hear — the joints between rails are, and they come every other bay.
 */
const JOINT_PITCH = 5.0

/** Wheelbase, as the gap between the two impacts of one joint. */
const WHEELBASE = 1.9

/**
 * Where the current section's type sits in the flat uSecA array: slot 1 is the
 * room the cart is in, and `.z` of a slot is its type. Reading it here rather
 * than adding a uniform for it, because the array is already uploaded and the
 * index is a property of the packing, which is documented in kinematics.ts.
 */
const CUR_TYPE_INDEX = 1 * 4 + 2

/** Per-room reverb: delay time, feedback, damping cutoff, and a wet level. */
interface RoomTone {
  time: number;
  fb:   number;
  damp: number;
  wet:  number;
}

const ROOMS: RoomTone[] = [
  { time: 0.011, fb: 0.80, damp: 3200, wet: 0.55 }, // platform — tile flutter
  { time: 0.038, fb: 0.34, damp: 900, wet: 0.30 }, // drift — earth eats it
  { time: 0.210, fb: 0.74, damp: 6000, wet: 0.62 }, // void — a lattice, all of it steel
  { time: 0.145, fb: 0.62, damp: 2600, wet: 0.52 }, // concourse — a shopping centre
  { time: 0.330, fb: 0.80, damp: 4200, wet: 0.70 }, // chapel — a nave
  { time: 0.090, fb: 0.10, damp: 8000, wet: 0.08 }, // overlook — open air, and it is a shock
]

export class SwitchbackAudioEngine implements JourneyAudioEngine {
  private ctx:     AudioContext | null = null
  private isMuted: boolean = true

  private main:     GainNode | null = null
  private masterLP: BiquadFilterNode | null = null
  private dry:      GainNode | null = null
  private wet:      GainNode | null = null

  // The room, as one delay pair whose character is crossfaded between portals.
  private tap:     DelayNode | null = null
  private tapFb:   GainNode | null = null
  private tapDamp: BiquadFilterNode | null = null
  private tail:    DelayNode | null = null
  private tailFb:  GainNode | null = null

  private rollGain:  GainNode | null = null
  private rollLP:    BiquadFilterNode | null = null
  private squeal:    GainNode | null = null
  private squealBP:  BiquadFilterNode | null = null
  private windGain:  GainNode | null = null
  private windLP:    BiquadFilterNode | null = null
  private motorGain: GainNode | null = null
  private muzakGain: GainNode | null = null
  private naveGain:  GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private timers:      ReturnType<typeof setTimeout>[] = []

  // Last-written values, so a 60 Hz update only touches what actually moved.
  private lastRoll = -1
  private lastRollCut = -1
  private lastSqueal = -1
  private lastWind = -1
  private lastWindCut = -1
  private lastMotor = -1
  private lastMuzak = -1
  private lastNave = -1
  private lastRoom = -1

  // Driven from the shader uniforms each frame.
  private phase = -1
  private travel = 0
  private speed = 0
  private chain = 0
  private ratchet = 0
  private secType = 0
  private lapF = 0

  public toggleMute (): boolean {
    if (!this.ctx)
      this.init()
    this.isMuted = !this.isMuted
    if (this.ctx && this.main)
      this.main.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.85, this.ctx.currentTime, 0.25)
    if (!this.isMuted)
      void this.ctx?.resume()
    return this.isMuted
  }

  public destroy (): void {
    for (const t of this.timers)
      clearTimeout(t)
    this.timers = []
    void this.ctx?.close()
    this.ctx = null
  }

  private after (ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  // ---- construction -------------------------------------------------------

  private init (): void {
    try {
      const AudioCtx = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext
      if (!AudioCtx)
        return
      this.ctx = new AudioCtx()

      const now = this.ctx.currentTime

      this.main = this.ctx.createGain()
      this.main.gain.setValueAtTime(0.0, now)
      this.main.connect(this.ctx.destination)

      // Everything passes through here. The laps close it, slowly.
      this.masterLP      = this.ctx.createBiquadFilter()
      this.masterLP.type = 'lowpass'
      this.masterLP.frequency.setValueAtTime(18000, now)
      this.masterLP.Q.setValueAtTime(0.7, now)
      this.masterLP.connect(this.main)

      this.dry = this.ctx.createGain()
      this.dry.gain.setValueAtTime(1.0, now)
      this.dry.connect(this.masterLP)

      this.noiseBuffer = this.makeNoise()
      this.buildRoom()
      this.buildRoll()
      this.buildSqueal()
      this.buildWind()
      this.buildMotor()
      this.buildMuzak()
      this.buildNave()

      this.scheduleGroans()
    }
    catch (e) {
      console.error('Switchback audio init failed:', e)
    }
  }

  private makeNoise (): AudioBuffer | null {
    if (!this.ctx)
      return null

    const size   = 2 * this.ctx.sampleRate
    const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate)
    const out    = buffer.getChannelData(0)
    let last = 0.0
    for (let i = 0; i < size; i++) {
      const white = Math.random() * 2.0 - 1.0
      last        = (last + 0.02 * white) / 1.02
      out[i]      = last * 3.5
    }
    return buffer
  }

  private noiseSource (loop: boolean): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer)
      return null

    const src  = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop   = loop
    return src
  }

  /**
   * One delay pair for all six rooms, crossfaded rather than switched.
   *
   * A convolver per room would be better and is not affordable; six delay pairs
   * would be affordable and would all have to be muted, which is six times the
   * feedback loops ringing into nothing. Sweeping one pair means a portal is a
   * *transition* — the tile flutter of the platform stretching out into the
   * chalk's dead thud over the second or so it takes to go through the mouth —
   * and that is better than what a switch would have given anyway.
   */
  private buildRoom (): void {
    if (!this.ctx || !this.masterLP)
      return

    const now = this.ctx.currentTime

    this.wet = this.ctx.createGain()
    this.wet.gain.setValueAtTime(0.5, now)

    this.tap = this.ctx.createDelay(0.5)
    this.tap.delayTime.setValueAtTime(ROOMS[0].time, now)

    this.tapDamp      = this.ctx.createBiquadFilter()
    this.tapDamp.type = 'lowpass'
    this.tapDamp.frequency.setValueAtTime(ROOMS[0].damp, now)

    this.tapFb = this.ctx.createGain()
    this.tapFb.gain.setValueAtTime(ROOMS[0].fb, now)

    // A second, longer tap at an incommensurate ratio, so the two never line up
    // into a pitch. 3.7 rather than 4 is the whole of that.
    this.tail = this.ctx.createDelay(2.0)
    this.tail.delayTime.setValueAtTime(ROOMS[0].time * 3.7, now)

    this.tailFb = this.ctx.createGain()
    this.tailFb.gain.setValueAtTime(ROOMS[0].fb * 0.8, now)

    this.wet.connect(this.tap)
    this.tap.connect(this.tapDamp)
    this.tapDamp.connect(this.tapFb)
    this.tapFb.connect(this.tap)
    this.tapDamp.connect(this.tail)
    this.tail.connect(this.tailFb)
    this.tailFb.connect(this.tail)
    this.tail.connect(this.masterLP)
    this.tapDamp.connect(this.masterLP)
  }

  /** Wheels on rail: brown noise, opened up by speed. */
  private buildRoll (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    this.rollLP      = this.ctx.createBiquadFilter()
    this.rollLP.type = 'lowpass'
    this.rollLP.frequency.setValueAtTime(300, now)
    this.rollLP.Q.setValueAtTime(1.4, now)

    this.rollGain = this.ctx.createGain()
    this.rollGain.gain.setValueAtTime(0.0, now)

    src.connect(this.rollLP)
    this.rollLP.connect(this.rollGain)
    this.rollGain.connect(this.dry)
    this.rollGain.connect(this.wet ?? this.dry)
    src.start()
  }

  /**
   * Flange squeal. Driven by the *bank*, which the journey computes from lateral
   * acceleration — so this is genuinely the sound of the wheel being pushed into
   * the side of the rail, and it arrives exactly when the world starts to roll.
   */
  private buildSqueal (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    this.squealBP      = this.ctx.createBiquadFilter()
    this.squealBP.type = 'bandpass'
    this.squealBP.frequency.setValueAtTime(2100, now)
    this.squealBP.Q.setValueAtTime(26.0, now)

    // Two slow wobbles at incommensurate rates, so it never settles into a tone.
    for (const [ rate, amt ] of [[ 3.1, 120 ], [ 7.7, 60 ]]) {
      const lfo = this.ctx.createOscillator()
      lfo.frequency.setValueAtTime(rate, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(amt, now)
      lfo.connect(g)
      g.connect(this.squealBP.frequency)
      lfo.start()
    }

    this.squeal = this.ctx.createGain()
    this.squeal.gain.setValueAtTime(0.0, now)

    src.connect(this.squealBP)
    this.squealBP.connect(this.squeal)
    this.squeal.connect(this.dry)
    this.squeal.connect(this.wet ?? this.dry)
    src.start()
  }

  /** Air past the ears. Loud where there is no tunnel to hold it. */
  private buildWind (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    this.windLP      = this.ctx.createBiquadFilter()
    this.windLP.type = 'lowpass'
    this.windLP.frequency.setValueAtTime(700, now)
    this.windLP.Q.setValueAtTime(0.6, now)

    this.windGain = this.ctx.createGain()
    this.windGain.gain.setValueAtTime(0.0, now)

    src.connect(this.windLP)
    this.windLP.connect(this.windGain)
    this.windGain.connect(this.dry)
    src.start()
  }

  /** The lift motor, somewhere below the hill. */
  private buildMotor (): void {
    if (!this.ctx || !this.dry)
      return

    const now      = this.ctx.currentTime
    this.motorGain = this.ctx.createGain()
    this.motorGain.gain.setValueAtTime(0.0, now)

    for (const [ f, a ] of [[ 47, 1.0 ], [ 94, 0.34 ], [ 141, 0.16 ]]) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'sawtooth'
      osc.frequency.setValueAtTime(f, now)

      const lp = this.ctx.createBiquadFilter()
      lp.type  = 'lowpass'
      lp.frequency.setValueAtTime(260, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(a, now)

      osc.connect(lp)
      lp.connect(g)
      g.connect(this.motorGain)
      osc.start()
    }

    this.motorGain.connect(this.dry)
  }

  /**
   * The concourse. A major seventh with the tuning slipping, through a very dark
   * filter and a tape wow — a chord the building has been playing since it was
   * built and nobody has been in to change.
   */
  private buildMuzak (): void {
    if (!this.ctx || !this.dry)
      return

    const now      = this.ctx.currentTime
    this.muzakGain = this.ctx.createGain()
    this.muzakGain.gain.setValueAtTime(0.0, now)

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(1100, now)
    lp.Q.setValueAtTime(0.8, now)
    lp.connect(this.muzakGain)

    // F, A, C, E — and every voice detuned by a different amount, so the chord
    // beats against itself instead of sounding played.
    for (const [ f, det ] of [[ 174.6, 0 ], [ 220.0, 7 ], [ 261.6, -5 ], [ 329.6, 11 ]]) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'triangle'
      osc.frequency.setValueAtTime(f, now)
      osc.detune.setValueAtTime(det, now)

      // Tape wow: slow, deep, and the reason this reads as a recording rather
      // than as four oscillators.
      const wow = this.ctx.createOscillator()
      wow.frequency.setValueAtTime(0.23 + f * 0.0004, now)

      const wowAmt = this.ctx.createGain()
      wowAmt.gain.setValueAtTime(9.0, now)
      wow.connect(wowAmt)
      wowAmt.connect(osc.detune)
      wow.start()

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.22, now)
      osc.connect(g)
      g.connect(lp)
      osc.start()
    }

    this.muzakGain.connect(this.dry)
    this.muzakGain.connect(this.wet ?? this.dry)
  }

  /** The chapel. An open fifth, low, with a swell you cannot quite time. */
  private buildNave (): void {
    if (!this.ctx || !this.dry)
      return

    const now     = this.ctx.currentTime
    this.naveGain = this.ctx.createGain()
    this.naveGain.gain.setValueAtTime(0.0, now)

    for (const [ f, a ] of [[ 55.0, 1.0 ], [ 82.4, 0.7 ], [ 110.0, 0.45 ], [ 164.8, 0.20 ]]) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'sine'
      osc.frequency.setValueAtTime(f, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(a * 0.5, now)

      const swell = this.ctx.createOscillator()
      swell.frequency.setValueAtTime(0.041 + a * 0.017, now)

      const swellAmt = this.ctx.createGain()
      swellAmt.gain.setValueAtTime(a * 0.4, now)
      swell.connect(swellAmt)
      swellAmt.connect(g.gain)
      swell.start()

      osc.connect(g)
      g.connect(this.naveGain)
      osc.start()
    }

    this.naveGain.connect(this.dry)
    this.naveGain.connect(this.wet ?? this.dry)
  }

  /** The void, complaining about the weight. Rare, and it does not need to be more. */
  private scheduleGroans (): void {
    const tick = () => {
      if (!this.ctx || !this.wet)
        return
      if (!this.isMuted && this.secType === 2) {
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        osc.type  = 'sawtooth'
        osc.frequency.setValueAtTime(38 + Math.random() * 22, now)
        osc.frequency.exponentialRampToValueAtTime(26, now + 2.4)

        const bp = this.ctx.createBiquadFilter()
        bp.type  = 'bandpass'
        bp.frequency.setValueAtTime(180, now)
        bp.Q.setValueAtTime(8.0, now)

        const env = this.ctx.createGain()
        env.gain.setValueAtTime(0.0, now)
        env.gain.linearRampToValueAtTime(0.09, now + 0.6)
        env.gain.exponentialRampToValueAtTime(0.0001, now + 2.6)

        osc.connect(bp)
        bp.connect(env)
        env.connect(this.wet)
        osc.start(now)
        osc.stop(now + 2.7)
      }
      this.after(4000 + Math.random() * 9000, tick)
    }
    this.after(3000, tick)
  }

  // ---- events -------------------------------------------------------------

  /**
   * One rail joint: two impacts a wheelbase apart, the second a touch softer.
   *
   * The click is a noise burst through a resonant bandpass rather than a
   * synthesised thump, because what you actually hear is not the impact — it is
   * the whole cart ringing afterwards, and a high-Q filter *is* a ringing.
   */
  private joint (level: number): void {
    if (!this.ctx || !this.wet || !this.dry)
      return

    const now = this.ctx.currentTime
    const gap = WHEELBASE / Math.max(this.speed, 1.0)

    for (let axle = 0; axle < 2; axle++) {
      const src = this.noiseSource(false)
      if (!src)
        return

      const at = now + axle * Math.min(gap, 0.4)

      const bp = this.ctx.createBiquadFilter()
      bp.type  = 'bandpass'
      bp.frequency.setValueAtTime(280 + Math.random() * 160, at)
      bp.Q.setValueAtTime(3.2, at)

      const ring = this.ctx.createBiquadFilter()
      ring.type  = 'bandpass'
      ring.frequency.setValueAtTime(1500 + Math.random() * 900, at)
      ring.Q.setValueAtTime(14.0, at)

      const g   = level * (axle === 0 ? 1.0 : 0.72)
      const env = this.ctx.createGain()
      env.gain.setValueAtTime(0.0, at)
      env.gain.linearRampToValueAtTime(g, at + 0.004)
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.13)

      src.connect(bp)
      bp.connect(env)
      src.connect(ring)
      ring.connect(env)
      env.connect(this.dry)
      env.connect(this.wet)
      src.start(at)
      src.stop(at + 0.2)
    }
  }

  /** One chain dog dropping into one link. */
  private clack (): void {
    if (!this.ctx || !this.dry || !this.wet)
      return

    const now = this.ctx.currentTime
    const src = this.noiseSource(false)
    if (!src)
      return

    const bp = this.ctx.createBiquadFilter()
    bp.type  = 'bandpass'
    bp.frequency.setValueAtTime(900 + Math.random() * 500, now)
    bp.Q.setValueAtTime(9.0, now)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.11, now + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)

    src.connect(bp)
    bp.connect(env)
    env.connect(this.dry)
    env.connect(this.wet)
    src.start(now)
    src.stop(now + 0.1)
  }

  // ---- per-frame ----------------------------------------------------------

  public update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.isMuted || !state)
      return

    const cart = state.uCart as number[] | undefined
    const ride = state.uRide as number[] | undefined
    const atm  = state.uAtm as number[] | undefined
    const secA = state.uSecA as number[] | undefined
    const fall = state.uFall as number[] | undefined
    if (!cart || !ride || !atm || !secA)
      return

    // 0 while there is still track, 1 once there is not.
    const inFall = fall ? fall[0] : 0

    const now = this.ctx.currentTime

    this.speed   = cart[1]
    this.lapF    = cart[2]
    this.chain   = ride[3]
    this.secType = secA[CUR_TYPE_INDEX]

    // --- distance travelled since the last frame ---
    //
    // The phase is folded into [0, PHASE_WRAP), so once every couple of thousand
    // metres the difference between two frames is enormous and negative. A wrap
    // is the one delta that can be, so it is also the one that identifies itself.
    const phase = cart[0]
    if (this.phase >= 0) {
      let d = phase - this.phase
      if (d < -PHASE_WRAP * 0.5)
        d += PHASE_WRAP
      if (d > 0 && d < 40)
        this.travel += d
    }
    this.phase = phase

    // Joints, off distance. Capped per frame so that a tab left in the
    // background does not come back and fire four hundred of them at once.
    let fired = 0
    while (this.travel >= JOINT_PITCH && fired < 3) {
      this.travel -= JOINT_PITCH
      this.joint(0.05 + Math.min(this.speed / 18, 1.0) * 0.13)
      fired++
    }
    if (this.travel > JOINT_PITCH * 4)
      this.travel = 0

    // The chain, off a rate of its own. It is a ratchet: the dogs drop at the
    // speed the chain runs at, not at the speed the hill goes past.
    if (this.chain > 0.01) {
      this.ratchet += 0.0166 * 7.5
      while (this.ratchet >= 1.0) {
        this.ratchet -= 1.0
        this.clack()
      }
    }
    else
      this.ratchet = 0

    // --- continuous layers ---
    const v = Math.min(this.speed / 20, 1.0)

    // Wheels on rail, with no rail. The bed goes with the track: leaving it
    // running through the fall is the audible version of drawing the sleepers
    // in mid-air, and it is the one thing that would give the section away.
    const onRail = 1 - inFall

    this.ramp(this.rollGain?.gain, (0.03 + v * v * 0.16) * onRail, now, 'lastRoll')
    this.rampCut(this.rollLP?.frequency, 240 + v * 1600, now, 'lastRollCut')

    // Bank is v^2 * curvature, so this is the flange loading, near enough.
    const load = Math.min(Math.abs(atm[3]) / 0.45, 1.0)
    this.ramp(this.squeal?.gain, load * load * 0.075 * v * onRail, now, 'lastSqueal')

    // Wind: speed, and how little building there is around it.
    // Wind: speed, and how little building there is around it. In the shaft it
    // is the only thing left, so it opens all the way and stays there.
    const open = this.secType === 2 || this.secType === 5 || inFall > 0.5 ? 1.0 : 0.22
    this.ramp(this.windGain?.gain, (v * v * 0.13 + inFall * 0.17) * open, now, 'lastWind')
    this.rampCut(this.windLP?.frequency, 420 + v * 1400 + inFall * 900, now, 'lastWindCut')

    // A brake run is a chain that is slower than you are. It gets no motor.
    const lifting = this.chain > 0.01 && this.chain > this.speed - 0.4
    this.ramp(this.motorGain?.gain, lifting ? 0.055 : 0.0, now, 'lastMotor')

    this.ramp(this.muzakGain?.gain, this.secType === 3 ? 0.055 : 0.0, now, 'lastMuzak')
    this.ramp(this.naveGain?.gain, this.secType === 4 ? 0.10 : 0.0, now, 'lastNave')

    this.setRoom(now)

    // The laps take the top off everything. Not a duck and not a fade — the
    // building is simply further away every time round, and by the third lap you
    // are listening to it through a wall.
    const age = Math.min(this.lapF * 0.22, 0.62)
    this.masterLP?.frequency.setTargetAtTime(18000 * Math.pow(0.16, age), now, GLIDE)
    this.wet?.gain.setTargetAtTime(0.5 + age * 0.55, now, GLIDE)
  }

  /**
   * Crossfade the delay pair toward the current room's tail.
   *
   * Only touched when the room actually changes, which is five times a lap —
   * setting a delay time every frame retunes the feedback loop at 60 Hz and
   * turns a reverb into a chorus.
   */
  private setRoom (now: number): void {
    if (this.secType === this.lastRoom)
      return

    const i       = Math.max(0, Math.min(ROOMS.length - 1, Math.round(this.secType)))
    const r       = ROOMS[i]
    this.lastRoom = this.secType

    this.tap?.delayTime.setTargetAtTime(r.time, now, ROOM_GLIDE)
    this.tail?.delayTime.setTargetAtTime(r.time * 3.7, now, ROOM_GLIDE)
    this.tapFb?.gain.setTargetAtTime(r.fb, now, ROOM_GLIDE)
    this.tailFb?.gain.setTargetAtTime(r.fb * 0.8, now, ROOM_GLIDE)
    this.tapDamp?.frequency.setTargetAtTime(r.damp, now, ROOM_GLIDE)
    this.wet?.gain.setTargetAtTime(r.wet, now, ROOM_GLIDE)
  }

  private ramp (
    param: AudioParam | undefined,
    value: number,
    now: number,
    key: 'lastRoll' | 'lastSqueal' | 'lastWind' | 'lastMotor' | 'lastMuzak' | 'lastNave',
  ): void {
    if (!param)
      return
    if (Math.abs(value - this[key]) < EPS)
      return
    this[key] = value
    param.setTargetAtTime(value, now, GLIDE)
  }

  private rampCut (
    param: AudioParam | undefined,
    value: number,
    now: number,
    key: 'lastRollCut' | 'lastWindCut',
  ): void {
    if (!param)
      return
    if (Math.abs(value - this[key]) < 8)
      return
    this[key] = value
    param.setTargetAtTime(value, now, GLIDE)
  }
}

export function createSwitchbackAudio (): SwitchbackAudioEngine {
  return new SwitchbackAudioEngine()
}
