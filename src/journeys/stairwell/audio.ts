import type { JourneyAudioEngine } from '@wjh/journey/types'
import { JourneyAudio } from '@wjh/audio/engine'
import { brownNoise } from '@wjh/audio/nodes'
import { scalar } from '@wjh/gl/uniforms'
import type { CustomUniforms } from '@wjh/gl/uniforms'


function audioTargets (section: number, rupture: number, finale: number, purgatory: number) {
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

  // The residue takes the weather and the machinery with it. What is left is
  // the sub — purgatory has nothing in it that could be making a noise, so
  // fading these rather than substituting something is the honest mix.
  const alive = 1 - purgatory
  wind *= alive
  machine *= alive * alive

  return { finale, machine, wind }
}

class StairwellAudioEngine extends JourneyAudio {
  protected readonly name = 'Stairwell'
  protected readonly level = 0.78
  protected readonly fade = 0.08

  private wind:     GainNode | null = null
  private machine:  GainNode | null = null
  private impact:   GainNode | null = null
  private lowOsc:   OscillatorNode | null = null
  private motorOsc: OscillatorNode | null = null
  private pulseOsc: OscillatorNode | null = null

  update (_time: number, state?: CustomUniforms): void {
    if (!this.ctx || this.isMuted)
      return

    const section   = scalar(state, 'uSection')
    const rupture   = scalar(state, 'uRupture')
    const finale    = scalar(state, 'uFinale')
    const purgatory = scalar(state, 'uPurgatory')
    const seam      = scalar(state, 'uSeam')
    const now       = this.ctx.currentTime
    const targets   = audioTargets(section, rupture, finale, purgatory)

    // Through the wall at each seam the weather drops away and the machines
    // of both acts are muffled by a few metres of concrete: the tunnel is the
    // one quiet place on the route, and it is where the soundscape changes
    // over, so the change is never heard happening.
    const shelter = 1 - seam * 0.75
    this.wind?.gain.setTargetAtTime(targets.wind * shelter, now, 0.7)
    this.machine?.gain.setTargetAtTime(targets.machine * (1 - seam * 0.5), now, 0.45)
    this.impact?.gain.setTargetAtTime(
      (section === 3 ? 0.7 : 0.22 + finale * 0.55) * (1 - purgatory * 0.62), now, 0.35)

    // Detuned flat as the residue takes hold — the one voice that survives, and
    // it goes out of tune with itself rather than getting louder.
    this.lowOsc?.frequency.setTargetAtTime(
      34 + section * 4 - finale * 15 - purgatory * 9, now, 0.8)
    this.motorOsc?.frequency.setTargetAtTime(58 + section * 13 + rupture * 9, now, 0.5)
    this.pulseOsc?.frequency.setTargetAtTime(
      0.7 + section * 0.18 + finale * 2.2 - purgatory * 0.45, now, 0.4)
  }

  protected build (): void {
    const ctx                  = this.ctx!
    const compressor           = ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.ratio.value     = 5
    compressor.connect(this.main!)

    this.wind    = this.createWind(compressor)
    this.machine = ctx.createGain()
    this.impact  = ctx.createGain()
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
    // A little leakier and quieter than the other journeys' brown noise.
    const buffer = brownNoise(ctx, 2, 3.4, 0.025)

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
      if (this.ctx && !this.isMuted && this.impact) {
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
      this.after(1400 + Math.random() * 3200, strike)
    }
    strike()
  }
}

export function createStairwellAudio (): JourneyAudioEngine {
  return new StairwellAudioEngine()
}

// perf: medium web-audio graph; three persistent oscillators and one looping noise buffer.
