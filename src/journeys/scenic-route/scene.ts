// THE SCENIC ROUTE — the renderer.
//
// A WebGL2 rasterizer behind geometryRenderer (lib/journey), following
// loop-line's shape: everything built once at construction, a frame that is a
// few dozen draws and a post chain, nothing uploaded per frame but uniforms.
//
// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------
//
//   1. sky LUT      — 128×65 lat-long, full single scattering, into a texture.
//   2. shadow       — the sun's depth map, an orthographic box fitted ahead of
//                     the camera; skipped where the section has no sky.
//   3. world        — into a multisampled target: the swept road (rolled live by
//                     the bank LUT), the terrain chunks in range, the far field,
//                     the sea; the city, maw and tube as the phases land.
//   4. sky dome     — a fullscreen triangle at far depth, filling what is left.
//   5. resolve → bright → blur ×2 → composite (exposure, ACES, speed blur).
//
// lib/gl/crtPass then reads the back buffer and adds the tube and the signal loss
// without knowing any of this exists.
//
// ---------------------------------------------------------------------------
// Where the camera comes from
// ---------------------------------------------------------------------------
//
// The simulation hands over a pose — position, forward, up — and the car's own
// frame beside it, never a matrix. Three vec3s can be sanity-checked by eye in
// the ?debug=1 panel; sixteen floats cannot. The projection is the renderer's,
// because only the renderer knows the aspect ratio, and the pointer look is
// applied here because where the rider looks must not change where the car is.

import { vector } from '@wjh/gl/uniforms'
import type { JourneyRenderer } from '@wjh/journey/types'
import { HIGH_QUALITY } from '@wjh/gl/uniforms'
import { createFullscreenQuad } from '@wjh/gl/quad'
import { createPostChain, createRenderTarget, rgba8 } from '@wjh/gl/targets'
import type { GlProgram } from '@wjh/gl/program'
import type { RenderTarget } from '@wjh/gl/targets'
import { invert, lookAt, multiply, perspective } from '@wjh/math/mat4'
import type { Mat4 } from '@wjh/math/mat4'
import type { FrameUniforms } from '@wjh/gl/uniforms'
import { BANK_STEP, bankGainAt, getRoute } from './course'
import { SEA_PATCH } from './geometry'
import { FLESH_END, ROCK_START, jawAngleAt } from './maw'
import { bendGainAt } from './city'


const FOV_BASE = 62 * Math.PI / 180

const SHADOW_HALF  = 170
const SHADOW_DEPTH = 900


import { createPrograms } from './scene/programs'
import { createCockpitRig } from './scene/rig'
import { createTargets } from './scene/textures'
import { buildWorld } from './scene/world'
import type { Drawable } from './scene/shared'
import { MIRROR_W, MIRROR_H, SHADOW_SIZE } from './scene/shared'

/** Linear exposure at 0 EV. */
const EXPOSURE_BASE = 0.9

/** Beyond this the fog has closed and a terrain chunk contributes nothing. */
const CULL_DIST = 1700

/** How far the fish's head and lips sit under the sea before it surfaces. */
const HEAD_DROP = 95

/** Jaw angle (rad, lower jaw's share) that shuts the mouth before the car is off the lip. */
const JAW_SHUT = 1
import { cockpitPass, postPass } from './scene/post'

/** The [-1,1] -> [0,1] remap the shadow lookup wants, as a matrix. */
const BIAS: Mat4 = new Float32Array([
  0.5, 0, 0, 0,
  0, 0.5, 0, 0,
  0, 0, 0.5, 0,
  0.5, 0.5, 0.5, 1,
])

/** Column-major orthographic projection into [-1,1]^3, right-handed. */
function ortho (out: Mat4, half: number, near: number, far: number): Mat4 {
  out.fill(0)
  out[0]  = 1 / half
  out[5]  = 1 / half
  out[10] = -2 / (far - near)
  out[14] = -(far + near) / (far - near)
  out[15] = 1
  return out
}

export function createScenicRouteScene (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const programs = createPrograms(gl)
  if (!programs)
    return null

  const { skyLutP, skyDomeP, roadP, roadDepthP, terrainP, meshDepthP, seaP, mawP, jawP, jawDepthP, tubeP, waterP, cockpitP, propP, propDepthP, railP, towerP, towerDepthP, brightP, blurP, compP } = programs

  const route = getRoute()

  const { bankTex, skyTarget, skyTex, shadowTex, shadowFbo } = createTargets(gl, route)

  const { roadMesh, chunks, farMesh, seaMesh, patchMesh, maw, mouthDir, headMesh, jaws, tube, tubeFront, tubeBack, waterMesh, props, city, towerMesh, railMesh } = buildWorld(gl, route)

  const rig                                                              = createCockpitRig(gl)
  const { cabinMesh, wheelMesh, speedoMesh, tachoMesh, mirror, dialTex } = rig

  // --- post targets ------------------------------------------------------------
  // MSAA scene → resolve, then a bright pass and a separable blur ping-ponged
  // between two half-resolution targets. 8-bit throughout: this road is graded
  // for an LDR image. The quality tier decides the MSAA sample count.
  const quad  = createFullscreenQuad(gl)
  const chain = createPostChain(gl, { hdr: false, msaa: 4, bloomLevels: 0 })
  let blur: RenderTarget[] = []

  const resize = (w: number, h: number, msaa: number) => {
    if (!chain.resize(w, h, { msaa, bloomLevels: 0 }))
      return
    blur.forEach(b => b.dispose())

    const bw = Math.max(1, w >> 1)
    const bh = Math.max(1, h >> 1)
    blur = [ createRenderTarget(gl, bw, bh, rgba8(gl)), createRenderTarget(gl, bw, bh, rgba8(gl)) ]
  }

  // --- per-frame scratch -----------------------------------------------------
  const proj: Mat4                        = new Float32Array(16)
  const view: Mat4                        = new Float32Array(16)
  const viewProj: Mat4                    = new Float32Array(16)
  const invViewProj: Mat4                 = new Float32Array(16)
  const mirrorProj: Mat4                  = new Float32Array(16)
  const mirrorView: Mat4                  = new Float32Array(16)
  const mirrorVP: Mat4                    = new Float32Array(16)
  const mirrorInvVP: Mat4                 = new Float32Array(16)
  const mEye: [number, number, number]    = [ 0, 0, 0 ]
  const mTarget: [number, number, number] = [ 0, 0, 1 ]
  const mUp: [number, number, number]     = [ 0, 1, 0 ]
  const lightProj: Mat4                   = new Float32Array(16)
  const lightView: Mat4                   = new Float32Array(16)
  const lightVP: Mat4                     = new Float32Array(16)
  const shadowMat: Mat4                   = new Float32Array(16)
  const eye: [number, number, number]     = [ 0, 0, 0 ]
  const target: [number, number, number]  = [ 0, 0, 1 ]
  const upv: [number, number, number]     = [ 0, 1, 0 ]

  const drawQuad = () => quad.draw()

  /** The bank LUT on unit 0 for any program that sweeps. */
  const bindBank = (prog: GlProgram, gain: number) => {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bankTex)
    prog.uniform1i('uBankLut', 0)
    gl.uniform2i(prog.loc('uBankInfo'), route.bankTable.length, 0)
    prog.uniform1f('uBankStep', BANK_STEP)
    prog.uniform1f('uBankGain', gain)
  }

  /** Everything a lit world program shares: sky, shadow, camera, sun, fog, the car's lamps. */
  let carPos: number[]   = [ 0, 0, 0 ]
  let carFwd: number[]   = [ 0, 0, 1 ]
  let carRight: number[] = [ 1, 0, 0 ]
  let lights             = 0
  const bindLit = (
    prog: GlProgram, camPos: number[], sun: number[], env: number[], fogCol: number[],
    time: number, shadowOn: number,
  ) => {
    prog.uniform3f('uCarPos', carPos[0], carPos[1], carPos[2])
    prog.uniform3f('uCarFwd', carFwd[0], carFwd[1], carFwd[2])
    prog.uniform3f('uCarRight', carRight[0], carRight[1], carRight[2])
    prog.uniform1f('uLights', lights)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, skyTex)
    prog.uniform1i('uSky', 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, shadowTex)
    prog.uniform1i('uShadowMap', 2)
    prog.uniformMatrix4fv('uShadowMat', shadowMat)
    prog.uniform1f('uShadowOn', shadowOn)
    prog.uniform2f('uShadowTexel', 1 / SHADOW_SIZE, 1 / SHADOW_SIZE)
    prog.uniform3f('uCamPos', camPos[0], camPos[1], camPos[2])
    prog.uniform3f('uSunDir', sun[0], sun[1], sun[2])
    prog.uniform4f('uEnv', env[0], env[1], env[2], env[3])
    prog.uniform3f('uFogCol', fogCol[0], fogCol[1], fogCol[2])
    prog.uniform1f('uTime', time)
  }

  /** Chunk culling: sphere against distance and against being fully behind. */
  const visible = (d: Drawable, camPos: number[], fx: number, fy: number, fz: number): boolean => {
    const dx   = d.cx - camPos[0]
    const dy   = d.cy - camPos[1]
    const dz   = d.cz - camPos[2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist - d.radius > CULL_DIST)
      return false
    return !(dist > d.radius && (dx * fx + dy * fy + dz * fz) / dist < -0.35)
  }

  return {
    draw ({ time, pointer, heavy, custom, quality }: FrameUniforms) {
      const w = canvas.width
      const h = canvas.height
      resize(w, h, (quality ?? HIGH_QUALITY).msaa)

      const camPos = vector(custom, 'uCamPos', [ 0, 0, 0 ])
      const camFwd = vector(custom, 'uCamFwd', [ 0, 0, 1 ])
      const camUp  = vector(custom, 'uCamUp', [ 0, 1, 0 ])
      const ride   = vector(custom, 'uRide', [ 0, 0, 0, 0 ])
      const sun    = vector(custom, 'uSun', [ 0, 0.2, 1, 0.2 ])
      const env    = vector(custom, 'uEnv', [ 0, 1, 0.001, -1e4 ])
      const fogCol = vector(custom, 'uFogCol', [ 0.6, 0.65, 0.7, 0 ])
      const flt    = vector(custom, 'uFloat', [ 0, 0, 0, 3.4 ])
      const car    = vector(custom, 'uCar', [ 0, 1, 0, 0 ])
      const loop   = vector(custom, 'uLoop', [ 0, 0, 0, 0 ])
      // (fall weight, fish risen, jaws open, shake); without a sim the fish is up and open.
      const fall    = vector(custom, 'uFall', [ 0, 1, 1, 0 ])
      const isHeavy = (heavy ?? 1) > 0.5
      carPos   = vector(custom, 'uCarPos', camPos)
      carFwd   = vector(custom, 'uCarFwd', camFwd)
      carRight = vector(custom, 'uCarRight', [ 1, 0, 0 ])

      const carUp = vector(custom, 'uCarUp', [ 0, 1, 0 ])
      lights   = car[3]

      // Pointer look: yaw about the camera's up, pitch toward it.
      const px  = pointer?.x ?? 0
      const py  = pointer?.y ?? 0
      const yaw = px * 0.6
      const rx  = camFwd[1] * camUp[2] - camFwd[2] * camUp[1]
      const ry  = camFwd[2] * camUp[0] - camFwd[0] * camUp[2]
      const rz  = camFwd[0] * camUp[1] - camFwd[1] * camUp[0]
      const cy  = Math.cos(yaw)
      const sy  = Math.sin(yaw)
      let fx = camFwd[0] * cy + rx * sy + camUp[0] * py * 0.45
      let fy = camFwd[1] * cy + ry * sy + camUp[1] * py * 0.45
      let fz = camFwd[2] * cy + rz * sy + camUp[2] * py * 0.45
      const fl = Math.hypot(fx, fy, fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl

      eye[0]    = camPos[0]
      eye[1]    = camPos[1]
      eye[2]    = camPos[2]
      target[0] = camPos[0] + fx
      target[1] = camPos[1] + fy
      target[2] = camPos[2] + fz
      upv[0]    = camUp[0]
      upv[1]    = camUp[1]
      upv[2]    = camUp[2]

      // The lens widens with speed — a little, the way a rider's attention does.
      const fov = FOV_BASE * (1 + Math.min(ride[0], 60) / 60 * 0.14 + fall[0] * 0.2)
      perspective(proj, fov, w / Math.max(1, h), 0.1, 4000)
      lookAt(view, eye, target, upv)
      multiply(viewProj, proj, view)
      invert(invViewProj, viewProj)

      const bankGain = bankGainAt(ride[1])
      const bendGain = bendGainAt(ride[1])
      // Shut until the car is off the edge, then open by lap; the whole head
      // sits under the sea until the car comes along the headland.
      const jawAngle = jawAngleAt(ride[1]) * fall[2] - JAW_SHUT * (1 - fall[2])
      const headDrop = -HEAD_DROP * (1 - fall[1])
      const seaRise  = Math.min(ride[1], 3) * 0.45
      const exposure = EXPOSURE_BASE * Math.pow(2, env[0])
      const shadowOn = env[1] > 0.05 && sun[1] > 0.005 ? 1 : 0

      gl.disable(gl.BLEND)

      // --- 1. the sky LUT ---
      skyTarget.bind()
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      skyLutP.use()
      skyLutP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
      skyLutP.uniform1f('uCamAlt', Math.max(camPos[1] + 60, 2))
      gl.uniform2i(skyLutP.loc('uSteps'), isHeavy ? 10 : 5, isHeavy ? 4 : 2)
      drawQuad()

      // --- 2. the shadow map ---
      // An orthographic box centred ahead of the camera and looking down the
      // sun. The box follows the camera, so the map is always spent where the
      // picture is.
      if (shadowOn) {
        const cxs = camPos[0] + fx * 70
        const cys = camPos[1] + fy * 70
        const czs = camPos[2] + fz * 70
        eye[0]    = cxs + sun[0] * SHADOW_DEPTH * 0.5
        eye[1]    = cys + sun[1] * SHADOW_DEPTH * 0.5
        eye[2]    = czs + sun[2] * SHADOW_DEPTH * 0.5
        target[0] = cxs
        target[1] = cys
        target[2] = czs
        upv[0]    = 0
        upv[1]    = 1
        upv[2]    = 0
        lookAt(lightView, eye, target, upv)
        ortho(lightProj, SHADOW_HALF, 1, SHADOW_DEPTH)
        multiply(lightVP, lightProj, lightView)
        multiply(shadowMat, BIAS, lightVP)

        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo)
        gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        gl.depthMask(true)
        gl.colorMask(false, false, false, false)
        gl.clear(gl.DEPTH_BUFFER_BIT)

        roadDepthP.use()
        roadDepthP.uniformMatrix4fv('uViewProj', lightVP)
        bindBank(roadDepthP, bankGain)
        roadMesh.draw(gl)

        meshDepthP.use()
        meshDepthP.uniformMatrix4fv('uViewProj', lightVP)
        for (const c of chunks) {
          const d = Math.hypot(c.cx - cxs, c.cy - cys, c.cz - czs)
          if (d - c.radius < SHADOW_HALF * 1.5)
            c.mesh.draw(gl)
        }

        towerDepthP.use()
        towerDepthP.uniformMatrix4fv('uViewProj', lightVP)
        towerDepthP.uniform1f('uBendGain', bendGain)
        towerMesh.drawInstanced(gl, city.count)

        propDepthP.use()
        propDepthP.uniformMatrix4fv('uViewProj', lightVP)
        propDepthP.uniform1f('uTime', time)
        for (const { set, mesh } of props) {
          propDepthP.uniform1i('uMaterial', set.material)
          propDepthP.uniform1f('uSpin', set.spin)
          mesh.drawInstanced(gl, set.count)
        }

        // The rail casts too; same vertex shader as the road, uniforms retained.
        // The head too, unrolled: its profile is round, its eyes are not.
        roadDepthP.use()
        railMesh.draw(gl)
        roadDepthP.uniform1f('uBankGain', 0)
        roadDepthP.uniform3f('uOffset', 0, headDrop, 0)
        headMesh.draw(gl)
        roadDepthP.uniform3f('uOffset', 0, 0, 0)
        roadDepthP.uniform1f('uBankGain', bankGain)

        jawDepthP.use()
        jawDepthP.uniformMatrix4fv('uViewProj', lightVP)
        jawDepthP.uniform3f('uOffset', 0, headDrop, 0)
        for (const { jaw, mesh } of jaws) {
          jawDepthP.uniform3f('uHinge', jaw.hinge.x, jaw.hinge.y, jaw.hinge.z)
          jawDepthP.uniform3f('uAxis', jaw.axis.x, jaw.axis.y, jaw.axis.z)
          jawDepthP.uniform1f('uJaw', jawAngle * jaw.share)
          mesh.draw(gl)
        }
        gl.colorMask(true, true, true, true)
      }

      // The world, from any camera: the mirror's rear pass and the main pass
      // share every draw, uniform and cull, only the matrices differ.
      const drawWorld = (vp: Mat4, cp: typeof camPos, fwd: number[], invVP: Mat4) => {
      // The land.
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
        terrainP.use()
        terrainP.uniformMatrix4fv('uViewProj', vp)
        bindLit(terrainP, cp, sun, env, fogCol, time, shadowOn)
        terrainP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
        for (const c of chunks)
          if (visible(c, cp, fwd[0], fwd[1], fwd[2]))
            c.mesh.draw(gl)
        farMesh.draw(gl)

        // Downtown.
        towerP.use()
        towerP.uniformMatrix4fv('uViewProj', vp)
        towerP.uniform1f('uBendGain', bendGain)
        towerP.uniform1f('uSunEl', Math.asin(Math.max(-1, Math.min(1, sun[1]))) * 180 / Math.PI)
        towerP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
        bindLit(towerP, cp, sun, env, fogCol, time, shadowOn)
        towerMesh.drawInstanced(gl, city.count)

        // The maw: head unrolled, jaws by hinge.
        gl.disable(gl.CULL_FACE)
        mawP.use()
        mawP.uniformMatrix4fv('uViewProj', vp)
        mawP.uniform3f('uOffset', 0, headDrop, 0)
        bindBank(mawP, 0)
        bindLit(mawP, cp, sun, env, fogCol, time, shadowOn)
        mawP.uniform1f('uMouthS', maw.s0)
        headMesh.draw(gl)

        jawP.use()
        jawP.uniformMatrix4fv('uViewProj', vp)
        jawP.uniform3f('uOffset', 0, headDrop, 0)
        bindLit(jawP, cp, sun, env, fogCol, time, shadowOn)
        for (const { jaw, mesh } of jaws) {
          jawP.uniform3f('uHinge', jaw.hinge.x, jaw.hinge.y, jaw.hinge.z)
          jawP.uniform3f('uAxis', jaw.axis.x, jaw.axis.y, jaw.axis.z)
          jawP.uniform1f('uJaw', jawAngle * jaw.share)
          mesh.draw(gl)
        }

        // The tube and its water.
        tubeP.use()
        tubeP.uniformMatrix4fv('uViewProj', vp)
        bindBank(tubeP, 0)
        bindLit(tubeP, cp, sun, env, fogCol, time, shadowOn)
        tubeP.uniform1f('uMouthS', tube.s0)
        tubeP.uniform2f('uFleshRock', FLESH_END, ROCK_START)
        tubeP.uniform4f('uPulse', 1.4, time, tube.s0, FLESH_END)
        tubeP.uniform3f('uOffset', 0, headDrop, 0)
        tubeFront.draw(gl)
        tubeP.uniform3f('uOffset', 0, 0, 0)
        tubeBack.draw(gl)

        waterP.use()
        waterP.uniformMatrix4fv('uViewProj', vp)
        bindBank(waterP, 0)
        bindLit(waterP, cp, sun, env, fogCol, time, shadowOn)
        waterMesh.draw(gl)

        // The sea: waves on the fine patch, flat beyond it; both rise by lap.
        seaP.use()
        seaP.uniformMatrix4fv('uViewProj', vp)
        bindLit(seaP, cp, sun, env, fogCol, time, shadowOn)
        seaP.uniform1f('uSeaRise', seaRise)
        seaP.uniform3f('uMouth', maw.mouth.x, maw.mouth.y, maw.mouth.z)
        seaP.uniform2f('uMouthDir', mouthDir[0], mouthDir[1])
        seaP.uniform1f('uRise', fall[1])
        seaP.uniform4f('uPatch', SEA_PATCH.x, SEA_PATCH.z, SEA_PATCH.halfX, SEA_PATCH.halfZ)
        seaP.uniform1f('uWaveScale', 1)
        patchMesh.draw(gl)
        seaP.uniform1f('uWaveScale', 0)
        seaMesh.draw(gl)

        // The road is two-sided: a corkscrew shows its underside from across the
        // helix, and a missing ribbon there reads as a hole in the world.
        gl.disable(gl.CULL_FACE)
        roadP.use()
        roadP.uniformMatrix4fv('uViewProj', vp)
        bindBank(roadP, bankGain)
        bindLit(roadP, cp, sun, env, fogCol, time, shadowOn)
        roadP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
        roadP.uniform1f('uRoadHalf', flt[3])
        roadMesh.draw(gl)

        railP.use()
        railP.uniformMatrix4fv('uViewProj', vp)
        railP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
        bindBank(railP, bankGain)
        bindLit(railP, cp, sun, env, fogCol, time, shadowOn)
        railMesh.draw(gl)

        // The props, a draw per set.
        propP.use()
        propP.uniformMatrix4fv('uViewProj', vp)
        propP.uniform1f('uTime', time)
        bindLit(propP, cp, sun, env, fogCol, time, shadowOn)
        for (const { set, mesh } of props) {
          if (set.twoSided)
            gl.disable(gl.CULL_FACE)
          else {
            gl.enable(gl.CULL_FACE)
            gl.cullFace(gl.BACK)
          }
          propP.uniform1i('uMaterial', set.material)
          propP.uniform1f('uSpin', set.spin)
          mesh.drawInstanced(gl, set.count)
        }
        gl.disable(gl.CULL_FACE)

        // --- 4. the sky dome ---
        gl.depthMask(false)
        skyDomeP.use()
        skyDomeP.uniformMatrix4fv('uInvViewProj', invVP)
        skyDomeP.uniform3f('uCamPos', cp[0], cp[1], cp[2])
        skyDomeP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
        skyDomeP.uniform1f('uTime', time)
        skyDomeP.uniform1f('uSkyMix', env[1])
        skyDomeP.uniform3f('uFogCol', fogCol[0], fogCol[1], fogCol[2])
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, skyTex)
        skyDomeP.uniform1i('uSky', 1)
        drawQuad()
        gl.depthMask(true)
      }

      // --- 2b. the rear view ---
      // Looking back along the car, wide, into the mirror's texture.
      mirror.bind()
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      perspective(mirrorProj, 80 * Math.PI / 180, MIRROR_W / MIRROR_H, 0.3, 4000)
      mEye[0]    = camPos[0]
      mEye[1]    = camPos[1]
      mEye[2]    = camPos[2]
      mTarget[0] = camPos[0] - carFwd[0]
      mTarget[1] = camPos[1] - carFwd[1] + 0.05
      mTarget[2] = camPos[2] - carFwd[2]
      mUp[0]     = carUp[0]
      mUp[1]     = carUp[1]
      mUp[2]     = carUp[2]
      lookAt(mirrorView, mEye, mTarget, mUp)
      multiply(mirrorVP, mirrorProj, mirrorView)
      invert(mirrorInvVP, mirrorVP)
      drawWorld(mirrorVP, camPos, [ -carFwd[0], -carFwd[1], -carFwd[2] ], mirrorInvVP)

      // --- 3. the world ---
      chain.bindScene()
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      drawWorld(viewProj, camPos, [ fx, fy, fz ], invViewProj)

      postPass(gl, { chain, blur, brightP, blurP, compP, drawQuad, w, h, exposure, ride, time })
      cockpitPass(gl, rig, { viewProj, camPos, sun, env, fogCol, time, shadowOn, exposure, ride, loop, car, fall, carPos, carFwd, carRight, carUp, cockpitP, bindLit })
    },

    dispose () {
      chain.dispose()
      blur.forEach(b => b.dispose())
      quad.dispose()
      gl.deleteTexture(bankTex)
      skyTarget.dispose()
      gl.deleteTexture(shadowTex)
      gl.deleteFramebuffer(shadowFbo)
      roadMesh.dispose(gl)
      railMesh.dispose(gl)
      for (const c of chunks)
        c.mesh.dispose(gl)
      farMesh.dispose(gl)
      seaMesh.dispose(gl)
      patchMesh.dispose(gl)
      headMesh.dispose(gl)
      cabinMesh.dispose(gl)
      wheelMesh.dispose(gl)
      speedoMesh.dispose(gl)
      tachoMesh.dispose(gl)
      gl.deleteTexture(dialTex)
      mirror.dispose()
      tubeFront.dispose(gl)
      tubeBack.dispose(gl)
      waterMesh.dispose(gl)
      for (const { mesh } of jaws)
        mesh.dispose(gl)
      for (const { mesh } of props)
        mesh.dispose(gl)
      towerMesh.dispose(gl)
      for (const p of [
        skyLutP, skyDomeP, roadP, roadDepthP, terrainP, meshDepthP, seaP,
        propP, propDepthP, railP, towerP, towerDepthP, brightP, blurP, compP,
        mawP, jawP, jawDepthP, tubeP, waterP, cockpitP,
      ])
        p.dispose()
    },
  }
}
