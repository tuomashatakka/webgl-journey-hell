// The loop line's one-shot sounds, and the plan of an announcement. Each takes
// the context and where to connect; none hold state.

import { clamp01 } from '@wjh/math/scalar'
import { SYLLABLES } from './patches'

/** The door chime lasts this long before the first syllable. */
const CHIME_SECONDS = 0.4

type Ctx = AudioContext
type Out = AudioNode

/** One formant syllable. Pitch and duration are syllable-specific. */
type VoiceType = { f1: BiquadFilterNode; f2: BiquadFilterNode; mix: GainNode }

/** A short filtered click of the relays in THE STACKS. */
export function relayClick (ctx: Ctx, buffer: AudioBuffer, to: Out): void {
  const now  = ctx.currentTime
  const src  = ctx.createBufferSource()
  src.buffer = buffer

  const bp = ctx.createBiquadFilter()
  bp.type  = 'bandpass'
  bp.frequency.setValueAtTime(2200, now)
  bp.Q.setValueAtTime(12, now)

  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.12, now + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.02)
  src.connect(bp)
  bp.connect(g)
  g.connect(to)
  src.start(now)
  src.stop(now + 0.05)
}

/** A bird in THE CUT: a short sine chirp. */
export function birdChirp (ctx: Ctx, to: Out): void {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type  = 'sine'

  const base = 1800 + Math.random() * 1600
  osc.frequency.setValueAtTime(base, now)
  osc.frequency.linearRampToValueAtTime(base * 1.15, now + 0.04)
  osc.frequency.linearRampToValueAtTime(base * 0.88, now + 0.1)

  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.015, now + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
  osc.connect(g)
  g.connect(to)
  osc.start(now)
  osc.stop(now + 0.15)
}

/** One water splash — a short burst of filtered noise. */
export function splash (ctx: Ctx, buffer: AudioBuffer, dry: Out, wet: Out): void {
  const now  = ctx.currentTime
  const src  = ctx.createBufferSource()
  src.buffer = buffer

  const bp = ctx.createBiquadFilter()
  bp.type  = 'bandpass'
  bp.frequency.setValueAtTime(600 + Math.random() * 400, now)
  bp.Q.setValueAtTime(2, now)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(0.04, now + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  src.connect(bp)
  bp.connect(env)
  env.connect(dry)
  env.connect(wet)
  src.start(now)
  src.stop(now + 0.1)
}

/** The two-note door chime before each announcement. */
export function doorChime (ctx: Ctx, chime: GainNode): void {
  const now = ctx.currentTime
  chime.gain.setValueAtTime(0, now)

  const notes = [ 698.5, 523.3 ]
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator()
    osc.type  = 'sine'
    osc.frequency.setValueAtTime(notes[i], now + i * 0.18)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now + i * 0.18)
    env.gain.linearRampToValueAtTime(0.1, now + i * 0.18 + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35)
    osc.connect(env)
    env.connect(chime)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.4)
  }
}

export function syllable (
  ctx: Ctx, voice: VoiceType, pitch: number, duration: number,
): void {
  const now = ctx.currentTime
  voice.f1.frequency.setValueAtTime(380 + pitch * 0.25, now)
  voice.f2.frequency.setValueAtTime(1800 + pitch * 2.2, now)
  voice.mix.gain.setValueAtTime(0, now)
  voice.mix.gain.linearRampToValueAtTime(0.14, now + 0.012)
  voice.mix.gain.setValueAtTime(0.14, now + duration - 0.02)
  voice.mix.gain.linearRampToValueAtTime(0, now + duration)
}

/**
 * The syllables of one announcement, and when each starts (seconds after the
 * chime begins). The degradation pipeline:
 *   lap 0-1  — intact, original order
 *   lap 1-2  — one syllable randomly dropped
 *   lap 2-3  — syllables shuffled, two dropped
 *   lap 3+   — all shuffled, three dropped, pitch drifts flat
 *
 * Deterministic: seeded on (bay, lap).
 */
export function planAnnouncement (bay: number, lapF: number): { pitch: number; duration: number; at: number }[] {
  const pattern = SYLLABLES[bay]
  const lap     = Math.floor(lapF)

  // Deterministic shuffle seeded on (bay, lap).
  const indices = pattern.map((_, i) => i)
  const seed    = bay * 31 + lap * 7
  for (let i = indices.length - 1; i > 0; i--) {
    const j    = Math.floor((Math.sin(seed * (i + 1) * 0.7 + i) * 0.5 + 0.5) * (i + 1)) % (i + 1)
    const tmp  = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }

  // Drop syllables as the lap rises.
  const keep = lap < 1
    ? pattern.length
    : lap < 2
      ? pattern.length - 1
      : lap < 3
        ? Math.max(2, pattern.length - 2)
        : Math.max(2, pattern.length - 3)

  const pitchDrift = lap >= 3 ? 1 - clamp01((lap - 3) * 0.15) : 1

  const plan = []
  let t      = CHIME_SECONDS
  for (let i = 0; i < keep; i++) {
    const [ pitch, duration ] = pattern[indices[i]]
    plan.push({ pitch: pitch * pitchDrift, duration, at: t })
    t += duration + 0.03
  }
  return plan
}
