// THE SCENIC ROUTE — the renderer.
//
// A WebGL2 rasterizer behind components/withGeometryJourney, following
// loop-line's shape: everything built once at construction, a frame that is a
// handful of draws and a post chain, nothing uploaded per frame but uniforms.
//
// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------
//
//   1. sky LUT      — 128×65 lat-long, full single scattering, into a texture.
//   2. world        — into a multisampled target: the swept road (rolled live by
//                     the bank LUT), then the terrain, city, sea, maw and tube as
//                     the phases land.
//   3. sky dome     — a fullscreen triangle at far depth, filling what is left.
//   4. resolve → bright → blur ×2 → composite (exposure, ACES, speed blur).
//
// lib/crtPass then reads the back buffer and adds the tube and the signal loss
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

import { createGlProgram } from '@/lib/glProgram'
import type { GlProgram } from '@/lib/glProgram'
import { createMeshFromArrays } from '@/lib/mesh'
import type { Mesh } from '@/lib/mesh'
import { invert, lookAt, multiply, perspective } from '@/lib/mat4'
import type { Mat4 } from '@/lib/mat4'
import { SWEEP_FLOATS, SWEEP_LAYOUT, finishSweep, sweepProfile } from '@/lib/sweep'
import type { ProfilePoint } from '@/lib/sweep'
import type { JourneyRenderer } from '@/components/withJourneyShell'
import type { QuadFrameUniforms } from '@/lib/shaderQuad'
import { BANK_STEP, bankGainAt, getRoute, lookAt as lookParamsAt, sectionWeights, SECTION_COUNT } from './course'
import type { LookParams } from './course'
import {
  blurFrag,
  brightFrag,
  compositeFrag,
  postVert,
  roadFrag,
  skyDomeFrag,
  skyLutFrag,
  skyVert,
  sweepVert

} from './shader'


const FOV_BASE = 62 * Math.PI / 180

/** Sky LUT size. Rows 0..63 are elevation, row 64 the sun's radiance. */
const SKY_W = 128
const SKY_H = 65

/** Bank LUT texture width; rows wrap. */
const BANK_TEX_W = 1024

/** Linear exposure at 0 EV. The scatter model's radiances want lifting a touch. */
const EXPOSURE_BASE = 0.9

function makeTex (
  gl: WebGL2RenderingContext, w: number, h: number,
  internal: number, format: number, type: number, filter: number,
): WebGLTexture | null {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

export function createScenicRouteScene (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const skyLutP  = createGlProgram(gl, postVert, skyLutFrag)
  const skyDomeP = createGlProgram(gl, skyVert, skyDomeFrag)
  const roadP    = createGlProgram(gl, sweepVert, roadFrag)
  const brightP  = createGlProgram(gl, postVert, brightFrag)
  const blurP    = createGlProgram(gl, postVert, blurFrag)
  const compP    = createGlProgram(gl, postVert, compositeFrag)
  if (!skyLutP || !skyDomeP || !roadP || !brightP || !blurP || !compP)
    return null

  const route = getRoute()

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
  // Half float when the context can render to it (every desktop and any iOS
  // since 15); otherwise RGBA8 and the exposure eats the banding.
  const floatExt = gl.getExtension('EXT_color_buffer_float')
  const skyTex   = floatExt
    ? makeTex(gl, SKY_W, SKY_H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)
    : makeTex(gl, SKY_W, SKY_H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
  gl.bindTexture(gl.TEXTURE_2D, skyTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)

  const skyFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  // --- the road --------------------------------------------------------------
  // Swept once over the four road sections with the *level* frame; the vertex
  // shader rolls it. Seven points: verge, shoulder, edge, crown, edge, shoulder,
  // verge — walked left to right so the surface faces up.
  const w                = new Float32Array(SECTION_COUNT)
  const look: LookParams = { exposure: 0, sky: 1, fog: [ 0, 0, 0 ], fogDensity: 0, roadHalf: 3, surface: 0 }
  const profile          = (s: number): ProfilePoint[] => {
    lookParamsAt(route, s, w, look)

    const hw = look.roadHalf
    return [
      [ -hw - 2.2, -0.22 ], [ -hw - 0.6, -0.07 ], [ -hw, 0 ], [ 0, 0.05 ],
      [ hw, 0 ], [ hw + 0.6, -0.07 ], [ hw + 2.2, -0.22 ],
    ]
  }
  const roadArrays = finishSweep(sweepProfile(route.curve, {
    s0:        route.spans[0].s0,
    s1:        route.spans[3].s1,
    step:      2.0,
    profile,
    sectionAt: s => {
      sectionWeights(route, s, w)

      let best = 0
      for (let i = 1; i < SECTION_COUNT; i++)
        if (w[i] > w[best])
          best = i
      return best
    },
  }))
  const roadMesh: Mesh = createMeshFromArrays(
    gl, roadArrays.vertices, roadArrays.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0,
  )

  // --- post targets ------------------------------------------------------------
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ]), gl.STATIC_DRAW)

  let width  = 0
  let height = 0

  let msaaFbo: WebGLFramebuffer | null    = null
  let msaaColor: WebGLRenderbuffer | null = null
  let msaaDepth: WebGLRenderbuffer | null = null
  let sceneFbo: WebGLFramebuffer | null   = null
  let sceneTex: WebGLTexture | null       = null
  const bloomFbo: (WebGLFramebuffer | null)[] = [ null, null ]
  const bloomTex: (WebGLTexture | null)[]     = [ null, null ]

  const releaseTargets = () => {
    if (msaaFbo)
      gl.deleteFramebuffer(msaaFbo)
    if (msaaColor)
      gl.deleteRenderbuffer(msaaColor)
    if (msaaDepth)
      gl.deleteRenderbuffer(msaaDepth)
    if (sceneFbo)
      gl.deleteFramebuffer(sceneFbo)
    if (sceneTex)
      gl.deleteTexture(sceneTex)
    for (let i = 0; i < 2; i++) {
      if (bloomFbo[i])
        gl.deleteFramebuffer(bloomFbo[i])
      if (bloomTex[i])
        gl.deleteTexture(bloomTex[i])
    }
  }

  const resize = (w: number, h: number) => {
    if (w === width && h === height)
      return
    releaseTargets()
    width  = w
    height = h

    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)

    msaaColor = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColor)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h)
    msaaDepth = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaDepth)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h)

    msaaFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth)

    sceneTex = makeTex(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
    sceneFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0)

    const bw = Math.max(1, w >> 1)
    const bh = Math.max(1, h >> 1)
    for (let i = 0; i < 2; i++) {
      bloomTex[i] = makeTex(gl, bw, bh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
      bloomFbo[i] = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[i])
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTex[i], 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // --- per-frame scratch -----------------------------------------------------
  const proj: Mat4                       = new Float32Array(16)
  const view: Mat4                       = new Float32Array(16)
  const viewProj: Mat4                   = new Float32Array(16)
  const invViewProj: Mat4                = new Float32Array(16)
  const eye: [number, number, number]    = [ 0, 0, 0 ]
  const target: [number, number, number] = [ 0, 0, 1 ]
  const upv: [number, number, number]    = [ 0, 1, 0 ]

  const drawQuad = (prog: GlProgram) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)

    const loc = prog.attrib('aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  const vec = (c: QuadFrameUniforms['custom'], k: string, d: number[]): number[] =>
    (c?.[k] as number[] | undefined) ?? d

  return {
    draw ({ time, pointer, heavy, custom }: QuadFrameUniforms) {
      const w = canvas.width
      const h = canvas.height
      resize(w, h)

      const camPos  = vec(custom, 'uCamPos', [ 0, 0, 0 ])
      const camFwd  = vec(custom, 'uCamFwd', [ 0, 0, 1 ])
      const camUp   = vec(custom, 'uCamUp', [ 0, 1, 0 ])
      const ride    = vec(custom, 'uRide', [ 0, 0, 0, 0 ])
      const sun     = vec(custom, 'uSun', [ 0, 0.2, 1, 0.2 ])
      const env     = vec(custom, 'uEnv', [ 0, 1, 0.001, -1e4 ])
      const fogCol  = vec(custom, 'uFogCol', [ 0.6, 0.65, 0.7, 0 ])
      const flt     = vec(custom, 'uFloat', [ 0, 0, 0, 3.4 ])
      const isHeavy = (heavy ?? 1) > 0.5

      // Pointer look: yaw about the camera's up, pitch about its right.
      const px  = pointer?.x ?? 0
      const py  = pointer?.y ?? 0
      const yaw = px * 0.6
      const rx  = camFwd[1] * camUp[2] - camFwd[2] * camUp[1]
      const ry  = camFwd[2] * camUp[0] - camFwd[0] * camUp[2]
      const rz  = camFwd[0] * camUp[1] - camFwd[1] * camUp[0]
      const cy  = Math.cos(yaw)
      const sy  = Math.sin(yaw)
      // Rotate forward about up by yaw (Rodrigues, up ⟂ forward).
      let fx = camFwd[0] * cy + rx * sy
      let fy = camFwd[1] * cy + ry * sy
      let fz = camFwd[2] * cy + rz * sy
      // Pitch toward up.
      fx += camUp[0] * py * 0.45
      fy += camUp[1] * py * 0.45
      fz += camUp[2] * py * 0.45

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

      // The lens widens with speed — a little, the way a dashcam's does not but
      // a rider's attention does.
      const fov = FOV_BASE * (1 + Math.min(ride[0], 60) / 60 * 0.14)
      perspective(proj, fov, w / Math.max(1, h), 0.1, 4000)
      lookAt(view, eye, target, upv)
      multiply(viewProj, proj, view)
      invert(invViewProj, viewProj)

      const bankGain = bankGainAt(ride[1])
      const exposure = EXPOSURE_BASE * Math.pow(2, env[0])

      gl.disable(gl.BLEND)

      // --- 1. the sky LUT ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo)
      gl.viewport(0, 0, SKY_W, SKY_H)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      skyLutP.use()
      skyLutP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
      skyLutP.uniform1f('uCamAlt', Math.max(camPos[1] + 60, 2))
      gl.uniform2i(skyLutP.loc('uSteps'), isHeavy ? 10 : 5, isHeavy ? 4 : 2)
      drawQuad(skyLutP)

      // --- 2. the world ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
      gl.viewport(0, 0, w, h)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      // The road is two-sided: a corkscrew shows its underside from across the
      // helix, and a missing ribbon there reads as a hole in the world.
      gl.disable(gl.CULL_FACE)
      roadP.use()
      roadP.uniformMatrix4fv('uViewProj', viewProj)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, bankTex)
      roadP.uniform1i('uBankLut', 0)
      gl.uniform2i(roadP.loc('uBankInfo'), route.bankTable.length, 0)
      roadP.uniform1f('uBankStep', BANK_STEP)
      roadP.uniform1f('uBankGain', bankGain)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, skyTex)
      roadP.uniform1i('uSky', 1)
      roadP.uniform3f('uCamPos', camPos[0], camPos[1], camPos[2])
      roadP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
      roadP.uniform4f('uEnv', env[0], env[1], env[2], env[3])
      roadP.uniform3f('uFogCol', fogCol[0], fogCol[1], fogCol[2])
      roadP.uniform1f('uTime', time)
      roadP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
      roadP.uniform1f('uRoadHalf', flt[3])
      roadMesh.draw(gl)

      // --- 3. the sky dome ---
      gl.depthMask(false)
      skyDomeP.use()
      skyDomeP.uniformMatrix4fv('uInvViewProj', invViewProj)
      skyDomeP.uniform3f('uCamPos', camPos[0], camPos[1], camPos[2])
      skyDomeP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
      skyDomeP.uniform1f('uTime', time)
      skyDomeP.uniform1f('uSkyMix', env[1])
      skyDomeP.uniform3f('uFogCol', fogCol[0], fogCol[1], fogCol[2])
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, skyTex)
      skyDomeP.uniform1i('uSky', 1)
      // skyVert puts the quad at the far plane, so LEQUAL against the cleared
      // depth fills exactly the pixels nothing opaque claimed.
      drawQuad(skyDomeP)
      gl.depthMask(true)

      // --- 4. resolve ---
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFbo)
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST)

      gl.disable(gl.DEPTH_TEST)

      const bw = Math.max(1, w >> 1)
      const bh = Math.max(1, h >> 1)

      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[0])
      gl.viewport(0, 0, bw, bh)
      brightP.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sceneTex)
      brightP.uniform1i('uSrc', 0)
      brightP.uniform1f('uThreshold', 0.82)
      drawQuad(brightP)

      blurP.use()
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[(pass + 1) % 2])
        gl.viewport(0, 0, bw, bh)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, bloomTex[pass % 2])
        blurP.uniform1i('uSrc', 0)
        if (pass === 0)
          blurP.uniform2f('uDir', 1.7 / bw, 0)
        else
          blurP.uniform2f('uDir', 0, 1.7 / bh)
        drawQuad(blurP)
      }

      // --- 5. composite ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      compP.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sceneTex)
      compP.uniform1i('uScene', 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, bloomTex[0])
      compP.uniform1i('uBloom', 1)
      compP.uniform1f('uExposure', exposure)
      // The speed blur bites only past what the road ever reaches.
      compP.uniform1f('uSpeedBlur', Math.max(0, Math.min(1, (ride[0] - 36) / 24)))
      compP.uniform1f('uTime', time)
      drawQuad(compP)
    },

    dispose () {
      releaseTargets()
      gl.deleteBuffer(quad)
      gl.deleteTexture(bankTex)
      gl.deleteTexture(skyTex)
      gl.deleteFramebuffer(skyFbo)
      roadMesh.dispose(gl)
      skyLutP.dispose()
      skyDomeP.dispose()
      roadP.dispose()
      brightP.dispose()
      blurP.dispose()
      compP.dispose()
    },
  }
}
