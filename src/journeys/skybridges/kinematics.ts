import { CONFIG } from '@wjh/config/config'
import type { JourneyMarks } from '@wjh/journey/types'

// Twelve seconds per section at default speed gives each place room to land.
// The shader is built from these (shader.ts), so they are the one source.
export const SKYBRIDGES_SPEED  = 5
export const SKYBRIDGES_LOOP_Z = 540

/** The detonation: the lap-three boundary, in seconds of run. */
export const SKYBRIDGES_BLAST_T = CONFIG.signal.lossLaps.skybridges * SKYBRIDGES_LOOP_Z / SKYBRIDGES_SPEED

// Nine places on one continuous first-person run, 60 m each. The shader keeps
// each section's set piece in its own z band. See docs/journeys/skybridges.md.
const SKYBRIDGES_SECTIONS: SkybridgesSection[] = [
  { id: 1, name: 'SECTION 1: DAWN APPROACH', startZ: 0, endZ: 60 },
  { id: 2, name: 'SECTION 2: THE INTERCHANGE', startZ: 60, endZ: 120 },
  { id: 3, name: 'SECTION 3: THE CURTAIN WALL', startZ: 120, endZ: 180 },
  { id: 4, name: 'SECTION 4: THE WIRE', startZ: 180, endZ: 240 },
  { id: 5, name: 'SECTION 5: THE GLASS LINE', startZ: 240, endZ: 300 },
  { id: 6, name: 'SECTION 6: THE CANYON', startZ: 300, endZ: 360 },
  { id: 7, name: 'SECTION 7: FROST GALLERY', startZ: 360, endZ: 420 },
  { id: 8, name: 'SECTION 8: NIGHT HELIX', startZ: 420, endZ: 480 },
  { id: 9, name: 'SECTION 9: THE CROWN', startZ: 480, endZ: SKYBRIDGES_LOOP_Z },
]

interface SkybridgesSection {
  id:     number;
  name:   string;
  startZ: number;
  endZ:   number;
}

function getSkybridgesSection (time: number): SkybridgesSection {
  const z = (time * SKYBRIDGES_SPEED % SKYBRIDGES_LOOP_Z + SKYBRIDGES_LOOP_Z) % SKYBRIDGES_LOOP_Z
  return SKYBRIDGES_SECTIONS.find(section => z >= section.startZ && z < section.endZ) ??
    SKYBRIDGES_SECTIONS[SKYBRIDGES_SECTIONS.length - 1]
}

export function getSkybridgesSectionName (time: number): string {
  return getSkybridgesSection(time).name
}

/**
 * Where the route is, for the transport controls. This journey has no
 * simulation — its run is a constant speed authored in GLSL — so the shell
 * takes this through marksAt rather than through JourneySimulation.
 */
export function getSkybridgesMarks (time: number): JourneyMarks {
  const z       = time * SKYBRIDGES_SPEED
  const section = getSkybridgesSection(time)

  return {
    loop:         Math.floor(z / SKYBRIDGES_LOOP_Z),
    section:      SKYBRIDGES_SECTIONS.indexOf(section),
    sectionCount: SKYBRIDGES_SECTIONS.length,
    progress:     z % SKYBRIDGES_LOOP_Z / SKYBRIDGES_LOOP_Z,

    // No simulation to keep a counter in, and none needed: the route is a pure
    // function of the clock, so the seconds since the ending began are too. The
    // detonation plays at full picture for holdSeconds before they start counting.
    signalAge: Math.max(0, time - SKYBRIDGES_BLAST_T - CONFIG.signal.holdSeconds.skybridges),
  }
}
