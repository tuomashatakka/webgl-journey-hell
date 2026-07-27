export const vsQuad = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`

export const fsScene = `
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform float uIteration;
    uniform vec2 uPointer;
    uniform float uPlayerZ;
    uniform float uHeavy;

    #define MAX_STEPS 120
    #define MAX_DIST 150.0
    #define SURF_DIST 0.01

    // Material IDs
    #define MAT_MATTE 1.0
    #define MAT_WATER 2.0
    #define MAT_GLASS 3.0
    #define MAT_FLESH 4.0

    // Random noise generator
    float hash1d(float x) {
        return fract(sin(x * 12.9898) * 43758.5453123);
    }

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // Procedural glowing crevices
    float getFloorCrack(vec3 p, float local_z, float it) {
        float decayFactor = clamp(it * 0.15, 0.0, 0.95);
        if (decayFactor < 0.05) return 0.0;
        float cNoise = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
        float crackLine = abs(cNoise);
        float crackWidth = mix(0.005, 0.12, decayFactor);
        float crackEdge = smoothstep(crackWidth, 0.0, crackLine);
        float crackMask = smoothstep(0.1, 0.5, sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + decayFactor * 0.35);
        return crackEdge * crackMask * decayFactor;
    }

    // Smoothstep helper
    float smoothstep_custom(float edge0, float edge1, float x) {
        float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    vec3 smoothstep_custom(float edge0, float edge1, vec3 x) {
        vec3 t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    // ---- Sector 666 keyframe tables (identical literals to kinematics.ts) ----
    #define PIECE_W 0.28

    float pieceCount(float loop) {
        if (loop == 1.0) return 3.0;
        if (loop == 2.0) return 5.0;
        return 8.0; // loop >= 3
    }

    float pieceAt(float loop, float k) {
        float count = pieceCount(loop);
        float idx = clamp(floor(k), 0.0, count - 1.0);
        if (loop == 1.0) {
            if (idx < 0.5) return 1.0;
            if (idx < 1.5) return 2.0;
            return 8.0;
        }
        if (loop == 2.0) {
            if (idx < 0.5) return 1.0;
            if (idx < 1.5) return 2.0;
            if (idx < 2.5) return 3.0;
            if (idx < 3.5) return 4.0;
            return 8.0;
        }
        // loop >= 3: [1,2,3,4,5,6,7,9]
        if (idx < 0.5) return 1.0;
        if (idx < 1.5) return 2.0;
        if (idx < 2.5) return 3.0;
        if (idx < 3.5) return 4.0;
        if (idx < 4.5) return 5.0;
        if (idx < 5.5) return 6.0;
        if (idx < 6.5) return 7.0;
        return 9.0;
    }

    float pieceDepth(float id) {
        if (id == 1.0) return -15.0;
        if (id == 2.0) return -28.0;
        if (id == 3.0) return -45.0;
        if (id == 4.0) return -55.0;
        if (id == 5.0) return -62.0;
        if (id == 6.0) return -110.0;
        if (id == 7.0) return -180.0;
        if (id == 8.0) return -30.0;
        if (id == 9.0) return -350.0;
        return -30.0;
    }

    float pieceEye(float id) {
        if (id == 1.0) return 0.45;
        if (id == 2.0) return 1.8;
        if (id == 3.0) return 1.6;
        if (id == 4.0) return 0.42;
        if (id == 5.0) return 1.35;
        if (id == 6.0) return 1.75;
        if (id == 7.0) return 1.8;
        if (id == 8.0) return 1.6;
        if (id == 9.0) return 1.2;
        return 1.8;
    }

    float pieceFall(float id) {
        if (id == 1.0) return 0.85;
        if (id == 6.0) return 0.6;
        if (id == 7.0) return 0.9;
        if (id == 9.0) return 1.0;
        return 0.0;
    }

    float pieceSway(float id, float z) {
        if (id == 1.0) return sin(z * 0.15) * 1.8;
        if (id == 5.0) return sin(z * 0.6) * 0.6;
        if (id == 6.0) return sin(z * 0.08) * 2.2;
        if (id == 7.0) return sin(z * 0.4) * 0.8;
        if (id == 9.0) return sin(z * 0.05) * 1.2;
        return sin(z * 0.1) * 0.6;
    }

    // Core analytical segment lookup generator in 100% sync with TS kinematics
    void getSegmentData(float z, out float loop, out float sector, out float descent, out float setpieceA, out float setpieceB, out float blend, out float localZ, out float secLen, out float fallAmt, out float isCrystal) {
        if (z >= 2000.0) { // Endless fall (THE ABYSS) at the end of Loop 3
            loop = 3.0;
            sector = 666.0;
            descent = 1.0;
            setpieceA = 9.0;
            setpieceB = 9.0;
            blend = 0.0;
            localZ = z - 2000.0;
            secLen = 1000000.0;
            fallAmt = 1.0 - smoothstep_custom(0.0, 200.0, z - 2000.0) * 0.85;
            isCrystal = 0.0;
            return;
        }

        loop = floor(z / 500.0);
        float lz = mod(z, 500.0);
        descent = 0.0;
        setpieceA = 0.0;
        setpieceB = 0.0;
        blend = 0.0;
        fallAmt = 0.0;
        isCrystal = 0.0;

        if (lz < 60.0) {
            sector = 1.0; localZ = lz; secLen = 60.0;
        } else if (lz < 130.0) {
            sector = 2.0; localZ = lz - 60.0; secLen = 70.0;
        } else if (lz < 210.0) {
            sector = 3.0; localZ = lz - 130.0; secLen = 80.0;
        } else if (lz < 280.0) {
            sector = 4.0; localZ = lz - 210.0; secLen = 70.0;
        } else if (lz < 360.0) {
            sector = 5.0; localZ = lz - 280.0; secLen = 80.0;
        } else {
            // Sector 6 / 666 Transition (lz 360..500)
            localZ = lz - 360.0;
            secLen = 140.0;
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                // Continuous setpiece cross-fade model
                descent = localZ / 140.0;
                float N = pieceCount(loop);
                float slotF = descent * N;
                float slot = floor(slotF);
                float frac = slotF - slot;
                setpieceA = pieceAt(loop, slot);
                setpieceB = pieceAt(loop, min(slot + 1.0, N - 1.0));
                blend = smoothstep_custom(1.0 - PIECE_W, 1.0, frac);
                fallAmt = mix(pieceFall(setpieceA), pieceFall(setpieceB), blend);
            }
        }
    }

    // Calculates camera horizontal shift
    float getCamX(float z) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        if (sector == 1.0) return 0.0;
        if (sector == 2.0) {
            float s = smoothstep_custom(5.0, 15.0, localZ) * (1.0 - smoothstep_custom(55.0, 65.0, localZ));
            return s * sin(z * 0.15) * 4.0;
        }
        if (sector == 3.0) {
            float s = smoothstep_custom(0.0, 5.0, localZ) * (1.0 - smoothstep_custom(75.0, 80.0, localZ));
            return s * sin(z * 0.4) * 1.5;
        }
        if (sector == 4.0) {
            float s = smoothstep_custom(0.0, 10.0, localZ) * (1.0 - smoothstep_custom(60.0, 70.0, localZ));
            return s * sin(z * 0.08) * 1.8;
        }
        if (sector == 5.0) {
            float t5 = localZ / secLen;
            return sin(t5 * 3.14159265 * 3.0) * 3.5;
        }
        if (sector == 6.0) return 0.0;
        if (sector == 666.0) {
            return mix(pieceSway(setpieceA, z), pieceSway(setpieceB, z), blend);
        }
        return 0.0;
    }

    // Camera height offsets
    float getCamOffset(float z) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        if (sector == 2.0) {
            if (localZ < 10.0) {
                return mix(1.8, 0.95, smoothstep_custom(0.0, 10.0, localZ));
            } else if (localZ < 60.0) {
                return 0.95;
            } else {
                return mix(0.95, 1.0, smoothstep_custom(60.0, 70.0, localZ));
            }
        }
        if (sector == 3.0) {
            return mix(1.0, 1.8, smoothstep_custom(70.0, 80.0, localZ));
        }
        if (sector == 666.0) {
            return mix(pieceEye(setpieceA), pieceEye(setpieceB), blend);
        }
        return 1.8;
    }

    // Absolute floor elevation
    float getFloorY(float z) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        if (sector == 1.0) return 0.0;
        if (sector == 2.0) {
            float t = localZ / secLen;
            return mix(0.0, -25.0, t * t * (3.0 - 2.0 * t));
        }
        if (sector == 3.0) {
            float t = localZ / secLen;
            return mix(-25.0, -125.0, t * t * (3.0 - 2.0 * t));
        }
        if (sector == 4.0) {
            float t = localZ / secLen;
            float bridgeArc = sin(t * 3.14159265) * 7.5;
            return -125.0 + bridgeArc;
        }
        if (sector == 5.0) {
            if (localZ < 52.0) {
                float stepSize = 3.25;
                float s = localZ / stepSize;
                float smoothStair = floor(s) + smoothstep_custom(0.6, 1.0, fract(s));
                return -125.0 + smoothStair * 3.44;
            } else if (localZ < 72.0) {
                float tFall = (localZ - 52.0) / 20.0;
                return mix(-70.0, -180.0, tFall * tFall);
            } else {
                return -180.0;
            }
        }
        if (sector == 6.0) {
            float t = clamp(localZ / secLen, 0.0, 1.0);
            return mix(-180.0, 0.0, smoothstep_custom(0.0, 1.0, t));
        }
        if (sector == 666.0) {
            float depth = mix(pieceDepth(setpieceA), pieceDepth(setpieceB), blend);
            // Entry blend from sector 5 exit floor (-180) into the abyss.
            depth = mix(-180.0, depth, smoothstep_custom(0.0, 0.08, descent));
            // Loop closure: return floor to 0 for next loop's sector 1, except the loop 3 finale.
            if (loop < 3.0) {
                depth = mix(depth, 0.0, smoothstep_custom(0.80, 1.0, descent));
            }
            return depth;
        }
        return 0.0;
    }

    float getCamY(float z) {
        return getFloorY(z);
    }

    // ---- SECTOR 666 OXBLOOD ABYSS PALETTE ----
    #define ABYSS_ROCK vec3(0.05, 0.02, 0.02)
    #define ABYSS_DEEP vec3(0.10, 0.015, 0.02)
    #define VEIN_HOT vec3(1.0, 0.28, 0.05)
    #define VEIN_DIM vec3(0.5, 0.04, 0.02)
    #define SMOKE_RED vec3(0.18, 0.03, 0.03)

    // Polynomial smooth-min for cross-fading SDF setpieces.
    float smin(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
        return mix(b, a, h) - k * h * (1.0 - h);
    }

    // Domain-warped ridged noise tightened into thin glowing veins.
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

    float sdBox(vec3 p, vec3 b) {
        vec3 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }

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

    vec2 sp1_barbed(vec3 p, float fY, float cX, float localZ, float it) {
        // Burning twigs & barbed-wire crawl slide
        vec2 tun = p.xy - vec2(cX, fY + 0.3);
        float cave = 1.35 - length(tun);
        vec3 cp = p;
        float angle = cp.z * 1.5 + it * 2.5;
        cp.xy = vec2(cp.x * cos(angle) - cp.y * sin(angle), cp.x * sin(angle) + cp.y * cos(angle));
        float wire = length(abs(cp.xy) - vec2(0.85, 0.85)) - 0.035;
        wire += sin(cp.z * 18.0) * 0.02 * cos(cp.z * 6.0);
        float twig = length(cp.xy) - 1.25 + 0.28 * sin(cp.z * 7.0) * cos(cp.z * 4.5);
        float dSlide = min(min(cave, wire), twig);
        float mat = MAT_FLESH;
        if (wire < cave && wire < twig) mat = MAT_MATTE;
        return vec2(dSlide, mat);
    }

    vec2 sp2_tundra(vec3 p, float fY, float cX, float localZ, float it) {
        // Cold ashen tundra & shadow creatures
        float dTundraPlain = p.y - (fY - 2.5);
        float hills = sin(p.x * 0.04) * cos(p.z * 0.04) * 3.5;
        dTundraPlain -= hills;
        vec3 sp = p;
        sp.z = mod(sp.z + 18.0, 36.0) - 18.0;
        sp.x = abs(sp.x) - 13.0;
        float dCreature = length(sp - vec3(0.0, fY + 1.0 + sin(it * 2.5) * 0.4, 0.0)) - (0.95 + 0.45 * sin(it * 14.0) * cos(p.y * 3.0));
        float dBase = min(dTundraPlain, dCreature);
        float mat = MAT_MATTE;
        if (dCreature < dTundraPlain) mat = MAT_GLASS;
        return vec2(dBase, mat);
    }

    vec2 sp3_womb(vec3 p, float fY, float cX, float localZ, float it) {
        // Throbbing womb: visceral pulsating cave
        vec2 tun = p.xy - vec2(cX, fY + 1.8);
        float rCorridor = 3.6 + sin(p.z * 0.28 + it * 4.2) * 0.48;
        float womb = rCorridor - length(tun);
        float nodes = sin(p.x * 2.2) * sin(p.y * 2.2) * cos(p.z * 2.2) * 0.48;
        womb -= nodes;
        return vec2(womb, MAT_FLESH);
    }

    vec2 sp4_citadel(vec3 p, float fY, float cX, float localZ, float it) {
        // Crushing citadel gravity crawl
        float dFloor = p.y - fY;
        float dCeil = (fY + 1.35 + sin(p.z * 0.08) * 0.35) - p.y;
        vec3 rpCol = p;
        rpCol.z = mod(p.z + 5.0, 10.0) - 5.0;
        float dCol = length(abs(rpCol.xz) - vec2(3.2, 0.0)) - 0.75;
        float dCitadel = min(min(dFloor, dCeil), dCol);
        return vec2(dCitadel, MAT_MATTE);
    }

    vec2 sp5_grinder(vec3 p, float fY, float cX, float localZ, float it) {
        // The meat grinder: buzzsaws & pistons
        float dFloorLab = p.y - fY;
        float dCeilLab = (fY + 7.0) - p.y;
        float dWallsLab = 6.0 - abs(p.x);
        float dGrinder = min(dFloorLab, min(dCeilLab, dWallsLab));
        vec3 rpPiston = p;
        rpPiston.z = mod(p.z + 10.0, 20.0) - 10.0;
        float pistonCycle = abs(sin(it * 3.8 + p.z * 0.18)) * 3.6;
        float dPiston = sdBox(rpPiston - vec3(0.0, fY + 6.0 - pistonCycle, 0.0), vec3(1.6, 2.8, 1.6));
        vec3 rpSaw = p;
        rpSaw.z = mod(rpSaw.z + 8.0, 16.0) - 8.0;
        rpSaw.x = abs(rpSaw.x) - 4.0;
        float sAngle = it * 22.0;
        vec2 rotatedCoord = vec2(rpSaw.y * cos(sAngle) - rpSaw.z * sin(sAngle), rpSaw.y * sin(sAngle) + rpSaw.z * cos(sAngle));
        float dSaw = sdBox(vec3(rpSaw.x, rotatedCoord.x, rotatedCoord.y), vec3(0.1, 2.4, 2.4));
        float dTotal = min(dGrinder, min(dPiston, dSaw));
        float mat = MAT_MATTE;
        if (dPiston < dGrinder && dPiston < dSaw) mat = MAT_FLESH;
        return vec2(dTotal, mat);
    }

    vec2 sp6_spiral(vec3 p, float fY, float cX, float localZ, float it) {
        // The spiral stone bridge downwards
        float shaftRad = 9.5;
        float dShaft = shaftRad - length(p.xz - vec2(cX, 0.0));
        float pStep = (p.y - (fY)) / -5.0;
        float pCell = floor(pStep);
        float stepAngle = pCell * 0.45;
        float stepRad = 5.2;
        vec3 platformPos = vec3(cX + stepRad * cos(stepAngle), fY - pCell * 5.0, stepRad * sin(stepAngle));
        float dPlatform = sdBox(p - platformPos, vec3(1.6, 0.35, 1.95));
        float dSpiral = min(dShaft, dPlatform);
        return vec2(dSpiral, MAT_MATTE);
    }

    vec2 sp7_entropy(vec3 p, float fY, float cX, float localZ, float it) {
        // Signal entropy & light leaks: disintegrating cave geometry
        float dFloorCorr = p.y - fY;
        float hills = sin(p.x * 0.2) * cos(p.z * 0.2) * 1.5;
        dFloorCorr -= hills;
        float glitches = sin(p.x * 24.0 + it * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) * 0.35;
        dFloorCorr += glitches;
        vec3 qBox = p;
        qBox.xz = mod(p.xz + 6.0, 12.0) - 6.0;
        float dSpikes = length(qBox - vec3(0.0, fY + 3.0, 0.0)) - (1.0 + 1.2 * sin(it * 12.0));
        float dEntropy = min(dFloorCorr, dSpikes);
        return vec2(dEntropy, MAT_GLASS);
    }

    vec2 sp8_recovery(vec3 p, float fY, float cX, float localZ, float it) {
        // The recovery chamber: concrete monoliths & a pulsing core
        float dFloorChamber = p.y - fY;
        float dCeilChamber = (fY + 8.5) - p.y;
        float dWallsChamber = 10.0 - abs(p.x);
        float dRecoveryChamber = min(dFloorChamber, min(dCeilChamber, dWallsChamber));
        vec3 rCh = p;
        rCh.z = mod(p.z + 8.0, 16.0) - 8.0;
        float arches = length(vec2(abs(rCh.x) - 10.0, p.y - fY - 4.2)) - 1.5;
        dRecoveryChamber = min(dRecoveryChamber, arches);
        vec3 bioP = p - vec3(0.0, fY + 3.0, p.z - localZ + 16.0);
        float dCore = length(bioP) - 3.0 + sin(it * 3.5) * 0.22;
        float dFinal = min(dRecoveryChamber, dCore);
        float mat = MAT_MATTE;
        if (dCore < dRecoveryChamber) mat = MAT_FLESH;
        return vec2(dFinal, mat);
    }

    vec2 sp9_void(vec3 p, float fY, float cX, float localZ, float it) {
        // THE ABYSS: an open, dark rocky floor laced with glowing veins; vast empty void above.
        float hills = sin(p.x * 0.06) * cos(p.z * 0.05) * 4.0
                    + sin(p.x * 0.19 + p.z * 0.11) * 1.3;
        float ground = p.y - (fY + hills);
        // shallow grooves carved where the lava-blood veins run
        ground += veinField(p, it * 0.4) * 0.35;
        // distant jagged ridges far out on the sides keep the centre + upper view open
        float wall = abs(p.x) - 52.0;
        float cap = (fY + 16.0 + sin(p.z * 0.07 + it * 0.2) * 7.0) - p.y;
        float dRidge = max(wall, cap);
        float d = min(ground, dRidge);
        return vec2(d, MAT_MATTE);
    }

    vec2 evalPiece(float id, vec3 p, float fY, float cX, float localZ) {
        if (id == 1.0) return sp1_barbed(p, fY, cX, localZ, iTime);
        if (id == 2.0) return sp2_tundra(p, fY, cX, localZ, iTime);
        if (id == 3.0) return sp3_womb(p, fY, cX, localZ, iTime);
        if (id == 4.0) return sp4_citadel(p, fY, cX, localZ, iTime);
        if (id == 5.0) return sp5_grinder(p, fY, cX, localZ, iTime);
        if (id == 6.0) return sp6_spiral(p, fY, cX, localZ, iTime);
        if (id == 7.0) return sp7_entropy(p, fY, cX, localZ, iTime);
        if (id == 8.0) return sp8_recovery(p, fY, cX, localZ, iTime);
        return sp9_void(p, fY, cX, localZ, iTime);
    }

    // Signed Distance Field Map
    vec2 map(vec3 p, float ignoreWater) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(p.z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        float currentZ = mod(p.z, 500.0);
        float fY = getFloorY(p.z);
        
        float smoothLoop = loop;
        if (sector == 6.0 && currentZ > 400.0) {
            smoothLoop = loop + smoothstep_custom(400.0, 500.0, currentZ);
        }

        float decayFactor = clamp(smoothLoop * 0.15, 0.0, 0.95);
        float cFactor = 1.0 - clamp(smoothLoop * 0.14, 0.0, 0.72);

        // Squeezing/bending corridors on higher decay iterations
        if (sector < 666.0) {
            float twist = sin(p.z * 0.065 + iTime * 2.0) * (smoothLoop * 0.35);
            p.x += twist * (1.0 - cFactor);
        }

        if (decayFactor > 0.01) {
            float warpX = sin(p.z * 1.8 + iTime * 2.0) * cos(p.y * 1.5) * 0.55 * decayFactor;
            float warpY = cos(p.x * 1.6 + iTime * 1.5) * sin(p.z * 1.2) * 0.45 * decayFactor;
            float warpHigh = sin(p.z * 8.0) * cos(p.y * 8.0) * sin(p.x * 8.0) * 0.08 * decayFactor;
            p.x += warpX + warpHigh;
            p.y += warpY + warpHigh;
        }

        float cX = getCamX(p.z);
        float cY = fY + getCamOffset(p.z);
        float dCamSafety = length(p.xy - vec2(cX, cY)) - 2.0;

        vec2 res = vec2(1000.0, MAT_MATTE);

        // SECTOR 666: THE ABYSS (continuous cross-faded setpieces)
        if (sector == 666.0) {
            vec2 dA = evalPiece(setpieceA, p, fY, cX, localZ);
            if (blend < 0.001) {
                res = dA;
                res.x = max(res.x, -dCamSafety);
                res.x *= 0.45;
                return res;
            }
            vec2 dB = evalPiece(setpieceB, p, fY, cX, localZ);
            float k = 1.5;
            float d = mix(smin(dA.x, dB.x, k), dB.x, blend);
            float mat = (blend < 0.5) ? dA.y : dB.y;
            res = vec2(d, mat);
            res.x = max(res.x, -dCamSafety);
            // tighter step scaling while blending to absorb non-Lipschitz error
            res.x *= 0.4;
            return res;
        }

        // --- SECTORS 1 & 2 (0 to 130) ---
        // Interpolate width and height
        float r_t = clamp((currentZ - 60.0) / 70.0, 0.0, 1.0);
        if (currentZ < 60.0) r_t = 0.0;
        float r_width = mix(12.0, 35.0, r_t) * cFactor;
        float r_ceilH = mix(7.0, 40.0, r_t) * mix(1.0, 0.45, 1.0 - cFactor);
        
        float dFloor = p.y - fY;
        float dCeil = (fY + r_ceilH) - p.y;
        float dWalls = r_width - abs(p.x);
        float dRoom12 = min(dFloor, min(dCeil, dWalls));

        vec3 q1 = p; q1.z = mod(q1.z + 3.0, 6.0) - 3.0; q1.x = abs(q1.x) - 4.5 * cFactor;
        float dCol1 = length(max(abs(vec2(q1.x, q1.z)) - 0.4, 0.0)) - 0.05;
        
        vec3 q2 = p; q2.z = mod(q2.z + 15.0, 30.0) - 15.0; q2.x = abs(q2.x) - 16.0 * cFactor;
        float dCol2 = length(q2.xz) - 3.0;
        
        float dSec1 = min(dRoom12, dCol1);
        float dSec2 = min(dRoom12, dCol2);
        
        float dBase = mix(dSec1, dSec2, smoothstep_custom(50.0, 70.0, currentZ));

        // Add glass slide for Sec 2
        float dSlideHull = 1000.0;
        if (currentZ > 60.0 && currentZ < 130.0) {
            float slide_x = cX;
            float slide_y = fY + 1.2;
            vec2 dSlideQ = vec2(p.x - slide_x, p.y - slide_y);
            dSlideHull = max(abs(length(dSlideQ) - 1.8) - 0.1, dSlideQ.y - 0.2);
            dBase = min(dBase, dSlideHull); 
        }

        // --- SECTOR 3: CRYSTAL CAVE (130 to 210) ---
        vec3 q3 = p; q3.x -= cX; q3.y -= cY;
        float cave = 6.0 - length(q3.xy - vec2(sin(q3.z * 0.1) * 3.0, cos(q3.z * 0.15) * 2.0));
        cave += sin(q3.x * 2.0) * sin(q3.y * 1.5) * sin(q3.z * 1.0) * 0.5;
        vec3 cp = q3; cp.x += sin(iTime * 0.5 + p.z) * 1.0; cp.y += cos(iTime * 0.4 + p.z) * 1.0;
        cp.xz = mod(cp.xz + 6.0, 12.0) - 6.0; cp.y = mod(cp.y + 4.0, 8.0) - 4.0;
        float crystal = (abs(cp.x) + abs(cp.y) + abs(cp.z)) - 0.8;
        float dSec3 = min(cave, crystal) * 0.6; // We use MAT_MATTE for cave, crystal handled below

        dBase = mix(dBase, dSec3, smoothstep_custom(115.0, 145.0, currentZ));

        // --- SECTOR 4: COGS & PNEUMATICS (210 to 280) ---
        vec3 q4 = p; q4.x -= cX; q4.y -= cY;
        vec3 q4m = q4; q4m.xz = mod(q4m.xz + 10.0, 20.0) - 10.0;
        
        float vCols = max(abs(q4m.x) - 1.8, max(abs(q4m.y) - 50.0, abs(q4m.z) - 1.8));
        float hB1 = max(abs(q4m.x) - 8.0, max(abs(q4m.y) - 0.3, abs(q4m.z + 8.0) - 0.3));
        float hB2 = max(abs(q4m.x) - 8.0, max(abs(q4m.y) - 0.3, abs(q4m.z - 8.0) - 0.3));
        float allCols = min(vCols, min(hB1, hB2));
        
        vec3 gA = q4m - vec3(0.0, 5.0, 0.0); gA.xy *= mat2(cos(iTime*1.2), -sin(iTime*1.2), sin(iTime*1.2), cos(iTime*1.2));
        float dGa = max(length(gA.xy) - (2.6 + sin(atan(gA.y, gA.x) * 16.0) * 0.3), abs(q4m.z) - 0.5);
        vec3 gB = q4m - vec3(-4.6, 5.0, 0.0); float tB = -iTime*1.95 + 0.1; gB.xy *= mat2(cos(tB), -sin(tB), sin(tB), cos(tB));
        float dGb = max(length(gB.xy) - (1.6 + sin(atan(gB.y, gB.x) * 10.0) * 0.2), abs(q4m.z) - 0.4);
        vec3 gC = q4m - vec3(4.6, 5.0, 0.0); gC.xy *= mat2(cos(tB), -sin(tB), sin(tB), cos(tB));
        float dGc = max(length(gC.xy) - (1.6 + sin(atan(gC.y, gC.x) * 10.0) * 0.2), abs(q4m.z) - 0.4);
        float gears = min(dGa, min(dGb, dGc));
        
        vec3 pA = q4m - vec3(sin(iTime*4.0)*3.5, -2.5, -2.0); float cA = max(abs(pA.x)-3.0, max(abs(pA.y)-0.4, abs(pA.z)-0.4));
        vec3 sB_= q4m - vec3(-4.0, 0.0, 2.0); float csB = max(abs(sB_.x)-0.6, max(abs(sB_.y)-2.2, abs(sB_.z)-0.6));
        vec3 rB_= q4m - vec3(-4.0, sin(iTime*3.0)*2.0, 2.0); float crB = max(abs(rB_.x)-0.35, max(abs(rB_.y)-2.0, abs(rB_.z)-0.35));
        vec3 sC_= q4m - vec3(4.0, 0.0, 2.0); float csC = max(abs(sC_.x)-0.6, max(abs(sC_.y)-2.2, abs(sC_.z)-0.6));
        vec3 rC_= q4m - vec3(4.0, cos(iTime*3.0)*2.0, 2.0); float crC = max(abs(rC_.x)-0.35, max(abs(rC_.y)-2.0, abs(rC_.z)-0.35));
        float pneumatics = min(cA, min(min(csB, crB), min(csC, crC)));
        
        float dSec4 = min(p.y - (fY - 1.0), min(allCols, min(gears, pneumatics)) * 0.4);
        dBase = mix(dBase, dSec4, smoothstep_custom(200.0, 220.0, currentZ));

        // --- SECTOR 5: VOID BASIS LABYRINTH (280 to 430) ---
        vec3 q5 = p; q5.x -= cX;
        float dMainStair = max(abs(q5.x) - 2.5 * cFactor, abs(q5.y - fY) - 0.45);
        
        vec3 lq = q5;
        lq.yz = mat2(cos(sin(q5.x*0.015)*0.5), -sin(sin(q5.x*0.015)*0.5), sin(sin(q5.x*0.015)*0.5), cos(sin(q5.x*0.015)*0.5)) * lq.yz;
        lq.zx = mat2(cos(cos(q5.y*0.015)*0.5), -sin(cos(q5.y*0.015)*0.5), sin(cos(q5.y*0.015)*0.5), cos(cos(q5.y*0.015)*0.5)) * lq.zx;
        lq = mod(lq + 10.0, 20.0) - 10.0;
        
        float block = max(max(abs(lq.x)-10.0, abs(lq.y)-10.0), abs(lq.z)-10.0);
        float inner = max(max(abs(lq.x)-9.0, abs(lq.y)-9.0), abs(lq.z)-9.0);
        block = max(block, -inner);
        float doorX = max(max(abs(lq.x)-11.0, abs(lq.y)-5.0), abs(lq.z)-5.0);
        float doorY = max(max(abs(lq.x)-5.0, abs(lq.y)-11.0), abs(lq.z)-5.0);
        float doorZ = max(max(abs(lq.x)-5.0, abs(lq.y)-5.0), abs(lq.z)-11.0);
        block = max(block, -min(doorX, min(doorY, doorZ)));
        
        vec3 sq_ = lq; sq_.y -= floor(sq_.z / 0.5) * 0.5; sq_.z = mod(sq_.z, 0.5) - 0.25;
        float stair_ = max(abs(lq.x)-2.5, max(abs(lq.y)-8.5, abs(lq.z)-8.5));
        stair_ = max(stair_, max(abs(sq_.x)-2.5, max(abs(sq_.y)-0.125, abs(sq_.z)-0.125)));
        
        vec3 sq3_ = vec3(lq.y, lq.z, lq.x); sq3_.y -= floor(sq3_.z / 0.5) * 0.5; sq3_.z = mod(sq3_.z, 0.5) - 0.25;
        float stair3_ = max(abs(sq3_.x)-2.5, max(abs(sq3_.y)-0.125, abs(sq3_.z)-0.125));
        stair3_ = max(stair3_, max(abs(lq.y)-2.5, max(abs(lq.z)-8.5, abs(lq.x)-8.5)));
        
        float dSec5 = min(dMainStair, min(block, min(stair_, stair3_)) * 0.4);
        dBase = mix(dBase, dSec5, smoothstep_custom(270.0, 290.0, currentZ));

        // --- SECTOR 6: HALLWAY EXIT (360 to 500) ---
        float dFloor6 = p.y - fY;
        float dCeil6 = (fY + 7.0 * mix(1.0, 0.45, 1.0 - cFactor)) - p.y;
        float dWalls6 = 12.0 * cFactor - abs(p.x);
        float dSec6 = min(dFloor6, min(dCeil6, dWalls6));
        dSec6 = min(dSec6, mix(100.0, dCol1, smoothstep_custom(450.0, 500.0, currentZ)));
        dBase = mix(dBase, dSec6, smoothstep_custom(340.0, 370.0, currentZ));
        
        dBase = max(dBase, -dCamSafety);
        res = opU(res, vec2(dBase, MAT_MATTE));

        // Resolve Material details (Crystal vs Matte vs Glass Tube)
        if (dBase == dSlideHull && currentZ > 60.0 && currentZ < 130.0) {
            res.y = MAT_GLASS;
        }
        if (currentZ > 120.0 && currentZ < 220.0 && crystal < cave) {
            res.y = MAT_GLASS;
        }

        // Fluids
        float dSlideWater = 1000.0;
        if (currentZ > 60.0 && currentZ < 130.0) {
            float slide_x = cX;
            float slide_y = fY + 1.2;
            vec2 dSlideQ = vec2(p.x - slide_x, p.y - slide_y);
            // Dynamic rushing water inside waterslide tube
            dSlideWater = max(length(dSlideQ) - 1.72, dSlideQ.y - 0.0);
            vec3 pWaterWave = p;
            pWaterWave.y += sin(p.z * 1.5 - iTime * 15.0) * 0.1;
            dSlideWater = max(dSlideWater, pWaterWave.y - (fY + 0.5));
        }

        float waterY = -9000.0;
        float wRise = smoothLoop * 0.6;
        if (currentZ < 65.0) {
            waterY = 0.3 + wRise;
        } else if (currentZ < 135.0) {
            waterY = mix(0.3 + wRise, -9000.0, smoothstep_custom(65.0, 85.0, currentZ));
        } else if (currentZ > 351.0) {
            waterY = fY + 0.3 + wRise; // Elevates dynamically with fY back to 0.3 at lz=500!
        }
        
        if (waterY > -900.0 && ignoreWater < 0.5) {
            float dWater = p.y - (waterY + sin(p.x * 2.5 + iTime * 2.0) * cos(p.z * 2.5 + iTime * 2.5) * 0.03);
            res = opU(res, vec2(dWater, MAT_WATER));
        }
        if (dSlideWater < 900.0 && ignoreWater < 0.5) {
            res = opU(res, vec2(dSlideWater, MAT_WATER));
        }

        if (loop >= 1.0 && res.y == MAT_MATTE) {
            float vNoise = sin(p.x * 0.38) * cos(p.y * 0.38) * sin(p.z * 0.14) + sin(p.z * 0.5) * 0.25;
            if (vNoise > (0.95 - clamp(smoothLoop * 0.15, 0.0, 0.7))) res.x = max(res.x, 3.8);
        }

        if (res.y == MAT_MATTE) res.x -= getFloorCrack(p, localZ, smoothLoop) * 0.25;

        res.x *= 0.55;
        return res;
    }

    // Standard Normal Calculation
    vec3 calcNormal(vec3 p, float ignoreWater) {
        vec2 e = vec2(1.0, -1.0) * 0.5773 * 0.005;
        return normalize(
            e.xyy * map(p + e.xyy, ignoreWater).x +
            e.yyx * map(p + e.yyx, ignoreWater).x +
            e.yxy * map(p + e.yxy, ignoreWater).x +
            e.xxx * map(p + e.xxx, ignoreWater).x
        );
    }

    // Ambient Occlusion
    float calcAO(vec3 p, vec3 n, float ignoreWater) {
        float occ = 0.0;
        float sca = 1.0;
        for(int i = 0; i < 5; i++) {
            float h = 0.02 + 0.15 * float(i);
            float d = map(p + h * n, ignoreWater).x;
            occ += (h - d) * sca;
            sca *= 0.75;
        }
        return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

        // Synchronize camera track
        float camZ = uPlayerZ;

        float walkBob = abs(sin(iTime * 4.0)) * 0.18 - 0.09;
        float walkSway = cos(iTime * 2.0) * 0.1;

        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(camZ, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        bool is666 = (sector == 666.0);
        if (is666 && fallAmt < 0.5) {
            // Intense scary rumbling screenshakes during the walls sequence
            walkBob += sin(iTime * 85.0) * 0.35;
            walkSway += cos(iTime * 75.0) * 0.35;
        }

        float camX = getCamX(camZ) + walkSway;
        float minCamY = getFloorY(camZ) + getCamOffset(camZ);
        float currentWaterY = -1000.0;

        if (sector == 1.0) {
            currentWaterY = 0.3 + loop * 0.6;
        } else if (sector == 2.0) {
            float t = clamp(localZ / secLen, 0.0, 1.0);
            currentWaterY = mix(0.3 + loop * 0.6, -22.0 + loop * 0.6 * 0.3, pow(t, 0.7));
        }

        float camY = getCamY(camZ) + getCamOffset(camZ) + walkBob;
        camY = max(camY, minCamY + 0.05);
        camY = max(camY, currentWaterY + 1.15);

        // Global descent measure + finale fall distance (used for FOV & perpetual drift)
        float gd = loop + (is666 ? descent : clamp(mod(camZ, 500.0) / 360.0, 0.0, 0.999));
        float zFinale = max(camZ - 2000.0, 0.0);

        // Perpetual always-on drift (walk-speed independent)
        float driftAmt = mix(0.06, 0.5, clamp(zFinale / 300.0, 0.0, 1.0));

        vec3 ro = vec3(camX, camY, camZ);
        ro.x += sin(iTime * 0.23) * driftAmt;
        ro.y += cos(iTime * 0.17) * driftAmt * 0.6;

        vec3 ta = vec3(
            getCamX(camZ + 15.0),
            getCamY(camZ + 15.0) + getCamOffset(camZ + 15.0),
            camZ + 15.0
        );

        ta.xy += vec2(uPointer.x * 6.8, uPointer.y * 5.5);

        // Continuous fall pitch driven by fallAmt (keeps the up-vector stable, no straight-down snap)
        ta.y -= fallAmt * 22.0;
        vec3 fwd = ta - ro;
        fwd.z = mix(fwd.z, fwd.z * 0.15, fallAmt);
        ta = ro + fwd;
        vec3 cw = normalize(ta - ro);
        vec3 cp = vec3(0.0, 1.0, 0.0);

        vec3 cu = normalize(cross(cw, cp));
        vec3 cv = cross(cu, cw);

        // Gentle continuous roll proportional to fallAmt
        float tiltAngle = fallAmt * 0.15 * sin(iTime * 0.7);

        if (abs(tiltAngle) > 0.01) {
            float cT = cos(tiltAngle), sT = sin(tiltAngle);
            vec3 original_cu = cu;
            cu = original_cu * cT - cv * sT;
            cv = original_cu * sT + cv * cT;
        }

        // Continuous FOV: focalLength is inverse FOV (smaller = wider).
        float f = mix(1.0, 0.40, clamp(gd / 3.0, 0.0, 1.0));
        if (zFinale > 0.0) {
            f = mix(0.40, 0.24, clamp(zFinale / 400.0, 0.0, 1.0));
        }
        float focalLength = max(f, 0.22);

        vec3 rd = normalize(uv.x * cu + uv.y * cv + focalLength * cw);

        // --- PRIMARY RAYMARCH ---
        float t = 0.0;
        float matID = 0.0;
        float godRayAccum = 0.0;
        float decayFactor = clamp(loop * 0.15, 0.0, 0.9);

        float crystalGlow = 0.0;
        float fogTension = 0.0;
        float voidGlow = 0.0;

        for (int i = 0; i < MAX_STEPS; i++) {
            if (uHeavy < 0.5 && i >= 50) break;
            vec3 p = ro + rd * t;
            vec2 res = map(p, 0.0);

            // Accumulate volumetric oxblood vein/smoke glow during sector 666 falls (heavy effects only)
            if (uHeavy > 0.5) {
                float l_g, s_g, dc_g, sa_g, sb_g, bl_g, lZ_g, sLen_g, iF_g, iC_g;
                getSegmentData(p.z, l_g, s_g, dc_g, sa_g, sb_g, bl_g, lZ_g, sLen_g, iF_g, iC_g);
                if (s_g == 666.0 && iF_g > 0.3) {
                    // Rising red flame-smoke tendrils near surfaces (vein fog tension)
                    float vt = veinField(p, iTime);
                    fogTension += max(0.0, 0.012 - res.x) * (0.5 + vt) * iF_g;
                    voidGlow += vt * exp(-abs(res.x) * 4.0) * 0.02 * iF_g;
                }
            }

            if (uHeavy > 0.5 && decayFactor > 0.05) {
                float l, s, dc, sa, sb, bl, lZ, sLen, iF, iC;
                getSegmentData(p.z, l, s, dc, sa, sb, bl, lZ, sLen, iF, iC);
                float fY_p = getFloorY(p.z);
                float heightAboveFloor = p.y - fY_p;
                if (heightAboveFloor > 0.0 && heightAboveFloor < 15.0) {
                    float fCrack = getFloorCrack(p, lZ, loop);
                    godRayAccum += fCrack * exp(-heightAboveFloor * 0.28) * 0.02 * (1.0 + 3.0 * decayFactor);
                }
            }

            if (res.x < SURF_DIST) { matID = res.y; break; }
            if (t > MAX_DIST) break;
            t += res.x;
        }

        vec3 col = vec3(0.0);
        vec3 fogColor = getBiomeColor(ro.z + 30.0);
        vec3 sunDir = normalize(vec3(0.3, 0.8, 0.1));

        if (t < MAX_DIST) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p, 0.0);

            float l_p, s_p, dc_p, sa_p, sb_p, bl_p, lZ_p, sLen_p, fA_p, iC_p;
            getSegmentData(p.z, l_p, s_p, dc_p, sa_p, sb_p, bl_p, lZ_p, sLen_p, fA_p, iC_p);

            if (s_p == 666.0) {
                // Unified ABYSS palette: oxblood rock + glowing lava-blood veins, cross-faded across set-pieces.
                float ao = max(calcAO(p, n, 0.0), 0.35);
                float dif = max(dot(n, sunDir), 0.0);

                vec3 tint = mix(pieceTint(sa_p), pieceTint(sb_p), bl_p);
                float vInt = mix(pieceVeinInt(sa_p), pieceVeinInt(sb_p), bl_p);
                vec3 albedo = mix(ABYSS_ROCK, ABYSS_DEEP, clamp(dc_p, 0.0, 1.0)) * tint;

                col = albedo * (dif * 0.45 + 0.12) * ao;
                float deepen = 1.0 + dc_p * 0.8;
                col += abyssEmissive(p, iTime, vInt * deepen);
            } else if (matID == MAT_WATER) {
                float flow = iTime * 3.0;
                if (s_p == 2.0) flow = iTime * 12.0;

                vec3 waterNormal = n;
                waterNormal.x += sin(p.x * 6.0 + flow) * 0.06;
                waterNormal.z += cos(p.z * 6.0 + flow * 1.5) * 0.06;
                waterNormal = normalize(waterNormal);

                float fresnel = pow(1.0 - max(dot(waterNormal, -rd), 0.0), 5.0);
                vec3 waterReflDir = reflect(rd, waterNormal);
                float wt = 0.1;

                for (int i = 0; i < 40; i++) {
                    vec3 wp = p + waterReflDir * wt;
                    vec2 wres = map(wp, 1.0);
                    if (wres.x < SURF_DIST) break;
                    if (wt > 40.0) break;
                    wt += wres.x;
                }

                vec3 reflCol = fogColor;
                if (wt < 40.0) {
                    vec3 wp = p + waterReflDir * wt;
                    vec3 wn = calcNormal(wp, 1.0);
                    float rDif = max(dot(wn, sunDir), 0.0);
                    vec3 rAlbedo = getBiomeColor(wp.z);
                    reflCol = rAlbedo * (rDif * 0.6 + 0.4) * calcAO(wp, wn, 1.0);
                }

                vec3 refrCol = (s_p == 666.0) ? vec3(0.3, 0.01, 0.02) : vec3(0.01, 0.12, 0.16);
                refrCol = getBiomeColor(p.z) * 0.2 + refrCol * 0.8;

                col = mix(refrCol, reflCol, mix(0.12, 0.88, fresnel));
            } else {
                float dif = max(dot(n, sunDir), 0.0);
                float ao = max(calcAO(p, n, 0.0), 0.35);

                vec3 albedo = getBiomeColor(p.z);

                if (matID == MAT_MATTE) {
                    if (s_p == 1.0 || s_p == 5.0 || s_p == 6.0) {
                        vec3 grid = smoothstep_custom(0.0, 0.05, abs(fract(p * 2.0) - 0.5));
                        float lines = grid.x * grid.y * grid.z;
                        albedo *= mix(0.6, 1.0, lines);
                    }

                    // BLOOD DECALS: Large, non-uniform biological projections
                    if (decayFactor > 0.01) {
                        float splatter = sin(p.x * 0.22 + cos(p.z * 0.15)) * cos(p.y * 0.28) * sin(p.z * 0.14 + sin(p.x * 0.08));
                        splatter += sin(p.x * 12.0) * cos(p.z * 15.0) * 0.04;
                        
                        // Grows in size and fades in seamlessly depending on decayFactor
                        float bloodThresh = mix(0.95, 0.12, decayFactor);
                        float sharpSplatter = smoothstep_custom(0.0, 0.08, splatter - bloodThresh);
                        
                        vec3 bloodSpill = vec3(0.35, 0.002, 0.005) * (0.15 + 0.85 * smoothstep_custom(-0.2, 0.2, sin(p.y * 8.0)));
                        albedo = mix(albedo, bloodSpill, sharpSplatter * 0.96);
                    }

                    float fCrack = getFloorCrack(p, lZ_p, loop);
                    if (fCrack > 0.01) {
                        vec3 crackCol = vec3(1.5, 0.02, 0.01) * (1.0 + 8.0 * decayFactor);
                        albedo = mix(albedo, crackCol, fCrack);
                    }
                }

                if (matID == MAT_FLESH) {
                    float vein = sin(p.x * 12.0) * cos(p.y * 12.0) * sin(p.z * 12.0);
                    vec3 fleshBase = vec3(0.55, 0.02, 0.04);
                    vec3 veinCol = vec3(0.18, 0.0, 0.12);
                    if (vein > 0.5) fleshBase = mix(fleshBase, veinCol, 0.6);
                    albedo = fleshBase;
                }

                col = albedo * (dif * 0.6 + 0.4) * ao;

                if (matID == MAT_FLESH) {
                    vec3 refDir = reflect(rd, n);
                    float spec = pow(max(dot(refDir, sunDir), 0.0), 12.0) * 0.4;
                    col += vec3(0.9, 0.15, 0.25) * spec;
                }

                if (matID == MAT_GLASS) {
                    if (isCrystal > 0.5) {
                        // High-tech self-luminous holographic crystal tube simulation
                        vec3 crystalGlowVal = vec3(0.01, 0.65, 0.98) * (0.65 + 0.35 * sin(p.z * 0.9 + iTime * 6.0));
                        crystalGlowVal += vec3(0.12, 0.32, 0.55) * step(0.85, sin(p.z * 1.5 - iTime * 4.0));
                        col = crystalGlowVal;
                    } else {
                        vec3 refDir = reflect(rd, n);
                        float rt = 0.05;
                        for (int i = 0; i < 40; i++) {
                            vec3 rp = p + refDir * rt;
                            vec2 rres = map(rp, 0.0);
                            if (rres.x < SURF_DIST) break;
                            if (rt > 50.0) break;
                            rt += rres.x;
                        }

                        vec3 refCol = fogColor;
                        if (rt < 50.0) {
                            vec3 rp = p + refDir * rt;
                            vec3 wn = calcNormal(rp, 0.0);
                            float rDif = max(dot(wn, sunDir), 0.0);
                            vec3 rAlbedo = getBiomeColor(rp.z);
                            refCol = rAlbedo * (rDif * 0.6 + 0.4) * max(calcAO(rp, wn, 0.0), 0.35);
                            float rFog = 1.0 - exp(-0.02 * rt);
                            refCol = mix(refCol, getBiomeColor(rp.z + 30.0), rFog);
                        }

                        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
                        float refAmount = mix(0.15, 0.85, fresnel);
                        col = mix(col, refCol, refAmount);
                    }
                }
            }
        } else {
            if (is666 && fallAmt > 0.5) {
                if (loop < 3.0) {
                    col = vec3(0.04, 0.012, 0.012);
                } else {
                    col = vec3(0.02, 0.004, 0.006);
                }
            } else {
                col = fogColor;
            }
        }

        float fogFactor = 1.0 - exp(-0.012 * t);
        if (is666) {
            fogFactor = 1.0 - exp(-0.025 * t);
        }

        col = mix(col, fogColor, fogFactor);
        col += vec3(1.3, 0.05, 0.01) * godRayAccum;

        // Apply accumulated atmospheric volumetric glows
        if (is666 && fallAmt > 0.5) {
            if (loop < 3.0) {
                col += vec3(1.3, 0.25, 0.05) * crystalGlow * 0.025;
                col += vec3(1.0, 0.12, 0.03) * fogTension * 0.04;
            } else {
                col += vec3(0.8, 0.1, 0.0) * voidGlow * 0.035;
            }
        }

        gl_FragColor = vec4(col, t);
    }
`

export const fsPost = `
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform vec2 uPointer;
    uniform float uIteration;
    uniform float uPlayerZ;
    uniform float uBrightness;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float sdStar5(vec2 p, float r, float rf) {
        const vec2 k1 = vec2(0.80901699, -0.58778525);
        const vec2 k2 = vec2(-0.80901699, 0.30901699);
        p.x = abs(p.x);
        p -= 2.0 * max(dot(k1, p), 0.0) * k1;
        p -= 2.0 * max(dot(k2, p), 0.0) * k2;
        p.x = abs(p.x);
        p.y -= r;
        vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1) * r;
        float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, 1.0);
        return length(p - ba * h) * sign(p.y - ba.y * h);
    }

    void getSegmentDataPost(float z, out float sector, out float isFall) {
        if (z >= 2000.0) {
            sector = 666.0;
            isFall = 1.0;
            return;
        }
        float loop = floor(z / 500.0);
        float lz = mod(z, 500.0);
        isFall = 0.0;
        if (lz < 60.0)       { sector = 1.0; }
        else if (lz < 130.0) { sector = 2.0; }
        else if (lz < 210.0) { sector = 3.0; }
        else if (lz < 280.0) { sector = 4.0; }
        else if (lz < 360.0) { sector = 5.0; }
        else {
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                float local666 = lz - 360.0;
                if (local666 >= 30.0 && local666 < 120.0) {
                    isFall = 1.0;
                }
            }
        }
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        vec2 dist = uv - 0.5;

        // --- 1. FISHEYE CRT LENS EFFECTS (INTENSE FISHEYE) ---
        float r2 = dot(dist, dist);
        vec2 uvDistorted = uv + dist * r2 * 0.42; // Highly intense barrel distortion

        // --- 2. REDUCED CHROMATIC ABERRATION AT EDGES ---
        vec2 chromAbOffset = dist * (r2 + 0.02) * 0.12; 

        float sector, isFall;
        getSegmentDataPost(uPlayerZ, sector, isFall);

        float loopVal = floor(uPlayerZ / 500.0);
        float decayFactor = clamp(loopVal * 0.15, 0.0, 0.9);
        // As the journey STOPS in the abyss, calm the post FX toward the still reference look.
        float calm = smoothstep(2000.0, 2300.0, uPlayerZ);
        chromAbOffset *= (1.0 - calm * 0.6);

        bool is666 = (sector == 666.0);
        if (is666 && isFall < 0.5) {
            float tG = iTime * 65.0;
            vec2 glitchOff = vec2(
                sin(tG * 1.5) * 0.012 * step(0.72, sin(tG)),
                cos(tG * 0.9) * 0.008 * step(0.82, cos(tG * 1.1))
            );
            uvDistorted += glitchOff;
            chromAbOffset *= 2.2; // Spectrum fringing boost
        }

        vec3 col = vec3(0.0);
        col.r += texture2D(uTexture, uvDistorted - chromAbOffset).r;
        col.g += texture2D(uTexture, uvDistorted).g;
        col.b += texture2D(uTexture, uvDistorted + chromAbOffset).b;

        // --- 3. HORIZONTAL ANAMORPHIC FLARES & SUPER LONG-RADIUS BLOOM ---
        float flarePower = (decayFactor * 0.35 + (is666 ? 0.45 : 0.0)) * (1.0 - calm * 0.9);
        vec3 flare = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
            float flOffset = float(i) * 0.022; // super long sweep
            vec3 tapL = texture2D(uTexture, uvDistorted - vec2(flOffset, 0.0)).rgb;
            vec3 tapR = texture2D(uTexture, uvDistorted + vec2(flOffset, 0.0)).rgb;
            flare += max(tapL - 0.28, 0.0);
            flare += max(tapR - 0.28, 0.0);
        }
        col += flare * flarePower * vec3(1.0, 0.3, 0.06); // Anamorphic oxblood flare streak

        vec3 bloom = vec3(0.0);
        float bloomPower = decayFactor * 0.55 * (1.0 - calm * 0.85);
        for (int i = 1; i <= 4; i++) {
            float bOff = float(i) * 0.018;
            bloom += texture2D(uTexture, uvDistorted + vec2(bOff, bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(-bOff, bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(bOff, -bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(-bOff, -bOff)).rgb;
        }
        col += (bloom / 16.0) * bloomPower;

        // --- 4. DIGITAL INTERFERENCE GLITCHES ---
        float glitchStrength = (decayFactor * 0.22 + (is666 ? 0.45 : 0.0)) * (1.0 - calm * 0.9);
        if (glitchStrength > 0.05) {
            float bandY = floor(uvDistorted.y * 28.0 + iTime * 35.0);
            float hashVal = hash(vec2(bandY, 91.0));
            if (hashVal < glitchStrength * 0.25) {
                uvDistorted.x += (hash(vec2(bandY, 15.0)) - 0.5) * glitchStrength * 0.07;
            }
            if (hash(vec2(floor(iTime * 18.0), 3.0)) < glitchStrength * 0.18) {
                col += vec3(0.18, 0.01, 0.02) * glitchStrength * sin(uvDistorted.y * 30.0);
            }
        }

        // --- 5. ENCLOSING SHADOWS / VIGNETTE ---
        float vignette = smoothstep(0.95, 0.38, length(dist));
        col *= mix(0.18, 1.0, vignette);

        // Thin TV scanlines
        float scanline = sin(uvDistorted.y * iResolution.y * 1.5 + iTime * 12.0) * 0.06;
        col -= vec3(scanline);

        // Color modulation
        if (decayFactor > 0.05) {
            vec3 decayTone = vec3(col.r * 1.15, col.g * 0.72, col.b * 0.65);
            col = mix(col, decayTone, decayFactor * 0.75);
        }

        // --- 6. PENTAGRAM LIGHT LEAK (LAST 666 ENDLESS FALL) ---
        if (uPlayerZ > 2000.0) {
            vec2 starP = dist;
            float angle = iTime * 0.22;
            float cStar = cos(angle), sStar = sin(angle);
            starP = vec2(starP.x * cStar - starP.y * sStar, starP.x * sStar + starP.y * cStar);
            
            float dStar = sdStar5(starP, 0.26, 0.38);
            float starOutline = smoothstep(0.06, 0.0, abs(dStar) - 0.005);
            
            float dCircle = abs(length(starP) - 0.26);
            float circleOutline = smoothstep(0.06, 0.0, dCircle - 0.005);
            
            float pentaLeak = max(starOutline, circleOutline);
            float pentaIntensity = clamp((uPlayerZ - 2000.0) * 0.005, 0.0, 0.88);
            col += vec3(1.0, 0.12, 0.06) * pentaLeak * pentaIntensity * (1.2 + 0.8 * sin(iTime * 18.0));
        }

        // --- 7. TRANSITION FADE TO BLACK & SMOOTH LOOP RE-ENTRY ---
        float lzPost = mod(uPlayerZ, 500.0);
        float fade = 1.0;
        if (uPlayerZ < 2000.0) {
            if (lzPost > 460.0) {
                // Fade out over the last 40 units (460 to 500)
                fade = clamp(1.0 - (lzPost - 460.0) / 40.0, 0.0, 1.0);
            } else if (lzPost < 15.0) {
                // Fade in over the first 15 units (0 to 15)
                fade = clamp(lzPost / 15.0, 0.0, 1.0);
            }
        }
        col *= fade * uBrightness;

        gl_FragColor = vec4(col, 1.0);
    }
`
