'use client'

// THE NATATORIUM — soundtrack.
//
// Built lazily on the first unmute by withShaderJourney, which then calls
// `update` once per rendered frame with the very uniforms the shader is being
// drawn with — so the mix and the geometry stay on one clock.
//
// Two things carry this piece:
//
// 1. FLUTTER ECHO. A tiled pool hall's signature is not reverb, it is flutter:
//    a very short delay bouncing between hard parallel walls. An 11 ms tap at
//    high feedback gives the metallic slapback ping that says "tile" before any
//    other layer is audible. Everything else sits inside it.
//
// 2. THE DUCK. As the head goes under, the whole master bus collapses through a
//    lowpass. The time constant on that ramp is the single most important number
//    in the file: the walk cycle makes `above` oscillate at the crossing, and a
//    slow constant smears those dips into one dull fade instead of rendering
//    every individual moment the ears break the surface.

import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'
import { TYPE_PLANT, TYPE_RAW } from './kinematics'


type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

/** Glide for slow-moving parameters. */
const GLIDE = 0.6

/**
 * Glide for the submersion duck. Deliberately fast: the head bob makes `above`
 * flutter 0<->1 for several seconds at the crossing and every one of those dips
 * should be audible as a separate lurch, not averaged away.
 */
const DUCK_GLIDE = 0.04

const EPS = 0.004

export class NatatoriumAudioEngine implements JourneyAudioEngine {
  private ctx:     AudioContext | null = null
  private isMuted: boolean = true

  private main:     GainNode | null = null
  private masterLP: BiquadFilterNode | null = null
  private dry:      GainNode | null = null

  // Flutter echo — the tile signature.
  private flutter:   DelayNode | null = null
  private flutterFb: GainNode | null = null
  private flutterLP: BiquadFilterNode | null = null
  private wetBus:    GainNode | null = null

  private roomGain:   GainNode | null = null
  private sloshGain:  GainNode | null = null
  private buzzGain:   GainNode | null = null
  private humGain:    GainNode | null = null
  private rumbleGain: GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private timers:      ReturnType<typeof setTimeout>[] = []

  // Last-written values, so a 60 Hz update only touches what actually moved.
  private lastCut = -1
  private lastSlosh = -1
  private lastBuzz = -1
  private lastHum = -1
  private lastRumble = -1

  // Driven from the shader uniforms each frame.
  private submerged = 0
  private depth = 0
  private secType = 0

  public toggleMute (): boolean {
    if (!this.ctx)
      this.init()
    this.isMuted = !this.isMuted
    if (this.ctx && this.main)
      this.main.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.9, this.ctx.currentTime, 0.25)
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

      // Everything passes through here. Submersion closes it.
      this.masterLP      = this.ctx.createBiquadFilter()
      this.masterLP.type = 'lowpass'
      this.masterLP.frequency.setValueAtTime(18000, this.ctx.currentTime)
      this.masterLP.Q.setValueAtTime(0.7, this.ctx.currentTime)
      this.masterLP.connect(this.main)

      this.dry = this.ctx.createGain()
      this.dry.gain.setValueAtTime(1.0, this.ctx.currentTime)
      this.dry.connect(this.masterLP)

      this.noiseBuffer = this.makeNoise()
      this.buildFlutter()
      this.buildRoom()
      this.buildSlosh()
      this.buildBuzz()
      this.buildHum()
      this.buildRumble()

      this.scheduleDrips()
      this.scheduleFootfalls()
      this.scheduleWhistle()
    }
    catch (e) {
      console.error('Natatorium audio init failed:', e)
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

  /** 11 ms slapback between parallel tile walls, plus a longer body tap. */
  private buildFlutter (): void {
    if (!this.ctx || !this.masterLP)
      return

    const now = this.ctx.currentTime

    this.flutter = this.ctx.createDelay(0.5)
    this.flutter.delayTime.setValueAtTime(0.011, now)

    this.flutterFb = this.ctx.createGain()
    this.flutterFb.gain.setValueAtTime(0.82, now)

    this.flutterLP      = this.ctx.createBiquadFilter()
    this.flutterLP.type = 'lowpass'
    this.flutterLP.frequency.setValueAtTime(2400, now)

    const body = this.ctx.createDelay(0.5)
    body.delayTime.setValueAtTime(0.071, now)

    const bodyFb = this.ctx.createGain()
    bodyFb.gain.setValueAtTime(0.62, now)

    this.wetBus = this.ctx.createGain()
    this.wetBus.gain.setValueAtTime(0.85, now)

    this.wetBus.connect(this.flutter)
    this.flutter.connect(this.flutterLP)
    this.flutterLP.connect(this.flutterFb)
    this.flutterFb.connect(this.flutter)
    this.flutterLP.connect(body)
    body.connect(bodyFb)
    bodyFb.connect(body)
    body.connect(this.masterLP)
    this.flutterLP.connect(this.masterLP)
  }

  /** HVAC room air: brown noise through a slowly swept bandpass. */
  private buildRoom (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(600, now)
    band.Q.setValueAtTime(0.9, now)

    const sweep = this.ctx.createOscillator()
    sweep.frequency.setValueAtTime(0.06, now)

    const sweepAmt = this.ctx.createGain()
    sweepAmt.gain.setValueAtTime(220, now)
    sweep.connect(sweepAmt)
    sweepAmt.connect(band.frequency)
    sweep.start()

    this.roomGain = this.ctx.createGain()
    this.roomGain.gain.setValueAtTime(0.10, now)

    src.connect(band)
    band.connect(this.roomGain)
    this.roomGain.connect(this.dry)
    src.start()
  }

  /**
   * The body of water. Two amplitude LFOs at deliberately incommensurate rates
   * (0.13 and 0.31 Hz) so it never audibly loops.
   */
  private buildSlosh (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(220, now)
    lp.Q.setValueAtTime(1.2, now)

    this.sloshGain = this.ctx.createGain()
    this.sloshGain.gain.setValueAtTime(0.0, now)

    for (const [ rate, amt ] of [[ 0.13, 0.35 ], [ 0.31, 0.22 ]]) {
      const lfo = this.ctx.createOscillator()
      lfo.frequency.setValueAtTime(rate, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(amt, now)
      lfo.connect(g)
      g.connect(this.sloshGain.gain)
      lfo.start()
    }

    src.connect(lp)
    lp.connect(this.sloshGain)
    this.sloshGain.connect(this.dry)
    src.start()
  }

  /** Fluorescent buzz: 120 Hz saw through a narrow high bandpass. */
  private buildBuzz (): void {
    if (!this.ctx || !this.dry)
      return

    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type  = 'sawtooth'
    osc.frequency.setValueAtTime(120, now)

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(4800, now)
    band.Q.setValueAtTime(11.0, now)

    this.buzzGain = this.ctx.createGain()
    this.buzzGain.gain.setValueAtTime(0.02, now)

    osc.connect(band)
    band.connect(this.buzzGain)
    this.buzzGain.connect(this.dry)
    osc.start()
  }

  /** Mains hum for the plant rooms — 50/100/150 Hz stacked. */
  private buildHum (): void {
    if (!this.ctx || !this.dry)
      return

    const now    = this.ctx.currentTime
    this.humGain = this.ctx.createGain()
    this.humGain.gain.setValueAtTime(0.0, now)
    this.humGain.connect(this.dry)

    for (const [ f, a ] of [[ 50, 0.5 ], [ 100, 0.3 ], [ 150, 0.14 ]]) {
      const o = this.ctx.createOscillator()
      o.type  = 'sine'
      o.frequency.setValueAtTime(f, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(a, now)
      o.connect(g)
      g.connect(this.humGain)
      o.start()
    }
  }

  /** Sub-rumble that only exists below the surface — pressure, not sound. */
  private buildRumble (): void {
    if (!this.ctx || !this.main)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(90, now)

    this.rumbleGain = this.ctx.createGain()
    this.rumbleGain.gain.setValueAtTime(0.0, now)

    src.connect(lp)
    lp.connect(this.rumbleGain)
    // Straight to main: the whole point is that it survives the master lowpass.
    this.rumbleGain.connect(this.main)
    src.start()
  }

  // ---- one-shots ----------------------------------------------------------

  private after (ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  /** A drip landing in standing water, drenched in the flutter bus. */
  private drip (): void {
    if (!this.ctx || !this.wetBus || this.isMuted)
      return

    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type  = 'sine'
    osc.frequency.setValueAtTime(900 + Math.random() * 700, now)
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.06)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.16, now + 0.004)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)

    osc.connect(env)
    env.connect(this.wetBus)
    osc.start(now)
    osc.stop(now + 0.2)
  }

  private scheduleDrips (): void {
    const tick = () => {
      if (!this.ctx)
        return
      if (!this.isMuted && this.submerged < 0.5 && Math.random() < 0.6)
        this.drip()
      this.after(500 + Math.random() * 2600, tick)
    }
    this.after(1200, tick)
  }

  /**
   * A wade footfall: a bandpass sweep from bright to dull plus a low thump.
   * Brightness and rate track depth — shin-deep is crisp and quick, chest-deep
   * is heavy and slow, and below the surface these become swim strokes.
   */
  private splash (): void {
    if (!this.ctx || !this.wetBus || this.isMuted)
      return

    const src = this.noiseSource(false)
    if (!src)
      return

    const now = this.ctx.currentTime
    const wet = Math.min(1, this.depth / 1.6)
    const sub = this.submerged

    const band = this.ctx.createBiquadFilter()
    band.type  = 'bandpass'
    band.frequency.setValueAtTime(1800 - wet * 1100, now)
    band.frequency.exponentialRampToValueAtTime(320, now + 0.18 + sub * 0.25)
    band.Q.setValueAtTime(1.1, now)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.14 * (1.0 - sub * 0.45), now + 0.01 + sub * 0.06)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.30 + sub * 0.4)

    src.connect(band)
    band.connect(env)
    env.connect(this.wetBus)
    src.start(now)
    src.stop(now + 0.8)
  }

  private scheduleFootfalls (): void {
    const tick = () => {
      if (!this.ctx)
        return
      if (!this.isMuted)
        this.splash()

      // Slower the deeper you are, slower still once you are swimming.
      const period = 620 + this.depth * 260 + this.submerged * 700
      this.after(period * (0.85 + Math.random() * 0.3), tick)
    }
    this.after(1800, tick)
  }

  /** One lifeguard whistle, rarely. A single event with enormous effect. */
  private scheduleWhistle (): void {
    const tick = () => {
      if (!this.ctx || !this.wetBus)
        return
      if (!this.isMuted && this.submerged < 0.4) {
        const now = this.ctx.currentTime
        const src = this.noiseSource(false)
        if (src) {
          const band = this.ctx.createBiquadFilter()
          band.type  = 'bandpass'
          band.frequency.setValueAtTime(2600, now)
          band.Q.setValueAtTime(24.0, now)

          const trill = this.ctx.createOscillator()
          trill.frequency.setValueAtTime(18, now)

          const trillAmt = this.ctx.createGain()
          trillAmt.gain.setValueAtTime(220, now)
          trill.connect(trillAmt)
          trillAmt.connect(band.frequency)
          trill.start(now)
          trill.stop(now + 0.5)

          const env = this.ctx.createGain()
          env.gain.setValueAtTime(0.0, now)
          env.gain.linearRampToValueAtTime(0.10, now + 0.03)
          env.gain.setValueAtTime(0.10, now + 0.30)
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

          src.connect(band)
          band.connect(env)
          env.connect(this.wetBus)
          src.start(now)
          src.stop(now + 0.55)
        }
      }
      this.after(40000 + Math.random() * 50000, tick)
    }
    this.after(25000 + Math.random() * 20000, tick)
  }

  // ---- per-frame ----------------------------------------------------------

  public update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.isMuted || !state)
      return

    const look = state.uLook as number[] | undefined
    const wave = state.uWave as number[] | undefined
    if (!look || !wave)
      return

    const above = look[2]
    const now   = this.ctx.currentTime

    this.submerged = 1.0 - above
    this.depth     = look[3]
    this.secType   = wave[3]

    const sub = this.submerged

    // --- the duck ---
    // Exponential sweep so the perceived closure is linear.
    const cut = 18000 * Math.pow(380 / 18000, sub)
    if (this.masterLP && Math.abs(cut - this.lastCut) > 4) {
      this.lastCut = cut
      this.masterLP.frequency.setTargetAtTime(cut, now, DUCK_GLIDE)
      this.masterLP.Q.setTargetAtTime(0.7 + sub * 0.9, now, DUCK_GLIDE)
    }

    // An underwater tail is physically shorter, but longer-and-darker reads far
    // better as "pressurised", so that is what this does.
    this.flutterFb?.gain.setTargetAtTime(0.82 + sub * 0.06, now, GLIDE)
    this.flutterLP?.frequency.setTargetAtTime(2400 - sub * 2100, now, GLIDE)

    this.ramp(this.rumbleGain?.gain, sub * 0.34, now, 'lastRumble')
    this.ramp(this.sloshGain?.gain, 0.05 + Math.min(this.depth, 2.0) * 0.10, now, 'lastSlosh')
    this.ramp(this.buzzGain?.gain, (1.0 - sub) * 0.024, now, 'lastBuzz')
    this.ramp(
      this.humGain?.gain,
      this.secType === TYPE_PLANT ? 0.055 : this.secType === TYPE_RAW ? 0.022 : 0.0,
      now, 'lastHum',
    )
  }

  private ramp (
    param: AudioParam | undefined,
    value: number,
    now: number,
    key: 'lastSlosh' | 'lastBuzz' | 'lastHum' | 'lastRumble',
  ): void {
    if (!param)
      return
    if (Math.abs(value - this[key]) < EPS)
      return
    this[key] = value
    param.setTargetAtTime(value, now, GLIDE)
  }
}

export function createNatatoriumAudio (): NatatoriumAudioEngine {
  return new NatatoriumAudioEngine()
}
