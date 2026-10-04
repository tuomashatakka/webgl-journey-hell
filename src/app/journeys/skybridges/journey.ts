// The journey, declared once: its page and the bare harness both run this.

import { defineJourney, shaderRenderer } from '✦/lib/journey'
import { getSkybridgesMarks, getSkybridgesSectionName } from './kinematics'
import { skybridgesFrag } from './shader'


export const skybridges = defineJourney({
  slug:                  'skybridges',
  renderer:              shaderRenderer(skybridgesFrag, { envMapUrl: '/journeys/skybridges/env.png' }),
  marksAt:               getSkybridgesMarks,
  sectionNameAt:         getSkybridgesSectionName,
  sectionTitleClassName: 'skybridges-sector-title',
})

export default skybridges
