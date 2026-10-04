// One room, as a pair of damped feedback delays that can be retuned in flight.
//
// A convolver per room would be better and is not affordable; a delay pair per
// room would be affordable and would all have to be muted, which is a feedback
// loop per room ringing into nothing. Sweeping one pair means a portal is a
// *transition* rather than a switch.

/** Per-room reverb: delay time, feedback, damping cutoff, wet level. */
export interface RoomTone {
  time: number;
  fb:   number;
  damp: number;
  wet:  number;
}

export interface RoomReverb {

  /** Send into here; the tail comes out of `out`. */
  readonly wet: GainNode;

  /** Glide every parameter to a room. Only call it when the room changes. */
  tune(room: RoomTone, now: number, glide: number): void;
}

/** The second, longer tap, at a ratio that never lines up into a pitch. */
const TAIL_RATIO    = 3.7
const TAIL_FEEDBACK = 0.8

/** Build the reverb into `out`, tuned to `room` and sending at `wetLevel`. */
export function createRoomReverb (ctx: AudioContext, out: AudioNode, room: RoomTone, wetLevel: number): RoomReverb {
  const now = ctx.currentTime

  const wet = ctx.createGain()
  wet.gain.setValueAtTime(wetLevel, now)

  const tap = ctx.createDelay(0.5)
  tap.delayTime.setValueAtTime(room.time, now)

  const damp = ctx.createBiquadFilter()
  damp.type  = 'lowpass'
  damp.frequency.setValueAtTime(room.damp, now)

  const tapFb = ctx.createGain()
  tapFb.gain.setValueAtTime(room.fb, now)

  const tail = ctx.createDelay(2)
  tail.delayTime.setValueAtTime(room.time * TAIL_RATIO, now)

  const tailFb = ctx.createGain()
  tailFb.gain.setValueAtTime(room.fb * TAIL_FEEDBACK, now)

  wet.connect(tap)
  tap.connect(damp)
  damp.connect(tapFb)
  tapFb.connect(tap)
  damp.connect(tail)
  tail.connect(tailFb)
  tailFb.connect(tail)
  tail.connect(out)
  damp.connect(out)

  return {
    wet,
    tune (r, at, glide) {
      tap.delayTime.setTargetAtTime(r.time, at, glide)
      tail.delayTime.setTargetAtTime(r.time * TAIL_RATIO, at, glide)
      tapFb.gain.setTargetAtTime(r.fb, at, glide)
      tailFb.gain.setTargetAtTime(r.fb * TAIL_FEEDBACK, at, glide)
      damp.frequency.setTargetAtTime(r.damp, at, glide)
      wet.gain.setTargetAtTime(r.wet, at, glide)
    },
  }
}
