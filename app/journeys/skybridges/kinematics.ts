export interface SkybridgesSection {
  id: number;
  name: string;
  startZ: number;
  endZ: number;
}

export const SKYBRIDGES_SPEED = 7.5;
export const SKYBRIDGES_LOOP_Z = 540.0;

// Nine themed scenes on one continuous first-person run (~60 units each). The
// shader mirrors these centers; geometry for each section lives in its own
// world-Z band. See SPEC.md for the full design.
export const SKYBRIDGES_SECTIONS: SkybridgesSection[] = [
  { id: 1, name: 'SECTION 1: DAWN APPROACH', startZ: 0.0, endZ: 60.0 },
  { id: 2, name: 'SECTION 2: THE CONVERGENCE', startZ: 60.0, endZ: 120.0 },
  { id: 3, name: 'SECTION 3: THE ASCENT', startZ: 120.0, endZ: 180.0 },
  { id: 4, name: 'SECTION 4: HIGH SPAN', startZ: 180.0, endZ: 240.0 },
  { id: 5, name: 'SECTION 5: THE TRAIN', startZ: 240.0, endZ: 300.0 },
  { id: 6, name: 'SECTION 6: THE CATCH', startZ: 300.0, endZ: 360.0 },
  { id: 7, name: 'SECTION 7: FROST GALLERY', startZ: 360.0, endZ: 420.0 },
  { id: 8, name: 'SECTION 8: AURORA HELIX', startZ: 420.0, endZ: 480.0 },
  { id: 9, name: 'SECTION 9: SKYLIGHT RELEASE', startZ: 480.0, endZ: SKYBRIDGES_LOOP_Z },
];

export function getSkybridgesSection(time: number): SkybridgesSection {
  const z = (((time * SKYBRIDGES_SPEED) % SKYBRIDGES_LOOP_Z) + SKYBRIDGES_LOOP_Z) % SKYBRIDGES_LOOP_Z;
  return SKYBRIDGES_SECTIONS.find((section) => z >= section.startZ && z < section.endZ)
    ?? SKYBRIDGES_SECTIONS[SKYBRIDGES_SECTIONS.length - 1];
}

export function getSkybridgesSectionName(time: number): string {
  return getSkybridgesSection(time).name;
}
