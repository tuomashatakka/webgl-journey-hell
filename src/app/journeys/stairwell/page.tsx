'use client'

import { withJourneyShell } from '✦/components/withJourneyShell'
import { createStairwellAudio } from './audio'
import { createStairwellSimulation } from './kinematics'
import { createStairwellRenderer } from './renderer'


// WebGL2 since the rewrite: the Δ library is texture arrays, and the scene is
// GLSL ES 3.00. The canvas keeps the shell's other defaults (no depth, no
// antialias) — a raymarch resolves its own visibility.
export default withJourneyShell(createStairwellRenderer, {
  accent:                '#9ed9ff',
  contextType:           'webgl2',
  createAudioEngine:     createStairwellAudio,
  createSimulation:      createStairwellSimulation,
  sectionTitleClassName: 'stairwell-sector-title',
})
