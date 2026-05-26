export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function mix(start: number, end: number, t: number): number {
  return start * (1.0 - t) + end * t;
}

export interface KinematicState {
  loop: number;
  sector: number;   // 1 to 6, or 666
  part: number;     // 1 to 3 for 666 parts
  localZ: number;
  secLen: number;
  isFall: boolean;
  isCrystal: boolean;
  name: string;
}

// Fixed-length loop timeline definition (600.0 units per loop)
export function getKinematicState(z: number): KinematicState {
  // If we reach the endless fall of the last Loop 3, we stay in it forever
  if (z >= 2270.0) {
    return {
      loop: 3,
      sector: 666,
      part: 2,
      localZ: z - 2270.0,
      secLen: 1000000.0,
      isFall: true,
      isCrystal: false,
      name: "void."
    };
  }

  const loop = Math.floor(z / 600.0);
  const lz = z % 600.0;

  if (lz < 60.0) {
    return {
      loop,
      sector: 1,
      part: 0,
      localZ: lz,
      secLen: 60.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 1: POOLROOMS"
    };
  }
  if (lz < 130.0) {
    return {
      loop,
      sector: 2,
      part: 0,
      localZ: lz - 60.0,
      secLen: 70.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 2: THE DESCENT"
    };
  }
  if (lz < 210.0) {
    return {
      loop,
      sector: 3,
      part: 0,
      localZ: lz - 130.0,
      secLen: 80.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 3: CHASM TUBE"
    };
  }
  if (lz < 280.0) {
    return {
      loop,
      sector: 4,
      part: 0,
      localZ: lz - 210.0,
      secLen: 70.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 4: CRUMBLING BRIDGE"
    };
  }
  if (lz < 430.0) {
    return {
      loop,
      sector: 5,
      part: 0,
      localZ: lz - 280.0,
      secLen: 150.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 5: ASCENSION"
    };
  }

  // Sector 6 / 666 transition zone (lz from 430.0 to 600.0, length 170)
  const local666 = lz - 430.0;
  if (loop === 0) {
    return {
      loop: 0,
      sector: 6,
      part: 0,
      localZ: local666,
      secLen: 170.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 6: TRANSITION CORRIDOR"
    };
  }

  // Decayed 666 loops
  if (local666 < 40.0) {
    return {
      loop,
      sector: 666,
      part: 1,
      localZ: local666,
      secLen: 40.0,
      isFall: false,
      isCrystal: false,
      name: "SECTOR 666: THE WEAKENING WALLS"
    };
  }
  if (local666 < 130.0) {
    // 90 units long fall: at speed 7.5, takes exactly 12 seconds!
    return {
      loop,
      sector: 666,
      part: 2,
      localZ: local666 - 40.0,
      secLen: 90.0,
      isFall: true,
      isCrystal: loop === 1,
      name: "SECTOR 666: CRYSTAL VACUUM"
    };
  }

  // Part 3: Ground impact sideways fall & recovery
  return {
    loop,
    sector: 666,
    part: 3,
    localZ: local666 - 130.0,
    secLen: 40.0,
    isFall: false,
    isCrystal: false,
    name: "SECTOR 666: COLLAPSE RECOVERY"
  };
}

// Horizontal swaying and alignment offsets
export function getCamX(z: number): number {
  const state = getKinematicState(z);

  if (state.sector === 1) return 0.0;
  if (state.sector === 2) {
    const s = smoothstep(5.0, 15.0, state.localZ) * (1.0 - smoothstep(55.0, 65.0, state.localZ));
    return s * Math.sin(z * 0.15) * 4.0;
  }
  if (state.sector === 3) {
    const s = smoothstep(0.0, 5.0, state.localZ) * (1.0 - smoothstep(75.0, 80.0, state.localZ));
    return s * Math.sin(z * 0.4) * 1.5;
  }
  if (state.sector === 4) {
    return Math.sin(z * 0.08) * 1.8;
  }
  if (state.sector === 5) {
    // Elegant winding stair sway
    const t5 = state.localZ / state.secLen;
    return Math.sin(t5 * Math.PI * 3.0) * 3.5;
  }
  if (state.sector === 6) return 0.0;
  if (state.sector === 666) {
    if (state.isFall) {
      return Math.sin(state.localZ * 0.15) * 1.5;
    }
    return Math.sin(z * 0.08) * 2.5;
  }
  return 0.0;
}

// Camera vertical layout height offset
export function getCamOffset(z: number): number {
  const state = getKinematicState(z);

  if (state.sector === 2 && state.localZ >= 5.0 && state.localZ < 65.0) {
    return 0.95; // slide alignment
  }
  if (state.sector === 3) {
    return 1.0;
  }
  if (state.sector === 666 && state.part === 3) {
    // Ground impact and recovery height animation
    if (state.localZ < 20.0) {
      // Tumble down to floor: 1.8 down to 0.25
      const t = state.localZ / 20.0;
      return mix(1.8, 0.25, smoothstep(0.0, 1.0, t));
    } else {
      // Pick up stand again: 0.25 up to 1.8
      const t = (state.localZ - 20.0) / 20.0;
      return mix(0.25, 1.8, smoothstep(0.0, 1.0, t));
    }
  }
  return 1.8;
}

// Evaluates the physical floor Y elevation
export function getFloorY(z: number): number {
  const state = getKinematicState(z);

  if (state.sector === 1) return 0.0;
  if (state.sector === 2) {
    const t = state.localZ / state.secLen;
    return mix(0.0, -25.0, t * t * (3 - 2 * t));
  }
  if (state.sector === 3) {
    const t = state.localZ / state.secLen;
    return mix(-25.0, -125.0, t * t * (3 - 2 * t));
  }
  if (state.sector === 4) {
    const t = state.localZ / state.secLen;
    const bridgeArc = Math.sin(t * Math.PI) * 7.5;
    return -125.0 + bridgeArc;
  }
  if (state.sector === 5) {
    if (state.localZ < 75.0) {
      // Colossal stairs scaling from -125.0 to 0.0 smoothly
      const stepSize = 4.3;
      const s = state.localZ / stepSize;
      const smoothStair = Math.floor(s) + smoothstep(0.6, 1.0, s - Math.floor(s));
      return -125.0 + smoothStair * 3.75;
    } else {
      // Halfway collapse: long fall to open water (ends around localZ = 120.0)
      const tFall = (state.localZ - 75.0) / 75.0;
      if (tFall < 0.6) {
        const nt = tFall / 0.6;
        return mix(-61.25, -180.0, nt * nt); // Plunge down
      } else {
        return -180.0; // Wade in open water
      }
    }
  }
  if (state.sector === 6) return -180.0;
  if (state.sector === 666) {
    if (state.isFall) {
      // Fall down from wet corridor to pit
      const t = state.localZ / state.secLen;
      return mix(-180.0, -350.0, t * t);
    }
    // Ground level in Part 3 recovery sits flat at -350.0
    if (state.part === 3) {
      return -350.0;
    }
    return -180.0 + Math.sin(state.localZ * 0.12) * 2.0;
  }
  return 0.0;
}

export function getCamY(z: number): number {
  return getFloorY(z);
}

// Determines the player's walking speed dynamically
export function getWalkSpeed(z: number): number {
  const state = getKinematicState(z);

  // Sector 5 Gravity Lab climbing: Super atmospheric crawling ascent, then collapse fall, then wading
  if (state.sector === 5) {
    if (state.localZ < 75.0) {
      return 1.6; // Slow crawl climbing
    } else {
      const tFall = (state.localZ - 75.0) / 75.0;
      if (tFall < 0.6) {
        return 16.0; // Rapid vertical fall velocity
      } else {
        return 4.5; // Slow water splashing wade
      }
    }
  }

  // Active elevator shaft/tube plunging speed (takes exactly 12s for the 90 units)
  if (state.isFall) {
    if (state.loop === 3) {
      return 22.0; // Endless final decay hyper-fall!
    }
    return 7.5; // Exactly 12 seconds downward plunge!
  }

  // Crawl speeds during impact recovery
  if (state.sector === 666 && state.part === 3) {
    return 2.0; // very slow cinematic impact struggle
  }

  return 8.2; // standard cruising speed
}
