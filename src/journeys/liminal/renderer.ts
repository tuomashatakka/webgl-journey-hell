// THE LIMINAL JOURNEY — the renderer.
//
// Two passes on WebGL 1: the corridor is raymarched into an 8-bit target the
// size of the canvas, then the post pass (fisheye, chromatic split, the loop
// fades) draws it to the screen. The shared CRT pass goes over the top.
//
// The scene comes in two builds (see LITE at the top of fsScene). A phone gets
// the light one outright; anything else tries the full one and falls back to
// the light one if its compiler will not take it.

import { QUAD_VS_100, createFullscreenQuad } from '@wjh/gl/quad'
import { createGlProgram } from '@wjh/gl/program'
import { createRenderTarget, rgba8 } from '@wjh/gl/targets'
import type { AnyGl } from '@wjh/gl/context'
import type { RenderTarget } from '@wjh/gl/targets'
import type { JourneyRenderer } from '@wjh/journey/types'
import { detectDevice } from '@wjh/quality/device'
import { fsPost, fsScene } from './shaders'


const fsSceneLite = `#define LITE\n${fsScene}`


export function createLiminalRenderer (gl: AnyGl, canvas: HTMLCanvasElement): JourneyRenderer | null {
  const full  = detectDevice().mobile ? null : createGlProgram(gl, QUAD_VS_100, fsScene, 'liminal')
  const scene = full ?? createGlProgram(gl, QUAD_VS_100, fsSceneLite, 'liminal-lite')
  const post  = createGlProgram(gl, QUAD_VS_100, fsPost, 'liminal')
  if (!scene || !post) {
    scene?.dispose()
    post?.dispose()
    return null
  }

  const quad = createFullscreenQuad(gl)
  let target: RenderTarget | null = null

  return {
    draw (frame) {
      const w = canvas.width
      const h = canvas.height
      if (!target || target.width !== w || target.height !== h) {
        target?.dispose()
        target = createRenderTarget(gl, w, h, rgba8(gl))
      }

      target.bind()
      scene.use()
      scene.frame(frame, w, h)
      quad.draw()

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      post.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, target.tex)
      post.uniform1i('uTexture', 0)
      post.frame(frame, w, h)
      quad.draw()
    },

    dispose () {
      quad.dispose()
      target?.dispose()
      scene.dispose()
      post.dispose()
    },
  }
}
