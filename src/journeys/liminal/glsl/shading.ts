export const shadingGlsl = `    // Standard Normal Calculation
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
        for(int i = 0; i < AO_STEPS; i++) {
            float h = 0.02 + AO_SPAN * float(i);
            float d = map(p + h * n, ignoreWater).x;
            occ += (h - d) * sca;
            sca *= AO_DECAY;
        }
        return clamp(1.0 - 2.5 * occ * (5.0 / float(AO_STEPS)), 0.0, 1.0);
    }

    #ifdef LITE
    // What a reflection would have found, without marching for it: the room
    // itself, as dimly as the full build lights what its reflections hit —
    // ceilings at the ambient term, walls a little above it. (Distance fog is
    // the primary hit's to apply, as it is for the real thing.)
    vec3 cheapReflection(vec3 p, vec3 dir) {
        return getBiomeColor(p.z + 6.0) * mix(0.28, 0.42, 1.0 - abs(dir.y));
    }
    #endif

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

        // The camera faces +z with right = cross(fwd, Y) = -x, so a pointer on
        // the right moves the target toward -x.
        ta.xy += vec2(-uPointer.x * 6.8, uPointer.y * 5.5);

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

        #ifndef LITE
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
        #endif

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

        #ifdef LITE
            float aoHit = max(calcAO(p, n, 0.0), 0.35);
            #define HIT_AO aoHit
        #else
            #define HIT_AO max(calcAO(p, n, 0.0), 0.35)
        #endif

            if (s_p == 666.0) {
                // Unified ABYSS palette: oxblood rock + glowing lava-blood veins, cross-faded across set-pieces.
                float ao = HIT_AO;
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
            #ifdef LITE
                vec3 reflCol = cheapReflection(p, waterReflDir);
            #else
                vec3 reflCol = fogColor;
                float wt = 0.1;

                for (int i = 0; i < 40; i++) {
                    vec3 wp = p + waterReflDir * wt;
                    vec2 wres = map(wp, 1.0);
                    if (wres.x < SURF_DIST) break;
                    if (wt > 40.0) break;
                    wt += wres.x;
                }

                if (wt < 40.0) {
                    vec3 wp = p + waterReflDir * wt;
                    vec3 wn = calcNormal(wp, 1.0);
                    float rDif = max(dot(wn, sunDir), 0.0);
                    vec3 rAlbedo = getBiomeColor(wp.z);
                    reflCol = rAlbedo * (rDif * 0.6 + 0.4) * calcAO(wp, wn, 1.0);
                }
            #endif

                vec3 refrCol = (s_p == 666.0) ? vec3(0.3, 0.01, 0.02) : vec3(0.01, 0.12, 0.16);
                refrCol = getBiomeColor(p.z) * 0.2 + refrCol * 0.8;

                col = mix(refrCol, reflCol, mix(0.12, 0.88, fresnel));
            } else {
                float dif = max(dot(n, sunDir), 0.0);
                float ao = HIT_AO;

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
                    #ifdef LITE
                        vec3 refCol = cheapReflection(p, refDir);
                    #else
                        vec3 refCol = fogColor;
                        float rt = 0.05;
                        for (int i = 0; i < 40; i++) {
                            vec3 rp = p + refDir * rt;
                            vec2 rres = map(rp, 0.0);
                            if (rres.x < SURF_DIST) break;
                            if (rt > 50.0) break;
                            rt += rres.x;
                        }

                        if (rt < 50.0) {
                            vec3 rp = p + refDir * rt;
                            vec3 wn = calcNormal(rp, 0.0);
                            float rDif = max(dot(wn, sunDir), 0.0);
                            vec3 rAlbedo = getBiomeColor(rp.z);
                            refCol = rAlbedo * (rDif * 0.6 + 0.4) * max(calcAO(rp, wn, 0.0), 0.35);
                            float rFog = 1.0 - exp(-0.02 * rt);
                            refCol = mix(refCol, getBiomeColor(rp.z + 30.0), rFog);
                        }
                    #endif

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
