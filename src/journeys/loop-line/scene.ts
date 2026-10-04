// THE LOOP LINE — the renderer.
//
// The whole circuit is built at construction — two kilometres of station,
// tube, hall, cutting, flood, viaduct and city, machine hall, yard and trestle,
// every sleeper and window and server — and never rebuilt. A frame is a
// handful of uniforms and the draws for whatever is within the fog:
//
//   sky (one quad) → the bays in reach, one draw per material and per prop
//   family → the headwalls, their portals cut per pixel → the flood → the cab
//   → MSAA resolve → five-level bloom → composite.
//
// ---------------------------------------------------------------------------
// Resolving the owning bay — the repo's most repeated bug
// ---------------------------------------------------------------------------
//
// natatorium's `resolveSlot` and switchback's `roomAt` exist because surfaces
// were shaded with the *camera's* section instead of their own. A rasterizer
// makes the right answer natural: bay parameters are per-draw uniforms, and a
// bay's geometry is only submitted with its own. What changed in this version
// is that "its own" is no longer a constant across the bay: the medium is
// blended by arc length per vertex (see shader.ts), with each draw supplying
// its neighbours, so that a doorway between two rooms is a gradient and never
// a seam. The camera's medium is computed here by the same function.
//
// ---------------------------------------------------------------------------
// Which sky
// ---------------------------------------------------------------------------
//
// Open bays have skies and the skies disagree (noon, dusk, night, the void),
// so the sky is only ever changed where it cannot be seen: an enclosed bay
// shows the sky of the next open bay ahead — through its far portal — except
// for its first twenty-five metres, where the portal you came in by is still
// behind your shoulder. The one open-to-open boundary, depot to trestle,
// crossfades two night skies across sixty metres.

import type { JourneyRenderer } from '@wjh/journey/types'
import { HIGH_QUALITY } from '@wjh/gl/uniforms'
import { createFullscreenQuad } from '@wjh/gl/quad'
import { createGlProgram } from '@wjh/gl/program'
import { createPostChain } from '@wjh/gl/targets'
import type { GlProgram } from '@wjh/gl/program'
import { invert, lookAt, multiply, perspective } from '@wjh/math/mat4'
import type { Mat4 } from '@wjh/math/mat4'
import type { FrameUniforms } from '@wjh/gl/uniforms'
import { createMaterialArrays, createSkyTexture } from '@wjh/delta/gl'
import type { SkyTexture } from '@wjh/delta/gl'
import { skyAsset, sunDirection } from '@wjh/delta/manifest'
import { BAYS, CHORD_BAY, Theme, getCircuits, spanIndexAt } from './stations'
import type { Circuits } from './stations'
import { SURF } from './geometry/surfaces'
import { MAX_SCATTER } from './shader/header'
import { bloomDownFrag, bloomUpFrag, compositeFrag, postVert } from './shader/post'
import { loopLineFrag, loopLineVert, skyFrag, skyVert } from './shader/world'

import { mediumAt, buildBays } from './scene/bays'
import type { BayRender } from './scene/bays'
import { buildCab, buildFlood, buildWalls } from './scene/fixtures'
import { exposureAt, gatherScatter, skyCrossfade } from './scene/lighting'
import { composite, runBloom } from './scene/post'
import { SKY_YAW, createBayUniforms, setFrame } from './scene/uniforms'
import type { FrameType } from './scene/uniforms'

/** A bay is skipped once its bounding sphere is this far into the fog. */
const CULL_DIST = 420

const FOV = 70 * Math.PI / 180

export function createLoopLineScene (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const surfProg  = createGlProgram(gl, loopLineVert, loopLineFrag('surface'))
  const wallProg  = createGlProgram(gl, loopLineVert, loopLineFrag('headwall'))
  const waterProg = createGlProgram(gl, loopLineVert, loopLineFrag('water'))
  const skyProg   = createGlProgram(gl, skyVert, skyFrag)
  const downProg  = createGlProgram(gl, postVert, bloomDownFrag)
  const upProg    = createGlProgram(gl, postVert, bloomUpFrag)
  const compProg  = createGlProgram(gl, postVert, compositeFrag)
  const programs  = [ surfProg, wallProg, waterProg, skyProg, downProg, upProg, compProg ]
  if (programs.some(p => !p)) {
    programs.forEach(p => p?.dispose())
    return null
  }


  const materials = createMaterialArrays(gl)
  const skyIds    = [ ...new Set([ ...BAYS, CHORD_BAY ].map(b => b.sky).filter(Boolean) as string[]) ]
  const skies     = new Map<string, SkyTexture>(skyIds.map(id => [ id, createSkyTexture(gl, id) ]))

  const circuits: Circuits = getCircuits()

  const bays        = buildBays(gl, circuits)
  const walls       = buildWalls(gl, circuits, bays)
  const flood       = buildFlood(gl, circuits, bays)
  const annex       = flood.annex
  const waterMesh   = flood.mesh
  const waterBase   = flood.base
  const cab         = buildCab(gl)
  const cabInstance = cab.instance
  const cabDraws    = cab.draws

  // --- post targets ------------------------------------------------------------
  // MSAA on the scene, because geometry edges are the only aliased thing in the
  // frame; resolved by blit so the result can be sampled, then a bloom chain.
  // The quality tier decides the sample count and the chain's depth.
  const quad     = createFullscreenQuad(gl)
  const chain    = createPostChain(gl, { hdr: true, msaa: 4, bloomLevels: 5 })
  const drawQuad = () => quad.draw()
  const encoded  = () => chain.format.hdr ? 0 : 1

  // --- per-frame scratch -----------------------------------------------------------
  const proj: Mat4                         = new Float32Array(16)
  const view: Mat4                         = new Float32Array(16)
  const viewProj: Mat4                     = new Float32Array(16)
  const invVP: Mat4                        = new Float32Array(16)
  const scatPos                            = new Float32Array(MAX_SCATTER * 4)
  const scatCol                            = new Float32Array(MAX_SCATTER * 4)
  const camMed                             = new Float32Array(8)
  const eye: [ number, number, number ]    = [ 0, 0, 0 ]
  const target: [ number, number, number ] = [ 0, 0, 1 ]
  const upv: [ number, number, number ]    = [ 0, 1, 0 ]

  const { setBay, setSurface } = createBayUniforms()
  const shared                 = { viewProj, camMed, scatPos, scatCol, encode: 0 }
  const bind                   = (prog: GlProgram, frame: FrameType) => {
    shared.encode = encoded()
    setFrame(prog, frame, shared)
  }
  const postProgs = { down: downProg!, up: upProg!, comp: compProg! }

  return {
    ready () {
      return materials.ready && [ ...skies.values() ].every(s => s.ready)
    },

    progress () {
      const done = [ ...skies.values() ].filter(s => s.ready).length + (materials.ready ? 1 : 0)
      return done / (skies.size + 1)
    },

    draw ({ time, pointer, custom, heavy, quality }: FrameUniforms) {
      const w = canvas.width
      const h = canvas.height
      const q = quality ?? HIGH_QUALITY
      chain.resize(w, h, { msaa: q.msaa, bloomLevels: Math.max(2, q.bloomLevels) })

      const camPos   = (custom?.uCamPos as number[]) ?? [ 0, 2, 0 ]
      const camFwd   = (custom?.uCamFwd as number[]) ?? [ 0, 0, 1 ]
      const camUp    = (custom?.uCamUp as number[]) ?? [ 0, 1, 0 ]
      const trainFwd = (custom?.uTrainFwd as number[]) ?? camFwd
      const trainUp  = (custom?.uTrainUp as number[]) ?? camUp
      const ride     = (custom?.uRide as number[]) ?? [ 0, 0, 0, 0 ]
      const decay    = (custom?.uDecay as number[]) ?? [ 0, 0, 0, 0 ]
      const loop     = (custom?.uLoop as number[]) ?? [ 0, 0, 0, 0 ]
      const hv       = heavy ?? 1

      const onAlt = ride[3] > 0.5
      const curve = onAlt ? circuits.alt : circuits.main
      const spans = onAlt ? circuits.altBays : circuits.mainBays
      const L     = curve.length
      const s     = loop[0]

      // Look: the pointer yaws about world up and pitches about the camera's
      // right, applied here so where the rider looks never moves the train.
      const yaw = -(pointer?.x ?? 0) * 0.6
      const cy  = Math.cos(yaw),
        sy      = Math.sin(yaw)
      let fx = camFwd[0] * cy + camFwd[2] * sy
      let fy = camFwd[1] + (pointer?.y ?? 0) * 0.42
      let fz = -camFwd[0] * sy + camFwd[2] * cy
      const fl = Math.hypot(fx, fy, fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl

      const look = [ fx, fy, fz ]

      eye[0]    = camPos[0]
      eye[1]    = camPos[1]
      eye[2]    = camPos[2]
      target[0] = camPos[0] + fx
      target[1] = camPos[1] + fy
      target[2] = camPos[2] + fz
      upv[0]    = camUp[0]
      upv[1]    = camUp[1]
      upv[2]    = camUp[2]
      perspective(proj, FOV, w / Math.max(1, h), 0.1, 900)
      lookAt(view, eye, target, upv)
      multiply(viewProj, proj, view)
      invert(invVP, viewProj)

      // --- the camera's medium, its sky, its exposure ---
      mediumAt(spans, s, L, decay, camMed)

      const flood = waterBase + 0.25 + ride[1] * 0.45
      const under = camPos[1] < flood &&
        spans[spanIndexAt(spans, s, L)].bay.theme === Theme.ANNEX
      if (under) {
        camMed[0] = 0.005
        camMed[1] = 0.03
        camMed[2] = 0.026
        camMed[3] = 0.22
      }

      const { skyHere, skyB, skyMix } = skyCrossfade(spans, s, L)

      const skyA    = skies.get(skyHere)!
      const skyTexB = skies.get(skyB)!
      const assetA  = skyAsset(skyHere)
      const sun     = assetA.sun && skyHere === 'DAY'
        ? [ ...sunDirection(assetA, SKY_YAW), 2.6 * (1 - decay[2] * 0.5) ]
        : [ 0, 1, 0, 0 ]

      const exposure = exposureAt(spans, s, L)

      const sc = gatherScatter(bays, eye, time, decay, scatPos, scatCol)

      const headPos = [
        eye[0] + trainFwd[0] * 1.4 - trainUp[0] * 1.3,
        eye[1] + trainFwd[1] * 1.4 - trainUp[1] * 1.3,
        eye[2] + trainFwd[2] * 1.4 - trainUp[2] * 1.3,
      ]
      const frame = {
        camPos,
        time,
        heavy:     hv,
        decay,
        ride,
        headPos,
        headDir:   trainFwd,
        skyMix,
        expA:      assetA.exposure,
        expB:      skyAsset(skyB).exposure,
        sun,
        scatCount: sc,
        scatter:   camMed[3] * 0.16,
      }

      // --- geometry ---
      chain.bindScene()
      gl.clearColor(camMed[0], camMed[1], camMed[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      materials.bind(gl, 0)
      skyA.bind(gl, 3)
      skyTexB.bind(gl, 4)

      // The sky first, behind everything, without touching depth.
      gl.disable(gl.DEPTH_TEST)
      gl.depthMask(false)
      gl.disable(gl.CULL_FACE)
      bind(skyProg!, frame)
      skyProg!.uniformMatrix4fv('uInvViewProj', invVP)
      skyProg!.uniform1f('uSkyFog', 140)
      drawQuad()
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)

      bind(surfProg!, frame)

      const visible = new Set<BayRender>()
      for (const br of bays) {
        const dx   = br.cx - eye[0],
          dy       = br.cy - eye[1],
          dz       = br.cz - eye[2]
        const dist = Math.hypot(dx, dy, dz)
        if (dist - br.radius > CULL_DIST)
          continue
        if (dist > br.radius && (dx * fx + dy * fy + dz * fz) / dist < -0.5)
          continue
        visible.add(br)
        for (const d of br.draws) {
          setBay(surfProg!, br, camPos, look, decay, time, d.shell)
          setSurface(surfProg!, d)
          d.mesh.drawInstanced(gl, d.count)
        }
      }

      // Headwalls: one quad each, the portals cut per pixel and antialiased
      // through alpha-to-coverage.
      bind(wallProg!, frame)
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE)
      for (const wr of walls) {
        if (!visible.has(wr.bay))
          continue
        setBay(wallProg!, wr.bay, camPos, look, decay, time, false)
        setSurface(wallProg!, { mesh: wr.mesh, surface: SURF[wr.wall.surface], count: 1, mapping: 0, shell: false })
        wallProg!.uniform1f('uPom', 0)
        gl.uniform2fv(wallProg!.loc('uHoleA'), wr.holeA)
        gl.uniform2fv(wallProg!.loc('uHoleB'), wr.holeB)
        gl.uniform2i(wallProg!.loc('uHoleN'), wr.nA, wr.nB)
        wr.mesh.drawInstanced(gl, 1)
      }
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)

      // The flood.
      if (visible.has(annex)) {
        bind(waterProg!, frame)
        // The water's vertices carry their own arc length in uv.x, like a
        // shell's: fogged by where each part of the flood is, not by s = 0.
        setBay(waterProg!, annex, camPos, look, decay, time, true)
        setSurface(waterProg!, { mesh: waterMesh, surface: SURF.black, count: 1, mapping: 0, shell: false })
        waterProg!.uniform1f('uLift', flood - waterBase)
        waterProg!.uniform4f('uWater', 0.82, 0.6, 0, 0)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.depthMask(false)
        gl.disable(gl.CULL_FACE)
        waterMesh.drawInstanced(gl, 1)
        gl.depthMask(true)
        gl.enable(gl.CULL_FACE)
        gl.disable(gl.BLEND)
      }

      // The cab, last and on top, lit by whatever the car is passing.
      {
        cabInstance.set([
          eye[0], eye[1], eye[2], 1,
          trainFwd[0], trainFwd[1], trainFwd[2], 1,
          trainUp[0], trainUp[1], trainUp[2], 1,
          s, 0, 0.99, 0,
        ])

        const here = bays.find(b => b.spans === spans && b.index === spanIndexAt(spans, s, L)) ??
          bays.find(b => b.bay.id === spans[spanIndexAt(spans, s, L)].bay.id) ?? bays[0]
        gl.clear(gl.DEPTH_BUFFER_BIT)
        surfProg!.use()
        for (const d of cabDraws) {
          d.mesh.setInstances(gl, cabInstance)
          setBay(surfProg!, here, camPos, look, decay, time, false)
          surfProg!.uniform4f('uRupture', 0, 0, -1, 0)
          setSurface(surfProg!, d)
          d.mesh.drawInstanced(gl, 1)
        }
      }

      // --- resolve ---
      chain.resolve()

      runBloom(gl, chain, postProgs, encoded(), drawQuad)
      composite(gl, chain, postProgs, drawQuad, { w, h, time, heavy: hv, exposure, decay, ride, encode: encoded() })
    },

    dispose () {
      chain.dispose()
      quad.dispose()
      for (const br of bays)
        for (const d of br.draws)
          d.mesh.dispose(gl)
      for (const wr of walls)
        wr.mesh.dispose(gl)
      waterMesh.dispose(gl)
      cabDraws.forEach(d => d.mesh.dispose(gl))
      materials.dispose(gl)
      skies.forEach(sky => sky.dispose(gl))
      programs.forEach(p => p!.dispose())
    },
  }
}
