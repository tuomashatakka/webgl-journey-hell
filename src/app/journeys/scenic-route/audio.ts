// THE SCENIC ROUTE — the sound.
//
// Everything is synthesised; nothing is loaded. The engine reads the same
// uniform map the shaders draw with, once per frame, and ramps every gain and
// frequency toward a target with a short time constant, so the mix follows the
// ride without clicks and without owning any state of its own.
//
//   engine   two saws and a sub square at the firing frequency, through a
//            lowpass that opens with revs; the gearbox is audible because the
//            simulation's rpm already has the shifts in it.
//   tyres    bandpassed noise by speed, only on asphalt.
//   wind     higher bandpassed noise by speed squared, wide open in the fall.
//   radio    an AM station: a detuned triad through a voice-band filter over a
//            bed of static. It drifts further off-station every lap and dies to
//            static when the signal goes.
//   gullet   brown noise with a slow wobble, wet.
//   cave     low water rush and drips: short sine pings into a feedback delay.
//
// Section blending comes from uFogCol.w, the "surface" scalar the simulation
// already blends across section windows: 0 asphalt, 2 fall, 3 gullet, 4 water.

import type { JourneyAudioEngine } from '@/hooks/use-audio-engine'
import type { CustomUniforms } from '@/lib/shaderQuad'


const RAMP = 0.08

function weightAt (surface: number, centre: number): number {
  return Math.max(0, 1 - Math.abs(surface - centre))
}

function noiseBuffer (ctx: AudioContext, seconds = 2): AudioBuffer {
  const n   = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d   = buf.getChannelData(0)
  for (let i = 0; i < n; i++)
    d[i] = Math.random() * 2 - 1
  return buf
}

interface Voice {
  gain:    GainNode;
  filter?: BiquadFilterNode;
}

export class ScenicRouteAudio implements JourneyAudioEngine {
  private ctx:    AudioContext | null = null
  private master: GainNode | null = null
  private muted = true

  private engineOsc: OscillatorNode[] = []
  private engine:    Voice | null = null
  private tyres:     Voice | null = null
  private wind:      Voice | null = null
  private radio:     Voice | null = null
  private radioOsc:  OscillatorNode[] = []
  private staticV:   Voice | null = null
  private gullet:    Voice | null = null
  private gulletLfo: OscillatorNode | null = null
  private cave:      Voice | null = null
  private echo:      DelayNode | null = null
  private nextDrip = 0
  private lastTime = 0

  toggleMute (): boolean {
    this.muted = !this.muted
    if (!this.muted && !this.ctx)
      this.build()

    const ctx = this.ctx
    if (ctx && this.master) {
      if (ctx.state === 'suspended')
        void ctx.resume()
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, ctx.currentTime, 0.05)
    }
    return this.muted
  }

  destroy (): void {
    if (this.ctx)
      void this.ctx.close()
    this.ctx = null
  }

  private noise (ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
    const src  = ctx.createBufferSource()
    src.buffer = buf
    src.loop   = true
    src.start()
    return src
  }

  private voice (ctx: AudioContext, src: AudioNode, type?: BiquadFilterType, freq = 1000, q = 0.7): Voice {
    const gain      = ctx.createGain()
    gain.gain.value = 0

    let filter: BiquadFilterNode | undefined
    if (type) {
      filter                 = ctx.createBiquadFilter()
      filter.type            = type
      filter.frequency.value = freq
      filter.Q.value         = q
      src.connect(filter)
      filter.connect(gain)
    }
    else
      src.connect(gain)
    gain.connect(this.master!)
    return { gain, filter }
  }

  private build (): void {
    const ctx              = new AudioContext()
    this.ctx               = ctx
    this.master            = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)

    const buf = noiseBuffer(ctx)

    // Engine: saw, detuned saw an octave up, sub square.
    const mix = ctx.createGain()
    for (const [ type, ratio, level ] of [[ 'sawtooth', 1, 0.5 ], [ 'sawtooth', 2.01, 0.18 ], [ 'square', 0.5, 0.3 ]] as const) {
      const osc           = ctx.createOscillator()
      osc.type            = type
      osc.frequency.value = 60 * ratio

      const g      = ctx.createGain()
      g.gain.value = level
      osc.connect(g)
      g.connect(mix)
      osc.start()
      this.engineOsc.push(osc)
    }
    this.engine = this.voice(ctx, mix, 'lowpass', 600, 1.2)

    this.tyres = this.voice(ctx, this.noise(ctx, buf), 'bandpass', 620, 0.6)
    this.wind  = this.voice(ctx, this.noise(ctx, buf), 'bandpass', 1400, 0.5)

    // Radio: a triad through a voice band, plus static.
    const station = ctx.createGain()
    for (const f of [ 220, 277.2, 329.6 ]) {
      const osc           = ctx.createOscillator()
      osc.type            = 'sine'
      osc.frequency.value = f

      const g      = ctx.createGain()
      g.gain.value = 0.33
      osc.connect(g)
      g.connect(station)
      osc.start()
      this.radioOsc.push(osc)
    }
    this.radio   = this.voice(ctx, station, 'bandpass', 900, 0.9)
    this.staticV = this.voice(ctx, this.noise(ctx, buf), 'bandpass', 2400, 0.4)

    // Gullet: brown noise with a wobble on its gain.
    this.gullet         = this.voice(ctx, this.noise(ctx, buf), 'lowpass', 160, 0.8)

    const lfo           = ctx.createOscillator()
    lfo.frequency.value = 0.45

    const lfoGain      = ctx.createGain()
    lfoGain.gain.value = 0
    lfo.connect(lfoGain)
    lfoGain.connect(this.gullet.gain.gain)
    lfo.start()
    this.gulletLfo = lfo

    // Cave: water rush and an echo bus for the drips.
    this.cave            = this.voice(ctx, this.noise(ctx, buf), 'lowpass', 420, 0.7)

    const echo           = ctx.createDelay(1.0)
    echo.delayTime.value = 0.27

    const fb      = ctx.createGain()
    fb.gain.value = 0.42
    echo.connect(fb)
    fb.connect(echo)
    echo.connect(this.master)
    this.echo = echo
  }

  private drip (ctx: AudioContext, strength: number): void {
    if (!this.echo)
      return

    const osc           = ctx.createOscillator()
    osc.type            = 'sine'
    osc.frequency.value = 1500 + Math.random() * 1900

    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12 * strength, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    osc.connect(g)
    g.connect(this.echo)
    g.connect(this.master!)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  private set (param: AudioParam | undefined, value: number, now: number, tc = RAMP): void {
    if (param)
      param.setTargetAtTime(value, now, tc)
  }

  update (time: number, state?: CustomUniforms): void {
    const ctx = this.ctx
    if (!ctx || this.muted || !state)
      return

    const now    = ctx.currentTime
    const ride   = (state.uRide as number[] | undefined) ?? [ 0, 0, 0, 0 ]
    const car    = (state.uCar as number[] | undefined) ?? [ 0.1, 1, 0, 0 ]
    const env    = (state.uEnv as number[] | undefined) ?? [ 0, 1, 0, 0 ]
    const fog    = (state.uFogCol as number[] | undefined) ?? [ 0, 0, 0, 0 ]
    const signal = (state.uSignal as number[] | undefined) ?? [ 0, 0 ]
    const v      = ride[0]
    const lapF   = ride[1]
    const rpm    = car[0] * 7800
    const sky    = env[1]
    const surf   = fog[3]
    const wFall  = weightAt(surf, 2)
    const wGut   = weightAt(surf, 3)
    const wCave  = weightAt(surf, 4)
    const onRoad = Math.max(0, 1 - wFall - wGut - wCave)
    // The picture dies over a few seconds of signal loss; so does the car.
    const alive  = Math.max(0, 1 - signal[0] / 6)

    // Engine: firing frequency of a four, lowpass opening with revs.
    const f0     = Math.max(rpm, 500) / 60 * 2
    const ratios = [ 1, 2.01, 0.5 ]
    this.engineOsc.forEach((osc, i) => this.set(osc.frequency, f0 * ratios[i], now, 0.05))
    this.set(this.engine?.filter?.frequency, 350 + rpm * 0.28, now)

    const load = 0.35 + 0.65 * Math.min(1, rpm / 6500)
    this.set(this.engine?.gain.gain, (0.05 + 0.13 * load) * alive * (1 - wCave * 0.85), now)

    // Tyres and wind.
    this.set(this.tyres?.gain.gain, Math.min(1, v / 38) * 0.11 * onRoad * alive, now)
    this.set(this.tyres?.filter?.frequency, 450 + v * 9, now)

    const windAmt = Math.min(1, v / 55 * (v / 55)) * (0.08 + wFall * 0.35)
    this.set(this.wind?.gain.gain, windAmt * alive * (1 - wCave), now)
    this.set(this.wind?.filter?.frequency, 900 + v * 28, now)

    // Radio: outside only, quieter and further off-station every lap, static
    // takes over with the signal.
    const drift = lapF * 0.06
    this.radioOsc.forEach((osc, i) => {
      const base = [ 220, 277.2, 329.6 ][i]
      this.set(osc.frequency, base * (1 + drift * (i + 1) * 0.5) + Math.sin(time * (0.7 + i)) * lapF * 2, now, 0.2)
    })

    const tuned = Math.max(0, 1 - lapF * 0.3) * alive
    this.set(this.radio?.gain.gain, 0.045 * sky * tuned, now)

    const hiss = 0.012 + lapF * 0.01 + (1 - alive) * 0.06 + (signal[0] > 0 ? 0.03 : 0)
    this.set(this.staticV?.gain.gain, hiss * Math.max(sky, 0.3), now)

    // Gullet and cave.
    this.set(this.gullet?.gain.gain, 0.32 * wGut, now, 0.3)
    this.set(this.cave?.gain.gain, (0.12 + Math.min(1, v / 14) * 0.1) * wCave, now, 0.3)

    // Drips, spaced at random while in the cave.
    if (wCave > 0.3 && time > this.nextDrip) {
      this.drip(ctx, wCave)
      this.nextDrip = time + 0.35 + Math.random() * 1.6
    }
    this.lastTime = time
  }
}

export function createScenicRouteAudio (): ScenicRouteAudio {
  return new ScenicRouteAudio()
}
