import { MAX_SCATTER } from '../shader/header'
import { spanIndexAt } from '../stations'
import type { BaySpan } from '../stations'
import { smoothstep } from '@wjh/math/scalar'

import { flicker, skyFor } from './bays'
import type { BayRender } from './bays'

/**
 * Open-to-open boundaries crossfade their skies across sixty metres, from either
 * side of the line; everything else takes the rule's sky.
 */
type SkyCrossfadeReturnType = { skyHere: string; skyB: string; skyMix: number }

export function skyCrossfade (spans: BaySpan[], s: number, L: number): SkyCrossfadeReturnType {
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

  return { skyHere, skyB, skyMix }
}

/** The exposure at arc length `s`: each bay's, blended across its boundaries. */
export function exposureAt (spans: BaySpan[], s: number, L: number): number {
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
  return exposure
}

/**
 * The scattering lamps: the nearest, from every bay, written into the two
 * arrays. Returns how many slots are in use.
 */
export function gatherScatter (bays: BayRender[], eye: number[], time: number, decay: number[], scatPos: Float32Array, scatCol: Float32Array): number {
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
  return sc
}
