import { createMesh } from '@wjh/gl/mesh'
import type { MeshBuilder } from '@wjh/geometry/meshBuilder'
import type { Mesh } from '@wjh/gl/mesh'
import type { ClosedCurve } from '@wjh/geometry/curve'
import { CHORD_BAY, Rupture, Theme, spanIndexAt } from '../stations'
import type { Bay, BaySpan, Circuits } from '../stations'
import { SURF } from '../geometry/surfaces'
import { UNITS, buildUnit } from '../geometry/units'
import { fractureAll, sweepProfile } from '../geometry/sweep'
import { profilesFor, rockLayer } from '../geometry/profiles'
import type { Surface, SurfaceKey } from '../geometry/surfaces'
import { INSTANCE_FLOATS, chordTrack, dressBay } from '../dressing'
import type { Dressing, Lamp } from '../dressing'
import { smoothstep } from '@wjh/math/scalar'


/** Medium blend half-width at a bay boundary, metres. */
export const BLEND = 15

/** Seeds, so the build is the same on every load. */
const SEED = 0x10091

const medA = new Float32Array(8)
const medB = new Float32Array(8)
const medC = new Float32Array(8)

export interface Draw {
  mesh:    Mesh;
  surface: Surface;
  count:   number;

  /** 0: the mesh's own uv (shells, headwalls); 1: box-mapped (props). */
  mapping: number;
  shell:   boolean;
}

export interface BayRender {
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

export const IDENTITY = (s: number, bay: number): Float32Array => new Float32Array([
  0, 0, 0, 1,
  0, 0, 1, 1,
  0, 1, 0, 1,
  s, bay, 0, 0,
])

/** A bay's air and light, after whatever this lap has done to them. */
export function bayMedium (bay: Bay, decay: ArrayLike<number>, out: Float32Array): Float32Array {
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

export function flicker (t: number, roll: number, lightFail: number): number {
  const margin = roll - lightFail
  if (margin < 0)
    return 0
  if (margin >= 0.05)
    return 1

  const x = Math.sin(Math.floor(t * 14) * 12.9898 + roll * 78.233) * 43758.5453
  return x - Math.floor(x) >= 0.25 ? 1 : 0
}

/** The medium at arc length `s` on a span list — the vertex shader's blend, on the CPU. */
export function mediumAt (spans: BaySpan[], s: number, L: number, decay: number[], out: Float32Array): Float32Array {
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
export function skyFor (spans: BaySpan[], s: number, L: number): string {
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

/** Every bay of the circuit, built once: the shells, their dressing, the chord. */
export function buildBays (gl: WebGL2RenderingContext, circuits: Circuits): BayRender[] {
  // units: one fractured builder per prop type, shared
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
    bays.push(buildBay(circuits.main, circuits.mainBays, i, [ span.s0, span.s1 + 1 ], dressing))
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

  return bays
}
