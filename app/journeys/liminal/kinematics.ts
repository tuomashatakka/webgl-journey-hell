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
  descent: number;  // 0..1 progress through sector 666 (0 for non-666)
  setpieceA: number;
  setpieceB: number;
  blend: number;    // 0..1 cross-fade weight between A and B
  localZ: number;
  secLen: number;
  fallAmt: number;  // 0..1 continuous fall pitch amount
  name: string;
}

// ---- Sector 666 keyframe tables (identical literals to GLSL fsScene) ----

// Number of setpiece slots present for a given loop.
function pieceCount(loop: number): number {
  if (loop === 1) return 3;
  if (loop === 2) return 5;
  return 8; // loop >= 3
}

// Setpiece id occupying slot k (0-based) for a given loop.
function pieceAt(loop: number, k: number): number {
  const count = pieceCount(loop);
  const idx = Math.max(0, Math.min(count - 1, Math.floor(k)));
  if (loop === 1) {
    const list = [1, 2, 8];
    return list[idx];
  }
  if (loop === 2) {
    const list = [1, 2, 3, 4, 8];
    return list[idx];
  }
  const list = [1, 2, 3, 4, 5, 6, 7, 9]; // loop >= 3
  return list[idx];
}

// Floor depth target per setpiece id.
function pieceDepth(id: number): number {
  if (id === 1) return -15.0;
  if (id === 2) return -28.0;
  if (id === 3) return -45.0;
  if (id === 4) return -55.0;
  if (id === 5) return -62.0;
  if (id === 6) return -110.0;
  if (id === 7) return -180.0;
  if (id === 8) return -30.0;
  if (id === 9) return -350.0;
  return -30.0;
}

// Eye height (camera offset above floor) per setpiece id.
function pieceEye(id: number): number {
  if (id === 1) return 0.45;
  if (id === 2) return 1.8;
  if (id === 3) return 1.6;
  if (id === 4) return 0.42;
  if (id === 5) return 1.35;
  if (id === 6) return 1.75;
  if (id === 7) return 1.8;
  if (id === 8) return 1.6;
  if (id === 9) return 1.2;
  return 1.8;
}

// Continuous fall pitch amount per setpiece id.
function pieceFall(id: number): number {
  if (id === 1) return 0.85;
  if (id === 6) return 0.6;
  if (id === 7) return 0.9;
  if (id === 9) return 1.0;
  return 0.0;
}

// Gentle per-piece horizontal sway.
function pieceSway(id: number, z: number): number {
  if (id === 1) return Math.sin(z * 0.15) * 1.8;
  if (id === 5) return Math.sin(z * 0.6) * 0.6;
  if (id === 6) return Math.sin(z * 0.08) * 2.2;
  if (id === 7) return Math.sin(z * 0.4) * 0.8;
  if (id === 9) return Math.sin(z * 0.05) * 1.2;
  return Math.sin(z * 0.1) * 0.6;
}

// Per-piece walk speed.
function pieceSpeed(id: number): number {
  if (id === 1) return 8.5;
  if (id === 2) return 5.5;
  if (id === 3) return 8.2;
  if (id === 4) return 4.5;
  if (id === 5) return 4.0;
  if (id === 6) return 5.0;
  if (id === 7) return 3.5;
  if (id === 8) return 4.0;
  if (id === 9) return 6.0;
  return 8.2;
}

const PIECE_W = 0.28; // cross-fade width

function pieceName(id: number): string {
  if (id === 1) return "THE BARBED DESCENT";
  if (id === 2) return "THE ASHEN TUNDRA";
  if (id === 3) return "THE THROBBING WOMB";
  if (id === 4) return "THE CRUSHING CITADEL";
  if (id === 5) return "THE MEAT GRINDER";
  if (id === 6) return "THE SPIRAL BRIDGE";
  if (id === 7) return "SIGNAL ENTROPY";
  if (id === 8) return "THE RECOVERY";
  if (id === 9) return "THE VOID";
  return "THE VOID";
}

// Fixed-length loop timeline definition (500.0 units per loop)
export function getKinematicState(z: number): KinematicState {
  // If we reach the endless fall of the last Loop 3, we stay in it forever
  if (z >= 2000.0) {
    const localZ = z - 2000.0;
    const name = (localZ > 200.0)
      ? "SECTOR 666: THE ABYSS (STOPPED)"
      : "SECTOR 666: THE ABYSS — THE VOID";
    return {
      loop: 3,
      sector: 666,
      descent: 1.0,
      setpieceA: 9,
      setpieceB: 9,
      blend: 0.0,
      localZ,
      secLen: 1000000.0,
      fallAmt: 1.0 - smoothstep(0.0, 200.0, localZ) * 0.85,
      name
    };
  }

  const loop = Math.floor(z / 500.0);
  const lz = z % 500.0;

  if (lz < 60.0) {
    return {
      loop, sector: 1, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: lz, secLen: 60.0, fallAmt: 0,
      name: "SECTOR 1: POOLROOMS"
    };
  }
  if (lz < 130.0) {
    return {
      loop, sector: 2, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: lz - 60.0, secLen: 70.0, fallAmt: 0,
      name: "SECTOR 2: THE DESCENT"
    };
  }
  if (lz < 210.0) {
    return {
      loop, sector: 3, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: lz - 130.0, secLen: 80.0, fallAmt: 0,
      name: "SECTOR 3: CRYSTAL CAVE"
    };
  }
  if (lz < 280.0) {
    return {
      loop, sector: 4, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: lz - 210.0, secLen: 70.0, fallAmt: 0,
      name: "SECTOR 4: IRON HYDRAULICS"
    };
  }
  if (lz < 360.0) {
    return {
      loop, sector: 5, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: lz - 280.0, secLen: 80.0, fallAmt: 0,
      name: "SECTOR 5: VOID LABYRINTH"
    };
  }

  // Sector 6 / 666 transition zone (lz from 360.0 to 500.0, length 140)
  const local666 = lz - 360.0;
  if (loop === 0) {
    return {
      loop: 0, sector: 6, descent: 0, setpieceA: 0, setpieceB: 0, blend: 0,
      localZ: local666, secLen: 140.0, fallAmt: 0,
      name: "SECTOR 6: TRANSITION"
    };
  }

  // Sector 666: continuous setpiece cross-fade model
  const localZ = local666; // 0..140
  const secLen = 140.0;

  const descent = localZ / 140.0;

  const N = pieceCount(loop);
  const slotF = descent * N;
  const slot = Math.floor(slotF);
  const frac = slotF - slot;
  const setpieceA = pieceAt(loop, slot);
  const setpieceB = pieceAt(loop, Math.min(slot + 1, N - 1));
  const blend = smoothstep(1.0 - PIECE_W, 1.0, frac);
  const fallAmt = mix(pieceFall(setpieceA), pieceFall(setpieceB), blend);

  const dominant = (blend < 0.5) ? setpieceA : setpieceB;
  const name = "SECTOR 666: THE ABYSS — " + pieceName(dominant);

  return {
    loop, sector: 666, descent, setpieceA, setpieceB, blend,
    localZ, secLen, fallAmt, name
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
    const s = smoothstep(0.0, 10.0, state.localZ) * (1.0 - smoothstep(60.0, 70.0, state.localZ));
    return s * Math.sin(z * 0.08) * 1.8;
  }
  if (state.sector === 5) {
    // Elegant winding stair sway
    const t5 = state.localZ / state.secLen;
    return Math.sin(t5 * Math.PI * 3.0) * 3.5;
  }
  if (state.sector === 6) return 0.0;
  if (state.sector === 666) {
    return mix(pieceSway(state.setpieceA, z), pieceSway(state.setpieceB, z), state.blend);
  }
  return 0.0;
}

// Camera vertical layout height offset
export function getCamOffset(z: number): number {
  const state = getKinematicState(z);

  if (state.sector === 2) {
    if (state.localZ < 10.0) {
      return mix(1.8, 0.95, smoothstep(0.0, 10.0, state.localZ));
    } else if (state.localZ < 60.0) {
      return 0.95;
    } else {
      return mix(0.95, 1.0, smoothstep(60.0, 70.0, state.localZ));
    }
  }
  if (state.sector === 3) {
    return mix(1.0, 1.8, smoothstep(70.0, 80.0, state.localZ));
  }
  if (state.sector === 666) {
    return mix(pieceEye(state.setpieceA), pieceEye(state.setpieceB), state.blend);
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
    if (state.localZ < 52.0) {
      const stepSize = 3.25;
      const s = state.localZ / stepSize;
      const smoothStair = Math.floor(s) + smoothstep(0.6, 1.0, s - Math.floor(s));
      return -125.0 + smoothStair * 3.44;
    } else if (state.localZ < 72.0) {
      const tFall = (state.localZ - 52.0) / 20.0;
      return mix(-70.0, -180.0, tFall * tFall);
    } else {
      return -180.0;
    }
  }
  if (state.sector === 6) {
    const t = Math.max(0.0, Math.min(1.0, state.localZ / state.secLen));
    return mix(-180.0, 0.0, smoothstep(0.0, 1.0, t));
  }
  if (state.sector === 666) {
    let depth = mix(pieceDepth(state.setpieceA), pieceDepth(state.setpieceB), state.blend);
    // Entry blend from sector 5 exit floor (-180) into the abyss.
    depth = mix(-180.0, depth, smoothstep(0.0, 0.08, state.descent));
    // Loop closure: return floor to 0 for the next loop's sector 1, except the loop 3 finale.
    if (state.loop < 3) {
      depth = mix(depth, 0.0, smoothstep(0.80, 1.0, state.descent));
    }
    return depth;
  }
  return 0.0;
}

export function getCamY(z: number): number {
  return getFloorY(z);
}

// Determines the player's walking speed dynamically
export function getWalkSpeed(z: number): number {
  const state = getKinematicState(z);

  // Finale endless fall: decay speed but never reach zero.
  if (z >= 2000.0) {
    const zFinale = z - 2000.0;
    return Math.max(0.15, mix(8.0, 0.15, smoothstep(0.0, 250.0, zFinale)));
  }

  // Sector 5 Gravity Lab climbing: Super atmospheric crawling ascent, then collapse fall, then wading
  if (state.sector === 5) {
    if (state.localZ < 52.0) {
      return 1.6; // Slow crawl climbing
    } else if (state.localZ < 72.0) {
      return 18.0; // Rapid vertical fall velocity
    } else {
      return 3.5; // Slow water splashing wade
    }
  }

  if (state.sector === 666) {
    return mix(pieceSpeed(state.setpieceA), pieceSpeed(state.setpieceB), state.blend);
  }

  return 8.2; // standard speed
}
