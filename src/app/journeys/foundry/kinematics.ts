// THE FOUNDRY — simulation driver + section timeline.
//
// Bridges physics.ts to the shader: owns one FoundryState, advances it on the
// shared frame loop, packs the result into uniform arrays, and derives the HUD
// section label. Unlike the other journeys the label is *not* a function of
// time — it is a function of what the lift is doing to you and, once you are on
// foot, of how far you have actually walked, so a slow-motion run reports the
// same sections in the same order.

import {
  advance,
  createFoundryState,
  decayFor,
  LAP_ARC,
  MODE_BOARD,
  MODE_BRAKE,
  MODE_FALL,
  MODE_OBLIVION,
  MODE_SETTLE,
  MODE_WALK,
  OBLIVION_LOOP,
  pistonExtension,
  SECTION_COUNT,
  SECTION_LEN,
  shaftHeadFor,
  SPAN_ARC,
  SPAN_TILES,
  tileArc
} from './physics'
import type { FoundryState } from './physics'
import type { JourneySimulation } from '@/components/withShaderJourney'
import type { JourneyMarks } from '@/lib/journeyTransport'


export interface FoundrySection {
  id:   number
  name: string
}

// Seven 36 m halls in a ring, each a distinct machine environment. The shader
// keys its geometry, corridor profile, rib/lamp cadence and palette off the same
// indices — SECTION_LEN is the single source of truth for where each one starts,
// and the seventh runs straight back into the first.
export const FOUNDRY_SECTIONS: FoundrySection[] = [
  { id: 1, name: 'SECTION 1: LOADING BAY' },
  { id: 2, name: 'SECTION 2: PISTON GALLERY' },
  { id: 3, name: 'SECTION 3: THE LONG RUN' },
  { id: 4, name: 'SECTION 4: COOLANT TIER' },
  { id: 5, name: 'SECTION 5: GEARWORKS' },
  { id: 6, name: 'SECTION 6: BRAKE RUN' },
  { id: 7, name: 'SECTION 7: FURNACE FLOOR' },
]

/** Shown instead of the hall name while something drastic is happening. */
const EVENT_FALL     = 'THE CABLE PARTS'
const EVENT_SHOES    = 'EMERGENCY SHOES'
const EVENT_SLIPPING = 'THE SHOES WILL NOT HOLD'
const EVENT_LANDING  = 'THE GATE OPENS'
const EVENT_BOARD    = 'THE SHUTTER'
const EVENT_SPAN     = 'THE STEPPING STONES'
const EVENT_OBLIVION = 'THE PIT HAS NO FLOOR'

export function sectionFor (state: FoundryState): FoundrySection {
  const band = Math.min(
    SECTION_COUNT - 1,
    Math.max(0, Math.floor(state.z / SECTION_LEN)),
  )
  return FOUNDRY_SECTIONS[band]
}

/**
 * True while the walker is out over the melt on the tumbling plate.
 *
 * Measured along the route rather than in z, for the same reason stepSpan is:
 * the crossing spends a third of its length going sideways, and in z alone the
 * middle of it is indistinguishable from standing on the lip.
 */
function onSpan (state: FoundryState): boolean {
  const arc = state.dist - (state.lapEnd - LAP_ARC)
  return arc >= tileArc(0) - 1 && arc <= tileArc(0) + SPAN_ARC + 1
}

/** The ride's own label, or '' once you are on foot. */
function rideEvent (state: FoundryState): string {
  if (state.mode === MODE_OBLIVION)
    return EVENT_OBLIVION
  if (state.mode === MODE_FALL)
    return EVENT_FALL
  if (state.mode === MODE_BRAKE)
    return state.loop >= OBLIVION_LOOP ? EVENT_SLIPPING : EVENT_SHOES
  if (state.mode === MODE_SETTLE)
    return EVENT_LANDING
  if (state.mode === MODE_BOARD)
    return EVENT_BOARD
  return ''
}

/**
 * The HUD label. Position picks the hall; an event overrides the name but keeps
 * the section number, so you always know both where you are and what is
 * happening to you. The lift lands in the loading bay, so the whole drop reports
 * as section 1 — the journey opens on `SECTION 1: THE CABLE PARTS`. From the
 * second lap on it is prefixed with the lap count, because by then the halls are
 * no longer quite the ones you walked.
 */
export function labelFor (state: FoundryState): string {
  const section = sectionFor(state)

  let event = rideEvent(state)
  if (!event && state.mode === MODE_WALK && onSpan(state))
    event = EVENT_SPAN

  const name = event ? `SECTION ${section.id}: ${event}` : section.name
  return state.loop > 0 ? `LOOP ${state.loop + 1} · ${name}` : name
}

/**
 * One simulation instance per mount. The HOC calls step() on the shared,
 * frame-capped loop and uniforms() immediately after, so the shader always
 * sees the state produced by the sub-steps of that same frame.
 */
export function createFoundrySimulation (): JourneySimulation {
  const state = createFoundryState()
  let carry = 0

  // Inside the simulation, so a ?t= seek rebuilds it. See lib/signalLoss.
  let signalAge = 0

  // Scratch buffers — packed in place every frame, never reallocated.
  const debris  = new Array<number>(24).fill(0)
  const debrisQ = new Array<number>(24).fill(0)
  const folds   = [
    new Array<number>(4).fill(0),
    new Array<number>(4).fill(0),
    new Array<number>(4).fill(0),
    new Array<number>(4).fill(0),
  ]

  return {
    step (dt: number) {
      carry = advance(state, dt, carry)
      // The foundry's ending is a real one now, so the signal goes with it
      // rather than on a lap count: nothing comes after MODE_OBLIVION.
      if (state.mode === MODE_OBLIVION)
        signalAge += dt
    },

    uniforms () {
      for (let i = 0; i < 6; i++) {
        const b        = state.debris[i]
        const o        = i * 4
        debris[o]      = b.px
        debris[o + 1]  = b.py
        debris[o + 2]  = b.pz
        debris[o + 3]  = b.scale
        debrisQ[o]     = b.qx
        debrisQ[o + 1] = b.qy
        debrisQ[o + 2] = b.qz
        debrisQ[o + 3] = b.qw
      }
      for (let i = 0; i < SPAN_TILES; i++)
        folds[i >> 2][i & 3] = state.fold[i]

      // The camera is in the cage for every phase but the walk, which is what
      // uRide.x switches: it moves the eye into the car and lets the shader skip
      // the corridor entirely while you are up the shaft.
      const riding = state.mode === MODE_WALK ? 0 : 1

      return {
        // Cyclic position, not total distance: the shader's world is periodic,
        // so keeping the camera inside one lap costs no precision after an hour.
        uWalk: [ state.z, state.smoothLoop, decayFor(state.smoothLoop), state.roll ],
        // The route's lateral offset rides in with the sway because the shader's
        // only consumer of that slot is the eye's x — the two are the same
        // number to everything downstream, and the sway alone was never it.
        uGait: [ state.eyeY, state.sway + state.lateral, state.yaw, state.pitch ],
        uRide: [ riding, state.shutter, state.gate, state.modeTime ],
        uCage: [ state.y, state.cageV, state.cageA, state.mode ],
        uSim:  [ state.shakeX, state.shakeY, state.spark, state.cableIntact ? 1 : 0 ],
        uMech: [ state.crank, pistonExtension(state.crank), state.hook, state.chain ],
        uFall: [
          state.fallen,
          state.mode === MODE_OBLIVION ? state.modeTime : 0,
          shaftHeadFor(state.loop),
          state.mode === MODE_OBLIVION ? 1 : 0,
        ],
        uFold0:   folds[0],
        uFold1:   folds[1],
        uFold2:   folds[2],
        uFold3:   folds[3],
        uDebris:  debris,
        uDebrisQ: debrisQ,
      }
    },

    label () {
      return labelFor(state)
    },

    /**
     * One lap of the seven-hall ring. `state.z` is already cyclic — the shader's
     * world is periodic — so it doubles as the position within the lap.
     */
    marks (): JourneyMarks {
      return {
        loop:         state.loop,
        section:      sectionFor(state).id,
        sectionCount: SECTION_COUNT,
        progress:     Math.min(1, state.z / (SECTION_LEN * SECTION_COUNT)),
        signalAge,
      }
    },
  }
}
