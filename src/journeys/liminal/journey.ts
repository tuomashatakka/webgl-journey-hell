// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, passRenderer } from '@wjh/journey/definition'
import { createLiminalAudio } from './audio'
import { createLiminalSimulation } from './kinematics'
import { createLiminalRenderer } from './renderer'


const liminal = defineJourney({
  slug:             'liminal',
  renderer:         passRenderer(createLiminalRenderer),
  createAudio:      createLiminalAudio,
  createSimulation: createLiminalSimulation,
})

export default liminal
