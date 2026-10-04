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

