'use client'

import { withShaderJourney } from '@/components/withShaderJourney'
import { getSkybridgesSectionName } from './kinematics'
import { skybridgesFrag } from './shader'


export default withShaderJourney(skybridgesFrag, {
  accent:                '#9fd8ff',
  getSectionName:        getSkybridgesSectionName,
  sectionTitleClassName: 'skybridges-sector-title',
  envMapUrl:             '/journeys/skybridges/env.png',
})
