import type { Route } from '../course'
import { createRenderTarget, sceneFormat } from '@wjh/gl/targets'

import { SKY_W, SKY_H, BANK_TEX_W, SHADOW_SIZE } from './shared'

/** The bank LUT, the sky LUT target and the sun's shadow map. */
export function createTargets (gl: WebGL2RenderingContext, route: Route) {
  // --- the bank LUT ----------------------------------------------------------
  // The same Float32Array the simulation reads, as R32F texels. texelFetch and a
  // manual mix in the shader, so no float-filtering extension is involved and
  // the GPU's answer is the CPU's to the bit.
  const bankRows = Math.ceil(route.bankTable.length / BANK_TEX_W)
  const bankData = new Float32Array(BANK_TEX_W * bankRows)
  bankData.set(route.bankTable)

  const bankTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, bankTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BANK_TEX_W, bankRows, 0, gl.RED, gl.FLOAT, bankData)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  // --- the sky LUT -----------------------------------------------------------
  const skyTarget = createRenderTarget(gl, SKY_W, SKY_H, sceneFormat(gl))
  const skyTex    = skyTarget.tex
  gl.bindTexture(gl.TEXTURE_2D, skyTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)

  // --- the shadow map --------------------------------------------------------
  // A depth texture with hardware compare, LINEAR so the compare is bilinear.
  const shadowTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, shadowTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0,
                gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)

  const shadowFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0)
  gl.drawBuffers([ gl.NONE ])
  gl.readBuffer(gl.NONE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  return { bankTex, skyTarget, skyTex, shadowTex, shadowFbo }
}
