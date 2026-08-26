import type { JourneySimulation } from '@/components/withJourneyShell'


export const LOOP_LENGTH = 500
export const FINALE_DISTANCE = LOOP_LENGTH * 4
export const TERMINAL_DISTANCE = FINALE_DISTANCE - 0.25

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

export interface StairwellState {
  z:               number;
  loop:            number;
  loopProgress:    number;
  section:         StairwellSection;
  sectionProgress: number;
  transition:      number;
  rupture:         number;
  finale:          number;
  terminal:        boolean;
}

export function clamp01 (value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function smoothstep (edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function sectionAt (localZ: number): StairwellSection {
  return STAIRWELL_SECTIONS.find(section => localZ < section.end) ?? STAIRWELL_SECTIONS.at(-1)!
}

export function getStairwellState (z: number): StairwellState {
  const safeZ        = Math.max(0, Math.min(z, TERMINAL_DISTANCE))
  const loop         = Math.min(3, Math.floor(safeZ / LOOP_LENGTH))
  const localZ       = safeZ - loop * LOOP_LENGTH
  const section      = sectionAt(localZ)
  const sectionLen   = section.end - section.start
  const sectionLocal = localZ - section.start
  const progress     = clamp01(sectionLocal / sectionLen)
  const ruptureLead  = section.id === 5 && loop < 3
    ? smoothstep(0.62, 1, progress)
    : 0
  const finale       = loop === 3 && section.id === 5
    ? smoothstep(0.04, 0.96, progress)
    : 0

  return {
    z:               safeZ,
    loop,
    loopProgress:    clamp01(localZ / LOOP_LENGTH),
    section,
    sectionProgress: progress,
    transition:      smoothstep(0.58, 1, progress),
    rupture:         Math.min(1, (loop + ruptureLead) / 3),
    finale,
    terminal:        safeZ >= TERMINAL_DISTANCE - 0.001,
  }
}

export function getWalkSpeed (z: number): number {
  const state = getStairwellState(z)
  if (state.terminal)
    return 0

  let speed = state.section.speed
  speed *= 1 - 0.22 * smoothstep(0.82, 1, state.sectionProgress)

  if (state.loop === 3 && state.section.id === 5) {
    const fall = smoothstep(0.18, 0.52, state.sectionProgress) *
      (1 - smoothstep(0.68, 0.98, state.sectionProgress))
    speed = speed * (1 - state.finale * 0.32) + fall * 7.5
    speed *= 1 - 0.985 * smoothstep(0.72, 0.995, state.sectionProgress)
  }

  return Math.max(0.08, speed)
}

export function getSectionLabel (state: StairwellState): string {
  if (state.terminal)
    return 'THE STAIRWELL · SIGNAL LOST'
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

      const nextZ = Math.min(TERMINAL_DISTANCE, z + getWalkSpeed(z) * dt)
      z = nextZ >= TERMINAL_DISTANCE - 0.002 ? TERMINAL_DISTANCE : nextZ
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
        uFinale:          state.finale,
      }
    },

    label () {
      return getSectionLabel(getStairwellState(z))
    },
  }
}

// perf: cheap cpu timeline; constant memory and one scalar integration per frame.
