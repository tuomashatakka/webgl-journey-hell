// THE FOUNDRY — simulation driver + section timeline.
//
// Bridges physics.ts to the shader: owns one FoundryState, advances it on the
// shared frame loop, packs the result into uniform arrays, and derives the HUD
// section label. Unlike the other journeys the label is *not* a function of
// time — it is a function of how far the walker has actually walked and what the
// machinery is doing to them, so a slow-motion run reports the same sections in
// the same order.

import {
  advance,
  CAGE_BRAKING,
  CAGE_BUFFER,
  CAGE_FREEFALL,
  createFoundryState,
  CROSS_Z,
  CUBE_SPACING,
  cycDelta,
  decayFor,
  pistonExtension,
  SECTION_COUNT,
  SECTION_LEN,
  SPAN_CUBES,
  SPAN_Z0
} from './physics'
import type { FoundryState } from './physics'
import type { JourneySimulation } from '@/components/withShaderJourney'


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

/** Metres either side of the crossing over which the cage's plunge takes the label. */
const CAGE_EARSHOT = 34

/** Seconds the buffer slam keeps the label after the cage has stopped moving. */
const SLAM_ECHO = 3

/** Shown instead of the hall name while something drastic is happening. */
const EVENT_CABLE = 'THE CABLE PARTS'
const EVENT_SHOES = 'EMERGENCY SHOES'
const EVENT_SLAM  = 'HYDRAULIC FLOOR'
const EVENT_SPAN  = 'THE FOLDING SPAN'

export function sectionFor (state: FoundryState): FoundrySection {
  const band = Math.min(
    SECTION_COUNT - 1,
    Math.max(0, Math.floor(state.z / SECTION_LEN)),
  )
  return FOUNDRY_SECTIONS[band]
}

/** True while the walker is out over the melt on the unfolding cubes. */
function onSpan (state: FoundryState): boolean {
  const first = cycDelta(SPAN_Z0 - CUBE_SPACING * 0.5, state.z)
  const last  = cycDelta(SPAN_Z0 + (SPAN_CUBES - 0.5) * CUBE_SPACING, state.z)
  return first <= 0 && last >= 0
}

/**
 * The HUD label. Position picks the hall; a nearby event overrides the name but
 * keeps the section number, so you always know both where you are and what is
 * happening to you. From the second circuit on it is prefixed with the loop
 * count, because by then the halls are no longer quite the ones you walked.
 */
export function labelFor (state: FoundryState): string {
  const section = sectionFor(state)
  const toCross = cycDelta(CROSS_Z, state.z)

  let event = ''
  if (Math.abs(toCross) < CAGE_EARSHOT) {
    if (state.phase === CAGE_FREEFALL)
      event = EVENT_CABLE
    else if (state.phase === CAGE_BRAKING)
      event = EVENT_SHOES
    else if (state.phase === CAGE_BUFFER && state.settleTime < SLAM_ECHO)
      event = EVENT_SLAM
  }
  if (!event && onSpan(state))
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

  // Scratch buffers — packed in place every frame, never reallocated.
  const debris  = new Array<number>(24).fill(0)
  const debrisQ = new Array<number>(24).fill(0)
  const fold0   = new Array<number>(4).fill(0)
  const fold1   = new Array<number>(4).fill(0)

  return {
    step (dt: number) {
      carry = advance(state, dt, carry)
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
      for (let i = 0; i < 4; i++) {
        fold0[i] = state.fold[i]
        fold1[i] = state.fold[i + 4]
      }

      return {
        // Cyclic position, not total distance: the shader's world is periodic,
        // so keeping the camera inside one loop costs no precision after an hour.
        uWalk:    [ state.z, state.smoothLoop, decayFor(state.smoothLoop), state.roll ],
        uGait:    [ state.eyeY, state.sway, state.yaw, state.pitch ],
        uCage:    [ state.y, state.cageV, state.cageA, state.phase ],
        uSim:     [ state.shakeX, state.shakeY, state.spark, state.cableIntact ? 1 : 0 ],
        uMech:    [ state.crank, pistonExtension(state.crank), state.hook, state.chain ],
        uFold0:   fold0,
        uFold1:   fold1,
        uDebris:  debris,
        uDebrisQ: debrisQ,
      }
    },

    label () {
      return labelFor(state)
    },
  }
}
