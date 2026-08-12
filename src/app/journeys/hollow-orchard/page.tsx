'use client'

import { withShaderJourney } from '@/components/withShaderJourney'
import { createHollowOrchardAudio } from './audio'
import { createHollowOrchardSimulation } from './kinematics'
import { hollowOrchardFrag } from './shader'


export default withShaderJourney(hollowOrchardFrag, {
  accent:                '#d8a13a',
  createAudioEngine:     createHollowOrchardAudio,
  createSimulation:      createHollowOrchardSimulation,
  sectionTitleClassName: 'hollow-orchard-sector-title',
})
