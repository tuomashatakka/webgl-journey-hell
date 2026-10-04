import { zeros } from '@wjh/math/arrays'
import type { JourneyMarks, JourneySimulation } from '@wjh/journey/types'
import type { CustomUniforms } from '@wjh/gl/uniforms'
import { clamp01, mix } from '@wjh/math/scalar'
import { getSwitchbackState, labelFor } from './kinematics/state'
import { assertRouteSane } from './kinematics/check'
import { FALL_BLOCK, FALL_LAPS, FALL_START, LAP_LEN, SECTIONS, SECTION_COUNT, liftAt } from './kinematics/route'
import { DRAG, G, ROLL_RES, TYPE_FALL, V_MAX, V_MIN } from './kinematics/constants'

/** Eye height above the rail head, sitting in the cart. */
const EYE = 1.15

/**
 * One simulation instance per mount. Stepped on the shared frame-capped loop,
 * read immediately after, so the frame renders the state this step produced.
 */
export function createSwitchbackSimulation (): JourneySimulation {
  let s    = 0
  let v    = 9
  let roll = 0

  // Counted inside the simulation, not by the shell: seekSimulation replays
  // step() from zero without anyone watching. See lib/signalLoss.
  let signalAge = 0
  let state     = getSwitchbackState(0, v, 0)

  if (process.env.NODE_ENV !== 'production') {
    const problems = assertRouteSane()
    for (const p of problems)
      console.warn('[switchback route]', p)
  }

  const uSecA = zeros(12) // z0, z1, type, bore
  const uSecB = zeros(12) // ceilH, floorD, lamp, grime
  const uSecC = zeros(12) // sky, id, lit, lampY
  const uBend = [ 0, 0, 0, 0 ]
  const uCart = [ 0, 0, 0, 0 ]
  const uRide = [ 0, 0, 0, 0 ]
  const uAtm  = [ 0, 0, 0, 0 ]
  const uSun  = [ 0, 0, 0, 0 ]
  const uUp   = [ 0, 0, 0, 0 ]
  const uFall = [ 0, 0, 0, 0 ] // fall, over-speed, twist, crack

  return {
    step (dt: number) {
      const h = Math.min(dt, 0.05)

      if (s >= FALL_START) {
        // Nothing is holding it any more. No drag term and no ceiling: the shaft
        // has no bottom in it and the speed has no limit, which is the whole of
        // what this section is for. Everything downstream is a pure function of
        // s, so a seek still reproduces it exactly.
        v += G * Math.sin(-state.grade) * h
        s += v * h
        signalAge += h
        roll  = state.headRoll
        state = getSwitchbackState(s, v, roll)
        return
      }

      const chain = liftAt(s)
      if (chain > 0) {
        // A chain (or a brake fin) does not accelerate you, it *takes* you: the
        // dog is either engaged or it is not. An exponential approach with a
        // half-second constant is what that sounds and looks like from inside.
        //
        // But it takes you less every lap. This — not the drag and not the
        // grades — is what actually held the ride down: the brake at the
        // platform pinned the cart back to walking pace once a lap however fast
        // it arrived, so no amount of tipping the descents over made the ride
        // faster than one section's worth of runway. By the last lap the dog is
        // not catching and the fins are not gripping, and the cart carries what
        // it has straight through the station.
        const grip   = Math.max(0, 1 - state.lapF * 0.3)
        const target = chain * (1 + state.lapF * 0.5)
        v += (target - v) * (1 - Math.exp(-h / 0.55)) * grip
      }
      else {
        const g = state.grade
        // Drag falls off per lap: the ride is not getting faster because anything
        // pushes it, but because less and less is slowing it down.
        //
        // It has to fall off *hard*, or the pitch-over is cosmetic. Quadratic
        // drag sets a terminal velocity of sqrt(g sin θ / k), and at the old
        // rate that number barely moved — the fourth lap descended at seventy-
        // eight degrees and still ran at a hundred and fifty, which looks like a
        // steep track being ridden slowly rather than like a railway coming
        // apart. At this rate it stops binding altogether by the last lap, and
        // what limits the speed there is the honest one — how much height a lap
        // has in it. The fourth is descending at seventy-eight degrees for four
        // hundred and ninety metres of arc, and arrives at about eighty-five
        // percent of what falling that far would give you.
        const drag = DRAG / (1 + state.lapF * 2.4)
        v += (-G * Math.sin(g) - drag * v * v - ROLL_RES * G * Math.cos(g)) * h
      }

      // The ceiling lifts every lap, and lifts out of the way: a railway this
      // far over is no longer one a 26 m/s cap describes, and past the second
      // lap the cap should not be the thing deciding the speed — the height of
      // the drop should be. It stays only as a guard against a bad table.
      v = Math.max(V_MIN, Math.min(V_MAX * (1 + state.lapF * 1.1), v))
      s += v * h
      roll  = state.headRoll
      state = getSwitchbackState(s, v, roll)
    },

    uniforms (): CustomUniforms {
      for (let i = 0; i < 3; i++) {
        const slot = state.slots[i]
        const o    = i * 4

        uSecA[o]     = slot.z0
        uSecA[o + 1] = slot.z1
        uSecA[o + 2] = slot.type
        uSecA[o + 3] = slot.bore

        uSecB[o]     = slot.ceilH
        uSecB[o + 1] = slot.floorD
        uSecB[o + 2] = slot.lamp
        uSecB[o + 3] = mix(slot.grime, 1, state.decay * 0.6)

        uSecC[o]     = slot.sky
        uSecC[o + 1] = slot.id
        // Folded here rather than in GLSL so the failure curve exists once. A
        // room's lamps go out as the laps pile up and as its own grime rises,
        // and a neighbour seen through a portal has to be lit by *its* answer,
        // not by the one the cart happens to be standing in.
        uSecC[o + 2] = Math.max(0, 1 - state.lightFail * (0.6 + slot.grime * 0.8))
        uSecC[o + 3] = slot.lampY
      }

      uBend[0] = state.bend.ax
      uBend[1] = state.bend.bx
      uBend[2] = state.bend.ay
      uBend[3] = state.bend.by

      uCart[0] = state.phase
      uCart[1] = state.speed
      uCart[2] = state.lapF
      uCart[3] = EYE

      uRide[0] = state.lookYaw
      uRide[1] = state.lookPitch + state.joltY
      uRide[2] = state.headRoll + state.joltX
      uRide[3] = state.chain

      uFall[0] = state.fall
      // Speed *past* what the ride was ever capable of. uCart.y already pins the
      // shader's lens widening at 20 m/s, so this is the term that keeps saying
      // something after the fall has left every previous number behind.
      //
      // Logarithmic, because the fall is unbounded and a linear map saturates
      // fifteen seconds in — after which the picture stops acknowledging speed
      // at exactly the point the speed becomes the only thing happening.
      uFall[1] = clamp01(Math.log2(1 + Math.max(0, state.speed - V_MAX) / 20) / 8)
      uFall[2] = state.twist
      uFall[3] = state.crack

      uAtm[0] = state.lightFail
      uAtm[1] = state.decay
      uAtm[2] = state.grade
      uAtm[3] = state.bank

      uSun[0] = state.sun[0]
      uSun[1] = state.sun[1]
      uSun[2] = state.sun[2]
      uSun[3] = 1

      uUp[0] = state.up[0]
      uUp[1] = state.up[1]
      uUp[2] = state.up[2]
      uUp[3] = state.slots[1].sky

      return { uSecA, uSecB, uSecC, uBend, uCart, uRide, uAtm, uSun, uUp, uFall }
    },

    label () {
      return labelFor(state)
    },

    /**
     * `s`, not `lapF`: lapF deliberately ramps across THE OVERLOOK rather than
     * stepping at the seam, which makes it the wrong thing to draw a bar from.
     */
    marks (): JourneyMarks {
      if (state.inFall) {
        // Each block of shaft counts as another lap, so the transport can still
        // fast-forward through a section that has no structure left in it.
        const block = Math.floor(state.fallDepth / FALL_BLOCK)
        return {
          loop:         FALL_LAPS + block,
          section:      TYPE_FALL,
          sectionCount: 1,
          progress:     (state.fallDepth - block * FALL_BLOCK) / FALL_BLOCK,
          signalAge,
        }
      }

      return {
        loop:         state.lap,
        section:      SECTIONS.indexOf(state.section),
        sectionCount: SECTION_COUNT,
        progress:     state.s % LAP_LEN / LAP_LEN,
      }
    },
  }
}
