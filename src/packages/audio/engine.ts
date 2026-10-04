// The base every journey's soundtrack extends.
//
// The engines all had the same skeleton — an AudioContext built on the first
// unmute (it may only start from a user gesture), a master gain faded in and
// out, a set of timers to cancel on teardown, a brown-noise buffer to filter
// wind and hiss from, and often a master lowpass with a dry bus into it, which
// is how a journey closes the whole mix down (submersion, the laps). That
// skeleton lives here; an engine builds its graph in `build()` and modulates
// it in `update()`.

import type { JourneyAudioEngine } from '@wjh/journey/types'
import type { CustomUniforms } from '@wjh/gl/uniforms'
import { brownNoise, createAudioContext } from './nodes'

/** Longest gap between the two impacts of one joint, seconds. */
const MAX_AXLE_GAP = 0.4

/** The second axle's level relative to the first. */
const REAR_AXLE_LEVEL = 0.72

/** Attack of a joint's impact, seconds. */
const JOINT_ATTACK = 0.004

/** One resonant bandpass: centre frequency Hz and Q. */
interface Band {
  f: number;
  q: number;
}

/** A burst of noise through parallel bandpasses and a percussive envelope. */
export interface NoiseHit {

  /** AudioContext time to start at; now when omitted. */
  at?:    number;
  bands:  readonly Band[];
  peak:   number;
  attack: number;

  /** Seconds from `at` until the envelope has fallen to silence. */
  decay: number;

  /** Seconds from `at` until the source is stopped. */
  stop: number;
  to:   readonly AudioNode[];
}

/** Two impacts a wheelbase apart, the second a touch softer. */
export interface RailJoint {
  gap:   number;
  level: number;
  body:  () => Band;
  ring:  () => Band;
  decay: number;
  stop:  number;
  to:    readonly AudioNode[];
}

export abstract class JourneyAudio implements JourneyAudioEngine {
  private timers:        ReturnType<typeof setTimeout>[] = []
  protected ctx:         AudioContext | null = null
  protected main:        GainNode | null = null
  protected masterLP:    BiquadFilterNode | null = null
  protected dry:         GainNode | null = null
  protected noiseBuffer: AudioBuffer | null = null
  protected isMuted = true

  protected isPaused = false

  /** For the error log if the graph fails to build. */
  protected abstract readonly name: string

  /** Master level when unmuted, and the time constant of the mute fade. */
  protected readonly level: number = 0.85
  protected readonly fade:  number = 0.25

  /**
   * Build a master lowpass (open, at 18 kHz) and a dry bus into it before
   * `build()`. Engines that close the whole mix down ask for it.
   */
  protected readonly bus: boolean = false

  private init (): void {
    try {
      const ctx = createAudioContext()
      if (!ctx)
        return
      this.ctx  = ctx

      const now = ctx.currentTime

      this.main = ctx.createGain()
      this.main.gain.setValueAtTime(0, now)
      this.main.connect(ctx.destination)

      if (this.bus) {
        this.masterLP      = ctx.createBiquadFilter()
        this.masterLP.type = 'lowpass'
        this.masterLP.frequency.setValueAtTime(18000, now)
        this.masterLP.Q.setValueAtTime(0.7, now)
        this.masterLP.connect(this.main)

        this.dry = ctx.createGain()
        this.dry.gain.setValueAtTime(1, now)
        this.dry.connect(this.masterLP)
      }

      this.noiseBuffer = brownNoise(ctx)
      this.build()
    }
    catch (e) {
      console.error(`${this.name} audio init failed:`, e)
    }
  }

  toggleMute (): boolean {
    if (!this.ctx)
      this.init()
    this.isMuted = !this.isMuted

    const ctx    = this.ctx
    if (ctx && this.main) {
      this.main.gain.setTargetAtTime(this.isMuted ? 0 : this.level, ctx.currentTime, this.fade)
      if (!this.isMuted && !this.isPaused && ctx.state === 'suspended')
        void ctx.resume()
    }
    return this.isMuted
  }

  /**
   * A paused journey is silent: the context is suspended, which stops every
   * scheduled source where it is, so it picks up from the same sample.
   */
  setPaused (paused: boolean): void {
    this.isPaused = paused

    const ctx     = this.ctx
    if (!ctx)
      return
    if (paused && ctx.state === 'running')
      void ctx.suspend()
    else if (!paused && !this.isMuted && ctx.state === 'suspended')
      void ctx.resume()
  }

  destroy (): void {
    for (const t of this.timers)
      clearTimeout(t)
    this.timers = []
    this.teardown()
    void this.ctx?.close()
    this.ctx  = null
    this.main = null
  }

  /** Per-frame modulation from the frame's uniforms. Optional. */
  update? (time: number, state?: CustomUniforms): void

  /** Build the graph into `this.main` (or `this.dry` when `bus`). Called once. */
  protected abstract build (): void

  /** Anything to stop before the context closes. */
  protected teardown (): void {}

  /** setTimeout that destroy() cancels. */
  protected after (ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  /** True while there is a running graph and it is not muted. */
  protected get audible (): boolean {
    return this.ctx !== null && !this.isMuted
  }

  /** A source over the shared noise buffer, not yet started. */
  protected noiseSource (loop: boolean): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer)
      return null

    const src  = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop   = loop
    return src
  }

  /** One percussive noise burst. Does nothing without a running graph. */
  protected noiseHit ({ at, bands, peak, attack, decay, stop, to }: NoiseHit): void {
    const ctx = this.ctx
    const src = this.noiseSource(false)
    if (!ctx || !src)
      return

    const t   = at ?? ctx.currentTime
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(peak, t + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay)

    for (const band of bands) {
      const bp = ctx.createBiquadFilter()
      bp.type  = 'bandpass'
      bp.frequency.setValueAtTime(band.f, t)
      bp.Q.setValueAtTime(band.q, t)
      src.connect(bp)
      bp.connect(env)
    }
    for (const node of to)
      env.connect(node)
    src.start(t)
    src.stop(t + stop)
  }

  /**
   * One rail joint. The click is a noise burst through a resonant bandpass
   * rather than a synthesised thump, because what you actually hear is not the
   * impact — it is the whole cart ringing afterwards, and a high-Q filter *is*
   * a ringing.
   */
  protected railJoint ({ gap, level, body, ring, decay, stop, to }: RailJoint): void {
    const now = this.ctx?.currentTime ?? 0
    for (let axle = 0; axle < 2; axle++)
      this.noiseHit({
        at:     now + axle * Math.min(gap, MAX_AXLE_GAP),
        bands:  [ body(), ring() ],
        peak:   level * (axle === 0 ? 1 : REAR_AXLE_LEVEL),
        attack: JOINT_ATTACK,
        decay,
        stop,
        to,
      })
  }
}
