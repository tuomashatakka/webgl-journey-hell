// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '✦/lib/journey'
import { createNatatoriumAudio } from './audio'
import { createNatatoriumSimulation } from './kinematics'
import { natatoriumFrag } from './shader'


export const natatorium = defineJourney({
  slug:                  'natatorium',
  renderer:              shaderRenderer(natatoriumFrag),
  createAudio:           createNatatoriumAudio,
  createSimulation:      createNatatoriumSimulation,
  sectionTitleClassName: 'natatorium-sector-title',
})

export default natatorium
