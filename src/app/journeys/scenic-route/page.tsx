'use client'

import { withGeometryJourney } from '@/components/withGeometryJourney'
import { createScenicRouteSimulation } from './kinematics'
import { createScenicRouteAudio } from './audio'
import { createScenicRouteScene } from './scene'


export default withGeometryJourney(createScenicRouteScene, {
  accent:                '#ffb054',
  createSimulation:      createScenicRouteSimulation,
  createAudioEngine:     createScenicRouteAudio,
  sectionTitleClassName: 'scenic-route-sector-title',
})
