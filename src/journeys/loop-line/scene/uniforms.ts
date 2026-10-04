import type { GlProgram } from '@wjh/gl/program'
import type { Mat4 } from '@wjh/math/mat4'
import { Rupture } from '../stations'
import { MAX_LAMPS } from '../shader/header'


import { BLEND, flicker, bayMedium } from './bays'
import type { BayRender, Draw } from './bays'


/** The sky map's yaw on this line: puts the noon sun ahead-left of THE CUT. */
export const SKY_YAW = 0.18

export type FrameType = {
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

/** Per-frame state shared by every program's frame uniforms. */
export interface FrameShared {
  viewProj: Mat4;
  camMed:   Float32Array;
  scatPos:  Float32Array;
  scatCol:  Float32Array;
  encode:   number;
}

/** The uniforms every program takes once a frame. */
export function setFrame (prog: GlProgram, frame: FrameType, shared: FrameShared): void {
  prog.use()
  prog.uniformMatrix4fv('uViewProj', shared.viewProj)
  prog.uniform3f('uCamPos', frame.camPos[0], frame.camPos[1], frame.camPos[2])
  prog.uniform4f('uCamFog', shared.camMed[0], shared.camMed[1], shared.camMed[2], shared.camMed[3])
  prog.uniform4f('uDecay', frame.decay[0], frame.decay[1], frame.decay[2], frame.decay[3])
  prog.uniform4f('uRide', frame.ride[0], frame.ride[1], frame.ride[2], frame.ride[3])
  prog.uniform1f('uTime', frame.time)
  prog.uniform1f('uHeavy', frame.heavy)
  prog.uniform3f('uHeadPos', frame.headPos[0], frame.headPos[1], frame.headPos[2])
  prog.uniform3f('uHeadDir', frame.headDir[0], frame.headDir[1], frame.headDir[2])
  prog.uniform1f('uHeadOn', 1)
  prog.uniform4f('uSky', frame.skyMix, frame.expA, frame.expB, SKY_YAW)
  prog.uniform4f('uSun', frame.sun[0], frame.sun[1], frame.sun[2], frame.sun[3])
  prog.uniform4fv('uScatPos', shared.scatPos)
  prog.uniform4fv('uScatCol', shared.scatCol)
  prog.uniform1i('uScatCount', frame.scatCount)
  prog.uniform1f('uScatter', frame.scatter)
  prog.uniform1i('uMatColor', 0)
  prog.uniform1i('uMatNormal', 1)
  prog.uniform1i('uMatDetail', 2)
  prog.uniform1i('uSkyA', 3)
  prog.uniform1i('uSkyB', 4)
  prog.uniform1f('uLift', 0)
  prog.uniform1f('uEncode', shared.encode)
}

/** Writers for the per-bay and per-draw uniforms, with their scratch. */
export function createBayUniforms () {
  const lampPos = new Float32Array(MAX_LAMPS * 4)
  const lampCol = new Float32Array(MAX_LAMPS * 4)
  const pick    = new Int32Array(64)
  const pickD   = new Float32Array(64)
  const medA    = new Float32Array(8)
  const medB    = new Float32Array(8)
  const medC    = new Float32Array(8)

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

  return { setBay, setSurface }
}
