// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, passRenderer } from '@wjh/journey/definition'
import { createFoundrySimulation } from './kinematics'
import { createFoundryRenderer } from './renderer'


const foundry = defineJourney({
  slug:             'foundry',
  renderer:         passRenderer(createFoundryRenderer),
  createSimulation: createFoundrySimulation,
})

export default foundry
