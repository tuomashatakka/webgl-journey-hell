'use client'

// THE LOOP LINE — soundtrack.
//
// Built lazily on the first unmute by withShaderJourney, which then calls
// `update` once per rendered frame with the very uniforms the shader is being
// drawn with — so the mix and the picture are on one clock and cannot drift.
//
// Four things carry this piece:
//
// 1. THE MOTOR. A driverless people-mover has no engine note in the diesel
//    sense — it has a DC-chopper traction drive whose whine rises in discrete
//    steps as the inverter frequency climbs. Three detuned sawtooth oscillators
//    through a resonant lowpass that opens with speed give you that stepped
//    rising whine without modelling the PWM switching. The pitch follows speed,
//    not RPM; there is no gearbox. It is the dominant continuous voice and it
//    is what tells you the train is electric.
//
// 2. THE JOINTS. Every rail joint under the wheels is two impacts a fraction of
//    a second apart (front bogie, then rear), and the rate of them is speed
//    divided by rail length. They are fired off distance — `uLoop[1]` is total
//    metres ever travelled — so the rhythm is right through every acceleration
//    and every stall, and stays right if the frame rate does not. As the line
//    ages the joints get brighter, louder and more irregular: by the late laps
//    the track sounds broken rather than jointed. A cap of four per frame
//   防止 a backgrounded tab from firing ten thousand at once on return.
//
// 3. THE BAYS. Seven rooms with seven tones, crossfaded on one delay pair: a
//    tiled slap-back on the platform, a dead-mall reverb in the concourse, open
//    air through the cut, water in the annex, fan-wall noise in the stacks,
//    almost nothing on the trestle, and a close dry bore through the chord. The
//    delay pair is retuned on each bay change rather than switched, so a portal
//    is a *transition* — the sound of one room stretching into the next — and
//    that is better than what a switch would have given anyway. The chord's
//    8 ms reflection is its only reverb: a bore that narrow does not have room
//    for a tail.
//
// 4. THE ANNOUNCEMENTS. A formant-ish two-band-filtered pulse train that reads
//    as the *cadence* of speech without words — a station-name-shaped phrase
//    plus a two-note door chime. This is the spine of the piece and the thing
//    that must degrade most legibly. As `uRide[1]` rises, the syllable order
//    shuffles deterministically, syllables drop out, and the pitch drifts flat.
//    By the fourth lap the announcement arrives with its syllables in visibly
//    wrong order and half of them missing. Deterministic: seeded on
//    (bayId × 31 + lap × 7), never Math.random(), because this repo's whole
//    debug story is ?t= reseeking and producing identical output.
//
// The master degradation is a lowpass that closes as lapF rises — "by the third
//    lap you are listening to it through a wall" — plus rising reverb wetness,
//    plus an occasional power-cut dropout gated on uDecay[1] where everything
//    ducks for 100-200 ms.

import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'
import { clamp01 } from './kinematics'


type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

/** Glide for slow-moving continuous parameters. */
const GLIDE = 0.45

/** Glide for the room crossfade, which happens at a portal and should be quick. */
const ROOM_GLIDE = 0.30

const EPS = 0.004

/** Rail length in metres — joint impacts fire every JOINT_PITCH of travel. */
const JOINT_PITCH = 12.5

/** Bogie wheelbase in metres — the gap between the two impacts of one joint. */
const WHEELBASE = 2.2

/** Maximum joints to fire in a single update frame. */
const MAX_JOINTS = 4

/** Per-bay reverb: delay time, feedback, damping cutoff, wet level. */
interface RoomTone {
  time: number;
  fb:   number;
  damp: number;
  wet:  number;
}

/**
 * Seven rooms, one per bayId 0..6.
 *
 * THE CHORD's 8 ms tap is not a reverb — it is the sound of being in a pipe.
 * THE TURNBACK's near-zero wet is not a mistake — it is the absence that lets
 * the other rooms exist.
 */
const ROOMS: RoomTone[] = [
  { time: 0.013, fb: 0.82, damp: 3800, wet: 0.52 }, // 0 — PLATFORM SIX, tiled flutter
  { time: 0.042, fb: 0.36, damp: 850, wet: 0.32 }, // 1 — THE CONCOURSE, big vaulted
  { time: 0.000, fb: 0.00, damp: 8000, wet: 0.00 }, // 2 — THE CUT, open air, no tail
  { time: 0.016, fb: 0.45, damp: 1400, wet: 0.28 }, // 3 — THE ANNEX, flooded chamber
  { time: 0.008, fb: 0.20, damp: 6000, wet: 0.15 }, // 4 — THE STACKS, machine hall
  { time: 0.000, fb: 0.00, damp: 8000, wet: 0.02 }, // 5 — THE TURNBACK, open void
  { time: 0.008, fb: 0.55, damp: 1200, wet: 0.40 }, // 6 — THE CHORD, close bore
]

//
// Syllable patterns for the formant announcement — one per bay. Each is 3-6
// syllables defined as [frequency, duration] pairs. The pitches are deliberately
// not in tune with each other; they are the cadence of a station announcement,
// // not music.
//
const SYLLABLES: [number, number][][] = [
  [[ 280, 0.11 ], [ 310, 0.09 ], [ 260, 0.13 ]], // PLATFORM SIX
  [[ 250, 0.10 ], [ 300, 0.10 ], [ 270, 0.09 ], [ 320, 0.11 ]], // THE CONCOURSE
  [[ 290, 0.12 ], [ 260, 0.10 ]], // THE CUT
  [[ 270, 0.09 ], [ 310, 0.11 ], [ 250, 0.10 ], [ 290, 0.08 ], [ 330, 0.09 ]], // THE ANNEX
  [[ 300, 0.10 ], [ 260, 0.12 ], [ 320, 0.09 ]], // THE STACKS
  [[ 260, 0.11 ], [ 290, 0.10 ], [ 270, 0.13 ], [ 310, 0.09 ]], // THE TURNBACK
  [[ 280, 0.12 ], [ 310, 0.10 ], [ 250, 0.11 ], [ 300, 0.09 ], [ 270, 0.10 ], [ 320, 0.08 ]], // THE CHORD
]


export class LoopLineAudioEngine implements JourneyAudioEngine {
  private ctx:     AudioContext | null = null
  private isMuted: boolean = true

  private main:     GainNode | null = null
  private masterLP: BiquadFilterNode | null = null
  private dry:      GainNode | null = null
  private wet:      GainNode | null = null

  // One delay pair for all seven rooms, crossfaded on portal.
  private tap:     DelayNode | null = null
  private tapFb:   GainNode | null = null
  private tapDamp: BiquadFilterNode | null = null
  private tail:    DelayNode | null = null
  private tailFb:  GainNode | null = null

  private motorGain:  GainNode | null = null
  private muzakGain:  GainNode | null = null
  private windGain:   GainNode | null = null
  private waterGain:  GainNode | null = null
  private splashGain: GainNode | null = null
  private fanGain:    GainNode | null = null
  private coilGain:   GainNode | null = null
  private relayGain:  GainNode | null = null
  private voidGain:   GainNode | null = null
  private boreGain:   GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private timers:      ReturnType<typeof setTimeout>[] = []

  // Driven from the shader uniforms each frame.
  private speed = 0
  private lapF = 0
  private shake = 0
  private bay = -1
  private travel = 0
  private lastBay = -1

  // Reverb crossfade state — only touched on bay change.
  private lastRoom = -1

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

  private after (ms: number, fn: (...args: unknown[]) => void, ...args: unknown[]): void {
    this.timers.push(setTimeout(() => fn(...args), ms))
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
      this.buildMotor()
      this.buildConcourse()
      this.buildCut()
      this.buildAnnex()
      this.buildStacks()
      this.buildTurnback()
      this.buildChord()
      this.buildFormant()
      this.buildShimmer()
    }
    catch (e) {
      console.error('Loop Line audio init failed:', e)
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
   * One delay pair for all seven rooms, crossfaded rather than switched.
   *
   * A convolver per room would be better and is not affordable; seven delay
   * pairs would be affordable and would all have to be muted, which is seven
   * times the feedback loops ringing into nothing. Sweeping one pair means a
   * portal is a *transition* — the tile flutter of the platform stretching into
   * the cut's dead open air over the second or so it takes to pass through the
   * mouth — and that is better than what a switch would have given anyway.
   */
  private buildRoom (): void {
    if (!this.ctx || !this.masterLP)
      return

    const now = this.ctx.currentTime

    this.wet = this.ctx.createGain()
    this.wet.gain.setValueAtTime(0.45, now)

    this.tap = this.ctx.createDelay(0.5)
    this.tap.delayTime.setValueAtTime(ROOMS[0].time, now)

    this.tapDamp      = this.ctx.createBiquadFilter()
    this.tapDamp.type = 'lowpass'
    this.tapDamp.frequency.setValueAtTime(ROOMS[0].damp, now)

    this.tapFb = this.ctx.createGain()
    this.tapFb.gain.setValueAtTime(ROOMS[0].fb, now)

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

  // ---- bays: continuous layers --------------------------------------------

  /**
   * THE MOTOR. Three detuned sawtooth oscillators through a resonant lowpass,
   * pitch tracking speed. The Q on the filter is what makes it read as a
   * chopper drive rather than a synth: each harmonic is a little resonant peak
   * that moves with frequency, which is exactly what a DC-chopper inverter
   * sounds like.
   */
  private buildMotor (): void {
    if (!this.ctx || !this.dry)
      return

    const now      = this.ctx.currentTime
    this.motorGain = this.ctx.createGain()
    this.motorGain.gain.setValueAtTime(0.0, now)

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(600, now)
    lp.Q.setValueAtTime(5.0, now)

    for (const [ f, a ] of [[ 55, 1.0 ], [ 82, 0.38 ], [ 110, 0.18 ]]) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'sawtooth'
      osc.frequency.setValueAtTime(f, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(a, now)
      osc.connect(g)
      g.connect(lp)
      osc.start()
    }

    lp.connect(this.motorGain)
    this.motorGain.connect(this.dry)
  }

  /**
   * THE CONCOURSE. A dead-mall muzak chord — every voice detuned and drifting,
   * so the chord beats against itself rather than sounding played — plus an
   * escalator's mechanical rumble, which is a low sawtooth drone at a fixed
   * rate.
   */
  private buildConcourse (): void {
    if (!this.ctx || !this.dry)
      return

    const now      = this.ctx.currentTime
    this.muzakGain = this.ctx.createGain()
    this.muzakGain.gain.setValueAtTime(0.0, now)

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(1000, now)
    lp.Q.setValueAtTime(0.8, now)
    lp.connect(this.muzakGain)

    // F, A, B, E — wrong-sounding intervals that read as a muzak recording
    // that nobody has been in to change.
    for (const [ f, det ] of [[ 174.6, 0 ], [ 220.0, 8 ], [ 246.9, -6 ], [ 329.6, 12 ]]) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'triangle'
      osc.frequency.setValueAtTime(f, now)
      osc.detune.setValueAtTime(det, now)

      const wow = this.ctx.createOscillator()
      wow.frequency.setValueAtTime(0.21 + f * 0.0004, now)

      const wowAmt = this.ctx.createGain()
      wowAmt.gain.setValueAtTime(8.0, now)
      wow.connect(wowAmt)
      wowAmt.connect(osc.detune)
      wow.start()

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.18, now)
      osc.connect(g)
      g.connect(lp)
      osc.start()
    }

    // Escalator rumble — a fixed mechanical rate.
    const rumble = this.ctx.createOscillator()
    rumble.type  = 'sawtooth'
    rumble.frequency.setValueAtTime(38, now)

    const rumbleLP = this.ctx.createBiquadFilter()
    rumbleLP.type  = 'lowpass'
    rumbleLP.frequency.setValueAtTime(200, now)

    const rumbleG = this.ctx.createGain()
    rumbleG.gain.setValueAtTime(0.06, now)
    rumble.connect(rumbleLP)
    rumbleLP.connect(rumbleG)
    rumbleG.connect(this.muzakGain)
    rumble.start()

    this.muzakGain.connect(this.dry)
    this.muzakGain.connect(this.wet ?? this.dry)
  }

  /**
   * THE CUT. Open air: wind, distant traffic, no reverb tail. Birds stop
   * appearing after lap 2 — they were nesting in the cutting walls and they
   * are gone now.
   */
  private buildCut (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(700, now)
    lp.Q.setValueAtTime(0.6, now)

    this.windGain = this.ctx.createGain()
    this.windGain.gain.setValueAtTime(0.0, now)

    src.connect(lp)
    lp.connect(this.windGain)
    this.windGain.connect(this.dry)
    this.windGain.connect(this.wet ?? this.dry)
    src.start()

    this.scheduleBirds()
  }

  /**
   * THE ANNEX. Water — lapping and dripping, plus the motor heard through
   * liquid (heavy lowpass), and a splash whose rate tracks speed.
   */
  private buildAnnex (): void {
    if (!this.ctx || !this.dry)
      return

    const now      = this.ctx.currentTime
    this.waterGain = this.ctx.createGain()
    this.waterGain.gain.setValueAtTime(0.0, now)
    this.splashGain = this.ctx.createGain()
    this.splashGain.gain.setValueAtTime(0.0, now)

    // Lapping water: AM-modulated filtered noise.
    const water = this.noiseSource(true)
    if (water) {
      const waterBP = this.ctx.createBiquadFilter()
      waterBP.type  = 'bandpass'
      waterBP.frequency.setValueAtTime(400, now)
      waterBP.Q.setValueAtTime(1.2, now)

      const lfo = this.ctx.createOscillator()
      lfo.frequency.setValueAtTime(0.6, now)

      const lfoAmt = this.ctx.createGain()
      lfoAmt.gain.setValueAtTime(0.08, now)
      lfo.connect(lfoAmt)
      lfoAmt.connect(this.waterGain.gain)
      lfo.start()
      water.connect(waterBP)
      waterBP.connect(this.waterGain)
      water.start()
    }

    this.waterGain.connect(this.dry)
    this.waterGain.connect(this.wet ?? this.dry)
  }

  /**
   * THE STACKS. Fan-wall noise — several detuned bandpass-filtered noise
   * bands — plus coil whine and relay clicks.
   */
  private buildStacks (): void {
    if (!this.ctx || !this.dry)
      return

    const now    = this.ctx.currentTime
    this.fanGain = this.ctx.createGain()
    this.fanGain.gain.setValueAtTime(0.0, now)
    this.coilGain = this.ctx.createGain()
    this.coilGain.gain.setValueAtTime(0.0, now)
    this.relayGain = this.ctx.createGain()
    this.relayGain.gain.setValueAtTime(0.0, now)

    this.buildFanLayers()
    this.buildCoilWhine()
    this.buildRelayClicks()

    this.fanGain.connect(this.dry)
    this.fanGain.connect(this.wet ?? this.dry)
    this.coilGain.connect(this.dry)
    this.relayGain.connect(this.dry)
  }

  /**
   * THE TURNBACK. Almost nothing. Open void, a far-off wind, the rail joints
   * suddenly with no reflections at all. The absence should be conspicuous.
   */
  private buildTurnback (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(400, now)

    this.voidGain = this.ctx.createGain()
    this.voidGain.gain.setValueAtTime(0.0, now)

    src.connect(lp)
    lp.connect(this.voidGain)
    this.voidGain.connect(this.dry)
    src.start()
  }

  /**
   * THE CHORD. Extremely close, dead, dry brick. Heavy proximity — a narrow
   * bore is loud. No lamps means no hum. Should feel like the walls are
   * 30 cm away.
   */
  private buildChord (): void {
    if (!this.ctx || !this.dry)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    // Very tight resonant bandpass — a narrow bore amplifies the midrange.
    const bp = this.ctx.createBiquadFilter()
    bp.type  = 'bandpass'
    bp.frequency.setValueAtTime(350, now)
    bp.Q.setValueAtTime(4.0, now)

    this.boreGain = this.ctx.createGain()
    this.boreGain.gain.setValueAtTime(0.0, now)

    src.connect(bp)
    bp.connect(this.boreGain)
    this.boreGain.connect(this.dry)
    src.start()
  }

  // ---- sub-builders for THE STACKS ----------------------------------------

  private buildFanLayers (): void {
    if (!this.ctx || !this.fanGain)
      return

    const src = this.noiseSource(true)
    if (!src)
      return

    const now = this.ctx.currentTime

    for (const [ f, q ] of [[ 320, 3.0 ], [ 580, 4.5 ], [ 900, 2.8 ], [ 1400, 5.0 ]]) {
      const bp = this.ctx.createBiquadFilter()
      bp.type  = 'bandpass'
      bp.frequency.setValueAtTime(f, now)
      bp.Q.setValueAtTime(q, now)

      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.035, now)
      src.connect(bp)
      bp.connect(g)
      g.connect(this.fanGain)
    }
    src.start()
  }

  private buildCoilWhine (): void {
    if (!this.ctx || !this.coilGain)
      return

    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type  = 'triangle'
    osc.frequency.setValueAtTime(7800, now)

    const lfo = this.ctx.createOscillator()
    lfo.frequency.setValueAtTime(3.5, now)

    const lfoAmt = this.ctx.createGain()
    lfoAmt.gain.setValueAtTime(25, now)
    lfo.connect(lfoAmt)
    lfoAmt.connect(osc.frequency)
    lfo.start()
    osc.connect(this.coilGain)
    osc.start()
  }

  private buildRelayClicks (): void {
    if (!this.ctx || !this.relayGain)
      return

    const tick = () => {
      if (!this.ctx || !this.noiseBuffer || this.isMuted)
        return
      if (this.bay === 4) {
        const now  = this.ctx.currentTime
        const src  = this.ctx.createBufferSource()
        src.buffer = this.noiseBuffer

        const bp = this.ctx.createBiquadFilter()
        bp.type  = 'bandpass'
        bp.frequency.setValueAtTime(2200, now)
        bp.Q.setValueAtTime(12.0, now)

        const g = this.ctx.createGain()
        g.gain.setValueAtTime(0.0, now)
        g.gain.linearRampToValueAtTime(0.12, now + 0.001)
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.02)
        src.connect(bp)
        bp.connect(g)
        g.connect(this.relayGain!)
        src.start(now)
        src.stop(now + 0.05)
      }
      this.after(80 + Math.random() * 200, tick)
    }
    this.after(100, tick)
  }

  // ---- sub-builder for THE CUT -------------------------------------------

  private scheduleBirds (): void {
    const tick = () => {
      if (!this.ctx || this.isMuted || this.bay !== 2)
        return
      if (this.lapF < 2.0) {
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        osc.type  = 'sine'

        const base = 1800 + Math.random() * 1600
        osc.frequency.setValueAtTime(base, now)
        osc.frequency.linearRampToValueAtTime(base * 1.15, now + 0.04)
        osc.frequency.linearRampToValueAtTime(base * 0.88, now + 0.10)

        const g = this.ctx.createGain()
        g.gain.setValueAtTime(0.0, now)
        g.gain.linearRampToValueAtTime(0.015, now + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
        osc.connect(g)
        g.connect(this.dry!)
        osc.start(now)
        osc.stop(now + 0.15)
      }
      this.after(800 + Math.random() * 3500, tick)
    }
    this.after(500, tick)
  }

  // ---- formant announcement ------------------------------------------------

  /**
   * The formant chain: a pulse source through two bandpass filters tuned to
   * formant frequencies. The pulse is not a real glottal source — it is a
   * convenience: harmonics at every integer multiple of the fundamental, which
   * is exactly what the formants need to ring on.
   */
  private buildFormant (): void {
    if (!this.ctx || !this.dry)
      return

    const now = this.ctx.currentTime

    const src = this.ctx.createOscillator()
    src.type  = 'sawtooth'
    src.frequency.setValueAtTime(1, now)

    this.formantF1      = this.ctx.createBiquadFilter()
    this.formantF1.type = 'bandpass'
    this.formantF1.frequency.setValueAtTime(400, now)
    this.formantF1.Q.setValueAtTime(8.0, now)

    this.formantF2      = this.ctx.createBiquadFilter()
    this.formantF2.type = 'bandpass'
    this.formantF2.frequency.setValueAtTime(2200, now)
    this.formantF2.Q.setValueAtTime(12.0, now)

    this.formantMix = this.ctx.createGain()
    this.formantMix.gain.setValueAtTime(0.0, now)

    this.formantF1Gain = this.ctx.createGain()
    this.formantF1Gain.gain.setValueAtTime(0.55, now)
    this.formantF2Gain = this.ctx.createGain()
    this.formantF2Gain.gain.setValueAtTime(0.35, now)

    src.connect(this.formantF1)
    src.connect(this.formantF2)
    this.formantF1.connect(this.formantF1Gain)
    this.formantF2.connect(this.formantF2Gain)
    this.formantF1Gain.connect(this.formantMix)
    this.formantF2Gain.connect(this.formantMix)
    this.formantMix.connect(this.dry)
    this.formantMix.connect(this.wet ?? this.dry)
    src.start()

    // The door chime: a two-note descending interval, before each announcement.
    this.buildDoorChime()
  }

  private buildDoorChime (): void {
    if (!this.ctx || !this.dry)
      return
    this.chimeGain = this.ctx.createGain()
    this.chimeGain.gain.setValueAtTime(0.0, this.ctx.currentTime)
    this.chimeGain.connect(this.dry)
    this.chimeGain.connect(this.wet ?? this.dry)
  }

  /** Very short shimmer for the tunnel and the formant announcements. */
  private buildShimmer (): void {
    if (!this.ctx || !this.wet)
      return

    const now = this.ctx.currentTime
    const d   = this.ctx.createDelay(0.5)
    d.delayTime.setValueAtTime(0.042, now)

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.12, now)

    const lp = this.ctx.createBiquadFilter()
    lp.type  = 'lowpass'
    lp.frequency.setValueAtTime(4000, now)

    const bp = this.ctx.createBiquadFilter()
    bp.type  = 'bandpass'
    bp.frequency.setValueAtTime(2000, now)
    bp.Q.setValueAtTime(2.5, now)
    this.wet.connect(d)
    d.connect(g)
    g.connect(lp)
    lp.connect(bp)
    bp.connect(this.wet)
  }

  // ---- events -------------------------------------------------------------

  /**
   * One rail joint: two impacts a wheelbase apart, the second a touch softer.
   *
   * The click is a noise burst through a resonant bandpass rather than a
   * synthesised thump, because what you actually hear is not the impact — it is
   * the whole cart ringing afterwards, and a high-Q filter *is* a ringing.
   */
  private fireJoint (): void {
    if (!this.ctx || !this.wet || !this.dry)
      return

    const now  = this.ctx.currentTime
    const gap  = WHEELBASE / Math.max(this.speed, 1.0)
    const wear = clamp01(this.lapF * 0.35)

    for (let axle = 0; axle < 2; axle++) {
      const src = this.noiseSource(false)
      if (!src)
        return

      const at = now + axle * Math.min(gap, 0.4)

      const bp = this.ctx.createBiquadFilter()
      bp.type  = 'bandpass'
      bp.frequency.setValueAtTime(280 + wear * 400, at)
      bp.Q.setValueAtTime(3.2 + wear * 4.0, at)

      const ring = this.ctx.createBiquadFilter()
      ring.type  = 'bandpass'
      ring.frequency.setValueAtTime(1500 + wear * 1200, at)
      ring.Q.setValueAtTime(14.0 + wear * 10.0, at)

      const g   = (0.035 + wear * 0.16) * (axle === 0 ? 1.0 : 0.72)
      const env = this.ctx.createGain()
      env.gain.setValueAtTime(0.0, at)
      env.gain.linearRampToValueAtTime(g, at + 0.004)
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.11)

      src.connect(bp)
      bp.connect(env)
      src.connect(ring)
      ring.connect(env)
      env.connect(this.dry)
      env.connect(this.wet)
      src.start(at)
      src.stop(at + 0.18)
    }
  }

  /** One formant syllable. Pitch and duration are syllable-specific. */
  private fireSyllable (pitch: number, duration: number): void {
    if (!this.ctx || !this.formantMix)
      return

    const now = this.ctx.currentTime
    const f1  = 380 + pitch * 0.25
    const f2  = 1800 + pitch * 2.2
    this.formantF1?.frequency.setValueAtTime(f1, now)
    this.formantF2?.frequency.setValueAtTime(f2, now)
    this.formantMix.gain.setValueAtTime(0.0, now)
    this.formantMix.gain.linearRampToValueAtTime(0.14, now + 0.012)
    this.formantMix.gain.setValueAtTime(0.14, now + duration - 0.02)
    this.formantMix.gain.linearRampToValueAtTime(0.0, now + duration)
  }

  /** The two-note door chime before each announcement. */
  private fireDoorChime (): void {
    if (!this.ctx || !this.chimeGain)
      return

    const now = this.ctx.currentTime
    this.chimeGain.gain.setValueAtTime(0.0, now)

    const notes = [ 698.5, 523.3 ]
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator()
      osc.type  = 'sine'
      osc.frequency.setValueAtTime(notes[i], now + i * 0.18)

      const env = this.ctx.createGain()
      env.gain.setValueAtTime(0.0, now + i * 0.18)
      env.gain.linearRampToValueAtTime(0.10, now + i * 0.18 + 0.008)
      env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35)
      osc.connect(env)
      env.connect(this.chimeGain)
      osc.start(now + i * 0.18)
      osc.stop(now + i * 0.18 + 0.4)
    }
  }

  /**
   * Fire a full announcement for the current bay. The degradation pipeline:
   *   lap 0-1  — intact, original order
   *   lap 1-2  — one syllable randomly dropped
   *   lap 2-3  — syllables shuffled, two dropped
   *   lap 3+   — all shuffled, three dropped, pitch drifts flat
   */
  private fireAnnouncement (): void {
    if (!this.ctx || this.bay < 0 || this.bay > 6)
      return

    const pattern = SYLLABLES[this.bay]
    const lap     = Math.floor(this.lapF)

    // Deterministic shuffle seeded on (bay, lap).
    const indices = pattern.map((_, i) => i)
    const seed    = this.bay * 31 + lap * 7
    for (let i = indices.length - 1; i > 0; i--) {
      const j    = Math.floor((Math.sin(seed * (i + 1) * 0.7 + i) * 0.5 + 0.5) * (i + 1)) % (i + 1)
      const tmp  = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
    }

    // Drop syllables as the lap rises.
    const keep = lap < 1
      ? pattern.length
      : lap < 2
        ? pattern.length - 1
        : lap < 3
          ? Math.max(2, pattern.length - 2)
          : Math.max(2, pattern.length - 3)

    const pitchDrift = lap >= 3 ? 1.0 - clamp01((lap - 3) * 0.15) : 1.0

    // Door chime, then the syllables.
    this.fireDoorChime()

    const chimeDuration = 0.4
    let t = chimeDuration
    for (let i = 0; i < keep; i++) {
      const idx            = indices[i]
      const [ pitch, dur ] = pattern[idx]
      this.after(t * 1000, (p, d) => this.fireSyllable(p as number, d as number), pitch * pitchDrift, dur)
      t += dur + 0.03
    }
  }

  // ---- helpers ------------------------------------------------------------

  private ramp (
    param: AudioParam | undefined,
    value: number,
    now:   number,
    _key:  'motorGain' | 'muzakGain' | 'windGain' | 'waterGain' | 'splashGain' |
      'fanGain' | 'coilGain' | 'relayGain' | 'voidGain' | 'boreGain',
  ): void {
    if (!param)
      return
    param.setTargetAtTime(value, now, GLIDE)
  }

  /**
   * Crossfade the delay pair toward the current bay's tail.
   *
   * Only touched when the bay actually changes — setting a delay time every
   * frame retunes the feedback loop at 60 Hz and turns a reverb into a chorus.
   */
  private crossfadeRoom (now: number): void {
    if (this.bay === this.lastRoom)
      return

    const i       = Math.max(0, Math.min(ROOMS.length - 1, this.bay))
    const r       = ROOMS[i]
    this.lastRoom = this.bay

    this.tap?.delayTime.setTargetAtTime(r.time, now, ROOM_GLIDE)
    this.tail?.delayTime.setTargetAtTime(r.time * 3.7, now, ROOM_GLIDE)
    this.tapFb?.gain.setTargetAtTime(r.fb, now, ROOM_GLIDE)
    this.tailFb?.gain.setTargetAtTime(r.fb * 0.8, now, ROOM_GLIDE)
    this.tapDamp?.frequency.setTargetAtTime(r.damp, now, ROOM_GLIDE)
    this.wet?.gain.setTargetAtTime(r.wet, now, ROOM_GLIDE)
  }

  // ---- per-frame ----------------------------------------------------------

  public update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.isMuted || !state)
      return

    const ride  = state.uRide as number[] | undefined
    const decay = state.uDecay as number[] | undefined
    const loop  = state.uLoop as number[] | undefined
    if (!ride || !decay || !loop)
      return

    const now = this.ctx.currentTime

    this.speed = ride[0]
    this.lapF  = ride[1]
    this.shake = ride[2]
    this.bay   = Math.round(loop[3])

    // --- joints, off distance ---
    //
    // `uLoop[1]` is total metres travelled. The number of joints between one
    // frame and the next is how far it moved divided by JOINT_PITCH. Capped at
    // MAX_JOINTS per frame so a backgrounded tab does not come back and fire
    // ten thousand at once.
    const targetTravel = loop[1]
    let delta = targetTravel - this.travel
    if (delta < 0)
      delta = 0
    this.travel = targetTravel

    let fired = 0
    while (delta >= JOINT_PITCH && fired < MAX_JOINTS) {
      delta -= JOINT_PITCH
      this.fireJoint()
      fired++
    }

    // --- bay change: announcement + reverb crossfade ---
    if (this.bay !== this.lastBay) {
      this.lastBay = this.bay
      this.fireAnnouncement()
    }
    this.crossfadeRoom(now)

    // --- continuous layers ---

    // Motor: pitch and filter track speed.
    this.ramp(this.motorGain?.gain, 0.04 + Math.min(this.speed / 20, 1.0) * 0.14, now, 'motorGain')

    // Concourse muzak.
    this.ramp(this.muzakGain?.gain, this.bay === 1 ? 0.045 : 0.0, now, 'muzakGain')

    // Wind in the cut — open air.
    const cutFactor = this.bay === 2 ? 1.0 : 0.0
    this.ramp(this.windGain?.gain, cutFactor * 0.06 * Math.min(this.speed / 18, 1.0), now, 'windGain')

    // Water in the annex — lapping rate tracks speed.
    this.ramp(this.waterGain?.gain, this.bay === 3 ? 0.08 : 0.0, now, 'waterGain')

    // Splash in the annex — rate tracks speed.
    const splashRate = this.bay === 3 ? Math.min(this.speed / 18, 1.0) * 0.05 : 0.0
    this.ramp(this.splashGain?.gain, splashRate, now, 'splashGain')

    // Fan walls in the stacks.
    this.ramp(this.fanGain?.gain, this.bay === 4 ? 0.055 : 0.0, now, 'fanGain')

    // Coil whine in the stacks.
    this.ramp(this.coilGain?.gain, this.bay === 4 ? 0.025 : 0.0, now, 'coilGain')

    // Relay clicks in the stacks — driven by schedule, just gate the gain.
    this.ramp(this.relayGain?.gain, this.bay === 4 ? 1.0 : 0.0, now, 'relayGain')

    // Void — almost nothing on the trestle.
    this.ramp(this.voidGain?.gain, this.bay === 5 ? 0.018 : 0.0, now, 'voidGain')

    // Bore — narrow, close, dry brick.
    this.ramp(this.boreGain?.gain, this.bay === 6 ? 0.10 : 0.0, now, 'boreGain')

    // --- master degradation ---
    //
    // The laps take the top off everything. Not a duck and not a fade — the
    // building is simply further away every time round, and by the third lap
    // you are listening to it through a wall.
    const age = Math.min(this.lapF * 0.22, 0.62)
    this.masterLP?.frequency.setTargetAtTime(18000 * Math.pow(0.16, age), now, GLIDE)
    this.wet?.gain.setTargetAtTime(0.45 + age * 0.50, now, GLIDE)

    // Power-cut dropouts gated on uDecay[1] (lightFail).
    if (decay[1] > 0.05 && Math.sin(this.lapF * 47.3) > 0.98 - decay[1] * 0.15) {
      const duck = 0.15 + decay[1] * 0.25
      this.main?.gain.setTargetAtTime(duck, now, 0.01)
      this.after(120, () => {
        if (this.ctx && this.main)
          this.main.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.04)
      })
    }

    // Emit splash events — rate tracks speed.
    if (this.bay === 3 && this.splashGain) {
      const splashInterval = Math.max(100, 800 - this.speed * 30)
      if (Math.random() < this.speed / 18 * 0.08)
        this.fireSplash()
    }
  }

  /** One water splash — a short burst of filtered noise. */
  private fireSplash (): void {
    if (!this.ctx || !this.dry || !this.noiseBuffer)
      return

    const now  = this.ctx.currentTime
    const src  = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    const bp = this.ctx.createBiquadFilter()
    bp.type  = 'bandpass'
    bp.frequency.setValueAtTime(600 + Math.random() * 400, now)
    bp.Q.setValueAtTime(2.0, now)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0, now)
    env.gain.linearRampToValueAtTime(0.04, now + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
    src.connect(bp)
    bp.connect(env)
    env.connect(this.dry)
    env.connect(this.wet ?? this.dry)
    src.start(now)
    src.stop(now + 0.1)
  }

  // ---- formant engine -----------------------------------------------------

  private formantF1:     BiquadFilterNode | null = null
  private formantF2:     BiquadFilterNode | null = null
  private formantF1Gain: GainNode | null = null
  private formantF2Gain: GainNode | null = null
  private formantMix:    GainNode | null = null
  private chimeGain:     GainNode | null = null
}


export function createLoopLineAudio (): LoopLineAudioEngine {
  return new LoopLineAudioEngine()
}
