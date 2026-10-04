import { createPostChain } from '@wjh/gl/targets'
import type { GlProgram } from '@wjh/gl/program'
import type { RenderTarget } from '@wjh/gl/targets'
import type { Mat4 } from '@wjh/math/mat4'
import { DIAL, SPEEDO, TACHO, needleAngle } from '../cockpit'

import type { CockpitRig } from './rig'


type Chain = ReturnType<typeof createPostChain>

interface PostArgs {
  chain:    Chain;
  blur:     RenderTarget[];
  brightP:  GlProgram;
  blurP:    GlProgram;
  compP:    GlProgram;
  drawQuad: () => void;
  w:        number;
  h:        number;
  exposure: number;
  ride:     number[];
  time:     number;
}

interface CockpitArgs {
  viewProj: Mat4;
  camPos:   number[];
  sun:      number[];
  env:      number[];
  fogCol:   number[];
  time:     number;
  shadowOn: number;
  exposure: number;
  ride:     number[];
  loop:     number[];
  car:      number[];
  fall:     number[];
  carPos:   number[];
  carFwd:   number[];
  carRight: number[];
  carUp:    number[];
  cockpitP: GlProgram;
  bindLit:  (prog: GlProgram, camPos: number[], sun: number[], env: number[], fogCol: number[], time: number, shadowOn: number) => void;
}

/** Resolve the MSAA scene, bright-pass and blur it, composite to the screen. */
export function postPass (gl: WebGL2RenderingContext, a: PostArgs): void {
  const { chain, blur, brightP, blurP, compP, drawQuad, w, h, exposure, ride, time } = a

  chain.resolve()

  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)

  const bw = blur[0].width
  const bh = blur[0].height

  blur[0].bind()
  brightP.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, chain.scene.tex)
  brightP.uniform1i('uSrc', 0)
  brightP.uniform1f('uThreshold', 0.82)
  drawQuad()

  blurP.use()
  for (let pass = 0; pass < 2; pass++) {
    blur[(pass + 1) % 2].bind()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, blur[pass % 2].tex)
    blurP.uniform1i('uSrc', 0)
    if (pass === 0)
      blurP.uniform2f('uDir', 1.7 / bw, 0)
    else
      blurP.uniform2f('uDir', 0, 1.7 / bh)
    drawQuad()
  }

  // --- 6. composite ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, w, h)
  compP.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, chain.scene.tex)
  compP.uniform1i('uScene', 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, blur[0].tex)
  compP.uniform1i('uBloom', 1)
  compP.uniform1f('uExposure', exposure)
  // The speed blur bites only past what the road ever reaches.
  compP.uniform1f('uSpeedBlur', Math.max(0, Math.min(1, (ride[0] - 36) / 24)))
  compP.uniform1f('uTime', time)
  drawQuad()
}

/**
 * The cockpit, straight onto the back buffer after the composite, with its own
 * depth, so the world's speed blur never smears the dashboard.
 */
export function cockpitPass (gl: WebGL2RenderingContext, rig: CockpitRig, a: CockpitArgs): void {
  const { viewProj, camPos, sun, env, fogCol, time, shadowOn, exposure, ride, loop, car, fall, carPos, carFwd, carRight, carUp, cockpitP, bindLit } = a
  const { carMat, dialTex, mirror, cockpit, cabinMesh, wheelMesh, dialN, speedoPivot, tachoPivot, speedoMesh, tachoMesh }                           = rig

  // Straight onto the back buffer after the composite, with its own depth,
  // so the world's speed blur never smears the dashboard. The car's frame
  // is the model matrix: columns right, up, forward, position.
  carMat.set([
    carRight[0], carRight[1], carRight[2], 0,
    carUp[0], carUp[1], carUp[2], 0,
    carFwd[0], carFwd[1], carFwd[2], 0,
    carPos[0], carPos[1], carPos[2], 1,
  ])
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.depthMask(true)
  gl.clear(gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.CULL_FACE)
  gl.cullFace(gl.BACK)
  cockpitP.use()
  cockpitP.uniformMatrix4fv('uViewProj', viewProj)
  cockpitP.uniformMatrix4fv('uCarMat', carMat)
  bindLit(cockpitP, camPos, sun, env, fogCol, time, shadowOn)
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, dialTex)
  cockpitP.uniform1i('uDial', 3)
  gl.activeTexture(gl.TEXTURE4)
  gl.bindTexture(gl.TEXTURE_2D, mirror.tex)
  cockpitP.uniform1i('uMirror', 4)
  cockpitP.uniform4f('uMirrorRect', -0.105, 1.378, 0.21, 0.064)
  cockpitP.uniform4f('uDialRect', DIAL.cx, DIAL.cy, DIAL.cz, DIAL.w / 2)
  cockpitP.uniform1f('uExposure', exposure)

  // Warning lamps come on by lap: check engine, oil, temperature, then the
  // reception lamp with the signal loss; the red ones blink.
  const lapF = ride[1]
  cockpitP.uniform4f('uLamps',
                     lapF > 0.9 ? 1 : 0,
                     lapF > 1.9 ? 1 : 0,
                     lapF > 2.4 ? 1 : 0,
                     loop[2] >= 3 ? 1 : 0,
  )
  cockpitP.uniform1f('uBlink', 0.55 + 0.45 * Math.sign(Math.sin(time * 5.5)))
  cockpitP.uniform1f('uAngle', 0)
  cockpitP.uniform3f('uPivot', 0, 0, 0)
  cockpitP.uniform3f('uAxis', 0, 1, 0)
  gl.disable(gl.CULL_FACE)
  cabinMesh.draw(gl)
  // The wheel by steer: a lock and a half each way over the steer range.
  cockpitP.uniform3f('uPivot', cockpit.wheelCentre.x, cockpit.wheelCentre.y, cockpit.wheelCentre.z)
  cockpitP.uniform3f('uAxis', cockpit.wheelAxis.x, cockpit.wheelAxis.y, cockpit.wheelAxis.z)
  cockpitP.uniform1f('uAngle', -car[2] * 2.6 + fall[3] * 0.09 * Math.sin(time * 31))
  wheelMesh.draw(gl)
  // Needles by reading.
  cockpitP.uniform3f('uAxis', dialN.x, dialN.y, dialN.z)
  cockpitP.uniform3f('uPivot', speedoPivot.x, speedoPivot.y, speedoPivot.z)
  cockpitP.uniform1f('uAngle', needleAngle(SPEEDO, ride[0] * 3.6))
  speedoMesh.draw(gl)
  cockpitP.uniform3f('uPivot', tachoPivot.x, tachoPivot.y, tachoPivot.z)
  cockpitP.uniform1f('uAngle', needleAngle(TACHO, car[0] * 7800))
  tachoMesh.draw(gl)
}
