import { createPostChain } from '@wjh/gl/targets'
import type { GlProgram } from '@wjh/gl/program'


type Chain = ReturnType<typeof createPostChain>

interface PostPrograms {
  down: GlProgram;
  up:   GlProgram;
  comp: GlProgram;
}

interface CompositeInputs {
  w:        number;
  h:        number;
  time:     number;
  heavy:    number;
  exposure: number;
  decay:    number[];
  ride:     number[];
  encode:   number;
}

/** Bloom: down the chain, then back up it. */
export function runBloom (gl: WebGL2RenderingContext, chain: Chain, progs: PostPrograms, encode: number, drawQuad: () => void): void {
  const { down: downProg, up: upProg } = progs
  // --- bloom: down the chain, then back up it ---
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)
  downProg.use()
  downProg.uniform1i('uSrc', 0)
  downProg.uniform1f('uDecode', encode)

  const bloom = chain.bloom
  for (let i = 0; i < bloom.length; i++) {
    const src = i === 0 ? chain.scene : bloom[i - 1]
    bloom[i].bind()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    downProg.uniform2f('uTexel', 1 / src.width, 1 / src.height)
    downProg.uniform1f('uThreshold', i === 0 ? 1 : -1)
    if (i === 1)
      downProg.uniform1f('uDecode', 0)
    drawQuad()
  }
  upProg.use()
  upProg.uniform1i('uSrc', 0)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  for (let i = bloom.length - 1; i > 0; i--) {
    bloom[i - 1].bind()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bloom[i].tex)
    upProg.uniform2f('uTexel', 1 / bloom[i].width, 1 / bloom[i].height)
    upProg.uniform1f('uRadius', 1)
    drawQuad()
  }
  gl.disable(gl.BLEND)
}

/** The final pass: scene and bloom to the screen, graded. */
export function composite (gl: WebGL2RenderingContext, chain: Chain, progs: PostPrograms, drawQuad: () => void, f: CompositeInputs): void {
  const compProg                                                 = progs.comp
  const { w, h, time, heavy: hv, exposure, decay, ride, encode } = f
  const bloom                                                    = chain.bloom
  // --- composite ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, w, h)
  compProg.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, chain.scene.tex)
  compProg.uniform1i('uScene', 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex)
  compProg.uniform1i('uBloom', 1)
  compProg.uniform4f('uDecay', decay[0], decay[1], decay[2], decay[3])
  compProg.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
  compProg.uniform1f('uTime', time)
  compProg.uniform1f('uExposure', exposure)
  compProg.uniform1f('uDecode', encode)
  compProg.uniform1f('uHeavy', hv)
  compProg.uniform2f('uAspect', w / Math.max(1, h), 1)
  drawQuad()
}
