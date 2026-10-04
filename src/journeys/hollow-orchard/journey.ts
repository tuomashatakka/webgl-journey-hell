// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '@wjh/journey/definition'
import { createHollowOrchardAudio } from './audio'
import { createHollowOrchardSimulation } from './kinematics'
import { hollowOrchardFrag } from './shader'


const hollowOrchard = defineJourney({
  slug:             'hollow-orchard',
  renderer:         shaderRenderer(hollowOrchardFrag),
  createAudio:      createHollowOrchardAudio,
  createSimulation: createHollowOrchardSimulation,
})

export default hollowOrchard
