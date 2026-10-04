// The journey, declared once: its page and the bare harness both run this.

import { staticUrl } from '@wjh/web/assetUrl'
import skybridgesEnv from '../../../assets/textures/skybridges-env.png'
import { defineJourney, shaderRenderer } from '@wjh/journey/definition'
import { getSkybridgesMarks, getSkybridgesSectionName } from './kinematics'
import { skybridgesFrag } from './shader'


const skybridges = defineJourney({
  slug:          'skybridges',
  renderer:      shaderRenderer(skybridgesFrag, { envMapUrl: staticUrl(skybridgesEnv) }),
  marksAt:       getSkybridgesMarks,
  sectionNameAt: getSkybridgesSectionName,
})

export default skybridges
