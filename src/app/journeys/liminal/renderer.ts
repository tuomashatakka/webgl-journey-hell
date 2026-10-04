// THE LIMINAL JOURNEY — the renderer.
//
// Two passes on WebGL 1: the corridor is raymarched into an 8-bit target the
// size of the canvas, then the post pass (fisheye, chromatic split, the loop
// fades) draws it to the screen. The shared CRT pass goes over the top.

import { QUAD_VS_100, createFullscreenQuad, createGlProgram, createRenderTarget, rgba8 } from '✦/lib/gl'
import type { AnyGl, RenderTarget } from '✦/lib/gl'
import type { JourneyRenderer } from '✦/lib/journey'
import { fsPost, fsScene } from './shaders'


export function createLiminalRenderer (gl: AnyGl, canvas: HTMLCanvasElement): JourneyRenderer | null {
  const scene = createGlProgram(gl, QUAD_VS_100, fsScene, 'liminal')
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
