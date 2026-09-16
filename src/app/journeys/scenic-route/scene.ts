// THE SCENIC ROUTE — the renderer.
//
// A WebGL2 rasterizer behind components/withGeometryJourney, following
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
import { createMesh, createMeshFromArrays } from '@/lib/mesh'
import type { Mesh } from '@/lib/mesh'
import { invert, lookAt, multiply, perspective } from '@/lib/mat4'
import type { Mat4 } from '@/lib/mat4'
import { SWEEP_FLOATS, SWEEP_LAYOUT, finishSweep, levelFrame, newFrame, sweepProfile } from '@/lib/sweep'
import type { ProfilePoint } from '@/lib/sweep'
import type { JourneyRenderer } from '@/components/withJourneyShell'
import type { QuadFrameUniforms } from '@/lib/shaderQuad'
import { BANK_STEP, SECTION_COUNT, bankGainAt, getRoute, lookAt as lookParamsAt, sectionWeights } from './course'
import type { LookParams } from './course'
import { SEA_PATCH, buildFarMesh, buildNearChunks, buildSeaPatch, buildSeaQuad, buildSpineIndex } from './geometry'
import { FLESH_END, ROCK_START, buildMaw, buildTube, jawAngleAt } from './maw'
import type { Jaw } from './maw'
import { buildProps } from './props'
import type { PropSet } from './props'
import { bendGainAt, buildCity } from './city'
import { DIAL, SPEEDO, TACHO, buildCockpit, dialNormal, dialPoint, drawDialFaces, needleAngle } from './cockpit'
import {
  blurFrag,
  brightFrag,
  cockpitFrag,
  cockpitVert,
  compositeFrag,
  depthFrag,
  jawFrag,
  jawVert,
  mawFrag,
  meshVert,
  postVert,
  propDepthFrag,
  propFrag,
  propVert,
  railFrag,
  roadFrag,
  seaFrag,
  seaVert,
  skyDomeFrag,
  skyLutFrag,
  skyVert,
  sweepVert,
  terrainFrag,
  towerFrag,
  towerVert,
  tubeFrag,
  waterFrag

} from './shader'


const FOV_BASE = 62 * Math.PI / 180

/** Sky LUT size. Rows 0..63 are elevation, row 64 the sun's radiance. */
const SKY_W = 128
const SKY_H = 65

/** Bank LUT texture width; rows wrap. */
const BANK_TEX_W = 1024

/** Linear exposure at 0 EV. */
const EXPOSURE_BASE = 0.9

/** The sun's depth map: size, and the half-width of the box it covers. */
const SHADOW_SIZE  = 2048
const SHADOW_HALF  = 170
const SHADOW_DEPTH = 900

/** Beyond this the fog has closed and a terrain chunk contributes nothing. */
const CULL_DIST = 1700

/** How far the fish's head and lips sit under the sea before it surfaces. */
const HEAD_DROP = 95

/** Jaw angle (rad, lower jaw's share) that shuts the mouth before the car is off the lip. */
const JAW_SHUT = 1.0


/** How far above the river's spine the land is raised inland: over the vault (1.42 × the widest ring), falling to the road at the portal. */
const PORTAL_LIFT = 30

/** The rear-view pass: the mirror glass is 3.3:1. */
const MIRROR_W = 320
const MIRROR_H = 96

interface Drawable {
  mesh:   Mesh;
  cx:     number;
  cy:     number;
  cz:     number;
  radius: number;
}

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

/** The [-1,1] -> [0,1] remap the shadow lookup wants, as a matrix. */
const BIAS: Mat4 = new Float32Array([
  0.5, 0, 0, 0,
  0, 0.5, 0, 0,
  0, 0, 0.5, 0,
  0.5, 0.5, 0.5, 1,
])

export function createScenicRouteScene (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const skyLutP     = createGlProgram(gl, postVert, skyLutFrag)
  const skyDomeP    = createGlProgram(gl, skyVert, skyDomeFrag)
  const roadP       = createGlProgram(gl, sweepVert, roadFrag)
  const roadDepthP  = createGlProgram(gl, sweepVert, depthFrag)
  const terrainP    = createGlProgram(gl, meshVert, terrainFrag)
  const meshDepthP  = createGlProgram(gl, meshVert, depthFrag)
  const seaP        = createGlProgram(gl, seaVert, seaFrag)
  const mawP        = createGlProgram(gl, sweepVert, mawFrag)
  const jawP        = createGlProgram(gl, jawVert, jawFrag)
  const jawDepthP   = createGlProgram(gl, jawVert, depthFrag)
  const tubeP       = createGlProgram(gl, sweepVert, tubeFrag)
  const waterP      = createGlProgram(gl, sweepVert, waterFrag)
  const cockpitP    = createGlProgram(gl, cockpitVert, cockpitFrag)
  const propP       = createGlProgram(gl, propVert, propFrag)
  const propDepthP  = createGlProgram(gl, propVert, propDepthFrag)
  const railP       = createGlProgram(gl, sweepVert, railFrag)
  const towerP      = createGlProgram(gl, towerVert, towerFrag)
  const towerDepthP = createGlProgram(gl, towerVert, depthFrag)
  const brightP     = createGlProgram(gl, postVert, brightFrag)
  const blurP       = createGlProgram(gl, postVert, blurFrag)
  const compP       = createGlProgram(gl, postVert, compositeFrag)
  if (!skyLutP || !skyDomeP || !roadP || !roadDepthP || !terrainP || !meshDepthP || !seaP ||
    !propP || !propDepthP || !railP || !towerP || !towerDepthP || !brightP || !blurP || !compP ||
    !mawP || !jawP || !jawDepthP || !tubeP || !waterP || !cockpitP)
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
  const floatExt = gl.getExtension('EXT_color_buffer_float')
  const skyTex   = floatExt
    ? makeTex(gl, SKY_W, SKY_H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)
    : makeTex(gl, SKY_W, SKY_H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
  gl.bindTexture(gl.TEXTURE_2D, skyTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)

  const skyFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTex, 0)

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

  // --- the land ----------------------------------------------------------------
  // The land follows the road sections, and rises over the cave so the tunnel
  // is under a hill; the hill falls back to road level at the seam, where the
  // tube comes out of the ground as a portal.
  const seam  = route.spans[6].s1
  const spine = buildSpineIndex(route, [ 0, 1, 3, 6 ], 32, (section, s) => {
    if (section !== 6)
      return 0

    const f = Math.min(1, Math.max(0, (s - (seam - 50)) / 44))
    return PORTAL_LIFT * (1 - f * f * (3 - 2 * f))
  })
  // The land is carved away wherever it would pass through the throat or the
  // cave: the tube's spine lets every terrain vertex know how far inside it is.
  spine.tube = { idx: buildSpineIndex(route, [ 5, 6 ], 32), s0: route.spans[5].s0 }

  const chunks: Drawable[] = buildNearChunks(spine).map(c => ({
    mesh: createMesh(gl, c.builder), cx: c.cx, cy: c.cy, cz: c.cz, radius: c.radius,
  }))
  const far     = buildFarMesh(spine)
  const farMesh = createMesh(gl, far.builder)
  // The sea is whole: where the fish surfaces, seaVert drops the surface
  // inside the mouth's footprint and heaps a bow wave around it.
  const seaMesh   = createMesh(gl, buildSeaQuad())
  const patchMesh = createMesh(gl, buildSeaPatch(SEA_PATCH.x, SEA_PATCH.z, SEA_PATCH.halfX, SEA_PATCH.halfZ, SEA_PATCH.cells))

  // --- the maw -------------------------------------------------------------------
  const maw      = buildMaw(route)
  const mouthF   = levelFrame(route.curve, maw.s0, newFrame())
  const mouthLen = Math.hypot(mouthF.forward.x, mouthF.forward.z) || 1
  const mouthDir = [ mouthF.forward.x / mouthLen, mouthF.forward.z / mouthLen ]
  const headMesh = createMeshFromArrays(
    gl, maw.head.vertices, maw.head.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0,
  )
  const jaws: { jaw: Jaw; mesh: Mesh }[] = [ maw.upper, maw.lower ].map(jaw => ({
    jaw, mesh: createMesh(gl, jaw.builder),
  }))
  const tube      = buildTube(route)
  const tubeFront = createMeshFromArrays(gl, tube.front.vertices, tube.front.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0)
  const tubeBack  = createMeshFromArrays(gl, tube.back.vertices, tube.back.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0)
  const waterMesh = createMeshFromArrays(gl, tube.water.vertices, tube.water.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0)

  // --- the props ---------------------------------------------------------------
  const props: { set: PropSet; mesh: Mesh }[] = buildProps(route, spine).map(set => {
    const mesh = createMesh(gl, set.builder, 2)
    mesh.setInstances(gl, set.instances)
    return { set, mesh }
  })

  // --- downtown ------------------------------------------------------------------
  const city      = buildCity(route, spine)
  const towerMesh = createMesh(gl, city.builder, 3)
  towerMesh.setInstances(gl, city.instances)

  // --- the coast guardrail -----------------------------------------------------
  // A band on the sea side of section IV, swept like the road so the bank LUT
  // rolls it with the surface it guards.
  const railArrays = finishSweep(sweepProfile(route.curve, {
    s0:      route.spans[3].s0 + 6,
    s1:      route.spans[3].s1 - 4,
    step:    2.0,
    profile: (s: number): ProfilePoint[] => {
      lookParamsAt(route, s, w, look)

      const e = -(look.roadHalf + 0.6)
      return [[ e, 0.78 ], [ e - 0.06, 0.6 ], [ e, 0.42 ]]
    },
  }))
  const railMesh: Mesh = createMeshFromArrays(
    gl, railArrays.vertices, railArrays.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0,
  )

  // --- the cockpit -----------------------------------------------------------------
  const cockpit    = buildCockpit()
  const cabinMesh  = createMesh(gl, cockpit.cabin)
  const wheelMesh  = createMesh(gl, cockpit.wheel)
  const speedoMesh = createMesh(gl, cockpit.speedo)
  const tachoMesh  = createMesh(gl, cockpit.tacho)
  // The rear view for the mirror: a small colour target with its own depth.
  const mirrorTex   = makeTex(gl, MIRROR_W, MIRROR_H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
  const mirrorDepth = gl.createRenderbuffer()
  gl.bindRenderbuffer(gl.RENDERBUFFER, mirrorDepth)
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, MIRROR_W, MIRROR_H)

  const mirrorFbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, mirrorFbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mirrorTex, 0)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, mirrorDepth)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

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

  const drawQuad = (prog: GlProgram) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)

    const loc = prog.attrib('aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  const vec = (c: QuadFrameUniforms['custom'], k: string, d: number[]): number[] =>
    (c?.[k] as number[] | undefined) ?? d

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
    draw ({ time, pointer, heavy, custom }: QuadFrameUniforms) {
      const w = canvas.width
      const h = canvas.height
      resize(w, h)

      const camPos = vec(custom, 'uCamPos', [ 0, 0, 0 ])
      const camFwd = vec(custom, 'uCamFwd', [ 0, 0, 1 ])
      const camUp  = vec(custom, 'uCamUp', [ 0, 1, 0 ])
      const ride   = vec(custom, 'uRide', [ 0, 0, 0, 0 ])
      const sun    = vec(custom, 'uSun', [ 0, 0.2, 1, 0.2 ])
      const env    = vec(custom, 'uEnv', [ 0, 1, 0.001, -1e4 ])
      const fogCol = vec(custom, 'uFogCol', [ 0.6, 0.65, 0.7, 0 ])
      const flt    = vec(custom, 'uFloat', [ 0, 0, 0, 3.4 ])
      const car    = vec(custom, 'uCar', [ 0, 1, 0, 0 ])
      const loop   = vec(custom, 'uLoop', [ 0, 0, 0, 0 ])
      // (fall weight, fish risen, jaws open, shake); without a sim the fish is up and open.
      const fall    = vec(custom, 'uFall', [ 0, 1, 1, 0 ])
      const isHeavy = (heavy ?? 1) > 0.5
      carPos   = vec(custom, 'uCarPos', camPos)
      carFwd   = vec(custom, 'uCarFwd', camFwd)
      carRight = vec(custom, 'uCarRight', [ 1, 0, 0 ])

      const carUp = vec(custom, 'uCarUp', [ 0, 1, 0 ])
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo)
      gl.viewport(0, 0, SKY_W, SKY_H)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      skyLutP.use()
      skyLutP.uniform3f('uSunDir', sun[0], sun[1], sun[2])
      skyLutP.uniform1f('uCamAlt', Math.max(camPos[1] + 60, 2))
      gl.uniform2i(skyLutP.loc('uSteps'), isHeavy ? 10 : 5, isHeavy ? 4 : 2)
      drawQuad(skyLutP)

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
        drawQuad(skyDomeP)
        gl.depthMask(true)
      }

      // --- 2b. the rear view ---
      // Looking back along the car, wide, into the mirror's texture.
      gl.bindFramebuffer(gl.FRAMEBUFFER, mirrorFbo)
      gl.viewport(0, 0, MIRROR_W, MIRROR_H)
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
      gl.viewport(0, 0, w, h)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      drawWorld(viewProj, camPos, [ fx, fy, fz ], invViewProj)

      // --- 5. resolve ---
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFbo)
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST)

      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)

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

      // --- 6. composite ---
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

      // --- 7. the cockpit ---
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
      gl.bindTexture(gl.TEXTURE_2D, mirrorTex)
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
      cockpitP.uniform1f('uAngle', -car[2] * 2.6 + fall[3] * 0.09 * Math.sin(time * 31.0))
      wheelMesh.draw(gl)
      // Needles by reading.
      cockpitP.uniform3f('uAxis', dialN.x, dialN.y, dialN.z)
      cockpitP.uniform3f('uPivot', speedoPivot.x, speedoPivot.y, speedoPivot.z)
      cockpitP.uniform1f('uAngle', needleAngle(SPEEDO, ride[0] * 3.6))
      speedoMesh.draw(gl)
      cockpitP.uniform3f('uPivot', tachoPivot.x, tachoPivot.y, tachoPivot.z)
      cockpitP.uniform1f('uAngle', needleAngle(TACHO, car[0] * 7800))
      tachoMesh.draw(gl)
    },

    dispose () {
      releaseTargets()
      gl.deleteBuffer(quad)
      gl.deleteTexture(bankTex)
      gl.deleteTexture(skyTex)
      gl.deleteFramebuffer(skyFbo)
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
      gl.deleteTexture(mirrorTex)
      gl.deleteRenderbuffer(mirrorDepth)
      gl.deleteFramebuffer(mirrorFbo)
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
