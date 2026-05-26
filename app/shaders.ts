export const vsQuad = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

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

    // Core analytical segment lookup generator in 100% sync with TS kinematics
    void getSegmentData(float z, out float loop, out float sector, out float part, out float localZ, out float secLen, out float isFall, out float isCrystal) {
        if (z >= 1890.0) { // Endless fall at the end of Loop 3
            loop = 3.0;
            sector = 666.0;
            part = 9.0;
            localZ = z - 1890.0;
            secLen = 1000000.0;
            isFall = 1.0;
            isCrystal = 0.0;
            return;
        }

        loop = floor(z / 500.0);
        float lz = mod(z, 500.0);
        part = 0.0;
        isFall = 0.0;
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
            // Sector 6 / 666 Transition
            localZ = lz - 360.0;
            secLen = 140.0;
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                // Layer logic based on loop
                if (loop == 1.0) {
                    if (localZ < 60.0) {
                        part = 1.0; // Layer 1
                        isFall = 1.0;
                    } else if (localZ < 120.0) {
                        part = 2.0; // Layer 2
                    } else {
                        part = 8.0; // Collapse recovery
                    }
                } else if (loop == 2.0) {
                    if (localZ < 30.0) {
                        part = 1.0; // Layer 1
                        isFall = 1.0;
                    } else if (localZ < 60.0) {
                        part = 2.0; // Layer 2
                    } else if (localZ < 90.0) {
                        part = 3.0; // Layer 3
                    } else if (localZ < 120.0) {
                        part = 4.0; // Layer 4
                    } else {
                        part = 8.0; // Collapse recovery (escape)
                    }
                } else { // loop >= 3.0
                    if (localZ < 20.0) {
                        part = 1.0; // Layer 1
                        isFall = 1.0;
                    } else if (localZ < 40.0) {
                        part = 2.0; // Layer 2
                    } else if (localZ < 60.0) {
                        part = 3.0; // Layer 3
                    } else if (localZ < 80.0) {
                        part = 4.0; // Layer 4
                    } else if (localZ < 100.0) {
                        part = 5.0; // Layer 5
                    } else if (localZ < 120.0) {
                        part = 6.0; // Layer 6
                    } else if (localZ < 140.0) {
                        part = 7.0; // Layer 7
                        isFall = 1.0;
                    } else {
                        part = 9.0; // Endless glitch void fallback
                    }
                }
            }
        }
    }

    // Calculates camera horizontal shift
    float getCamX(float z) {
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(z, loop, sector, part, localZ, secLen, isFall, isCrystal);

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
            if (part == 1.0) {
                float s = smoothstep_custom(0.0, 10.0, localZ) * (1.0 - smoothstep_custom(30.0, 40.0, localZ));
                return s * sin(z * 0.08) * 2.5;
            }
            if (isFall > 0.5) {
                return 0.0;
            }
            return 0.0;
        }
        return 0.0;
    }

    // Camera height offsets
    float getCamOffset(float z) {
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(z, loop, sector, part, localZ, secLen, isFall, isCrystal);

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
        if (sector == 666.0 && part == 3.0) {
            float t = clamp(localZ / secLen, 0.0, 1.0);
            float dip = sin(t * 3.14159265);
            return mix(1.8, 0.25, dip);
        }
        return 1.8;
    }

    // Absolute floor elevation
    float getFloorY(float z) {
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(z, loop, sector, part, localZ, secLen, isFall, isCrystal);

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
            if (isFall > 0.5) {
                float t = localZ / secLen;
                return mix(-180.0, -350.0, t * t);
            }
            if (part == 3.0) {
                float t = clamp(localZ / secLen, 0.0, 1.0);
                return mix(-350.0, 0.0, smoothstep_custom(0.0, 1.0, t));
            }
            float bounce = sin(localZ * 0.12) * 2.0 * (1.0 - smoothstep_custom(30.0, 40.0, localZ));
            return -180.0 + bounce;
        }
        return 0.0;
    }

    float getCamY(float z) {
        return getFloorY(z);
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
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(z, loop, sector, part, localZ, secLen, isFall, isCrystal);
        
        if (sector == 666.0) {
            if (loop >= 3.0) {
                // Indigo/cobalt abyss during the final endless fall loop
                return vec3(0.01, 0.04, 0.42) + vec3(0.0, 0.01, 0.22) * abs(sin(z * 0.04 + iTime * 2.5));
            }
            if (isCrystal > 0.5) {
                return vec3(0.00, 0.15, 0.32) + vec3(0.08, 0.0, 0.22) * abs(sin(z * 0.15 + iTime * 4.0));
            }
            return vec3(0.08, 0.0, 0.01) + vec3(0.35, 0.01, 0.02) * abs(sin(z * 0.1 + iTime * 3.0));
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

    // Signed Distance Field Map
    vec2 map(vec3 p, float ignoreWater) {
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(p.z, loop, sector, part, localZ, secLen, isFall, isCrystal);

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

        // SECTOR 666 RENDER ENGINE (Endlessly Mutating 7-Layer Hellscape)
        if (sector == 666.0) {
            if (part == 1.0) {
                // --- LAYER 1: BURNING TWIGS & BARBED WIRE CRAWL SLIDE ---
                vec2 tun = p.xy - vec2(getCamX(p.z), fY + 0.3);
                float cave = 1.35 - length(tun);
                
                // Twisting barbed wire lines inside
                vec3 cp = p;
                float angle = cp.z * 1.5 + iTime * 2.5;
                cp.xy = vec2(cp.x * cos(angle) - cp.y * sin(angle), cp.x * sin(angle) + cp.y * cos(angle));
                float wire = length(abs(cp.xy) - vec2(0.85, 0.85)) - 0.035;
                wire += sin(cp.z * 18.0) * 0.02 * cos(cp.z * 6.0);
                
                // Gnarled fiery twigs/branches SDF
                float twig = length(cp.xy) - 1.25 + 0.28 * sin(cp.z * 7.0) * cos(cp.z * 4.5);
                
                float dSlide = min(min(cave, wire), twig);
                res = vec2(dSlide, MAT_FLESH);
                if (wire < cave && wire < twig) {
                    res.y = MAT_MATTE; // metal barbed wire
                }
                res.x *= 0.45;
                return res;
            }
            else if (part == 2.0) {
                // --- LAYER 2: COLD ENDLESS TUNDRA LANDSCAPE & SHADOW CREATURES ---
                float dTundraPlain = p.y - (fY - 2.5);
                float hills = sin(p.x * 0.04) * cos(p.z * 0.04) * 3.5;
                dTundraPlain -= hills;
                
                // Shadow creatures lurking and morphing in peripheral fields
                vec3 sp = p;
                sp.z = mod(sp.z + 18.0, 36.0) - 18.0;
                sp.x = abs(sp.x) - 13.0;
                float dCreature = length(sp - vec3(0.0, fY + 1.0 + sin(iTime * 2.5) * 0.4, 0.0)) - (0.95 + 0.45 * sin(iTime * 14.0) * cos(p.y * 3.0));
                
                float dBase = min(dTundraPlain, dCreature);
                res = vec2(dBase, MAT_MATTE);
                if (dCreature < dTundraPlain) {
                    res.y = MAT_GLASS; // give shadow creatures a dark glazed glitch material
                }
                res.x *= 0.5;
                return res;
            }
            else if (part == 3.0) {
                // --- LAYER 3: THE THROBBING WOMB (Visceral Pulsating Cave) ---
                vec2 tun = p.xy - vec2(getCamX(p.z), fY + 1.8);
                float rCorridor = 3.6 + sin(p.z * 0.28 + iTime * 4.2) * 0.48;
                float womb = rCorridor - length(tun);
                
                // organic veiny nodes bulging outward
                float nodes = sin(p.x * 2.2) * sin(p.y * 2.2) * cos(p.z * 2.2) * 0.48;
                womb -= nodes;
                
                res = vec2(womb, MAT_FLESH);
                res.x *= 0.45;
                return res;
            }
            else if (part == 4.0) {
                // --- LAYER 4: CITADEL GRAVITY CRAWL (Squeezing concrete grids) ---
                float dFloor = p.y - fY;
                float dCeil = (fY + 1.35 + sin(p.z * 0.08) * 0.35) - p.y;
                
                // Crushing pillars on sides
                vec3 rpCol = p;
                rpCol.z = mod(p.z + 5.0, 10.0) - 5.0;
                float dCol = length(abs(rpCol.xz) - vec2(3.2, 0.0)) - 0.75;
                
                float dCitadel = min(min(dFloor, dCeil), dCol);
                res = vec2(dCitadel, MAT_MATTE);
                res.x *= 0.5;
                return res;
            }
            else if (part == 5.0) {
                // --- LAYER 5: THE MEAT GRINDER (Buzzsaws & Pistons) ---
                float dFloorLab = p.y - fY;
                float dCeilLab = (fY + 7.0) - p.y;
                float dWallsLab = 6.0 - abs(p.x);
                float dGrinder = min(dFloorLab, min(dCeilLab, dWallsLab));
                
                // Ceil pistons pounding down
                vec3 rpPiston = p;
                rpPiston.z = mod(p.z + 10.0, 20.0) - 10.0;
                float pistonCycle = abs(sin(iTime * 3.8 + p.z * 0.18)) * 3.6;
                float dPiston = sdBox(rpPiston - vec3(0.0, fY + 6.0 - pistonCycle, 0.0), vec3(1.6, 2.8, 1.6));
                
                // Rotating big saw blades
                vec3 rpSaw = p;
                rpSaw.z = mod(rpSaw.z + 8.0, 16.0) - 8.0;
                rpSaw.x = abs(rpSaw.x) - 4.0;
                float sAngle = iTime * 22.0;
                vec2 rotatedCoord = vec2(rpSaw.y * cos(sAngle) - rpSaw.z * sin(sAngle), rpSaw.y * sin(sAngle) + rpSaw.z * cos(sAngle));
                float dSaw = sdBox(vec3(rpSaw.x, rotatedCoord.x, rotatedCoord.y), vec3(0.1, 2.4, 2.4));
                
                float dTotal = min(dGrinder, min(dPiston, dSaw));
                res = vec2(dTotal, MAT_MATTE);
                if (dPiston < dGrinder && dPiston < dSaw) {
                    res.y = MAT_FLESH; // visceral bio-pistons
                }
                res.x *= 0.45;
                return res;
            }
            else if (part == 6.0) {
                // --- LAYER 6: THE SPIRAL STONE BRIDGE DOWNWARDS ---
                float shaftRad = 9.5;
                float dShaft = shaftRad - length(p.xz);
                
                // Procedural floating spiral stepping blocks
                float pAng = atan(p.z, p.x);
                float pStep = (p.y - (-40.0)) / -5.0;
                float pCell = floor(pStep);
                float stepAngle = pCell * 0.45;
                float stepRad = 5.2;
                vec3 platformPos = vec3(stepRad * cos(stepAngle), -40.0 - pCell * 5.0, stepRad * sin(stepAngle));
                
                float dPlatform = sdBox(p - platformPos, vec3(1.6, 0.35, 1.95));
                
                float dSpiral = min(dShaft, dPlatform);
                res = vec2(dSpiral, MAT_MATTE);
                res.x *= 0.5;
                return res;
            }
            else if (part == 7.0) {
                // --- LAYER 7: ENTROPY & LIGHT LEAKS (Disintegrating cave geometry) ---
                float dFloorCorr = p.y - fY;
                float hills = sin(p.x * 0.2) * cos(p.z * 0.2) * 1.5;
                dFloorCorr -= hills;
                
                // high-frequency spatial distortion spikes representing digital signal breakdown
                float glitches = sin(p.x * 24.0 + iTime * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) * 0.35;
                dFloorCorr += glitches;
                
                vec3 qBox = p;
                qBox.xz = mod(p.xz + 6.0, 12.0) - 6.0;
                float dSpikes = length(qBox - vec3(0.0, fY + 3.0, 0.0)) - (1.0 + 1.2 * sin(iTime * 12.0));
                
                float dEntropy = min(dFloorCorr, dSpikes);
                res = vec2(dEntropy, MAT_GLASS);
                res.x *= 0.5;
                return res;
            }
            else if (part == 8.0) {
                // --- PART 8: THE COLLAPSE RECOVERY CHAMBER ---
                float dFloorChamber = p.y - fY;
                float dCeilChamber = (fY + 8.5) - p.y;
                float dWallsChamber = 10.0 - abs(p.x);
                float dRecoveryChamber = min(dFloorChamber, min(dCeilChamber, dWallsChamber));
                
                // monolith arches
                vec3 rCh = p;
                rCh.z = mod(p.z + 8.0, 16.0) - 8.0;
                float arches = length(vec2(abs(rCh.x) - 10.0, p.y - fY - 4.2)) - 1.5;
                dRecoveryChamber = min(dRecoveryChamber, arches);
                
                // Pulsating core lens
                vec3 bioP = p - vec3(0.0, fY + 3.0, p.z - localZ + 16.0);
                float dCore = length(bioP) - 3.0 + sin(iTime * 3.5) * 0.22;
                
                float dFinal = min(dRecoveryChamber, dCore);
                res = vec2(dFinal, MAT_MATTE);
                if (dCore < dRecoveryChamber) {
                    res.y = MAT_FLESH;
                }
                res.x *= 0.5;
                return res;
            }
            else { // part == 9.0
                // --- PART 9: ENDLESS PROCEDURAL GLITCH FALL VOID ---
                vec3 qVoid = p;
                qVoid.xz = mod(p.xz + 18.0, 36.0) - 18.0;
                qVoid.y = mod(p.y + 8.0, 16.0) - 8.0;
                float dPlate = sdBox(qVoid, vec3(7.5, 0.3, 7.5)) + sin(p.x * 2.2 + iTime * 6.0) * 0.45;
                
                // high frequency scanning pixel spike boxes
                float dSpikes = length(mod(p, 5.0) - 2.5) - 0.15 - 2.2 * step(0.9, sin(iTime * 16.0 + p.y * 1.5));
                float dVoidDecay = min(dPlate, dSpikes);
                
                res = vec2(dVoidDecay, MAT_GLASS);
                res.x *= 0.45;
                return res;
            }
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

        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(camZ, loop, sector, part, localZ, secLen, isFall, isCrystal);

        bool is666 = (sector == 666.0);
        if (is666 && isFall < 0.5) {
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

        vec3 ro = vec3(camX, camY, camZ);

        vec3 ta = vec3(
            getCamX(camZ + 15.0),
            getCamY(camZ + 15.0) + getCamOffset(camZ + 15.0),
            camZ + 15.0
        );

        ta.xy += vec2(uPointer.x * 6.8, uPointer.y * 5.5);

        vec3 cw = normalize(ta - ro);
        vec3 cp = vec3(0.0, 1.0, 0.0);

        // Face straight down during elevator vacuum shaft plunging
        if (isFall > 0.5) {
            ta = ro + vec3(0.0, -1.0, 0.005);
            cw = normalize(ta - ro);
            cp = vec3(0.0, 0.0, -1.0);
        }

        vec3 cu = normalize(cross(cw, cp));
        vec3 cv = cross(cu, cw);

        // Camera impact roll rotation/struggling
        float tiltAngle = 0.0;
        if (sector == 666.0 && part == 3.0) {
            if (localZ < 20.0) {
                float t_tilt = localZ / 20.0;
                tiltAngle = mix(0.0, 1.35, smoothstep_custom(0.0, 1.0, t_tilt));
            } else {
                float t_tilt = (localZ - 20.0) / 20.0;
                tiltAngle = mix(1.35, 0.0, smoothstep_custom(0.0, 1.0, t_tilt));
            }
        }

        if (tiltAngle > 0.01) {
            float cT = cos(tiltAngle), sT = sin(tiltAngle);
            vec3 original_cu = cu;
            cu = original_cu * cT - cv * sT;
            cv = original_cu * sT + cv * cT;
        }

        float focalLength = mix(1.0, 0.52, clamp(loop * 0.15, 0.0, 0.75));
        if (is666) {
            float progress = localZ / secLen;
            if (loop >= 3.0) {
                // Shrink focal length to 1mm focal width (0.05) eventually
                float endFactor = clamp(localZ / 180.0, 0.0, 1.0);
                focalLength = mix(1.0, 0.05, endFactor);
            } else {
                focalLength = mix(1.0, 0.22, progress);
            }
        }

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

            // Accumulate volumetric glows during sector 666 falls only when heavy effects are enabled
            if (uHeavy > 0.5) {
                float l_g, s_g, pa_g, lZ_g, sLen_g, iF_g, iC_g;
                getSegmentData(p.z, l_g, s_g, pa_g, lZ_g, sLen_g, iF_g, iC_g);
                if (s_g == 666.0 && iF_g > 0.5) {
                    if (l_g < 3.0) {
                        // Crystal fall glow
                        vec3 cp = p;
                        cp.x -= sin(p.y * 0.12 + iTime * 1.2) * 1.5;
                        cp.z -= cos(p.y * 0.15 - iTime * 0.8) * 1.5;
                        cp.y = mod(p.y + 3.0, 6.0) - 3.0;
                        float distToCrystal = (abs(cp.x) + abs(cp.y) + abs(cp.z)) - 0.75;
                        if (distToCrystal < 0.8) {
                            crystalGlow += 0.01 / (0.01 + distToCrystal * distToCrystal);
                        }
                        fogTension += max(0.0, 0.012 - res.x);
                    } else {
                        // Volumetric void glow near rings (Loop 3 Endless Fall in vertical shaft)
                        float shaftRad = 8.0;
                        vec3 qy = p;
                        qy.y = mod(p.y + 5.0, 10.0) - 5.0;
                        float ringDist = abs(qy.y);
                        if (ringDist < 0.6 && length(p.xz) < (shaftRad + 1.0) && length(p.xz) > (shaftRad - 0.5)) {
                            voidGlow += 0.012 / (0.012 + res.x * res.x);
                        }
                    }
                }
            }

            if (uHeavy > 0.5 && decayFactor > 0.05) {
                float l, s, pa, lZ, sLen, iF, iC;
                getSegmentData(p.z, l, s, pa, lZ, sLen, iF, iC);
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

            float l_p, s_p, pa_p, lZ_p, sLen_p, iF_p, iC_p;
            getSegmentData(p.z, l_p, s_p, pa_p, lZ_p, sLen_p, iF_p, iC_p);

            if (s_p == 666.0) {
                // Unified Sector 666 shader color generator
                vec3 albedo = vec3(0.12, 0.12, 0.12);
                float emissive = 0.0;
                vec3 emissiveColor = vec3(0.0);
                
                float ao = max(calcAO(p, n, 0.0), 0.35);
                float dif = max(dot(n, sunDir), 0.0);

                if (pa_p == 1.0) { // Layer 1: Twigs slide (Hot burning embers)
                    albedo = vec3(0.15, 0.06, 0.02);
                    // Add animated burning pulses along twig walls
                    float pulse = abs(sin(p.z * 1.5 - iTime * 4.0));
                    emissive = pulse * 1.5;
                    emissiveColor = vec3(1.0, 0.22, 0.0) * emissive;
                }
                else if (pa_p == 2.0) { // Layer 2: Cold Tundra & creatures
                    if (matID == MAT_GLASS) { // shadow creatures
                        albedo = vec3(0.002, 0.002, 0.003); // extreme black
                        // Glowing red eyes
                        float eyeGlow = step(0.96, sin(p.y * 12.0)) * step(0.96, cos(p.z * 8.0));
                        emissiveColor = vec3(1.2, 0.02, 0.05) * eyeGlow;
                    } else {
                        albedo = vec3(0.08, 0.11, 0.14); // cold tundra snow terrain
                    }
                }
                else if (pa_p == 3.0) { // Layer 3: Throbbing womb
                    albedo = vec3(0.35, 0.01, 0.05);
                    // Pulsating organic glow
                    float pulse = sin(p.z * 0.4 - iTime * 3.5) * 0.5 + 0.5;
                    emissiveColor = vec3(0.8, 0.01, 0.05) * pulse * 0.45;
                }
                else if (pa_p == 4.0) { // Layer 4: Citadel crawl
                    albedo = vec3(0.09, 0.09, 0.11); // cold crushing concrete grey
                }
                else if (pa_p == 5.0) { // Layer 5: Meat grinder
                    if (matID == MAT_FLESH) {
                        albedo = vec3(0.42, 0.015, 0.03); // bloody machinery
                    } else {
                        albedo = vec3(0.15, 0.15, 0.18); // raw steel
                    }
                    float grindPulse = abs(sin(p.z * 0.8 + iTime * 10.0));
                    emissiveColor = vec3(1.0, 0.02, 0.0) * grindPulse * 0.35;
                }
                else if (pa_p == 6.0) { // Layer 6: Spiral stone bridge
                    albedo = vec3(0.08, 0.08, 0.09) * mix(0.5, 1.0, step(0.08, fract(p.y * 2.0))); // dark stone treads
                }
                else if (pa_p == 7.0) { // Layer 7: Glitched static & light leaks
                    albedo = vec3(0.05, 0.4, 0.8) * abs(sin(p.x * 20.0 + iTime * 20.0)); // flashing blue light leaks
                    emissiveColor = vec3(0.08, 0.75, 1.0) * 1.5;
                }
                else if (pa_p == 8.0) { // Part 8: Recovery chamber (Concrete monoliths & Core)
                    if (matID == MAT_FLESH) { // comforting core sphere
                        albedo = vec3(0.12, 0.75, 1.0); // warm teal blue
                        emissiveColor = vec3(0.15, 0.85, 1.0) * (1.2 + 0.4 * sin(iTime * 4.0));
                    } else {
                        albedo = vec3(0.38, 0.38, 0.36); // warm raw concrete
                    }
                }
                else { // Part 9 / Loop 3 endless fall
                    albedo = vec3(0.1, 0.1, 0.1);
                    // digital static color leaks
                    float staticH = hash(vec2(p.x, p.y + iTime));
                    emissiveColor = vec3(0.45, 0.95, 1.0) * staticH * step(0.92, staticH);
                }

                col = albedo * (dif * 0.55 + 0.15) * ao;
                col += emissiveColor;
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
            if (is666 && isFall > 0.5) {
                if (loop < 3.0) {
                    col = vec3(0.01, 0.05, 0.1);
                } else {
                    col = vec3(0.01, 0.0, 0.02);
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
        if (is666 && isFall > 0.5) {
            if (loop < 3.0) {
                col += vec3(0.0, 0.5, 0.8) * crystalGlow * 0.025;
                col += vec3(0.6, 0.2, 0.8) * fogTension * 0.04;
            } else {
                col += vec3(0.8, 0.1, 0.0) * voidGlow * 0.035;
            }
        }

        gl_FragColor = vec4(col, t);
    }
`;

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
        if (z >= 1890.0) {
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
        float flarePower = decayFactor * 0.35 + (is666 ? 0.45 : 0.0);
        vec3 flare = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
            float flOffset = float(i) * 0.022; // super long sweep
            vec3 tapL = texture2D(uTexture, uvDistorted - vec2(flOffset, 0.0)).rgb;
            vec3 tapR = texture2D(uTexture, uvDistorted + vec2(flOffset, 0.0)).rgb;
            flare += max(tapL - 0.28, 0.0);
            flare += max(tapR - 0.28, 0.0);
        }
        col += flare * flarePower * vec3(0.12, 0.42, 1.0); // Anamorphic blue flare streak!

        vec3 bloom = vec3(0.0);
        float bloomPower = decayFactor * 0.55;
        for (int i = 1; i <= 4; i++) {
            float bOff = float(i) * 0.018;
            bloom += texture2D(uTexture, uvDistorted + vec2(bOff, bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(-bOff, bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(bOff, -bOff)).rgb;
            bloom += texture2D(uTexture, uvDistorted + vec2(-bOff, -bOff)).rgb;
        }
        col += (bloom / 16.0) * bloomPower;

        // --- 4. DIGITAL INTERFERENCE GLITCHES ---
        float glitchStrength = decayFactor * 0.22 + (is666 ? 0.45 : 0.0);
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
        if (uPlayerZ > 1890.0) {
            vec2 starP = dist;
            float angle = iTime * 0.22;
            float cStar = cos(angle), sStar = sin(angle);
            starP = vec2(starP.x * cStar - starP.y * sStar, starP.x * sStar + starP.y * cStar);
            
            float dStar = sdStar5(starP, 0.26, 0.38);
            float starOutline = smoothstep(0.06, 0.0, abs(dStar) - 0.005);
            
            float dCircle = abs(length(starP) - 0.26);
            float circleOutline = smoothstep(0.06, 0.0, dCircle - 0.005);
            
            float pentaLeak = max(starOutline, circleOutline);
            float pentaIntensity = clamp((uPlayerZ - 1890.0) * 0.005, 0.0, 0.88);
            col += vec3(1.0, 0.12, 0.06) * pentaLeak * pentaIntensity * (1.2 + 0.8 * sin(iTime * 18.0));
        }

        // --- 7. TRANSITION FADE TO BLACK & SMOOTH LOOP RE-ENTRY ---
        float lzPost = mod(uPlayerZ, 500.0);
        float fade = 1.0;
        if (uPlayerZ < 1890.0) {
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
`;
