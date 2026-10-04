// THE LIMINAL JOURNEY — the soundtrack.
//
// A brown-noise bed under a slowly swept lowpass, two detuned drones, water
// dripping in the flooded sectors and glitch clicks once the loops start to
// break. Driven by uPlayerZ, the same distance the corridor is drawn at.

import type { CustomUniforms } from '@wjh/gl/uniforms'
import type { JourneyAudioEngine } from '@wjh/journey/types'
import { JourneyAudio } from '@wjh/audio/engine'


class LiminalAudioEngine extends JourneyAudio {
  private lowpassLFO: OscillatorNode | null = null
  private droneOscL:  OscillatorNode | null = null
  private droneOscR:  OscillatorNode | null = null

  private noiseVolume: GainNode | null = null

  private waterVolume:  GainNode | null = null
  private glitchVolume: GainNode | null = null
  protected readonly name = 'Liminal'
  protected readonly level = 0.8
  protected readonly fade = 0.02

  private startWaterDripper () {
    const playDrip = () => {
      if (!this.ctx || this.isMuted)
        return

      const osc    = this.ctx.createOscillator()
      const gain   = this.ctx.createGain()
      const filter = this.ctx.createBiquadFilter()

      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1100 + Math.random() * 400, this.ctx.currentTime)
      filter.Q.setValueAtTime(6, this.ctx.currentTime)

      osc.type        = 'sine'

      const startFreq = 1600 + Math.random() * 800
      const endFreq   = 400 + Math.random() * 200
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + 0.08)

      gain.gain.setValueAtTime(0, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.35 + Math.random() * 0.4, this.ctx.currentTime + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(this.waterVolume!)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.15)
    }

    const scheduleNextDrip = () => {
      playDrip()

      const delay        = 400 + Math.random() * 1200
      this.after(delay, scheduleNextDrip)
    }

    scheduleNextDrip()
  }

  private startGlitchEngine () {
    const playGlitchClick = () => {
      if (!this.ctx || this.isMuted)
        return

      const osc  = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(10000 * Math.random(), this.ctx.currentTime)

      gain.gain.setValueAtTime(0, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.001)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.015)

      osc.connect(gain)
      gain.connect(this.glitchVolume!)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.02)
    }

    const runGlitch = () => {
      if (!this.isMuted && Math.random() < 0.28) {
        const ticks = Math.floor(1 + Math.random() * 4)
        for (let i = 0; i < ticks; i++)
          this.after(i * 45, playGlitchClick)
      }
      this.after(150 + Math.random() * 3000, runGlitch)
    }

    runGlitch()
  }

  protected build (): void {
    try {
      const ctx         = this.ctx!
      const main        = this.main!
      const noiseSource = this.noiseSource(true)!

      const filter = ctx.createBiquadFilter()
      filter.type  = 'lowpass'
      filter.frequency.setValueAtTime(140, ctx.currentTime)
      filter.Q.setValueAtTime(2.5, ctx.currentTime)

      this.lowpassLFO = ctx.createOscillator()
      this.lowpassLFO.frequency.setValueAtTime(0.08, ctx.currentTime)

      const lfoGain = ctx.createGain()
      lfoGain.gain.setValueAtTime(110, ctx.currentTime)

      this.lowpassLFO.connect(lfoGain)
      lfoGain.connect(filter.frequency)
      this.lowpassLFO.start()

      this.noiseVolume = ctx.createGain()
      this.noiseVolume.gain.setValueAtTime(0.25, ctx.currentTime)

      noiseSource.connect(filter)
      filter.connect(this.noiseVolume)
      this.noiseVolume.connect(main)
      noiseSource.start()

      this.droneOscL      = ctx.createOscillator()
      this.droneOscR      = ctx.createOscillator()
      this.droneOscL.type = 'sine'
      this.droneOscR.type = 'triangle'

      this.droneOscL.frequency.setValueAtTime(54.4, ctx.currentTime)
      this.droneOscR.frequency.setValueAtTime(55.2, ctx.currentTime)

      const droneGain = ctx.createGain()
      droneGain.gain.setValueAtTime(0.12, ctx.currentTime)

      const droneFilter = ctx.createBiquadFilter()
      droneFilter.type  = 'lowpass'
      droneFilter.frequency.setValueAtTime(80, ctx.currentTime)

      this.droneOscL.connect(droneFilter)
      this.droneOscR.connect(droneFilter)
      droneFilter.connect(droneGain)
      droneGain.connect(main)

      this.droneOscL.start()
      this.droneOscR.start()

      this.waterVolume = ctx.createGain()
      this.waterVolume.gain.setValueAtTime(0.48, ctx.currentTime)
      this.waterVolume.connect(main)

      this.startWaterDripper()

      this.glitchVolume = ctx.createGain()
      this.glitchVolume.gain.setValueAtTime(0.35, ctx.currentTime)
      this.glitchVolume.connect(main)

      this.startGlitchEngine()
    }
    catch (e) {
      console.error('Audio Context initialization failed:', e)
    }
  }

  public update (_time: number, state?: CustomUniforms) {
    if (!this.ctx || this.isMuted)
      return

    const z = typeof state?.uPlayerZ === 'number' ? state.uPlayerZ : 0

    const loopVal = Math.floor(z / 500)
    const lz      = z % 500

    let isWaterSegment        = false
    let isGlitchSegment       = false
    let isHeavyOrganicSegment = false

    if (lz >= 60 && lz < 130)
      isWaterSegment = true
    if (lz >= 280 && lz < 360)
      isWaterSegment = true

    if (lz >= 360) {
      if (loopVal > 0) {
        isGlitchSegment = true

        const local666 = lz - 360

        if (loopVal === 1)
          if (local666 < 60)
            isHeavyOrganicSegment = true
          else
            isWaterSegment = true; else if (loopVal === 2) {
          if (local666 >= 60 && local666 < 90)
            isHeavyOrganicSegment = true
        }
        else {
          if (local666 >= 40 && local666 < 60)
            isHeavyOrganicSegment = true
          if (local666 >= 100)
            isGlitchSegment = true
        }
      }
    }

    if (z >= 1890)
      isGlitchSegment = true

    const time = this.ctx.currentTime

    if (this.waterVolume) {
      const targetWaterGain = isWaterSegment ? 0.72 : 0.08
      this.waterVolume.gain.setTargetAtTime(targetWaterGain, time, 0.5)
    }

    if (this.glitchVolume) {
      const targetGlitchGain = isGlitchSegment ? 0.58 : 0.05
      this.glitchVolume.gain.setTargetAtTime(targetGlitchGain, time, 0.3)
    }

    if (this.droneOscL && this.droneOscR) {
      const targetFreqL = isHeavyOrganicSegment ? 44 : 54.4
      const targetFreqR = isHeavyOrganicSegment ? 44.6 : 55.2
      this.droneOscL.frequency.setTargetAtTime(targetFreqL, time, 1)
      this.droneOscR.frequency.setTargetAtTime(targetFreqR, time, 1)
    }
  }
}

export function createLiminalAudio (): JourneyAudioEngine {
  return new LiminalAudioEngine()
}
