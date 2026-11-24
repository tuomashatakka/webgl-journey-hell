import { JourneyAudio } from '@wjh/audio/engine'
import { createRoomReverb } from '@wjh/audio/room'
import type { RoomReverb } from '@wjh/audio/room'
import { FLUME, getRoute } from './route'
import { momentAt } from './timeline'


// Each act's room: the hum under it, the colour of its air, how it rings.
const SCORE = {
  pool:       { tone: 77, air: 460, gain: 0.1, room: { time: 0.081, fb: 0.54, damp: 3800, wet: 0.36 }},
  annex:      { tone: 117, air: 160, gain: 0.08, room: { time: 0.026, fb: 0.17, damp: 1750, wet: 0.14 }},
  spiral:     { tone: 52, air: 380, gain: 0.14, room: { time: 0.06, fb: 0.3, damp: 2200, wet: 0.22 }},
  breakwater: { tone: 34, air: 520, gain: 0.26, room: { time: 0.18, fb: 0.24, damp: 830, wet: 0.16 }},
  lounge:     { tone: 54, air: 90, gain: 0.18, room: { time: 0.12, fb: 0.57, damp: 540, wet: 0.38 }},
  carousel:   { tone: 95, air: 300, gain: 0.11, room: { time: 0.052, fb: 0.3, damp: 2700, wet: 0.24 }},
} as const

class StillwaterAudio extends JourneyAudio {
  private room:      RoomReverb | null = null
  private hum:       OscillatorNode | null = null
  private humGain:   GainNode | null = null
  private air:       BiquadFilterNode | null = null
  private airGain:   GainNode | null = null
  private rush:      BiquadFilterNode | null = null
  private rushGain:  GainNode | null = null
  private previousS = -1
  private previousSection = -1

  protected readonly name = 'Stillwater Service'
  protected readonly bus = true

  protected build (): void {
    const { ctx, dry, masterLP } = this
    if (!ctx || !dry || !masterLP)
      return

    const noise             = this.noiseSource(true)
    this.room               = createRoomReverb(ctx, masterLP, SCORE.pool.room, 0.22)
    this.hum                = ctx.createOscillator()
    this.hum.type           = 'triangle'
    this.humGain            = ctx.createGain()
    this.humGain.gain.value = 0
    this.hum.connect(this.humGain).connect(dry)
    this.humGain.connect(this.room.wet)
    this.hum.start()

    // The sea and the room's air, and the water running under the rider.
    this.air                 = ctx.createBiquadFilter()
    this.air.type            = 'bandpass'
    this.air.Q.value         = 0.58
    this.airGain             = ctx.createGain()
    this.airGain.gain.value  = 0
    this.air.connect(this.airGain).connect(dry)
    this.airGain.connect(this.room.wet)
    this.rush                = ctx.createBiquadFilter()
    this.rush.type           = 'bandpass'
    this.rush.Q.value        = 1.4
    this.rushGain            = ctx.createGain()
    this.rushGain.gain.value = 0
    this.rush.connect(this.rushGain).connect(dry)
    this.rushGain.connect(this.room.wet)
    noise?.connect(this.air)
    noise?.connect(this.rush)
    noise?.start()
  }

  public update (time: number): void {
    const { ctx, dry, room } = this
    if (!ctx || !dry || !room || this.isMuted || this.isPaused)
      return

    const cue    = momentAt(time)
    const patch  = SCORE[cue.id]
    const now    = ctx.currentTime
    const { s, v } = getRoute().travel(cue.within, cue.lap)
    const swell  = cue.id === 'breakwater' ? 0.69 + 0.31 * Math.sin(cue.local * 0.79 - 0.61) : 1
    const signal = Math.exp(-cue.signalAge * 0.36)
    if (cue.section !== this.previousSection)
      room.tune(patch.room, now, 0.6)

    this.hum?.frequency.setTargetAtTime(patch.tone * (1 - cue.warp * 0.08) - cue.lap * 3, now, 0.4)
    this.humGain?.gain.setTargetAtTime((0.012 + patch.gain * 0.3) * signal, now, 0.5)
    this.air?.frequency.setTargetAtTime(patch.air, now, 0.5)
    this.airGain?.gain.setTargetAtTime(swell * patch.gain * signal, now, 0.5)
    this.rush?.frequency.setTargetAtTime(600 + v * 260, now, 0.2)
    this.rushGain?.gain.setTargetAtTime(Math.min(0.2, v * 0.035) * signal, now, 0.2)
    this.masterLP?.frequency.setTargetAtTime(cue.id === 'lounge' ? 900 : 9500 - cue.lap * 1900, now, 0.6)

    // A knock at every flange joint the rider slides over.
    const joint = Math.floor(s / FLUME.flange)
    if (this.previousS >= 0 && s > this.previousS && s - this.previousS < 6 && !cue.terminal &&
        joint !== Math.floor(this.previousS / FLUME.flange))
      this.noiseHit({
        bands:  [{ f: 180 + v * 40, q: 2.2 }],
        peak:   0.09 * signal,
        attack: 0.006,
        decay:  0.07,
        stop:   0.12,
        to:     [ dry, room.wet ],
      })
    this.previousS       = s
    this.previousSection = cue.section
  }
}

export function createStillwaterAudio () {
  return new StillwaterAudio()
}
