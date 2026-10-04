import { CONFIG } from '@wjh/config/config'
import { zeros } from '@wjh/math/arrays'
import type { JourneyMarks, JourneySimulation } from '@wjh/journey/types'
import { lapLabel } from '@wjh/journey/label'
import type { CustomUniforms } from '@wjh/gl/uniforms'
import { clamp01, smootherstep, smoothstep } from '@wjh/math/scalar'
import { FLOOR0, LAP_LEN, SECTIONS, SECTION_COUNT, STARTS, Section, sectionAt } from './kinematics/route'
import { blendScalar, poseInFrame } from './kinematics/blend'

/** Eye height above the floor. You walk on the bottom, even once that is a bad idea. */
const EYE = 1.62

/**
 * How far ahead the heading is sampled. Doubles as the corner lead: the chord
 * to a point this far along the blended path already points into the turn
 * before the camera reaches it.
 */
const LOOKAHEAD = 1.8

/**
 * Water level on lap 0, in the same units as the accumulated floor fall (the
 * entry floor is 0). Ankle-deep at the door.
 */
const WATER_Y0 = 0.12

/** Each lap the building floods further. This is the whole escalation. */
const WATER_RISE = 1.15

/**
 * The window over which a lap's flood arrives, as indices into SECTIONS. It has
 * to sit entirely *after* the crossing in THE STAIR DOWN: within a lap the water
 * is flat at WATER_Y0 + lap * WATER_RISE right up to the start of this window,
 * which is what keeps invariant 3 true on every lap and not just on lap 0. By
 * THE DIVING WELL the floor has already dropped 1.55 and your head is under, so
 * a metre of rise arriving there changes nothing you can see — and by the time
 * THE RISER carries you back up, the new level is fully in.
 */
const RISE_FROM = 8

// THE DIVING WELL
const RISE_TO   = 10

// THE CISTERN

/**
 * How far a section's entry has been built, 0..1, from how far ahead of the
 * camera that entry still lies.
 *
 * Monotone, and exactly 0 and exactly 1 at its ends. Both exactnesses are load
 * bearing. At 1 every block offset is exactly 0, every block is exactly flush
 * with the shell, and the shader rejects the whole set with one compare on a
 * uniform — so the room you stand in is provably the room sectionAir() carved
 * and nothing else, and the reconfiguration is always something happening
 * further down the hall.
 *
 * A damped hinge was the obvious thing here, and it is what foundry swings its
 * span panels on, but it is wrong for this: it rings ABOVE 1 and then settles
 * back through it, so with a `>= 1` cull the dressing would deploy, vanish, and
 * come back. Quintic instead — the same curve the corner blend already rides.
 *
 * SIGHT is 12 rather than foundry's 20 because the fog here is far denser:
 * exp(-t*0.030) above the water, exp(-t*0.115) below it. At 20 metres submerged
 * you are at a tenth of contrast, and the whole performance would be happening
 * where nobody can see it.
 */
const SIGHT  = 12

const SETTLE = 3

/**
 * One neighbourhood slot: the affine map carrying a point from the *current*
 * section's frame into this slot's frame, as `q.xz = rot(cos,sin) * (p.xz - t.xz)`
 * with `q.y = p.y - ty`, plus the shape the shader needs to build it.
 */
interface Slot {
  cos:   number;
  sin:   number;
  tx:    number;
  ty:    number;
  tz:    number;
  halfW: number;
  ceilH: number;
  len:   number;
  slope: number;
  type:  number;
  grime: number;
  lamp:  number;

  /**
   * How far along the route the camera still has to walk before it reaches this
   * section's entry; negative once that entry is behind it. deployAt() turns it
   * into the blocks moving at that join.
   *
   * Measured along the ROUTE, not by projecting the camera onto this section's
   * own +Z. That projection is the obvious thing and it is wrong: the axis is
   * rotated by the join's turn, so past 90 degrees its cosine goes negative and
   * a camera approaching the doorway projects as though it were already through
   * it — the dressing at every sharp corner would report itself finished before
   * you arrived. Route distance has no such failure; it is also exact and needs
   * no trigonometry.
   */
  ahead: number;

  /** Section id, 1..12. Salts per-section hashing so rooms of a type differ. */
  id: number;
}

interface NatatoriumState {
  dist: number; // total distance walked, CPU-only
  lap:  number;

  /**
   * Laps completed, with the fractional part ramping across RISE_FROM..RISE_TO
   * rather than snapping at the seam. Anything that escalates per lap reads this
   * instead of `lap`, so it arrives while you are under and not in a doorway.
   */
  lapF:    number;
  localZ:  number;
  section: Section;

  /** Accumulated floor fall at the camera, negative going down. */
  floorY: number;

  /**
   * World height of the *current section frame's* origin floor — i.e. local
   * y = 0 for the space the shader marches in. Constant within a section, so
   * anything the shader needs in local coordinates converts through this and
   * not through the camera's own (corner-blended) floor height.
   */
  frameY: number;

  /** World water level for this lap. */
  waterY: number;

  /** Water depth at the camera's feet. */
  depth: number;

  /** 0 = head under water, 1 = fully above. */
  above: number;

  speed: number;
  camX:  number;
  camY:  number;
  camZ:  number;
  yaw:   number;
  pitch: number;
  roll:  number;

  slots: Slot[]; // always 3: prev, current, next
  name:  string;
}

/** Shortest signed representation of an angle difference, in (-pi, pi]. */
function wrapPi (a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

function deployAt (ahead: number): number {
  return smootherstep(SIGHT, SETTLE, ahead)
}

function makeSlot (
  cos: number, sin: number, tx: number, ty: number, tz: number, s: Section,
): Slot {
  return {
    cos,
    sin,
    tx,
    ty,
    tz,
    halfW: s.halfW,
    ceilH: s.ceilH,
    len:   s.len,
    slope: s.drop / s.len,
    type:  s.type,
    grime: s.grime,
    lamp:  s.lamp,
    ahead: 0, // filled in below, once localZ is known
    id:    s.id,
  }
}

/** The three resident section slots (previous, current, next) in the current section's frame. */
function slotsAround (idx: number, localZ: number): ReturnType<typeof makeSlot>[] {
  const cur  = SECTIONS[idx]
  const prev = sectionAt(idx - 1)
  const next = sectionAt(idx + 1)

  // --- slot transforms, all expressed in the current section's frame ---

  const slotCur = makeSlot(1, 0, 0, 0, 0, cur)

  // Next: q = rot(-turnNext) * (p - (0, -cur.drop, cur.len)).
  const an      = -next.turn
  const slotNxt = makeSlot(Math.cos(an), Math.sin(an), 0, -cur.drop, cur.len, next)

  // Previous: q = rot(turnCur) * p + (0, -prev.drop, prev.len), rewritten as
  // rot(turnCur) * (p - t) with t = -rot(-turnCur) * offset so the shader has
  // one code path. rot(-a) applied to (x=0, z=prev.len) is (sin a, cos a) * len.
  const ap      = cur.turn
  const cp      = Math.cos(ap)
  const sp      = Math.sin(ap)
  const slotPrv = makeSlot(cp, sp, -sp * prev.len, prev.drop, -cp * prev.len, prev)

  // Route distance to each resident section's entry. The previous section's is
  // a whole section behind, the current one's is behind by however far into it
  // we have walked, and the next one's is whatever is left of this one — which
  // makes `next` the only slot that is ever mid-deployment.
  slotPrv.ahead = -(prev.len + localZ)
  slotCur.ahead = -localZ
  slotNxt.ahead = cur.len - localZ

  return [ slotPrv, slotCur, slotNxt ]
}

/**
 * The whole route as a pure function of distance walked.
 *
 * The slot transforms are derived, not tabulated. Section i+1's frame sits at
 * the far end of section i, rotated by that section's turn:
 *
 *   p_i = rot(turn_{i+1}) * q_{i+1} + (0, -drop_i, len_i)
 *
 * so the forward map is `q = rot(-turn) * (p - offset)`, and the backward map is
 * its inverse rearranged into the same shape. Both reduce to `rot * (p - t)`,
 * which is why the shader needs exactly one transform routine.
 */
function getNatatoriumState (dist: number): NatatoriumState {
  const lap  = Math.floor(dist / LAP_LEN)
  const lapZ = dist - lap * LAP_LEN
  const lapF = lap + smootherstep(STARTS[RISE_FROM], STARTS[RISE_TO], lapZ)

  let idx = 0
  for (let i = SECTION_COUNT - 1; i >= 0; i--)
    if (lapZ >= STARTS[i]) {
      idx = i
      break
    }

  const cur    = SECTIONS[idx]
  const prev   = sectionAt(idx - 1)
  const next   = sectionAt(idx + 1)
  const localZ = lapZ - STARTS[idx]

  // --- slot transforms, all expressed in the current section's frame ---

  const slots = slotsAround(idx, localZ)

  // --- camera ---

  // The blended path, plus a sample ahead of it. Heading comes from the chord
  // between them rather than from a turn table, so the camera always looks
  // exactly where it is going and the lead into a corner is automatic.
  const here   = poseInFrame(idx, localZ, dist)
  const ahead  = poseInFrame(idx, localZ + LOOKAHEAD, dist)
  const ahead2 = poseInFrame(idx, localZ + LOOKAHEAD * 2, dist)

  const dx  = ahead[0] - here[0]
  const dy  = ahead[1] - here[1]
  const dz  = ahead[2] - here[2]
  const hyp = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz))

  const yaw = Math.atan2(dx, dz)

  // Bank into the turn. This has to come from the *rate* of heading change, not
  // from `yaw` itself: yaw is measured in the current section's frame, and that
  // frame rotates by the whole turn angle the instant `idx` advances, so a roll
  // proportional to yaw snapped by up to 12 degrees at every join. The chord
  // between two look-ahead samples is a difference of two headings in the same
  // frame, so the frame rotation cancels and the bank is continuous through the
  // seam — and it leads the turn instead of trailing it.
  const bank = wrapPi(Math.atan2(ahead2[0] - ahead[0], ahead2[2] - ahead[2]) - yaw)

  // The blended local floor, recovered from the pose so ramps and corners share
  // one source of truth.
  const floorLocal = here[1]
  const floorY     = FLOOR0[idx] + floorLocal
  // Continuous, not stepped per lap. Stepping put the whole 1.15u rise into the
  // single frame that crosses the seam: the surface teleported to chest height
  // in a doorway and the wading penalty snapped with it. The rise now arrives
  // across RISE_FROM..RISE_TO, deep in the flooded half of the lap where the
  // camera is already under, and reaches the next lap's level before the seam —
  // so the seam is smooth and the level at any point of a lap is unchanged.
  const waterY = WATER_Y0 + lapF * WATER_RISE
  const depth  = Math.max(0, waterY - floorY)
  const above  = smoothstep(waterY - 0.12, waterY + 0.12, floorY + EYE)

  // Wading is slow, and slower the deeper it gets. Base speed rides the corner
  // blend too, so the pace eases between rooms instead of stepping.
  const wade  = 1 - 0.55 * clamp01(depth / (EYE * 1.1))
  const speed = blendScalar(idx, localZ, s => s.speed) * Math.max(0.28, wade)

  // The walk cycle stops once you are swimming rather than wading.
  const stride = 1 - 0.75 * clamp01(depth / EYE)
  const bob    = Math.abs(Math.sin(dist * 1.7)) * 0.045 * stride


  return {
    dist,
    lap,
    lapF,
    localZ,
    section: cur,
    floorY,
    frameY:  FLOOR0[idx],
    waterY,
    depth,
    above,
    speed,
    camX:    here[0],
    camY:    floorLocal + EYE + bob,
    camZ:    here[2],
    yaw,
    // Follow the ramp partially — enough to feel the grade, not so much that
    // the horizon pumps on every gentle pool-deck fall.
    pitch:   Math.atan2(dy, hyp) * 0.65 +
             Math.sin(dist * 0.85) * 0.012 * stride -
             (1 - above) * 0.1,
    roll: Math.sin(dist * 0.31) * 0.012 +
           Math.max(-0.14, Math.min(0.14, bank * 0.55)),
    slots,
    name: cur.name,
  }
}

/** HUD label. Laps count from 1 the way the other journeys count them. */
function labelFor (state: NatatoriumState): string {
  const under = state.above < 0.5 ? ' ↓' : ''
  return lapLabel(state.lap, `${state.name}${under}`, { bareFirst: true })
}

/**
 * Dev-only guard for the four table invariants. These are exactly the mistakes
 * that produce *geometry* bugs rather than type errors — a sealed doorway or a
 * hole where an unresident section should be — so they are worth asserting
 * rather than discovering in a screenshot.
 */
function assertRouteSane (): string[] {
  const problems: string[] = []

  for (let i = 0; i < SECTION_COUNT; i++) {
    const s = SECTIONS[i]
    if (Math.abs(s.turn) < 1e-4)
      problems.push(`${s.name}: zero turn — two aligned doorways would show a hole`)
    if (s.halfW <= 0.6)
      problems.push(`${s.name}: halfW ${s.halfW} leaves no room for the camera sway`)

    const triple = s.len + sectionAt(i + 1).len + sectionAt(i + 2).len
    if (triple < 60)
      problems.push(`${s.name}: resident window spans only ${triple}u, fog reaches further`)
  }

  const dropSum = SECTIONS.reduce((a, s) => a + s.drop, 0)
  if (Math.abs(dropSum) > 1e-6)
    problems.push(`drops sum to ${dropSum.toFixed(3)}, not 0 — the lap seam will pop vertically`)

  // The crossing must happen exactly once, and in THE STAIR DOWN.
  let acc       = 0
  let crossedIn = ''
  for (const s of SECTIONS) {
    const before = acc
    acc -= s.drop
    if (before + EYE >= WATER_Y0 && acc + EYE < WATER_Y0)
      crossedIn = crossedIn ? `${crossedIn}+${s.name}` : s.name
  }
  if (crossedIn !== 'THE STAIR DOWN')
    problems.push(`water closes overhead in "${crossedIn}", expected THE STAIR DOWN`)

  // The flood window must open after that crossing, or the rise from the
  // previous lap moves the moment earlier and the beat above stops being true.
  const crossIdx = SECTIONS.findIndex(s => s.name === 'THE STAIR DOWN')
  if (RISE_FROM <= crossIdx)
    problems.push(`flood window opens in "${SECTIONS[RISE_FROM].name}", at or before the crossing`)

  return problems
}

/**
 * One simulation instance per mount. The HOC steps it on the shared frame-capped
 * loop and reads uniforms() immediately after, so the shader always renders the
 * state this frame's integration produced.
 */
export function createNatatoriumSimulation (): JourneySimulation {
  let dist  = 0
  let state = getNatatoriumState(0)

  // Inside the simulation, so a ?t= seek rebuilds it. See lib/signalLoss.
  let signalAge = 0

  if (process.env.NODE_ENV !== 'production') {
    const problems = assertRouteSane()
    for (const p of problems)
      console.warn('[natatorium route]', p)
  }

  // Packed in place every frame, never reallocated. Three slots x three vec4.
  // Separate arrays indexed by a bare loop variable rather than one array with
  // computed indices: both are legal GLSL ES 1.00, only one is well-trodden.
  const uSecA = zeros(12) // cos, sin, tx, tz
  const uSecB = zeros(12) // ty, halfW, ceilH, len
  const uSecC = zeros(12) // slope, type, grime, lampPitch
  const uSecD = zeros(12) // deploy, aisleY, sectionId, -
  const uCam  = [ 0, 0, 0, 0 ]
  const uLook = [ 0, 0, 0, 0 ]
  const uWave = [ 0, 0, 0, 0 ]

  return {
    step (dt: number) {
      dist += state.speed * Math.min(dt, 0.1)
      state = getNatatoriumState(dist)
      if (state.lap >= CONFIG.signal.lossLaps.natatorium)
        signalAge += dt
    },

    uniforms (): CustomUniforms {
      for (let i = 0; i < 3; i++) {
        const s = state.slots[i]
        const o = i * 4

        uSecA[o]     = s.cos
        uSecA[o + 1] = s.sin
        uSecA[o + 2] = s.tx
        uSecA[o + 3] = s.tz

        uSecB[o]     = s.ty
        uSecB[o + 1] = s.halfW
        uSecB[o + 2] = s.ceilH
        uSecB[o + 3] = s.len

        uSecC[o]     = s.slope
        uSecC[o + 1] = s.type
        uSecC[o + 2] = s.grime
        uSecC[o + 3] = s.lamp

        uSecD[o]     = deployAt(s.ahead)
        // The aisle's height, uploaded rather than mirrored as a GLSL constant:
        // it is derived from EYE, and a hand-kept copy of EYE in the shader is
        // exactly the kind of contract that rots (see stairwell's SEG_LEN).
        uSecD[o + 1] = EYE - 0.35
        uSecD[o + 2] = s.id
        uSecD[o + 3] = 0
      }

      uCam[0] = state.camX
      uCam[1] = state.camY
      uCam[2] = state.camZ
      uCam[3] = state.yaw

      uLook[0] = state.pitch
      uLook[1] = state.roll
      uLook[2] = state.above
      uLook[3] = state.depth

      // Water height in the *current section's local frame* — the space the
      // shader marches in, where local y = 0 is the section's start floor.
      // Derived from the frame origin, not from the camera's floor height: the
      // latter is corner-blended, so through every join it drifts away from the
      // section's own ramp and the water surface visibly bobbed with it.
      uWave[0] = state.waterY - state.frameY
      uWave[1] = state.lapF
      uWave[2] = state.dist
      uWave[3] = state.section.type

      return { uSecA, uSecB, uSecC, uSecD, uCam, uLook, uWave }
    },

    label () {
      return labelFor(state)
    },

    /** One lap of SECTIONS, walked over and over. `dist` is total, so fold it. */
    marks (): JourneyMarks {
      return {
        loop:         state.lap,
        section:      SECTIONS.indexOf(state.section),
        sectionCount: SECTION_COUNT,
        progress:     state.dist % LAP_LEN / LAP_LEN,
        signalAge,
      }
    },
  }
}
