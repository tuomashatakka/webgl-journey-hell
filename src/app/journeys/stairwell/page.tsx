'use client'

import { withJourneyShell } from '@/components/withJourneyShell'
import { createStairwellAudio } from './audio'
import { createStairwellSimulation } from './kinematics'
import { createStairwellRenderer } from './renderer'


export default withJourneyShell(createStairwellRenderer, {
  accent:                '#9ed9ff',
  createAudioEngine:     createStairwellAudio,
  createSimulation:      createStairwellSimulation,
  sectionTitleClassName: 'stairwell-sector-title',
})
