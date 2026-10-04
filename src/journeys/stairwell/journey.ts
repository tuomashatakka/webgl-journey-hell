// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, passRenderer } from '@wjh/journey/definition'
import { createStairwellAudio } from './audio'
import { createStairwellSimulation } from './kinematics'
import { createStairwellRenderer } from './renderer'


const stairwell = defineJourney({
  slug:             'stairwell',
  renderer:         passRenderer(createStairwellRenderer),
  createAudio:      createStairwellAudio,
  createSimulation: createStairwellSimulation,
})

export default stairwell
