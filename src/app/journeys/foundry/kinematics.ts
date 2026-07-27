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
  PHASE_HOIST

} from './physics'
import type { FoundryState } from './physics'
import type { JourneySimulation } from '@/components/withShaderJourney'


export interface FoundrySection {
  id:   number
  name: string
}

export const FOUNDRY_SECTIONS: FoundrySection[] = [
  { id: 1, name: 'SECTION 1: LOADING BAY' },
  { id: 2, name: 'SECTION 2: PISTON GALLERY' },
  { id: 3, name: 'SECTION 3: THE LONG RUN' },
  { id: 4, name: 'SECTION 4: THE CABLE PARTS' },
  { id: 5, name: 'SECTION 5: EMERGENCY SHOES' },
  { id: 6, name: 'SECTION 6: HYDRAULIC FLOOR' },
  { id: 7, name: 'SECTION 7: THE HAUL BACK' },
]

export function sectionFor (state: FoundryState): FoundrySection {
  if (state.phase === PHASE_HOIST)
    return FOUNDRY_SECTIONS[6]
  if (state.phase === PHASE_BUFFER)
    return FOUNDRY_SECTIONS[5]
  if (state.phase === PHASE_BRAKING)
    return FOUNDRY_SECTIONS[4]
  if (state.phase === PHASE_FREEFALL)
    return FOUNDRY_SECTIONS[3]
  if (state.y > -22)
    return FOUNDRY_SECTIONS[0]
  if (state.y > -50)
    return FOUNDRY_SECTIONS[1]
  return FOUNDRY_SECTIONS[2]
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
      return {
        uCage:    [ state.y, state.v, state.a, state.phase ],
        uSim:     [ state.shakeX, state.shakeY, state.spark, state.cableIntact ? 1 : 0 ],
        uMech:    [ state.crank, pistonExtension(state.crank), state.hook, state.crankOmega ],
        uDebris:  debris,
        uDebrisQ: debrisQ,
      }
    },

    label () {
      return sectionFor(state).name
    },
  }
}
