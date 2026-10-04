// Web Audio building blocks every soundtrack uses.

import type { CustomUniforms } from '@wjh/gl/uniforms'


type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

/** A new AudioContext (webkit-prefixed on older Safari), or null without Web Audio. */
export function createAudioContext (): AudioContext | null {
  if (typeof window === 'undefined')
    return null

  const Ctor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext
  return Ctor ? new Ctor() : null
}

/**
 * Brown(ish) noise: integrated white, leaky so it cannot wander off. The one
 * recipe every journey's wind, hiss and rumble is filtered from.
 */
export function brownNoise (ctx: BaseAudioContext, seconds = 2, gain = 3.5, leak = 0.02): AudioBuffer {
  const size   = Math.floor(seconds * ctx.sampleRate)
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate)
  const out    = buffer.getChannelData(0)
  let last     = 0
  for (let i = 0; i < size; i++) {
    last   = (last + leak * (Math.random() * 2 - 1)) / (1 + leak)
    out[i] = last * gain
  }
  return buffer
}

/** Flat white noise. */
export function whiteNoise (ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const size   = Math.floor(seconds * ctx.sampleRate)
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate)
  const out    = buffer.getChannelData(0)
  for (let i = 0; i < size; i++)
    out[i] = Math.random() * 2 - 1
  return buffer
}

/** A scalar uniform from the frame's map, or `fallback`. */
export function scalar (state: CustomUniforms | undefined, name: string, fallback = 0): number {
  const v = state?.[name]
  return typeof v === 'number' ? v : fallback
}


/** A chord of triangle voices, each detuned and wobbling by its own slow LFO. */
export interface DriftingChord {

  /** [frequency Hz, static detune cents] per voice. */
  voices:    readonly (readonly [number, number])[];

  /** Lowpass cutoff (Hz) the whole chord sits behind. */
  cutoff:    number;
  voiceGain: number;

  /** Wow LFO rate is `wowRate + frequency * 0.0004` Hz. */
  wowRate:   number;

  /** Wow depth, cents. */
  wowDepth:  number;
}

/**
 * The muzak recipe: every voice detuned by a different amount so the chord
 * beats against itself instead of sounding played, and a tape wow that makes
 * it read as a recording rather than as oscillators. Starts immediately and
 * feeds `out` through a dark lowpass.
 */
export function driftingChord (ctx: AudioContext, out: AudioNode, chord: DriftingChord): void {
  const now = ctx.currentTime

  const lp = ctx.createBiquadFilter()
  lp.type  = 'lowpass'
  lp.frequency.setValueAtTime(chord.cutoff, now)
  lp.Q.setValueAtTime(0.8, now)
  lp.connect(out)

  for (const [ f, det ] of chord.voices) {
    const osc = ctx.createOscillator()
    osc.type  = 'triangle'
    osc.frequency.setValueAtTime(f, now)
    osc.detune.setValueAtTime(det, now)

    const wow = ctx.createOscillator()
    wow.frequency.setValueAtTime(chord.wowRate + f * 0.0004, now)

    const wowAmt = ctx.createGain()
    wowAmt.gain.setValueAtTime(chord.wowDepth, now)
    wow.connect(wowAmt)
    wowAmt.connect(osc.detune)
    wow.start()

    const g = ctx.createGain()
    g.gain.setValueAtTime(chord.voiceGain, now)
    osc.connect(g)
    g.connect(lp)
    osc.start()
  }
}
