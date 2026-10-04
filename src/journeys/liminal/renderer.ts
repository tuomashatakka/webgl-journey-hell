// THE LIMINAL JOURNEY — the renderer.
//
// Two passes on WebGL 2: the corridor is raymarched into an 8-bit target the
// size of the canvas, its walls the Δ scans, then the post pass (fisheye,
// chromatic split, the loop fades) draws it to the screen. The shared CRT
// pass goes over the top.
//
// The scene comes in two builds (see LITE at the top of fsScene). A phone gets
// the light one outright; anything else tries the full one and falls back to
// the light one if its compiler will not take it.

import { QUAD_VS_300, createFullscreenQuad } from '@wjh/gl/quad'
import { createGlProgram } from '@wjh/gl/program'
import { createRenderTarget, rgba8 } from '@wjh/gl/targets'
import { createMaterialArrays } from '@wjh/delta/gl'
import type { RenderTarget } from '@wjh/gl/targets'
import type { JourneyRenderer } from '@wjh/journey/types'
import { detectDevice } from '@wjh/quality/device'
import { fsPost, fsScene } from './shaders'


const fsSceneLite = fsScene.replace('#version 300 es\n', '#version 300 es\n#define LITE\n')


export function createLiminalRenderer (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const g2 = gl as WebGL2RenderingContext
  if (typeof g2.texImage3D !== 'function') {
    console.error('[liminal] needs WebGL2')
    return null
  }

  const full  = detectDevice().mobile ? null : createGlProgram(g2, QUAD_VS_300, fsScene, 'liminal')
  const scene = full ?? createGlProgram(g2, QUAD_VS_300, fsSceneLite, 'liminal-lite')
  const post  = createGlProgram(g2, QUAD_VS_300, fsPost, 'liminal')
  if (!scene || !post) {
    scene?.dispose()
    post?.dispose()
    return null
  }

  const materials = createMaterialArrays(g2)
  const quad      = createFullscreenQuad(g2)
  let target: RenderTarget | null = null

  return {
    ready:    () => materials.ready,
    progress: () => materials.ready ? 1 : 0,

    draw (frame) {
      const w = canvas.width
      const h = canvas.height
      if (!target || target.width !== w || target.height !== h) {
        target?.dispose()
        target = createRenderTarget(g2, w, h, rgba8(g2))
      }

      target.bind()
      scene.use()
      scene.frame(frame, w, h)
      materials.bind(g2, 0)
      scene.uniform1i('uMatColor', 0)
      scene.uniform1i('uMatNormal', 1)
      scene.uniform1i('uMatDetail', 2)
      quad.draw()

      g2.bindFramebuffer(g2.FRAMEBUFFER, null)
      g2.viewport(0, 0, w, h)
      post.use()
      g2.activeTexture(g2.TEXTURE0)
      g2.bindTexture(g2.TEXTURE_2D, target.tex)
      post.uniform1i('uTexture', 0)
      post.frame(frame, w, h)
      quad.draw()
    },

    dispose () {
      quad.dispose()
      target?.dispose()
      materials.dispose(g2)
      scene.dispose()
      post.dispose()
    },
  }
}
