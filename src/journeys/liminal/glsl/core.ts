import { SMIN } from '@wjh/glsl/sdf'


export const coreGlsl = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 iResolution;
    uniform float iTime;
    uniform float uIteration;
    uniform vec2 uPointer;
    uniform float uPlayerZ;
    uniform float uHeavy;
    out vec4 fragColor;

    // LITE is the phone build (and the fallback wherever the full one will
    // not compile). Phone compilers inline every call and unroll every short
    // loop, so the full shader becomes thirty-odd copies of map() — the AO
    // taps, the normals, two reflection marches — which some of them cannot
    // build at all. LITE marches as far as heavy effects off already does,
    // lets the reflections see the fog, shares one AO between the lit
    // branches and takes three AO taps: about eight copies.
    #ifdef LITE
    #define MAX_STEPS 50
    #define AO_STEPS 3
    #define AO_SPAN 0.3
    #define AO_DECAY 0.5625
    #else
    #define MAX_STEPS 120
    #define AO_STEPS 5
    #define AO_SPAN 0.15
    #define AO_DECAY 0.75
    #endif
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
    // How far the place has rotted at loop count 'loop' (smooth across the
    // turn of a loop). The first loop is clean; from the second the walls are
    // splitting and bleeding light, and every loop after is worse.
    float decayOf(float loop) {
        return clamp(smoothstep(0.5, 1.0, loop) * 0.42 + max(loop - 1.0, 0.0) * 0.2, 0.0, 0.95);
    }

    float getFloorCrack(vec3 p, float local_z, float it) {
        float decayFactor = decayOf(it);
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
    ${SMIN}

`
