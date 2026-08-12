'use client'

// THE HOLLOW ORCHARD — soundtrack.
//
// Lives in its own module rather than inline in page.tsx (which is how
// liminal and stairwell do it) because withShaderJourney reduces the route to
// eleven lines, and there is no reason to put 250 lines of Web Audio back into
// it. The HOC builds this lazily on the first unmute — an AudioContext may only
// start from a user gesture — and calls `update` once per rendered frame with
// the very uniforms the shader is being drawn with, so the mix and the geometry
// stay on one clock. In particular the heartbeat is phase-locked to `uPulse.x`,
// the same value that makes the walls inhale.
//
// Layers: a wet sub-drone, a spore haze, wall plops, fibrous creak, chitin
// clicks, a heartbeat, and a delay that opens as you fall.

import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'
import {
  STAGE_CATHEDRAL,
  STAGE_COMPOST,
  STAGE_FRUITING,
  STAGE_HOST,
  STAGE_MARROW,
  STAGE_MYCELIAL,
  STAGE_NURSERY,
  STAGE_ROOTS

} from './kinematics'


type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

/** Smoothing constant for the per-frame parameter ramps, in seconds. */
const GLIDE = 0.7

/** Don't re-target an AudioParam for a move smaller than this. */
const EPS = 0.01

export class HollowOrchardAudioEngine implements JourneyAudioEngine {
  private ctx:     AudioContext | null = null
  private isMuted: boolean = true

  private main:      GainNode | null = null
  private droneLow:  OscillatorNode | null = null
  private droneHigh: OscillatorNode | null = null
  private droneFilt: BiquadFilterNode | null = null
  private droneGain: GainNode | null = null

  private hazeFilt:  BiquadFilterNode | null = null
  private hazeGain:  GainNode | null = null
  private creakGain: GainNode | null = null
  private wetBus:    GainNode | null = null
  private delayFb:   GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private timers:      ReturnType<typeof setTimeout>[] = []

  // Last-written parameter values, so `update` only touches what actually moved.
  private lastStage = 0
  private lastCutoff = -1
  private lastDrone = -1
  private lastHaze = -1
  private lastCreak = -1

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
    this.droneLow?.stop()
    this.droneHigh?.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  // ---- construction -------------------------------------------------------

  private init (): void {
    try {
      const AudioCtx = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext
      if (!AudioCtx)
        return
      this.ctx = new AudioCtx()

      this.main = this.ctx.createGain()
      this.main.gain.setValueAtTime(0.0, this.ctx.currentTime)
      this.main.connect(this.ctx.destination)

      this.noiseBuffer = this.makeNoise()
      this.buildDelay()
      this.buildDrone()
      this.buildHaze()
      this.buildCreak()

      this.schedulePlops()
      this.scheduleClicks()
      this.scheduleHeartbeat()
    }
    catch (e) {
      console.error('Hollow Orchard audio init failed:', e)
    }
  }

  /** Brown-ish noise: integrated white, the same recipe the other journeys use. */
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

  /** A wet room: everything one-shot goes through here, and it opens in the abyss. */
  private buildDelay (): void {
    if (!this.ctx || !this.main)
      return

    const delay = this.ctx.createDelay(1.0)
    delay.delayTime.setValueAtTime(0.42, this.ctx.currentTime)

    this.delayFb = this.ctx.createGain()
    this.delayFb.gain.setValueAtTime(0.12, this.ctx.currentTime)

    const damp = this.ctx.createBiquadFilter()
    damp.type  = 'lowpass'
    damp.frequency.setValueAtTime(1600, this.ctx.currentTime)

    this.wetBus = this.ctx.createGain()
    this.wetBus.gain.setValueAtTime(0.9, this.ctx.currentTime)

    this.wetBus.connect(delay)
    delay.connect(damp)
    damp.connect(this.delayFb)
    this.delayFb.connect(delay)
    damp.connect(this.main)
    this.wetBus.connect(this.main)
  }

  /** Two detuned sub oscillators through a cutoff that opens as you descend. */
  private buildDrone (): void {
    if (!this.ctx || !this.main)
      return
    this.droneLow       = this.ctx.createOscillator()
    this.droneHigh      = this.ctx.createOscillator()
    this.droneLow.type  = 'sine'
    this.droneHigh.type = 'triangle'
    this.droneLow.frequency.setValueAtTime(41.2, this.ctx.currentTime)
    this.droneHigh.frequency.setValueAtTime(42.5, this.ctx.currentTime)

    this.droneFilt      = this.ctx.createBiquadFilter()
    this.droneFilt.type = 'lowpass'
    this.droneFilt.frequency.setValueAtTime(95, this.ctx.currentTime)
    this.droneFilt.Q.setValueAtTime(3.0, this.ctx.currentTime)

    this.droneGain = this.ctx.createGain()
    this.droneGain.gain.setValueAtTime(0.16, this.ctx.currentTime)

    this.droneLow.connect(this.droneFilt)
    this.droneHigh.connect(this.droneFilt)
    this.droneFilt.connect(this.droneGain)
    this.droneGain.connect(this.main)
    this.droneLow.start()
    this.droneHigh.start()
  }

  /** Brown noise through a slowly sweeping bandpass — the air is full of spores. */
  private buildHaze (): void {
    if (!this.ctx || !this.main)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    this.hazeFilt      = this.ctx.createBiquadFilter()
    this.hazeFilt.type = 'bandpass'
    this.hazeFilt.frequency.setValueAtTime(520, this.ctx.currentTime)
    this.hazeFilt.Q.setValueAtTime(1.4, this.ctx.currentTime)

    const sweep = this.ctx.createOscillator()
    sweep.frequency.setValueAtTime(0.05, this.ctx.currentTime)

    const sweepAmt = this.ctx.createGain()
    sweepAmt.gain.setValueAtTime(260, this.ctx.currentTime)
    sweep.connect(sweepAmt)
    sweepAmt.connect(this.hazeFilt.frequency)
    sweep.start()

    this.hazeGain = this.ctx.createGain()
    this.hazeGain.gain.setValueAtTime(0.0, this.ctx.currentTime)

    src.connect(this.hazeFilt)
    this.hazeFilt.connect(this.hazeGain)
    this.hazeGain.connect(this.main)
    src.start()
  }

  /** High-Q sawtooth: wood and bone under load. Only audible in the dry scapes. */
  private buildCreak (): void {
    if (!this.ctx || !this.main)
      return

    const osc = this.ctx.createOscillator()
    osc.type  = 'sawtooth'
    osc.frequency.setValueAtTime(62, this.ctx.currentTime)

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(240, this.ctx.currentTime)
    band.Q.setValueAtTime(9.0, this.ctx.currentTime)

    this.creakGain = this.ctx.createGain()
    this.creakGain.gain.setValueAtTime(0.0, this.ctx.currentTime)

    osc.connect(band)
    band.connect(this.creakGain)
    this.creakGain.connect(this.main)
    osc.start()

    // Random-walk the pitch so it never settles into a note.
    const walk = () => {
      if (!this.ctx)
        return

      const next = 44 + Math.random() * 46
      osc.frequency.setTargetAtTime(next, this.ctx.currentTime, 1.1)
      this.after(2000 + Math.random() * 2600, walk)
    }
    walk()
  }

  // ---- one-shots ----------------------------------------------------------

  private after (ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  /** A wet drop landing on meat — pitch falls fast, unlike liminal's ringing drip. */
  private plop (gain: number): void {
    if (!this.ctx || !this.wetBus || this.isMuted)
      return

    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type  = 'sine'
    osc.frequency.setValueAtTime(380 + Math.random() * 180, now)
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.12)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)

    osc.connect(env)
    env.connect(this.wetBus)
    osc.start(now)
    osc.stop(now + 0.25)
  }

  private schedulePlops (): void {
    const tick = () => {
      if (!this.ctx)
        return
      if (!this.isMuted && Math.random() < 0.55)
        this.plop(0.10 + Math.random() * 0.16)
      this.after(240 + Math.random() * 1400 * (1.0 - this.plopDensity), tick)
    }
    this.after(900, tick)
  }

  private plopDensity = 0.2

  /** Dry chitin ticks, panned. Dense in the root labyrinth. */
  private click (): void {
    if (!this.ctx || !this.main || this.isMuted)
      return

    const now = this.ctx.currentTime
    const src = this.noiseSource(false)
    if (!src)
      return

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(1800 + Math.random() * 2600, now)
    band.Q.setValueAtTime(6.0, now)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.05, now + 0.001)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.02 + Math.random() * 0.03)

    const pan = this.ctx.createStereoPanner()
    pan.pan.setValueAtTime(Math.random() * 2 - 1, now)

    src.connect(band)
    band.connect(env)
    env.connect(pan)
    pan.connect(this.main)
    src.start(now)
    src.stop(now + 0.08)
  }

  private clickDensity = 0.0

  private scheduleClicks (): void {
    const tick = () => {
      if (!this.ctx)
        return
      if (!this.isMuted && Math.random() < this.clickDensity)
        this.click()
      this.after(60 + Math.random() * 220, tick)
    }
    this.after(1500, tick)
  }

  /** Two thumps, phase-locked to the same breath value that moves the walls. */
  private thump (gain: number, freq: number): void {
    if (!this.ctx || !this.main || this.isMuted)
      return

    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type  = 'sine'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.16)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.30)

    osc.connect(env)
    env.connect(this.main)
    osc.start(now)
    osc.stop(now + 0.34)
  }

  private beatAmount = 0.0

  private scheduleHeartbeat (): void {
    const tick = () => {
      if (!this.ctx)
        return
      if (!this.isMuted && this.beatAmount > 0.05) {
        this.thump(0.22 * this.beatAmount, 48)
        this.after(190, () => this.thump(0.15 * this.beatAmount, 40))
      }
      // Slows toward a stop as the descent runs out — the body is giving up.
      this.after(700 + this.beatSlow * 1500, tick)
    }
    this.after(2000, tick)
  }

  private beatSlow = 0.0

  /** A soft burst of spores — fired when the stage changes under you. */
  private burst (): void {
    if (!this.ctx || !this.wetBus || this.isMuted)
      return

    const now = this.ctx.currentTime
    const src = this.noiseSource(false)
    if (!src)
      return

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(700, now)
    band.frequency.exponentialRampToValueAtTime(180, now + 1.4)
    band.Q.setValueAtTime(1.2, now)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.30, now + 0.05)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.6)

    src.connect(band)
    band.connect(env)
    env.connect(this.wetBus)
    src.start(now)
    src.stop(now + 1.7)
  }

  // ---- per-frame ----------------------------------------------------------

  /**
   * Called once per rendered frame by withShaderJourney with the simulation's
   * uniform map. Everything here is a `setTargetAtTime` glide guarded by an
   * epsilon, so a 60 Hz call rate costs almost nothing.
   */
  public update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.isMuted || !state)
      return

    const stageArr = state.uStage as number[] | undefined
    const walkArr  = state.uWalk as number[] | undefined
    const pulseArr = state.uPulse as number[] | undefined
    if (!stageArr || !walkArr || !pulseArr)
      return

    const stage   = stageArr[0]
    const descent = walkArr[2]
    const rot     = walkArr[3]
    const breath  = pulseArr[0]
    const now     = this.ctx.currentTime

    if (stage !== this.lastStage) {
      this.lastStage = stage
      this.burst()
    }

    // The room opens up as you fall.
    this.ramp(this.droneFilt?.frequency, 95 + descent * 260 + rot * 90, now, 'lastCutoff')
    this.ramp(this.droneGain?.gain, 0.16 + descent * 0.12 + rot * 0.06, now, 'lastDrone')
    this.ramp(this.hazeGain?.gain,
              0.04 + (stage === STAGE_CATHEDRAL ? 0.16 : 0.0) + rot * 0.09 + descent * 0.05,
              now, 'lastHaze')
    this.ramp(this.creakGain?.gain,
              stage === STAGE_NURSERY || stage === STAGE_MARROW ? 0.05 + rot * 0.03 : 0.0,
              now, 'lastCreak')

    if (this.delayFb)
      this.delayFb.gain.setTargetAtTime(0.12 + descent * 0.42, now, GLIDE)

    // The drone falls toward 32 Hz through the abyss.
    this.droneLow?.frequency.setTargetAtTime(41.2 - descent * 9.0, now, 1.5)
    this.droneHigh?.frequency.setTargetAtTime(42.5 - descent * 9.4, now, 1.5)

    const fleshy      = stage === STAGE_FRUITING || stage === STAGE_HOST
    this.plopDensity  = Math.min(0.9, (fleshy ? 0.6 : 0.15) + rot * 0.3)
    this.clickDensity = stage === STAGE_ROOTS ? 0.55 : stage === STAGE_MYCELIAL ? 0.3 : 0.06

    // Heartbeat: audible wherever the walls are alive, and it drags to a halt
    // in COMPOST, where the simulation has already stopped moving you.
    this.beatAmount = Math.min(1.0, (fleshy ? 0.9 : 0.25) + rot * 0.5) * (0.55 + 0.9 * breath)
    this.beatSlow   = stage === STAGE_COMPOST ? Math.min(1.0, descent * 1.2) : 0.0
  }

  /** setTargetAtTime with an epsilon guard, keyed by the field caching the last write. */
  private ramp (
    param: AudioParam | undefined,
    value: number,
    now: number,
    key: 'lastCutoff' | 'lastDrone' | 'lastHaze' | 'lastCreak',
  ): void {
    if (!param)
      return

    const scale = key === 'lastCutoff' ? 1.0 : 200.0
    if (Math.abs(value - this[key]) * scale < EPS)
      return
    this[key] = value
    param.setTargetAtTime(value, now, GLIDE)
  }
}

export function createHollowOrchardAudio (): HollowOrchardAudioEngine {
  return new HollowOrchardAudioEngine()
}
