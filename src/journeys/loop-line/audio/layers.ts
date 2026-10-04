// The loop line's continuous layers, one builder per voice. Each takes the
// context and where to connect, wires its nodes, and returns the gain the
// per-frame update rides. They hold no state: the engine owns what they return.

import { driftingChord } from '@wjh/audio/nodes'

/** Glide for slow-moving continuous parameters. */
export const GLIDE = 0.45

type Ctx = AudioContext
type Out = AudioNode

/**
 * THE ANNEX. Water — lapping and dripping, plus a splash whose rate tracks
 * speed. The splash gain is only created here; the splashes are events.
 */
type BuildWaterReturnType = { water: GainNode; splash: GainNode }

/**
 * THE STACKS. Fan-wall noise — several detuned bandpass-filtered noise bands —
 * plus coil whine. The relay gain is created here; the clicks are events.
 */
type BuildStacksReturnType = { fan: GainNode; coil: GainNode; relay: GainNode }

/** The formant announcement's voice: a sawtooth through two bandpass formants. */
export interface FormantVoice {
  f1:    BiquadFilterNode;
  f2:    BiquadFilterNode;
  mix:   GainNode;
  chime: GainNode;
}

/** A bandpass filter at `f` with quality `q`. */
function bandpass (ctx: Ctx, f: number, q: number): BiquadFilterNode {
  const bp = ctx.createBiquadFilter()
  bp.type  = 'bandpass'
  bp.frequency.setValueAtTime(f, ctx.currentTime)
  bp.Q.setValueAtTime(q, ctx.currentTime)
  return bp
}

/** A lowpass filter at `f`, with a resonance where it matters. */
function lowpass (ctx: Ctx, f: number, q?: number): BiquadFilterNode {
  const lp = ctx.createBiquadFilter()
  lp.type  = 'lowpass'
  lp.frequency.setValueAtTime(f, ctx.currentTime)
  if (q !== undefined)
    lp.Q.setValueAtTime(q, ctx.currentTime)
  return lp
}

/** A gain node starting at `value`. */
function gainAt (ctx: Ctx, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(value, ctx.currentTime)
  return g
}

/**
 * THE MOTOR. Three detuned sawtooth oscillators through a resonant lowpass,
 * pitch tracking speed. The Q on the filter is what makes it read as a
 * chopper drive rather than a synth: each harmonic is a little resonant peak
 * that moves with frequency, which is exactly what a DC-chopper inverter
 * sounds like.
 */
export function buildMotor (ctx: Ctx, dry: Out): GainNode {
  const now       = ctx.currentTime
  const motorGain = gainAt(ctx, 0)
  const lp        = lowpass(ctx, 600, 5)

  for (const [ f, a ] of [[ 55, 1 ], [ 82, 0.38 ], [ 110, 0.18 ]]) {
    const osc = ctx.createOscillator()
    osc.type  = 'sawtooth'
    osc.frequency.setValueAtTime(f, now)

    const g = gainAt(ctx, a)
    osc.connect(g)
    g.connect(lp)
    osc.start()
  }

  lp.connect(motorGain)
  motorGain.connect(dry)
  return motorGain
}

/**
 * THE CONCOURSE. A dead-mall muzak chord — every voice detuned and drifting,
 * so the chord beats against itself rather than sounding played — plus an
 * escalator's mechanical rumble, which is a low sawtooth drone at a fixed
 * rate.
 */
export function buildConcourse (ctx: Ctx, dry: Out, wet: Out): GainNode {
  const now       = ctx.currentTime
  const muzakGain = gainAt(ctx, 0)

  // F, A, B, E — wrong-sounding intervals that read as a muzak recording
  // that nobody has been in to change.
  driftingChord(ctx, muzakGain, {
    voices:    [[ 174.6, 0 ], [ 220, 8 ], [ 246.9, -6 ], [ 329.6, 12 ]],
    cutoff:    1000,
    voiceGain: 0.18,
    wowRate:   0.21,
    wowDepth:  8,
  })

  // Escalator rumble — a fixed mechanical rate.
  const rumble = ctx.createOscillator()
  rumble.type  = 'sawtooth'
  rumble.frequency.setValueAtTime(38, now)

  const rumbleLP = lowpass(ctx, 200)
  const rumbleG  = gainAt(ctx, 0.06)
  rumble.connect(rumbleLP)
  rumbleLP.connect(rumbleG)
  rumbleG.connect(muzakGain)
  rumble.start()

  muzakGain.connect(dry)
  muzakGain.connect(wet)
  return muzakGain
}

/** THE CUT. Open air: wind, distant traffic, no reverb tail. */
export function buildWind (ctx: Ctx, dry: Out, wet: Out, src: AudioBufferSourceNode): GainNode {
  const lp       = lowpass(ctx, 700, 0.6)
  const windGain = gainAt(ctx, 0)

  src.connect(lp)
  lp.connect(windGain)
  windGain.connect(dry)
  windGain.connect(wet)
  src.start()
  return windGain
}

export function buildWater (ctx: Ctx, dry: Out, wet: Out, water: AudioBufferSourceNode | null): BuildWaterReturnType {
  const now        = ctx.currentTime
  const waterGain  = gainAt(ctx, 0)
  const splashGain = gainAt(ctx, 0)

  // Lapping water: AM-modulated filtered noise.
  if (water) {
    const waterBP = bandpass(ctx, 400, 1.2)
    const lfo     = ctx.createOscillator()
    lfo.frequency.setValueAtTime(0.6, now)

    const lfoAmt = gainAt(ctx, 0.08)
    lfo.connect(lfoAmt)
    lfoAmt.connect(waterGain.gain)
    lfo.start()
    water.connect(waterBP)
    waterBP.connect(waterGain)
    water.start()
  }

  waterGain.connect(dry)
  waterGain.connect(wet)
  return { water: waterGain, splash: splashGain }
}

export function buildStacks (ctx: Ctx, dry: Out, wet: Out, noise: AudioBufferSourceNode | null): BuildStacksReturnType {
  const fan   = gainAt(ctx, 0)
  const coil  = gainAt(ctx, 0)
  const relay = gainAt(ctx, 0)

  if (noise) {
    for (const [ f, q ] of [[ 320, 3 ], [ 580, 4.5 ], [ 900, 2.8 ], [ 1400, 5 ]]) {
      const g = gainAt(ctx, 0.035)
      noise.connect(bandpass(ctx, f, q))
        .connect(g)
      g.connect(fan)
    }
    noise.start()
  }

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type  = 'triangle'
  osc.frequency.setValueAtTime(7800, now)

  const lfo = ctx.createOscillator()
  lfo.frequency.setValueAtTime(3.5, now)

  const lfoAmt = gainAt(ctx, 25)
  lfo.connect(lfoAmt)
  lfoAmt.connect(osc.frequency)
  lfo.start()
  osc.connect(coil)
  osc.start()

  fan.connect(dry)
  fan.connect(wet)
  coil.connect(dry)
  relay.connect(dry)
  return { fan, coil, relay }
}

/** THE TURNBACK. Almost nothing: a far-off wind. The absence should be conspicuous. */
export function buildVoid (ctx: Ctx, dry: Out, src: AudioBufferSourceNode): GainNode {
  const lp       = lowpass(ctx, 400)
  const voidGain = gainAt(ctx, 0)

  src.connect(lp)
  lp.connect(voidGain)
  voidGain.connect(dry)
  src.start()
  return voidGain
}

/**
 * THE CHORD. Extremely close, dead, dry brick. Heavy proximity — a narrow bore
 * is loud — through a very tight resonant bandpass.
 */
export function buildBore (ctx: Ctx, dry: Out, src: AudioBufferSourceNode): GainNode {
  const bp       = bandpass(ctx, 350, 4)
  const boreGain = gainAt(ctx, 0)

  src.connect(bp)
  bp.connect(boreGain)
  boreGain.connect(dry)
  src.start()
  return boreGain
}

/** Very short shimmer for the tunnel and the formant announcements. */
export function buildShimmer (ctx: Ctx, wet: Out): void {
  const now = ctx.currentTime
  const d   = ctx.createDelay(0.5)
  d.delayTime.setValueAtTime(0.042, now)

  const g  = gainAt(ctx, 0.12)
  const lp = lowpass(ctx, 4000)
  const bp = bandpass(ctx, 2000, 2.5)
  wet.connect(d)
  d.connect(g)
  g.connect(lp)
  lp.connect(bp)
  bp.connect(wet)
}

/**
 * The formant chain: a pulse source through two bandpass filters tuned to
 * formant frequencies. The pulse is not a real glottal source — it is a
 * convenience: harmonics at every integer multiple of the fundamental, which
 * is exactly what the formants need to ring on. The door chime's gain is made
 * here too.
 */
export function buildFormant (ctx: Ctx, dry: Out, wet: Out): FormantVoice {
  const now = ctx.currentTime

  const src = ctx.createOscillator()
  src.type  = 'sawtooth'
  src.frequency.setValueAtTime(1, now)

  const f1  = bandpass(ctx, 400, 8)
  const f2  = bandpass(ctx, 2200, 12)
  const mix = gainAt(ctx, 0)
  const g1  = gainAt(ctx, 0.55)
  const g2  = gainAt(ctx, 0.35)

  src.connect(f1)
  src.connect(f2)
  f1.connect(g1)
  f2.connect(g2)
  g1.connect(mix)
  g2.connect(mix)
  mix.connect(dry)
  mix.connect(wet)
  src.start()

  // The door chime: a two-note descending interval, before each announcement.
  const chime = gainAt(ctx, 0)
  chime.connect(dry)
  chime.connect(wet)
  return { f1, f2, mix, chime }
}
