// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '✦/lib/journey'
import { createFoundrySimulation } from './kinematics'
import { foundryFrag } from './shader'


export const foundry = defineJourney({
  slug:                  'foundry',
  renderer:              shaderRenderer(foundryFrag),
  createSimulation:      createFoundrySimulation,
  sectionTitleClassName: 'foundry-sector-title',
})

export default foundry
