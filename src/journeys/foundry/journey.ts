// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '@wjh/journey/definition'
import { createFoundrySimulation } from './kinematics'
import { foundryFrag } from './shader'


const foundry = defineJourney({
  slug:             'foundry',
  renderer:         shaderRenderer(foundryFrag),
  createSimulation: createFoundrySimulation,
})

export default foundry
