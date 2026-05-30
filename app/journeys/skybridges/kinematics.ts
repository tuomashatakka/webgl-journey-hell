export interface SkybridgesSection {
  id: number;
  name: string;
  startZ: number;
  endZ: number;
}

export const SKYBRIDGES_SPEED = 7.5;
export const SKYBRIDGES_LOOP_Z = 360.0;

export const SKYBRIDGES_SECTIONS: SkybridgesSection[] = [
  { id: 1, name: 'SECTION 1: RUNWAY OF GLASS', startZ: 0.0, endZ: 55.0 },
  { id: 2, name: 'SECTION 2: EDGE HANG / FREEFALL', startZ: 55.0, endZ: 110.0 },
  { id: 3, name: 'SECTION 3: UNDERBRIDGE CANYON', startZ: 110.0, endZ: 165.0 },
  { id: 4, name: 'SECTION 4: TOWER DETONATION', startZ: 165.0, endZ: 225.0 },
  { id: 5, name: 'SECTION 5: STORM SWITCHBACK', startZ: 225.0, endZ: 290.0 },
  { id: 6, name: 'SECTION 6: HELIX RECOVERY', startZ: 290.0, endZ: SKYBRIDGES_LOOP_Z },
];

export function getSkybridgesSection(time: number): SkybridgesSection {
  const z = (((time * SKYBRIDGES_SPEED) % SKYBRIDGES_LOOP_Z) + SKYBRIDGES_LOOP_Z) % SKYBRIDGES_LOOP_Z;
  return SKYBRIDGES_SECTIONS.find((section) => z >= section.startZ && z < section.endZ)
    ?? SKYBRIDGES_SECTIONS[SKYBRIDGES_SECTIONS.length - 1];
}

export function getSkybridgesSectionName(time: number): string {
  return getSkybridgesSection(time).name;
}
