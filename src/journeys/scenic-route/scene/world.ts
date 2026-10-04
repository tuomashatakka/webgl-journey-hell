import type { Route } from '../course'
import { createMesh, createMeshFromArrays } from '@wjh/gl/mesh'
import type { Mesh } from '@wjh/gl/mesh'
import { SWEEP_FLOATS, SWEEP_LAYOUT, finishSweep, levelFrame, sweepProfile } from '@wjh/geometry/sweep'
import { newFrame } from '@wjh/geometry/curve'
import type { ProfilePoint } from '@wjh/geometry/sweep'
import { SECTION_COUNT, lookAt as lookParamsAt, sectionWeights } from '../course'
import type { LookParams } from '../course'
import { SEA_PATCH, buildFarMesh, buildNearChunks, buildSeaPatch, buildSeaQuad, buildSpineIndex } from '../geometry'
import { buildMaw, buildTube } from '../maw'
import type { Jaw } from '../maw'
import { buildProps } from '../props'
import type { PropSet } from '../props'
import { buildCity } from '../city'

import { PORTAL_LIFT } from './shared'
import type { Drawable } from './shared'

/** Everything the world is made of, built once: road, land, sea, maw, tube, props, city, rail. */
export function buildWorld (gl: WebGL2RenderingContext, route: Route) {
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
    step:      2,
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
    step:    2,
    profile: (s: number): ProfilePoint[] => {
      lookParamsAt(route, s, w, look)

      const e = -(look.roadHalf + 0.6)
      return [[ e, 0.78 ], [ e - 0.06, 0.6 ], [ e, 0.42 ]]
    },
  }))
  const railMesh: Mesh = createMeshFromArrays(
    gl, railArrays.vertices, railArrays.indices, SWEEP_LAYOUT, SWEEP_FLOATS, 0,
  )

  return { profile, roadMesh, chunks, far, farMesh, seaMesh, patchMesh, maw, mouthDir, headMesh, jaws, tube, tubeFront, tubeBack, waterMesh, props, city, towerMesh, railMesh }
}
