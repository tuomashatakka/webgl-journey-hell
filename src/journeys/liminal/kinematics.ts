import type { CustomUniforms } from '@wjh/gl/uniforms'
import type { JourneyMarks, JourneySimulation } from '@wjh/journey/types'
import { mix, smoothstep } from '@wjh/math/scalar'


/** One traversal. The literals below predate this constant; it is not a rename. */
export const LIMINAL_LOOP_Z = 500

/** Where the fourth traversal stops being a traversal. */
export const LIMINAL_ABYSS_Z = 2000

/** Six sectors plus the abyss. Drives the transport bar's tick marks. */
export const LIMINAL_SECTOR_COUNT = 7

export interface KinematicState {
  loop:      number;
  sector:    number; // 1 to 6, or 666
  descent:   number; // 0..1 progress through sector 666 (0 for non-666)
  setpieceA: number;
  setpieceB: number;
  blend:     number; // 0..1 cross-fade weight between A and B
  localZ:    number;
  secLen:    number;
  fallAmt:   number; // 0..1 continuous fall pitch amount
  name:      string;
}

// ---- Sector 666 keyframe tables (identical literals to GLSL fsScene) ----

// Number of setpiece slots present for a given loop.
function pieceCount (loop: number): number {
  if (loop === 1)
    return 3
  if (loop === 2)
    return 5
  return 8 // loop >= 3
}

// Setpiece id occupying slot k (0-based) for a given loop.
function pieceAt (loop: number, k: number): number {
  const count = pieceCount(loop)
  const idx   = Math.max(0, Math.min(count - 1, Math.floor(k)))
  if (loop === 1) {
    const list = [ 1, 2, 8 ]
    return list[idx]
  }
  if (loop === 2) {
    const list = [ 1, 2, 3, 4, 8 ]
    return list[idx]
  }

  const list = [ 1, 2, 3, 4, 5, 6, 7, 9 ] // loop >= 3
  return list[idx]
}

// Floor depth target per setpiece id.
function pieceDepth (id: number): number {
  if (id === 1)
    return -15
  if (id === 2)
    return -28
  if (id === 3)
    return -45
  if (id === 4)
    return -55
  if (id === 5)
    return -62
  if (id === 6)
    return -110
  if (id === 7)
    return -180
  if (id === 8)
    return -30
  if (id === 9)
    return -350
  return -30
}

// Eye height (camera offset above floor) per setpiece id.
function pieceEye (id: number): number {
  if (id === 1)
    return 0.45
  if (id === 2)
    return 1.8
  if (id === 3)
    return 1.6
  if (id === 4)
    return 0.42
  if (id === 5)
    return 1.35
  if (id === 6)
    return 1.75
  if (id === 7)
    return 1.8
  if (id === 8)
    return 1.6
  if (id === 9)
    return 1.2
  return 1.8
}

// Continuous fall pitch amount per setpiece id.
function pieceFall (id: number): number {
  if (id === 1)
    return 0.85
  if (id === 6)
    return 0.6
  if (id === 7)
    return 0.9
  if (id === 9)
    return 1
  return 0
}

// Gentle per-piece horizontal sway.
function pieceSway (id: number, z: number): number {
  if (id === 1)
    return Math.sin(z * 0.15) * 1.8
  if (id === 5)
    return Math.sin(z * 0.6) * 0.6
  if (id === 6)
    return Math.sin(z * 0.08) * 2.2
  if (id === 7)
    return Math.sin(z * 0.4) * 0.8
  if (id === 9)
    return Math.sin(z * 0.05) * 1.2
  return Math.sin(z * 0.1) * 0.6
}

// Per-piece walk speed.
function pieceSpeed (id: number): number {
  if (id === 1)
    return 8.5
  if (id === 2)
    return 5.5
  if (id === 3)
    return 8.2
  if (id === 4)
    return 4.5
  if (id === 5)
    return 4
  if (id === 6)
    return 5
  if (id === 7)
    return 3.5
  if (id === 8)
    return 4
  if (id === 9)
    return 6
  return 8.2
}

const PIECE_W = 0.28 // cross-fade width

function pieceName (id: number): string {
  if (id === 1)
    return 'THE BARBED DESCENT'
  if (id === 2)
    return 'THE ASHEN TUNDRA'
  if (id === 3)
    return 'THE THROBBING WOMB'
  if (id === 4)
    return 'THE CRUSHING CITADEL'
  if (id === 5)
    return 'THE MEAT GRINDER'
  if (id === 6)
    return 'THE SPIRAL BRIDGE'
  if (id === 7)
    return 'SIGNAL ENTROPY'
  if (id === 8)
    return 'THE RECOVERY'
  if (id === 9)
    return 'THE VOID'
  return 'THE VOID'
}

// Fixed-length loop timeline definition (500.0 units per loop)
export function getKinematicState (z: number): KinematicState {
  // If we reach the endless fall of the last Loop 3, we stay in it forever
  if (z >= 2000) {
    const localZ = z - 2000
    const name   = localZ > 200
      ? 'SECTOR 666: THE ABYSS (STOPPED)'
      : 'SECTOR 666: THE ABYSS — THE VOID'
    return {
      loop:      3,
      sector:    666,
      descent:   1,
      setpieceA: 9,
      setpieceB: 9,
      blend:     0,
      localZ,
      secLen:    1000000,
      fallAmt:   1 - smoothstep(0, 200, localZ) * 0.85,
      name
    }
  }

  const loop = Math.floor(z / 500)
  const lz   = z % 500

  if (lz < 60)
    return {
      loop,
      sector:    1,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    lz,
      secLen:    60,
      fallAmt:   0,
      name:      'SECTOR 1: POOLROOMS'
    }
  if (lz < 130)
    return {
      loop,
      sector:    2,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    lz - 60,
      secLen:    70,
      fallAmt:   0,
      name:      'SECTOR 2: THE DESCENT'
    }
  if (lz < 210)
    return {
      loop,
      sector:    3,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    lz - 130,
      secLen:    80,
      fallAmt:   0,
      name:      'SECTOR 3: CRYSTAL CAVE'
    }
  if (lz < 280)
    return {
      loop,
      sector:    4,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    lz - 210,
      secLen:    70,
      fallAmt:   0,
      name:      'SECTOR 4: IRON HYDRAULICS'
    }
  if (lz < 360)
    return {
      loop,
      sector:    5,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    lz - 280,
      secLen:    80,
      fallAmt:   0,
      name:      'SECTOR 5: VOID LABYRINTH'
    }

  // Sector 6 / 666 transition zone (lz from 360.0 to 500.0, length 140)
  const local666 = lz - 360
  if (loop === 0)
    return {
      loop:      0,
      sector:    6,
      descent:   0,
      setpieceA: 0,
      setpieceB: 0,
      blend:     0,
      localZ:    local666,
      secLen:    140,
      fallAmt:   0,
      name:      'SECTOR 6: TRANSITION'
    }

  // Sector 666: continuous setpiece cross-fade model
  const localZ = local666 // 0..140
  const secLen = 140

  const descent = localZ / 140

  const N         = pieceCount(loop)
  const slotF     = descent * N
  const slot      = Math.floor(slotF)
  const frac      = slotF - slot
  const setpieceA = pieceAt(loop, slot)
  const setpieceB = pieceAt(loop, Math.min(slot + 1, N - 1))
  const blend     = smoothstep(1 - PIECE_W, 1, frac)
  const fallAmt   = mix(pieceFall(setpieceA), pieceFall(setpieceB), blend)

  const dominant = blend < 0.5 ? setpieceA : setpieceB
  const name     = 'SECTOR 666: THE ABYSS — ' + pieceName(dominant)

  return {
    loop,
    sector: 666,
    descent,
    setpieceA,
    setpieceB,
    blend,
    localZ,
    secLen,
    fallAmt,
    name
  }
}

// Horizontal swaying and alignment offsets
export function getCamX (z: number): number {
  const state = getKinematicState(z)

  if (state.sector === 1)
    return 0
  if (state.sector === 2) {
    const s = smoothstep(5, 15, state.localZ) * (1 - smoothstep(55, 65, state.localZ))
    return s * Math.sin(z * 0.15) * 4
  }
  if (state.sector === 3) {
    const s = smoothstep(0, 5, state.localZ) * (1 - smoothstep(75, 80, state.localZ))
    return s * Math.sin(z * 0.4) * 1.5
  }
  if (state.sector === 4) {
    const s = smoothstep(0, 10, state.localZ) * (1 - smoothstep(60, 70, state.localZ))
    return s * Math.sin(z * 0.08) * 1.8
  }
  if (state.sector === 5) {
    // Elegant winding stair sway
    const t5 = state.localZ / state.secLen
    return Math.sin(t5 * Math.PI * 3) * 3.5
  }
  if (state.sector === 6)
    return 0
  if (state.sector === 666)
    return mix(pieceSway(state.setpieceA, z), pieceSway(state.setpieceB, z), state.blend)
  return 0
}

// Camera vertical layout height offset
export function getCamOffset (z: number): number {
  const state = getKinematicState(z)

  if (state.sector === 2) {
    if (state.localZ < 10)
      return mix(1.8, 0.95, smoothstep(0, 10, state.localZ)); else if (state.localZ < 60)
      return 0.95; else
      return mix(0.95, 1, smoothstep(60, 70, state.localZ))
  }
  if (state.sector === 3)
    return mix(1, 1.8, smoothstep(70, 80, state.localZ))
  if (state.sector === 666)
    return mix(pieceEye(state.setpieceA), pieceEye(state.setpieceB), state.blend)
  return 1.8
}

// Evaluates the physical floor Y elevation
export function getFloorY (z: number): number {
  const state = getKinematicState(z)

  if (state.sector === 1)
    return 0
  if (state.sector === 2) {
    const t = state.localZ / state.secLen
    return mix(0, -25, t * t * (3 - 2 * t))
  }
  if (state.sector === 3) {
    const t = state.localZ / state.secLen
    return mix(-25, -125, t * t * (3 - 2 * t))
  }
  if (state.sector === 4) {
    const t         = state.localZ / state.secLen
    const bridgeArc = Math.sin(t * Math.PI) * 7.5
    return -125 + bridgeArc
  }
  if (state.sector === 5) {
    if (state.localZ < 52) {
      const stepSize    = 3.25
      const s           = state.localZ / stepSize
      const smoothStair = Math.floor(s) + smoothstep(0.6, 1, s - Math.floor(s))
      return -125 + smoothStair * 3.44
    }
    else if (state.localZ < 72) {
      const tFall = (state.localZ - 52) / 20
      return mix(-70, -180, tFall * tFall)
    }
    else
      return -180
  }
  if (state.sector === 6) {
    const t = Math.max(0, Math.min(1, state.localZ / state.secLen))
    return mix(-180, 0, smoothstep(0, 1, t))
  }
  if (state.sector === 666) {
    let depth = mix(pieceDepth(state.setpieceA), pieceDepth(state.setpieceB), state.blend)
    // Entry blend from sector 5 exit floor (-180) into the abyss.
    depth = mix(-180, depth, smoothstep(0, 0.08, state.descent))
    // Loop closure: return floor to 0 for the next loop's sector 1, except the loop 3 finale.
    if (state.loop < 3)
      depth = mix(depth, 0, smoothstep(0.8, 1, state.descent))
    return depth
  }
  return 0
}

export function getCamY (z: number): number {
  return getFloorY(z)
}

// Determines the player's walking speed dynamically
export function getWalkSpeed (z: number): number {
  const state = getKinematicState(z)

  // Finale endless fall: decay speed but never reach zero.
  if (z >= 2000) {
    const zFinale = z - 2000
    return Math.max(0.15, mix(8, 0.15, smoothstep(0, 250, zFinale)))
  }

  // Sector 5 Gravity Lab climbing: Super atmospheric crawling ascent, then collapse fall, then wading
  if (state.sector === 5) {
    if (state.localZ < 52)
      return 1.6; else if (state.localZ < 72)
      return 18; else
      return 3.5
  }

  if (state.sector === 666)
    return mix(pieceSpeed(state.setpieceA), pieceSpeed(state.setpieceB), state.blend)

  return 8.2 // standard speed
}


/**
 * The route as a replayable object.
 *
 * This journey predates withJourneyShell and integrates its walk inline in the
 * render loop (see page.tsx). The transport controls need to *replay* that walk
 * to an arbitrary time, which an inline `currentZ += speed * dt` cannot do — so
 * the integration lives here instead, and the loop drives this.
 */
export interface LiminalRide {
  readonly z: number;
  step(dt: number): void;
  marks(): JourneyMarks;
}

export function createLiminalRide (): LiminalRide {
  let z = 0

  // Inside the ride, so a ?t= seek rebuilds it. See lib/signalLoss.
  let signalAge = 0

  return {
    get z () {
      return z
    },

    step (dt: number) {
      z += getWalkSpeed(z) * dt
      if (z >= LIMINAL_ABYSS_Z)
        signalAge += dt
    },

    marks (): JourneyMarks {
      const state = getKinematicState(z)
      return {
        loop:         state.loop,
        section:      state.sector,
        sectionCount: LIMINAL_SECTOR_COUNT,
        progress:     z >= LIMINAL_ABYSS_Z ? 1 : z % LIMINAL_LOOP_Z / LIMINAL_LOOP_Z,
        terminal:     z >= LIMINAL_ABYSS_Z + 200,
        signalAge,
      }
    },
  }
}

/**
 * The loop counter the shaders decay by, eased across each 500-unit boundary
 * (±20 units) so the corridor's state slides rather than steps.
 */
export function smoothIteration (z: number): number {
  const loop = getKinematicState(z).loop
  const d    = z % LIMINAL_LOOP_Z
  if (d >= 480) {
    const t = (d - 480) / 40
    return loop + 3 * t * t - 2 * t * t * t
  }
  if (d < 20) {
    const t = (d + 20) / 40
    return loop - 1 + 3 * t * t - 2 * t * t * t
  }
  return loop
}

/** The ride as the shell drives every journey: uniforms, label, marks. */
export function createLiminalSimulation (): JourneySimulation {
  const ride                = createLiminalRide()
  const out: CustomUniforms = {}
  return {
    step: dt => ride.step(dt),
    uniforms () {
      out.uPlayerZ   = ride.z
      out.uIteration = smoothIteration(ride.z)
      return out
    },
    label: () => getKinematicState(ride.z).name,
    marks: () => ride.marks(),
  }
}
