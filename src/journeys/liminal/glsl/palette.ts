import { SD_BOX } from '@wjh/glsl/sdf'


export const paletteGlsl = `    // Domain-warped ridged noise tightened into thin glowing veins.
    float veinField(vec3 p, float t) {
        float n = sin(p.x * 0.7 + sin(p.z * 0.4 + t * 0.6)) * cos(p.z * 0.6 - t * 0.3)
                + 0.5 * sin(p.y * 0.9 + p.x * 0.3);
        float ridge = pow(clamp(1.0 - abs(n), 0.0, 1.0), 6.0);
        return ridge;
    }

    vec3 abyssEmissive(vec3 p, float t, float intensity) {
        float v = veinField(p, t);
        return mix(VEIN_DIM, VEIN_HOT, v) * v * (0.7 + 0.3 * sin(t * 2.0 + p.z * 0.2)) * intensity;
    }

    // Per-piece albedo tint (all within the oxblood family).
    vec3 pieceTint(float id) {
        if (id == 1.0) return vec3(1.15, 0.85, 0.7);  // hotter embers
        if (id == 2.0) return vec3(0.9, 0.85, 0.9);   // ashen-cool but dark
        if (id == 3.0) return vec3(1.2, 0.6, 0.6);    // fleshy
        if (id == 4.0) return vec3(0.85, 0.8, 0.82);  // ashen-cool
        if (id == 5.0) return vec3(1.15, 0.8, 0.7);   // hotter embers
        if (id == 6.0) return vec3(1.0, 0.85, 0.8);
        if (id == 7.0) return vec3(1.1, 0.7, 0.7);    // fleshy entropy
        if (id == 8.0) return vec3(1.0, 0.9, 0.85);
        if (id == 9.0) return vec3(1.3, 0.55, 0.5);   // max vein void
        return vec3(1.0);
    }

    // Per-piece base vein intensity.
    float pieceVeinInt(float id) {
        if (id == 1.0) return 1.1;
        if (id == 2.0) return 0.45;
        if (id == 3.0) return 1.2;
        if (id == 4.0) return 0.55;
        if (id == 5.0) return 1.1;
        if (id == 6.0) return 0.7;
        if (id == 7.0) return 1.0;
        if (id == 8.0) return 0.65;
        if (id == 9.0) return 0.5;
        return 0.8;
    }

    vec2 opU(vec2 d1, vec2 d2) {
        return (d1.x < d2.x) ? d1 : d2;
    }

    vec3 rotX(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    }
    vec3 rotY(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    }
    vec3 rotZ(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
    }

    ${SD_BOX}

    // Narrow staircase SDF for M.C. Escher gravity labyrinth
    float sdNarrowStaircase(vec3 p) {
        float stepH = 0.35;
        float stepD = 0.45;
        float stepW = 1.1; // narrow track
        
        // Simple step repeating along Z and climbing along Y
        float stepIdx = floor(p.z / stepD + 0.5);
        vec3 stepCenter = vec3(0.0, stepIdx * stepH, stepIdx * stepD);
        vec3 dStepBox = abs(p - stepCenter) - vec3(stepW, stepH * 0.52, stepD * 0.52);
        float dSteps = length(max(dStepBox, 0.0)) + min(max(dStepBox.x, max(dStepBox.y, dStepBox.z)), 0.0);
        
        // Slanted backing support beam
        vec3 rP = rotX(p, -0.66); // approx slant angle matching stepH/stepD
        vec3 dBeamBox = abs(rP - vec3(0.0, -0.28, 0.0)) - vec3(stepW * 0.85, 0.18, 50.0);
        float dBeam = length(max(dBeamBox, 0.0)) + min(max(dBeamBox.x, max(dBeamBox.y, dBeamBox.z)), 0.0);
        
        return min(dSteps, dBeam);
    }

    // Biome Color Logic
    vec3 getBiomeColor(float z) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);
        
        if (sector == 666.0) {
            // Oxblood abyss: near-black rock laced with slowly pulsing red veins.
            vec3 base = mix(ABYSS_ROCK, ABYSS_DEEP, descent);
            vec3 vein = mix(VEIN_DIM, VEIN_HOT, 0.5 + 0.5 * sin(z * 0.08 + iTime * 1.5));
            float veinW = 0.18 + 0.12 * abs(sin(z * 0.1 + iTime * 1.2));
            return base + vein * veinW * (0.6 + 0.4 * descent);
        }

        vec3 c1 = vec3(0.85, 0.90, 0.95); // White Tile Pools
        vec3 c2 = vec3(0.02, 0.15, 0.22); // Abyssal Teal
        vec3 c3 = vec3(0.75, 0.03, 0.06); // Muscle Flesh Red
        vec3 c4 = vec3(0.05, 0.22, 0.14); // Emerald Reservoir
        vec3 c5 = vec3(0.85, 0.50, 0.10); // Hogwarts Twilight Orange
        vec3 c6 = vec3(0.85, 0.90, 0.95); // Gray Corridor

        vec3 baseCol = c1;
        if (sector == 1.0) baseCol = c1;
        else if (sector == 2.0) baseCol = mix(c1, c2, localZ / secLen);
        else if (sector == 3.0) baseCol = mix(c2, c3, localZ / secLen);
        else if (sector == 4.0) baseCol = mix(c3, c4, localZ / secLen);
        else if (sector == 5.0) baseCol = mix(c4, c5, localZ / secLen);
        else if (sector == 6.0) baseCol = mix(c5, c6, localZ / secLen);
        
        // Environmental decay multiplier
        float decayWeight = clamp(loop * 0.18, 0.0, 0.9);
        vec3 hellBase = vec3(0.35, 0.01, 0.02);
        return mix(baseCol, hellBase, decayWeight);
    }

    // ---- SECTOR 666 setpiece SDFs ----
    // Convention: positive = empty (traversable) space, surface at zero. Returns vec2(dist, matID).

`
