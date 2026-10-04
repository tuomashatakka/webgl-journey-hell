// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, geometryRenderer } from '@wjh/journey/definition'
import { createScenicRouteAudio } from './audio'
import { createScenicRouteSimulation } from './kinematics'
import { createScenicRouteScene } from './scene'


export const scenicRoute = defineJourney({
  slug:             'scenic-route',
  renderer:         geometryRenderer(createScenicRouteScene),
  createAudio:      createScenicRouteAudio,
  createSimulation: createScenicRouteSimulation,
})

export default scenicRoute
