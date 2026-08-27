import type { JourneySimulation } from '@/components/withJourneyShell'
import type { JourneyMarks } from '@/lib/journeyTransport'


export const LOOP_LENGTH = 500
export const LOOP_COUNT = 4
export const FINALE_DISTANCE = LOOP_LENGTH * LOOP_COUNT

/**
 * Where the anthology stops repeating. Past this there is no fifth traversal —
 * the fall at the end of the fourth shear horizon delivers you into purgatory
 * instead, and purgatory does not end.
 */
export const PURGATORY_START = FINALE_DISTANCE

/** One circuit of the residue. It re-enters itself, so this is a period, not a length. */
export const PURGATORY_LENGTH = 260

/** Units over which the fall's aftermath settles into the drift. */
const PURGATORY_SETTLE = 30

/** Units over which the residue finishes taking the colour out of the world. */
const PURGATORY_BLOOM = 60

/** Speed at the exact instant the fall ends. Both sides of the seam use it. */
const PURGATORY_ENTRY_SPEED = 1.0

/** Steady-state walking pace in purgatory. Slower than any act; nothing is arrived at. */
const PURGATORY_DRIFT = 1.6

/** How much of the residue has bled into the world by the last traversal. */
const MAX_BLEED = 0.73

export interface StairwellSection {
  id:    number;
  start: number;
  end:   number;
  speed: number;
  name:  string;
  short: string;
}

export const STAIRWELL_SECTIONS: readonly StairwellSection[] = [
  { id: 0, start: 0, end: 70, speed: 6.2, name: 'I · THE SPILLWAY THRESHOLD', short: 'spillway' },
  { id: 1, start: 70, end: 155, speed: 4.2, name: 'II · PROTEAN WEATHER BRIDGE', short: 'storm' },
  { id: 2, start: 155, end: 235, speed: 5.4, name: 'III · THE TURBINE CANYON', short: 'turbines' },
  { id: 3, start: 235, end: 325, speed: 5.0, name: 'IV · CONVEYOR ESCARPMENT', short: 'quarry' },
  { id: 4, start: 325, end: 410, speed: 4.6, name: 'V · THE COOLING FIELD', short: 'cooling' },
  { id: 5, start: 410, end: 500, speed: 4.1, name: 'VI · THE SHEAR HORIZON', short: 'shear' },
] as const

/**
 * The terminal act. Kept out of STAIRWELL_SECTIONS because that table is the
 * *anthology* — six acts that tile one 500-unit traversal exactly, which is
 * what assertStairwellRoute checks. Purgatory is not part of the loop; it is
 * what is left when the loop stops.
 */
export const PURGATORY_SECTION: StairwellSection = {
  id:    6,
  start: 0,
  end:   PURGATORY_LENGTH,
  speed: PURGATORY_DRIFT,
  name:  'VII · PURGATORY',
  short: 'purgatory',
}

export interface StairwellState {
  z:               number;
  loop:            number;
  loopProgress:    number;
  section:         StairwellSection;
  sectionProgress: number;
  transition:      number;

  /**
   * Traversal damage, normalised to 0..1 across the four loops. Kept as the
   * headline number because the audio graph and the SPEC are both written
   * against it; `decay` is the underlying continuous quantity.
   */
  rupture: number;

  /**
   * The eased traversal counter, 0..LOOP_COUNT — the same shape liminal uses
   * for its own decay (`smoothLoop = loop + smoothstep(400, 500, z)`). Every
   * rupture effect scales off this rather than off the integer loop, so the
   * damage arrives as a ramp instead of a step at the reset.
   */
  decay: number;

  /**
   * How far the residue has taken hold, 0..1. Non-zero from the second
   * traversal onward — purgatory is not somewhere you arrive, it is something
   * that has been leaking backwards into the route the whole time.
   */
  purgatory: number;

  finale:            number;
  inPurgatory:       boolean;
  purgatoryLap:      number;
  purgatoryProgress: number;
}

export function clamp01 (value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function smoothstep (edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Quintic ease. Zero first *and* second derivative at both ends, where
 * smoothstep only zeroes the first — which is why the act handoff used to show
 * a kick as the blend opened and closed. Nothing else about the transition
 * changed; it is the same crossfade over a longer, flatter curve.
 */
export function smootherstep (edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function sectionAt (localZ: number): StairwellSection {
  return STAIRWELL_SECTIONS.find(section => localZ < section.end) ?? STAIRWELL_SECTIONS.at(-1)!
}

export function getStairwellState (z: number): StairwellState {
  const safeZ = Math.max(0, z)

  if (safeZ >= PURGATORY_START) {
    const depth  = safeZ - PURGATORY_START
    const lap    = Math.floor(depth / PURGATORY_LENGTH)
    const localZ = depth - lap * PURGATORY_LENGTH

    return {
      z:                 safeZ,
      loop:              LOOP_COUNT - 1,
      loopProgress:      1,
      section:           PURGATORY_SECTION,
      sectionProgress:   localZ / PURGATORY_LENGTH,
      transition:        0,
      rupture:           1,
      decay:             LOOP_COUNT,
      purgatory:         MAX_BLEED + (1 - MAX_BLEED) * smoothstep(0, PURGATORY_BLOOM, depth),
      // The fall is over the moment you are here. It releases rather than cuts,
      // so the camera pitch and the broken path unwind instead of snapping —
      // but quickly, over about ten seconds of drift. Held longer, the finale's
      // narrowed field of view and downward pitch leave you staring at the floor
      // through the whole entry into the residue.
      finale:            1 - smoothstep(0, 14, depth),
      inPurgatory:       true,
      purgatoryLap:      lap,
      purgatoryProgress: localZ / PURGATORY_LENGTH,
    }
  }

  const loop         = Math.floor(safeZ / LOOP_LENGTH)
  const localZ       = safeZ - loop * LOOP_LENGTH
  const section      = sectionAt(localZ)
  const sectionLen   = section.end - section.start
  const sectionLocal = localZ - section.start
  const progress     = clamp01(sectionLocal / sectionLen)
  const loopProgress = clamp01(localZ / LOOP_LENGTH)

  // The eased traversal counter. Ramping over the closing fifth of the loop —
  // rather than over the tail of the sixth act alone, as it used to — is what
  // makes the reset arrive as a slide instead of a step.
  const decay  = loop + smoothstep(0.80, 1.0, loopProgress)
  const finale = loop === LOOP_COUNT - 1 && section.id === 5
    ? smoothstep(0.04, 0.96, progress)
    : 0

  return {
    z:                 safeZ,
    loop,
    loopProgress,
    section,
    sectionProgress:   progress,
    transition:        smootherstep(0.52, 1, progress),
    rupture:           Math.min(1, decay / (LOOP_COUNT - 1)),
    decay,
    purgatory:         clamp01(decay / LOOP_COUNT) * MAX_BLEED,
    finale,
    inPurgatory:       false,
    purgatoryLap:      0,
    purgatoryProgress: 0,
  }
}

export function getWalkSpeed (z: number): number {
  const state = getStairwellState(z)

  if (state.inPurgatory) {
    const depth = state.z - PURGATORY_START
    // A slow, uneven drift. Sine of distance rather than of time, so the pace
    // at a given point is the same on every replay — the seek depends on it.
    const drift = PURGATORY_DRIFT + 0.22 * Math.sin(depth * 0.037)
    return PURGATORY_ENTRY_SPEED +
      (drift - PURGATORY_ENTRY_SPEED) * smoothstep(0, PURGATORY_SETTLE, depth)
  }

  let speed = state.section.speed
  speed *= 1 - 0.22 * smoothstep(0.82, 1, state.sectionProgress)

  if (state.loop === LOOP_COUNT - 1 && state.section.id === 5) {
    const fall = smoothstep(0.18, 0.52, state.sectionProgress) *
      (1 - smoothstep(0.68, 0.98, state.sectionProgress))
    speed = speed * (1 - state.finale * 0.32) + fall * 7.5

    // Land exactly on the purgatory entry speed rather than decaying toward a
    // standstill. The seam between the fall and the drift has to be continuous
    // in the first derivative too, or the scan picks it up as a discontinuity.
    speed += (PURGATORY_ENTRY_SPEED - speed) * smoothstep(0.72, 1.0, state.sectionProgress)
  }

  return Math.max(0.08, speed)
}

export function getSectionLabel (state: StairwellState): string {
  if (state.inPurgatory)
    return `VII · PURGATORY · ∞${String(state.purgatoryLap + 1).padStart(2, '0')}`
  if (state.finale > 0.76)
    return 'VI · THE WORLD COMES APART'
  return `LOOP ${state.loop + 1} · ${state.section.name}`
}

export function assertStairwellRoute (): string[] {
  const failures: string[] = []
  let cursor = 0
  for (const section of STAIRWELL_SECTIONS) {
    if (section.start !== cursor)
      failures.push(`${section.short}: starts at ${section.start}, expected ${cursor}`)
    if (section.end <= section.start)
      failures.push(`${section.short}: non-positive length`)
    cursor = section.end
  }
  if (cursor !== LOOP_LENGTH)
    failures.push(`route ends at ${cursor}, expected ${LOOP_LENGTH}`)
  return failures
}

export function createStairwellSimulation (): JourneySimulation {
  let z = 0

  return {
    step (dt) {
      if (!Number.isFinite(dt) || dt <= 0)
        return

      z += getWalkSpeed(z) * dt
    },

    uniforms () {
      const state = getStairwellState(z)
      return {
        uPlayerZ:         state.z,
        uSection:         state.section.id,
        uSectionProgress: state.sectionProgress,
        uTransition:      state.transition,
        uLoop:            state.loop,
        uLoopProgress:    state.loopProgress,
        uRupture:         state.rupture,
        uDecay:           state.decay,
        uPurgatory:       state.purgatory,
        uFinale:          state.finale,
      }
    },

    label () {
      return getSectionLabel(getStairwellState(z))
    },

    /** Each traversal is a lap; each purgatory circuit is another one. */
    marks (): JourneyMarks {
      const state = getStairwellState(z)
      return {
        loop:         state.inPurgatory ? LOOP_COUNT + state.purgatoryLap : state.loop,
        section:      state.section.id,
        sectionCount: state.inPurgatory ? 1 : STAIRWELL_SECTIONS.length,
        progress:     state.inPurgatory ? state.purgatoryProgress : state.loopProgress,
      }
    },
  }
}

// perf: cheap cpu timeline; constant memory and one scalar integration per frame.
