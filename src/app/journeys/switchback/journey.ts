// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '✦/lib/journey'
import { createSwitchbackAudio } from './audio'
import { createSwitchbackSimulation } from './kinematics'
import { switchbackFrag } from './shader'


export const switchback = defineJourney({
  slug:                  'switchback',
  renderer:              shaderRenderer(switchbackFrag),
  createAudio:           createSwitchbackAudio,
  createSimulation:      createSwitchbackSimulation,
  sectionTitleClassName: 'switchback-sector-title',
})

export default switchback
