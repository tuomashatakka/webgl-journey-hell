import { createGlProgram } from '@wjh/gl/program'
import { createFullscreenQuad, QUAD_VS_300 } from '@wjh/gl/quad'
import { invert, lookAt, multiply, perspective } from '@wjh/math/mat4'
import type { JourneyRenderer } from '@wjh/journey/types'
import { buildBreakwater, makeOcean } from './breakwater'
import type { Batch } from './geometry'
import { createStage, SURFACE } from './geometry'
import { buildAnnex, buildCarousel, buildLift, buildLounge, buildPool } from './interiors'
import { setPose, setTilePosition } from './route'
import { screenFrag, worldFrag, worldVert } from './shaders'
import { momentAt } from './timeline'
import type { Act } from './timeline'


const BUILDERS = {
  pool:       buildPool,
  annex:      buildAnnex,
  lift:       buildLift,
  breakwater: buildBreakwater,
  lounge:     buildLounge,
  carousel:   buildCarousel,
}

const AIR = {
  pool:       [ 0.29, 0.43, 0.4, 0.018 ],
  annex:      [ 0.27, 0.218, 0.114, 0.049 ],
  lift:       [ 0.057, 0.07, 0.068, 0.063 ],
  breakwater: [ 0.235, 0.297, 0.333, 0.00034 ],
  lounge:     [ 0.034, 0.226, 0.269, 0.117 ],
  carousel:   [ 0.38, 0.44, 0.416, 0.036 ],
} as const

export function createStillwaterScene (gl: WebGL2RenderingContext): JourneyRenderer | null {
  const world  = createGlProgram(gl, worldVert, worldFrag, 'stillwater world')
  const screen = createGlProgram(gl, QUAD_VS_300, screenFrag, 'stillwater screen')
  if (!world || !screen) {
    world?.dispose()
    screen?.dispose()
    return null
  }

  const quad                           = createFullscreenQuad(gl)
  const ocean                          = makeOcean(gl, 224)
  const lightOcean                     = makeOcean(gl, 128)
  const stages                         = new Map<Act, Batch[]>()
  const proj                           = new Float32Array(16)
  const view                           = new Float32Array(16)
  const viewProjection                 = new Float32Array(16)
  const inverse                        = new Float32Array(16)
  const pose                           = { eye: [ 0, 0, 0 ], look: [ 0, 0, 1 ], up: [ 0, 1, 0 ]} satisfies Record<string, [number, number, number]>
  const tile: [number, number, number] = [ 0, 0, 0 ]

  function stageFor (act: Act): Batch[] {
    let stage = stages.get(act)
    if (!stage) {
      const builder = createStage()
      BUILDERS[act](builder)
      stage = builder.upload(gl)
      stages.set(act, stage)
    }
    return stage
  }

  return {
    draw (frame) {
      const cue        = momentAt(frame.time)
      const high       = (frame.quality?.tier ?? 2) > 0 && frame.heavy !== 0
      const atSea      = cue.id === 'breakwater'
      const underwater = cue.id === 'lounge'
      const width      = gl.drawingBufferWidth
      const height     = gl.drawingBufferHeight
      const air        = AIR[cue.id]
      const density    = air[3] * (1 + cue.lap * (atSea ? -0.1 : 0.17))
      const time       = frame.time - cue.signalAge
      setPose(pose, cue, frame.pointer?.x ?? 0, frame.pointer?.y ?? 0)

      perspective(proj, 1.13, width / height, 0.075, atSea ? 10100 : 130)
      lookAt(view, pose.eye, pose.look, pose.up)
      multiply(viewProjection, proj, view)
      invert(inverse, viewProjection)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      gl.clearColor(air[0], air[1], air[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)

      if (atSea || cue.shutter > 0 || underwater) {
        screen.use()
        screen.uniform2f('uResolution', width, height)
        screen.uniform4f('uAir', air[0], air[1], air[2], density)
        screen.uniform1f('uTime', time)
        screen.uniform1f('uLap', cue.lap)
      }
      if (atSea) {
        screen.uniform1i('uScreen', 0)
        screen.uniformMatrix4fv('uInverse', inverse)
        screen.uniform3f('uEye', ...pose.eye)
        quad.draw()
      }

      gl.enable(gl.DEPTH_TEST)
      world.use()
      world.uniformMatrix4fv('uViewProjection', viewProjection)
      world.uniform3f('uEye', ...pose.eye)
      world.uniform4f('uAir', air[0], air[1], air[2], density)
      world.uniform1i('uScene', cue.section)
      world.uniform1i('uHigh', high ? 1 : 0)
      world.uniform1f('uTime', time)
      world.uniform1f('uLap', cue.lap)

      if (atSea) {
        world.uniform1i('uMaterial', SURFACE.ocean)
        world.uniform3f('uOffset', 0, 0, 0)

        const waterMesh = high ? ocean : lightOcean
        waterMesh.draw(gl)
      }

      if (cue.id === 'carousel')
        setTilePosition(tile, cue.local)
      for (const { mesh, style } of stageFor(cue.id)) {
        if (cue.lap < (style.firstLap ?? 0) || cue.lap > (style.lastLap ?? 2))
          continue

        const c = style.color
        world.uniform1i('uMaterial', SURFACE[style.surface])
        world.uniform3f('uColor', (c >> 16) / 255, (c >> 8 & 255) / 255, (c & 255) / 255)
        if (style.motion === 'cage')
          world.uniform3f('uOffset', 0, pose.eye[1], 0)
        else if (style.motion === 'tile')
          world.uniform3f('uOffset', ...tile)
        else
          world.uniform3f('uOffset', 0, 0, 0)
        mesh.draw(gl)
      }
      gl.disable(gl.DEPTH_TEST)

      if (underwater) {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        screen.use()
        screen.uniform1i('uScreen', 2)
        quad.draw()
        gl.disable(gl.BLEND)
      }
      if (cue.shutter > 0) {
        screen.use()
        screen.uniform1i('uScreen', 1)
        screen.uniform1i('uDoor', cue.door)
        screen.uniform1f('uShutter', cue.shutter)
        quad.draw()
      }
    },

    dispose () {
      for (const stage of stages.values())
        for (const { mesh } of stage)
          mesh.dispose(gl)
      ocean.dispose(gl)
      lightOcean.dispose(gl)
      quad.dispose()
      world.dispose()
      screen.dispose()
    },
  }
}
