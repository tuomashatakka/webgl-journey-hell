import { zeros } from '@wjh/math/arrays'
import { mulberry32 } from '@wjh/math/rng'
import { FoundryState } from './physics/types'
import { EYE_HEIGHT, LIFT_TOP, MODE_FALL, MODE_OBLIVION, MODE_SETTLE, MODE_WALK, WALK_START } from './physics/constants'
import { LAP_ARC, SPAN_TILES } from './physics/route'
import { liftTopFor, spawnDebris, stepCage } from './physics/cage'
import { stepMechanisms, stepRide, stepSpan, stepWalker } from './physics/walker'


const DT           = 1 / 120

// fixed integration step
const MAX_SUBSTEPS = 6

// m/s of lateral drift injected by weight transfer
const TREMOR_K   = 130

// floor-tremor spring (impacts travel up it)
const TREMOR_C   = 5.5

// Seconds for the gate to rattle up, for the shutter to come down, and for the
// shutter to clear again once the cable has gone.
const GATE_TIME    = 1.4

const SHUTTER_TIME = 1.2

const REOPEN_TIME  = 0.7

/** Back in the cage at the end of the lap; the shutter is coming down. */
export const MODE_BOARD = 4

export function createFoundryState (seed = 0x5eed): FoundryState {
  const rand = mulberry32(seed)
  return {
    // The journey opens mid-drop: the cable is already gone.
    mode:         MODE_FALL,
    modeTime:     0,
    gate:         0,
    shutter:      0,
    dist:         WALK_START,
    z:            WALK_START,
    lateral:      0,
    head:         0,
    lapEnd:       WALK_START + LAP_ARC,
    loop:         0,
    smoothLoop:   0,
    v:            0,
    stride:       0,
    foot:         1,
    bob:          0,
    bobV:         0,
    sway:         0,
    swayV:        0,
    tremor:       0,
    tremorV:      0,
    eyeY:         LIFT_TOP + EYE_HEIGHT,
    yaw:          0,
    pitch:        -0.3,
    roll:         0,
    shakeX:       0,
    shakeY:       0,
    y:            LIFT_TOP,
    fallen:       0,
    cageV:        -2,
    cageA:        0,
    cableIntact:  false,
    spark:        0,
    brakeEngaged: 0,
    settleTime:   0,
    creeping:     false,
    debris:       spawnDebris(rand, LIFT_TOP),
    crank:        0,
    crankOmega:   5.4,
    hook:         0.18,
    hookOmega:    0,
    chain:        0.12,
    chainOmega:   0,
    fold:         zeros(SPAN_TILES),
    foldOmega:    zeros(SPAN_TILES),
  }
}

/** Take the lap counter up and let go of the cable again, behind the shutter. */
function beginNextDrop (s: FoundryState): void {
  s.mode         = MODE_FALL
  s.modeTime     = 0
  s.gate         = 0
  s.y            = liftTopFor(s.loop + 1)
  s.cageV        = -2
  s.cageA        = 0
  s.cableIntact  = false
  s.brakeEngaged = 0
  s.settleTime   = 0
  s.creeping     = false
  s.v            = 0
  s.loop        += 1

  // Snap to the exact boarding point before opening the next lap, so the metre
  // or so of overshoot walking into the cage does not accumulate lap on lap.
  //
  // `z` is *not* cyclic(dist) any more and has not been since the span learned
  // to turn: a lap is LAP_ARC of walking but only CYCLE_LEN of ground, so
  // wrapping the distance would land every lap SPAN_EXTRA further down the
  // loading bay than the last one. The boarding point is a fixed place in the
  // world, so it is written as one.
  s.dist    = s.lapEnd
  s.z       = WALK_START
  s.lateral = 0
  s.head    = 0
  s.lapEnd  = s.dist + LAP_ARC

  const rand = mulberry32((Math.floor(s.dist * 977) ^ 0x9e3779b9) >>> 0)
  s.debris   = spawnDebris(rand, s.y)
}

/**
 * The lap's phase machine. Every transition here is a state the *simulation*
 * arrives at — the cage stops because the shoes stopped it, the walk starts
 * because the gate finished opening — so the sequence is identical at any frame
 * rate or speed setting.
 *
 * The one thing that is not physical is the swap at the end of a lap, and it is
 * deliberately hidden: the shutter comes down over both open faces of the cage
 * first, so the cage is a sealed box at the moment it becomes a cage at the top
 * of the shaft again. Nothing on screen ever jumps.
 */
function stepPhase (s: FoundryState, dt: number): void {
  s.modeTime += dt

  if (s.mode === MODE_FALL || s.mode === MODE_OBLIVION)
    // The shutter rattles back up once the cable has gone, which is how you
    // find out you are already falling. In oblivion it is long since up, and
    // there is no transition out of that phase to write: it is the last one.
    s.shutter = Math.max(0, s.shutter - dt / REOPEN_TIME)
  else if (s.mode === MODE_SETTLE) {
    s.gate = Math.min(1, s.gate + dt / GATE_TIME)
    if (s.gate >= 1) {
      s.mode     = MODE_WALK
      s.modeTime = 0
    }
  }
  else if (s.mode === MODE_WALK && s.dist >= s.lapEnd) {
    s.mode     = MODE_BOARD
    s.modeTime = 0
  }
  else if (s.mode === MODE_BOARD) {
    s.shutter = Math.min(1, s.shutter + dt / SHUTTER_TIME)
    s.gate    = Math.max(0, 1 - s.shutter)
    // The world gets worse behind the shutter, so the ramp is never on screen.
    s.smoothLoop = s.loop + s.shutter
    if (s.shutter >= 1)
      beginNextDrop(s)
  }

  if (s.mode !== MODE_BOARD)
    s.smoothLoop = s.loop
}

function step (s: FoundryState, dt: number): void {
  stepPhase(s, dt)

  const impactSum = stepCage(s, dt)
  stepMechanisms(s, dt)
  stepSpan(s, dt)

  // Every impact travels up through whatever you are standing on — the cage's
  // floor while riding, the hall's plate while walking.
  s.tremorV += (-TREMOR_K * s.tremor - TREMOR_C * s.tremorV) * dt
  s.tremor += s.tremorV * dt
  if (impactSum > 0.05 || Math.abs(s.cageA) > 25)
    s.tremorV -= impactSum * 0.02 + Math.max(0, Math.abs(s.cageA) - 25) * 0.004

  if (s.mode === MODE_WALK || s.mode === MODE_BOARD)
    stepWalker(s, dt)
  else
    stepRide(s, impactSum)
}

/**
 * Advance the simulation by `elapsed` seconds using fixed sub-steps, so the
 * result is frame-rate independent and identical at 30, 60 or 144 Hz.
 * Returns the leftover accumulator, which the caller carries forward.
 */
export function advance (s: FoundryState, elapsed: number, carry: number): number {
  let acc   = carry + Math.min(elapsed, 0.25)
  let steps = 0
  while (acc >= DT && steps < MAX_SUBSTEPS) {
    step(s, DT)
    acc -= DT
    steps++
  }
  if (steps === MAX_SUBSTEPS)
    acc = 0 // drop the backlog rather than spiral
  return acc
}

/** Exact slider-crank displacement — the real mechanism, not a sine wave. */
export function pistonExtension (crank: number, radius = 0.62, rod = 1.9): number {
  const s = radius * Math.sin(crank)
  return radius * Math.cos(crank) + Math.sqrt(Math.max(0, rod * rod - s * s))
}
