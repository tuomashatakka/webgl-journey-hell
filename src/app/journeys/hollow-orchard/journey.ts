// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '✦/lib/journey'
import { createHollowOrchardAudio } from './audio'
import { createHollowOrchardSimulation } from './kinematics'
import { hollowOrchardFrag } from './shader'


export const hollowOrchard = defineJourney({
  slug:                  'hollow-orchard',
  renderer:              shaderRenderer(hollowOrchardFrag),
  createAudio:           createHollowOrchardAudio,
  createSimulation:      createHollowOrchardSimulation,
  sectionTitleClassName: 'hollow-orchard-sector-title',
})

export default hollowOrchard
