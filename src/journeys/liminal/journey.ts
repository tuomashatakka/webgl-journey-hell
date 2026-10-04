// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, passRendererWebGL1 } from '@wjh/journey/definition'
import { createLiminalAudio } from './audio'
import { createLiminalSimulation } from './kinematics'
import { createLiminalRenderer } from './renderer'


const liminal = defineJourney({
  slug:             'liminal',
  renderer:         passRendererWebGL1(createLiminalRenderer),
  createAudio:      createLiminalAudio,
  createSimulation: createLiminalSimulation,
})

export default liminal
