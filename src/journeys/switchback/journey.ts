// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '@wjh/journey/definition'
import { createSwitchbackAudio } from './audio'
import { createSwitchbackSimulation } from './kinematics'
import { switchbackFrag } from './shader'


const switchback = defineJourney({
  slug:             'switchback',
  renderer:         shaderRenderer(switchbackFrag),
  createAudio:      createSwitchbackAudio,
  createSimulation: createSwitchbackSimulation,
})

export default switchback
