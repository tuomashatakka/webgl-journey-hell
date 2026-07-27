'use client'

import { withShaderJourney } from '@/components/withShaderJourney'
import { createFoundrySimulation } from './kinematics'
import { foundryFrag } from './shader'


export default withShaderJourney(foundryFrag, {
  accent:                '#ff8a3d',
  createSimulation:      createFoundrySimulation,
  sectionTitleClassName: 'foundry-sector-title',
})
