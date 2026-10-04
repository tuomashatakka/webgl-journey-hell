// THE LIMINAL JOURNEY — the soundtrack.
//
// A brown-noise bed under a slowly swept lowpass, two detuned drones, water
// dripping in the flooded sectors and glitch clicks once the loops start to
// break. Driven by uPlayerZ, the same distance the corridor is drawn at.

import type { CustomUniforms } from '✦/lib/gl'
import type { JourneyAudioEngine } from '✦/lib/journey'


class LiminalAudioEngine implements JourneyAudioEngine {
  private ctx:            AudioContext | null = null
  private isMuted:        boolean = true
  private lowpassLFO:     OscillatorNode | null = null
  private waterInterval:  ReturnType<typeof setInterval> | null = null
  private glitchInterval: ReturnType<typeof setInterval> | null = null

  private droneOscL:    OscillatorNode | null = null
  private droneOscR:    OscillatorNode | null = null
  private mainVolume:   GainNode | null = null
  private noiseVolume:  GainNode | null = null
  private waterVolume:  GainNode | null = null
  private glitchVolume: GainNode | null = null

  constructor () {}

  public toggleMute (): boolean {
    if (!this.ctx)
      this.initContext()
    this.isMuted = !this.isMuted
    if (this.mainVolume && this.ctx)
      this.mainVolume.gain.setValueAtTime(this.isMuted ? 0.0 : 0.8, this.ctx.currentTime)
    return this.isMuted
  }

  public getMutedState (): boolean {
    return this.isMuted
  }

  private initContext () {
    try {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      this.ctx       = new AudioCtx()

      this.mainVolume = this.ctx.createGain()
      this.mainVolume.gain.setValueAtTime(0.0, this.ctx.currentTime)
      this.mainVolume.connect(this.ctx.destination)

      const bufferSize  = 2 * this.ctx.sampleRate
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
      const output      = noiseBuffer.getChannelData(0)
      let lastOut = 0.0
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2.0 - 1.0
        output[i]   = (lastOut + 0.02 * white) / 1.02
        lastOut = output[i]
        output[i] *= 3.5
      }

      const noiseSource  = this.ctx.createBufferSource()
      noiseSource.buffer = noiseBuffer
      noiseSource.loop   = true

      const filter = this.ctx.createBiquadFilter()
      filter.type  = 'lowpass'
      filter.frequency.setValueAtTime(140.0, this.ctx.currentTime)
      filter.Q.setValueAtTime(2.5, this.ctx.currentTime)

      this.lowpassLFO = this.ctx.createOscillator()
      this.lowpassLFO.frequency.setValueAtTime(0.08, this.ctx.currentTime)

      const lfoGain = this.ctx.createGain()
      lfoGain.gain.setValueAtTime(110.0, this.ctx.currentTime)

      this.lowpassLFO.connect(lfoGain)
      lfoGain.connect(filter.frequency)
      this.lowpassLFO.start()

      this.noiseVolume = this.ctx.createGain()
      this.noiseVolume.gain.setValueAtTime(0.25, this.ctx.currentTime)

      noiseSource.connect(filter)
      filter.connect(this.noiseVolume)
      this.noiseVolume.connect(this.mainVolume)
      noiseSource.start()

      this.droneOscL      = this.ctx.createOscillator()
      this.droneOscR      = this.ctx.createOscillator()
      this.droneOscL.type = 'sine'
      this.droneOscR.type = 'triangle'

      this.droneOscL.frequency.setValueAtTime(54.4, this.ctx.currentTime)
      this.droneOscR.frequency.setValueAtTime(55.2, this.ctx.currentTime)

      const droneGain = this.ctx.createGain()
      droneGain.gain.setValueAtTime(0.12, this.ctx.currentTime)

      const droneFilter = this.ctx.createBiquadFilter()
      droneFilter.type  = 'lowpass'
      droneFilter.frequency.setValueAtTime(80.0, this.ctx.currentTime)

      this.droneOscL.connect(droneFilter)
      this.droneOscR.connect(droneFilter)
      droneFilter.connect(droneGain)
      droneGain.connect(this.mainVolume)

      this.droneOscL.start()
      this.droneOscR.start()

      this.waterVolume = this.ctx.createGain()
      this.waterVolume.gain.setValueAtTime(0.48, this.ctx.currentTime)
      this.waterVolume.connect(this.mainVolume)

      this.startWaterDripper()

      this.glitchVolume = this.ctx.createGain()
      this.glitchVolume.gain.setValueAtTime(0.35, this.ctx.currentTime)
      this.glitchVolume.connect(this.mainVolume)

      this.startGlitchEngine()
    }
    catch (e) {
      console.error('Audio Context initialization failed:', e)
    }
  }

  private startWaterDripper () {
    const playDrip = () => {
      if (!this.ctx || this.isMuted)
        return

      const osc    = this.ctx.createOscillator()
      const gain   = this.ctx.createGain()
      const filter = this.ctx.createBiquadFilter()

      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1100 + Math.random() * 400, this.ctx.currentTime)
      filter.Q.setValueAtTime(6.0, this.ctx.currentTime)

      osc.type        = 'sine'

      const startFreq = 1600.0 + Math.random() * 800.0
      const endFreq   = 400.0 + Math.random() * 200.0
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + 0.08)

      gain.gain.setValueAtTime(0.0, this.ctx.currentTime)
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
      this.waterInterval = setTimeout(scheduleNextDrip, delay)
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
      osc.frequency.setValueAtTime(10000.0 * Math.random(), this.ctx.currentTime)

      gain.gain.setValueAtTime(0.0, this.ctx.currentTime)
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
          setTimeout(playGlitchClick, i * 45)
      }
      this.glitchInterval = setTimeout(runGlitch, 150 + Math.random() * 3000)
    }

    runGlitch()
  }

  public update (_time: number, state?: CustomUniforms) {
    if (!this.ctx || this.isMuted)
      return

    const z = typeof state?.uPlayerZ === 'number' ? state.uPlayerZ : 0

    const loopVal = Math.floor(z / 500.0)
    const lz      = z % 500.0

    let isWaterSegment        = false
    let isGlitchSegment       = false
    let isHeavyOrganicSegment = false

    if (lz >= 60.0 && lz < 130.0)
      isWaterSegment = true
    if (lz >= 280.0 && lz < 360.0)
      isWaterSegment = true

    if (lz >= 360.0) {
      if (loopVal > 0) {
        isGlitchSegment = true

        const local666 = lz - 360.0

        if (loopVal === 1)
          if (local666 < 60.0)
            isHeavyOrganicSegment = true
          else
            isWaterSegment = true; else if (loopVal === 2) {
          if (local666 >= 60.0 && local666 < 90.0)
            isHeavyOrganicSegment = true
        }
        else {
          if (local666 >= 40.0 && local666 < 60.0)
            isHeavyOrganicSegment = true
          if (local666 >= 100.0)
            isGlitchSegment = true
        }
      }
    }

    if (z >= 1890.0)
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
      const targetFreqL = isHeavyOrganicSegment ? 44.0 : 54.4
      const targetFreqR = isHeavyOrganicSegment ? 44.6 : 55.2
      this.droneOscL.frequency.setTargetAtTime(targetFreqL, time, 1.0)
      this.droneOscR.frequency.setTargetAtTime(targetFreqR, time, 1.0)
    }
  }

  public destroy () {
    if (this.ctx)
      this.ctx.close()
    if (this.waterInterval)
      clearTimeout(this.waterInterval)
    if (this.glitchInterval)
      clearTimeout(this.glitchInterval)
  }
}

export function createLiminalAudio (): JourneyAudioEngine {
  return new LiminalAudioEngine()
}
