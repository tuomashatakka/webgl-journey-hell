import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'


function scalar (state: CustomUniforms | undefined, name: string): number {
  const value = state?.[name]
  return typeof value === 'number' ? value : 0
}

function audioTargets (section: number, rupture: number, finale: number) {
  let wind = 0.24 + rupture * 0.18
  if (section === 1)
    wind = 0.72
  else if (section === 4)
    wind = 0.48

  let machine = 0.18
  if (section === 2 || section === 3)
    machine = 0.5
  else if (section === 0)
    machine = 0.32

  return { finale, machine, wind }
}

class StairwellAudioEngine implements JourneyAudioEngine {
  private ctx:         AudioContext | null = null
  private muted = true
  private master:      GainNode | null = null
  private wind:        GainNode | null = null
  private machine:     GainNode | null = null
  private impact:      GainNode | null = null
  private lowOsc:      OscillatorNode | null = null
  private motorOsc:    OscillatorNode | null = null
  private pulseOsc:    OscillatorNode | null = null
  private impactTimer: ReturnType<typeof setTimeout> | null = null

  toggleMute (): boolean {
    if (!this.ctx)
      this.initialize()
    this.muted = !this.muted
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.78, this.ctx.currentTime, 0.08)
    return this.muted
  }

  update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.muted)
      return

    const section = scalar(state, 'uSection')
    const rupture = scalar(state, 'uRupture')
    const finale  = scalar(state, 'uFinale')
    const now     = this.ctx.currentTime
    const targets = audioTargets(section, rupture, finale)

    this.wind?.gain.setTargetAtTime(targets.wind, now, 0.7)
    this.machine?.gain.setTargetAtTime(targets.machine, now, 0.45)
    this.impact?.gain.setTargetAtTime(section === 3 ? 0.7 : 0.22 + finale * 0.55, now, 0.35)
    this.lowOsc?.frequency.setTargetAtTime(34 + section * 4 - finale * 15, now, 0.8)
    this.motorOsc?.frequency.setTargetAtTime(58 + section * 13 + rupture * 9, now, 0.5)
    this.pulseOsc?.frequency.setTargetAtTime(0.7 + section * 0.18 + finale * 2.2, now, 0.4)
  }

  destroy (): void {
    if (this.impactTimer)
      clearTimeout(this.impactTimer)
    void this.ctx?.close()
    this.ctx = null
  }

  private initialize (): void {
    const AudioCtx = window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx)
      return

    this.ctx               = new AudioCtx()
    this.master            = this.ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(this.ctx.destination)

    const compressor           = this.ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.ratio.value     = 5
    compressor.connect(this.master)

    this.wind    = this.createWind(compressor)
    this.machine = this.ctx.createGain()
    this.impact  = this.ctx.createGain()
    this.machine.connect(compressor)
    this.impact.connect(compressor)
    this.createTonalBed(compressor)
    this.scheduleImpact()
  }

  private createTonalBed (destination: AudioNode): void {
    const ctx              = this.ctx!
    const machine          = this.machine!
    const lowOsc           = ctx.createOscillator()
    lowOsc.type            = 'sine'
    lowOsc.frequency.value = 34

    const lowGain      = ctx.createGain()
    lowGain.gain.value = 0.18
    lowOsc.connect(lowGain)
    lowGain.connect(destination)
    lowOsc.start()

    const motorOsc           = ctx.createOscillator()
    motorOsc.type            = 'sawtooth'
    motorOsc.frequency.value = 58

    const motorFilter           = ctx.createBiquadFilter()
    motorFilter.type            = 'lowpass'
    motorFilter.frequency.value = 210
    motorOsc.connect(motorFilter)
    motorFilter.connect(machine)
    motorOsc.start()

    const pulseOsc           = ctx.createOscillator()
    pulseOsc.type            = 'sine'
    pulseOsc.frequency.value = 0.7

    const pulseDepth      = ctx.createGain()
    pulseDepth.gain.value = 0.16
    pulseOsc.connect(pulseDepth)
    pulseDepth.connect(machine.gain)
    pulseOsc.start()

    this.lowOsc   = lowOsc
    this.motorOsc = motorOsc
    this.pulseOsc = pulseOsc
  }

  private createWind (destination: AudioNode): GainNode {
    const ctx    = this.ctx!
    const length = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data   = buffer.getChannelData(0)
    let brown = 0
    for (let i = 0; i < length; i++) {
      brown = (brown + 0.025 * (Math.random() * 2 - 1)) / 1.025
      data[i] = brown * 3.4
    }

    const source           = ctx.createBufferSource()
    const filter           = ctx.createBiquadFilter()
    const gain             = ctx.createGain()
    source.buffer          = buffer
    source.loop            = true
    filter.type            = 'bandpass'
    filter.frequency.value = 280
    filter.Q.value         = 0.65
    gain.gain.value        = 0.25
    source.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    source.start()
    return gain
  }

  private scheduleImpact (): void {
    const strike = () => {
      if (this.ctx && !this.muted && this.impact) {
        const osc  = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        const now  = this.ctx.currentTime
        osc.type   = 'triangle'
        osc.frequency.setValueAtTime(74 + Math.random() * 120, now)
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.6)
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.28, now + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
        osc.connect(gain)
        gain.connect(this.impact)
        osc.start(now)
        osc.stop(now + 1.3)
      }
      this.impactTimer = setTimeout(strike, 1400 + Math.random() * 3200)
    }
    strike()
  }
}

export function createStairwellAudio (): JourneyAudioEngine {
  return new StairwellAudioEngine()
}

// perf: medium web-audio graph; three persistent oscillators and one looping noise buffer.
