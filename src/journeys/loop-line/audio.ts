'use client'

// THE LOOP LINE — soundtrack.
//
// Built lazily on the first unmute by the journey shell, which then calls
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
//    stops a backgrounded tab from firing ten thousand at once on return.
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

import { createRoomReverb } from '@wjh/audio/room'
import type { RoomReverb } from '@wjh/audio/room'
import { JourneyAudio } from '@wjh/audio/engine'
import type { CustomUniforms } from '@wjh/gl/uniforms'
import { clamp01 } from '@wjh/math/scalar'
import { birdChirp, doorChime, planAnnouncement, relayClick, splash, syllable } from './audio/events'
import { GLIDE, buildBore, buildConcourse, buildFormant, buildMotor, buildShimmer, buildStacks, buildVoid, buildWater, buildWind } from './audio/layers'
import type { FormantVoice } from './audio/layers'
import { JOINT_PITCH, MAX_JOINTS, ROOMS, WHEELBASE } from './audio/patches'


const BAY_LAYER_NAMES: readonly BayLayer[] = [ 'muzak', 'wind', 'water', 'splash', 'fan', 'coil', 'relay', 'void', 'bore' ]

/** Layer gain by bay, as a function of speed: concourse muzak, cut wind, annex water and splash, stacks fans, coil and relays, void, bore. */
const BAY_LAYERS: Record<number, Partial<Record<BayLayer, (speed: number) => number>>> = {
  1: { muzak: () => 0.045 },
  2: { wind: speed => 0.06 * Math.min(speed / 18, 1) },
  3: { water: () => 0.08, splash: speed => Math.min(speed / 18, 1) * 0.05 },
  4: { fan: () => 0.055, coil: () => 0.025, relay: () => 1 },
  5: { void: () => 0.018 },
  6: { bore: () => 0.1 },
}

const ROOM_GLIDE = 0.3

/** Glide for the room crossfade, which happens at a portal and should be quick. */
type BayLayer = 'muzak' | 'wind' | 'water' | 'splash' | 'fan' | 'coil' | 'relay' | 'void' | 'bore'

/**
 * The engine: it owns the nodes the layers return and the per-frame state, and
 * drives them from the shader's uniforms. What each voice is made of is in
 * `audio/layers`, the one-shots in `audio/events`, the data in `audio/patches`.
 */
export class LoopLineAudioEngine extends JourneyAudio {
  private room: RoomReverb | null = null
  private wet:  GainNode | null = null


  private motorGain: GainNode | null = null
  private muzakGain: GainNode | null = null

  private windGain:   GainNode | null = null
  private waterGain:  GainNode | null = null
  private splashGain: GainNode | null = null
  private fanGain:    GainNode | null = null
  private coilGain:   GainNode | null = null
  private relayGain:  GainNode | null = null
  private voidGain:   GainNode | null = null
  private boreGain:   GainNode | null = null
  private formant:    FormantVoice | null = null
  // Driven from the shader uniforms each frame.
  private speed = 0
  private lapF = 0


  private bay = -1
  private travel = 0
  private lastBay = -1
  // Reverb crossfade state — only touched on bay change.
  private lastRoom = -1
  protected readonly name = 'Loop Line'

  protected readonly bus = true


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

    this.room = createRoomReverb(this.ctx, this.masterLP, ROOMS[0], 0.45)
    this.wet  = this.room.wet
  }

  /**
   * THE CUT: wind, and the birds. Birds stop appearing after lap 2 — they were
   * nesting in the cutting walls and they are gone now.
   */
  private buildCut (ctx: AudioContext, dry: AudioNode, wet: AudioNode): void {
    const src = this.noiseSource(true)
    if (!src)
      return

    this.windGain = buildWind(ctx, dry, wet, src)
    this.scheduleBirds()
  }

  // ---- scheduled one-shots --------------------------------------------------

  private scheduleRelayClicks (): void {
    const tick = () => {
      if (!this.ctx || !this.noiseBuffer || this.isMuted)
        return
      if (this.bay === 4 && this.relayGain)
        relayClick(this.ctx, this.noiseBuffer, this.relayGain)
      this.after(80 + Math.random() * 200, tick)
    }
    this.after(100, tick)
  }

  private scheduleBirds (): void {
    const tick = () => {
      if (!this.ctx || this.isMuted || this.bay !== 2)
        return
      if (this.lapF < 2 && this.dry)
        birdChirp(this.ctx, this.dry)
      this.after(800 + Math.random() * 3500, tick)
    }
    this.after(500, tick)
  }

  // ---- events -------------------------------------------------------------

  /** One rail joint, ringing harder as the laps wear the line down. */
  private fireJoint (): void {
    if (!this.ctx || !this.wet || !this.dry)
      return

    const wear = clamp01(this.lapF * 0.35)
    this.railJoint({
      gap:   WHEELBASE / Math.max(this.speed, 1),
      level: 0.035 + wear * 0.16,
      body:  () => ({ f: 280 + wear * 400, q: 3.2 + wear * 4 }),
      ring:  () => ({ f: 1500 + wear * 1200, q: 14 + wear * 10 }),
      decay: 0.11,
      stop:  0.18,
      to:    [ this.dry, this.wet ],
    })
  }

  /** The door chime, then the bay's syllables, as many and in whatever order this lap leaves. */
  private fireAnnouncement (): void {
    if (!this.ctx || this.bay < 0 || this.bay > 6)
      return

    if (this.formant)
      doorChime(this.ctx, this.formant.chime)
    for (const { pitch, duration, at } of planAnnouncement(this.bay, this.lapF))
      this.after(at * 1000, () => {
        if (this.ctx && this.formant)
          syllable(this.ctx, this.formant, pitch, duration)
      })
  }

  // ---- helpers ------------------------------------------------------------

  private ramp (param: AudioParam | undefined, value: number, now: number): void {
    param?.setTargetAtTime(value, now, GLIDE)
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
    this.lastRoom = this.bay

    this.room?.tune(ROOMS[i], now, ROOM_GLIDE)
  }

  // ---- per-frame ----------------------------------------------------------

  /** The continuous layers: the motor always, the rest only in the bay they belong to. */
  private updateBayLayers (now: number): void {
    const speed = this.speed
    this.ramp(this.motorGain?.gain, 0.04 + Math.min(speed / 20, 1) * 0.14, now)

    const open = BAY_LAYERS[this.bay] ?? {}
    for (const layer of BAY_LAYER_NAMES)
      this.ramp(this[`${layer}Gain`]?.gain, open[layer]?.(speed) ?? 0, now)
  }

  // ---- per-frame ----------------------------------------------------------

  /** Master degradation by lap, and the power-cut dropouts gated on `lightFail`. */
  private degrade (now: number, lightFail: number): void {
    // --- master degradation ---
    //
    // The laps take the top off everything. Not a duck and not a fade — the
    // building is simply further away every time round, and by the third lap
    // you are listening to it through a wall.
    const age = Math.min(this.lapF * 0.22, 0.62)
    this.masterLP?.frequency.setTargetAtTime(18000 * Math.pow(0.16, age), now, GLIDE)
    this.wet?.gain.setTargetAtTime(0.45 + age * 0.5, now, GLIDE)

    // Power-cut dropouts gated on uDecay[1] (lightFail).
    if (lightFail > 0.05 && Math.sin(this.lapF * 47.3) > 0.98 - lightFail * 0.15) {
      const duck = 0.15 + lightFail * 0.25
      this.main?.gain.setTargetAtTime(duck, now, 0.01)
      this.after(120, () => {
        if (this.ctx && this.main)
          this.main.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.04)
      })
    }
  }

  /** Splash events in the annex, their rate tracking speed. */
  private emitSplash (): void {
    // Emit splash events — rate tracks speed.
    if (this.bay === 3 && this.splashGain) {
      if (Math.random() < this.speed / 18 * 0.08 && this.ctx && this.dry && this.noiseBuffer)
        splash(this.ctx, this.noiseBuffer, this.dry, this.wet ?? this.dry)
    }
  }

  protected build (): void {
    const { ctx, dry } = this
    if (!ctx || !dry)
      return

    this.buildRoom()

    // Where a voice's tail goes: the room's wet bus once it exists.
    const wet = this.wet ?? dry

    this.motorGain = buildMotor(ctx, dry)
    this.muzakGain = buildConcourse(ctx, dry, wet)
    this.buildCut(ctx, dry, wet)

    const water     = buildWater(ctx, dry, wet, this.noiseSource(true))
    this.waterGain  = water.water
    this.splashGain = water.splash

    const stacks   = buildStacks(ctx, dry, wet, this.noiseSource(true))
    this.fanGain   = stacks.fan
    this.coilGain  = stacks.coil
    this.relayGain = stacks.relay
    this.scheduleRelayClicks()

    const turnback = this.noiseSource(true)
    if (turnback)
      this.voidGain = buildVoid(ctx, dry, turnback)

    const bore = this.noiseSource(true)
    if (bore)
      this.boreGain = buildBore(ctx, dry, bore)

    this.formant = buildFormant(ctx, dry, wet)
    if (this.wet)
      buildShimmer(ctx, this.wet)
  }

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

    this.updateBayLayers(now)

    this.degrade(now, decay[1])
    this.emitSplash()
  }
}

export function createLoopLineAudio (): LoopLineAudioEngine {
  return new LoopLineAudioEngine()
}
