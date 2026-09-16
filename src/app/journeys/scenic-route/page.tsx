'use client'

import { withGeometryJourney } from '@/components/withGeometryJourney'
import { createScenicRouteSimulation } from './kinematics'
import { createScenicRouteScene } from './scene'


export default withGeometryJourney(createScenicRouteScene, {
  accent:                '#ffb054',
  createSimulation:      createScenicRouteSimulation,
  sectionTitleClassName: 'scenic-route-sector-title',
})
