import { createRenderTarget, rgba8 } from '@wjh/gl/targets'
import { createMesh } from '@wjh/gl/mesh'
import type { Mat4 } from '@wjh/math/mat4'
import { SPEEDO, TACHO, buildCockpit, dialNormal, dialPoint, drawDialFaces } from '../cockpit'

import { MIRROR_W, MIRROR_H } from './shared'

/** The cabin, its dials and the mirror's target. */
export function createCockpitRig (gl: WebGL2RenderingContext) {
  // --- the cockpit -----------------------------------------------------------------
  const cockpit    = buildCockpit()
  const cabinMesh  = createMesh(gl, cockpit.cabin)
  const wheelMesh  = createMesh(gl, cockpit.wheel)
  const speedoMesh = createMesh(gl, cockpit.speedo)
  const tachoMesh  = createMesh(gl, cockpit.tacho)
  // The rear view for the mirror: a small colour target with its own depth.
  const mirror = createRenderTarget(gl, MIRROR_W, MIRROR_H, rgba8(gl), { depth: true })

  const dialTex    = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, dialTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawDialFaces())
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const carMat: Mat4 = new Float32Array(16)
  const dialN        = dialNormal()
  const speedoPivot  = dialPoint(SPEEDO.u, SPEEDO.v)
  const tachoPivot   = dialPoint(TACHO.u, TACHO.v)

  return { cockpit, cabinMesh, wheelMesh, speedoMesh, tachoMesh, mirror, dialTex, carMat, dialN, speedoPivot, tachoPivot }
}

export type CockpitRig = ReturnType<typeof createCockpitRig>
