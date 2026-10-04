// THE FOUNDRY — the renderer.
//
// One pass on WebGL 2: the halls are raymarched straight to the screen, and
// every surface in them is a Δ scan, so the three material arrays are bound
// before the draw. The shared CRT pass goes over the top.

import type { JourneyRenderer } from '@wjh/journey/types'
import { QUAD_VS_300, createFullscreenQuad } from '@wjh/gl/quad'
import { createGlProgram } from '@wjh/gl/program'
import { createMaterialArrays } from '@wjh/delta/gl'
import { foundryFrag } from './shader'


export function createFoundryRenderer (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const g2 = gl as WebGL2RenderingContext
  if (typeof g2.texImage3D !== 'function') {
    console.error('[foundry] needs WebGL2')
    return null
  }

  const prog = createGlProgram(g2, QUAD_VS_300, foundryFrag, 'foundry')
  if (!prog)
    return null

  const materials = createMaterialArrays(g2)
  const quad      = createFullscreenQuad(g2)

  return {
    ready:    () => materials.ready,
    progress: () => materials.ready ? 1 : 0,

    draw (frame) {
      g2.bindFramebuffer(g2.FRAMEBUFFER, null)
      g2.viewport(0, 0, canvas.width, canvas.height)
      prog.use()
      prog.frame(frame, canvas.width, canvas.height)
      materials.bind(g2, 0)
      prog.uniform1i('uMatColor', 0)
      prog.uniform1i('uMatNormal', 1)
      prog.uniform1i('uMatDetail', 2)
      quad.draw()
    },

    dispose () {
      quad.dispose()
      materials.dispose(g2)
      prog.dispose()
    },
  }
}

// perf: one raymarch pass straight to the screen; nothing allocated per frame.
