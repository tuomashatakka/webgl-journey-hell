// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, passRenderer } from '✦/lib/journey'
import { createStairwellAudio } from './audio'
import { createStairwellSimulation } from './kinematics'
import { createStairwellRenderer } from './renderer'


export const stairwell = defineJourney({
  slug:                  'stairwell',
  renderer:              passRenderer(createStairwellRenderer),
  createAudio:           createStairwellAudio,
  createSimulation:      createStairwellSimulation,
  sectionTitleClassName: 'stairwell-sector-title',
})

export default stairwell
