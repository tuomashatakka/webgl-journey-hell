// The loop line's audio data: the joint constants, one room tone per bay, and
// the syllable pattern of each bay's announcement.

import type { RoomTone } from '@wjh/audio/room'


/** Rail length in metres — joint impacts fire every JOINT_PITCH of travel. */
export const JOINT_PITCH = 12.5

/** Bogie wheelbase in metres — the gap between the two impacts of one joint. */
export const WHEELBASE = 2.2

/** Maximum joints to fire in a single update frame. */
export const MAX_JOINTS = 4

/**
 * Seven rooms, one per bayId 0..6.
 *
 * THE CHORD's 8 ms tap is not a reverb — it is the sound of being in a pipe.
 * THE TURNBACK's near-zero wet is not a mistake — it is the absence that lets
 * the other rooms exist.
 */
export const ROOMS: RoomTone[] = [
  { time: 0.013, fb: 0.82, damp: 3800, wet: 0.52 }, // 0 — PLATFORM SIX, tiled flutter
  { time: 0.042, fb: 0.36, damp: 850, wet: 0.32 }, // 1 — THE CONCOURSE, big vaulted
  { time: 0, fb: 0, damp: 8000, wet: 0 }, // 2 — THE CUT, open air, no tail
  { time: 0.016, fb: 0.45, damp: 1400, wet: 0.28 }, // 3 — THE ANNEX, flooded chamber
  { time: 0.008, fb: 0.2, damp: 6000, wet: 0.15 }, // 4 — THE STACKS, machine hall
  { time: 0, fb: 0, damp: 8000, wet: 0.02 }, // 5 — THE TURNBACK, open void
  { time: 0.008, fb: 0.55, damp: 1200, wet: 0.4 }, // 6 — THE CHORD, close bore
]

// Syllable patterns for the formant announcement — one per bay. Each is 3-6
// syllables defined as [frequency, duration] pairs. The pitches are deliberately
// not in tune with each other; they are the cadence of a station announcement,
// not music.
export const SYLLABLES: [number, number][][] = [
  [[ 280, 0.11 ], [ 310, 0.09 ], [ 260, 0.13 ]], // PLATFORM SIX
  [[ 250, 0.1 ], [ 300, 0.1 ], [ 270, 0.09 ], [ 320, 0.11 ]], // THE CONCOURSE
  [[ 290, 0.12 ], [ 260, 0.1 ]], // THE CUT
  [[ 270, 0.09 ], [ 310, 0.11 ], [ 250, 0.1 ], [ 290, 0.08 ], [ 330, 0.09 ]], // THE ANNEX
  [[ 300, 0.1 ], [ 260, 0.12 ], [ 320, 0.09 ]], // THE STACKS
  [[ 260, 0.11 ], [ 290, 0.1 ], [ 270, 0.13 ], [ 310, 0.09 ]], // THE TURNBACK
  [[ 280, 0.12 ], [ 310, 0.1 ], [ 250, 0.11 ], [ 300, 0.09 ], [ 270, 0.1 ], [ 320, 0.08 ]], // THE CHORD
]
