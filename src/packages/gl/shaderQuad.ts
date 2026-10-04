// A journey that is one fragment shader: the full-screen quad runner.
//
// Shared by the landing page's hover previews (one program per journey, all in
// one context) and by the single-pass journeys. Fragment shaders may read:
//   uniform vec2      iResolution;  // canvas pixel size
//   uniform float     iTime;        // seconds
//   uniform vec2      uPointer;     // normalized pointer, -1..1 (y up)
//   uniform float     uHeavy;       // 1.0 when heavyEffects is on, else 0.0
//   uniform sampler2D uEnv;         // optional equirect environment map (unit 0)
//   uniform float     uEnvLoaded;   // 1.0 once uEnv's image has uploaded
// plus anything in the frame's custom uniform map.
//
// The env map is opt-in; it loads asynchronously and uEnvLoaded gates its use,
// so the first frames fall back to a procedural environment.

import { assetUrl } from '@wjh/web/assetUrl'
import type { AnyGl } from './context'
import { createGlProgram } from './program'
import { QUAD_VS_100, createFullscreenQuad } from './quad'
import { loadImageTexture } from './texture'
import type { FrameUniforms } from './uniforms'


export interface ShaderQuadOptions {

  /** Optional equirectangular environment map URL, bound to `uEnv` on unit 0. */
  envUrl?: string;
}

export interface ShaderQuad {

  /** Render one frame at the canvas's current pixel size. */
  draw(uniforms: FrameUniforms): void;

  /** Release the program, the quad and the env map. */
  dispose(): void;
}

/**
 * Build a renderable quad from a fragment shader. Null when it does not
 * compile or link; callers fall back to a static poster.
 */
export function createShaderQuad (gl: AnyGl, fragmentSource: string, options: ShaderQuadOptions = {}): ShaderQuad | null {
  const prog = createGlProgram(gl, QUAD_VS_100, fragmentSource, 'shaderQuad')
  if (!prog)
    return null

  const quad = createFullscreenQuad(gl)
  const env  = options.envUrl ? loadImageTexture(gl, assetUrl(options.envUrl)) : null

  return {
    draw (frame) {
      const canvas = gl.canvas as HTMLCanvasElement
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      prog.use()
      if (env) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, env.tex)
        prog.uniform1i('uEnv', 0)
      }
      prog.uniform1f('uEnvLoaded', env?.loaded() ? 1 : 0)
      prog.frame(frame, canvas.width, canvas.height)
      quad.draw()
    },

    dispose () {
      quad.dispose()
      prog.dispose()
      env?.dispose()
    },
  }
}
