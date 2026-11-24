import { defineJourney, geometryRenderer } from '@wjh/journey/definition'
import { createStillwaterAudio } from './audio'
import { createStillwaterScene } from './scene'
import { stillwaterLabelAt, stillwaterMarksAt } from './timeline'


export default defineJourney({
  slug:          'stillwater-service',
  renderer:      geometryRenderer(createStillwaterScene),
  createAudio:   createStillwaterAudio,
  marksAt:       stillwaterMarksAt,
  sectionNameAt: stillwaterLabelAt,
})
