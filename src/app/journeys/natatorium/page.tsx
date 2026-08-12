'use client'

import { withShaderJourney } from '@/components/withShaderJourney'
import { createNatatoriumAudio } from './audio'
import { createNatatoriumSimulation } from './kinematics'
import { natatoriumFrag } from './shader'


export default withShaderJourney(natatoriumFrag, {
  accent:                '#67d5e0',
  createAudioEngine:     createNatatoriumAudio,
  createSimulation:      createNatatoriumSimulation,
  sectionTitleClassName: 'natatorium-sector-title',
})
