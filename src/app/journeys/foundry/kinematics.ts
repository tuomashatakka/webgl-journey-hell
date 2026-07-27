// THE FOUNDRY — simulation driver + section timeline.
//
// Bridges physics.ts to the shader: owns one FoundryState, advances it on the
// shared frame loop, packs the result into uniform arrays, and derives the HUD
// section label. Unlike the other journeys the label is *not* a function of
// time — it is a function of where the cage actually is and what it is doing,
// so a slow-motion run reports the same sections in the same order.

import {
  advance,
  createFoundryState,
  pistonExtension,
  PHASE_BRAKING,
  PHASE_BUFFER,
  PHASE_FREEFALL,
  PHASE_WALK,
  SECTION_COUNT,
  SECTION_LEN

} from './physics'
import type { FoundryState } from './physics'
import type { JourneySimulation } from '@/components/withShaderJourney'


export interface FoundrySection {
  id:   number
  name: string
}

// Seven 200 m bands, each a distinct machine environment. The shader keys its
// geometry, shaft width, rib/lamp cadence and palette off the same indices —
// SECTION_LEN is the single source of truth for where each one starts.
export const FOUNDRY_SECTIONS: FoundrySection[] = [
  { id: 1, name: 'SECTION 1: LOADING BAY' },
  { id: 2, name: 'SECTION 2: PISTON GALLERY' },
  { id: 3, name: 'SECTION 3: THE LONG RUN' },
  { id: 4, name: 'SECTION 4: COOLANT TIER' },
  { id: 5, name: 'SECTION 5: GEARWORKS' },
  { id: 6, name: 'SECTION 6: BRAKE RUN' },
  { id: 7, name: 'SECTION 7: FURNACE FLOOR' },
]

/** Shown instead of the band name while the cage is doing something drastic. */
const PHASE_LABELS: Record<number, string> = {
  [PHASE_FREEFALL]: 'THE CABLE PARTS',
  [PHASE_BRAKING]:  'EMERGENCY SHOES',
  [PHASE_BUFFER]:   'HYDRAULIC FLOOR',
  [PHASE_WALK]:     'THE FOLDING PATH',
}

export function sectionFor (state: FoundryState): FoundrySection {
  const band = Math.min(
    SECTION_COUNT - 1,
    Math.max(0, Math.floor(-state.y / SECTION_LEN)),
  )
  return FOUNDRY_SECTIONS[band]
}

/**
 * The HUD label. Depth picks the section; a dramatic phase overrides the name
 * but keeps the section number, so you always know both where you are and what
 * is happening to you.
 */
export function labelFor (state: FoundryState): string {
  // The walk leaves the shaft entirely, so it gets its own section number
  // rather than borrowing the band the cage happens to be parked in.
  if (state.phase === PHASE_WALK)
    return `SECTION ${SECTION_COUNT + 1}: ${PHASE_LABELS[PHASE_WALK]}`

  const section  = sectionFor(state)
  const override = PHASE_LABELS[state.phase]
  return override
    ? `SECTION ${section.id}: ${override}`
    : section.name
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

      // Cross-fade into the walk over the first few metres, so stepping out of
      // the cage dissolves the shaft rather than cutting to it.
      const walkBlend = state.phase === PHASE_WALK
        ? Math.min(1, state.walkZ / 4)
        : 0

      return {
        uCage:    [ state.y, state.v, state.a, state.phase ],
        uWalk:    [ state.walkZ, state.cubeBase, walkBlend, state.walkV ],
        uFold0:   fold0,
        uFold1:   fold1,
        uSim:     [ state.shakeX, state.shakeY, state.spark, state.cableIntact ? 1 : 0 ],
        uMech:    [ state.crank, pistonExtension(state.crank), state.hook, state.crankOmega ],
        uDebris:  debris,
        uDebrisQ: debrisQ,
      }
    },

    label () {
      return labelFor(state)
    },
  }
}
