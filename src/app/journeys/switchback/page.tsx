'use client'

import { withShaderJourney } from '@/components/withShaderJourney'
import { createSwitchbackAudio } from './audio'
import { createSwitchbackSimulation } from './kinematics'
import { switchbackFrag } from './shader'


export default withShaderJourney(switchbackFrag, {
  accent:                '#ff9ec4',
  createAudioEngine:     createSwitchbackAudio,
  createSimulation:      createSwitchbackSimulation,
  sectionTitleClassName: 'switchback-sector-title',
})
