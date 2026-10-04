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

import type { JourneyRenderer } from '✦/lib/journey'
import { HIGH_QUALITY, createFullscreenQuad, createGlProgram, createPostChain } from '✦/lib/gl'
import type { GlProgram } from '✦/lib/gl'
import { createMesh, createMeshBuilder } from '✦/lib/mesh'
import type { Mesh, MeshBuilder } from '✦/lib/mesh'
import { invert, lookAt, multiply, perspective } from '✦/lib/mat4'
import type { Mat4 } from '✦/lib/mat4'
import type { ClosedCurve } from '✦/lib/curve'
import type { FrameUniforms } from '✦/lib/gl'
import { createMaterialArrays, createSkyTexture } from 'Δ/gl'
import type { SkyTexture } from 'Δ/gl'
import { skyAsset, sunDirection } from 'Δ'
import { BAYS, CHORD_BAY, REJOIN_BAY, Rupture, Theme, getCircuits, spanIndexAt } from './stations'
import type { Bay, BaySpan, Circuits } from './stations'
import { SURF, UNITS, buildUnit, fractureAll, profilesFor, rockLayer, sweepProfile } from './geometry'
import type { Surface, SurfaceKey } from './geometry'
import { INSTANCE_FLOATS, buildHeadwalls, chordTrack, dressBay } from './dressing'
import type { Dressing, Headwall, Lamp } from './dressing'
import {
  MAX_HOLE,
  MAX_LAMPS,
  MAX_SCATTER,
  bloomDownFrag,
  bloomUpFrag,
  compositeFrag,
  loopLineFrag,
  loopLineVert,
  postVert,
  skyFrag,
  skyVert

} from './shader'
import { smoothstep } from '✦/lib/math'


/** A bay is skipped once its bounding sphere is this far into the fog. */
const CULL_DIST = 420

/** Medium blend half-width at a bay boundary, metres. */
const BLEND = 15

const FOV = 70 * Math.PI / 180

/** The sky map's yaw on this line: puts the noon sun ahead-left of THE CUT. */
const SKY_YAW = 0.18

/** Seeds, so the build is the same on every load. */
const SEED = 0x10091

interface Draw {
  mesh:    Mesh;
  surface: Surface;
  count:   number;

  /** 0: the mesh's own uv (shells, headwalls); 1: box-mapped (props). */
  mapping: number;
  shell:   boolean;
}

interface BayRender {
  bay:    Bay;
  span:   BaySpan;
  spans:  BaySpan[];
  index:  number;
  draws:  Draw[];
  lamps:  Lamp[];
  cx:     number;
  cy:     number;
  cz:     number;
  radius: number;
}

const IDENTITY = (s: number, bay: number): Float32Array => new Float32Array([
  0, 0, 0, 1,
  0, 0, 1, 1,
  0, 1, 0, 1,
  s, bay, 0, 0,
])

/** A bay's air and light, after whatever this lap has done to them. */
function bayMedium (bay: Bay, decay: ArrayLike<number>, out: Float32Array): Float32Array {
  const rot = decay[2]
  let [ r, g, b ] = bay.fog
  let dens        = bay.fogDensity * (1 + rot * 0.6)
  const [ ar, ag, ab ] = bay.ambient
  let open = bay.open
  if (bay.rupture === Rupture.ERASE) {
    // The sky comes down: the cut's air thickens and whitens, a lap at a time,
    // until the outside is a wall of light.
    const e = Math.min(1, decay[0] * 1.6 + rot * 0.4)
    dens *= 1 + e * 6
    r += (1.1 - r) * e
    g += (1.1 - g) * e
    b += (1.1 - b) * e
    open *= 1 - e * 0.3
  }

  // The rot takes the light down with the colour.
  const dim = 1 - rot * 0.35
  out[0]    = r
  out[1]    = g
  out[2]    = b
  out[3]    = dens
  out[4]    = ar * dim
  out[5]    = ag * dim
  out[6]    = ab * dim
  out[7]    = open
  return out
}

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

  const geoProgs = [ surfProg!, wallProg!, waterProg! ]

  const materials = createMaterialArrays(gl)
  const skyIds    = [ ...new Set([ ...BAYS, CHORD_BAY ].map(b => b.sky).filter(Boolean) as string[]) ]
  const skies     = new Map<string, SkyTexture>(skyIds.map(id => [ id, createSkyTexture(gl, id) ]))

  const circuits: Circuits = getCircuits()

  // --- units: one fractured builder per prop type, shared ------------------
  const unitBuilders = new Map<string, MeshBuilder>()
  let k = 0
  for (const [ name, spec ] of Object.entries(UNITS))
    unitBuilders.set(name, buildUnit(spec, SEED + 31 * k++))

  // --- bays ------------------------------------------------------------------
  const bays: BayRender[] = []

  const buildBay = (curve: ClosedCurve, spans: BaySpan[], index: number,
    shellSpan: [ number, number ], dressing: Dressing | null): BayRender => {
    const span          = spans[index]
    const bay           = span.bay
    const draws: Draw[] = []
    let minX = Infinity,
      minY   = Infinity,
      minZ   = Infinity
    let maxX = -Infinity,
      maxY   = -Infinity,
      maxZ   = -Infinity
    const grow = (x: number, y: number, z: number) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }

    if (shellSpan[1] > shellSpan[0]) {
      const builders = new Map<SurfaceKey, MeshBuilder>()
      const step     = bay.theme === Theme.DEPOT || bay.theme === Theme.CUT ? 3 : 2
      for (const profile of profilesFor(bay.theme))
        sweepProfile(builders, curve, shellSpan[0], shellSpan[1], step, profile)
      fractureAll(builders, bay.theme === Theme.TRESTLE ? 3 : 4.5, SEED + bay.id * 977)

      // The earth behind the walls, swept after the fracture so it stays whole.
      const rock = rockLayer(bay.theme)
      if (rock)
        sweepProfile(builders, curve, shellSpan[0], shellSpan[1], step * 2, rock)
      for (const [ key, b ] of builders) {
        const v = b.vertices()
        for (let i = 0; i < v.length; i += 12 * 7)
          grow(v[i], v[i + 1], v[i + 2])

        const mesh = createMesh(gl, b, 4)
        mesh.setInstances(gl, IDENTITY(0, bay.id))
        draws.push({ mesh, surface: SURF[key], count: 1, mapping: 0, shell: true })
      }
    }

    if (dressing)
      for (const [ name, data ] of dressing.instances) {
        const builder = unitBuilders.get(name)
        if (!builder || data.length === 0)
          continue
        for (let i = 0; i < data.length; i += INSTANCE_FLOATS)
          grow(data[i], data[i + 1], data[i + 2])

        const mesh = createMesh(gl, builder, 4)
        mesh.setInstances(gl, new Float32Array(data))
        draws.push({
          mesh,
          surface: SURF[UNITS[name].surface],
          count:   data.length / INSTANCE_FLOATS,
          mapping: 1,
          shell:   false,
        })
      }

    const cx = (minX + maxX) / 2,
      cy     = (minY + maxY) / 2,
      cz     = (minZ + maxZ) / 2
    return {
      bay,
      span,
      spans,
      index,
      draws,
      lamps:  dressing?.lamps ?? [],
      cx,
      cy,
      cz,
      radius: Math.hypot(maxX - cx, maxY - cy, maxZ - cz) + 4,
    }
  }

  circuits.mainBays.forEach((span, i) => {
    const dressing = dressBay(circuits, span, false, SEED + i * 131)
    // Shells overlap their successor by a metre so no seam opens on a curve.
    bays.push(buildBay(circuits.main, circuits.mainBays, i, [ span.s0, span.s1 + 1.0 ], dressing))
  })

  // The chord: its bore between the two portal planes, plus its own track from
  // the points to the rejoin, all along ALT and fogged by ALT's spans.
  const chordIndex = circuits.altBays.findIndex(s => s.bay.id === CHORD_BAY.id)
  const chordSpan  = circuits.altBays[chordIndex]
  const chordDress = dressBay(circuits, chordSpan, true, SEED + 9001)
  const track      = chordTrack(circuits, SEED + 9101)
  for (const [ name, data ] of track.instances)
    chordDress.instances.set(name, [ ...chordDress.instances.get(name) ?? [], ...data ])
  bays.push(buildBay(circuits.alt, circuits.altBays, chordIndex,
                     [ chordSpan.s0 - 2.2, chordSpan.s1 + 1.5 ], chordDress))

  // --- headwalls -----------------------------------------------------------
  interface WallRender {
    wall:  Headwall;
    mesh:  Mesh;
    bay:   BayRender;
    holeA: Float32Array;
    holeB: Float32Array;
    nA:    number;
    nB:    number;
  }

  const walls: WallRender[] = buildHeadwalls(circuits).map(wall => {
    const b                  = createMeshBuilder()
    const f                  = wall.frame
    const [ r0, u0, r1, u1 ] = wall.rect
    const P                  = (r: number, u: number) => [
      f.pos.x + f.right.x * r + f.up.x * u,
      f.pos.y + f.right.y * r + f.up.y * u,
      f.pos.z + f.right.z * r + f.up.z * u,
    ]
    const n   = [ -f.forward.x, -f.forward.y, -f.forward.z ]
    const ids = [[ r0, u0 ], [ r1, u0 ], [ r1, u1 ], [ r0, u1 ]].map(([ r, u ]) => {
      const p = P(r, u)
      return b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], r, u)
    })
    // Facing back along the track, toward the bay it closes.
    const a  = P(r0, u0),
      c      = P(r1, u0),
      d      = P(r0, u1)
    const cr = [
      (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]),
      (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]),
      (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]),
    ]
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) {
      b.face(ids[0], ids[1], ids[2])
      b.face(ids[0], ids[2], ids[3])
    }
    else {
      b.face(ids[0], ids[2], ids[1])
      b.face(ids[0], ids[3], ids[2])
    }

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, IDENTITY(wall.s, wall.bay))

    const pack = (poly: [ number, number ][] | undefined) => {
      const out = new Float32Array(MAX_HOLE * 2);
      (poly ?? []).slice(0, MAX_HOLE).forEach(([ x, y ], i) => {
        out[i * 2]     = x
        out[i * 2 + 1] = y
      })
      return out
    }
    return {
      wall,
      mesh,
      bay:   bays[wall.bay],
      holeA: pack(wall.holes[0]),
      holeB: pack(wall.holes[1]),
      nA:    Math.min(MAX_HOLE, wall.holes[0]?.length ?? 0),
      nB:    Math.min(MAX_HOLE, wall.holes[1]?.length ?? 0),
    }
  })

  // --- the flood -------------------------------------------------------------
  // Level water, not track-following: the annex is the bottom of a dip, so a
  // level surface lies only where the floor is below it, and deepens by lap.
  const annex      = bays[REJOIN_BAY]
  let annexLow     = Infinity
  for (let s = annex.span.s0; s < annex.span.s1; s += 4)
    annexLow = Math.min(annexLow, circuits.main.pointAtDistance(s).y)

  const waterBase = annexLow - 0.38
  const waterMesh = (() => {
    const b               = createMeshBuilder()
    const f               = { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }}
    const rings: number[] = []
    for (let s = annex.span.s0; s <= annex.span.s1 + 0.01; s += 3) {
      circuits.main.frameAtDistance(s, f)
      for (const r of [ -10, 22 ])
        rings.push(b.vertex(f.pos.x + f.right.x * r, waterBase, f.pos.z + f.right.z * r, 0, 1, 0, s, r))
    }
    for (let i = 0; i + 3 < rings.length; i += 2) {
      // Facing up: wind by the geometric normal.
      const v  = b.vertices()
      const at = (q: number) => [ v[q * 12], v[q * 12 + 1], v[q * 12 + 2] ]
      const A  = at(rings[i]),
        B      = at(rings[i + 1]),
        C      = at(rings[i + 2])
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2])
      if (ny > 0) {
        b.face(rings[i], rings[i + 1], rings[i + 3])
        b.face(rings[i], rings[i + 3], rings[i + 2])
      }
      else {
        b.face(rings[i], rings[i + 3], rings[i + 1])
        b.face(rings[i], rings[i + 2], rings[i + 3])
      }
    }

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, IDENTITY(0, annex.bay.id))
    return mesh
  })()

  // --- the cab ---------------------------------------------------------------
  // The front of a people-mover, seen from the front seat: nothing but the lip
  // of the dashboard along the bottom of the view. Pillars and a console were
  // tried and read as a slab and a lamp; a thin black edge is enough to put you
  // in a vehicle. Local x is left, y up, z forward, origin at the eye; one
  // instance, moved with the car every frame.
  const cabParts: { key: SurfaceKey; build: (b: MeshBuilder) => void }[] = [
    { key:   'black',
      build: b => {
        b.box(0, -0.79, 0.92, 2.2, 0.06, 0.30)
        b.box(0, -0.725, 1.21, 2.2, 0.012, 0.02)
      } },
  ]
  const cabInstance      = new Float32Array(INSTANCE_FLOATS)
  const cabDraws: Draw[] = cabParts.map(part => {
    const b = createMeshBuilder()
    part.build(b)

    const mesh = createMesh(gl, b, 4)
    mesh.setInstances(gl, cabInstance)
    return { mesh, surface: SURF[part.key], count: 1, mapping: 1, shell: false }
  })

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
  const lampPos                            = new Float32Array(MAX_LAMPS * 4)
  const lampCol                            = new Float32Array(MAX_LAMPS * 4)
  const scatPos                            = new Float32Array(MAX_SCATTER * 4)
  const scatCol                            = new Float32Array(MAX_SCATTER * 4)
  const pick                               = new Int32Array(64)
  const pickD                              = new Float32Array(64)
  const medA                               = new Float32Array(8)
  const medB                               = new Float32Array(8)
  const medC                               = new Float32Array(8)
  const camMed                             = new Float32Array(8)
  const eye: [ number, number, number ]    = [ 0, 0, 0 ]
  const target: [ number, number, number ] = [ 0, 0, 1 ]
  const upv: [ number, number, number ]    = [ 0, 1, 0 ]

  const flicker = (t: number, roll: number, lightFail: number): number => {
    const margin = roll - lightFail
    if (margin < 0)
      return 0
    if (margin >= 0.05)
      return 1

    const x = Math.sin(Math.floor(t * 14) * 12.9898 + roll * 78.233) * 43758.5453
    return x - Math.floor(x) >= 0.25 ? 1 : 0
  }

  /** The medium at arc length `s` on a span list — the vertex shader's blend, on the CPU. */
  const mediumAt = (spans: BaySpan[], s: number, L: number, decay: number[], out: Float32Array) => {
    const i  = spanIndexAt(spans, s, L)
    const n  = spans.length
    const sp = spans[i]
    bayMedium(spans[(i - 1 + n) % n].bay, decay, medA)
    bayMedium(sp.bay, decay, medB)
    bayMedium(spans[(i + 1) % n].bay, decay, medC)

    const t0 = smoothstep(sp.s0 - BLEND, sp.s0 + BLEND, s)
    const t1 = smoothstep(sp.s1 - BLEND, sp.s1 + BLEND, s)
    for (let j = 0; j < 8; j++)
      out[j] = (medA[j] + (medB[j] - medA[j]) * t0) * (1 - t1) + medC[j] * t1
    return out
  }

  /** Which open bay's sky the camera should be under, by the rule in the header. */
  const skyFor = (spans: BaySpan[], s: number, L: number): string => {
    const n    = spans.length
    const i    = spanIndexAt(spans, s, L)
    const here = spans[i]
    if (here.bay.sky && here.bay.open > 0)
      return here.bay.sky

    const prev = spans[(i - 1 + n) % n]
    if (s - here.s0 < 25 && prev.bay.sky && prev.bay.open > 0)
      return prev.bay.sky
    for (let k = 1; k < n; k++) {
      const next = spans[(i + k) % n]
      if (next.bay.sky && next.bay.open > 0)
        return next.bay.sky
    }
    return 'NIGHT'
  }

  type FrameType = {
    camPos:    number[];
    time:      number;
    heavy:     number;
    decay:     number[];
    ride:      number[]
    headPos:   number[];
    headDir:   number[];
    skyMix:    number;
    expA:      number;
    expB:      number
    sun:       number[];
    scatCount: number;
    scatter:   number
  }

  const setFrame = (prog: GlProgram, frame: FrameType) => {
    prog.use()
    prog.uniformMatrix4fv('uViewProj', viewProj)
    prog.uniform3f('uCamPos', frame.camPos[0], frame.camPos[1], frame.camPos[2])
    prog.uniform4f('uCamFog', camMed[0], camMed[1], camMed[2], camMed[3])
    prog.uniform4f('uDecay', frame.decay[0], frame.decay[1], frame.decay[2], frame.decay[3])
    prog.uniform4f('uRide', frame.ride[0], frame.ride[1], frame.ride[2], frame.ride[3])
    prog.uniform1f('uTime', frame.time)
    prog.uniform1f('uHeavy', frame.heavy)
    prog.uniform3f('uHeadPos', frame.headPos[0], frame.headPos[1], frame.headPos[2])
    prog.uniform3f('uHeadDir', frame.headDir[0], frame.headDir[1], frame.headDir[2])
    prog.uniform1f('uHeadOn', 1)
    prog.uniform4f('uSky', frame.skyMix, frame.expA, frame.expB, SKY_YAW)
    prog.uniform4f('uSun', frame.sun[0], frame.sun[1], frame.sun[2], frame.sun[3])
    prog.uniform4fv('uScatPos', scatPos)
    prog.uniform4fv('uScatCol', scatCol)
    prog.uniform1i('uScatCount', frame.scatCount)
    prog.uniform1f('uScatter', frame.scatter)
    prog.uniform1i('uMatColor', 0)
    prog.uniform1i('uMatNormal', 1)
    prog.uniform1i('uMatDetail', 2)
    prog.uniform1i('uSkyA', 3)
    prog.uniform1i('uSkyB', 4)
    prog.uniform1f('uLift', 0)
    prog.uniform1f('uEncode', encoded())
  }

  /** Per-bay uniforms: its medium and its neighbours', its lamps, its rupture. */
  const setBay = (prog: GlProgram, br: BayRender, camPos: number[], camFwd: number[],
    decay: number[], time: number, isShell: boolean) => {
    const n = br.spans.length
    bayMedium(br.spans[(br.index - 1 + n) % n].bay, decay, medA)
    bayMedium(br.bay, decay, medB)
    bayMedium(br.spans[(br.index + 1) % n].bay, decay, medC)
    prog.uniform4f('uBay', br.span.s0, br.span.s1, BLEND, isShell ? 1 : 0)
    prog.uniform4f('uFogA', medA[0], medA[1], medA[2], medA[3])
    prog.uniform4f('uFogB', medB[0], medB[1], medB[2], medB[3])
    prog.uniform4f('uFogC', medC[0], medC[1], medC[2], medC[3])
    prog.uniform4f('uAmbA', medA[4], medA[5], medA[6], medA[7])
    prog.uniform4f('uAmbB', medB[4], medB[5], medB[6], medB[7])
    prog.uniform4f('uAmbC', medC[4], medC[5], medC[6], medC[7])

    // Rupture: shard weight, the special amount for this bay's mode, the mode.
    const lapF = decay[3] / 0.16
    let special = 0
    switch (br.bay.rupture) {
      case Rupture.BLACKOUT: special = Math.min(1, decay[1] * 1.1); break
      case Rupture.ADVANCE: special = decay[0] * 3.2; break
      case Rupture.EMPTY: special = Math.min(1, decay[1] * 1.2); break
      case Rupture.VANISH: special = Math.min(0.85, Math.max(0, lapF - 1.5) * 0.06); break
      default: special = 0
    }
    prog.uniform4f('uRupture', decay[0] > 0 ? br.bay.shatter : 0, special, br.bay.rupture, 0)

    // The bay's lamps nearest the camera, with lamps ahead counted nearer than
    // lamps behind: the room you are looking into is the one that has to be lit.
    let m = 0
    for (let i = 0; i < br.lamps.length; i++) {
      const l  = br.lamps[i]
      const dx = l.x - camPos[0],
        dy     = l.y - camPos[1],
        dz     = l.z - camPos[2]
      let d2 = dx * dx + dy * dy + dz * dz
      if (dx * camFwd[0] + dy * camFwd[1] + dz * camFwd[2] < 0)
        d2 *= 3
      if (m < MAX_LAMPS) {
        pick[m]  = i
        pickD[m] = d2
        m++
      }
      else {
        let worst = 0
        for (let j = 1; j < MAX_LAMPS; j++)
          if (pickD[j] > pickD[worst])
            worst = j
        if (d2 < pickD[worst]) {
          pick[worst]  = i
          pickD[worst] = d2
        }
      }
    }
    for (let j = 0; j < m; j++) {
      const l            = br.lamps[pick[j]]
      lampPos[j * 4]     = l.x
      lampPos[j * 4 + 1] = l.y
      lampPos[j * 4 + 2] = l.z
      lampPos[j * 4 + 3] = l.range
      lampCol[j * 4]     = l.r
      lampCol[j * 4 + 1] = l.g
      lampCol[j * 4 + 2] = l.b
      lampCol[j * 4 + 3] = flicker(time, l.roll, decay[1])
    }
    prog.uniform1i('uLampCount', m)
    prog.uniform4fv('uLampPos', lampPos)
    prog.uniform4fv('uLampCol', lampCol)
  }

  const setSurface = (prog: GlProgram, d: Draw) => {
    const s = d.surface
    prog.uniform4f('uSurf', s.layer, s.mode, s.rough, s.metal)
    prog.uniform3f('uTint', s.tint[0], s.tint[1], s.tint[2])
    prog.uniform3f('uGlow', s.glow[0], s.glow[1], s.glow[2])
    prog.uniform1f('uPom', s.pom ? 1 : 0)
    prog.uniform1f('uMapping', d.mapping)
  }

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

      // Open-to-open boundaries crossfade their skies across sixty metres,
      // from either side of the line; everything else takes the rule's sky.
      let skyHere = skyFor(spans, s, L)
      let skyB    = skyHere
      let skyMix  = 0
      {
        const n    = spans.length
        const i    = spanIndexAt(spans, s, L)
        const here = spans[i]
        const prev = spans[(i - 1 + n) % n]
        const next = spans[(i + 1) % n]
        if (here.bay.open > 0 && prev.bay.open > 0 && prev.bay.sky !== here.bay.sky && s - here.s0 < 30) {
          skyHere = prev.bay.sky!
          skyB    = here.bay.sky!
          skyMix  = smoothstep(here.s0 - 30, here.s0 + 30, s)
        }
        else if (here.bay.open > 0 && next.bay.open > 0 && next.bay.sky !== here.bay.sky && here.s1 - s < 30) {
          skyB   = next.bay.sky!
          skyMix = smoothstep(here.s1 - 30, here.s1 + 30, s)
        }
      }

      const skyA    = skies.get(skyHere)!
      const skyTexB = skies.get(skyB)!
      const assetA  = skyAsset(skyHere)
      const sun     = assetA.sun && skyHere === 'DAY'
        ? [ ...sunDirection(assetA, SKY_YAW), 2.6 * (1 - decay[2] * 0.5) ]
        : [ 0, 1, 0, 0 ]

      let exposure = 0
      {
        const i  = spanIndexAt(spans, s, L)
        const n  = spans.length
        const sp = spans[i]
        const a  = spans[(i - 1 + n) % n].bay.exposure
        const c  = spans[(i + 1) % n].bay.exposure
        const t0 = smoothstep(sp.s0 - 25, sp.s0 + 25, s)
        const t1 = smoothstep(sp.s1 - 25, sp.s1 + 25, s)
        exposure = (a + (sp.bay.exposure - a) * t0) * (1 - t1) + c * t1
      }

      // --- scattering lamps: the nearest, from every bay ---
      let sc = 0
      const sd = new Float32Array(MAX_SCATTER).fill(Infinity)
      for (const br of bays)
        for (const l of br.lamps) {
          const d2 = (l.x - eye[0]) ** 2 + (l.y - eye[1]) ** 2 + (l.z - eye[2]) ** 2
          if (d2 > 90 * 90)
            continue

          let slot = -1
          if (sc < MAX_SCATTER)
            slot = sc++
          else {
            let worst = 0
            for (let j = 1; j < MAX_SCATTER; j++)
              if (sd[j] > sd[worst])
                worst = j
            if (d2 < sd[worst])
              slot = worst
          }
          if (slot < 0)
            continue
          sd[slot]              = d2
          scatPos[slot * 4]     = l.x
          scatPos[slot * 4 + 1] = l.y
          scatPos[slot * 4 + 2] = l.z
          scatPos[slot * 4 + 3] = l.range
          scatCol[slot * 4]     = l.r
          scatCol[slot * 4 + 1] = l.g
          scatCol[slot * 4 + 2] = l.b
          scatCol[slot * 4 + 3] = flicker(time, l.roll, decay[1])
        }

      // Fade the farthest in the set by rank, so a lamp entering or leaving it
      // does not pop its halo; and cap what any one lamp puts into the air, or
      // a floodlight turns the whole yard into soup.
      let far = 0
      for (let j = 0; j < sc; j++)
        far = Math.max(far, sd[j])
      for (let j = 0; j < sc; j++) {
        const peak = Math.max(scatCol[j * 4], scatCol[j * 4 + 1], scatCol[j * 4 + 2])
        const cap  = peak > 12 ? 12 / peak : 1
        scatCol[j * 4] *= cap
        scatCol[j * 4 + 1] *= cap
        scatCol[j * 4 + 2] *= cap
        scatCol[j * 4 + 3] *= 1 - smoothstep(far * 0.55, far, sd[j])
      }

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
      setFrame(skyProg!, frame)
      skyProg!.uniformMatrix4fv('uInvViewProj', invVP)
      skyProg!.uniform1f('uSkyFog', 140)
      drawQuad()
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)

      setFrame(surfProg!, frame)

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
      setFrame(wallProg!, frame)
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
        setFrame(waterProg!, frame)
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

      // --- bloom: down the chain, then back up it ---
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      downProg!.use()
      downProg!.uniform1i('uSrc', 0)
      downProg!.uniform1f('uDecode', encoded())

      const bloom = chain.bloom
      for (let i = 0; i < bloom.length; i++) {
        const src = i === 0 ? chain.scene : bloom[i - 1]
        bloom[i].bind()
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        downProg!.uniform2f('uTexel', 1 / src.width, 1 / src.height)
        downProg!.uniform1f('uThreshold', i === 0 ? 1.0 : -1)
        if (i === 1)
          downProg!.uniform1f('uDecode', 0)
        drawQuad()
      }
      upProg!.use()
      upProg!.uniform1i('uSrc', 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      for (let i = bloom.length - 1; i > 0; i--) {
        bloom[i - 1].bind()
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, bloom[i].tex)
        upProg!.uniform2f('uTexel', 1 / bloom[i].width, 1 / bloom[i].height)
        upProg!.uniform1f('uRadius', 1.0)
        drawQuad()
      }
      gl.disable(gl.BLEND)

      // --- composite ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      compProg!.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, chain.scene.tex)
      compProg!.uniform1i('uScene', 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex)
      compProg!.uniform1i('uBloom', 1)
      compProg!.uniform4f('uDecay', decay[0], decay[1], decay[2], decay[3])
      compProg!.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
      compProg!.uniform1f('uTime', time)
      compProg!.uniform1f('uExposure', exposure)
      compProg!.uniform1f('uDecode', encoded())
      compProg!.uniform1f('uHeavy', hv)
      compProg!.uniform2f('uAspect', w / Math.max(1, h), 1)
      drawQuad()
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
