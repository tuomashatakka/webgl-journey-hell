export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function mix(start: number, end: number, t: number): number {
  return start * (1.0 - t) + end * t;
}

export function getSectorScale(sec: number, it: number): number {
  const hash1d = (x: number) => {
    const h = Math.sin(x * 12.9898) * 43758.5453123;
    return h - Math.floor(h);
  };
  const seed = sec * 11.37 + Math.floor(it) * 17.81;
  const scaleCurrent = mix(0.67, 2.0, hash1d(seed));
  const scaleNext = mix(0.67, 2.0, hash1d(seed + 17.81));
  const f = it - Math.floor(it);
  return mix(scaleCurrent, scaleNext, f);
}

export function getWarpedMZ(
  mz: number,
  s1: number,
  s2: number,
  s3: number,
  s4: number,
  s5: number,
  s6: number
): number {
  const w1 = 30.0 * s1;
  const w2 = 40.0 * s2;
  const w3 = 50.0 * s3;
  const w4 = 70.0 * s4;
  const w5 = 80.0 * s5;
  const w6 = 30.0 * s6;
  const sum = w1 + w2 + w3 + w4 + w5 + w6;

  const wb1 = 300.0 * (w1 / sum);
  const wb2 = wb1 + 300.0 * (w2 / sum);
  const wb3 = wb2 + 300.0 * (w3 / sum);
  const wb4 = wb3 + 300.0 * (w4 / sum);
  const wb5 = wb4 + 300.0 * (w5 / sum);

  if (mz < wb1) {
    return (mz / wb1) * 30.0;
  } else if (mz < wb2) {
    return 30.0 + ((mz - wb1) / (wb2 - wb1)) * 40.0;
  } else if (mz < wb3) {
    return 70.0 + ((mz - wb2) / (wb3 - wb2)) * 50.0;
  } else if (mz < wb4) {
    return 120.0 + ((mz - wb3) / (wb4 - wb3)) * 70.0;
  } else if (mz < wb5) {
    return 190.0 + ((mz - wb4) / (wb5 - wb4)) * 80.0;
  } else {
    return 270.0 + ((mz - wb5) / (300.0 - wb5)) * 30.0;
  }
}

export function getWarpedZ(z: number, it: number): number {
  const mz = z % 300.0;
  const s1 = getSectorScale(1, it);
  const s2 = getSectorScale(2, it);
  const s3 = getSectorScale(3, it);
  const s4 = getSectorScale(4, it);
  const s5 = getSectorScale(5, it);
  const s6 = getSectorScale(6, it);
  const wmz = getWarpedMZ(mz, s1, s2, s3, s4, s5, s6);
  return Math.floor(z / 300.0) * 300.0 + wmz;
}

export function getCamX(z: number, it: number): number {
  const wz = getWarpedZ(z, it);
  const mz = wz % 300.0;
  
  const is666 = Math.floor(it) === 2;
  if (is666) {
    return Math.sin(wz * 0.06) * 3.5;
  }

  if (mz < 30.0) return 0.0;
  if (mz < 70.0) {
    const s = smoothstep(30.0, 33.0, mz) * (1.0 - smoothstep(67.0, 70.0, mz));
    return s * Math.sin(wz * 0.15) * 4.0;
  }
  if (mz < 120.0) {
    const s = smoothstep(70.0, 75.0, mz) * (1.0 - smoothstep(115.0, 120.0, mz));
    return s * Math.sin(wz * 0.4) * 1.5;
  }
  if (mz < 190.0) {
    return Math.sin(wz * 0.08) * 2.0;
  }
  if (mz < 270.0) {
    // Math matching the broken stairs detour in the shader
    if (mz >= 230.0) {
      const t_det = (mz - 230.0) / 40.0;
      return Math.sin(t_det * 3.14159 * 2.5) * 6.5 + Math.sin(wz * 0.1) * 2.0;
    }
    const t5 = (mz - 190.0) / 80.0;
    return Math.sin(t5 * 3.14159265 * 3.0) * 4.0;
  }
  return 0.0;
}

export function getCamOffset(z: number, it: number): number {
  const wz = getWarpedZ(z, it);
  const mz = wz % 300.0;
  
  const is666 = Math.floor(it) === 2;
  if (is666) {
    return 1.8;
  }

  if (mz >= 30.0 && mz < 70.0) {
    const s = smoothstep(30.0, 35.0, mz) * (1.0 - smoothstep(65.0, 70.0, mz));
    return 1.8 * (1.0 - s) + 1.0 * s;
  }
  if (mz >= 70.0 && mz < 120.0) {
    return 1.0;
  }
  return 1.8;
}

export function getFloorY(z: number, it: number): number {
  const wz = getWarpedZ(z, it);
  const mz = wz % 300.0;
  
  const is666 = Math.floor(it) === 2;
  if (is666) {
    return -60.0 + Math.sin(wz * 0.08) * 4.0;
  }

  if (mz < 30.0) return 0.0;
  if (mz < 70.0) {
    const t = (mz - 30.0) / 40.0;
    return mix(0.0, -25.0, t * t * (3 - 2 * t));
  }
  if (mz < 120.0) {
    const t = (mz - 70.0) / 50.0;
    return mix(-25.0, -125.0, t * t * (3 - 2 * t));
  }
  if (mz < 190.0) {
    const t_bridge = (mz - 120.0) / 70.0;
    const bridgeArc = Math.sin(t_bridge * 3.14159265) * 8.0;
    return -125.0 + bridgeArc;
  }
  if (mz < 270.0) {
    // Match the stairs collapse mechanics
    if (mz >= 230.0) {
      const drop = smoothstep(230.0, 234.0, mz);
      const startY = -125.0 + ((230.0 - 190.0) / 1.6) * 2.5; 
      const collapsedBaseY = -120.0;

      if (mz >= 234.0) {
        const t_det = mz - 234.0;
        const s_det = t_det / 1.25;
        const smoothDet = Math.floor(s_det) + smoothstep(0.5, 0.9, fract(s_det));
        const detYRise = smoothDet * 4.1667; 
        return collapsedBaseY + detYRise;
      }
      return mix(startY, collapsedBaseY, drop);
    }

    const t = mz - 190.0;
    const stepSize = 1.6;
    const s = t / stepSize;
    const smoothStair = floor(s) + smoothstep(0.6, 1.0, fract(s));
    return -125.0 + smoothStair * 2.5;
  }
  
  // Every second time (e.g. uIteration % 2.0 is around 1.0), free fall Y plunge
  const isChaosLoop = Math.floor(it + 0.1) % 2 === 1;
  if (isChaosLoop) {
    const dropAmount = smoothstep(270.0, 300.0, mz);
    return mix(0.0, -320.0, dropAmount * dropAmount);
  }
  return 0.0;
}

export function getCamY(z: number, it: number): number {
  const wz = getWarpedZ(z, it);
  const mz = wz % 300.0;
  
  const is666 = Math.floor(it) === 2;
  if (is666) {
    return -60.0 + Math.sin(wz * 0.08) * 4.0;
  }

  if (mz < 30.0) return 0.0;
  if (mz < 70.0) {
    const t = (mz - 30.0) / 40.0;
    return mix(0.0, -25.0, t * t * (3 - 2 * t));
  }
  if (mz < 120.0) {
    const t = (mz - 70.0) / 50.0;
    return mix(-25.0, -125.0, t * t * (3 - 2 * t));
  }
  if (mz < 190.0) {
    const t_bridge = (mz - 120.0) / 70.0;
    const bridgeArc = Math.sin(t_bridge * 3.14159265) * 8.0;
    return -125.0 + bridgeArc;
  }
  if (mz < 270.0) {
    if (mz >= 230.0) {
      const drop = smoothstep(230.0, 234.0, mz);
      const startY = -125.0 + ((230.0 - 190.0) / 80.0) * 125.0; 
      const collapsedBaseY = -120.0;

      if (mz >= 234.0) {
        const t_det = mz - 234.0;
        return collapsedBaseY + (t_det / 36.0) * 120.0; 
      }
      return mix(startY, collapsedBaseY, drop);
    }
    const t = mz - 190.0;
    return -125.0 + (t / 80.0) * 125.0;
  }
  
  // Plunge Y on Chaos free fall Sector 6
  const isChaosLoop = Math.floor(it + 0.1) % 2 === 1;
  if (isChaosLoop) {
    const dropAmount = smoothstep(270.0, 300.0, mz);
    return mix(0.0, -320.0, dropAmount * dropAmount);
  }
  return 0.0;
}

function floor(x: number): number {
  return Math.floor(x);
}

function fract(x: number): number {
  return x - Math.floor(x);
}
