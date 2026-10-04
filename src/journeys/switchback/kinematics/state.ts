import { lapLabel } from '@wjh/journey/label'
import { clamp01, mix, smootherstep } from '@wjh/math/scalar'
import { Bend, fitBend } from './bend'
import { FALL_BLOCK, FALL_LAPS, FALL_SECTION, FALL_START, LAP_LEN, PHASE_WRAP, PITCH_LAPS, SECTIONS, SECTION_COUNT, STARTS, Section, beatAt, curvAt, fallDepthAt, gradeAt, yawAt } from './route'
import { DECAY_SECTION, FALL_ENTRY, G, V_MAX } from './constants'

// ---------------------------------------------------------------------------

export interface SwitchbackState {

  /** Arc length travelled. CPU-only; nothing this large reaches the shader. */
  s: number;

  /** `s` folded into [0, PHASE_WRAP) for the lattices. See PHASE_WRAP. */
  phase: number;

  lap: number;

  /**
   * Laps run, with the fractional part ramping across THE OVERLOOK rather than
   * stepping at the seam. Everything that gets worse per lap reads this.
   */
  lapF: number;

  speed: number;
  grade: number;
  yaw:   number;
  curv:  number;

  /** Track bank, radians, from lateral acceleration. Right turn banks positive. */
  bank: number;

  /** The fraction of the bank the rider's head actually takes. */
  headRoll: number;

  /** Rail-joint chatter, scaled by speed. Two axes, both tiny and both essential. */
  joltX: number;
  joltY: number;

  /** Where the rider is looking, relative to the track. Leads into the turn. */
  lookYaw:   number;
  lookPitch: number;

  /**
   * The chain speed in force here, 0 where the cart runs free. Nothing in the
   * shader reads it — it is for the soundtrack, which cannot tell a lift hill
   * from a brake run from the speed alone (both hold it steady) and has to make
   * a very different noise about each.
   */
  chain: number;

  bend: Bend;

  /** World up, expressed in the *track's* frame — this is where the bank lives. */
  up: [ number, number, number ];

  /** Sun direction in the track's frame. */
  sun: [ number, number, number ];

  /** Three resident sections: the one behind, the current one, the next. */
  slots: Slot[];

  section: Section;
  name:    string;

  /** 0..1 how far the lamps have failed, and how far everything else has. */
  lightFail: number;
  decay:     number;

  /** 0..1 how far the railway has tipped over. 0 on the first lap by construction. */
  pitch: number;

  /** True once the rails have run out. */
  inFall: boolean;

  /** 0..1 how far into the shaft, eased over FALL_ENTRY metres. */
  fall: number;

  /** Metres fallen past the end of the track. Unbounded, like the speed. */
  fallDepth: number;

  /** The shaft's accumulated corkscrew, radians, wrapped. */
  twist: number;

  /** 0..1 fissure density in the walls, and how hard they are lit from behind. */
  crack: number;
}

interface Slot {

  /** Section bounds relative to the cart, in metres of camera-space depth. */
  z0: number;
  z1: number;

  type:   number;
  bore:   number;
  ceilH:  number;
  floorD: number;
  lamp:   number;
  lampY:  number;
  grime:  number;
  sky:    number;
  id:     number;
}

function makeSlot (sec: Section, z0: number, z1: number): Slot {
  return {
    z0,
    z1,
    type:   sec.type,
    bore:   sec.bore,
    ceilH:  sec.ceilH,
    floorD: sec.floorD,
    lamp:   sec.lamp,
    lampY:  sec.lampY,
    grime:  sec.grime,
    sky:    sec.sky,
    id:     sec.id,
  }
}

/**
 * The whole ride as a pure function of arc length and speed. Nothing in here
 * reads a clock; the integrator owns time and this owns shape, which is what
 * makes `?t=` replayable to the byte.
 */
export function getSwitchbackState (s: number, speed: number, headRollPrev: number): SwitchbackState {
  const lap  = Math.floor(s / LAP_LEN)
  const lapU = s - lap * LAP_LEN
  const lapF = lap + smootherstep(
    STARTS[DECAY_SECTION],
    STARTS[DECAY_SECTION] + SECTIONS[DECAY_SECTION].len,
    lapU,
  )

  const b       = beatAt(s)
  const yaw     = yawAt(s)
  const grade   = gradeAt(s)
  const curv    = curvAt(s)
  const section = b.sec

  // Bank the car until the resultant of gravity and the turn is square to the
  // floor — which is what a track designer does, and it means the number is a
  // property of the *track*, not of the ride, everywhere except that it depends
  // on the speed the track was designed for. Ours banks live, which is a small
  // lie that reads as a very good one.
  //
  // ...up to about the speed the track was designed for, and no further. v^2
  // drives the arctangent hard into its own saturation, so at four times that
  // speed the bank sits pinned at its limit through every turn and then snaps
  // across the whole range in the centimetre where the curvature changes sign.
  // That is a roll stutter at every beat boundary, and it is not the track.
  const vBank  = Math.min(speed, V_MAX)
  const bank   = Math.atan2(vBank * vBank * curv, G)
  const capped = Math.max(-0.85, Math.min(0.85, bank))

  // The rider's head lags the car. Tracked as state rather than derived so the
  // lag is real lag and not a scaled copy of the input.
  const headRoll = mix(headRollPrev, capped * 0.3, 0.06)

  // Rail joints. Amplitude grows with speed and with how bad the road has got.
  const wear  = clamp01(lapF * 0.3) * 0.5 + 0.5
  const rough = Math.min(1, speed / 14) * wear
  const joltY = (Math.sin(s * 4.7) * 0.6 + Math.sin(s * 11.3) * 0.4) * 0.008 * rough
  const joltX = Math.sin(s * 7.9 + 1.7) * 0.006 * rough

  const bend = fitBend(s, yaw, grade)

  // --- world up and the sun, in the track's frame ---
  //
  // right is horizontal by construction, so world-up has no component along it
  // before the bank; after it, that component is the entire visible tilt.
  const cg = Math.cos(grade)
  const sg = Math.sin(grade)
  const cb = Math.cos(capped)
  const sb = Math.sin(capped)

  // (0, cos g, sin g) is world-up in the unbanked track frame; roll it by the bank.
  const up: [ number, number, number ] = [ -sb * cg, cb * cg, sg ]

  // The sun sits at a fixed world azimuth, so as the railway turns it swings
  // around the ride — and because the lap does not close in yaw, it is in a
  // slightly different place every lap. That drift is free and it is the single
  // cheapest source of lap-to-lap variation in the whole journey.
  const sunAz = 0.6
  const sunEl = 0.13
  const swx   = Math.sin(sunAz) * Math.cos(sunEl)
  const swy   = Math.sin(sunEl)
  const swz   = Math.cos(sunAz) * Math.cos(sunEl)

  const cy  = Math.cos(yaw)
  const sy  = Math.sin(yaw)
  const fx  = sy * cg,
    fy      = sg,
    fz      = cy * cg
  const r0x = cy,
    r0y     = 0,
    r0z     = -sy
  const u0x = -sy * sg,
    u0y     = cg,
    u0z     = -cy * sg

  const rx = r0x * cb - u0x * sb,
    ry     = r0y * cb - u0y * sb,
    rz     = r0z * cb - u0z * sb
  const ux = r0x * sb + u0x * cb,
    uy     = r0y * sb + u0y * cb,
    uz     = r0z * sb + u0z * cb

  const sun: [ number, number, number ] = [
    swx * rx + swy * ry + swz * rz,
    swx * ux + swy * uy + swz * uz,
    swx * fx + swy * fy + swz * fz,
  ]

  // --- resident sections, as depth ranges ahead of the cart ---
  //
  // Arc length and camera depth are the same quantity to first order (that is
  // what the fit is *for*), so a section boundary is just a z. In a hard turn
  // depth runs a little short of length and the far boundary lands slightly
  // beyond where it should — always in the fog, and always in the direction of
  // the room you are about to be in anyway.
  const inFall    = s >= FALL_START
  const fallDepth = fallDepthAt(s)

  let prev: Section
  let next: Section
  let into: number

  if (inFall) {
    // The shaft is one block, tiled. The room behind you is the overlook only
    // for the first block — after that there is nothing back there either.
    const block = Math.floor(fallDepth / FALL_BLOCK)
    into = fallDepth - block * FALL_BLOCK
    prev = block === 0 ? SECTIONS[SECTION_COUNT - 1] : FALL_SECTION
    next = FALL_SECTION
  }
  else {
    prev = SECTIONS[(b.index - 1 + SECTION_COUNT) % SECTION_COUNT]
    into = lapU - STARTS[b.index] // how far into the current section

    // The one place the lap does not come back round. On the last lap the room
    // after the overlook is the shaft, so the rails visibly run out at a portal
    // you can see before you reach it rather than at the edge of the frame.
    next = lap === FALL_LAPS - 1 && b.index === SECTION_COUNT - 1
      ? FALL_SECTION
      : SECTIONS[(b.index + 1) % SECTION_COUNT]
  }

  const curZ0 = -into
  const curZ1 = curZ0 + section.len
  const slots = [
    makeSlot(prev, curZ0 - prev.len, curZ0),
    makeSlot(section, curZ0, curZ1),
    makeSlot(next, curZ1, curZ1 + next.len),
  ]

  const fall  = inFall ? smootherstep(0, FALL_ENTRY, fallDepth) : 0
  const crack = inFall
    ? mix(clamp01(FALL_LAPS * 0.24), 1, fall)
    : clamp01(lapF * 0.24)

  return {
    s,
    phase:     s - Math.floor(s / PHASE_WRAP) * PHASE_WRAP,
    lap,
    lapF,
    speed,
    grade,
    yaw,
    curv,
    bank:      capped,
    headRoll,
    joltX,
    joltY,
    // Lead the turn: a rider looks where the track is going, and at 20 m/s the
    // track is going somewhere well before the car is.
    lookYaw:   Math.max(-0.3, Math.min(0.3, curv * 26)),
    lookPitch: Math.max(-0.16, Math.min(0.16, -grade * 0.22)),
    chain:     b.sec.lift[b.beat],
    bend,
    up,
    sun,
    slots,
    section,
    name:      section.name,
    lightFail: Math.min(0.92, lapF * 0.34),
    decay:     Math.min(1, lapF * 0.3),
    pitch:     clamp01(lapF / PITCH_LAPS),
    inFall,
    fall,
    fallDepth,
    // Wrapped: the shader only ever takes its sine, and an angle that grows to
    // six figures over a long fall loses its mantissa on the way to the GPU.
    twist:     fallDepth * 0.0055 % (Math.PI * 2),
    crack,
  }
}

/** HUD label. Laps count from 1, the way the rest of the repo counts them. */
export function labelFor (state: SwitchbackState): string {
  const kph = Math.round(state.speed * 3.6)

  if (state.inFall)
    return state.fallDepth < 45
      ? 'THE TRACK ENDS'
      : `THE FALL · ${Math.round(state.fallDepth)}M · ${kph} KM/H`

  const head = lapLabel(state.lap, state.name, { bareFirst: true })
  return `${head} · ${kph} KM/H`
}
