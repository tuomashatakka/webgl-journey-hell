'use client'

import { withGeometryJourney } from '@/components/withGeometryJourney'
import { createLoopLineAudio } from './audio'
import { createLoopLineSimulation } from './kinematics'
import { createLoopLineScene } from './scene'


export default withGeometryJourney(createLoopLineScene, {
  accent:                '#b39dff',
  createAudioEngine:     createLoopLineAudio,
  createSimulation:      createLoopLineSimulation,
  sectionTitleClassName: 'loop-line-sector-title',
})
