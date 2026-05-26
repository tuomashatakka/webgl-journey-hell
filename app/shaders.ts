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

    #define MAX_STEPS 120
    #define MAX_DIST 150.0
    #define SURF_DIST 0.01

    // Material IDs
    #define MAT_MATTE 1.0
    #define MAT_WATER 2.0
    #define MAT_GLASS 3.0
    #define MAT_FLESH 4.0

    // Hash function for random scaling
    float hash1d(float x) {
        return fract(sin(x * 12.9898) * 43758.5453123);
    }

    // Dynamic sector scaling factors based on decay transition
    float getSectorScale(int sec, float it) {
        float seed = float(sec) * 11.37 + floor(it) * 17.81;
        float scaleCurrent = mix(0.67, 2.0, hash1d(seed));
        float scaleNext = mix(0.67, 2.0, hash1d(seed + 17.81));
        float f = fract(it);
        return mix(scaleCurrent, scaleNext, f);
    }

    // Space warped modulo computation returning nominal mz positioning
    float getWarpedMZ(float mz, float s1, float s2, float s3, float s4, float s5, float s6) {
        float w1 = 30.0 * s1;
        float w2 = 40.0 * s2;
        float w3 = 50.0 * s3;
        float w4 = 70.0 * s4;
        float w5 = 80.0 * s5;
        float w6 = 30.0 * s6;
        float sum = w1 + w2 + w3 + w4 + w5 + w6;
        
        float wb1 = 300.0 * (w1 / sum);
        float wb2 = wb1 + 300.0 * (w2 / sum);
        float wb3 = wb2 + 300.0 * (w3 / sum);
        float wb4 = wb3 + 300.0 * (w4 / sum);
        float wb5 = wb4 + 300.0 * (w5 / sum);
        
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

    float getWarpedZ(float z) {
        float mz = mod(z, 300.0);
        float s1 = getSectorScale(1, uIteration);
        float s2 = getSectorScale(2, uIteration);
        float s3 = getSectorScale(3, uIteration);
        float s4 = getSectorScale(4, uIteration);
        float s5 = getSectorScale(5, uIteration);
        float s6 = getSectorScale(6, uIteration);
        float wmz = getWarpedMZ(mz, s1, s2, s3, s4, s5, s6);
        return floor(z / 300.0) * 300.0 + wmz;
    }

    // Procedural glowing crevice/crack generator on decaying surfaces
    float getFloorCrack(vec3 p, float warped_mz, float it) {
        float decayFactor = clamp(it * 0.15, 0.0, 0.9);
        if (decayFactor < 0.05) return 0.0;
        float cNoise = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
        float crackLine = abs(cNoise);
        float crackWidth = mix(0.005, 0.11, decayFactor);
        float crackEdge = smoothstep(crackWidth, 0.0, crackLine);
        float crackMask = smoothstep(0.1, 0.5, sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + decayFactor * 0.35);
        return crackEdge * crackMask * decayFactor;
    }

    // Calculates horizontal shift
    float getCamX(float z) {
        float wz = getWarpedZ(z);
        float mz = mod(wz, 300.0);
        
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            return sin(wz * 0.06) * 3.5; 
        }

        if (mz < 30.0) return 0.0;
        if (mz < 70.0) {
            float s = smoothstep(30.0, 33.0, mz) * (1.0 - smoothstep(67.0, 70.0, mz));
            return s * sin(wz * 0.15) * 4.0;
        }
        if (mz < 120.0) {
            float s = smoothstep(70.0, 75.0, mz) * (1.0 - smoothstep(115.0, 120.0, mz));
            return s * sin(wz * 0.4) * 1.5;
        }
        if (mz < 190.0) {
            return sin(wz * 0.08) * 2.0;
        }
        if (mz < 270.0) {
            // Sector 5 stairs collapse detour
            if (mz >= 230.0) {
                float t_det = (mz - 230.0) / 40.0;
                return sin(t_det * 3.14159 * 2.5) * 6.5 + sin(wz * 0.1) * 2.0; // Detour path swing
            }
            float t5 = (mz - 190.0) / 80.0;
            return sin(t5 * 3.14159265 * 3.0) * 4.0;
        }
        return 0.0;
    }

    // Camera height offsets
    float getCamOffset(float z) {
        float wz = getWarpedZ(z);
        float mz = mod(wz, 300.0);
        
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            return 1.8;
        }

        if (mz >= 30.0 && mz < 70.0) {
            float s = smoothstep(30.0, 35.0, mz) * (1.0 - smoothstep(65.0, 70.0, mz));
            return mix(1.8, 1.0, s); // Sit inside waterslide
        }
        if (mz >= 70.0 && mz < 120.0) {
            return 1.0; 
        }
        return 1.8;
    }

    // Smoothstep interpolation helper
    float smoothstep_custom(float edge0, float edge1, float x) {
        float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    vec3 smoothstep_custom(float edge0, float edge1, vec3 x) {
        vec3 t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    // Absolute floor elevation 
    float getFloorY(float z) {
        float wz = getWarpedZ(z);
        float mz = mod(wz, 300.0);
        
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            // Continuous spooky blood corridor floor with periodic bumps
            return -60.0 + sin(wz * 0.08) * 4.0;
        }

        // Zone 1 (0-30): Pools (Flat)
        if(mz < 30.0) return 0.0;
        
        // Zone 2 (30-70): waterslide descent
        if(mz < 70.0) {
            float t = (mz - 30.0) / 40.0;
            return mix(0.0, -25.0, t * t * (3.0 - 2.0 * t));
        }
        
        // Zone 3 (70-120): Red flesh tunnel
        if(mz < 120.0) {
            float t = (mz - 70.0) / 50.0;
            return mix(-25.0, -125.0, t * t * (3.0 - 2.0 * t));
        }
        
        // Zone 4 (120-190): bridge
        if(mz < 190.0) {
            float t_bridge = (mz - 120.0) / 70.0;
            float bridgeArc = sin(t_bridge * 3.14159265) * 8.0;
            return -125.0 + bridgeArc;
        }
        
        // Zone 5 (190-270): Escher Stairs collapse mechanics
        if(mz < 270.0) {
            // Halfway is around 230
            if (mz >= 230.0) {
                // Stairs collapse down rapidly
                float drop = smoothstep_custom(230.0, 234.0, mz);
                float startY = -125.0 + ((230.0 - 190.0) / 1.6) * 2.5; // Y around -62.5
                float collapsedBaseY = -120.0;
                
                // Detour path Y rise back to 0.0 over mz range [234.0, 270.0]
                if (mz >= 234.0) {
                    float t_det = mz - 234.0;
                    float s_det = t_det / 1.25;
                    float smoothDet = floor(s_det) + smoothstep_custom(0.5, 0.9, fract(s_det));
                    float detYRise = smoothDet * 4.1667; // climbs back to exactly 0 at mz = 270
                    return collapsedBaseY + detYRise;
                }
                return mix(startY, collapsedBaseY, drop);
            }
            float t = mz - 190.0;
            float stepSize = 1.6; 
            float s = t / stepSize;
            float smoothStair = floor(s) + smoothstep_custom(0.6, 1.0, fract(s));
            return -125.0 + smoothStair * 2.5;
        }
        
        // Zone 6 (270-300): Transition Hallway
        // Every second time (e.g. uIteration % 2.0 is around 1.0), free fall to crimson oblivion!
        float iterFloor = floor(uIteration + 0.1);
        bool isChaosLoop = (mod(iterFloor, 2.0) == 1.0);
        if (isChaosLoop) {
            float dropAmount = smoothstep_custom(270.0, 300.0, mz);
            return mix(0.0, -320.0, dropAmount * dropAmount); // exponential free fall plunge!
        }
        return 0.0;
    }

    float getCamY(float z) {
        float wz = getWarpedZ(z);
        float mz = mod(wz, 300.0);
        
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            return -60.0 + sin(wz * 0.08) * 4.0;
        }

        if(mz < 30.0) return 0.0;
        if(mz < 70.0) {
            float t = (mz - 30.0) / 40.0;
            return mix(0.0, -25.0, t * t * (3.0 - 2.0 * t));
        }
        if(mz < 120.0) {
            float t = (mz - 70.0) / 50.0;
            return mix(-25.0, -125.0, t * t * (3.0 - 2.0 * t));
        }
        if(mz < 190.0) {
            float t_bridge = (mz - 120.0) / 70.0;
            float bridgeArc = sin(t_bridge * 3.14159265) * 8.0;
            return -125.0 + bridgeArc;
        }
        if(mz < 270.0) {
            if (mz >= 230.0) {
                float drop = smoothstep_custom(230.0, 234.0, mz);
                float startY = -125.0 + ((230.0 - 190.0) / 80.0) * 125.0; // stable gaze rise
                float collapsedBaseY = -120.0;
                
                if (mz >= 234.0) {
                    float t_det = mz - 234.0;
                    return collapsedBaseY + (t_det / 36.0) * 120.0; // smooth stable detour ascent
                }
                return mix(startY, collapsedBaseY, drop);
            }
            float t = mz - 190.0;
            return -125.0 + (t / 80.0) * 125.0; 
        }
        
        // Plunge camera Y down on Chaos free fall Sector 6
        float iterFloor = floor(uIteration + 0.1);
        bool isChaosLoop = (mod(iterFloor, 2.0) == 1.0);
        if (isChaosLoop) {
            float dropAmount = smoothstep_custom(270.0, 300.0, mz);
            return mix(0.0, -320.0, dropAmount * dropAmount);
        }
        return 0.0;
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

    float sdStairs(vec3 p) {
        float stepW = 0.55; 
        float s = p.z / stepW;
        float smoothStair = floor(s) + smoothstep_custom(0.5, 0.9, fract(s));
        float dStep = max(abs(p.x) - 1.2, abs(p.y - smoothStair * 0.26) - 0.15);
        return dStep;
    }

    float sdNarrowStairs(vec3 p) {
        float stepW = 0.38;
        float s = p.z / stepW;
        float smoothStair = floor(s) + smoothstep_custom(0.5, 0.9, fract(s));
        float dStep = max(abs(p.x) - 0.45, abs(p.y - smoothStair * 0.18) - 0.08);
        return dStep;
    }

    // Biome Color Logic
    vec3 getBiomeColor(float z) {
        float mz = mod(z, 300.0);
        
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            return vec3(0.08, 0.0, 0.01) + vec3(0.35, 0.01, 0.02) * abs(sin(z * 0.1 + iTime * 3.0));
        }

        vec3 c1 = vec3(0.85, 0.90, 0.95); // White Tile Pools
        vec3 c2 = vec3(0.02, 0.15, 0.22); // Abyssal Teal
        vec3 c3 = vec3(0.75, 0.03, 0.06); // Muscle Flesh Red
        vec3 c4 = vec3(0.05, 0.22, 0.14); // Emerald Reservoir
        vec3 c5 = vec3(0.85, 0.50, 0.10); // Hogwarts Twilight Orange
        vec3 c6 = vec3(0.85, 0.90, 0.95); // Gray Corridor
        
        // Smooth transitions between biom boundaries
        float w1 = 1.0 - smoothstep(12.0, 38.0, mz); w1 += smoothstep(288.0, 300.0, mz);
        float w2 = smoothstep(12.0, 38.0, mz) * (1.0 - smoothstep(52.0, 88.0, mz));
        float w3 = smoothstep(52.0, 88.0, mz) * (1.0 - smoothstep(102.0, 138.0, mz));
        float w4 = smoothstep(102.0, 138.0, mz) * (1.0 - smoothstep(172.0, 208.0, mz));
        float w5 = smoothstep(172.0, 208.0, mz) * (1.0 - smoothstep(252.0, 288.0, mz));
        float w6 = smoothstep(252.0, 288.0, mz) * (1.0 - smoothstep(288.0, 300.0, mz));
        
        vec3 baseCol = c1*w1 + c2*w2 + c3*w3 + c4*w4 + c5*w5 + c6*w6;
        
        // Environmental decay multiplier
        float decayWeight = clamp(uIteration * 0.18, 0.0, 0.85);
        vec3 hellBase = vec3(0.35, 0.01, 0.02);
        return mix(baseCol, hellBase, decayWeight);
    }

    // Signed Distance Field Map
    vec2 map(vec3 p, float ignoreWater) {
        float wz = getWarpedZ(p.z);
        float mz = mod(wz, 300.0);
        float fY = getFloorY(p.z);
        
        float decayFactor = clamp(uIteration * 0.15, 0.0, 0.9);
        
        // Claustrophobic walls bending/twisting and narrowing closer and closer
        // 5. Claustrophobia factor based on uIteration:
        float cFactor = 1.0 - clamp(uIteration * 0.14, 0.0, 0.72);
        
        float twist = sin(wz * 0.065 + iTime * 2.0) * (uIteration * 0.35);
        p.x += twist * (1.0 - cFactor); // Wall twist gets hyper distorted on higher iterations!

        // Space bending based on decay
        if (decayFactor > 0.01) {
            float warpX = sin(wz * 1.8 + iTime * 2.0) * cos(p.y * 1.5) * 0.55 * decayFactor;
            float warpY = cos(p.x * 1.6 + iTime * 1.5) * sin(wz * 1.2) * 0.45 * decayFactor;
            float warpHigh = sin(wz * 8.0) * cos(p.y * 8.0) * sin(p.x * 8.0) * 0.08 * decayFactor;
            p.x += warpX + warpHigh;
            p.y += warpY + warpHigh;
        }

        // Biome isolation weights
        float w1 = 1.0 - smoothstep_custom(15.0, 45.0, mz); w1 += smoothstep_custom(285.0, 300.0, mz);
        float w2 = smoothstep_custom(15.0, 45.0, mz) * (1.0 - smoothstep_custom(55.0, 85.0, mz));
        float w3 = smoothstep_custom(55.0, 85.0, mz) * (1.0 - smoothstep_custom(105.0, 135.0, mz));
        float w4 = smoothstep_custom(105.0, 135.0, mz) * (1.0 - smoothstep_custom(175.0, 205.0, mz));
        float w5 = smoothstep_custom(175.0, 205.0, mz) * (1.0 - smoothstep_custom(255.0, 285.0, mz));
        float w6 = smoothstep_custom(255.0, 285.0, mz) * (1.0 - smoothstep_custom(285.0, 300.0, mz));

        // Core Architecture dimensions
        float width = w1 * 12.0 + w2 * 35.0 + w3 * 50.0 + w4 * 150.0 + w5 * 50.0 + w6 * 12.0;
        float ceilH = w1 * 7.0  + w2 * 40.0 + w3 * 100.0 + w4 * 300.0 + w5 * 150.0 + w6 * 7.0;

        // Apply claustrophobia narrowing
        width *= cFactor;
        ceilH *= mix(1.0, 0.45, (1.0 - cFactor));

        // Basic Corridor volume
        float dFloor = p.y - fY;
        float dCeil  = (fY + ceilH) - p.y;
        float dWalls = width - abs(p.x);
        
        float dRoom = min(dFloor, min(dCeil, dWalls));
        vec2 res = vec2(dRoom, MAT_MATTE);

        // Camera clipping safeguard
        float dCamSafety = length(p.xy - vec2(getCamX(p.z), getCamY(p.z) + getCamOffset(p.z))) - 2.5;

        // Is this Sector 666?
        bool is666 = (floor(uIteration) == 2.0);
        if (is666) {
            // Sector 666 has bleeding flesh tendrils and a giant screaming static horror skull in the way!
            // Screaming Skull centered at z = 150.0
            vec3 skullP = p - vec3(getCamX(150.0), -45.0, 150.0);
            
            // Giant skull sphere
            float dSkull = length(skullP) - 9.5;
            
            // Eye hollows with red emitting eyeballs inside
            float dSkullEyeR = length(skullP - vec3(3.2, 5.0, -7.5)) - 2.6;
            float dSkullEyeL = length(skullP - vec3(-3.2, 5.0, -7.5)) - 2.6;
            
            dSkull = max(dSkull, -dSkullEyeR);
            dSkull = max(dSkull, -dSkullEyeL);
            
            // Jaw / gaping mouth
            float dSkullMouth = length(skullP - vec3(0.0, -3.5, -8.0)) - 5.0;
            // Scary nose cavity
            float dSkullNose = length(skullP - vec3(0.0, 1.5, -9.0)) - 1.5;
            dSkull = max(dSkull, -dSkullMouth);
            dSkull = max(dSkull, -dSkullNose);

            // Emissive eyeballs
            float eyeballFloat = sin(iTime * 15.0) * 0.15;
            float dEyeballR = length(skullP - vec3(3.2, 5.0 + eyeballFloat, -6.0)) - 1.5;
            float dEyeballL = length(skullP - vec3(-3.2, 5.0 - eyeballFloat, -6.0)) - 1.5;
            float dEyeballs = min(dEyeballR, dEyeballL);

            res = opU(res, vec2(dSkull, MAT_FLESH));
            res = opU(res, vec2(dEyeballs, MAT_FLESH));
            
            // Fleshy spikes along Sector 666
            vec3 qSpikes = p;
            qSpikes.x = abs(qSpikes.x) - (width - 1.0);
            qSpikes.z = mod(wz + 10.0, 20.0) - 10.0;
            float dFleshSpikes = length(qSpikes.xz) - 1.8 + sin(p.y*1.5 + iTime*3.0)*0.4;
            dFleshSpikes = max(dFleshSpikes, -dCamSafety);
            res = opU(res, vec2(dFleshSpikes, MAT_FLESH));
            
            res.x *= 0.5;
            return res;
        }

        // --- ZONE 1 pillars ---
        vec3 q1 = p;
        q1.z = mod(wz + 3.0, 6.0) - 3.0;
        q1.x = abs(q1.x) - 4.5 * cFactor;
        float dPillar1 = length(max(abs(vec2(q1.x, q1.z)) - 0.4, 0.0)) - 0.05;
        dPillar1 = max(dPillar1, max(-mz - 5.0, mz - 28.0));
        dPillar1 = max(dPillar1, -dCamSafety);
        res = opU(res, vec2(dPillar1, MAT_MATTE));

        // --- ZONE 2 pillars ---
        vec3 q2 = p;
        q2.z = mod(wz + 15.0, 30.0) - 15.0;
        q2.x = abs(q2.x) - 16.0 * cFactor;
        float dPillar2 = length(q2.xz) - 3.0;
        dPillar2 = max(dPillar2, max(32.0 - mz, mz - 68.0));
        dPillar2 = max(dPillar2, -dCamSafety);
        res = opU(res, vec2(dPillar2, MAT_MATTE));

        // --- ZONE 2 ANOMALIES: Waterslide ---
        float slide_x = getCamX(p.z);
        float slide_y = getFloorY(p.z) + 1.2;
        vec2 dSlideProfile = vec2(p.x - slide_x, p.y - slide_y);
        float distSBody = abs(length(dSlideProfile) - 1.8) - 0.1;
        float dSlideHull = max(distSBody, dSlideProfile.y - 0.2);
        dSlideHull = max(dSlideHull, max(29.0 - mz, mz - 71.0));
        res = opU(res, vec2(dSlideHull, MAT_GLASS));

        float dSlideWater = max(length(dSlideProfile) - 1.75, dSlideProfile.y + 0.3);
        dSlideWater = max(dSlideWater, max(29.5 - mz, mz - 70.5));
        res = opU(res, vec2(dSlideWater, MAT_WATER));

        // --- ZONE 3 FLESH-EATING PLANT MAW ENTRY (mz around 70) ---
        // 6. Teeth and organic predator lips lining the mouth to Sector 3 Chasm Tube
        if (mz >= 60.5 && mz < 78.5) {
            vec2 mouthCenter = vec2(getCamX(p.z), getFloorY(p.z) + 1.2);
            float distToMouthCenter = length(p.xy - mouthCenter);
            float pAngle = atan(p.y - mouthCenter.y, p.x - mouthCenter.x);
            
            // Splattered organic mouth opening with 10 creeping teeth
            float teethAmp = 1.6 + sin(iTime * 4.0) * 0.25;
            float mouthTeeth = sin(pAngle * 10.0) * teethAmp * smoothstep_custom(0.0, 1.0, 1.0 - abs(p.z - 70.0) * 0.28);
            float dMouthLip = distToMouthCenter - (5.2 - mouthTeeth);
            
            float dPlantMaw = max(abs(p.z - 70.0) - 1.6, dMouthLip);
            dPlantMaw = max(dPlantMaw, -dCamSafety);
            res = opU(res, vec2(dPlantMaw, MAT_FLESH));
        }

        // --- ZONE 3 Free Fall Flesh/Thorns Tube ---
        vec2 tubeCenter = vec2(getCamX(p.z), getFloorY(p.z) + 1.2);
        float distToTubeCenter = length(p.xy - tubeCenter);
        float dTubeWall = abs(distToTubeCenter - 4.5) - 0.2; 

        float fleshWeight = smoothstep_custom(95.0, 118.0, mz);
        float fleshNoise = sin(p.x * 2.5) * sin(p.y * 2.5) * sin(wz * 2.5) * 0.45;
        fleshNoise += sin(p.x * 6.5 + wz * 6.5) * cos(p.y * 6.5) * 0.15;
        
        float thorns = pow(abs(sin(p.x * 5.0) * sin(p.y * 5.0) * sin(wz * 5.0)), 3.0) * 1.8;
        float finalDisplacement = fleshWeight * (fleshNoise - thorns);
        float dFleshTube = dTubeWall + finalDisplacement;
        dFleshTube = max(dFleshTube, max(69.0 - mz, mz - 121.0));
        dFleshTube = max(dFleshTube, -dCamSafety);
        res = opU(res, vec2(dFleshTube, (mz >= 95.0) ? MAT_FLESH : MAT_MATTE));

        // --- ZONE 4 Submerged Crumbling Bridge & Falling Blocks ---
        float bridgeY = getFloorY(p.z);
        float dBridgeDeck = max(abs(p.x) - 2.5, abs(p.y - bridgeY) - 0.5);
        float erosion = sin(wz * 1.5) * cos(p.y * 4.0) * 0.25;
        dBridgeDeck += erosion;
        
        float pz_tile = floor(wz / 9.0);
        float seed = fract(sin(pz_tile * 12.9898) * 43758.5453);
        float t_fall = fract(iTime * 0.12 + seed);
        float dropOffset = 120.0 * exp(-t_fall * 6.0); 
        float pX = (fract(seed * 4.0) - 0.5) * 6.0; 
        
        vec3 piecePos = p;
        piecePos.x -= pX;
        piecePos.y -= (bridgeY + dropOffset);
        piecePos.z = mod(wz, 9.0) - 4.5;
        float dPiece = length(max(abs(piecePos) - vec3(1.0, 0.4, 1.0), 0.0)) - 0.05;
        
        dBridgeDeck = max(dBridgeDeck, max(119.0 - mz, mz - 191.0));
        dPiece = max(dPiece, max(119.5 - mz, mz - 190.5));
        
        dBridgeDeck = max(dBridgeDeck, -dCamSafety);
        dPiece = max(dPiece, -dCamSafety);
        res = opU(res, vec2(dBridgeDeck, MAT_MATTE));
        res = opU(res, vec2(dPiece, MAT_MATTE));

        // --- ZONE 5 Escher Gravity Defying Staircases + Collapsing narrow stairs detour ---
        float pzLocal = mod(wz + 15.0, 30.0) - 15.0;
        
        // Base structures of stairs (Only visible if not collapsed totally)
        float dS1 = 1000.0;
        if (mz < 230.0) {
            // Stair 1: Climbing stairs
            vec3 t1 = vec3(p.x - 2.0, p.y - (bridgeY + 6.0), pzLocal);
            dS1 = sdStairs(t1);
        } else {
            // 1. Collapsed down stairs ruins in the SDF
            vec3 t1Break = vec3(p.x - 2.0, p.y - (bridgeY - 10.0), pzLocal);
            // tilt them over as they break down!
            t1Break = rotX(t1Break, 0.45);
            dS1 = sdStairs(t1Break);
        }
        
        // Stair 2: Right wall vertical steps (Rotated X & Y)
        vec3 t2 = rotX(rotY(vec3(p.x - 14.0 * cFactor, p.y - (bridgeY + 15.0), pzLocal - 4.0), 0.785), 1.5708);
        float dS2 = sdStairs(t2);
        
        // Stair 3: Left wall steps (Rotated Z & X)
        vec3 t3 = rotZ(rotX(vec3(p.x + 14.0 * cFactor, p.y - (bridgeY + 10.0), pzLocal + 8.0), 0.5), 1.5708);
        float dS3 = sdStairs(t3);
        
        // Stair 4: Inverted steps on ceiling
        vec3 t4 = rotZ(vec3(p.x, p.y - (bridgeY + 30.0), pzLocal - 10.0), 3.14159);
        float dS4 = sdStairs(t4);
        
        // Stair 5: Diagonal cross-stairs
        vec3 t5 = rotY(rotX(vec3(p.x + 4.0, p.y - (bridgeY + 20.0), pzLocal + 1.2), 0.6), 1.5708);
        float dS5 = sdStairs(t5);
        
        // Stair 6: Steep staircase
        vec3 t6 = rotY(rotZ(vec3(p.x - 8.0, p.y - (bridgeY + 2.0), pzLocal - 5.0), -0.785), 0.8);
        float dS6 = sdStairs(t6);
        
        float dAllEscher = min(dS1, min(dS2, min(dS3, min(dS4, min(dS5, dS6)))));

        // 1. DETOUR NARROW STAIRCASES AT 90/135 DEGREE ANGLES
        if (mz >= 230.0) {
            // Narrow stair 1 at 90 degrees (rotated sideways)
            vec3 d1 = rotZ(vec3(p.x - 3.5, p.y - (bridgeY + 8.0), pzLocal + 2.0), 1.5708);
            float dDetour1 = sdNarrowStairs(d1);
            
            // Narrow stair 2 at 135 degrees (slanted angle)
            vec3 d2 = rotZ(rotY(vec3(p.x + 4.5, p.y - (bridgeY + 18.0), pzLocal - 8.0), 0.78), 2.3562);
            float dDetour2 = sdNarrowStairs(d2);
            
            // Narrow stair 3 at 90 degrees upside down
            vec3 d3 = rotZ(vec3(p.x - 1.0, p.y - (bridgeY + 28.0), pzLocal + 12.0), -1.5708);
            float dDetour3 = sdNarrowStairs(d3);

            // Narrow stair 4 completely upside down (180 degrees)
            vec3 d4 = rotZ(vec3(p.x + 3.0, p.y - (bridgeY + 38.0), pzLocal - 2.0), 3.14159);
            float dDetour4 = sdNarrowStairs(d4);
            
            dAllEscher = min(dAllEscher, min(dDetour1, min(dDetour2, min(dDetour3, dDetour4))));
        }

        dAllEscher = max(dAllEscher, max(189.0 - mz, mz - 271.0));
        dAllEscher = max(dAllEscher, -dCamSafety);
        res = opU(res, vec2(dAllEscher, MAT_MATTE));

        // --- THE RISING FLUIDS OR CRIMSON OBLIVION LIQUID ---
        float waterY = -1000.0; 
        float wRise = uIteration * 0.6;
        
        float iterFloor = floor(uIteration + 0.1);
        bool isChaosLoop = (mod(iterFloor, 2.0) == 1.0);

        if(mz < 30.0) {
            waterY = 0.3 + wRise; 
        } else if(mz < 70.0) {
            float t2 = clamp((mz - 30.0) / 40.0, 0.0, 1.0);
            waterY = mix(0.3 + wRise, -22.0 + wRise * 0.3, pow(t2, 0.7)); 
        } else if(mz >= 120.0 && mz < 190.0) {
            waterY = -123.5 + wRise; 
        } else if(isChaosLoop && mz >= 270.0) {
            // Crimson oblivion pool waiting in free fall Sector 6
            waterY = -290.0; 
        }
        
        float ripple = sin(p.x * 2.5 + iTime * 2.0) * cos(wz * 2.5 + iTime * 2.5) * 0.03;
        float dWater = p.y - (waterY + ripple);
        
        // Disable water in other sectors except when chaos free fall is active in Sector 6
        if (((mz >= 70.0 && mz < 120.0) || mz >= 190.0 || ignoreWater > 0.5) && !(isChaosLoop && mz >= 270.0)) {
            dWater = 1000.0;
        }
        res = opU(res, vec2(dWater, MAT_WATER));

        // 5. COLLAPSED PARTS INTO NOTHINGNESS
        // Subtract pockets of physical void/nothingness on high iterations
        if (uIteration >= 1.0 && res.y == MAT_MATTE) {
            float vNoise = sin(p.x * 0.38) * cos(p.y * 0.38) * sin(wz * 0.14) + sin(p.z * 0.5)*0.25;
            float voidThreshold = 0.95 - clamp(uIteration * 0.15, 0.0, 0.7);
            if (vNoise > voidThreshold) {
                // Return high distance to create missing geometries/nothingness void holes!
                res.x = max(res.x, 3.8); 
            }
        }

        if (res.y == MAT_MATTE) {
            float crackDisp = getFloorCrack(p, mz, uIteration) * 0.25;
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

    // Directional Ambient Occlusion
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

        // --- CAMERA KINEMATICS ---
        float SPEED = 5.0; 
        float camZ = iTime * SPEED;
        
        float walkBob = abs(sin(iTime * 4.0)) * 0.18 - 0.09;
        float walkSway = cos(iTime * 2.0) * 0.1;
        
        // 3. Jumpscare shaking effect in Sector 666 (around z = 155)
        bool is666 = (floor(uIteration) == 2.0);
        float wz_cam = getWarpedZ(camZ);
        float mz = mod(wz_cam, 300.0);
        if (is666 && mz >= 148.0 && mz <= 156.0) {
            // Loud high freq screen rumble shaking!
            walkBob += sin(iTime * 85.0) * 0.35;
            walkSway += cos(iTime * 75.0) * 0.35;
        }

        float camX = getCamX(camZ) + walkSway;
        float minCamY = getFloorY(camZ) + getCamOffset(camZ);
        float currentWaterY = -1000.0;

        if (is666) {
            currentWaterY = -1000.0;
        } else {
            if(mz < 30.0) {
                currentWaterY = 0.3 + uIteration * 0.6;
            } else if(mz < 70.0) {
                float t2 = clamp((mz - 30.0) / 40.0, 0.0, 1.0);
                currentWaterY = mix(0.3 + uIteration * 0.6, -22.0 + uIteration * 0.6 * 0.3, pow(t2, 0.7));
            } else if(mz >= 120.0 && mz < 190.0) {
                currentWaterY = -123.5 + uIteration * 0.6;
            }
        }
        
        float camY = getCamY(camZ) + getCamOffset(camZ) + walkBob;
        camY = max(camY, minCamY + 0.05);
        camY = max(camY, currentWaterY + 1.15); 

        vec3 ro = vec3(camX, camY, camZ);
        
        // LookAt target panning
        vec3 ta = vec3(
            getCamX(camZ + 15.0),
            getCamY(camZ + 15.0) + getCamOffset(camZ + 15.0), 
            camZ + 15.0
        );
        
        ta.xy += vec2(uPointer.x * 2.5, uPointer.y * 2.0);
        
        vec3 cw = normalize(ta - ro);
        vec3 cp = vec3(0.0, 1.0, 0.0);
        vec3 cu = normalize(cross(cw, cp));
        vec3 cv = cross(cu, cw);
        
        float focalLength = mix(1.0, 0.52, clamp(uIteration * 0.15, 0.0, 0.75));
        vec3 rd = normalize(uv.x * cu + uv.y * cv + focalLength * cw);

        // --- PRIMARY RAYMARCH ---
        float t = 0.0;
        float matID = 0.0;
        float godRayAccum = 0.0;
        float decayFactor = clamp(uIteration * 0.15, 0.0, 0.9);
        for(int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * t;
            vec2 res = map(p, 0.0);
            
            // Volumetric god ray calculations
            if (decayFactor > 0.05) {
                float wz_p = getWarpedZ(p.z);
                float mz_p = mod(wz_p, 300.0);
                float fY_p = getFloorY(p.z);
                float heightAboveFloor = p.y - fY_p;
                if (heightAboveFloor > 0.0 && heightAboveFloor < 15.0) {
                    float fCrack = getFloorCrack(p, mz_p, uIteration);
                    godRayAccum += fCrack * exp(-heightAboveFloor * 0.28) * 0.02 * (1.0 + 3.0 * decayFactor);
                }
            }
            
            if(res.x < SURF_DIST) { matID = res.y; break; }
            if(t > MAX_DIST) break;
            t += res.x;
        }

        vec3 col = vec3(0.0);
        vec3 fogColor = getBiomeColor(ro.z + 30.0); 

        // Set fog color to deep crimson during free fall in Sector 6 chaos
        float iterFloor = floor(uIteration + 0.1);
        bool isChaosLoop = (mod(iterFloor, 2.0) == 1.0);
        if (isChaosLoop && mz >= 270.0) {
            float trans = smoothstep_custom(270.0, 280.0, mz);
            fogColor = mix(fogColor, vec3(0.12, 0.0, 0.005), trans);
        }

        vec3 sunDir = normalize(vec3(0.3, 0.8, 0.1));

        if(t < MAX_DIST) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p, 0.0);
            
            float wz_p = getWarpedZ(p.z);
            float mz_p = mod(wz_p, 300.0);
            
            // Perturb water normals heavily for current and flow
            if(matID == MAT_WATER) {
                float flow = iTime * 3.0;
                float mz_water = mz_p;
                if(mz_water >= 29.0 && mz_water < 71.0) {
                    flow = iTime * 12.0; // Rapid waterslide action
                }
                
                vec3 waterNormal = n;
                waterNormal.x += sin(p.x * 6.0 + flow) * 0.06;
                waterNormal.z += cos(wz_p * 6.0 + flow * 1.5) * 0.06;
                waterNormal = normalize(waterNormal);
                
                float fresnel = pow(1.0 - max(dot(waterNormal, -rd), 0.0), 5.0);
                float refYOffset = 0.05;
                vec3 waterReflDir = reflect(rd, waterNormal);
                float wt = 0.1;
                
                for(int i = 0; i < 40; i++) {
                    vec3 wp = p + waterReflDir * wt;
                    vec2 wres = map(wp, 1.0); // Ignore transparent water surface in secondary pass
                    if(wres.x < SURF_DIST) break;
                    if(wt > 40.0) break;
                    wt += wres.x;
                }
                
                vec3 reflCol = fogColor;
                if(wt < 40.0) {
                    vec3 wp = p + waterReflDir * wt;
                    vec3 wn = calcNormal(wp, 1.0);
                    float rDif = max(dot(wn, sunDir), 0.0);
                    vec3 rAlbedo = getBiomeColor(wp.z);
                    reflCol = rAlbedo * (rDif * 0.6 + 0.4) * calcAO(wp, wn, 1.0);
                }
                
                // Color refracted water interior
                vec3 refrCol = (isChaosLoop && mz_p >= 270.0) ? vec3(0.3, 0.0, 0.0) : vec3(0.01, 0.12, 0.16); 
                refrCol = getBiomeColor(p.z) * 0.2 + refrCol * 0.8;
                
                col = mix(refrCol, reflCol, mix(0.12, 0.88, fresnel));
            } else {
                // OPAQUE SURFACES PASS
                float dif = max(dot(n, sunDir), 0.0);
                float ao = calcAO(p, n, 0.0);
                
                vec3 albedo = getBiomeColor(p.z);
                
                if(matID == MAT_MATTE) {
                    float mz_matte = mz_p;
                    if(mz_matte < 35.0 || (mz_matte >= 185.0 && mz_matte < 275.0) || mz_matte > 295.0) {
                        vec3 grid = smoothstep_custom(0.0, 0.05, abs(fract(p * 2.0) - 0.5));
                        float lines = grid.x * grid.y * grid.z;
                        albedo *= mix(0.6, 1.0, lines);
                    }
    
                    float decayAmount = clamp(uIteration * 0.15, 0.0, 1.0);
                    if (decayAmount > 0.01) {
                        float splatter = sin(p.x * 3.5) * cos(p.y * 3.1) * sin(wz_p * 2.8);
                        splatter += sin(p.x * 12.0) * cos(wz_p * 15.0) * 0.25;
                        float sharpSplatter = smoothstep_custom(0.1, 0.13, splatter - (1.0 - decayAmount) * 0.35);
                        vec3 bloodSpill = vec3(0.3, 0.005, 0.008) * (0.2 + 0.8 * smoothstep_custom(-0.2, 0.2, sin(p.y * 12.0)));
                        albedo = mix(albedo, bloodSpill, sharpSplatter * 0.95);
                    }
                    
                    float fCrack = getFloorCrack(p, mz_p, uIteration);
                    if (fCrack > 0.01) {
                        vec3 crackCol = vec3(1.5, 0.02, 0.01) * (1.0 + 8.0 * decayFactor);
                        albedo = mix(albedo, crackCol, fCrack);
                    }
                }
    
                if(matID == MAT_FLESH) {
                    float vein = sin(p.x * 12.0) * cos(p.y * 12.0) * sin(p.z * 12.0);
                    vec3 fleshBase = vec3(0.55, 0.02, 0.04);
                    vec3 veinCol = vec3(0.18, 0.0, 0.12); 
                    if(vein > 0.5) fleshBase = mix(fleshBase, veinCol, 0.6);
                    albedo = fleshBase;
                }
                
                col = albedo * (dif * 0.6 + 0.4) * ao;
    
                if(matID == MAT_FLESH) {
                    vec3 refDir = reflect(rd, n);
                    float spec = pow(max(dot(refDir, sunDir), 0.0), 12.0) * 0.4;
                    col += vec3(0.9, 0.15, 0.25) * spec;
                }
    
                if(matID == MAT_GLASS) {
                    vec3 refDir = reflect(rd, n);
                    float rt = 0.05; 
                    for(int i = 0; i < 40; i++) {
                        vec3 rp = p + refDir * rt;
                        vec2 rres = map(rp, 0.0);
                        if(rres.x < SURF_DIST) break;
                        if(rt > 50.0) break;
                        rt += rres.x;
                    }
                    
                    vec3 refCol = fogColor;
                    if(rt < 50.0) {
                        vec3 rp = p + refDir * rt;
                        vec3 rn = calcNormal(rp, 0.0);
                        float rDif = max(dot(rn, sunDir), 0.0);
                        vec3 rAlbedo = getBiomeColor(rp.z);
                        refCol = rAlbedo * (rDif * 0.6 + 0.4) * calcAO(rp, rn, 0.0);
                        
                        float rFog = 1.0 - exp(-0.02 * rt);
                        refCol = mix(refCol, getBiomeColor(rp.z + 30.0), rFog);
                    }
                    
                    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
                    float refAmount = mix(0.15, 0.85, fresnel);
                    col = mix(col, refCol, refAmount);
                }
            }
        } else {
            col = fogColor;
        }

        // Distance Fog composider
        float fogFactor = 1.0 - exp(-0.012 * t);
        
        // Deepen fog distance in Sector 666 for scary feel
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

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        vec2 dist = uv - 0.5;

        // Space warped modulo calculation matched with JS/Scene path
        float SPEED = 5.0; 
        float camZ = iTime * SPEED;

        // Matched sector boundaries for shatter effect
        // 1. Sector scale computing
        float s1 = mix(0.67, 2.0, hash(vec2(11.37 + floor(uIteration) * 17.81, 0.5)));
        float s2 = mix(0.67, 2.0, hash(vec2(22.74 + floor(uIteration) * 17.81, 0.5)));
        float s3 = mix(0.67, 2.0, hash(vec2(34.11 + floor(uIteration) * 17.81, 0.5)));
        float s4 = mix(0.67, 2.0, hash(vec2(45.48 + floor(uIteration) * 17.81, 0.5)));
        float s5 = mix(0.67, 2.0, hash(vec2(56.85 + floor(uIteration) * 17.81, 0.5)));
        float s6 = mix(0.67, 2.0, hash(vec2(68.22 + floor(uIteration) * 17.81, 0.5)));

        float w1 = 30.0 * s1; float w2 = 40.0 * s2; float w3 = 50.0 * s3;
        float w4 = 70.0 * s4; float w5 = 80.0 * s5; float w6 = 30.0 * s6;
        float sum = w1 + w2 + w3 + w4 + w5 + w6;
        float wb5 = 300.0 * ((w1 + w2 + w3 + w4 + w5) / sum);

        float mz_raw = mod(camZ, 300.0);
        float mz = 0.0;
        if (mz_raw < wb5) {
            // we are in sectors 1-5
            mz = 100.0; // dummy
        } else {
            mz = 270.0 + ((mz_raw - wb5) / (300.0 - wb5)) * 30.0;
        }

        // 2. GLASS SHATTERING EFFECT ON TRANSITION CORRIDOR IN THE CHAOS LOOP
        float iterFloor = floor(uIteration + 0.1);
        bool isChaosLoop = (mod(iterFloor, 2.0) == 1.0);
        
        // Shatter progresses over Sector 6 from 272 to 298
        float shatterProg = 0.0;
        if (isChaosLoop && mz >= 272.0) {
            shatterProg = clamp((mz - 272.0) / 24.0, 0.0, 1.0);
        }

        // Subliminal static flashes inside chaos corridor 
        float chaosFlashes = 0.0;
        if (isChaosLoop && mz >= 270.0) {
            chaosFlashes = step(0.94, hash(vec2(iTime * 15.0, 0.0))) * sin(iTime * 50.0) * 0.15;
        }

        // Apply glass shattering coordinate fracture
        if (shatterProg > 0.005) {
            vec2 center = vec2(0.5, 0.5);
            vec2 toCenter = uv - center;
            float angle = atan(toCenter.y, toCenter.x);
            float dCenter = length(toCenter);
            
            // Generate 12 distinct shard wedges radiating
            float wedge = floor(angle * 1.90985 + sin(dCenter * 14.0) * 0.5); // 12 shards = 2*pi / 12 = 0.5236. radians factor: 12 / (2 * pi) = 1.90985
            float shardSeed = fract(sin(wedge * 452.12 + 89.23) * 9876.54);
            
            // Push shards outwards
            vec2 shardDir = vec2(cos(angle), sin(angle)) * (shatterProg * 0.42 + shardSeed * 0.12);
            vec2 shardUV = uv + shardDir;
            
            // Rotate each shard
            float shardRot = shatterProg * (shardSeed - 0.5) * 1.0;
            float cS = cos(shardRot), sS = sin(shardRot);
            shardUV = mat2(cS, -sS, sS, cS) * (shardUV - center) + center;
            
            uv = mix(uv, shardUV, shatterProg);
        }

        // Pointer-based focus depth
        vec2 focusUV = clamp(uPointer * 0.5 + 0.5, 0.0, 1.0);
        float focusDepth = texture2D(uTexture, focusUV).a;
        if (focusDepth >= 149.0) {
            focusDepth = 20.0; 
        }
        
        float currentDepth = texture2D(uTexture, uv).a;
        float depthDiff = abs(currentDepth - focusDepth);
        float blurSize = clamp(depthDiff * 0.005, 0.0, 1.0);
        
        // Chromatic aberration offset
        vec2 chromAbOffset = dist * dot(dist, dist) * 0.08;

        // Screen static shaking / glitch offset under Sector 666 jumpscare
        bool is666 = (floor(uIteration) == 2.0);
        float currentMZ = mod(camZ, 300.0); // raw approx is fine
        if (is666 && currentMZ >= 148.0 && currentMZ <= 156.0) {
            // Jumpscare video artifacting / static coordinate shift!
            float tG = iTime * 60.0;
            vec2 glitchOff = vec2(sin(tG * 1.5) * 0.02 * step(0.7, sin(tG)), cos(tG * 0.8) * 0.012 * step(0.8, cos(tG * 1.1)));
            uv += glitchOff;
            chromAbOffset *= 4.5; // blast color fringing!
        }
        
        vec3 col = vec3(0.0);
        float totalWeight = 0.0;
        
        col.r += texture2D(uTexture, uv - chromAbOffset).r * 2.0;
        col.g += texture2D(uTexture, uv).g * 2.0;
        col.b += texture2D(uTexture, uv + chromAbOffset).b * 2.0;
        totalWeight += 2.0;
        
        float rBlurOffset = blurSize * 0.012;
        for (int i = 0; i < 6; i++) {
            float angle = float(i) * 1.04719755; 
            vec2 off = vec2(cos(angle), sin(angle)) * rBlurOffset;
            vec2 tapUV = uv + off;
            
            col.r += texture2D(uTexture, tapUV - chromAbOffset).r;
            col.g += texture2D(uTexture, tapUV).g;
            col.b += texture2D(uTexture, tapUV + chromAbOffset).b;
            totalWeight += 1.0;
        }
        col /= totalWeight;
        
        // Cinematic Red Light Bloom & Lens Flare under decay
        float decayFactor = clamp(uIteration * 0.15, 0.0, 0.9);
        if (decayFactor > 0.05) {
            vec2 flareSource = vec2(0.5, 0.15 + sin(iTime * 0.5) * 0.02);
            vec2 toLight = flareSource - uv;
            float distToLight = length(toLight);
            
            float bloom = exp(-distToLight * 12.0) * 0.45 * decayFactor;
            float streak = exp(-abs(toLight.y) * 110.0) * exp(-abs(toLight.x) * 4.0) * 0.35 * decayFactor;
            
            vec2 pointerOffset = uPointer * 0.12;
            vec2 ghostVec1 = toLight * -0.65 + pointerOffset;
            float ghost1 = exp(-length(uv - (flareSource + ghostVec1)) * 9.0) * 0.1 * decayFactor;
            
            vec2 ghostVec2 = toLight * 1.35 - pointerOffset;
            float ghost2 = exp(-length(uv - (flareSource + ghostVec2)) * 14.0) * 0.07 * decayFactor;
            
            float ghostRing = smoothstep(0.42, 0.45, length(uv - flareSource - pointerOffset * 0.5)) * 
                              smoothstep(0.48, 0.45, length(uv - flareSource - pointerOffset * 0.5)) * 0.06 * decayFactor;
            
            vec3 flareColor = vec3(1.35, 0.03, 0.008) * (bloom + streak + ghost1 + ghost2) + vec3(0.9, 0.15, 0.02) * ghostRing;
            col += flareColor;
        }

        // Crimson color washing during oblivion free fall
        if (isChaosLoop && mz >= 270.0) {
            float redWash = smoothstep(270.0, 300.0, mz);
            col = mix(col, vec3(0.12, 0.0, 0.005), redWash * 0.85);
        }

        // Subliminal static scary noise flashes
        col += vec3(chaosFlashes * 3.5, 0.0, 0.0);

        // High-ISO Film Grain
        float grain = hash(uv + fract(iTime));
        col -= grain * 0.06;
        
        // Claustrophobic Vignetting
        float vig = length(dist);
        col *= smoothstep(0.85, 0.3, vig);
        
        // Gamma Correction
        col = pow(max(col, 0.0), vec3(0.4545));
        
        // CRT Scanline emulation
        float scanline = sin(uv.y * iResolution.y * 1.5) * 0.04;
        col -= scanline;

        gl_FragColor = vec4(col, 1.0);
    }
`;
