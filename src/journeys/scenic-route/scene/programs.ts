import { createGlProgram } from '@wjh/gl/program'
import { blurFrag, brightFrag, compositeFrag } from '../shader/post'
import { cockpitFrag, cockpitVert } from '../shader/cockpit'
import { depthFrag, meshVert, propDepthFrag, propFrag, propVert, seaFrag, seaVert, sweepVert, terrainFrag, towerFrag, towerVert } from '../shader/world'
import { jawFrag, jawVert, mawFrag, railFrag, roadFrag, tubeFrag, waterFrag } from '../shader/maw'
import { postVert, skyDomeFrag, skyLutFrag, skyVert } from '../shader/sky'

/** Every program the scene draws with, or null if any failed to build. */
export function createPrograms (gl: WebGL2RenderingContext) {
  const skyLutP     = createGlProgram(gl, postVert, skyLutFrag)
  const skyDomeP    = createGlProgram(gl, skyVert, skyDomeFrag)
  const roadP       = createGlProgram(gl, sweepVert, roadFrag)
  const roadDepthP  = createGlProgram(gl, sweepVert, depthFrag)
  const terrainP    = createGlProgram(gl, meshVert, terrainFrag)
  const meshDepthP  = createGlProgram(gl, meshVert, depthFrag)
  const seaP        = createGlProgram(gl, seaVert, seaFrag)
  const mawP        = createGlProgram(gl, sweepVert, mawFrag)
  const jawP        = createGlProgram(gl, jawVert, jawFrag)
  const jawDepthP   = createGlProgram(gl, jawVert, depthFrag)
  const tubeP       = createGlProgram(gl, sweepVert, tubeFrag)
  const waterP      = createGlProgram(gl, sweepVert, waterFrag)
  const cockpitP    = createGlProgram(gl, cockpitVert, cockpitFrag)
  const propP       = createGlProgram(gl, propVert, propFrag)
  const propDepthP  = createGlProgram(gl, propVert, propDepthFrag)
  const railP       = createGlProgram(gl, sweepVert, railFrag)
  const towerP      = createGlProgram(gl, towerVert, towerFrag)
  const towerDepthP = createGlProgram(gl, towerVert, depthFrag)
  const brightP     = createGlProgram(gl, postVert, brightFrag)
  const blurP       = createGlProgram(gl, postVert, blurFrag)
  const compP       = createGlProgram(gl, postVert, compositeFrag)
  if (!skyLutP || !skyDomeP || !roadP || !roadDepthP || !terrainP || !meshDepthP || !seaP ||
    !propP || !propDepthP || !railP || !towerP || !towerDepthP || !brightP || !blurP || !compP ||
    !mawP || !jawP || !jawDepthP || !tubeP || !waterP || !cockpitP)
    return null

  return { skyLutP, skyDomeP, roadP, roadDepthP, terrainP, meshDepthP, seaP, mawP, jawP, jawDepthP, tubeP, waterP, cockpitP, propP, propDepthP, railP, towerP, towerDepthP, brightP, blurP, compP }
}
