// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, geometryRenderer } from '✦/lib/journey'
import { createLoopLineAudio } from './audio'
import { createLoopLineSimulation } from './kinematics'
import { createLoopLineScene } from './scene'


export const loopLine = defineJourney({
  slug:                  'loop-line',
  renderer:              geometryRenderer(createLoopLineScene),
  createAudio:           createLoopLineAudio,
  createSimulation:      createLoopLineSimulation,
  sectionTitleClassName: 'loop-line-sector-title',
})

export default loopLine
