// The stillwater service's renderer: everything built once, a frame of a few
// dozen draws into an HDR target, then bloom and the film.
//
//   1. sky        the fog morning, fading to the same haze the sea fades to
//   2. sea        a displaced grid, swell by lap
//   3. world      rooms, props and supports, a draw per material
//   4. flume      shell and flanges, opaque
//   5. clear      glass, standing water, the trough's water, the acrylic tube
//   6. post       bloom pyramid, exposure, ACES, the warp's image effects

import { createMaterialArrays, createSkyTexture } from '@wjh/delta/gl'
import { skyAsset, sunDirection } from '@wjh/delta/manifest'
import { createMeshBuilder } from '@wjh/geometry/meshBuilder'
import { createGlProgram } from '@wjh/gl/program'
import type { GlProgram } from '@wjh/gl/program'
import { createFullscreenQuad, QUAD_VS_300 } from '@wjh/gl/quad'
import { createMesh } from '@wjh/gl/mesh'
import { createPostChain } from '@wjh/gl/targets'
import type { RenderTarget } from '@wjh/gl/targets'
import type { JourneyRenderer } from '@wjh/journey/types'
import { invert, lookAt, multiply, perspective } from '@wjh/math/mat4'
import { mix, smoothstep } from '@wjh/math/scalar'
import { buildFlume, buildSupports } from './flume'
import { buildAnnex, buildBreakwater, buildLounge, buildPool, buildSorting, buildSpiral, insideness, rigUniforms } from './rooms'
import { createPose, setPose } from './route'
import { compositeFrag, downFrag, flumeFrag, flumeVert, seaFrag, seaVert, skyFrag, upFrag, worldFrag, worldVert } from './shaders'
import { createStage, KIND } from './stage'
import type { Batch } from './stage'
import { momentAt } from './timeline'


const SKY     = 'FOG'
const SKY_YAW = 0.27
const FOV     = 1.12
const SUN     = [ 1.9, 1.55, 1.25 ] as const
const SWELL   = [ 1, 1.55, 2.6 ] as const

/** Plates of the carousel the wet tile rides, metres and radians per second. */
const CAROUSEL = { radius: 3.05, height: 1.37, speed: 0.21 } as const

function makeSea (gl: WebGL2RenderingContext, segments: number) {
  const mesh   = createMeshBuilder()
  const centre = [ 30, -10 ]
  // Cubic spacing: fine under the route, widening continuously to 6 km.
  const coordinate = (i: number) => {
    const t = i / segments * 2 - 1
    return t * 240 + t * t * t * (6000 - 240)
  }
  for (let iz = 0; iz <= segments; iz++)
    for (let ix = 0; ix <= segments; ix++)
      mesh.vertex(centre[0] + coordinate(ix), 0, centre[1] + coordinate(iz), 0, 1, 0, 0, 0)
  for (let iz = 0; iz < segments; iz++)
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * (segments + 1) + ix
      const b = a + segments + 1
      mesh.face(a, b, b + 1)
      mesh.face(a, b + 1, a + 1)
    }
  return createMesh(gl, mesh)
}

export function createStillwaterScene (gl: WebGL2RenderingContext): JourneyRenderer | null {
  const programs = {
    world:     createGlProgram(gl, worldVert, worldFrag, 'stillwater world'),
    flume:     createGlProgram(gl, flumeVert, flumeFrag, 'stillwater flume'),
    sea:       createGlProgram(gl, seaVert, seaFrag, 'stillwater sea'),
    sky:       createGlProgram(gl, QUAD_VS_300, skyFrag, 'stillwater sky'),
    down:      createGlProgram(gl, QUAD_VS_300, downFrag, 'stillwater bloom down'),
    up:        createGlProgram(gl, QUAD_VS_300, upFrag, 'stillwater bloom up'),
    composite: createGlProgram(gl, QUAD_VS_300, compositeFrag, 'stillwater composite'),
  }
  const all = Object.values(programs)
  if (all.some(p => !p)) {
    all.forEach(p => p?.dispose())
    return null
  }

  const { world, flume, sea, sky, down, up, composite } = programs as Record<keyof typeof programs, GlProgram>

  const materials = createMaterialArrays(gl)
  const skyMap    = createSkyTexture(gl, SKY)
  const sun       = sunDirection(skyAsset(SKY), SKY_YAW)
  const rigs      = rigUniforms()
  const quad      = createFullscreenQuad(gl)
  const chain     = createPostChain(gl, { hdr: true, msaa: 4, bloomLevels: 5 })

  const stage = createStage()
  for (const build of [ buildPool, buildAnnex, buildSpiral, buildBreakwater, buildLounge, buildSorting, buildSupports ])
    build(stage)

  const batches = stage.upload(gl)
  const opaque  = batches.filter(b => b.material.kind !== KIND.glass && b.material.kind !== KIND.water)
  const clear   = batches.filter(b => !opaque.includes(b))
  const trough  = buildFlume(gl)
  const seas    = [ makeSea(gl, 128), makeSea(gl, 224) ]

  const proj                             = new Float32Array(16)
  const view                             = new Float32Array(16)
  const vp                               = new Float32Array(16)
  const inverse                          = new Float32Array(16)
  const pose                             = createPose()
  const look: [number, number, number]   = [ 0, 0, 0 ]
  const tile: [number, number, number]   = [ 0, 0, 0 ]
  const ORIGIN: [number, number, number] = [ 0, 0, 0 ]

  for (const p of [ world, flume, sea, sky ]) {
    p.use()
    p.uniform1i('uMatColor', 0)
    p.uniform1i('uMatNormal', 1)
    p.uniform1i('uMatDetail', 2)
    p.uniform1i('uSky', 3)
    p.uniform4fv('uRoomMin', rigs.min)
    p.uniform4fv('uRoomMax', rigs.max)
    p.uniform4fv('uRoomGrid', rigs.grid)
    p.uniform4fv('uRoomLamp', rigs.lamp)
  }

  function common (p: GlProgram, cue: ReturnType<typeof momentAt>, time: number, under: number): void {
    p.use()
    p.uniformMatrix4fv('uViewProjection', vp)
    p.uniform3f('uEye', ...pose.eye)
    p.uniform3f('uForward', ...pose.forward)
    p.uniform1f('uWarp', cue.warp)
    p.uniform1f('uTime', time)
    p.uniform1f('uLap', cue.lap)
    p.uniform1f('uDissolve', cue.dissolve)
    p.uniform1f('uUnder', under)
    p.uniform1f('uSkyExposure', skyMap.exposure)
    p.uniform1f('uSkyYaw', SKY_YAW)
    p.uniform3f('uSunDir', ...sun)
    p.uniform3f('uSunColor', ...SUN)
    p.uniform1f('uSwell', SWELL[cue.lap])
  }

  function drawBatches (list: Batch[], lap: number): void {
    for (const { mesh, style, material } of list) {
      if (lap < (style.firstLap ?? 0) || lap > (style.lastLap ?? 2))
        continue
      world.uniform1i('uKind', material.kind)
      world.uniform1f('uLayer', material.layer ?? 0)
      world.uniform3f('uTint', ...material.tint)
      world.uniform1f('uRough', material.rough ?? 0)
      world.uniform3f('uOffset', ...style.carried ? tile : ORIGIN)
      mesh.draw(gl)
    }
  }

  function bloom (levels: readonly RenderTarget[]): void {
    let source = chain.scene
    down.use()
    down.uniform1i('uSource', 0)
    gl.activeTexture(gl.TEXTURE0)
    for (const [ i, target ] of levels.entries()) {
      target.bind()
      gl.bindTexture(gl.TEXTURE_2D, source.tex)
      down.uniform2f('uTexel', 1 / source.width, 1 / source.height)
      down.uniform2f('uOut', 1 / target.width, 1 / target.height)
      down.uniform1f('uKnee', i === 0 ? 1.1 : 0)
      quad.draw()
      source = target
    }
    up.use()
    up.uniform1i('uSource', 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    for (let i = levels.length - 2; i >= 0; i--) {
      levels[i].bind()
      gl.bindTexture(gl.TEXTURE_2D, levels[i + 1].tex)
      up.uniform2f('uTexel', 1 / levels[i + 1].width, 1 / levels[i + 1].height)
      up.uniform2f('uOut', 1 / levels[i].width, 1 / levels[i].height)
      quad.draw()
    }
    gl.disable(gl.BLEND)
  }

  return {
    ready:    () => materials.ready && skyMap.ready,
    progress: () => (Number(materials.ready) + Number(skyMap.ready)) / 2,

    draw (frame) {
      const cue     = momentAt(frame.time)
      const time    = frame.time - cue.signalAge
      const quality = frame.quality ?? { tier: 2, msaa: 4, bloomLevels: 5 }
      const width   = gl.drawingBufferWidth
      const height  = gl.drawingBufferHeight
      chain.resize(width, height, { msaa: quality.msaa, bloomLevels: Math.max(2, quality.bloomLevels) })

      setPose(pose, cue.within, cue.lap, time, cue.warp, frame.pointer?.x ?? 0, frame.pointer?.y ?? 0)

      const under = smoothstep(0.25, -0.5, pose.eye[1])
      look[0]     = pose.eye[0] + pose.forward[0]
      look[1]     = pose.eye[1] + pose.forward[1]
      look[2]     = pose.eye[2] + pose.forward[2]
      perspective(proj, FOV * (1 - cue.warp * 0.16 * Math.sin(time * 0.19)), width / height, 0.05, 30000)
      lookAt(view, pose.eye, look, pose.up)
      multiply(vp, proj, view)
      invert(inverse, vp)

      const angle = time * CAROUSEL.speed
      tile[0]     = -6 + Math.sin(angle) * CAROUSEL.radius
      tile[1]     = CAROUSEL.height
      tile[2]     = -50.5 + Math.cos(angle) * CAROUSEL.radius

      materials.bind(gl, 0)
      skyMap.bind(gl, 3)
      chain.bindScene()
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.BLEND)

      gl.disable(gl.DEPTH_TEST)
      common(sky, cue, time, under)
      sky.uniformMatrix4fv('uInverse', inverse)
      sky.uniform2f('uResolution', width, height)
      quad.draw()

      gl.enable(gl.DEPTH_TEST)
      gl.depthMask(true)
      common(sea, cue, time, under)
      seas[quality.tier > 0 ? 1 : 0].draw(gl)

      common(world, cue, time, under)
      drawBatches(opaque, cue.lap)

      common(flume, cue, time, under)
      flume.uniform1f('uBelt', 2.7)
      flume.uniform1i('uPass', 0)
      trough.shell.draw(gl)
      trough.flanges.draw(gl)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      flume.uniform1i('uPass', 2)
      trough.water.draw(gl)
      flume.uniform1i('uPass', 1)
      trough.shell.draw(gl)
      common(world, cue, time, under)
      drawBatches(clear, cue.lap)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)

      chain.resolve()
      bloom(chain.bloom)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      composite.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, chain.scene.tex)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, chain.bloom[0].tex)
      composite.uniform1i('uScene', 0)
      composite.uniform1i('uBloom', 1)
      composite.uniform2f('uResolution', width, height)
      composite.uniform1f('uExposure', 0.85 * mix(1, 1.45, insideness(pose.eye)) * mix(1, 2, under))
      composite.uniform1f('uWarp', cue.warp)
      composite.uniform1f('uTime', time)
      composite.uniform1f('uUnder', under)
      quad.draw()
    },

    dispose () {
      for (const { mesh } of batches)
        mesh.dispose(gl)
      trough.shell.dispose(gl)
      trough.flanges.dispose(gl)
      trough.water.dispose(gl)
      seas.forEach(m => m.dispose(gl))
      quad.dispose()
      chain.dispose()
      materials.dispose(gl)
      skyMap.dispose(gl)
      all.forEach(p => p?.dispose())
    },
  }
}
