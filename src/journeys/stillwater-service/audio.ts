import { JourneyAudio } from '@wjh/audio/engine'
import { createRoomReverb } from '@wjh/audio/room'
import type { RoomReverb } from '@wjh/audio/room'
import { momentAt } from './timeline'


const SCORE = {
  pool:       { tone: 77, noise: 460, gain: 0.1, pulse: 1.72, room: { time: 0.081, fb: 0.54, damp: 3800, wet: 0.33 }},
  annex:      { tone: 117, noise: 110, gain: 0.095, pulse: 1.62, room: { time: 0.026, fb: 0.17, damp: 1750, wet: 0.15 }},
  lift:       { tone: 48, noise: 240, gain: 0.16, pulse: 2.8, room: { time: 0.064, fb: 0.35, damp: 1450, wet: 0.29 }},
  breakwater: { tone: 34, noise: 590, gain: 0.3, pulse: 1.72, room: { time: 0.18, fb: 0.28, damp: 830, wet: 0.17 }},
  lounge:     { tone: 54, noise: 82, gain: 0.19, pulse: 0, room: { time: 0.12, fb: 0.57, damp: 540, wet: 0.38 }},
  carousel:   { tone: 95, noise: 385, gain: 0.12, pulse: 0.98, room: { time: 0.052, fb: 0.26, damp: 2700, wet: 0.22 }},
} as const

class StillwaterAudio extends JourneyAudio {
  private room:      RoomReverb | null = null
  private motor:     OscillatorNode | null = null
  private motorGain: GainNode | null = null
  private wind:      BiquadFilterNode | null = null
  private windGain:  GainNode | null = null
  private previousTime = -1
  private previousSection = -1

  protected readonly name = 'Stillwater Service'
  protected readonly bus = true

  protected build (): void {
    const { ctx, dry, masterLP } = this
    if (!ctx || !dry || !masterLP)
      return

    const noise               = this.noiseSource(true)
    this.room                 = createRoomReverb(ctx, masterLP, SCORE.pool.room, 0.22)
    this.motor                = ctx.createOscillator()
    this.motor.type           = 'triangle'
    this.motorGain            = ctx.createGain()
    this.motorGain.gain.value = 0
    this.motor.connect(this.motorGain).connect(dry)
    this.motorGain.connect(this.room.wet)
    this.motor.start()

    this.wind                = ctx.createBiquadFilter()
    this.wind.type           = 'bandpass'
    this.wind.Q.value        = 0.58
    this.windGain            = ctx.createGain()
    this.windGain.gain.value = 0
    this.wind.connect(this.windGain).connect(dry)
    this.windGain.connect(this.room.wet)
    noise?.connect(this.wind)
    noise?.start()
  }

  public update (time: number): void {
    const { ctx, dry, room } = this
    if (!ctx || !dry || !room || this.isMuted || this.isPaused)
      return

    const cue     = momentAt(time)
    const patch   = SCORE[cue.id]
    const now     = ctx.currentTime
    const delta   = time - this.previousTime
    const wind    = cue.id === 'breakwater' ? 0.69 + 0.31 * Math.sin(cue.local * 0.79 - 0.61) : 1
    const sweep   = cue.id === 'lift' ? 26 * (1 - cue.phase) : 0
    const signal  = Math.exp(-cue.signalAge * 0.36)
    const shutter = 1 - cue.shutter * 0.68
    if (cue.section !== this.previousSection)
      room.tune(patch.room, now, 0.18)

    this.motor?.frequency.setTargetAtTime(patch.tone + sweep - cue.lap * 3, now, 0.12)
    this.motorGain?.gain.setTargetAtTime((0.018 + patch.gain * 0.36) * shutter * signal, now, 0.13)
    this.wind?.frequency.setTargetAtTime(patch.noise, now, 0.17)
    this.windGain?.gain.setTargetAtTime(wind * patch.gain * shutter * signal, now, 0.12)
    this.masterLP?.frequency.setTargetAtTime(cue.id === 'lounge' ? 720 : 9500 - cue.lap * 1900, now, 0.17)

    const pulse = Math.floor(cue.local * patch.pulse)
    if (delta > 0 && delta < 0.4 && cue.section === this.previousSection && !cue.terminal &&
        pulse !== Math.floor((cue.local - delta) * patch.pulse))
      this.noiseHit({
        bands:  [{ f: cue.id === 'lift' ? 1460 : patch.noise * 1.8, q: cue.id === 'annex' ? 0.6 : 2.9 }],
        peak:   0.13 * shutter,
        attack: 0.012,
        decay:  0.082,
        stop:   0.13,
        to:     [ dry, room.wet ],
      })
    this.previousTime    = time
    this.previousSection = cue.section
  }
}

export function createStillwaterAudio () {
  return new StillwaterAudio()
}
