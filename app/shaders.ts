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
        if (z >= 2270.0) { // Endless fall at the end of Loop 3
            loop = 3.0;
            sector = 666.0;
            part = 2.0;
            localZ = z - 2270.0;
            secLen = 1000000.0;
            isFall = 1.0;
            isCrystal = 0.0;
            return;
        }

        loop = floor(z / 600.0);
        float lz = mod(z, 600.0);
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
        } else if (lz < 430.0) {
            sector = 5.0; localZ = lz - 280.0; secLen = 150.0;
        } else {
            // Sector 6 / 666 Transition
            localZ = lz - 430.0;
            secLen = 170.0;
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                if (localZ < 40.0) {
                    part = 1.0;
                } else if (localZ < 130.0) {
                    part = 2.0;
                    isFall = 1.0;
                    if (loop == 1.0) {
                        isCrystal = 1.0;
                    }
                } else {
                    part = 3.0;
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
            return sin(z * 0.08) * 1.8;
        }
        if (sector == 5.0) {
            float t5 = localZ / secLen;
            return sin(t5 * 3.14159265 * 3.0) * 3.5;
        }
        if (sector == 6.0) return 0.0;
        if (sector == 666.0) {
            if (isFall > 0.5) return sin(localZ * 0.15) * 1.5;
            return sin(z * 0.08) * 2.5;
        }
        return 0.0;
    }

    // Camera height offsets
    float getCamOffset(float z) {
        float loop, sector, part, localZ, secLen, isFall, isCrystal;
        getSegmentData(z, loop, sector, part, localZ, secLen, isFall, isCrystal);

        if (sector == 2.0 && localZ >= 5.0 && localZ < 65.0) {
            return 0.95;
        }
        if (sector == 3.0) {
            return 1.0;
        }
        if (sector == 666.0 && part == 3.0) {
            if (localZ < 20.0) {
                float t = localZ / 20.0;
                return mix(1.8, 0.25, smoothstep_custom(0.0, 1.0, t));
            } else {
                float t = (localZ - 20.0) / 20.0;
                return mix(0.25, 1.8, smoothstep_custom(0.0, 1.0, t));
            }
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
            if (localZ < 75.0) {
                float stepSize = 4.3;
                float s = localZ / stepSize;
                float smoothStair = floor(s) + smoothstep_custom(0.6, 1.0, fract(s));
                return -125.0 + smoothStair * 3.75;
            } else {
                float tFall = (localZ - 75.0) / 75.0;
                if (tFall < 0.6) {
                    float nt = tFall / 0.6;
                    return mix(-61.25, -180.0, nt * nt);
                } else {
                    return -180.0;
                }
            }
        }
        if (sector == 6.0) return -180.0;
        if (sector == 666.0) {
            if (isFall > 0.5) {
                float t = localZ / secLen;
                return mix(-180.0, -350.0, t * t);
            }
            if (part == 3.0) {
                return -350.0;
            }
            return -180.0 + sin(localZ * 0.12) * 2.0;
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

        float fY = getFloorY(p.z);
        float decayFactor = clamp(loop * 0.15, 0.0, 0.95);
        
        // Squeezing/bending corridors on higher decay iterations
        float cFactor = 1.0 - clamp(loop * 0.14, 0.0, 0.72);
        float twist = sin(p.z * 0.065 + iTime * 2.0) * (loop * 0.35);
        p.x += twist * (1.0 - cFactor);

        // Infinite falling 3D decaying blocks/shards
        if (sector == 666.0 && loop >= 3.0 && isFall > 0.5) {
            vec3 shardCell = floor(p * 0.95);
            vec3 shardFract = fract(p * 0.95) - 0.5;
            float shardDecay = clamp((localZ - 40.0) * 0.012, 0.0, 1.0);
            p.x += sin(shardCell.y * 33.1) * shardDecay * 3.5;
            p.y += cos(shardCell.x * 24.5) * shardDecay * 3.5;
            p.z += sin(shardCell.z * 12.8) * shardDecay * 3.5;
        }

        if (decayFactor > 0.01) {
            float warpX = sin(p.z * 1.8 + iTime * 2.0) * cos(p.y * 1.5) * 0.55 * decayFactor;
            float warpY = cos(p.x * 1.6 + iTime * 1.5) * sin(p.z * 1.2) * 0.45 * decayFactor;
            float warpHigh = sin(p.z * 8.0) * cos(p.y * 8.0) * sin(p.x * 8.0) * 0.08 * decayFactor;
            p.x += warpX + warpHigh;
            p.y += warpY + warpHigh;
        }

        float dCamSafety = length(p.xy - vec2(getCamX(p.z), getCamY(p.z) + getCamOffset(p.z))) - 2.5;

        // Core room dimensions
        float width = 12.0;
        float ceilH = 7.0;

        if (sector == 1.0) { width = 12.0; ceilH = 7.0; }
        else if (sector == 2.0) { width = mix(12.0, 35.0, localZ/secLen); ceilH = mix(7.0, 40.0, localZ/secLen); }
        else if (sector == 3.0) { width = mix(35.0, 50.0, localZ/secLen); ceilH = mix(40.0, 100.0, localZ/secLen); }
        else if (sector == 4.0) { width = 150.0; ceilH = 300.0; } 
        else if (sector == 5.0) { width = 50.0; ceilH = 150.0; }
        else if (sector == 6.0) { width = 12.0; ceilH = 7.0; }
        else if (sector == 666.0) {
            if (isCrystal > 0.5) { width = 8.0; ceilH = 8.0; }
            else { width = 12.0; ceilH = 7.0; }
        }

        width *= cFactor;
        ceilH *= mix(1.0, 0.45, (1.0 - cFactor));

        float dFloor = p.y - fY;
        float dCeil  = (fY + ceilH) - p.y;
        float dWalls = width - abs(p.x);
        
        float dRoom = min(dFloor, min(dCeil, dWalls));

        if (sector == 4.0) {
            dRoom = 1000.0; // Emptiness void
        }

        vec2 res = vec2(dRoom, MAT_MATTE);

        // SECTOR 666 RENDER ENGINE
        if (sector == 666.0) {
            if (isCrystal > 0.5) {
                // Crystal falling tube
                vec2 tCenter = vec2(getCamX(p.z), getCamY(p.z));
                float lTube = length(p.xy - tCenter) - 4.5 + sin(p.z * 0.4)*0.15;
                res = opU(res, vec2(lTube, MAT_GLASS));
                res.x *= 0.5;
                return res;
            }

            // Giant screaming skull centered along the corridor
            vec3 skullP = p - vec3(getCamX(p.z), -45.0, p.z - localZ + 25.0);
            float dSkull = length(skullP) - 9.5;
            float dSkullEyeR = length(skullP - vec3(3.2, 5.0, -7.5)) - 2.6;
            float dSkullEyeL = length(skullP - vec3(-3.2, 5.0, -7.5)) - 2.6;
            dSkull = max(dSkull, -dSkullEyeR);
            dSkull = max(dSkull, -dSkullEyeL);
            float dSkullMouth = length(skullP - vec3(0.0, -3.5, -8.0)) - 5.0;
            float dSkullNose = length(skullP - vec3(0.0, 1.5, -9.0)) - 1.5;
            dSkull = max(max(dSkull, -dSkullMouth), -dSkullNose);

            float dEyeballR = length(skullP - vec3(3.2, 5.0, -6.0)) - 1.5;
            float dEyeballL = length(skullP - vec3(-3.2, 5.0, -6.0)) - 1.5;
            float dEyeballs = min(dEyeballR, dEyeballL);

            res = opU(res, vec2(dSkull, MAT_FLESH));
            res = opU(res, vec2(dEyeballs, MAT_FLESH));

            // Spikes along walls
            vec3 qSpikes = p;
            qSpikes.x = abs(qSpikes.x) - (width - 1.0);
            qSpikes.z = mod(p.z + 10.0, 20.0) - 10.0;
            float dFleshSpikes = length(qSpikes.xz) - 1.8 + sin(p.y * 1.5 + iTime * 3.0) * 0.4;
            dFleshSpikes = max(dFleshSpikes, -dCamSafety);
            res = opU(res, vec2(dFleshSpikes, MAT_FLESH));

            res.x *= 0.5;
            return res;
        }

        // Sector 1 columns
        if (sector == 1.0) {
            vec3 q1 = p;
            q1.z = mod(p.z + 3.0, 6.0) - 3.0;
            q1.x = abs(q1.x) - 4.5 * cFactor;
            float dPillar1 = length(max(abs(vec2(q1.x, q1.z)) - 0.4, 0.0)) - 0.05;
            dPillar1 = max(dPillar1, -dCamSafety);
            res = opU(res, vec2(dPillar1, MAT_MATTE));
        }

        // Sector 2 columns
        if (sector == 2.0) {
            vec3 q2 = p;
            q2.z = mod(p.z + 15.0, 30.0) - 15.0;
            q2.x = abs(q2.x) - 16.0 * cFactor;
            float dPillar2 = length(q2.xz) - 3.0;
            dPillar2 = max(dPillar2, -dCamSafety);
            res = opU(res, vec2(dPillar2, MAT_MATTE));
        }

        // Sector 2 waterslide slope
        if (sector == 2.0) {
            float slide_x = getCamX(p.z);
            float slide_y = getFloorY(p.z) + 1.2;
            vec2 dSlideProfile = vec2(p.x - slide_x, p.y - slide_y);
            float distSBody = abs(length(dSlideProfile) - 1.8) - 0.1;
            float dSlideHull = max(distSBody, dSlideProfile.y - 0.2);
            dSlideHull = max(dSlideHull, max(0.0 - localZ, localZ - secLen));
            res = opU(res, vec2(dSlideHull, MAT_GLASS));

            float dSlideWater = max(length(dSlideProfile) - 1.75, dSlideProfile.y + 0.3);
            dSlideWater = max(dSlideWater, max(0.0 - localZ, localZ - secLen));
            res = opU(res, vec2(dSlideWater, MAT_WATER));
        }

        // Sector 3 organic plants entry
        if (sector == 3.0) {
            if (localZ < 15.0) {
                vec2 mouthCenter = vec2(getCamX(p.z), getFloorY(p.z) + 1.2);
                float distToMouthCenter = length(p.xy - mouthCenter);
                float pAngle = atan(p.y - mouthCenter.y, p.x - mouthCenter.x);
                float teethAmp = 1.6 + sin(iTime * 4.0) * 0.25;
                float mouthTeeth = sin(pAngle * 10.0) * teethAmp * smoothstep_custom(0.0, 1.0, 1.0 - abs(localZ - 5.0) * 0.28);
                float dMouthLip = distToMouthCenter - (5.2 - mouthTeeth);
                float dPlantMaw = max(abs(localZ - 5.0) - 1.6, dMouthLip);
                dPlantMaw = max(dPlantMaw, -dCamSafety);
                res = opU(res, vec2(dPlantMaw, MAT_FLESH));
            }

            vec2 tubeCenter = vec2(getCamX(p.z), getFloorY(p.z) + 1.2);
            float distToTubeCenter = length(p.xy - tubeCenter);
            float dTubeWall = abs(distToTubeCenter - 4.5) - 0.2; 
            float fleshWeight = smoothstep_custom(25.0, 55.0, localZ);
            float fleshNoise = sin(p.x * 2.5) * sin(p.y * 2.5) * sin(p.z * 2.5) * 0.45;
            fleshNoise += sin(p.x * 6.5 + p.z * 6.5) * cos(p.y * 6.5) * 0.15;
            float thorns = pow(abs(sin(p.x * 5.0) * sin(p.y * 5.0) * sin(p.z * 5.0)), 3.0) * 1.8;
            float dFleshTube = dTubeWall + fleshWeight * (fleshNoise - thorns);
            dFleshTube = max(dFleshTube, -dCamSafety);
            res = opU(res, vec2(dFleshTube, (localZ >= 25.0) ? MAT_FLESH : MAT_MATTE));
        }

        // Sector 4 crumbling bridge span
        if (sector == 4.0) {
            float bridgeY = getFloorY(p.z);
            float dBridgeDeck = max(abs(p.x) - 2.5, abs(p.y - bridgeY) - 0.5);
            float erosion = sin(p.z * 1.5) * cos(p.y * 4.0) * 0.25;
            dBridgeDeck += erosion;
            
            float pz_tile = floor(p.z / 9.0);
            float seed = fract(sin(pz_tile * 12.9898) * 43758.5453);
            float t_fall = fract(iTime * 0.12 + seed);
            float dropOffset = 120.0 * exp(-t_fall * 6.0); 
            float pX = (fract(seed * 4.0) - 0.5) * 6.0; 
            
            vec3 piecePos = p;
            piecePos.x -= pX;
            piecePos.y -= (bridgeY + dropOffset);
            piecePos.z = mod(p.z, 9.0) - 4.5;
            float dPiece = length(max(abs(piecePos) - vec3(1.0, 0.4, 1.0), 0.0)) - 0.05;
            
            dBridgeDeck = max(dBridgeDeck, -dCamSafety);
            dPiece = max(dPiece, -dCamSafety);
            res = opU(res, vec2(dBridgeDeck, MAT_MATTE));
            res = opU(res, vec2(dPiece, MAT_MATTE));
        }

        // Sector 5 Gravity stairs structures: Rebuilt to match layout perfectly and tilt/collapse dynamically
        if (sector == 5.0) {
            float baseZ = p.z - localZ;
            float dMainStep = 1000.0;

            vec3 mainStairP = p;
            if (decayFactor > 0.05) {
                float amt = decayFactor * 0.16;
                mainStairP = rotX(mainStairP, amt * sin(p.z * 0.12));
                mainStairP = rotY(mainStairP, amt * cos(p.y * 0.08));
                mainStairP.y += sin(p.z * 0.2) * amt * 3.0;
            }

            if (localZ < 75.0) {
                // Main walk path staircase (matching kinematics perfectly)
                float stepW = 4.3;
                float s = mainStairP.z / stepW;
                float smoothStair = floor(s) + smoothstep_custom(0.6, 1.0, fract(s));
                float stepY = -125.0 + smoothStair * 3.75;
                dMainStep = max(abs(mainStairP.x) - 2.2 * cFactor, abs(mainStairP.y - stepY) - 0.45);
            } else {
                // Collapsing debris of the main path:
                // Small rotating pieces falling down
                float cellZ = floor(mainStairP.z / 6.0);
                float seed = hash1d(cellZ * 123.45);
                vec3 debrisP = mainStairP;
                float fallProgress = localZ - 75.0;
                float fallY = 40.0 * fallProgress * 0.05 * (1.1 + seed);
                debrisP.y += fallY;
                debrisP = rotX(debrisP, iTime * (1.5 + seed * 2.0));
                debrisP = rotY(debrisP, iTime * (1.0 + seed * 1.5));
                dMainStep = length(max(abs(debrisP) - 1.4, 0.0)) - 0.15;
            }

            // --- MULTI-AXIAL M.C. ESCHER STAIRS FLOATING IN THE CHASM ---
            // Rotate around all axes to create a mind-bending labyrinth
            float dFloatingStairs = 1000.0;
            
            // Staircase 1: Climbing vertically on the left wall (rotated)
            vec3 q1 = p - vec3(-18.0, -100.0, baseZ + 40.0);
            q1 = rotY(rotX(rotZ(q1, 0.4), 1.2), 1.57);
            dFloatingStairs = min(dFloatingStairs, sdNarrowStaircase(q1));

            // Staircase 2: Suspended diagonally on the right wall
            vec3 q2 = p - vec3(16.0, -60.0, baseZ + 80.0);
            q2 = rotX(rotY(rotZ(q2, -0.6), 2.1), -0.78);
            dFloatingStairs = min(dFloatingStairs, sdNarrowStaircase(q2));

            // Staircase 3: High above, upside down!
            vec3 q3 = p - vec3(2.0, -20.0, baseZ + 50.0);
            q3 = rotZ(rotX(rotY(q3, 0.78), 3.1415), -0.4);
            dFloatingStairs = min(dFloatingStairs, sdNarrowStaircase(q3));

            // Staircase 4: Sideways cross staircase
            vec3 q4 = p - vec3(-4.0, -90.0, baseZ + 110.0);
            q4 = rotX(rotY(rotZ(q4, 1.57), 0.5), 1.1);
            dFloatingStairs = min(dFloatingStairs, sdNarrowStaircase(q4));

            float dAllEscher = min(dMainStep, dFloatingStairs);

            // Columns crumbling
            vec3 colP = p;
            colP.z = mod(p.z + 10.0, 20.0) - 10.0;
            colP.x = abs(p.x) - 14.8 * cFactor;
            float dCol = length(colP.xz) - 0.92;
            if (localZ >= 75.0) {
                // make columns tilt stage by stage
                colP = rotZ(colP, (localZ - 75.0) * 0.005 * sign(p.x));
                dCol = length(colP.xz) - 0.92;
            }

            dAllEscher = min(dAllEscher, dCol);
            dAllEscher = max(dAllEscher, -dCamSafety);
            res = opU(res, vec2(dAllEscher, MAT_MATTE));
        }

        // Fluids
        float waterY = -1000.0;
        float wRise = loop * 0.6;
        if (sector == 1.0) {
            waterY = 0.3 + wRise;
        } else if (sector == 2.0) {
            float t = clamp(localZ / secLen, 0.0, 1.0);
            waterY = mix(0.3 + wRise, -22.0 + wRise * 0.3, pow(t, 0.7));
        } else if (sector == 5.0 && localZ >= 75.0) {
            waterY = -180.0;
        }

        if (waterY > -900.0 && ignoreWater < 0.5) {
            float ripple = sin(p.x * 2.5 + iTime * 2.0) * cos(p.z * 2.5 + iTime * 2.5) * 0.03;
            float dWater = p.y - (waterY + ripple);
            res = opU(res, vec2(dWater, MAT_WATER));
        }

        // Void holes
        if (loop >= 1.0 && res.y == MAT_MATTE) {
            float vNoise = sin(p.x * 0.38) * cos(p.y * 0.38) * sin(p.z * 0.14) + sin(p.z * 0.5) * 0.25;
            float voidThreshold = 0.95 - clamp(loop * 0.15, 0.0, 0.7);
            if (vNoise > voidThreshold) {
                res.x = max(res.x, 3.8);
            }
        }

        if (res.y == MAT_MATTE) {
            float crackDisp = getFloorCrack(p, localZ, loop) * 0.25;
            res.x -= crackDisp;
        }

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

        ta.xy += vec2(uPointer.x * 2.5, uPointer.y * 2.0);

        vec3 cw = normalize(ta - ro);
        vec3 cp = vec3(0.0, 1.0, 0.0);

        // Face straight down during elevator vacuum shaft plunging
        if (isFall > 0.5) {
            ta = ro + vec3(0.0, -1.0, 0.005);
            cw = normalize(ta - ro);
            cp = normalize(vec3(sin(iTime * 1.5), 0.0, cos(iTime * 1.5))); // vertigo camera spin!
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

        for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * t;
            vec2 res = map(p, 0.0);

            if (decayFactor > 0.05) {
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

            if (matID == MAT_WATER) {
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
                        vec3 crystalGlow = vec3(0.01, 0.65, 0.98) * (0.65 + 0.35 * sin(p.z * 0.9 + iTime * 6.0));
                        crystalGlow += vec3(0.12, 0.32, 0.55) * step(0.85, sin(p.z * 1.5 - iTime * 4.0));
                        col = crystalGlow;
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
            col = fogColor;
        }

        float fogFactor = 1.0 - exp(-0.012 * t);
        if (is666) {
            fogFactor = 1.0 - exp(-0.025 * t);
        }

        col = mix(col, fogColor, fogFactor);
        col += vec3(1.3, 0.05, 0.01) * godRayAccum;

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
        if (z >= 2270.0) {
            sector = 666.0;
            isFall = 1.0;
            return;
        }
        float loop = floor(z / 600.0);
        float lz = mod(z, 600.0);
        isFall = 0.0;
        if (lz < 60.0)       { sector = 1.0; }
        else if (lz < 130.0) { sector = 2.0; }
        else if (lz < 210.0) { sector = 3.0; }
        else if (lz < 280.0) { sector = 4.0; }
        else if (lz < 430.0) { sector = 5.0; }
        else {
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                float local666 = lz - 430.0;
                if (local666 >= 40.0 && local666 < 130.0) {
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

        float loopVal = floor(uPlayerZ / 600.0);
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
        if (uPlayerZ > 2270.0) {
            vec2 starP = dist;
            float angle = iTime * 0.22;
            float cStar = cos(angle), sStar = sin(angle);
            starP = vec2(starP.x * cStar - starP.y * sStar, starP.x * sStar + starP.y * cStar);
            
            float dStar = sdStar5(starP, 0.26, 0.38);
            float starOutline = smoothstep(0.06, 0.0, abs(dStar) - 0.005);
            
            float dCircle = abs(length(starP) - 0.26);
            float circleOutline = smoothstep(0.06, 0.0, dCircle - 0.005);
            
            float pentaLeak = max(starOutline, circleOutline);
            float pentaIntensity = clamp((uPlayerZ - 2270.0) * 0.005, 0.0, 0.88);
            col += vec3(1.0, 0.12, 0.06) * pentaLeak * pentaIntensity * (1.2 + 0.8 * sin(iTime * 18.0));
        }

        // --- 7. TRANSITION FADE TO BLACK & SMOOTH LOOP RE-ENTRY ---
        float lzPost = mod(uPlayerZ, 600.0);
        float fade = 1.0;
        if (uPlayerZ < 2270.0) {
            if (lzPost > 560.0) {
                // Fade out over the last 40 units (560 to 600)
                fade = clamp(1.0 - (lzPost - 560.0) / 40.0, 0.0, 1.0);
            } else if (lzPost < 15.0) {
                // Fade in over the first 15 units (0 to 15)
                fade = clamp(lzPost / 15.0, 0.0, 1.0);
            }
        }
        col *= fade;

        gl_FragColor = vec4(col, 1.0);
    }
`;
